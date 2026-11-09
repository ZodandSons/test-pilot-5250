// Schedules and Environments: simple CRUD pages.
import { useState } from 'react';
import { api, useLoad } from '../api.js';
import { arr, fmtTime } from '../util.js';
import { Panel, ErrorNote, Loading, Empty, Modal, Field } from '../components/ui.jsx';

const CRON_PRESETS = [
  ['0 2 * * *', 'Every night at 02:00'],
  ['0 * * * 1-5', 'Hourly on weekdays'],
  ['30 6 * * 1', 'Mondays at 06:30'],
];

function cronValid(c) {
  return /^(\S+\s+){4}\S+$/.test((c || '').trim());
}

export function Schedules() {
  const { data, error, loading, reload } = useLoad(() => api.schedules(), []);
  const envs = useLoad(() => api.environments(), []);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const envName = (id) => arr(envs.data).find((e) => e.id === id)?.name || id || '—';

  const save = async (s) => {
    setErr(null);
    try {
      if (s.id) await api.updateSchedule(s.id, s); else await api.createSchedule(s);
      setEdit(null); reload();
    } catch (e) { setErr(e); }
  };
  const toggle = async (s) => { await api.updateSchedule(s.id, { ...s, enabled: !s.enabled }).catch(setErr); reload(); };
  const remove = async (s) => { if (window.confirm(`Delete schedule "${s.name}"?`)) { await api.deleteSchedule(s.id).catch(setErr); reload(); } };

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Schedules</h1><p className="muted">Run suites automatically, for example a nightly regression after the build.</p></div>
        <button className="btn btn-primary" onClick={() => setEdit({ name: '', cron: '0 2 * * *', suite: '', tags: [], testIds: [], environmentId: arr(envs.data)[0]?.id || '', enabled: true })}>New schedule</button>
      </header>
      <ErrorNote error={error || err} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && (
        <Panel pad={false}>
          {arr(data).length === 0 ? <Empty>No schedules yet.</Empty> : (
            <table className="table">
              <thead><tr><th>Name</th><th>When</th><th>Selects</th><th>Environment</th><th>Last run</th><th>Next run</th><th>Enabled</th><th /></tr></thead>
              <tbody>
                {arr(data).map((s) => (
                  <tr key={s.id}>
                    <td><button className="linklike" onClick={() => setEdit(s)}>{s.name}</button></td>
                    <td className="mono">{s.cron}</td>
                    <td>{s.suite ? <span className="tag">suite: {s.suite}</span> : null}{arr(s.tags).map((t) => <span key={t} className="tag">{t}</span>)}{arr(s.testIds).length ? <span className="tag">{arr(s.testIds).length} tests</span> : null}{!s.suite && !arr(s.tags).length && !arr(s.testIds).length && <span className="muted">All tests</span>}</td>
                    <td>{envName(s.environmentId)}</td>
                    <td className="muted">{fmtTime(s.lastRunAt)}</td>
                    <td className="muted">{s.enabled ? fmtTime(s.nextRunAt) : '—'}</td>
                    <td><label className="switch"><input type="checkbox" checked={!!s.enabled} onChange={() => toggle(s)} aria-label={`Enable ${s.name}`} /><span /></label></td>
                    <td><button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
      {edit && <ScheduleForm value={edit} envs={arr(envs.data)} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function ScheduleForm({ value, envs, onClose, onSave }) {
  const [s, setS] = useState({ ...value, tagsText: arr(value.tags).join(', ') });
  const set = (k) => (e) => setS((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = () => {
    const { tagsText, ...rest } = s;
    onSave({ ...rest, tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) });
  };
  return (
    <Modal title={value.id ? 'Edit schedule' : 'New schedule'} onClose={onClose} footer={(
      <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!s.name || !cronValid(s.cron) || !s.environmentId} onClick={submit}>Save schedule</button></>
    )}>
      <Field label="Name"><input value={s.name} onChange={set('name')} placeholder="Nightly regression" /></Field>
      <Field label="Cron expression" hint={cronValid(s.cron) ? 'minute hour day-of-month month day-of-week' : 'Needs five fields, e.g. 0 2 * * *'}>
        <input className="mono" value={s.cron} onChange={set('cron')} />
      </Field>
      <div className="chips">{CRON_PRESETS.map(([c, l]) => <button key={c} type="button" className="chip" onClick={() => setS((o) => ({ ...o, cron: c }))}>{l}</button>)}</div>
      <div className="form-2">
        <Field label="Suite" hint="Leave empty for all suites"><input value={s.suite || ''} onChange={set('suite')} /></Field>
        <Field label="Tags" hint="Comma separated"><input value={s.tagsText} onChange={set('tagsText')} /></Field>
      </div>
      <Field label="Environment">
        <select value={s.environmentId} onChange={set('environmentId')}>
          {envs.length === 0 && <option value="">No environments</option>}
          {envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </Field>
      <label className="check"><input type="checkbox" checked={!!s.enabled} onChange={set('enabled')} />Enabled</label>
    </Modal>
  );
}

const BLANK_ENV = { name: '', host: '', port: 23, deviceName: '', user: '', password: '', coverageAdapter: 'none', codecov: { ifsDir: '', sshHost: '', sshUser: '', sshPort: 22 }, variables: {} };

export function Environments() {
  const { data, error, loading, reload } = useLoad(() => api.environments(), []);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const save = async (e) => {
    setErr(null);
    try {
      if (e.id) await api.updateEnvironment(e.id, e); else await api.createEnvironment(e);
      setEdit(null); reload();
    } catch (x) { setErr(x); }
  };
  const remove = async (e) => { if (window.confirm(`Delete environment "${e.name}"?`)) { await api.deleteEnvironment(e.id).catch(setErr); reload(); } };
  const ADAPTER = { none: 'Off', simulator: 'Simulator', codecov: 'IBM CODECOV' };
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Environments</h1><p className="muted">IBM i systems (or the built-in simulator) that tests connect to over TN5250.</p></div>
        <button className="btn btn-primary" onClick={() => setEdit(BLANK_ENV)}>New environment</button>
      </header>
      <ErrorNote error={error || err} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && (
        <Panel pad={false}>
          {arr(data).length === 0 ? <Empty>No environments yet. Add your IBM i host, or point at the simulator on 127.0.0.1:2323.</Empty> : (
            <table className="table">
              <thead><tr><th>Name</th><th>Host</th><th>Device</th><th>User</th><th>Coverage</th><th>Variables</th><th /></tr></thead>
              <tbody>
                {arr(data).map((e) => (
                  <tr key={e.id}>
                    <td><button className="linklike" onClick={() => setEdit(e)}>{e.name}</button></td>
                    <td className="mono">{e.host}:{e.port}</td>
                    <td className="mono">{e.deviceName || 'auto'}</td>
                    <td className="mono">{e.user || '—'}</td>
                    <td>{ADAPTER[e.coverageAdapter] || e.coverageAdapter}</td>
                    <td>{Object.keys(e.variables || {}).map((k) => <span key={k} className="tag">{k}</span>)}</td>
                    <td><button className="icon-btn" aria-label={`Delete ${e.name}`} onClick={() => remove(e)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
      {edit && <EnvForm value={edit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function EnvForm({ value, onClose, onSave }) {
  const [e, setE] = useState({ ...BLANK_ENV, ...value, codecov: { ...BLANK_ENV.codecov, ...(value.codecov || {}) } });
  const [vars, setVars] = useState(Object.entries(value.variables || {}).map(([k, v]) => ({ k, v })));
  const set = (k, num) => (ev) => setE((o) => ({ ...o, [k]: num ? Number(ev.target.value) : ev.target.value }));
  const setCc = (k, num) => (ev) => setE((o) => ({ ...o, codecov: { ...o.codecov, [k]: num ? Number(ev.target.value) : ev.target.value } }));
  const submit = () => {
    const variables = {};
    vars.forEach(({ k, v }) => { if (k.trim()) variables[k.trim()] = v; });
    onSave({ ...e, variables });
  };
  return (
    <Modal wide title={value.id ? `Edit ${value.name}` : 'New environment'} onClose={onClose} footer={(
      <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!e.name || !e.host} onClick={submit}>Save environment</button></>
    )}>
      <div className="form-2">
        <Field label="Name"><input value={e.name} onChange={set('name')} placeholder="DEV partition" /></Field>
        <Field label="Device name" hint="Optional. Leave empty to let the system assign QPADEVxxxx."><input className="mono" value={e.deviceName} onChange={set('deviceName')} maxLength={10} /></Field>
        <Field label="Host"><input className="mono" value={e.host} onChange={set('host')} placeholder="ibmi.example.com" /></Field>
        <Field label="Port"><input className="mono" type="number" value={e.port} onChange={set('port', true)} /></Field>
        <Field label="User profile"><input className="mono" value={e.user} onChange={set('user')} /></Field>
        <Field label="Password" hint={value.id ? 'Leave as *** to keep the stored password.' : undefined}><input type="password" autoComplete="new-password" value={e.password} onChange={set('password')} /></Field>
      </div>
      <Field label="Code coverage">
        <select value={e.coverageAdapter} onChange={set('coverageAdapter')}>
          <option value="none">Off</option>
          <option value="simulator">Simulator (demo data)</option>
          <option value="codecov">IBM CODECOV (QDEVTOOLS, 5770WDS option 60)</option>
        </select>
      </Field>
      {e.coverageAdapter === 'codecov' && (
        <div className="form-2 sub">
          <Field label="IFS result directory" hint="Where CODECOV writes .cczip files"><input className="mono" value={e.codecov.ifsDir} onChange={setCc('ifsDir')} placeholder="/home/QATEST/cc" /></Field>
          <Field label="SSH host" hint="Used to download results (SFTP)"><input className="mono" value={e.codecov.sshHost} onChange={setCc('sshHost')} /></Field>
          <Field label="SSH user"><input className="mono" value={e.codecov.sshUser} onChange={setCc('sshUser')} /></Field>
          <Field label="SSH port"><input className="mono" type="number" value={e.codecov.sshPort} onChange={setCc('sshPort', true)} /></Field>
        </div>
      )}
      <div className="vars">
        <span className="field-label">Variables</span>
        <p className="field-hint">Available in scripts as <code>{'${env.NAME}'}</code>. USER and PASSWORD are added automatically.</p>
        {vars.map((row, i) => (
          <div className="var-row" key={i}>
            <input className="mono" placeholder="NAME" value={row.k} onChange={(ev) => setVars((v) => v.map((x, j) => (j === i ? { ...x, k: ev.target.value } : x)))} aria-label="Variable name" />
            <input className="mono" placeholder="value" value={row.v} onChange={(ev) => setVars((v) => v.map((x, j) => (j === i ? { ...x, v: ev.target.value } : x)))} aria-label="Variable value" />
            <button className="icon-btn" aria-label="Remove variable" onClick={() => setVars((v) => v.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="btn btn-small" onClick={() => setVars((v) => [...v, { k: '', v: '' }])}>Add variable</button>
      </div>
    </Modal>
  );
}
