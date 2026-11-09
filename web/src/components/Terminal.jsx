// 24x80 5250 display rendered from a Screen (docs/API.md).
// Editable mode: input fields become inline inputs; Enter / F-keys / PageUp/Down / Esc(Attn) send an AID.
// Assert mode: drag across text (or click a field) to choose a region for an assertion.
import { useEffect, useMemo, useRef, useState } from 'react';

const COLORS = ['green', 'white', 'red', 'turquoise', 'yellow', 'pink', 'blue'];

function buildStyleMap(screen) {
  const rows = screen?.rows || 24;
  const cols = screen?.cols || 80;
  const map = Array.from({ length: rows }, () => new Array(cols).fill(null));
  (screen?.attrs || []).forEach((a) => {
    let r = a.row - 1;
    let c = a.col - 1;
    for (let i = 0; i < (a.length || 0); i++) {
      if (r >= 0 && r < rows && c >= 0 && c < cols) map[r][c] = a;
      c++;
      if (c >= cols) { c = 0; r++; }
    }
  });
  return map;
}

function cls(a) {
  if (!a) return 'c-green';
  const color = COLORS.includes(a.color) ? a.color : 'green';
  return `c-${color}${a.reverse ? ' rv' : ''}${a.underline ? ' ul' : ''}`;
}

function rowSegments(text, styles) {
  const segs = [];
  let cur = null;
  for (let i = 0; i < text.length; i++) {
    const k = cls(styles[i]);
    if (!cur || cur.k !== k) { cur = { k, s: '' }; segs.push(cur); }
    cur.s += text[i];
  }
  return segs;
}

const fieldKey = (f) => `${f.row}:${f.col}`;

