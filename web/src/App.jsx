import { usePath, match, Link } from './router.jsx';
import { useWsStatus } from './ws.js';
import { isMock } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Tests from './pages/Tests.jsx';
import TestEditor from './pages/TestEditor.jsx';
import Recorder from './pages/Recorder.jsx';
import { Runs, RunDetail } from './pages/Runs.jsx';
import Coverage from './pages/Coverage.jsx';
import { Schedules, Environments } from './pages/Settings.jsx';

const NAV = [
  ['/', 'Dashboard'],
  ['/tests', 'Test cases'],
  ['/recorder', 'Recorder'],
  ['/runs', 'Runs'],
  ['/coverage', 'Coverage'],
  ['/schedules', 'Schedules'],
  ['/environments', 'Environments'],
];

function route(path) {
  let p;
  if (path === '/') return <Dashboard />;
  if (path === '/tests') return <Tests />;
  if ((p = match('/tests/:id', path))) return <TestEditor key={p.id} id={p.id} />;
  if (path === '/recorder') return <Recorder />;
  if (path === '/runs') return <Runs />;
  if ((p = match('/runs/:id', path))) return <RunDetail key={p.id} id={p.id} />;
  if (path === '/coverage') return <Coverage />;
  if (path === '/schedules') return <Schedules />;
  if (path === '/environments') return <Environments />;
  return <div className="page"><h1>Page not found</h1><p><Link to="/">Go to the dashboard</Link></p></div>;
}

export default function App() {
  const path = usePath();
  const ws = useWsStatus();
  const active = (to) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-text">TestPilot<b>5250</b></span>
        </Link>
        <ul>
          {NAV.map(([to, label]) => (
            <li key={to}><Link to={to} className={active(to) ? 'on' : ''} aria-current={active(to) ? 'page' : undefined}>{label}</Link></li>
          ))}
        </ul>
        <div className={`conn conn-${ws}`}>
          <span className="conn-dot" aria-hidden="true" />
          {isMock() ? 'Demo data' : ws === 'open' ? 'Live updates on' : ws === 'connecting' ? 'Connecting…' : 'Server offline'}
        </div>
      </nav>
      <main className="main">{route(path)}</main>
    </div>
  );
}
