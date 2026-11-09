#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { discoverTests, loadTestFile, validateTest } from './script.js';
import { runSuite, newId } from './runner.js';
import { mergeCoverage } from './coverage.js';
import { htmlReport, junitReport, jsonReport } from './reports.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = { _: [] };
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--no-')) opts[a.slice(5)] = false;
  else if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; opts[k] = v; }
  else opts._.push(a);
}

const C = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };

function usage() {
  console.log(`TestPilot 5250 CLI

  tp5250 run <files|dirs...> [options]   Run YAML/JS test cases
      --env <file.json>        Environment (host, port, user, password, coverageAdapter...)
      --host/--port/--user/--password   Override environment values
      --tags smoke,orders      Only tests having any of these tags
      --suite <name>           Only tests in suite
      --grep <text>            Only tests whose name contains text
      --concurrency <n>        Parallel sessions (default 2)
      --retries <n>            Retry failed tests n times (flaky detection)
      --no-coverage            Disable code coverage collection
      --report <dir>           Write report.html, junit.xml, report.json
      --server <url>           Publish results to a TestPilot server dashboard
  tp5250 validate <files|dirs...>        Validate test scripts
`);
}

function loadEnv() {
  let env = {};
  if (opts.env) {
    const raw = fs.readFileSync(opts.env, 'utf8').replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
    env = JSON.parse(raw);
  }
  for (const k of ['host', 'port', 'user', 'password', 'coverageAdapter']) if (opts[k] != null && opts[k] !== true) env[k] = opts[k];
  env.host ||= process.env.TP_HOST || '127.0.0.1';
  env.port ||= Number(process.env.TP_PORT || 23);
  env.user ||= process.env.TP_USER;
  env.password ||= process.env.TP_PASSWORD;
  env.name ||= `${env.host}:${env.port}`;
  return env;
}

async function main() {
  if (!cmd || cmd === 'help' || opts.help) return usage();
  const files = discoverTests(opts._.length ? opts._ : ['tests']);

  if (cmd === 'validate') {
    let bad = 0;
    for (const f of files) {
      const r = await validateTest(f.type, f.type === 'js' ? fs.readFileSync(f.file, 'utf8') : fs.readFileSync(f.file, 'utf8'));
      console.log(`${r.ok ? C.g('✓') : C.r('✗')} ${f.file}`);
      if (!r.ok) { bad++; r.errors.forEach((e) => console.log(`    ${C.r(e)}`)); }
    }
    process.exit(bad ? 1 : 0);
  }

  if (cmd !== 'run') return usage();
  const env = loadEnv();
  let tests = [];
  for (const f of files) {
    try { tests.push(await loadTestFile(f)); } catch (e) { console.error(C.r(`✗ ${f.file}: ${e.message}`)); process.exitCode = 2; }
  }
  const tags = opts.tags ? String(opts.tags).split(',') : null;
  if (tags) tests = tests.filter((t) => t.tags.some((x) => tags.includes(x)));
  if (opts.suite) tests = tests.filter((t) => t.suite === opts.suite);
  if (opts.grep) tests = tests.filter((t) => t.name.toLowerCase().includes(String(opts.grep).toLowerCase()));
  if (!tests.length) { console.log(C.y('No tests selected.')); process.exit(process.exitCode || 0); }

  console.log(C.b(`\nTestPilot 5250 · ${tests.length} test case(s) · ${env.name}\n`));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const { results, summary } = await runSuite(tests, {
    env, concurrency: Number(opts.concurrency || 2), retries: Number(opts.retries || 0), coverage: opts.coverage !== false,
    hooks: {
      onResult: (r) => {
        const icon = r.status === 'passed' ? C.g('✓') : r.status === 'failed' ? C.r('✗') : C.y('!');
        const extra = [r.dataRow ? `[${Object.values(r.dataRow).join(', ')}]` : '', `${r.durationMs}ms`, r.coverage ? `cov ${r.coverage.pct}%` : '', r.attempts > 1 ? `attempt ${r.attempts}` : ''].filter(Boolean).join(' · ');
        console.log(`${icon} ${r.suite} › ${r.testName} ${C.d(extra)}`);
        if (r.status !== 'passed') {
          const s = r.steps[r.failedStep];
          console.log(C.r(`    step ${s ? s.index + 1 : '?'}: ${s?.description ?? ''}\n    ${r.error}`));
          if (s?.screen) console.log(C.d(s.screen.text.filter((l) => l.trim()).map((l) => '    │' + l).join('\n')));
        }
      },
    },
  });

  const covInputs = results.filter((r) => r.coverageData).map((r, i) => ({ source: { resultId: `r${i}`, testName: r.testName, runId: '' }, data: r.coverageData }));
  const coverage = covInputs.length ? mergeCoverage(covInputs) : null;
  const status = summary.failed || summary.errors ? 'failed' : 'passed';
  const run = {
    id: newId('run'), name: opts.name || `CLI run ${startedAt}`, status, trigger: 'cli', environmentName: env.name,
    startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, ...summary,
    coveragePct: coverage ? coverage.totals.pct : null,
    results: results.map(({ coverageData, ...r }) => r),
  };

  console.log(`\n${C.b('Summary')}: ${C.g(summary.passed + ' passed')}, ${summary.failed ? C.r(summary.failed + ' failed') : '0 failed'}, ${summary.errors ? C.y(summary.errors + ' errors') : '0 errors'} in ${(run.durationMs / 1000).toFixed(1)}s`);
  if (coverage) {
    console.log(`${C.b('Coverage')}: ${coverage.totals.covered}/${coverage.totals.executable} lines (${coverage.totals.pct}%)`);
    for (const p of coverage.programs) console.log(`   ${p.program.padEnd(10)} ${String(p.pct).padStart(5)}%  ${p.covered}/${p.executable}`);
  }

  if (opts.report) {
    fs.mkdirSync(opts.report, { recursive: true });
    fs.writeFileSync(path.join(opts.report, 'report.html'), htmlReport(run, coverage));
    fs.writeFileSync(path.join(opts.report, 'junit.xml'), junitReport(run));
    fs.writeFileSync(path.join(opts.report, 'report.json'), jsonReport(run, coverage));
    console.log(C.d(`Reports written to ${opts.report}/`));
  }
  if (opts.server) {
    try {
      const r = await fetch(`${String(opts.server).replace(/\/$/, '')}/api/runs/import`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ run, coverage: results.map((r) => r.coverageData || null) }),
      });
      console.log(r.ok ? C.d(`Published to ${opts.server} (run ${(await r.json()).runId})`) : C.y(`Publish failed: HTTP ${r.status}`));
    } catch (e) { console.log(C.y(`Publish failed: ${e.message}`)); }
  }
  process.exit(status === 'passed' ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
