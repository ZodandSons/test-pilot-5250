import { useMemo, useState } from 'react';
import { api, useLoad } from '../api.js';
import { useWsMessages } from '../ws.js';
import { arr, fmtAgo } from '../util.js';
import { Link, navigate } from '../router.jsx';
import { Panel, StatusBadge, ErrorNote, Loading, Empty } from '../components/ui.jsx';
import RunDialog from '../components/RunDialog.jsx';

export default function Tests() {
  const { data, error, loading, reload } = useLoad(() => api.tests(), []);
  useWsMessages((m) => { if (m.type === 'run.update' && ['passed', 'failed', 'error'].includes(m.run?.status)) reload(); }, [reload]);
  const tests = arr(data);
  const [q, setQ] = useState('');
  const [suite, setSuite] = useState('');
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [runSel, setRunSel] = useState(null);

  const suites = useMemo(() => [...new Set(tests.map((t) => t.suite).filter(Boolean))].sort(), [tests]);
  const tags = useMemo(() => [...new Set(tests.flatMap((t) => arr(t.tags)))].sort(), [tests]);
  const shown = tests.filter((t) =>
    (!suite || t.suite === suite) && (!tag || arr(t.tags).includes(tag)) &&
    (!q || `${t.name} ${t.description || ''}`.toLowerCase().includes(q.toLowerCase())));

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = shown.length > 0 && shown.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(shown.map((t) => t.id)));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Test cases</h1>
          <p className="muted">YAML and JavaScript scripts that drive your green-screen applications.</p>
        </div>
        <div className="row-gap">
          <Link to="/recorder" className="btn">Record a test</Link>
          <button className="btn btn-primary" onClick={() => navigate('/tests/new')}>New test script</button>
        </div>
      </header>

      <div className="filters">
        <input type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" />
        <select value={suite} onChange={(e) => setSuite(e.target.value)} aria-label="Suite">
          <option value="">All suites</option>
          {suites.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {tags.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        {selected.size > 0 && <span className="muted">{selected.size} selected</span>}
        <button className="btn btn-primary" disabled={!selected.size} onClick={() => setRunSel({ testIds: [...selected], label: `${selected.size} selected test${selected.size === 1 ? '' : 's'}` })}>Run selected</button>
        {suite && <button className="btn" onClick={() => setRunSel({ suite, label: `Every test in suite "${suite}"` })}>Run suite</button>}
        {tag && <button className="btn" onClick={() => setRunSel({ tags: [tag], label: `Every test tagged "${tag}"` })}>Run tag</button>}
      </div>

      <ErrorNote error={error} onRetry={reload} />
      {loading && !data && <Loading what="Loading tests" />}
      {data && (
        <Panel pad={false}>
          {shown.length === 0 ? (
            <Empty action={<Link className="btn" to="/recorder">Record your first test</Link>}>{tests.length ? 'No tests match these filters.' : 'No test cases yet.'}</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="w-check"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" /></th>
                  <th>Name</th><th>Suite</th><th>Tags</th><th>Type</th><th className="num">Steps</th><th>Last result</th><th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className={selected.has(t.id) ? 'sel' : ''}>
                    <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.name}`} /></td>
                    <td><Link to={`/tests/${t.id}`}>{t.name}</Link></td>
                    <td>{t.suite || '—'}</td>
                    <td>{arr(t.tags).map((g) => <span key={g} className="tag">{g}</span>)}</td>
                    <td className="muted">{t.type === 'js' ? 'JavaScript' : 'YAML'}</td>
                    <td className="num">{t.stepCount ?? '—'}</td>
                    <td><StatusBadge status={t.lastStatus} /></td>
                    <td className="muted">{fmtAgo(t.lastRunAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
      {runSel && <RunDialog selection={runSel} onClose={() => setRunSel(null)} />}
    </div>
  );
}
