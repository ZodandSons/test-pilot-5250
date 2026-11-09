const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xmlEsc = (s) => esc(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const fmtMs = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/** JUnit XML (Jenkins, GitHub Actions, Azure DevOps, GitLab). */
export function junitReport(run) {
  const bySuite = new Map();
  for (const r of run.results) { if (!bySuite.has(r.suite)) bySuite.set(r.suite, []); bySuite.get(r.suite).push(r); }
  const suites = [...bySuite.entries()].map(([suite, rs]) => {
    const cases = rs.map((r) => {
      const name = r.dataRow ? `${r.testName} [${r.iteration}]` : r.testName;
      const steps = (r.steps || []).map((s) => `${s.status === 'failed' ? '✗' : '✓'} ${s.index + 1}. ${s.description}${s.error ? ` — ${s.error}` : ''}`).join('\n');
      const failedScreen = r.failedStep != null ? (r.steps[r.failedStep]?.screen?.text || []).join('\n') : '';
      let body = '';
      if (r.status === 'failed') body = `<failure message="${xmlEsc(r.error)}" type="AssertionError">${xmlEsc(`${steps}\n\nScreen at failure:\n${failedScreen}`)}</failure>`;
      else if (r.status === 'error') body = `<error message="${xmlEsc(r.error)}">${xmlEsc(steps)}</error>`;
      const cov = r.coverage ? `<properties><property name="coverage.pct" value="${r.coverage.pct}"/></properties>` : '';
      return `    <testcase classname="${xmlEsc(suite)}" name="${xmlEsc(name)}" time="${(r.durationMs / 1000).toFixed(3)}">${cov}${body}<system-out>${xmlEsc(steps)}</system-out></testcase>`;
    }).join('\n');
    const f = rs.filter((r) => r.status === 'failed').length, e = rs.filter((r) => r.status === 'error').length;
    const t = rs.reduce((a, r) => a + r.durationMs, 0) / 1000;
    return `  <testsuite name="${xmlEsc(suite)}" tests="${rs.length}" failures="${f}" errors="${e}" skipped="0" time="${t.toFixed(3)}" timestamp="${run.startedAt}">\n${cases}\n  </testsuite>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xmlEsc(run.name)}" tests="${run.total}" failures="${run.failed}" errors="${run.errors}" time="${((run.durationMs || 0) / 1000).toFixed(3)}">\n${suites}\n</testsuites>\n`;
}

export function jsonReport(run, coverage = null) {
  return JSON.stringify({ ...run, coverage: coverage && { totals: coverage.totals, programs: coverage.programs.map(({ lines, ...p }) => p) } }, null, 2);
}

function screenHtml(screen) {
  if (!screen?.text) return '';
  return `<pre class="scr">${screen.text.map(esc).join('\n')}</pre>`;
}

/** Self-contained HTML report. */
export function htmlReport(run, coverage = null) {
  const passRate = run.total ? Math.round((run.passed / run.total) * 1000) / 10 : 0;
  const rows = run.results.map((r, i) => {
    const steps = (r.steps || []).map((s) => `
      <tr class="${s.status}"><td>${s.index + 1}</td><td>${esc(s.description)}</td><td><span class="b ${s.status}">${s.status}</span></td><td>${fmtMs(s.durationMs)}</td>
      <td>${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}${s.status === 'failed' ? screenHtml(s.screen) : ''}</td></tr>`).join('');
    return `<details class="res ${r.status}" ${r.status !== 'passed' ? 'open' : ''}>
      <summary><span class="b ${r.status}">${r.status}</span> <b>${esc(r.testName)}</b>${r.dataRow ? ` <span class="muted">[${esc(JSON.stringify(r.dataRow))}]</span>` : ''}
        <span class="muted">· ${esc(r.suite)} · ${fmtMs(r.durationMs)}${r.coverage ? ` · coverage ${r.coverage.pct}%` : ''}${r.attempts > 1 ? ` · attempts ${r.attempts}` : ''}</span></summary>
      ${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}
      <table class="steps"><thead><tr><th>#</th><th>Step</th><th>Status</th><th>Time</th><th>Detail</th></tr></thead><tbody>${steps}</tbody></table>
    </details>`;
  }).join('\n');
  const covHtml = coverage ? `
    <h2>Code coverage <span class="muted">${coverage.totals.covered}/${coverage.totals.executable} lines · ${coverage.totals.pct}%</span></h2>
    <table class="cov"><thead><tr><th>Program</th><th>Source</th><th>Covered</th><th>%</th><th></th></tr></thead><tbody>
    ${coverage.programs.map((p) => `<tr><td><b>${esc(p.program)}</b></td><td class="muted">${esc(p.library)}/${esc(p.sourceFile)}</td><td>${p.covered}/${p.executable}</td><td>${p.pct}%</td>
      <td><div class="bar"><i style="width:${p.pct}%"></i></div></td></tr>`).join('')}
    </tbody></table>
    ${coverage.programs.map((p) => `<details><summary>${esc(p.program)} source</summary><pre class="src">${p.lines.map((l) =>
      `<span class="${l.executable ? (l.hits ? 'hit' : 'miss') : ''}">${String(l.no).padStart(4)} ${l.executable ? (l.hits ? String(l.hits).padStart(3) : '  0') : '   '}  ${esc(l.text)}</span>`).join('\n')}</pre></details>`).join('')}` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(run.name)} – TestPilot 5250 report</title>
<style>
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f6f7f9;color:#1d2433}
header{background:#0f1720;color:#e6edf3;padding:20px 32px}header h1{margin:0;font-size:20px}header .muted{color:#9aa7b4}
main{padding:24px 32px;max-width:1200px}
.kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}.kpi{background:#fff;border:1px solid #e3e7ec;border-radius:8px;padding:12px 16px;min-width:120px}
.kpi b{display:block;font-size:22px}.muted{color:#6b7684;font-weight:normal}
.b{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;text-transform:uppercase}
.b.passed{background:#dcf5e3;color:#16632f}.b.failed{background:#fde2e1;color:#a4161a}.b.error{background:#fff1d6;color:#8a5300}
details.res{background:#fff;border:1px solid #e3e7ec;border-left:4px solid #2da44e;border-radius:6px;margin:8px 0;padding:8px 12px}
details.res.failed{border-left-color:#cf222e}details.res.error{border-left-color:#d4a72c}
summary{cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #eef1f4;vertical-align:top}
tr.failed td{background:#fff6f6}.err{color:#a4161a;font-weight:600;margin:4px 0}
pre.scr{background:#000;color:#3fdc5a;padding:8px;font:12px/1.25 "IBM Plex Mono",Consolas,monospace;overflow:auto;border-radius:4px;margin:6px 0}
pre.src{background:#fff;border:1px solid #e3e7ec;font:12px/1.4 Consolas,monospace;padding:8px;overflow:auto}
pre.src .hit{background:#dcf5e3;display:block}pre.src .miss{background:#fde2e1;display:block}
.bar{width:160px;height:8px;background:#fde2e1;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:#2da44e}
</style></head><body>
<header><h1>${esc(run.name)}</h1><div class="muted">Run ${esc(run.id)} · ${esc(run.environmentName || '')} · ${esc(run.startedAt)} · ${fmtMs(run.durationMs || 0)}</div></header>
<main>
<div class="kpis">
  <div class="kpi"><span class="muted">Status</span><b><span class="b ${run.status}">${run.status}</span></b></div>
  <div class="kpi"><span class="muted">Pass rate</span><b>${passRate}%</b></div>
  <div class="kpi"><span class="muted">Passed</span><b>${run.passed}</b></div>
  <div class="kpi"><span class="muted">Failed</span><b>${run.failed}</b></div>
  <div class="kpi"><span class="muted">Errors</span><b>${run.errors}</b></div>
  ${run.coveragePct != null ? `<div class="kpi"><span class="muted">Coverage</span><b>${run.coveragePct}%</b></div>` : ''}
</div>
<h2>Results</h2>
${rows}
${covHtml}
<p class="muted">Generated by TestPilot 5250 on ${new Date().toISOString()}</p>
</main></body></html>`;
}
