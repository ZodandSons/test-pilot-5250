import { useState } from 'react';
import { api, useLoad } from '../api.js';
import { useWsMessages } from '../ws.js';
import { arr, fmtDuration, fmtPct, fmtTime } from '../util.js';
import { Link } from '../router.jsx';
import { Panel, StatusBadge, ErrorNote, Loading, Empty } from '../components/ui.jsx';
import Terminal from '../components/Terminal.jsx';
import { RunsTable, ResultCounts } from './Dashboard.jsx';

export function Runs() {
  const { data, error, loading, reload, setData } = useLoad(() => api.runs(100), []);
  useWsMessages((m) => {
    if (m.type !== 'run.update' || !m.run) return;
    setData((list) => {
      const l = arr(list);
      const i = l.findIndex((r) => r.id === m.run.id);
      if (i < 0) return [m.run, ...l];
      const n = [...l]; n[i] = { ...n[i], ...m.run }; return n;
    });
  }, []);
  const [status, setStatus] = useState('');
  const runs = arr(data).filter((r) => !status || r.status === status);
  const del = async (r) => {
    if (!window.confirm(`Delete run "${r.name || r.id}" and its results?`)) return;
    await api.deleteRun(r.id).catch(() => {});
    reload();
  };
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Runs</h1>
          <p className="muted">Every execution, with step-level results and screen snapshots.</p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {['running', 'passed', 'failed', 'error', 'queued'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
      </header>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data && <Loading what="Loading runs" />}
      {data && <Panel pad={false}><RunsTable runs={runs} onDelete={del} /></Panel>}
    </div>
  );
}

export function RunDetail({ id }) {
  const { data: run, error, loading, reload, setData } = useLoad(() => api.run(id), [id]);
  const [openResult, setOpenResult] = useState(null);
  const [stepSel, setStepSel] = useState(null);

  useWsMessages((m) => {
    if (m.runId !== id && m.run?.id !== id) return;
    if (m.type === 'run.update') {
      setData((r) => (r ? { ...r, ...m.run, results: r.results } : r));
      if (['passed', 'failed', 'error'].includes(m.run.status)) reload();
    } else if (m.type === 'result.update') {
      setData((r) => {
        if (!r) return r;
        const results = arr(r.results);
        const i = results.findIndex((x) => x.id === m.result.id);
        const merged = i >= 0 ? { ...results[i], ...m.result, steps: m.result.steps || results[i].steps } : m.result;
        const n = [...results]; if (i >= 0) n[i] = merged; else n.push(merged);
        return { ...r, results: n };
      });
    } else if (m.type === 'step') {
      setData((r) => {
        if (!r) return r;
        return { ...r, results: arr(r.results).map((x) => (x.id === m.resultId ? { ...x, steps: [...arr(x.steps).filter((s) => s.index !== m.step.index), m.step].sort((a, b) => a.index - b.index) } : x)) };
      });
    }
  }, [id]);

  if (loading && !run) return <div className="page"><Loading what="Loading run" /></div>;
  if (!run) return <div className="page"><ErrorNote error={error || new Error('Run not found')} onRetry={reload} /></div>;

  const results = arr(run.results);
  const active = results.find((r) => r.id === openResult) || results.find((r) => r.status === 'failed' || r.status === 'error') || results[0];
  const steps = arr(active?.steps);
  const step = steps.find((s) => s.index === stepSel) ?? steps.find((s) => s.status === 'failed') ?? steps[steps.length - 1];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="crumb"><Link to="/runs">Runs</Link></p>
          <h1>{run.name || run.id} <StatusBadge status={run.status} /></h1>
          <p className="muted">Ran on {run.environmentName || run.environmentId}, started {fmtTime(run.startedAt)} ({run.trigger || 'manual'})</p>
        </div>
        <div className="row-gap">
          <a className="btn" href={api.reportUrl(run.id, 'html')} target="_blank" rel="noreferrer">HTML report</a>
          <a className="btn" href={api.reportUrl(run.id, 'junit')} download>JUnit XML</a>
          <a className="btn" href={api.reportUrl(run.id, 'json')} download>JSON</a>
        </div>
      </header>

      <div className="kpis kpis-4">
        <div className="kpi"><span className="kpi-label">Results</span><span className="kpi-value small"><ResultCounts r={run} /></span></div>
        <div className="kpi"><span className="kpi-label">Duration</span><span className="kpi-value">{fmtDuration(run.durationMs)}</span></div>
        <div className="kpi"><span className="kpi-label">Coverage</span><span className="kpi-value">{fmtPct(run.coveragePct)}</span></div>
        <div className="kpi"><span className="kpi-label">Test cases</span><span className="kpi-value">{run.total ?? results.length}</span></div>
      </div>

      <div className="run-layout">
        <Panel title="Test results" pad={false} className="results-panel">
          {results.length === 0 ? <Empty>Waiting for the first result…</Empty> : (
            <ul className="result-list">
              {results.map((r) => (
                <li key={r.id} className={active?.id === r.id ? 'on' : ''}>
                  <button onClick={() => { setOpenResult(r.id); setStepSel(null); }}>
                    <StatusBadge status={r.status} />
                    <span className="result-name">{r.testName}{r.iteration > 1 || r.dataRow ? <span className="muted"> #{r.iteration}</span> : null}</span>
                    <span className="muted num">{fmtDuration(r.durationMs)}</span>
                  </button>
                  {active?.id === r.id && r.dataRow && (
                    <div className="data-row">{Object.entries(r.dataRow).map(([k, v]) => <span key={k}><b>{k}</b> {String(v)}</span>)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {active && (
          <div className="run-detail-main">
            <Panel title={active.testName} actions={active.coverage ? <span className="muted small">Coverage {fmtPct(active.coverage.pct)} ({active.coverage.covered}/{active.coverage.executable} lines) <Link to={`/coverage?result=${active.id}`}>View lines</Link></span> : null}>
              {active.error && <div className="error-note"><span>{active.error}</span></div>}
              <ol className="timeline">
                {steps.map((s) => (
                  <li key={s.index} className={`tl-${s.status} ${step?.index === s.index ? 'on' : ''}`}>
                    <button onClick={() => setStepSel(s.index)}>
                      <span className="tl-dot" aria-hidden="true" />
                      <span className="tl-text">{s.description || s.action}</span>
                      <span className="muted num">{fmtDuration(s.durationMs)}</span>
                    </button>
                  </li>
                ))}
                {steps.length === 0 && <li className="muted">No steps recorded yet.</li>}
              </ol>
            </Panel>
            {step && (
              <Panel title={`Screen after step ${step.index + 1}`} actions={<StatusBadge status={step.status} />}>
                {step.error && (
                  <div className="error-note step-err">
                    <span>{step.error}</span>
                    {step.expected !== undefined && step.expected !== null && <span>Expected: <code>{String(step.expected)}</code></span>}
                  </div>
                )}
                {step.screen ? <Terminal screen={step.screen} /> : <Empty>No screen captured for this step.</Empty>}
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
