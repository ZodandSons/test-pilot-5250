import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { wsSend, useWsMessages, useWsStatus } from '../ws.js';
import { arr } from '../util.js';
import { navigate } from '../router.jsx';
import Terminal from '../components/Terminal.jsx';
import { Panel, Field, Modal, ErrorNote, Empty } from '../components/ui.jsx';

const KEYS = ['Attn', 'SysReq', 'Clear', 'Help', 'PageUp', 'PageDown', 'Enter'];

function describe(step) {
  const a = step.args || {};
  switch (step.action) {
    case 'connect': return 'Connect to host';
    case 'signon': return `Sign on as ${a.user || '…'}`;
    case 'fill': return `Fill ${a.label ? `"${a.label}"` : `row ${a.row}, col ${a.col}`} with "${a.value ?? ''}"`;
    case 'press': return `Press ${a.key || a.aid || step.key || ''}`;
    case 'assertText': return `Check text "${a.text}"${a.row ? ` on row ${a.row}` : ''}`;
    case 'assertField': return `Check field ${a.label ? `"${a.label}"` : `at ${a.row},${a.col}`} equals "${a.equals ?? ''}"`;
    case 'waitFor': return `Wait for "${a.text}"`;
    case 'command': return `Run command "${a.value ?? a.command ?? ''}"`;
    default: return `${step.action} ${JSON.stringify(a)}`;
  }
}

