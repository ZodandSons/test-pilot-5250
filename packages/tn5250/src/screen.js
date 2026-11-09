import { ORDER, CMD, ESC, READ_CMDS, FFW, SHIFT, ADJUST, decodeAttr } from './constants.js';
import { e2a, a2e } from './ebcdic.js';

/**
 * 5250 display buffer + format table. Interprets outbound (host -> workstation)
 * data streams and produces inbound field data.
 */
export class Screen {
  constructor(rows = 24, cols = 80) {
    this.rows = rows;
    this.cols = cols;
    this.clear();
    this.pendingRead = null;
    this.keyboardLocked = true;
    this.messageWaiting = false;
    this.errorLine = null;
    this.version = 0;
  }

  clear() {
    this.buf = new Uint8Array(this.rows * this.cols); // EBCDIC bytes; 0x20-0x3F are attributes
    this.fields = [];
    this.cursor = 0;
    this.addr = 0;
    this.errorLine = null;
  }

  pos(row, col) { return (row - 1) * this.cols + (col - 1); }
  rc(pos) { return { row: Math.floor(pos / this.cols) + 1, col: (pos % this.cols) + 1 }; }
  get size() { return this.rows * this.cols; }

  // ---------------------------------------------------------------- parsing
  /**
   * Apply the data portion of a GDS record. Returns a list of commands seen
   * (used by the session to decide how to respond).
   */
  apply(data) {
    const cmds = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] !== ESC) { i++; continue; }
      const cmd = data[i + 1];
      i += 2;
      cmds.push(cmd);
      switch (cmd) {
        case CMD.CLEAR_UNIT: this.clear(); break;
        case CMD.CLEAR_UNIT_ALT: i += 1; this.clear(); break;
        case CMD.CLEAR_FORMAT_TABLE: this.fields = []; break;
        case CMD.WRITE_TO_DISPLAY: i = this.writeToDisplay(data, i); break;
        case CMD.WRITE_ERROR_CODE:
        case CMD.WRITE_ERROR_CODE_WINDOW: i = this.writeErrorCode(data, i, cmd); break;
        case CMD.WRITE_STRUCTURED_FIELD:
        case CMD.WRITE_SINGLE_STRUCTURED_FIELD: {
          const len = (data[i] << 8) | data[i + 1];
          cmds.wsf = data.subarray(i, i + len);
          i += Math.max(len, 2);
          break;
        }
        case CMD.ROLL: i += 3; break;
        default:
          if (READ_CMDS.has(cmd)) {
            this.pendingRead = { cmd, cc: [data[i], data[i + 1]] };
            i += 2;
          }
      }
    }
    this.version++;
    return cmds;
  }

  writeErrorCode(data, i, cmd) {
    if (cmd === CMD.WRITE_ERROR_CODE_WINDOW) i += 2;
    let text = '';
    while (i < data.length && data[i] !== ESC) {
      const b = data[i];
      if (b === ORDER.IC) { i += 3; continue; }
      if (b >= 0x40) text += e2a(b);
      i++;
    }
    this.errorLine = text.trim();
    // Show message on the last line, as a real terminal does.
    const start = this.pos(this.rows, 1);
    for (let p = 0; p < this.cols; p++) this.buf[start + p] = p < text.length ? a2e(text[p]) : 0x40;
    return i;
  }

  writeToDisplay(data, i) {
    const cc1 = data[i], cc2 = data[i + 1];
    i += 2;
    this.applyControlChars(cc1, cc2);
    let icSet = false;
    while (i < data.length) {
      const b = data[i];
      if (b === ESC) break;
      switch (b) {
        case ORDER.SOH: { const len = data[i + 1]; i += 2 + len; break; }
        case ORDER.RA: {
          const to = this.pos(data[i + 1], data[i + 2]);
          const ch = data[i + 3];
          i += 4;
          // Repeat char from current address up to and including `to`.
          while (this.addr <= to) { this.put(ch); if (this.addr === 0) break; }
          break;
        }
        case ORDER.EA: {
          const to = this.pos(data[i + 1], data[i + 2]);
          const len = data[i + 3];
          i += 3 + len;
          while (this.addr <= to) { this.put(0x00); if (this.addr === 0) break; }
          break;
        }
        case ORDER.TD: {
          const len = (data[i + 1] << 8) | data[i + 2];
          for (let k = 0; k < len; k++) this.put(data[i + 3 + k]);
          i += 3 + len;
          break;
        }
        case ORDER.SBA: this.addr = this.pos(data[i + 1], data[i + 2]); i += 3; break;
        case ORDER.WEA: i += 3; break;
        case ORDER.IC: this.cursor = this.pos(data[i + 1], data[i + 2]); icSet = true; i += 3; break;
        case ORDER.MC: this.cursor = this.pos(data[i + 1], data[i + 2]); i += 3; break;
        case ORDER.WDSF: { const len = (data[i + 1] << 8) | data[i + 2]; i += 1 + Math.max(len, 2); break; }
        case ORDER.SF: i = this.startField(data, i + 1); break;
        default:
          this.put(b);
          i++;
      }
    }
    if (!icSet && this.fields.some((f) => f.input)) {
      // Default cursor: first non-bypass input field
      const first = this.fields.find((f) => f.input && !f.bypass);
      if (first && this.cursor === 0) this.cursor = first.start;
    }
    return i;
  }

  applyControlChars(cc1, cc2) {
    const mode = cc1 & 0xe0;
    for (const f of this.fields) {
      if (!f.input) continue;
      const nonBypass = !f.bypass;
      if (mode === 0x40 && nonBypass) f.mdt = false;
      if (mode === 0x60) f.mdt = false;
      if ((mode === 0x80 && nonBypass && f.mdt) || (mode === 0xa0 && nonBypass && f.mdt)) this.nullField(f);
      if (mode === 0xc0 && nonBypass) { if (f.mdt) this.nullField(f); f.mdt = false; }
      if (mode === 0xe0 && nonBypass) { this.nullField(f); f.mdt = false; }
    }
    if (cc2 & 0x08) this.keyboardLocked = false;
    if (cc2 & 0x02) this.messageWaiting = false;
    if (cc2 & 0x01) this.messageWaiting = true;
  }

  startField(data, i) {
    let ffw1 = 0, ffw2 = 0;
    const fcw = [];
    let input = false;
    if ((data[i] & 0xe0) !== 0x20) {
      input = true;
      ffw1 = data[i]; ffw2 = data[i + 1];
      i += 2;
      while ((data[i] & 0xe0) !== 0x20 && i < data.length) { fcw.push((data[i] << 8) | data[i + 1]); i += 2; }
    }
    const attr = data[i];
    const length = (data[i + 1] << 8) | data[i + 2];
    i += 3;
    // Attribute occupies current position; field data starts at the next one.
    const attrPos = this.addr;
    this.put(attr);
    const start = this.addr;
    if (input) {
      this.fields = this.fields.filter((f) => f.start !== start);
      this.fields.push({
        id: 0, start, length, attrPos, attr, ffw1, ffw2, fcw,
        input: true,
        bypass: (ffw1 & FFW.BYPASS) !== 0,
        mdt: (ffw1 & FFW.MDT) !== 0,
        shift: ffw1 & FFW.SHIFT_MASK,
        monocase: (ffw2 & FFW.MONOCASE) !== 0,
        adjust: ffw2 & FFW.ADJUST_MASK,
        mandatory: (ffw2 & FFW.MANDATORY_ENTER) !== 0,
      });
      this.fields.sort((a, b) => a.start - b.start);
      this.fields.forEach((f, idx) => { f.id = idx; });
    }
    return i;
  }

  put(b) {
    this.buf[this.addr] = b;
    this.addr = (this.addr + 1) % this.size;
  }

  nullField(f) { for (let k = 0; k < f.length; k++) this.buf[(f.start + k) % this.size] = 0x00; }

  // -------------------------------------------------------------- accessors
  attrAt(pos) {
    // Walk back to the most recent attribute byte (5250 attributes are positional).
    for (let p = pos; p >= 0; p--) { const b = this.buf[p]; if (b >= 0x20 && b <= 0x3f) return b; }
    return 0x20;
  }

  fieldValue(f) {
    let s = '';
    for (let k = 0; k < f.length; k++) { const b = this.buf[(f.start + k) % this.size]; s += b === 0 ? ' ' : e2a(b); }
    return s;
  }

  fieldAt(row, col) {
    const p = this.pos(row, col);
    return this.fields.find((f) => p >= f.start && p < f.start + f.length) || null;
  }

  /** Text of the screen; hidden (non-display) regions are blanked. */
  textRows({ revealHidden = false } = {}) {
    const rows = [];
    let attr = 0x20;
    for (let r = 0; r < this.rows; r++) {
      let line = '';
      for (let c = 0; c < this.cols; c++) {
        const b = this.buf[r * this.cols + c];
        if (b >= 0x20 && b <= 0x3f) { attr = b; line += ' '; continue; }
        if (!revealHidden && (attr & 0x07) === 0x07) { line += ' '; continue; }
        line += b === 0 ? ' ' : e2a(b);
      }
      rows.push(line);
    }
    return rows;
  }

  text() { return this.textRows().join('\n'); }

  inferLabel(f) {
    const { row, col } = this.rc(f.attrPos);
    const line = this.textRows()[row - 1].slice(0, col - 1);
    const parts = line.split(/\s{3,}/).map((s) => s.trim()).filter(Boolean);
    let label = parts.length ? parts[parts.length - 1] : '';
    label = label.replace(/[\s.:]+$/g, '').replace(/(\s\.)+$/g, '').trim();
    return label;
  }

  attrRuns() {
    const runs = [];
    let cur = null;
    let attr = 0x20;
    for (let p = 0; p < this.size; p++) {
      const b = this.buf[p];
      if (b >= 0x20 && b <= 0x3f) { attr = b; if (cur) { runs.push(cur); cur = null; } continue; }
      const d = decodeAttr(attr);
      if (d.color === 'green' && !d.reverse && !d.underline) { if (cur) { runs.push(cur); cur = null; } continue; }
      const { row, col } = this.rc(p);
      if (cur && cur.row === row && cur.attr === attr) cur.length++;
      else {
        if (cur) runs.push(cur);
        cur = { row, col, length: 1, attr, color: d.color, reverse: d.reverse, underline: d.underline };
      }
    }
    if (cur) runs.push(cur);
    return runs.map(({ attr, ...r }) => r);
  }

  toJSON() {
    const c = this.rc(this.cursor);
    return {
      rows: this.rows,
      cols: this.cols,
      text: this.textRows(),
      cursor: c,
      keyboardLocked: this.keyboardLocked,
      errorLine: this.errorLine,
      fields: this.fields.map((f) => {
        const { row, col } = this.rc(f.start);
        const d = decodeAttr(f.attr);
        return {
          id: f.id, row, col, length: f.length, input: true, bypass: f.bypass, hidden: d.hidden,
          numeric: [SHIFT.NUMERIC_ONLY, SHIFT.DIGITS_ONLY, SHIFT.SIGNED_NUMERIC, SHIFT.NUMERIC_SHIFT].includes(f.shift),
          value: d.hidden ? '' : this.fieldValue(f).replace(/\s+$/, ''),
          label: this.inferLabel(f), mdt: f.mdt,
        };
      }),
      attrs: this.attrRuns(),
    };
  }

  // ------------------------------------------------------------- input side
  setFieldValue(f, value) {
    if (f.bypass) throw new Error(`Field at ${JSON.stringify(this.rc(f.start))} is protected (bypass)`);
    let v = String(value ?? '');
    if (f.monocase) v = v.toUpperCase();
    if (v.length > f.length) throw new Error(`Value "${v}" exceeds field length ${f.length}`);
    for (let k = 0; k < f.length; k++) this.buf[(f.start + k) % this.size] = k < v.length ? a2e(v[k]) : 0x00;
    f.mdt = true;
    this.cursor = (f.start + Math.min(v.length, f.length - 1)) % this.size;
  }

  /** Bytes of a field as sent inbound (applies right-adjust/sign rules). */
  fieldInboundBytes(f) {
    const raw = [];
    for (let k = 0; k < f.length; k++) raw.push(this.buf[(f.start + k) % this.size]);
    let text = raw.map((b) => (b === 0 ? '\0' : e2a(b))).join('');
    if (f.shift === SHIFT.SIGNED_NUMERIC) {
      let body = text.slice(0, f.length - 1).replace(/\0/g, '').trim();
      let neg = body.startsWith('-') || body.endsWith('-');
      body = body.replace(/-/g, '');
      body = body.padStart(f.length - 1, '0');
      return Buffer.from([...body].map(a2e).concat(neg ? 0x60 : 0x40)); // sign position
    }
    if (f.adjust === ADJUST.RIGHT_ZERO || f.adjust === ADJUST.RIGHT_BLANK) {
      const body = text.replace(/\0/g, '').trim();
      text = body.padStart(f.length, f.adjust === ADJUST.RIGHT_ZERO ? '0' : ' ');
      return Buffer.from([...text].map(a2e));
    }
    // Strip trailing nulls; interior nulls become blanks.
    const trimmed = text.replace(/\0+$/, '').replace(/\0/g, ' ');
    return Buffer.from([...trimmed].map(a2e));
  }

  /** Build the inbound data for a read command. */
  buildReadResponse(aidCode, { all = false } = {}) {
    const c = this.rc(this.cursor);
    const out = [c.row, c.col, aidCode];
    for (const f of this.fields) {
      if (!f.input || f.bypass) continue;
      if (!all && !f.mdt) continue;
      const { row, col } = this.rc(f.start);
      out.push(0x11, row, col, ...this.fieldInboundBytes(f));
    }
    return Buffer.from(out);
  }

  /** Serialize the screen to an outbound stream so it can be restored (Save Screen). */
  serialize() {
    const out = [ESC, CMD.CLEAR_UNIT, ESC, CMD.WRITE_TO_DISPLAY, 0x00, 0x00];
    for (const f of this.fields) {
      const { row, col } = this.rc(f.attrPos);
      out.push(ORDER.SBA, row, col, ORDER.SF, f.ffw1 | (f.mdt ? FFW.MDT : 0), f.ffw2);
      for (const w of f.fcw) out.push(w >> 8, w & 0xff);
      out.push(f.attr, f.length >> 8, f.length & 0xff);
    }
    out.push(ORDER.SBA, 1, 1);
    for (const b of this.buf) out.push(b === ESC || (b > 0 && b < 0x20) ? 0x40 : b);
    const c = this.rc(this.cursor);
    out.push(ORDER.IC, c.row, c.col);
    return Buffer.from(out);
  }
}
