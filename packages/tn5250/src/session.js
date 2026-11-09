import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { TelnetCodec } from './telnet.js';
import { Screen } from './screen.js';
import { buildRecord, parseRecord } from './records.js';
import { OPCODE, CMD, AID, HDR_FLAG, READ_CMDS } from './constants.js';
import { strToEbcdic } from './ebcdic.js';

/**
 * A TN5250 client session (headless emulator).
 *
 *   const s = new Session({ host, port });
 *   await s.connect();
 *   s.fill({ label: 'User' }, 'TESTER');
 *   await s.press('Enter');
 *   console.log(s.screen.text());
 */
export class Session extends EventEmitter {
  constructor({ host, port = 23, tls: useTls = false, deviceName = '', terminalType = 'IBM-3179-2',
    connectTimeout = 15000, readyTimeout = 30000, settleMs = 60, rejectUnauthorized = false, log = null } = {}) {
    super();
    Object.assign(this, { host, port, useTls, deviceName, terminalType, connectTimeout, readyTimeout, settleMs, rejectUnauthorized });
    this.screen = new Screen(24, 80);
    this.log = log;
    this.ready = false;
    this.closed = false;
    this.lastAid = null;
    this._settleTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const opts = { host: this.host, port: this.port };
      const sock = this.useTls
        ? tls.connect({ ...opts, rejectUnauthorized: this.rejectUnauthorized, servername: this.host })
        : net.connect(opts);
      this.sock = sock;
      const timer = setTimeout(() => { sock.destroy(); reject(new Error(`Connect timeout ${this.host}:${this.port}`)); }, this.connectTimeout);
      this.codec = new TelnetCodec({
        role: 'client', terminalType: this.terminalType,
        env: { DEVNAME: this.deviceName },
        write: (b) => sock.write(b),
      });
      this.codec.on('record', (r) => this._onRecord(r));
      sock.on('data', (d) => this.codec.feed(d));
      sock.on('error', (e) => { clearTimeout(timer); this.emit('error', e); reject(e); });
      sock.on('close', () => { this.closed = true; this.emit('close'); });
      this.waitForReady(this.connectTimeout)
        .then(() => { clearTimeout(timer); resolve(this); })
        .catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  _onRecord(rec) {
    const r = parseRecord(rec);
    if (!r) return;
    this.log?.('recv', r.opcode, r.data.length);
    if (r.opcode === OPCODE.CANCEL_INVITE) { this.screen.pendingRead = null; return; }
    if (r.opcode === OPCODE.MSG_LIGHT_ON) { this.screen.messageWaiting = true; return; }
    if (r.opcode === OPCODE.MSG_LIGHT_OFF) { this.screen.messageWaiting = false; return; }
    const cmds = this.screen.apply(r.data);

    // Commands that need an immediate reply
    if (cmds.includes(CMD.SAVE_SCREEN) || cmds.includes(CMD.SAVE_PARTIAL_SCREEN)) {
      this._send(buildRecord(OPCODE.SAVE_SCREEN, this.screen.serialize()));
    }
    if (cmds.wsf && cmds.wsf[2] === 0xd9 && cmds.wsf[3] === 0x70) this._sendQueryReply();
    const rc = this.screen.pendingRead?.cmd;
    if (rc === CMD.READ_IMMEDIATE || rc === CMD.READ_IMMEDIATE_ALT) {
      this.screen.pendingRead = null;
      this._send(buildRecord(OPCODE.PUT_GET, this.screen.buildReadResponse(0x00, { all: false }).subarray(0)));
    } else if (rc === CMD.READ_SCREEN) {
      this.screen.pendingRead = null;
      this._send(buildRecord(OPCODE.PUT_GET, Buffer.from(this.screen.buf)));
    }

    if (this.screen.pendingRead && READ_CMDS.has(this.screen.pendingRead.cmd)) {
      this.screen.keyboardLocked = false;
      clearTimeout(this._settleTimer);
      this._settleTimer = setTimeout(() => {
        if (!this.screen.pendingRead) return;
        this.ready = true;
        this.emit('ready', this.screen);
      }, this.settleMs);
    }
    this.emit('screen', this.screen);
  }

  _sendQueryReply() {
    // 5250 Query reply: identifies us as a 3179-2 capable emulator.
    const d = Buffer.alloc(67, 0);
    d[2] = AID.InboundWSF; d[3] = 0x00; d[4] = 0x40; d[5] = 0xd9; d[6] = 0x70; d[7] = 0x80;
    d[8] = 0x06; d[9] = 0x00; d[10] = 0x01; d[11] = 0x01; d[12] = 0x00;
    d[29] = 0x01; strToEbcdic('3179').copy(d, 30); strToEbcdic('002').copy(d, 34);
    d[37] = 0x02; d[41] = 0x61; d[42] = 0x50; d[44] = 0x01; d[45] = 0x00; d[49] = 0x23; d[50] = 0x31;
    this._send(buildRecord(OPCODE.NO_OP, d));
  }

  _send(rec) {
    if (this.closed) throw new Error('Session is closed');
    this.codec.sendRecord(rec);
  }

  /** Resolve when the host is waiting for input (a read is pending and output settled). */
  waitForReady(timeout = this.readyTimeout) {
    if (this.ready) return Promise.resolve(this.screen);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.off('ready', on); reject(new Error(`Timed out after ${timeout}ms waiting for host (keyboard locked)`)); }, timeout);
      const on = () => { clearTimeout(t); resolve(this.screen); };
      this.once('ready', on);
    });
  }

  /** Resolve a field locator: {row,col} | {label} | {index} | field object. */
  findField(loc) {
    const s = this.screen;
    const inputs = s.fields.filter((f) => f.input && !f.bypass);
    if (loc == null) throw new Error('Field locator required');
    if (typeof loc === 'object' && 'start' in loc) return loc;
    if (loc.row != null && loc.col != null) {
      const f = s.fieldAt(loc.row, loc.col);
      if (!f) throw new Error(`No input field at row ${loc.row}, col ${loc.col}`);
      return f;
    }
    if (loc.index != null) {
      const f = inputs[loc.index];
      if (!f) throw new Error(`No input field #${loc.index} (screen has ${inputs.length})`);
      return f;
    }
    if (loc.label != null) {
      const want = String(loc.label).toLowerCase().trim();
      const withLabels = inputs.map((f) => ({ f, label: s.inferLabel(f).toLowerCase() }));
      const hit = withLabels.find((x) => x.label === want) || withLabels.find((x) => x.label.startsWith(want)) || withLabels.find((x) => x.label.includes(want));
      if (!hit) throw new Error(`No input field labelled "${loc.label}". Labels on screen: ${withLabels.map((x) => JSON.stringify(x.label)).join(', ')}`);
      return hit.f;
    }
    throw new Error(`Bad field locator ${JSON.stringify(loc)}`);
  }

  fill(loc, value) {
    const f = this.findField(loc);
    this.screen.setFieldValue(f, value);
    this.emit('screen', this.screen);
    return f;
  }

  setCursor(row, col) { this.screen.cursor = this.screen.pos(row, col); }

  /** Press an AID key (Enter, F1..F24, PageUp, PageDown, Help, Clear, Print) or Attn/SysReq. */
  async press(key, { wait = true, timeout = this.readyTimeout } = {}) {
    this.lastAid = key;
    this.ready = false;
    this.screen.keyboardLocked = true;
    if (key === 'Attn' || key === 'SysReq') {
      this._send(buildRecord(OPCODE.NO_OP, Buffer.alloc(0), key === 'Attn' ? HDR_FLAG.ATN : HDR_FLAG.SRQ));
    } else {
      const code = AID[key];
      if (code == null) throw new Error(`Unknown key "${key}"`);
      const pr = this.screen.pendingRead;
      if (!pr) throw new Error('Host is not accepting input (no read pending)');
      const all = pr.cmd === CMD.READ_INPUT_FIELDS;
      const sendsData = !['Clear', 'Help', 'Print'].includes(key);
      const data = sendsData ? this.screen.buildReadResponse(code, { all }) : Buffer.from([...this.screen.buildReadResponse(code).subarray(0, 3)]);
      this.screen.pendingRead = null;
      this._send(buildRecord(OPCODE.PUT_GET, data));
    }
    this.emit('aid', key);
    if (wait) await this.waitForReady(timeout);
    return this.screen;
  }

  /** Poll until predicate(screen) is true. */
  async waitUntil(pred, { timeout = this.readyTimeout, interval = 100 } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (pred(this.screen)) return this.screen;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  close() {
    this.closed = true;
    try { this.sock?.end(); this.sock?.destroy(); } catch { /* ignore */ }
  }
}
