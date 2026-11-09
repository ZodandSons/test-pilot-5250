// Fixture data for ?mock=1 so every page renders without a running server.
import { wsEmitLocal } from './ws.js';

const DAY = 86400000;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);

export function makeScreen(lines, fields = [], cursor = { row: 1, col: 1 }, attrs = []) {
  const text = Array.from({ length: 24 }, (_, i) => pad(lines[i] || '', 80));
  fields.forEach((f) => {
    const row = text[f.row - 1].split('');
    const v = f.hidden ? '' : f.value || '';
    for (let i = 0; i < f.length && f.col - 1 + i < 80; i++) row[f.col - 1 + i] = v[i] || ' ';
    text[f.row - 1] = row.join('');
  });
  return { rows: 24, cols: 80, text, cursor, keyboardLocked: false, fields: fields.map((f, id) => ({ id, bypass: false, hidden: false, numeric: false, input: true, label: '', ...f })), attrs };
}

const signon = () => makeScreen(
  ['', '                                   Sign On', '                                              System  . . . . . :   DEVPUB', '                                              Subsystem . . . . :   QINTER', '                                              Display . . . . . :   QPADEV0001', '', '                 User  . . . . . . . . . . . . . .', '                 Password  . . . . . . . . . . . .', '                 Program/procedure . . . . . . . .', '                 Menu  . . . . . . . . . . . . . .', '                 Current library . . . . . . . . .', ...Array(11).fill(''), '', '                                             (C) COPYRIGHT IBM CORP. 1980, 2024.'],
  [
    { row: 7, col: 53, length: 10, label: 'User', value: '' },
    { row: 8, col: 53, length: 10, label: 'Password', value: '', hidden: true },
    { row: 9, col: 53, length: 10, label: 'Program/procedure', value: '' },
    { row: 10, col: 53, length: 10, label: 'Menu', value: '' },
    { row: 11, col: 53, length: 10, label: 'Current library', value: '' },
  ],
  { row: 7, col: 53 },
  [{ row: 2, col: 36, length: 7, color: 'white' }, { row: 24, col: 46, length: 35, color: 'blue' }],
);

const orderInq = (cust = '', name = '', status = '') => makeScreen(
  ['ORDINQ                      Order Inquiry                         11/04/26', '                                                                    12:41:07', '', ' Type customer number, press Enter.', '', '   Customer number . . . .', '', `   Name  . . . . . . . . :   ${name}`, `   Status  . . . . . . . :   ${status}`, '', '   Order    Date        Amount      Status', ...(cust ? ['   500121   10/28/26    1,245.00    OPEN', '   500118   10/22/26      310.50    SHIPPED', '   500102   10/02/26    4,020.00    CLOSED'] : []), ...Array(cust ? 8 : 11).fill(''), '', ' F3=Exit   F5=Refresh   F12=Cancel'],
  [{ row: 6, col: 30, length: 8, label: 'Customer number', value: cust, numeric: true }],
  { row: 6, col: 30 },
  [{ row: 1, col: 29, length: 13, color: 'white' }, { row: 11, col: 4, length: 38, color: 'white', underline: true }, { row: 24, col: 2, length: 34, color: 'blue' }, ...(status ? [{ row: 9, col: 31, length: 6, color: status === 'ACTIVE' ? 'green' : 'red' }] : [])],
);

const suites = ['orders', 'customers', 'signon', 'inventory'];
const testNames = [
  ['Sign on with valid user', 'signon'], ['Sign on rejects bad password', 'signon'],
  ['Order inquiry – valid customer', 'orders'], ['Order inquiry – unknown customer', 'orders'],
  ['Order entry – create order', 'orders'], ['Customer maintenance – update address', 'customers'],
  ['Customer search by name', 'customers'], ['Inventory lookup by item', 'inventory'],
  ['Inventory adjust quantity (data-driven)', 'inventory'],
];

const tests = testNames.map(([name, suite], i) => ({
  id: `t_${i + 1}`, name, suite, type: i === 6 ? 'js' : 'yaml', tags: [suite, i < 3 ? 'smoke' : 'regression'],
  description: '', updatedAt: iso(now - i * DAY), lastStatus: i === 3 ? 'failed' : i === 8 ? 'error' : 'passed',
  lastRunAt: iso(now - i * 3600000), stepCount: 5 + (i % 4) * 2,
}));

const sampleYaml = `name: Order inquiry – valid customer
suite: orders
tags: [orders, smoke]
coverage:
  programs: [ORDINQ, CUSTVAL]
steps:
  - signon: { user: \${env.USER}, password: \${env.PASSWORD} }
  - waitFor: { text: "Main Menu" }
  - command: "CALL ORDINQ"
  - fill: { label: "Customer number", value: "10001" }
  - press: Enter
  - assertText: { text: "ACME SUPPLY", row: 8 }
  - assertField: { label: "Status", equals: "ACTIVE" }
  - press: F3
`;

