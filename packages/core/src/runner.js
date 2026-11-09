import crypto from 'node:crypto';
import { Session } from '@tp5250/tn5250';
import { StepExecutor, createTestApi } from './executor.js';
import { createCoverageAdapter, summarize } from './coverage.js';
import { resolveDataRows } from './script.js';

export const newId = (p) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

function deviceName(prefix = 'TP') {
  return (prefix + crypto.randomBytes(4).toString('hex').toUpperCase()).slice(0, 10);
}

/**
 * Run a single test case (one data row) end to end.
 * Returns a Result (see docs/API.md) plus `coverageData` (normalized).
 */
export async function runTest(test, { env, dataRow = null, iteration = 1, coverage = true, onStep = null, testTimeout = 180000, log = () => {} }) {
  const started = Date.now();
  const result = {
    testId: test.id || test.file || test.name, testName: test.name, suite: test.suite, iteration, dataRow,
    status: 'running', durationMs: 0, error: null, failedStep: null, steps: [], coverage: null, coverageData: null,
    startedAt: new Date(started).toISOString(),
  };
  const dev = env.deviceName || deviceName(env.devicePrefix);
  const session = new Session({
    host: env.host, port: Number(env.port || 23), tls: !!env.tls, deviceName: dev,
    readyTimeout: env.readyTimeout || 30000, connectTimeout: env.connectTimeout || 15000,
  });
  session.on('error', () => {});
  const adapter = createCoverageAdapter(env, test, { enabled: coverage, testId: `${test.name}_${iteration}`.replace(/\W+/g, '_') });
  const exec = new StepExecutor({ session, env, data: dataRow || {}, vars: { ...(test.variables || {}) }, coverage: adapter, onStep, defaultTimeout: test.timeout || env.stepTimeout || 10000 });

  let timer;
  const timeoutP = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Test timed out after ${testTimeout}ms`)), testTimeout); });
  try {
    await Promise.race([(async () => {
      try { await session.connect(); }
      catch (e) { const err = new Error(`Cannot connect to ${env.host}:${env.port}: ${e.message}`); err.kind = 'error'; throw err; }
      try { await adapter.beforeTest({ deviceName: dev, session }); }
      catch (e) { log(`coverage disabled for this test: ${e.message}`); }
      if (test.type === 'js') {
        const t = createTestApi(exec);
        await test.run(t);
      } else {
        for (const s of test.steps) await exec.exec(s.action, s.args, { name: s.name, continueOnFailure: s.continueOnFailure });
      }
    })(), timeoutP]);
    result.status = exec.steps.some((s) => s.status === 'failed') ? 'failed' : 'passed';
    if (result.status === 'failed') {
      const f = exec.steps.find((s) => s.status === 'failed');
      result.failedStep = f.index; result.error = f.error;
    }
  } catch (e) {
    // 'error' = infrastructure problem (cannot connect, test timeout); 'failed' = a step/assertion failed
    result.status = e.kind === 'error' || (e.stepIndex == null && /^Test timed out/.test(e.message)) ? 'error' : 'failed';
    result.error = e.message;
    if (e.stepIndex != null) result.failedStep = e.stepIndex;
    else {
      // error thrown outside a step (e.g. expect() in a JS test): record it as a step
      const st = { index: exec.steps.length, action: 'error', description: e.name === 'AssertionError' ? 'Assertion' : 'Unhandled error',
        status: 'failed', durationMs: 0, error: e.message, expected: e.expected ?? null, screen: session.screen.toJSON() };
      exec.steps.push(st); onStep?.(st);
      result.failedStep = st.index;
    }
  } finally {
    clearTimeout(timer);
  }
  try {
    const data = await adapter.afterTest();
    if (data) { result.coverageData = data; result.coverage = summarize(data); }
  } catch (e) { log(`coverage collection failed: ${e.message}`); }
  session.close();
  result.steps = exec.steps;
  result.durationMs = Date.now() - started;
  result.finishedAt = new Date().toISOString();
  return result;
}

/** Expand tests x data rows into jobs. */
export function planJobs(tests, baseDir) {
  const jobs = [];
  for (const t of tests) {
    const rows = resolveDataRows(t, baseDir);
    rows.forEach((row, i) => jobs.push({ test: t, dataRow: row, iteration: i + 1 }));
  }
  return jobs;
}

/**
 * Run many tests with bounded parallelism and retries.
 * hooks: onJobStart(job), onStep(job, step), onResult(result)
 */
export async function runSuite(tests, { env, concurrency = 2, coverage = true, retries = 0, baseDir, hooks = {}, log = () => {} }) {
  const jobs = planJobs(tests, baseDir);
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const maxAttempts = 1 + Math.max(retries, job.test.retries || 0);
      let res;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        job.attempt = attempt;
        hooks.onJobStart?.(job);
        res = await runTest(job.test, { env, dataRow: job.dataRow, iteration: job.iteration, coverage, onStep: (s) => hooks.onStep?.(job, s), log });
        res.attempts = attempt;
        if (res.status === 'passed') { res.flaky = attempt > 1; break; }
      }
      results.push(res);
      hooks.onResult?.(res, job);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, worker));
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    errors: results.filter((r) => r.status === 'error').length,
    skipped: 0,
  };
  return { results, summary };
}
