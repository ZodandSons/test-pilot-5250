import path from 'node:path';
import { parseYamlTest, loadJsTest, runSuite, newId, mergeCoverage } from '@tp5250/core';

/** Builds runnable test definitions from stored tests and executes runs. */
export class RunManager {
  constructor({ store, broadcast, testsDir, log = console.log }) {
    Object.assign(this, { store, broadcast, testsDir, log });
    this.active = new Map();
  }

  async toRunnable(summary) {
    const stored = summary.content != null ? summary : this.store.getTest(summary.id);
    const file = stored.sourcePath || path.join(this.testsDir, `${stored.id}.${stored.type === 'js' ? 'test.js' : 'yaml'}`);
    const def = stored.type === 'js' ? await loadJsTest(stored.content, { file }) : parseYamlTest(stored.content, { file });
    def.file = file; // data files resolve relative to the original location
    def.id = stored.id;
    return def;
  }

  selectTests({ testIds, suite, tags }) {
    let tests = this.store.listTests();
    if (testIds?.length) tests = tests.filter((t) => testIds.includes(t.id));
    else {
      if (suite) tests = tests.filter((t) => t.suite === suite);
      if (tags?.length) tests = tests.filter((t) => t.tags.some((x) => tags.includes(x)));
    }
    return tests;
  }

  /** Create a run and execute it in the background. Returns the run id. */
  start({ testIds, suite, tags, environmentId, coverage = true, name, trigger = 'manual', concurrency = 2, retries = 0 }) {
    const env = this.store.getEnv(environmentId, { mask: false }) || this.store.listEnvs().map((e) => this.store.getEnv(e.id, { mask: false }))[0];
    if (!env) throw Object.assign(new Error('No environment configured'), { status: 400 });
    const tests = this.selectTests({ testIds, suite, tags });
    if (!tests.length) throw Object.assign(new Error('No tests match the selection'), { status: 400 });
    const run = {
      id: newId('run'), name: name || (suite ? `Suite: ${suite}` : tags?.length ? `Tags: ${tags.join(', ')}` : tests.length === 1 ? tests[0].name : `${tests.length} tests`),
      status: 'queued', trigger, environmentId: env.id, environmentName: env.name, startedAt: new Date().toISOString(),
      total: 0, passed: 0, failed: 0, errors: 0, skipped: 0, coveragePct: null, options: { testIds: tests.map((t) => t.id), coverage, concurrency, retries },
    };
    this.store.saveRun(run);
    this.broadcast({ type: 'run.update', run: this.store.getRun(run.id) });
    this.execute(run, tests, env, { coverage, concurrency, retries }).catch((e) => {
      this.log('[run] fatal', e);
      run.status = 'error'; run.finishedAt = new Date().toISOString();
      this.store.saveRun(run);
      this.broadcast({ type: 'run.update', run: this.store.getRun(run.id) });
    });
    return run.id;
  }

  async execute(run, storedTests, env, { coverage, concurrency, retries }) {
    const runnable = [];
    const loadErrors = [];
    for (const t of storedTests) {
      try { runnable.push(await this.toRunnable(t)); }
      catch (e) { loadErrors.push({ t, e }); }
    }
    run.status = 'running';
    this.store.saveRun(run);
    this.broadcast({ type: 'run.update', run: this.store.getRun(run.id) });
    const t0 = Date.now();

    for (const { t, e } of loadErrors) {
      const res = { id: newId('res'), runId: run.id, testId: t.id, testName: t.name, suite: t.suite, iteration: 1, status: 'error',
        error: `Script error: ${e.message}`, durationMs: 0, steps: [], startedAt: new Date().toISOString() };
      this.store.saveResult(res);
    }

    const live = new Map(); // job -> result
    const { results } = await runSuite(runnable, {
      env, concurrency, retries, coverage,
      hooks: {
        onJobStart: (job) => {
          let res = live.get(job);
          if (!res) {
            res = { id: newId('res'), runId: run.id, testId: job.test.id, testName: job.test.name, suite: job.test.suite, iteration: job.iteration,
              dataRow: job.dataRow, status: 'running', durationMs: 0, steps: [], startedAt: new Date().toISOString() };
            live.set(job, res);
          }
          res.steps = []; res.attempts = job.attempt;
          this.store.saveResult(res);
          this.broadcast({ type: 'result.update', runId: run.id, result: { ...res, steps: undefined } });
        },
        onStep: (job, step) => {
          const res = live.get(job);
          res.steps.push(step);
          this.broadcast({ type: 'step', runId: run.id, resultId: res.id, step });
        },
        onResult: (r, job) => {
          const res = live.get(job);
          const full = { ...res, status: r.status, durationMs: r.durationMs, error: r.error, failedStep: r.failedStep, steps: r.steps,
            coverage: r.coverage, attempts: r.attempts, flaky: r.flaky };
          this.store.saveResult(full);
          if (r.coverageData) this.store.saveCoverage(res.id, r.coverageData);
          run.total++; run[r.status === 'passed' ? 'passed' : r.status === 'failed' ? 'failed' : 'errors']++;
          this.store.saveRun(run);
          this.broadcast({ type: 'result.update', runId: run.id, result: { ...full, steps: undefined } });
          this.broadcast({ type: 'run.update', run: this.store.getRun(run.id) });
        },
      },
      log: (m) => this.log(`[run ${run.id}] ${m}`),
    });

    run.errors += loadErrors.length;
    run.total += loadErrors.length;
    const covInputs = results.filter((r) => r.coverageData).map((r) => ({ source: {}, data: r.coverageData }));
    run.coveragePct = covInputs.length ? mergeCoverage(covInputs).totals.pct : null;
    run.status = run.failed || run.errors ? 'failed' : 'passed';
    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - t0;
    this.store.saveRun(run);
    this.broadcast({ type: 'run.update', run: this.store.getRun(run.id) });
    this.log(`[run] ${run.name}: ${run.passed}/${run.total} passed${run.coveragePct != null ? `, coverage ${run.coveragePct}%` : ''}`);
  }

  /** Import a run produced by the CLI (`tp5250 run --server`). */
  importRun({ run, coverage = [] }) {
    const id = newId('run');
    const r = { ...run, id, trigger: run.trigger || 'cli' };
    this.store.saveRun(r);
    (run.results || []).forEach((res, i) => {
      const rid = newId('res');
      this.store.saveResult({ ...res, id: rid, runId: id, testId: this.matchTestId(res) });
      if (coverage[i]) this.store.saveCoverage(rid, coverage[i]);
    });
    this.broadcast({ type: 'run.update', run: this.store.getRun(id) });
    return id;
  }

  matchTestId(res) {
    const t = this.store.listTests().find((x) => x.name === res.testName);
    return t ? t.id : res.testId;
  }
}
