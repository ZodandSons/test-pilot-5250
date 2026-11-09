import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { arr } from '../util.js';
import { Link, navigate } from '../router.jsx';
import { Field, ErrorNote, Loading } from '../components/ui.jsx';
import RunDialog from '../components/RunDialog.jsx';

const YAML_TEMPLATE = `name: New test
suite: orders
tags: [smoke]
description: What this test proves.
coverage:
  programs: [ORDINQ]
steps:
  - signon: { user: \${env.USER}, password: \${env.PASSWORD} }
  - waitFor: { text: "Main Menu" }
  - command: "CALL ORDINQ"
  - fill: { label: "Customer number", value: "10001" }
  - press: Enter
  - assertText: { text: "ACME SUPPLY" }
  - press: F3
`;

const JS_TEMPLATE = `// JavaScript test script. "screen" drives the 5250 session.
export default {
  name: 'New scripted test',
  suite: 'orders',
  tags: ['regression'],
  async run({ screen, env, expect }) {
    await screen.signon(env.USER, env.PASSWORD);
    await screen.waitFor('Main Menu');
    await screen.command('CALL ORDINQ');
    await screen.fill({ label: 'Customer number' }, '10001');
    await screen.press('Enter');
    expect(screen.text()).toContain('ACME SUPPLY');
    await screen.press('F3');
  },
};
`;

export default function TestEditor({ id }) {
  const isNew = id === 'new';
  const [test, setTest] = useState(null);
  const [name, setName] = useState('');
  const [suite, setSuite] = useState('');
  const [type, setType] = useState('yaml');
  const [content, setContent] = useState(YAML_TEMPLATE);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api.test(id).then((t) => {
      setTest(t); setName(t.name || ''); setSuite(t.suite || ''); setType(t.type || 'yaml'); setContent(t.content || '');
    }).catch(setError);
  }, [id, isNew]);

  const edit = (setter) => (e) => { setter(e.target.value); setDirty(true); setValidation(null); setNotice(null); };

  const validate = async () => {
    setError(null);
    try { setValidation(await api.validateTest(type, content)); } catch (e) { setError(e); }
  };

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (isNew) {
        const t = await api.createTest({ name, suite, type, content });
        navigate(`/tests/${t.id}`);
      } else {
        const t = await api.updateTest(id, { name, suite, content });
        setTest((old) => ({ ...old, ...t }));
        setNotice('Saved');
      }
      setDirty(false);
    } catch (e) { setError(e); }
    setBusy(false);
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${name}"? Run history is kept.`)) return;
    try { await api.deleteTest(id); navigate('/tests'); } catch (e) { setError(e); }
  };

  if (!isNew && !test && !error) return <div className="page"><Loading what="Loading test" /></div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="crumb"><Link to="/tests">Test cases</Link></p>
          <h1>{isNew ? 'New test script' : name || 'Untitled test'}</h1>
        </div>
        <div className="row-gap">
          {!isNew && <button className="btn btn-danger" onClick={remove}>Delete</button>}
          <button className="btn" onClick={validate}>Validate</button>
          <button className="btn" disabled={busy || !name} onClick={save}>{busy ? 'Saving…' : isNew ? 'Create test' : 'Save changes'}</button>
          {!isNew && <button className="btn btn-primary" disabled={dirty} title={dirty ? 'Save changes before running' : ''} onClick={() => setRunOpen(true)}>Run test</button>}
        </div>
      </header>
      <ErrorNote error={error} />
      {notice && <div className="ok-note">{notice}</div>}
      {validation && (
        <div className={validation.ok ? 'ok-note' : 'error-note'}>
          {validation.ok ? 'Script is valid.' : (
            <ul className="plain">{arr(validation.errors).map((e, i) => <li key={i}>{typeof e === 'string' ? e : e.message || JSON.stringify(e)}</li>)}</ul>
          )}
        </div>
      )}
      <div className="editor-meta">
        <Field label="Name"><input value={name} onChange={edit(setName)} placeholder="Order inquiry – valid customer" /></Field>
        <Field label="Suite"><input value={suite} onChange={edit(setSuite)} placeholder="orders" /></Field>
        <Field label="Script type">
          <select value={type} disabled={!isNew} onChange={(e) => {
            const t = e.target.value; setType(t);
            if (content === YAML_TEMPLATE || content === JS_TEMPLATE) setContent(t === 'js' ? JS_TEMPLATE : YAML_TEMPLATE);
          }}>
            <option value="yaml">YAML steps</option>
            <option value="js">JavaScript</option>
          </select>
        </Field>
      </div>
      <CodeEditor value={content} onChange={edit(setContent)} />
      <details className="help">
        <summary>Step reference</summary>
        <table className="table compact">
          <tbody>
            <tr><td><code>signon</code></td><td>Sign on with user and password (variables like <code>{'${env.USER}'}</code> come from the environment).</td></tr>
            <tr><td><code>waitFor</code></td><td>Wait until text appears and the keyboard unlocks. Options: <code>text</code>, <code>row</code>, <code>timeout</code>.</td></tr>
            <tr><td><code>command</code></td><td>Type a CL command on the command line and press Enter.</td></tr>
            <tr><td><code>fill</code></td><td>Type into an input field found by <code>label</code> or <code>row</code>/<code>col</code>.</td></tr>
            <tr><td><code>press</code></td><td>Send an AID key: Enter, F1–F24, PageUp, PageDown, Help, Clear, Attn, SysReq.</td></tr>
            <tr><td><code>assertText</code> / <code>assertNotText</code></td><td>Check text is (or is not) on screen, optionally at a row/column.</td></tr>
            <tr><td><code>assertField</code></td><td>Check a field's value with <code>equals</code>, <code>contains</code> or <code>matches</code>.</td></tr>
            <tr><td><code>screenshot</code></td><td>Save the current screen into the result.</td></tr>
            <tr><td><code>data</code> (top level)</td><td>CSV file for data-driven tests; reference columns as <code>{'${data.COLUMN}'}</code>.</td></tr>
          </tbody>
        </table>
      </details>
      {runOpen && <RunDialog selection={{ testIds: [id], label: name }} onClose={() => setRunOpen(false)} />}
    </div>
  );
}

function CodeEditor({ value, onChange }) {
  const gutter = useRef(null);
  const lines = value.split('\n').length;
  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.target;
      const s = el.selectionStart;
      const next = `${value.slice(0, s)}  ${value.slice(el.selectionEnd)}`;
      onChange({ target: { value: next } });
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };
  return (
    <div className="code-editor">
      <pre className="gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
      <textarea
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.target.scrollTop; }}
        spellCheck={false}
        aria-label="Test script source"
      />
    </div>
  );
}
