import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS environments (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS tests (id TEXT PRIMARY KEY, name TEXT NOT NULL, suite TEXT, type TEXT, tags TEXT, description TEXT,
  content TEXT, source_path TEXT, step_count INTEGER, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, name TEXT, status TEXT, trigger TEXT, environment_id TEXT, environment_name TEXT,
  started_at TEXT, finished_at TEXT, duration_ms INTEGER, total INTEGER, passed INTEGER, failed INTEGER, errors INTEGER,
  skipped INTEGER, coverage_pct REAL, options TEXT);
CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, run_id TEXT, test_id TEXT, test_name TEXT, suite TEXT, iteration INTEGER,
  data_row TEXT, status TEXT, duration_ms INTEGER, error TEXT, failed_step INTEGER, steps TEXT, coverage TEXT, attempts INTEGER,
  flaky INTEGER, started_at TEXT);
CREATE INDEX IF NOT EXISTS results_run ON results(run_id);
CREATE INDEX IF NOT EXISTS results_test ON results(test_id, started_at);
CREATE TABLE IF NOT EXISTS coverage (result_id TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, name TEXT, cron TEXT, suite TEXT, tags TEXT, test_ids TEXT,
  environment_id TEXT, enabled INTEGER, coverage INTEGER, last_run_at TEXT, created_at TEXT);
