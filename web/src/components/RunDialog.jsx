import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { arr } from '../util.js';
import { navigate } from '../router.jsx';
import { Field, Modal, ErrorNote } from './ui.jsx';

// selection: { testIds?: [], suite?: '', tags?: [] , label: 'what is being run' }
export default function RunDialog({ selection, onClose }) {
  const [envs, setEnvs] = useState([]);
  const [environmentId, setEnv] = useState('');
  const [coverage, setCoverage] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.environments().then((e) => { setEnvs(arr(e)); if (arr(e)[0]) setEnv(arr(e)[0].id); }).catch(setError);
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { testIds, suite, tags } = selection;
      const { runId } = await api.startRun({ testIds, suite, tags, environmentId, coverage, name: name || undefined });
      onClose();
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <Modal title="Start a test run" onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!environmentId || busy} onClick={start}>{busy ? 'Starting…' : 'Start run'}</button>
      </>
    )}>
      <p className="muted">{selection.label}</p>
      <Field label="Environment">
        <select value={environmentId} onChange={(e) => setEnv(e.target.value)}>
          {envs.length === 0 && <option value="">No environments — add one first</option>}
          {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.host}:{e.port})</option>)}
        </select>
      </Field>
      <Field label="Run name" hint="Optional. Shown in run history and reports.">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pre-release smoke" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={coverage} onChange={(e) => setCoverage(e.target.checked)} />
        Collect code coverage
      </label>
      <ErrorNote error={error} />
    </Modal>
  );
}
