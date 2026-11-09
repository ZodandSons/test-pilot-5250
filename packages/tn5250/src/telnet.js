import { EventEmitter } from 'node:events';
import { TN } from './constants.js';

/**
 * Telnet framing for TN5250. Handles option negotiation and splits the
 * byte stream into EOR-terminated records (with IAC IAC unescaped).
 * Works for both the client side (emulator) and the server side (simulator).
 */
export class TelnetCodec extends EventEmitter {
  constructor({ role = 'client', terminalType = 'IBM-3179-2', env = {}, write }) {
    super();
    this.role = role;
    this.terminalType = terminalType;
    this.env = env; // { DEVNAME: 'QPADEV0001', ... } sent as USERVARs
    this.write = write;
    this.buf = [];
    this.state = 'data';
    this.sb = [];
    this.cmd = 0;
    this.receivedTerminalType = null;
    this.receivedEnv = {};
  }

  send(bytes) { this.write(Buffer.from(bytes)); }

  /** Frame a 5250 record: escape 0xFF and append IAC EOR. */
  sendRecord(record) {
    const out = [];
    for (const b of record) { out.push(b); if (b === TN.IAC) out.push(TN.IAC); }
    out.push(TN.IAC, TN.EOR);
    this.send(out);
  }

  feed(chunk) {
    for (const b of chunk) {
      switch (this.state) {
        case 'data':
          if (b === TN.IAC) this.state = 'iac'; else this.buf.push(b);
          break;
        case 'iac':
          if (b === TN.IAC) { this.buf.push(TN.IAC); this.state = 'data'; }
          else if (b === TN.EOR) { this.emit('record', Buffer.from(this.buf)); this.buf = []; this.state = 'data'; }
          else if (b === TN.DO || b === TN.DONT || b === TN.WILL || b === TN.WONT) { this.cmd = b; this.state = 'opt'; }
          else if (b === TN.SB) { this.sb = []; this.state = 'sb'; }
          else this.state = 'data';
          break;
        case 'opt':
          this.negotiate(this.cmd, b);
          this.state = 'data';
          break;
        case 'sb':
          if (b === TN.IAC) this.state = 'sbiac'; else this.sb.push(b);
          break;
        case 'sbiac':
          if (b === TN.SE) { this.subnegotiation(this.sb); this.state = 'data'; }
          else { this.sb.push(b); this.state = 'sb'; }
          break;
      }
    }
  }

  negotiate(cmd, opt) {
    const supported = [TN.OPT_BINARY, TN.OPT_EOR, TN.OPT_TERMINAL_TYPE, TN.OPT_NEW_ENVIRON];
    if (this.role === 'client') {
      if (cmd === TN.DO) this.send([TN.IAC, supported.includes(opt) ? TN.WILL : TN.WONT, opt]);
      else if (cmd === TN.WILL) this.send([TN.IAC, [TN.OPT_BINARY, TN.OPT_EOR].includes(opt) ? TN.DO : TN.DONT, opt]);
    } else {
      // server: we initiated; once the client agreed to TERMINAL-TYPE, ask for it
      if (cmd === TN.WILL && opt === TN.OPT_TERMINAL_TYPE) {
        this.send([TN.IAC, TN.SB, TN.OPT_TERMINAL_TYPE, TN.TT_SEND, TN.IAC, TN.SE]);
      }
      if (cmd === TN.WILL && opt === TN.OPT_NEW_ENVIRON) {
        this.send([TN.IAC, TN.SB, TN.OPT_NEW_ENVIRON, TN.ENV_SEND, TN.IAC, TN.SE]);
      }
      this.emit('negotiated', cmd, opt);
    }
  }

  subnegotiation(sb) {
    const [opt, kind, ...rest] = sb;
    if (this.role === 'client') {
      if (opt === TN.OPT_TERMINAL_TYPE && kind === TN.TT_SEND) {
        this.send([TN.IAC, TN.SB, TN.OPT_TERMINAL_TYPE, TN.TT_IS, ...Buffer.from(this.terminalType, 'ascii'), TN.IAC, TN.SE]);
      } else if (opt === TN.OPT_NEW_ENVIRON && kind === TN.ENV_SEND) {
        const out = [TN.IAC, TN.SB, TN.OPT_NEW_ENVIRON, TN.ENV_IS];
        for (const [k, v] of Object.entries(this.env)) {
          if (v == null || v === '') continue;
          out.push(TN.ENV_USERVAR, ...Buffer.from(k, 'ascii'), TN.ENV_VALUE, ...Buffer.from(String(v), 'ascii'));
        }
        out.push(TN.IAC, TN.SE);
        this.send(out);
      }
    } else {
      if (opt === TN.OPT_TERMINAL_TYPE && kind === TN.TT_IS) {
        this.receivedTerminalType = Buffer.from(rest).toString('ascii');
        this.emit('terminalType', this.receivedTerminalType);
      } else if (opt === TN.OPT_NEW_ENVIRON && kind === TN.ENV_IS) {
        let i = 0, key = null, cur = [], mode = null;
        const flush = () => {
          if (mode === 'key') key = Buffer.from(cur).toString('ascii');
          else if (mode === 'val' && key) this.receivedEnv[key] = Buffer.from(cur).toString('ascii');
          cur = [];
        };
        while (i < rest.length) {
          const b = rest[i++];
          if (b === TN.ENV_VAR || b === TN.ENV_USERVAR) { flush(); mode = 'key'; }
          else if (b === TN.ENV_VALUE) { flush(); mode = 'val'; }
          else cur.push(b);
        }
        flush();
        this.emit('env', this.receivedEnv);
      }
    }
  }

  /** Server: begin TN5250 negotiation. */
  startServerNegotiation() {
    this.send([TN.IAC, TN.DO, TN.OPT_NEW_ENVIRON]);
    this.send([TN.IAC, TN.DO, TN.OPT_TERMINAL_TYPE]);
    this.send([TN.IAC, TN.DO, TN.OPT_EOR, TN.IAC, TN.WILL, TN.OPT_EOR]);
    this.send([TN.IAC, TN.DO, TN.OPT_BINARY, TN.IAC, TN.WILL, TN.OPT_BINARY]);
  }
}
