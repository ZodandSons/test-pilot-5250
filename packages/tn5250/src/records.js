import { RECORD_TYPE_GDS, ESC, CMD, ORDER, OPCODE } from './constants.js';
import { a2e, ebcdicToStr } from './ebcdic.js';

/** Build a 5250 GDS record (without telnet framing). */
export function buildRecord(opcode, data = Buffer.alloc(0), flags = 0) {
  const len = 10 + data.length;
  const hdr = Buffer.from([len >> 8, len & 0xff, RECORD_TYPE_GDS >> 8, RECORD_TYPE_GDS & 0xff, 0, 0, 0x04, flags, 0, opcode]);
  return Buffer.concat([hdr, Buffer.from(data)]);
}

export function parseRecord(rec) {
  if (rec.length < 10) return null;
  const type = (rec[2] << 8) | rec[3];
  const varLen = rec[6];
  return {
    length: (rec[0] << 8) | rec[1],
    type,
    flags: rec[7],
    opcode: rec[6 + varLen - 1],
    data: rec.subarray(6 + varLen),
  };
}

/** Parse an inbound (workstation -> host) response to a read command. */
export function parseInbound(data) {
  if (data.length < 3) return { cursor: null, aid: null, fields: [] };
  const cursor = { row: data[0], col: data[1] };
  const aid = data[2];
  const fields = [];
  let i = 3;
  while (i < data.length) {
    if (data[i] === 0x11) {
      const row = data[i + 1], col = data[i + 2];
      i += 3;
      const start = i;
      while (i < data.length && data[i] !== 0x11) i++;
      fields.push({ row, col, value: ebcdicToStr(data.subarray(start, i)) });
    } else i++;
  }
  return { cursor, aid, fields };
}

/**
 * Fluent builder for outbound 5250 data streams (host -> workstation).
 * Used by the simulator and by unit tests.
 */
export class StreamBuilder {
  constructor() { this.bytes = []; }
  push(...b) { this.bytes.push(...b); return this; }
  clearUnit() { return this.push(ESC, CMD.CLEAR_UNIT); }
  clearFormatTable() { return this.push(ESC, CMD.CLEAR_FORMAT_TABLE); }
  wtd(cc1 = 0x00, cc2 = 0x18) { return this.push(ESC, CMD.WRITE_TO_DISPLAY, cc1, cc2); }
  soh() { return this.push(ORDER.SOH, 0x07, 0x00, 0x00, 0x00, 0x18, 0x00, 0x00, 0x00); }
  sba(row, col) { return this.push(ORDER.SBA, row, col); }
  ic(row, col) { return this.push(ORDER.IC, row, col); }
  attr(a) { return this.push(a); }
  text(s) { for (const ch of s) this.push(a2e(ch)); return this; }
  /** Write text at row/col with an optional leading attribute. */
  at(row, col, s, attr = null) {
    if (attr != null) { this.sba(row, col > 1 ? col - 1 : col); this.push(attr); if (col === 1) this.sba(row, 2); }
    else this.sba(row, col);
    return this.text(s);
  }
  /**
   * Start an input field whose data begins at (row, col); the attribute byte goes at col-1.
   * opts: { length, ffw1, ffw2, attr, value }
   */
  inputField(row, col, { length, ffw1 = 0x40, ffw2 = 0x00, attr = 0x24, value = '' }) {
    this.sba(row, col - 1).push(ORDER.SF, ffw1, ffw2, attr, length >> 8, length & 0xff);
    if (value) this.text(String(value).slice(0, length));
    // terminating attribute after the field
    const endCol = col + length;
    if (endCol <= 80) this.sba(row, endCol).push(0x20);
    return this;
  }
  /** Repeat `ch` from (row,col) through (toRow,toCol) inclusive. */
  repeat(row, col, toRow, toCol, ch) { return this.sba(row, col).push(ORDER.RA, toRow, toCol, a2e(ch)); }
  readMdt(cc1 = 0x00, cc2 = 0x00) { return this.push(ESC, CMD.READ_MDT_FIELDS, cc1, cc2); }
  errorCode(msg) { this.push(ESC, CMD.WRITE_ERROR_CODE, 0x21); this.text(msg); return this.push(0x20); }
  build() { return Buffer.from(this.bytes); }
  record(opcode = OPCODE.PUT_GET, flags = 0) { return buildRecord(opcode, this.build(), flags); }
}
