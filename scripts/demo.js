#!/usr/bin/env node
/**
 * Demo mode: starts the server + built-in IBM i simulator with a fresh database,
 * executes real test runs against the simulator, then spreads those runs over
 * the last 12 days so the dashboard trends have something to show.
 * (Run timestamps are shifted for the demo; all results come from real executions.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, parseYamlTest } from '@tp5250/core';
import { startServer } from '../packages/server/src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(ROOT, 'data/demo.db');
for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) fs.rmSync(f, { force: true });

const app = await startServer({ dbFile, port: Number(process.env.TP_PORT || 4250) });
const { store, runs } = app;

// add the intentionally failing demo test
const defect = path.join(ROOT, 'samples/demo/known-defect.yaml');
const content = fs.readFileSync(defect, 'utf8');
const def = parseYamlTest(content);
store.saveTest({ id: newId('t'), type: 'yaml', content, sourcePath: defect, name: def.name, suite: def.suite, tags: def.tags, description: def.description, stepCount: def.steps.length });

const tests = store.listTests();
const byName = (s) => tests.filter((t) => t.name.toLowerCase().includes(s)).map((t) => t.id);
const auth = [...byName('sign on')];
const validation = byName('validates');
const list = byName('lists, pages');
const cust = byName('customer inquiry');
const cancel = byName('cancel an open');
const defectId = byName('known defect');

// The suite "grows" over the period, so coverage trends upward.
const plan = [
  [...auth], [...auth, ...validation], [...auth, ...validation], [...auth, ...validation, ...list],
  [...auth, ...validation, ...list, ...defectId], [...auth, ...validation, ...list, ...cust], [...auth, ...validation, ...list, ...cust, ...defectId],
  [...auth, ...validation, ...list, ...cust], [...auth, ...validation, ...list, ...cust, ...cancel, ...defectId],
  [...auth, ...validation, ...list, ...cust, ...cancel], [...auth, ...validation, ...list, ...cust, ...cancel, ...defectId],
  [...auth, ...validation, ...list, ...cust, ...cancel],
];

const waitFor = async (id) => { for (;;) { const r = store.getRun(id); if (['passed', 'failed', 'error'].includes(r.status)) return r; await new Promise((x) => setTimeout(x, 200)); } };
console.log(`[demo] executing ${plan.length} runs against the simulator...`);
const ids = [];
for (let i = 0; i < plan.length; i++) {
  const id = runs.start({ testIds: plan[i], environmentId: 'env_simulator', coverage: true, name: i % 3 === 2 ? 'Nightly regression' : 'Smoke + regression', trigger: i % 3 === 2 ? 'schedule' : 'manual' });
  const r = await waitFor(id);
  ids.push(id);
  process.stdout.write(`  run ${i + 1}/${plan.length}: ${r.passed}/${r.total} passed, coverage ${r.coveragePct ?? '-'}%\n`);
}

// spread across the previous days
const now = Date.now();
ids.forEach((id, i) => {
  const shift = (plan.length - 1 - i) * 86400000 + (i % 3) * 3600000;
  const fix = (iso) => iso && new Date(new Date(iso).getTime() - shift).toISOString();
  const r = store.get('SELECT started_at, finished_at FROM runs WHERE id = ?', id);
  store.run('UPDATE runs SET started_at = ?, finished_at = ? WHERE id = ?', fix(r.started_at), fix(r.finished_at), id);
  for (const res of store.all('SELECT id, started_at FROM results WHERE run_id = ?', id)) store.run('UPDATE results SET started_at = ? WHERE id = ?', fix(res.started_at), res.id);
});
store.saveSchedule({ id: newId('sch'), name: 'Nightly regression', cron: '0 2 * * 1-5', suite: '', tags: [], testIds: [], environmentId: 'env_simulator', enabled: true, coverage: true });
console.log(`[demo] ready → open http://localhost:${app.port}  (Ctrl+C to stop)`);
void now;