`;

const J = (s, d = null) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };

export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }
  all(sql, ...p) { return this.db.prepare(sql).all(...p); }
  get(sql, ...p) { return this.db.prepare(sql).get(...p); }
  run(sql, ...p) { return this.db.prepare(sql).run(...p); }

  // ---------------------------------------------------------------- envs
  envFromRow(r, { mask = true } = {}) {
    if (!r) return null;
    const d = J(r.data, {});
    if (mask && d.password) d.password = '***';
    if (mask && d.codecov?.sshPassword) d.codecov.sshPassword = '***';
    return { id: r.id, name: r.name, ...d };
  }
  listEnvs() { return this.all('SELECT * FROM environments ORDER BY created_at').map((r) => this.envFromRow(r)); }
  getEnv(id, opts) { return this.envFromRow(this.get('SELECT * FROM environments WHERE id = ?', id), opts); }
  saveEnv(env) {
    const { id, name, ...data } = env;
    const prev = this.getEnv(id, { mask: false });
    if (prev) {
      if (data.password === '***') data.password = prev.password;
      if (data.codecov?.sshPassword === '***') data.codecov.sshPassword = prev.codecov?.sshPassword;
      this.run('UPDATE environments SET name = ?, data = ? WHERE id = ?', name, JSON.stringify(data), id);
    } else {
      this.run('INSERT INTO environments (id, name, data, created_at) VALUES (?, ?, ?, ?)', id, name, JSON.stringify(data), new Date().toISOString());
    }
    return this.getEnv(id);
  }

  // --------------------------------------------------------------- tests
  testFromRow(r, { content = false } = {}) {
    if (!r) return null;
    const last = this.get('SELECT status, started_at FROM results WHERE test_id = ? AND status NOT IN (\'running\',\'queued\') ORDER BY started_at DESC LIMIT 1', r.id);
    const t = { id: r.id, name: r.name, suite: r.suite, type: r.type, tags: J(r.tags, []), description: r.description || '',
      updatedAt: r.updated_at, stepCount: r.step_count, sourcePath: r.source_path, lastStatus: last?.status ?? null, lastRunAt: last?.started_at ?? null };
    if (content) t.content = r.content;
    return t;
  }
  listTests() { return this.all('SELECT * FROM tests ORDER BY suite, name').map((r) => this.testFromRow(r)); }
  getTest(id, opts = { content: true }) { return this.testFromRow(this.get('SELECT * FROM tests WHERE id = ?', id), opts); }
  saveTest(t) {
    const now = new Date().toISOString();
    if (this.get('SELECT id FROM tests WHERE id = ?', t.id)) {
      this.run('UPDATE tests SET name=?, suite=?, type=?, tags=?, description=?, content=?, step_count=?, updated_at=? WHERE id=?',
        t.name, t.suite, t.type, JSON.stringify(t.tags || []), t.description || '', t.content, t.stepCount ?? 0, now, t.id);
    } else {
      this.run('INSERT INTO tests (id,name,suite,type,tags,description,content,source_path,step_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        t.id, t.name, t.suite, t.type, JSON.stringify(t.tags || []), t.description || '', t.content, t.sourcePath || null, t.stepCount ?? 0, now, now);
    }
    return this.getTest(t.id);
  }

  // ---------------------------------------------------------------- runs
  runFromRow(r) {
    if (!r) return null;
    return { id: r.id, name: r.name, status: r.status, trigger: r.trigger, environmentId: r.environment_id, environmentName: r.environment_name,
      startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms, total: r.total, passed: r.passed, failed: r.failed,
      errors: r.errors, skipped: r.skipped, coveragePct: r.coverage_pct };
  }
  saveRun(run) {
    const exists = this.get('SELECT id FROM runs WHERE id = ?', run.id);
    const v = [run.name, run.status, run.trigger, run.environmentId ?? null, run.environmentName ?? null, run.startedAt, run.finishedAt ?? null,
      run.durationMs ?? null, run.total ?? 0, run.passed ?? 0, run.failed ?? 0, run.errors ?? 0, run.skipped ?? 0, run.coveragePct ?? null, JSON.stringify(run.options || {})];
    if (exists) this.run('UPDATE runs SET name=?,status=?,trigger=?,environment_id=?,environment_name=?,started_at=?,finished_at=?,duration_ms=?,total=?,passed=?,failed=?,errors=?,skipped=?,coverage_pct=?,options=? WHERE id=?', ...v, run.id);
    else this.run('INSERT INTO runs (name,status,trigger,environment_id,environment_name,started_at,finished_at,duration_ms,total,passed,failed,errors,skipped,coverage_pct,options,id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ...v, run.id);
  }
  listRuns(limit = 50) { return this.all('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?', limit).map((r) => this.runFromRow(r)); }
  getRun(id) { return this.runFromRow(this.get('SELECT * FROM runs WHERE id = ?', id)); }

  resultFromRow(r, { steps = true } = {}) {
    if (!r) return null;
    const res = { id: r.id, runId: r.run_id, testId: r.test_id, testName: r.test_name, suite: r.suite, iteration: r.iteration,
      dataRow: J(r.data_row), status: r.status, durationMs: r.duration_ms, error: r.error, failedStep: r.failed_step,
      coverage: J(r.coverage), attempts: r.attempts, flaky: !!r.flaky, startedAt: r.started_at };
    if (steps) res.steps = J(r.steps, []);
    return res;
  }
  saveResult(res) {
    const v = [res.runId, res.testId, res.testName, res.suite, res.iteration ?? 1, JSON.stringify(res.dataRow ?? null), res.status, res.durationMs ?? 0,
      res.error ?? null, res.failedStep ?? null, JSON.stringify(res.steps || []), JSON.stringify(res.coverage ?? null), res.attempts ?? 1, res.flaky ? 1 : 0, res.startedAt];
    if (this.get('SELECT id FROM results WHERE id = ?', res.id)) {
      this.run('UPDATE results SET run_id=?,test_id=?,test_name=?,suite=?,iteration=?,data_row=?,status=?,duration_ms=?,error=?,failed_step=?,steps=?,coverage=?,attempts=?,flaky=?,started_at=? WHERE id=?', ...v, res.id);
    } else {
      this.run('INSERT INTO results (run_id,test_id,test_name,suite,iteration,data_row,status,duration_ms,error,failed_step,steps,coverage,attempts,flaky,started_at,id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ...v, res.id);
    }
  }
  resultsForRun(runId, opts) { return this.all('SELECT * FROM results WHERE run_id = ? ORDER BY started_at, test_name, iteration', runId).map((r) => this.resultFromRow(r, opts)); }
  getResult(id) { return this.resultFromRow(this.get('SELECT * FROM results WHERE id = ?', id)); }

  saveCoverage(resultId, data) { this.run('INSERT OR REPLACE INTO coverage (result_id, data) VALUES (?, ?)', resultId, JSON.stringify(data)); }
  getCoverage(resultId) { return J(this.get('SELECT data FROM coverage WHERE result_id = ?', resultId)?.data); }

  deleteRun(id) {
    for (const r of this.all('SELECT id FROM results WHERE run_id = ?', id)) this.run('DELETE FROM coverage WHERE result_id = ?', r.id);
    this.run('DELETE FROM results WHERE run_id = ?', id);
    this.run('DELETE FROM runs WHERE id = ?', id);
  }

  // ----------------------------------------------------------- schedules
  scheduleFromRow(r) {
    return r && { id: r.id, name: r.name, cron: r.cron, suite: r.suite || '', tags: J(r.tags, []), testIds: J(r.test_ids, []),
      environmentId: r.environment_id, enabled: !!r.enabled, coverage: r.coverage !== 0, lastRunAt: r.last_run_at };
  }
  listSchedules() { return this.all('SELECT * FROM schedules ORDER BY created_at').map((r) => this.scheduleFromRow(r)); }
  getSchedule(id) { return this.scheduleFromRow(this.get('SELECT * FROM schedules WHERE id = ?', id)); }
  saveSchedule(s) {
    const v = [s.name, s.cron, s.suite || '', JSON.stringify(s.tags || []), JSON.stringify(s.testIds || []), s.environmentId, s.enabled ? 1 : 0, s.coverage === false ? 0 : 1, s.lastRunAt ?? null];
    if (this.get('SELECT id FROM schedules WHERE id = ?', s.id)) this.run('UPDATE schedules SET name=?,cron=?,suite=?,tags=?,test_ids=?,environment_id=?,enabled=?,coverage=?,last_run_at=? WHERE id=?', ...v, s.id);
    else this.run('INSERT INTO schedules (name,cron,suite,tags,test_ids,environment_id,enabled,coverage,last_run_at,id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...v, s.id, new Date().toISOString());
    return this.getSchedule(s.id);
  }
}