export default function Terminal({ screen, editable = false, locked = false, onAid, assertMode = false, onRegion, highlight }) {
  const rows = screen?.rows || 24;
  const cols = screen?.cols || 80;
  const text = useMemo(() => Array.from({ length: rows }, (_, i) => ((screen?.text || [])[i] || '').padEnd(cols, ' ').slice(0, cols)), [screen, rows, cols]);
  const styles = useMemo(() => buildStyleMap(screen), [screen]);
  const fields = useMemo(() => (screen?.fields || []).filter((f) => f.input), [screen]);
  const [values, setValues] = useState({});
  const [cursor, setCursor] = useState(screen?.cursor || { row: 1, col: 1 });
  const [drag, setDrag] = useState(null);
  const screenRef = useRef(null);
  const inputRefs = useRef({});

  // New screen from host: reset local edits and put focus where the host put the cursor.
  useEffect(() => {
    const v = {};
    fields.forEach((f) => { v[fieldKey(f)] = f.hidden ? '' : (f.value || '').replace(/\s+$/, ''); });
    setValues(v);
    const c = screen?.cursor || { row: 1, col: 1 };
    setCursor(c);
    if (editable) {
      const target = fields.find((f) => c.row === f.row && c.col >= f.col && c.col < f.col + f.length) || fields.find((f) => !f.bypass);
      if (target) setTimeout(() => inputRefs.current[fieldKey(target)]?.focus(), 0);
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const editableFields = fields.filter((f) => !f.bypass);

  const sendAid = (aid) => {
    if (!editable || locked || !onAid) return;
    const changed = fields
      .filter((f) => !f.bypass)
      .filter((f) => (values[fieldKey(f)] ?? '') !== (f.hidden ? '' : (f.value || '').replace(/\s+$/, '')))
      .map((f) => ({ row: f.row, col: f.col, value: values[fieldKey(f)] ?? '' }));
    onAid(aid, changed, cursor);
  };

  const focusField = (dir) => {
    if (!editableFields.length) return;
    const active = document.activeElement;
    const idx = editableFields.findIndex((f) => inputRefs.current[fieldKey(f)] === active);
    const next = editableFields[(idx + dir + editableFields.length) % editableFields.length] || editableFields[0];
    inputRefs.current[fieldKey(next)]?.focus();
    setCursor({ row: next.row, col: next.col });
  };

  const onKeyDown = (e) => {
    if (!editable) return;
    const k = e.key;
    let aid = null;
    if (k === 'Enter') aid = 'Enter';
    else if (/^F([1-9]|1[0-2])$/.test(k)) aid = `F${Number(k.slice(1)) + (e.shiftKey ? 12 : 0)}`;
    else if (k === 'PageUp') aid = 'PageUp';
    else if (k === 'PageDown') aid = 'PageDown';
    else if (k === 'Escape') aid = 'Attn';
    else if (k === 'Tab') { e.preventDefault(); focusField(e.shiftKey ? -1 : 1); return; }
    if (aid) { e.preventDefault(); e.stopPropagation(); sendAid(aid); }
  };

  const cellFromEvent = (e) => {
    const box = screenRef.current.getBoundingClientRect();
    const col = Math.min(cols, Math.max(1, Math.floor(((e.clientX - box.left) / box.width) * cols) + 1));
    const row = Math.min(rows, Math.max(1, Math.floor(((e.clientY - box.top) / box.height) * rows) + 1));
    return { row, col };
  };

  const onMouseDown = (e) => {
    if (!assertMode) {
      if (editable && e.target === screenRef.current) setCursor(cellFromEvent(e));
      return;
    }
    e.preventDefault();
    const c = cellFromEvent(e);
    setDrag({ row: c.row, from: c.col, to: c.col });
  };
  const onMouseMove = (e) => {
    if (!drag) return;
    const c = cellFromEvent(e);
    setDrag((d) => ({ ...d, to: c.col }));
  };
  const onMouseUp = () => {
    if (!drag) return;
    const from = Math.min(drag.from, drag.to);
    const to = Math.max(drag.from, drag.to);
    const field = fields.find((f) => f.row === drag.row && from >= f.col && from < f.col + f.length) ||
      (screen?.fields || []).find((f) => f.row === drag.row && from >= f.col && from < f.col + f.length && from === to);
    if (field && from === to) {
      onRegion?.({ kind: 'field', row: field.row, col: field.col, length: field.length, text: (values[fieldKey(field)] ?? field.value ?? '').trim(), label: field.label });
    } else {
      const raw = text[drag.row - 1].slice(from - 1, to);
      const trimmed = raw.trim();
      if (trimmed) {
        const lead = raw.length - raw.trimStart().length;
        onRegion?.({ kind: 'text', row: drag.row, col: from + lead, length: trimmed.length, text: trimmed });
      }
    }
    setDrag(null);
  };

  const sel = drag ? { row: drag.row, col: Math.min(drag.from, drag.to), length: Math.abs(drag.to - drag.from) + 1 } : highlight;
  const shown = editable ? cursor : screen?.cursor || { row: 1, col: 1 };

  return (
    <div className={`term ${assertMode ? 'term-assert' : ''}`} onKeyDown={onKeyDown} tabIndex={editable ? 0 : -1} aria-label="5250 terminal">
      <div className="term-screen" ref={screenRef} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => drag && onMouseUp()}>
        {text.map((line, r) => (
          <div className="term-row" key={r}>
            {rowSegments(line, styles[r]).map((s, i) => <span key={i} className={s.k}>{s.s}</span>)}
          </div>
        ))}
        {!editable && fields.map((f) => (
          <span key={fieldKey(f)} className="term-field-mark" style={{ top: `calc(${f.row - 1} * var(--lh))`, left: `${f.col - 1}ch`, width: `${Math.min(f.length, cols - f.col + 1)}ch` }} />
        ))}
        {editable && fields.map((f) => (
          <input
            key={fieldKey(f)}
            ref={(el) => { inputRefs.current[fieldKey(f)] = el; }}
            className={`term-input ${cls(styles[f.row - 1]?.[f.col - 1])}`}
            style={{ top: `calc(${f.row - 1} * var(--lh))`, left: `${f.col - 1}ch`, width: `${Math.min(f.length, cols - f.col + 1)}ch` }}
            type={f.hidden ? 'password' : 'text'}
            autoComplete={f.hidden ? 'new-password' : 'off'}
            spellCheck={false}
            inputMode={f.numeric ? 'numeric' : 'text'}
            maxLength={f.length}
            readOnly={f.bypass || locked}
            tabIndex={-1}
            aria-label={f.label || `Field at row ${f.row}, column ${f.col}`}
            value={values[fieldKey(f)] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [fieldKey(f)]: e.target.value }))}
            onFocus={(e) => setCursor({ row: f.row, col: f.col + (e.target.selectionStart || 0) })}
            onSelect={(e) => setCursor({ row: f.row, col: f.col + (e.target.selectionStart || 0) })}
          />
        ))}
        {sel && (
          <span className="term-sel" style={{ top: `calc(${sel.row - 1} * var(--lh))`, left: `${sel.col - 1}ch`, width: `${sel.length}ch` }} />
        )}
        {shown && !assertMode && (
          <span className="term-cursor" style={{ top: `calc(${shown.row - 1} * var(--lh))`, left: `${shown.col - 1}ch` }} />
        )}
      </div>
      <div className="term-oia">
        <span className="oia-ready">{screen ? 'MA' : '  '}</span>
        <span className="oia-lock">{locked || screen?.keyboardLocked ? 'X SYSTEM' : ''}</span>
        <span className="oia-mode">{assertMode ? 'SELECT' : ''}</span>
        <span className="oia-pos">{String(shown?.row || 1).padStart(2, '0')}/{String(shown?.col || 1).padStart(3, '0')}</span>
      </div>
    </div>
  );
}