export default function Recorder() {
  const status = useWsStatus();
  const [envs, setEnvs] = useState([]);
  const [envId, setEnvId] = useState('');
  const [session, setSession] = useState(null); // { id, record }
  const [screen, setScreen] = useState(null);
  const [steps, setSteps] = useState([]);
  const [locked, setLocked] = useState(false);
  const [assertMode, setAssertMode] = useState(false);
  const [pending, setPending] = useState(null); // region awaiting confirm
  const [saveOpen, setSaveOpen] = useState(false);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.environments().then((e) => { setEnvs(arr(e)); if (arr(e)[0]) setEnvId(arr(e)[0].id); }).catch(setError);
  }, []);

  useWsMessages((m) => {
    switch (m.type) {
      case 'rec.started': setSession((s) => ({ ...(s || {}), id: m.sessionId })); setScreen(m.screen); setSteps(arr(m.steps)); setStarting(false); setLocked(false); break;
      case 'rec.screen': setScreen(m.screen); if (m.steps) setSteps(arr(m.steps)); setLocked(!!m.screen?.keyboardLocked); break;
      case 'rec.steps': setSteps(arr(m.steps)); break;
      case 'rec.saved': setSession(null); setScreen(null); setSteps([]); setSaveOpen(false); navigate(`/tests/${m.testId}`); break;
      case 'rec.stopped': setSession(null); setScreen(null); setSteps([]); break;
      case 'error': setError(new Error(m.message)); setStarting(false); setLocked(false); break;
      case 'ws.closed': if (session) { setError(new Error('Connection to the TestPilot server dropped; the 5250 session has ended. Start again when it reconnects.')); setSession(null); setStarting(false); } break;
      default:
    }
  }, [session]);

  const start = (record) => {
    setError(null); setStarting(true); setSession({ id: null, record });
    wsSend({ type: 'rec.start', environmentId: envId, record });
  };

  const onAid = (aid, fields, cursor) => {
    setLocked(true);
    wsSend({ type: 'rec.input', fields, aid, cursor });
  };

  const onRegion = (region) => setPending(region);
  const confirmAssert = () => {
    wsSend({ type: 'rec.assert', ...pending });
    setPending(null);
    setAssertMode(false);
  };

  const stop = (save) => {
    wsSend({ type: 'rec.stop', save });
    if (!save) { setSession(null); setScreen(null); setSteps([]); }
  };

  const recording = session?.record;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Recorder</h1>
          <p className="muted">Use the application as you normally would. Each field you type and key you press becomes a test step.</p>
        </div>
        {session && (
          <div className="row-gap">
            {recording && <span className="rec-dot">Recording</span>}
            <button className="btn" onClick={() => stop(null)}>{recording ? 'Discard' : 'Disconnect'}</button>
            {recording && <button className="btn btn-primary" disabled={steps.length < 2} onClick={() => setSaveOpen(true)}>Stop and save</button>}
          </div>
        )}
      </header>
      <ErrorNote error={error} />

      {!session && (
        <Panel title="Start a session">
          <div className="start-row">
            <Field label="Environment">
              <select value={envId} onChange={(e) => setEnvId(e.target.value)}>
                {envs.length === 0 && <option value="">No environments — add one first</option>}
                {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.host}:{e.port})</option>)}
              </select>
            </Field>
            <button className="btn btn-primary" disabled={!envId || starting} onClick={() => start(true)}>Start recording</button>
            <button className="btn" disabled={!envId || starting} onClick={() => start(false)}>Open live terminal</button>
          </div>
          {status !== 'open' && status !== 'mock' && <p className="muted small">Waiting for the server connection ({status}).</p>}
        </Panel>
      )}

      {session && (
        <div className="recorder">
          <div className="recorder-main">
            <div className="term-toolbar">
              {KEYS.map((k) => (
                <button key={k} className="btn btn-small" disabled={locked || !screen} onClick={() => onAid(k, [], screen?.cursor)}>{k === 'PageUp' ? 'Page up' : k === 'PageDown' ? 'Page down' : k}</button>
              ))}
              <span className="spacer" />
              {recording && (
                <button className={`btn btn-small ${assertMode ? 'btn-on' : ''}`} onClick={() => { setAssertMode((v) => !v); setPending(null); }} aria-pressed={assertMode}>
                  {assertMode ? 'Cancel check' : 'Add check'}
                </button>
              )}
            </div>
            {screen ? (
              <Terminal screen={screen} editable={!assertMode} locked={locked} onAid={onAid} assertMode={assertMode} onRegion={onRegion} highlight={pending} />
            ) : (
              <div className="term term-wait"><span>Connecting to host…</span></div>
            )}
            <p className="muted small keyhelp">
              Enter sends the screen. F1–F12 are function keys; hold Shift for F13–F24. Tab moves between input fields. Esc sends Attn.
              {assertMode && ' Drag across text, or click a field, to choose what to check.'}
            </p>
            {pending && (
              <div className="assert-confirm">
                <span>Check {pending.kind === 'field' ? `field ${pending.label ? `"${pending.label}"` : ''} equals` : 'screen shows'} <code>{pending.text || '(empty)'}</code> at row {pending.row}, column {pending.col}</span>
                <button className="btn btn-small" onClick={() => setPending(null)}>Cancel</button>
                <button className="btn btn-small btn-primary" onClick={confirmAssert}>Add check</button>
              </div>
            )}
          </div>
          {recording && (
            <Panel title={`Recorded steps (${steps.length})`} className="steps-panel" pad={false}>
              {steps.length === 0 ? <Empty>Steps appear here as you work.</Empty> : (
                <ol className="step-list">
                  {steps.map((s, i) => (
                    <li key={i} className={s.action.startsWith('assert') ? 'is-check' : ''}>
                      <span className="step-n">{i + 1}</span>
                      <span className="step-d">{describe(s)}</span>
                      <button className="icon-btn" aria-label={`Remove step ${i + 1}`} onClick={() => wsSend({ type: 'rec.removeStep', index: i })}>×</button>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
        </div>
      )}
      {saveOpen && <SaveDialog onClose={() => setSaveOpen(false)} onSave={(save) => stop(save)} />}
    </div>
  );
}

function SaveDialog({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [suite, setSuite] = useState('');
  const [tags, setTags] = useState('');
  return (
    <Modal title="Save recorded test" onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>Keep recording</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), suite: suite.trim(), tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })}>Save test</button>
      </>
    )}>
      <Field label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Order inquiry – valid customer" /></Field>
      <Field label="Suite"><input value={suite} onChange={(e) => setSuite(e.target.value)} placeholder="orders" /></Field>
      <Field label="Tags" hint="Comma separated, e.g. smoke, orders"><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
    </Modal>
  );
}
