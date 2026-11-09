import { useState } from 'react';
import { api, useLoad } from '../api.js';
import { useWsMessages } from '../ws.js';
import { arr, fmtDuration, fmtPct, fmtTime } from '../util.js';
import { Link } from '../router.jsx';
import { Panel, StatusBadge, ErrorNote, Loading, Empty } from '../components/ui.jsx';
import { StackedBars, LineChart, HStackedBars, Legend } from '../components/charts.jsx';

const PASS_FAIL = [
  { key: 'passed', label: 'Passed', color: 'var(--good)' },
  { key: 'failed', label: 'Failed', color: 'var(--critical)' },
];

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad(() => api.summary(days), [days]);
  useWsMessages((m) => { if (m.type === 'run.update' && ['passed', 'failed', 'error'].includes(m.run?.status)) reload(); }, [reload]);

  const k = data?.kpis || {};
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Testing overview</h1>
          <p className="muted">Results across every 5250 test run in the last {days} days.</p>
        </div>
        <div className="seg" role="group" aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <button key={d} className={d === days ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>
          ))}
        </div>
      </header>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data && <Loading what="Loading dashboard" />}
      {data && (
        <>
          <div className="kpis">
            <Kpi label="Pass rate" value={fmtPct(k.passRate)} tone={k.passRate >= 90 ? 'good' : k.passRate >= 75 ? 'warning' : 'critical'} />
            <Kpi label="Runs" value={k.totalRuns ?? 0} />
            <Kpi label="Test cases" value={k.totalTests ?? 0} />
            <Kpi label="Avg run time" value={fmtDuration(k.avgDurationMs)} />
            <Kpi label="Code coverage" value={fmtPct(k.coveragePct)} />
            <Kpi label="Flaky tests" value={k.flakyCount ?? 0} tone={k.flakyCount ? 'warning' : undefined} />
          </div>

          <div className="grid-2">
            <Panel title="Test results per day" actions={<Legend series={PASS_FAIL} />}>
              <StackedBars data={arr(data.trend)} xKey="date" series={PASS_FAIL} />
            </Panel>
            <Panel title="Pass rate">
              <LineChart data={arr(data.trend)} xKey="date" yKey="passRate" yDomain={[0, 100]} yFormat={(v) => `${Math.round(v)}%`} />
            </Panel>
          </div>

          <div className="grid-3">
            <Panel title="Code coverage">
              <LineChart data={arr(data.coverageTrend)} xKey="date" yKey="pct" yDomain={[0, 100]} yFormat={(v) => `${Math.round(v)}%`} height={180} />
            </Panel>
            <Panel title="Results by suite" actions={<Legend series={PASS_FAIL} />}>
              <HStackedBars data={arr(data.bySuite)} labelKey="suite" series={PASS_FAIL} />
            </Panel>
            <Panel title="Slowest tests">
              <RankList rows={arr(data.slowest)} value={(r) => fmtDuration(r.avgDurationMs)} empty="No timing data yet." />
            </Panel>
          </div>

          <div className="grid-2">
            <Panel title="Most frequent failures">
              {arr(data.topFailing).length === 0 ? <Empty>No failures in this period.</Empty> : (
                <ul className="fail-list">
                  {arr(data.topFailing).map((f) => (
                    <li key={f.testId}>
                      <div className="fail-top">
                        <Link to={`/tests/${f.testId}`}>{f.testName}</Link>
                        <span className="count">{f.failures} {f.failures === 1 ? 'failure' : 'failures'}</span>
                      </div>
                      {f.lastError && <code className="fail-err">{f.lastError}</code>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Flaky tests" actions={<span className="muted small">Status changed between consecutive runs</span>}>
              <RankList rows={arr(data.flaky)} value={(r) => `${r.flips} flips`} empty="No flaky tests detected." />
            </Panel>
          </div>

          <Panel title="Recent runs" actions={<Link to="/runs" className="btn btn-small">All runs</Link>} pad={false}>
            <RunsTable runs={arr(data.recentRuns)} />
          </Panel>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
    </div>
  );
}

function RankList({ rows, value, empty }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ol className="rank">
      {rows.map((r) => (
        <li key={r.testId}><Link to={`/tests/${r.testId}`}>{r.testName}</Link><span>{value(r)}</span></li>
      ))}
    </ol>
  );
}

export function RunsTable({ runs, onDelete }) {
  if (!runs.length) return <Empty>No runs yet. Start one from Test cases.</Empty>;
  return (
    <table className="table">
      <thead>
        <tr><th>Run</th><th>Status</th><th>Results</th><th>Coverage</th><th>Environment</th><th>Trigger</th><th>Started</th><th className="num">Duration</th>{onDelete && <th />}</tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td><Link to={`/runs/${r.id}`}>{r.name || r.id}</Link></td>
            <td><StatusBadge status={r.status} /></td>
            <td><ResultCounts r={r} /></td>
            <td className="num">{fmtPct(r.coveragePct)}</td>
            <td>{r.environmentName || r.environmentId || '—'}</td>
            <td className="muted">{r.trigger || '—'}</td>
            <td className="muted">{fmtTime(r.startedAt)}</td>
            <td className="num">{fmtDuration(r.durationMs)}</td>
            {onDelete && <td><button className="icon-btn" aria-label={`Delete run ${r.name || r.id}`} onClick={() => onDelete(r)}>×</button></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ResultCounts({ r }) {
  const total = r.total || 0;
  const seg = (n, c) => (n ? <span style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: c }} /> : null);
  return (
    <span className="counts">
      <span className="mini-stack" aria-hidden="true">
        {seg(r.passed, 'var(--good)')}{seg(r.failed, 'var(--critical)')}{seg(r.errors, 'var(--warning)')}{seg(r.skipped, 'var(--muted)')}
      </span>
      <span className="counts-text">{r.passed ?? 0}/{total} passed{r.failed ? `, ${r.failed} failed` : ''}{r.errors ? `, ${r.errors} errors` : ''}</span>
    </span>
  );
}
