import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseYamlTest, interpolate, parseCsv, mergeCoverage, runTest, validateTest, stepsToYaml } from '../src/index.js';
import { startSimulator } from '@tp5250/simulator';

test('YAML steps normalize and validate', () => {
  const t = parseYamlTest(`name: x\nsteps:\n  - press: Enter\n  - fill: { label: Customer, value: "1" }\n  - assertText: Hello\n`);
  assert.deepEqual(t.steps.map((s) => s.action), ['press', 'fill', 'assertText']);
  assert.deepEqual(t.steps[0].args, { key: 'Enter' });
  assert.deepEqual(t.steps[2].args, { text: 'Hello' });
  assert.throws(() => parseYamlTest('name: x\nsteps:\n  - fill: { value: 1 }\n  - bogus: 1\n'), /fill needs label[\s\S]*unknown action "bogus"/);
});

test('stepsToYaml round-trips', () => {
  const steps = [{ action: 'press', args: { key: 'F3' } }, { action: 'fill', args: { row: 5, col: 31, value: '10001' } }];
  const t = parseYamlTest(stepsToYaml({ name: 'rt', steps }));
  assert.deepEqual(t.steps.map(({ action, args }) => ({ action, args })), steps);
});

test('interpolation resolves env, data, vars and fails loudly', () => {
  const scope = { env: { user: 'TESTER', variables: { LIB: 'ORDLIB' } }, data: { CUST: '10001' }, vars: { X: 'y' } };
  assert.equal(interpolate('${env.user}/${env.LIB}/${data.CUST}/${vars.X}/${CUST}', scope), 'TESTER/ORDLIB/10001/y/10001');
  assert.throws(() => interpolate('${data.NOPE}', scope), /Unresolved/);
});

test('CSV parsing handles quotes', () => {
  assert.deepEqual(parseCsv('A,B\n1,"x, ""y"""\n'), [{ A: '1', B: 'x, "y"' }]);
});

test('coverage merge unions lines and tracks contributors', () => {
  const prog = (hits) => ({ programs: [{ program: 'P', library: 'L', sourceFile: 'P.rpgle', language: 'RPGLE', source: ['a', 'b', 'c', 'd'], executable: [1, 2, 3, 4], hits }] });
  const m = mergeCoverage([{ source: { testName: 't1' }, data: prog({ 1: 1, 2: 1 }) }, { source: { testName: 't2' }, data: prog({ 2: 3, 3: 1 }) }]);
  assert.deepEqual(m.totals, { executable: 4, covered: 3, pct: 75 });
  assert.deepEqual(m.programs[0].lines[1].coveredBy, [0, 1]);
  assert.equal(m.programs[0].lines[1].hits, 4);
});

test('JS test validation reports missing run()', async () => {
  const v = await validateTest('js', 'export default { name: "x" }');
  assert.equal(v.ok, false);
});

let sim;
before(async () => { sim = await startSimulator({ port: 0, httpPort: 0, quiet: true }); });
after(async () => { await sim.close(); });

test('end-to-end: YAML test against the simulator with coverage', async () => {
  const t = parseYamlTest(`name: e2e
coverage: { programs: [ORDINQ] }
steps:
  - signon: {}
  - command: "1"
  - fill: { label: Customer number, value: "10001" }
  - press: Enter
  - assertText: { text: "ACME Manufacturing", row: 1 }
  - press: F3
`);
  const env = { host: '127.0.0.1', port: sim.port, user: 'TESTER', password: 'TESTER1', coverageAdapter: 'simulator', coveragePort: sim.httpPort };
  const r = await runTest(t, { env });
  assert.equal(r.status, 'passed', r.error);
  assert.equal(r.steps.length, 6);
  assert.ok(r.coverage.pct > 30 && r.coverage.pct < 100, `coverage ${r.coverage.pct}`);
});

test('end-to-end: failing assertion reports step, expected and screen', async () => {
  const t = parseYamlTest('name: fail\nsteps:\n  - signon: {}\n  - assertText: { text: "NOPE", row: 1 }\n');
  const r = await runTest(t, { env: { host: '127.0.0.1', port: sim.port, user: 'TESTER', password: 'TESTER1' } });
  assert.equal(r.status, 'failed');
  assert.equal(r.failedStep, 1);
  assert.equal(r.steps[1].expected, 'NOPE');
  assert.match(r.steps[1].screen.text[0], /Order Management System/);
});

test('connection failure is an error, not a failure', async () => {
  const t = parseYamlTest('name: down\nsteps:\n  - press: Enter\n');
  const r = await runTest(t, { env: { host: '127.0.0.1', port: 1 } });
  assert.equal(r.status, 'error');
});
