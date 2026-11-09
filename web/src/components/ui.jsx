import { useEffect } from 'react';

const STATUS = {
  passed: { label: 'Passed', icon: '✓' },
  failed: { label: 'Failed', icon: '✕' },
  error: { label: 'Error', icon: '!' },
  running: { label: 'Running', icon: '◐' },
  queued: { label: 'Queued', icon: '…' },
  skipped: { label: 'Skipped', icon: '–' },
};

export function StatusBadge({ status }) {
  if (!status) return <span className="badge badge-none">Not run</span>;
  const s = STATUS[status] || { label: status, icon: '•' };
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true" className="badge-icon">{s.icon}</span>
      {s.label}
    </span>
  );
}

export function Panel({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'panel-body' : 'panel-flush'}>{children}</div>
    </section>
  );
}

export function Empty({ children, action }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-note" role="alert">
      <span>{error.message || String(error)}</span>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Loading({ what = 'Loading' }) {
  return <div className="loading">{what}…</div>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Meter({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <span className="meter" aria-hidden="true">
      <span className="meter-fill" style={{ width: `${p}%` }} />
    </span>
  );
}