const stepsFor = (failedAt) => {
  const defs = [
    ['signon', 'Sign on as TESTER', signon()], ['waitFor', 'Wait for "Main Menu"', signon()],
    ['command', 'Run command CALL ORDINQ', orderInq()], ['fill', 'Fill "Customer number" with 10001', orderInq('10001')],
    ['press', 'Press Enter', orderInq('10001', 'ACME SUPPLY CO', 'ACTIVE')],
    ['assertText', 'Screen contains "ACME SUPPLY" on row 8', orderInq('10001', 'ACME SUPPLY CO', 'ACTIVE')],
    ['assertField', 'Field "Status" equals "ACTIVE"', orderInq('10001', 'ACME SUPPLY CO', 'ACTIVE')],
    ['press', 'Press F3', signon()],
  ];
  return defs.map(([action, description, screen], index) => ({
    index, action, description, durationMs: 40 + ((index * 37) % 300),
    status: failedAt === undefined || index < failedAt ? 'passed' : index === failedAt ? 'failed' : 'skipped',
    error: index === failedAt ? 'Expected field "Status" to equal "ACTIVE" but was "HOLD"' : null,
    expected: index === failedAt ? 'ACTIVE' : undefined,
    screen: index === failedAt ? orderInq('10001', 'ACME SUPPLY CO', 'HOLD') : screen,
  }));
};

const runs = Array.from({ length: 18 }, (_, i) => {
  const failed = i % 4 === 1 ? 1 + (i % 3) : 0;
  const total = 9;
  const status = i === 0 ? 'running' : failed ? 'failed' : 'passed';
  return {
    id: `run_${100 - i}`, name: i % 3 === 0 ? 'Nightly regression' : 'Smoke', status,
    trigger: ['manual', 'schedule', 'cli', 'api'][i % 4], environmentId: 'env_1', environmentName: i % 5 === 0 ? 'DEVPUB' : 'Simulator',
    startedAt: iso(now - i * DAY * 0.6), finishedAt: i === 0 ? null : iso(now - i * DAY * 0.6 + 42000), durationMs: i === 0 ? null : 38000 + i * 900,
    total, passed: i === 0 ? 4 : total - failed, failed, errors: 0, skipped: 0, coveragePct: 62 + (i % 5) * 3.1,
  };
});

const runDetail = (id) => {
  const run = runs.find((r) => r.id === id) || runs[1];
  const results = tests.map((t, i) => {
    const failed = run.failed && i === 3;
    const steps = stepsFor(failed ? 6 : undefined);
    return {
      id: `res_${run.id}_${i}`, runId: run.id, testId: t.id, testName: t.name, suite: t.suite, iteration: 1,
      dataRow: i === 8 ? { ITEM: 'A-1001', QTY: '12' } : null,
      status: failed ? 'failed' : run.status === 'running' && i > 4 ? 'queued' : 'passed',
      durationMs: steps.reduce((a, s) => a + s.durationMs, 0), error: failed ? steps[6].error : null,
      failedStep: failed ? 6 : null, steps, coverage: { pct: 40 + i * 4, executable: 120, covered: Math.round(1.2 * (40 + i * 4)) },
    };
  });
  return { ...run, results };
};

const days = (n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(now - (n - 1 - i) * DAY).toISOString().slice(0, 10);
  const runsN = 1 + (i % 3);
  const failed = (i * 7) % 5 === 0 ? 2 + (i % 3) : i % 4 === 0 ? 1 : 0;
  const passed = runsN * 9 - failed;
  return { date: d, runs: runsN, passed, failed, passRate: (passed / (passed + failed)) * 100, avgDurationMs: 35000 + (i % 6) * 2500 };
});

const summary = (n) => {
  const trend = days(n);
  return {
    kpis: { totalTests: tests.length, totalRuns: trend.reduce((a, d) => a + d.runs, 0), passRate: 92.4, avgDurationMs: 41200, coveragePct: 71.8, flakyCount: 2, lastRunStatus: 'passed' },
    trend,
    coverageTrend: trend.map((d, i) => ({ date: d.date, pct: 58 + i * (14 / n) + (i % 3) })),
    bySuite: suites.map((s, i) => ({ suite: s, passed: 40 - i * 6, failed: [3, 1, 0, 4][i], tests: tests.filter((t) => t.suite === s).length })),
    topFailing: [
      { testId: 't_4', testName: tests[3].name, failures: 5, lastError: 'Expected field "Status" to equal "ACTIVE" but was "HOLD"' },
      { testId: 't_9', testName: tests[8].name, failures: 3, lastError: 'Timed out after 10000 ms waiting for keyboard unlock' },
      { testId: 't_2', testName: tests[1].name, failures: 1, lastError: 'Text "CPF1120" not found on screen' },
    ],
    flaky: [{ testId: 't_9', testName: tests[8].name, flips: 4 }, { testId: 't_6', testName: tests[5].name, flips: 2 }],
    slowest: tests.slice(0, 5).map((t, i) => ({ testId: t.id, testName: t.name, avgDurationMs: 9000 - i * 1300 })),
    recentRuns: runs.slice(0, 6),
  };
};

