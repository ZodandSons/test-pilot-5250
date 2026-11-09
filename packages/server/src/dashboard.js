/** Aggregations for GET /api/dashboard/summary. */
export function dashboardSummary(store, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const runs = store.all("SELECT * FROM runs WHERE started_at >= ? AND status NOT IN ('queued','running') ORDER BY started_at", since).map((r) => store.runFromRow(r));
  const results = store.all("SELECT id, run_id, test_id, test_name, suite, iteration, status, duration_ms, error, started_at, flaky FROM results WHERE started_at >= ? AND status NOT IN ('queued','running') ORDER BY started_at", since);
  const tests = store.listTests();
  const day = (iso) => iso.slice(0, 10);
  const r1 = (n) => Math.round(n * 10) / 10;

  // trend per day (fill gaps)
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = day(new Date(Date.now() - i * 86400000).toISOString());
    byDay.set(d, { date: d, runs: 0, passed: 0, failed: 0, durations: [], cov: [] });
  }
  for (const r of runs) {
    const b = byDay.get(day(r.startedAt)); if (!b) continue;
    b.runs++; b.durations.push(r.durationMs || 0);
    if (r.coveragePct != null) b.cov.push(r.coveragePct);
  }
  for (const r of results) {
    const b = byDay.get(day(r.started_at)); if (!b) continue;
    if (r.status === 'passed') b.passed++; else b.failed++;
  }
  const trend = [...byDay.values()].map((b) => ({
    date: b.date, runs: b.runs, passed: b.passed, failed: b.failed,
    passRate: b.passed + b.failed ? r1((b.passed / (b.passed + b.failed)) * 100) : null,
    avgDurationMs: b.durations.length ? Math.round(b.durations.reduce((a, x) => a + x, 0) / b.durations.length) : null,
  }));
  const coverageTrend = [...byDay.values()].filter((b) => b.cov.length).map((b) => ({ date: b.date, pct: b.cov[b.cov.length - 1] }));

  // suites
  const suites = new Map();
  for (const r of results) {
    const s = suites.get(r.suite) || { suite: r.suite, passed: 0, failed: 0, tests: new Set() };
    if (r.status === 'passed') s.passed++; else s.failed++;
    s.tests.add(r.test_id); suites.set(r.suite, s);
  }
  const bySuite = [...suites.values()].map((s) => ({ suite: s.suite, passed: s.passed, failed: s.failed, tests: s.tests.size })).sort((a, b) => a.suite.localeCompare(b.suite));

  // per test stats
  const perTest = new Map();
  for (const r of results) {
    const key = r.test_id;
    const t = perTest.get(key) || { testId: r.test_id, testName: r.test_name, failures: 0, lastError: null, seq: new Map(), durations: [], retriedPass: 0 };
    if (r.status !== 'passed') { t.failures++; t.lastError = r.error; }
    t.durations.push(r.duration_ms || 0);
    if (r.flaky) t.retriedPass++;
    const k = r.iteration;
    if (!t.seq.has(k)) t.seq.set(k, []);
    t.seq.get(k).push(r.status === 'passed');
    perTest.set(key, t);
  }
  const all = [...perTest.values()].map((t) => {
    let flips = 0;
    for (const s of t.seq.values()) for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) flips++;
    return { ...t, flips: flips + t.retriedPass, avgDurationMs: Math.round(t.durations.reduce((a, x) => a + x, 0) / t.durations.length) };
  });
  const topFailing = all.filter((t) => t.failures).sort((a, b) => b.failures - a.failures).slice(0, 8).map(({ testId, testName, failures, lastError }) => ({ testId, testName, failures, lastError }));
  const flakyList = all.filter((t) => t.flips >= 2 || t.retriedPass).sort((a, b) => b.flips - a.flips).slice(0, 8).map(({ testId, testName, flips }) => ({ testId, testName, flips }));
  const slowest = [...all].sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 8).map(({ testId, testName, avgDurationMs }) => ({ testId, testName, avgDurationMs }));

  const passed = results.filter((r) => r.status === 'passed').length;
  const lastCov = [...runs].reverse().find((r) => r.coveragePct != null);
  return {
    kpis: {
      totalTests: tests.length,
      totalRuns: runs.length,
      passRate: results.length ? r1((passed / results.length) * 100) : null,
      avgDurationMs: runs.length ? Math.round(runs.reduce((a, r) => a + (r.durationMs || 0), 0) / runs.length) : null,
      coveragePct: lastCov ? lastCov.coveragePct : null,
      flakyCount: flakyList.length,
      lastRunStatus: runs.length ? runs[runs.length - 1].status : null,
    },
    trend, coverageTrend, bySuite, topFailing, flaky: flakyList, slowest,
    recentRuns: store.listRuns(10),
  };
}
