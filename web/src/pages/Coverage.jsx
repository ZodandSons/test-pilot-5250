import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { arr, fmtPct, fmtTime } from '../util.js';
import { Panel, ErrorNote, Loading, Empty, Meter } from '../components/ui.jsx';

function hashParam(name) {
  const q = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(q).get(name);
}

export default function Coverage() {
  const [tests, setTests] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selTests, setSelTests] = useState(new Set());
  const [selRuns, setSelRuns] = useState(new Set());
  const [mode, setMode] = useState('merged'); // merged | single
  const [report, setReport] = useState(null);
  const [program, setProgram] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [onlyMissed, setOnlyMissed] = useState(false);
  const resultParam = hashParam('result');

  useEffect(() => {
    Promise.all([api.tests(), api.runs(30)]).then(([t, r]) => { setTests(arr(t)); setRuns(arr(r)); }).catch(setError);
    if (resultParam) load(() => api.coverageResult(resultParam));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (fn) => {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      setReport(r);
      setProgram((p) => (arr(r?.programs).some((x) => x.program === p) ? p : arr(r?.programs)[0]?.program || null));
    } catch (e) { setError(e); }
    setBusy(false);
  };

  const analyse = () => load(() => api.coverageMerge({ testIds: [...selTests], runIds: [...selRuns] }));

  const toggle = (set, setter, id) => {
    if (mode === 'single') { setSelTests(new Set(set === selTests ? [id] : [])); setSelRuns(new Set(set === selRuns ? [id] : [])); return; }
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n);
  };

  const sources = arr(report?.sources);
  const programs = arr(report?.programs);
  const prog = programs.find((p) => p.program === program);

  // Per-source contribution: lines each source covered, and lines only it covered.
  const contribution = useMemo(() => {
    if (!report) return [];
    const exec = programs.reduce((a, p) => a + (p.executable || 0), 0);
    return sources.map((s, si) => {
      let covered = 0; let unique = 0;
      programs.forEach((p) => arr(p.lines).forEach((l) => {
        if (!l.executable) return;
        const by = arr(l.coveredBy);
        if (by.includes(si)) { covered++; if (by.length === 1) unique++; }
      }));
      return { ...s, covered, unique, pct: exec ? (covered / exec) * 100 : 0 };
    });
  }, [report]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = selTests.size + selRuns.size;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Code coverage</h1>
          <p className="muted">Which RPGLE and CLLE source lines your 5250 tests executed, for one test or several combined.</p>
        </div>
        <div className="seg" role="group" aria-label="Coverage mode">
          <button className={mode === 'single' ? 'on' : ''} onClick={() => { setMode('single'); setSelTests(new Set([...selTests].slice(0, 1))); setSelRuns(new Set()); }}>Single test</button>
          <button className={mode === 'merged' ? 'on' : ''} onClick={() => setMode('merged')}>Merged</button>
        </div>
      </header>
      <ErrorNote error={error} />

      <div className="cov-layout">
        <aside className="cov-pick">
          <Panel title="Tests" pad={false} actions={<span className="muted small">Latest result</span>}>
            <ul className="pick-list">
              {tests.length === 0 && <li className="muted">No tests yet.</li>}
              {tests.map((t) => (
                <li key={t.id}>
                  <label>
                    <input type={mode === 'single' ? 'radio' : 'checkbox'} name="cov-test" checked={selTests.has(t.id)} onChange={() => toggle(selTests, setSelTests, t.id)} />
                    <span>{t.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Panel>
          {mode === 'merged' && (
            <Panel title="Runs" pad={false} actions={<span className="muted small">All results in run</span>}>
              <ul className="pick-list">
                {runs.length === 0 && <li className="muted">No runs yet.</li>}
                {runs.map((r) => (
                  <li key={r.id}>
                    <label>
                      <input type="checkbox" checked={selRuns.has(r.id)} onChange={() => toggle(selRuns, setSelRuns, r.id)} />
                      <span>{r.name || r.id} <span className="muted small">{fmtTime(r.startedAt)}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <button className="btn btn-primary btn-block" disabled={!count || busy} onClick={analyse}>{busy ? 'Calculating…' : mode === 'single' ? 'Show coverage' : `Merge coverage${count ? ` (${count})` : ''}`}</button>
        </aside>

        <div className="cov-main">
          {busy && !report && <Loading what="Calculating coverage" />}
          {!report && !busy && <Panel><Empty>Pick a test{mode === 'merged' ? ', several tests or runs' : ''} to see which lines were executed.</Empty></Panel>}
          {report && (
            <>
              <div className="kpis kpis-4">
                <div className="kpi"><span className="kpi-label">Line coverage</span><span className="kpi-value">{fmtPct(report.totals?.pct)}</span></div>
                <div className="kpi"><span className="kpi-label">Lines covered</span><span className="kpi-value">{report.totals?.covered ?? 0} / {report.totals?.executable ?? 0}</span></div>
                <div className="kpi"><span className="kpi-label">Programs</span><span className="kpi-value">{programs.length}</span></div>
                <div className="kpi"><span className="kpi-label">Test results included</span><span className="kpi-value">{sources.length}</span></div>
              </div>

              <div className="grid-2">
                <Panel title="Programs" pad={false}>
                  {programs.length === 0 ? <Empty>No coverage data in these results. Check the environment's coverage setting.</Empty> : (
                    <table className="table">
                      <thead><tr><th>Program</th><th>Source</th><th className="num">Covered</th><th>Coverage</th></tr></thead>
                      <tbody>
                        {programs.map((p) => (
                          <tr key={p.program} className={p.program === program ? 'sel clickable' : 'clickable'} onClick={() => setProgram(p.program)}>
                            <td><button className="linklike" onClick={() => setProgram(p.program)}>{p.library ? `${p.library}/` : ''}{p.program}</button> <span className="tag">{p.language}</span></td>
                            <td className="muted mono small">{p.sourceFile}</td>
                            <td className="num">{p.covered}/{p.executable}</td>
                            <td><div className="pct-cell"><Meter pct={p.pct} /><span className="num">{fmtPct(p.pct)}</span></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
                <Panel title="Contribution by test" pad={false}>
                  {contribution.length === 0 ? <Empty>No test results included.</Empty> : (
                    <table className="table">
                      <thead><tr><th>Test result</th><th className="num">Lines</th><th className="num">Only this test</th><th>Coverage alone</th></tr></thead>
                      <tbody>
                        {contribution.map((c) => (
                          <tr key={c.resultId}>
                            <td style={{ minWidth: 220 }}>{c.testName}</td>
                            <td className="num">{c.covered}</td>
                            <td className="num">{c.unique}</td>
                            <td><div className="pct-cell"><Meter pct={c.pct} /><span className="num">{fmtPct(c.pct)}</span></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              </div>

              {prog && (
                <Panel title={`${prog.sourceFile || prog.program}`} pad={false} actions={(
                  <>
                    <span className="legend">
                      <span><span className="swatch" style={{ background: 'var(--good)' }} />Executed</span>
                      <span><span className="swatch" style={{ background: 'var(--critical)' }} />Not executed</span>
                    </span>
                    <label className="check small"><input type="checkbox" checked={onlyMissed} onChange={(e) => setOnlyMissed(e.target.checked)} />Only lines not executed</label>
                  </>
                )}>
                  <SourceView program={prog} sources={sources} onlyMissed={onlyMissed} />
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceView({ program, sources, onlyMissed }) {
  const lines = arr(program.lines).filter((l) => !onlyMissed || (l.executable && !l.hits));
  if (!lines.length) return <Empty>{onlyMissed ? 'Every executable line ran.' : 'No source lines available for this program.'}</Empty>;
  return (
    <div className="source" role="table" aria-label={`Source of ${program.program}`}>
      {lines.map((l) => {
        const state = !l.executable ? 'plain' : l.hits > 0 ? 'hit' : 'miss';
        const by = arr(l.coveredBy).map((i) => sources[i]?.testName).filter(Boolean);
        return (
          <div key={l.no} className={`src-line src-${state}`} role="row" title={state === 'hit' ? `Executed ${l.hits}×${by.length ? ` by: ${by.join(', ')}` : ''}` : state === 'miss' ? 'Not executed by the selected tests' : undefined}>
            <span className="src-no" role="cell">{l.no}</span>
            <span className="src-hits" role="cell">{l.executable ? (l.hits > 0 ? `${l.hits}×` : '0') : ''}</span>
            <span className="src-text" role="cell">{l.text || ' '}</span>
            {by.length > 0 && <span className="src-by" role="cell">{by.length === sources.length && sources.length > 1 ? 'all' : by.length}</span>}
          </div>
        );
      })}
    </div>
  );
}