const rpg = `**free
ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt);
// ORDINQ - Order inquiry by customer
dcl-f ORDINQD workstn sfile(SFL01:rrn);
dcl-f CUSTMAST keyed usage(*input);
dcl-f ORDHDR keyed usage(*input);
dcl-s rrn packed(4:0);
dcl-s done ind inz(*off);

dow not done;
  exfmt CTL01;
  if *in03 or *in12;
    done = *on;
    iter;
  endif;
  chain (CUSNO) CUSTMAST;
  if not %found(CUSTMAST);
    MSG = 'Customer not found';
    *in40 = *on;
    iter;
  endif;
  NAME = CMNAME;
  STATUS = CMSTAT;
  exsr loadSfl;
enddo;
*inlr = *on;
return;

begsr loadSfl;
  rrn = 0;
  setll (CUSNO) ORDHDR;
  reade (CUSNO) ORDHDR;
  dow not %eof(ORDHDR);
    rrn += 1;
    write SFL01;
    reade (CUSNO) ORDHDR;
  enddo;
  if rrn = 0;
    MSG = 'No orders';
  endif;
endsr;`.split('\n');

const coverageReport = (body = {}) => {
  const ids = body.testIds?.length ? body.testIds : body.resultIds?.length ? body.resultIds : body.runIds?.length ? ['t_3', 't_4'] : ['t_3'];
  const sources = ids.map((id, i) => ({ resultId: `res_${id}`, testName: tests.find((t) => t.id === id)?.name || `Result ${id}`, runId: 'run_99', _i: i }));
  const mkProgram = (program, sourceFile, src, seed, language = 'RPGLE') => {
    const lines = src.map((text, i) => {
      const t = text.trim();
      const executable = !!t && !/^(\*\*free|ctl-opt|dcl-|\/\/|end|begsr|endsr)/i.test(t);
      const coveredBy = executable ? sources.map((s, si) => ((i * (seed + si * 3)) % 7 < 5 - (si === 0 ? 0 : 1) ? si : -1)).filter((x) => x >= 0) : [];
      return { no: i + 1, text, executable, hits: coveredBy.length ? 1 + ((i * 3) % 9) : 0, coveredBy };
    });
    const executable = lines.filter((l) => l.executable).length;
    const covered = lines.filter((l) => l.executable && l.hits > 0).length;
    return { program, library: 'ORDLIB', sourceFile, language, executable, covered, pct: executable ? (covered / executable) * 100 : 0, lines };
  };
  const programs = [
    mkProgram('ORDINQ', 'QRPGLESRC/ORDINQ.rpgle', rpg, 5),
    mkProgram('CUSTVAL', 'QRPGLESRC/CUSTVAL.rpgle', rpg.slice(0, 22), 4),
    mkProgram('ORDINQC', 'QCLLESRC/ORDINQC.clle', ['PGM', '  DCL VAR(&CUST) TYPE(*CHAR) LEN(8)', '  ADDLIBLE LIB(ORDLIB)', '  MONMSG MSGID(CPF2103)', '  CALL PGM(ORDINQ)', 'ENDPGM'], 3, 'CLLE'),
  ];
  const executable = programs.reduce((a, p) => a + p.executable, 0);
  const covered = programs.reduce((a, p) => a + p.covered, 0);
  return { totals: { executable, covered, pct: (covered / executable) * 100 }, sources: sources.map(({ _i, ...s }) => s), programs };
};

let environments = [
  { id: 'env_1', name: 'Simulator', host: '127.0.0.1', port: 2323, deviceName: '', user: 'TESTER', password: '***', coverageAdapter: 'simulator', codecov: { ifsDir: '', sshHost: '', sshUser: '', sshPort: 22 }, variables: { LIB: 'ORDLIB' } },
  { id: 'env_2', name: 'DEVPUB', host: 'devpub.example.com', port: 23, deviceName: 'TPILOT01', user: 'QATEST', password: '***', coverageAdapter: 'codecov', codecov: { ifsDir: '/home/QATEST/cc', sshHost: 'devpub.example.com', sshUser: 'QATEST', sshPort: 22 }, variables: { LIB: 'ORDLIB' } },
];
let schedules = [
  { id: 'sch_1', name: 'Nightly regression', cron: '0 2 * * *', suite: '', tags: ['regression'], testIds: [], environmentId: 'env_1', enabled: true, lastRunAt: iso(now - 11 * 3600000), nextRunAt: iso(now + 13 * 3600000) },
  { id: 'sch_2', name: 'Hourly smoke', cron: '0 * * * 1-5', suite: '', tags: ['smoke'], testIds: [], environmentId: 'env_2', enabled: false, lastRunAt: null, nextRunAt: null },
];

const delay = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 120));

export async function mockRequest(method, url, body) {
  const [path, q] = url.split('?');
  const params = new URLSearchParams(q);
  const seg = path.replace(/^\/api\//, '').split('/');
  if (seg[0] === 'dashboard') return delay(summary(Number(params.get('days') || 30)));
  if (seg[0] === 'tests') {
    if (seg[1] === 'validate') return delay(body?.content?.includes('steps') || body?.type === 'js' ? { ok: true, errors: [] } : { ok: false, errors: ['Line 1: a test needs a "steps" list'] });
    if (method === 'GET' && seg[1]) return delay({ ...(tests.find((t) => t.id === seg[1]) || tests[2]), content: sampleYaml, steps: [] });
    if (method === 'GET') return delay(tests);
    if (method === 'DELETE') return delay({ ok: true });
    return delay({ id: seg[1] || 't_new', ...body, tags: [], updatedAt: iso(Date.now()) });
  }
  if (seg[0] === 'runs') {
    if (method === 'POST') return delay({ runId: runs[1].id });
    if (seg[1]) return delay(runDetail(seg[1]));
    return delay(runs);
  }
  if (seg[0] === 'coverage') {
    if (seg[1] === 'programs') return delay(coverageReport().programs.map(({ lines, covered, pct, ...p }) => p));
    if (seg[1] === 'merge') return delay(coverageReport(body));
    return delay(coverageReport({ resultIds: [seg[2]] }));
  }
  if (seg[0] === 'environments') {
    if (method === 'GET') return delay(environments);
    if (method === 'DELETE') { environments = environments.filter((e) => e.id !== seg[1]); return delay({ ok: true }); }
    if (method === 'POST') { const e = { ...body, id: `env_${Date.now()}` }; environments.push(e); return delay(e); }
    environments = environments.map((e) => (e.id === seg[1] ? { ...e, ...body } : e)); return delay(environments.find((e) => e.id === seg[1]));
  }
  if (seg[0] === 'schedules') {
    if (method === 'GET') return delay(schedules);
    if (method === 'DELETE') { schedules = schedules.filter((e) => e.id !== seg[1]); return delay({ ok: true }); }
    if (method === 'POST') { const e = { ...body, id: `sch_${Date.now()}` }; schedules.push(e); return delay(e); }
    schedules = schedules.map((e) => (e.id === seg[1] ? { ...e, ...body } : e)); return delay(schedules.find((e) => e.id === seg[1]));
  }
  throw new Error(`Mock: no fixture for ${method} ${url}`);
}

// --- fake recorder over the "socket" ---
let recSteps = [];
let recState = 'signon';
const emit = (m) => setTimeout(() => wsEmitLocal(m), 250);
export function mockWsSend(msg) {
  if (msg.type === 'rec.start') {
    recSteps = msg.record === false ? [] : [{ action: 'connect', args: { environment: msg.environmentId } }];
    recState = 'signon';
    emit({ type: 'rec.started', sessionId: 'mock', screen: signon(), steps: recSteps });
  } else if (msg.type === 'rec.input') {
    (msg.fields || []).forEach((f) => recSteps.push({ action: 'fill', args: { row: f.row, col: f.col, value: f.value } }));
    recSteps.push({ action: 'press', args: { key: msg.aid } });
    let screen;
    if (msg.aid === 'F3' || msg.aid === 'F12') { recState = 'signon'; screen = signon(); }
    else if (recState === 'signon') { recState = 'inq'; screen = orderInq(); }
    else {
      const cust = (msg.fields || []).find((f) => f.row === 6)?.value || '10001';
      screen = orderInq(cust, 'ACME SUPPLY CO', 'ACTIVE');
    }
    emit({ type: 'rec.screen', screen, steps: recSteps });
  } else if (msg.type === 'rec.assert') {
    recSteps.push(msg.kind === 'field' ? { action: 'assertField', args: { row: msg.row, col: msg.col, equals: msg.text } } : { action: 'assertText', args: { text: msg.text, row: msg.row, col: msg.col } });
    emit({ type: 'rec.steps', steps: recSteps });
  } else if (msg.type === 'rec.removeStep') {
    recSteps.splice(msg.index, 1);
    emit({ type: 'rec.steps', steps: recSteps });
  } else if (msg.type === 'rec.stop') {
    emit(msg.save ? { type: 'rec.saved', testId: 't_3' } : { type: 'rec.stopped' });
  }
}
