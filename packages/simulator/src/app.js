import { StreamBuilder, parseRecord, parseInbound, OPCODE, HDR_FLAG, AID_NAME, ATTR } from '@tp5250/tn5250';
import { CoverageProbe, CoverageTracker } from './coverage.js';
import { freshData, editAmount } from './data.js';

const PAGE = 12;

/** Builds one full-screen 5250 output record. */
class Painter {
  constructor() {
    this.b = new StreamBuilder().clearUnit().wtd(0x00, 0x18);
    this.defs = [];
    this.cursor = null;
  }
  text(row, col, s, attr = null) {
    if (attr == null) this.b.sba(row, col).text(s);
    else {
      this.b.sba(row, col - 1).attr(attr).text(s);
      if (col + s.length <= 80) this.b.attr(ATTR.GREEN);
    }
    return this;
  }
  input(key, row, col, length, { value = '', numeric = false, hidden = false, error = false, monocase = true, rightZero = false } = {}) {
    const ffw1 = 0x40 | (numeric ? 0x03 : 0x00);
    const ffw2 = (monocase ? 0x20 : 0) | (rightZero ? 0x05 : 0);
    const attr = hidden ? ATTR.NONDISPLAY : error ? 0x25 : ATTR.GREEN_UL;
    this.b.inputField(row, col, { length, ffw1, ffw2, attr, value: hidden ? '' : String(value ?? '') });
    this.defs.push({ key, row, col, length });
    if (error && !this.cursor) this.cursor = { row, col };
    return this;
  }
  at(row, col) { this.cursor = { row, col }; return this; }
  record() {
    const first = this.defs[0];
    const c = this.cursor || (first ? { row: first.row, col: first.col } : { row: 1, col: 1 });
    this.b.ic(c.row, c.col).readMdt();
    return this.b.record(OPCODE.PUT_GET);
  }
}

function header(p, pgm, title, sys) {
  p.text(1, 2, pgm.padEnd(10));
  p.text(1, Math.floor((80 - title.length) / 2), title, ATTR.WHITE);
  p.text(1, 71, sys.padStart(9));
}

/** One interactive job on the simulated IBM i. */
export class AppSession {
  constructor({ send, close, registry, hub, config, device }) {
    Object.assign(this, { send, close, registry, hub, config, device });
    this.data = freshData();
    this.probe = new CoverageProbe(registry);
    this.state = 'signon';
    this.vals = {};
    this.msg = '';
    this.user = null;
    this.codecov = null; // active CODECOV tracker
    this.programStack = [];
  }

  get sys() { return this.config.systemName; }

  show(p) { this.defs = p.defs; this.send(p.record()); }

  start() { this.renderSignon(); }

  onRecord(rec) {
    const r = parseRecord(rec);
    if (!r) return;
    if (r.flags & (HDR_FLAG.ATN | HDR_FLAG.SRQ)) { this.rerender(); return; }
    if (r.data.length >= 3 && r.data[2] === 0x88) return; // query reply
    const inb = parseInbound(r.data);
    const aid = AID_NAME[inb.aid] || 'Unknown';
    const values = {};
    for (const f of inb.fields) {
      const d = (this.defs || []).find((x) => x.row === f.row && x.col === f.col);
      if (d) values[d.key] = f.value.replace(/\s+$/, '');
    }
    try {
      this.dispatch(aid, values);
    } catch (e) {
      console.error('[sim] error', e);
      this.msg = `Simulator error: ${e.message}`.slice(0, 70);
      this.rerender();
    }
  }

  dispatch(aid, v) {
    switch (this.state) {
      case 'signon': return this.onSignon(aid, v);
      case 'menu': return this.onMenu(aid, v);
      case 'ordinq.prompt': return this.onOrdPrompt(aid, v);
      case 'ordinq.list': return this.onOrdList(aid, v);
      case 'ordinq.detail': return this.onOrdDetail(aid, v);
      case 'custinq.prompt': return this.onCustPrompt(aid, v);
      case 'custinq.detail': return this.onCustDetail(aid, v);
    }
  }

  rerender() {
    const m = {
      signon: () => this.renderSignon(), menu: () => this.renderMenu(),
      'ordinq.prompt': () => this.renderOrdPrompt(), 'ordinq.list': () => this.renderOrdList(),
      'ordinq.detail': () => this.renderOrdDetail(), 'custinq.prompt': () => this.renderCustPrompt(),
      'custinq.detail': () => this.renderCustDetail(),
    };
    m[this.state]();
  }

  // ================================================================ sign on
  renderSignon(error = null) {
    this.state = 'signon';
    const p = new Painter();
    p.text(1, 36, 'Sign On', ATTR.WHITE);
    p.text(2, 48, `System  . . . . . :   ${this.sys}`);
    p.text(3, 48, 'Subsystem . . . . :   QINTER');
    p.text(4, 48, `Display . . . . . :   ${this.device}`);
    p.text(6, 18, 'User  . . . . . . . . . . . . . .');
    p.input('user', 6, 54, 10);
    p.text(7, 18, 'Password  . . . . . . . . . . . .');
    p.input('password', 7, 54, 10, { hidden: true, monocase: false });
    p.text(8, 18, 'Program/procedure . . . . . . . .');
    p.input('program', 8, 54, 10);
    p.text(9, 18, 'Menu  . . . . . . . . . . . . . .');
    p.input('menu', 9, 54, 10);
    p.text(10, 18, 'Current library . . . . . . . . .');
    p.input('curlib', 10, 54, 10);
    p.text(22, 24, 'TestPilot 5250 - IBM i Simulator', ATTR.BLUE);
    if (error) p.b.errorCode(error);
    this.show(p);
  }

  onSignon(aid, v) {
    if (aid !== 'Enter') return this.renderSignon();
    const user = (v.user || '').toUpperCase();
    const users = this.config.users;
    if (!user) return this.renderSignon('CPF1124 - User profile name required.');
    if (!users[user]) return this.renderSignon(`CPF1120 - User ${user} does not exist.`);
    if (users[user] !== (v.password || '')) return this.renderSignon('CPF1107 - Password not correct for user profile.');
    this.user = user;
    const program = (v.program || '').toUpperCase();
    if (program === 'ORDINQ' || program === 'CUSTINQ') { this.returnTo = 'signoff'; return this.callProgram(program); }
    this.menuStart();
  }

  // =================================================================== menu
  menuStart() {
    this.probe.range('ORDMNU', 'ADDLIBLE', 'MONMSG     MSGID(CPF2103)');
    this.menuLoop();
  }

  menuLoop() {
    this.probe.hit('ORDMNU', 'LOOP:');
    this.probe.hit('ORDMNU', 'SNDRCVF');
    this.renderMenu();
  }

  renderMenu() {
    this.state = 'menu';
    const p = new Painter();
    header(p, 'ORDMNU', 'Order Management System', this.sys);
    p.text(3, 2, 'Select one of the following:');
    p.text(5, 6, '1. Order inquiry');
    p.text(6, 6, '2. Customer inquiry');
    p.text(8, 5, '90. Sign off');
    p.text(19, 2, 'Selection or command');
    p.text(20, 2, '===>');
    p.input('cmd', 20, 7, 153, { monocase: false }); // spans rows 20-21 like a real IBM i command line
    p.text(22, 2, 'F3=Exit   F12=Cancel', ATTR.BLUE);
    if (this.msg) p.text(23, 2, this.msg.slice(0, 78), ATTR.WHITE);
    this.msg = '';
    this.show(p);
  }

  onMenu(aid, v) {
    const M = 'ORDMNU';
    this.probe.hit(M, 'CHGVAR     VAR(&MSG)');
    this.probe.hit(M, 'IF         COND(&IN03');
    if (aid === 'F3' || aid === 'F12') {
      this.probe.range(M, "CHGVAR     VAR(&DONE) VALUE('1')", 'GOTO       CMDLBL(LOOP)');
      this.probe.hit(M, 'LOOP:');
      this.probe.hit(M, 'END:');
      return this.signoff();
    }
    const opt = (v.cmd || '').trim();
    this.probe.hit(M, 'SELECT');
    this.probe.hit(M, "WHEN       COND(&OPT *EQ '1')");
    if (opt === '1') { this.returnTo = 'menu'; return this.callProgram('ORDINQ'); }
    this.probe.hit(M, "WHEN       COND(&OPT *EQ '2')");
    if (opt === '2') { this.returnTo = 'menu'; return this.callProgram('CUSTINQ'); }
    this.probe.hit(M, "WHEN       COND(&OPT *EQ '90')");
    if (opt === '90') return this.signoff();
    this.probe.hit(M, "WHEN       COND(&OPT *NE ' ')");
    if (opt) {
      this.probe.range(M, 'QCMDEXC', 'MONMSG     MSGID(CPF0000)');
      return this.runCommand(opt);
    }
    this.menuNext();
  }

  menuNext() {
    this.probe.range('ORDMNU', "CHGVAR     VAR(&OPT) VALUE(' ')", 'GOTO       CMDLBL(LOOP)');
    this.menuLoop();
  }

  runCommand(cmd) {
    const u = cmd.toUpperCase().trim();
    const call = u.match(/^CALL\s+(?:PGM\()?(?:\*?LIBL\/|ORDLIB\/)?(\w+)\)?/);
    if (call) {
      const pgm = call[1];
      if (pgm === 'ORDINQ' || pgm === 'CUSTINQ') { this.returnTo = 'menu'; return this.callProgram(pgm); }
      this.msg = `CPD0170 - Program ${pgm} in library *LIBL not found.`;
      return this.menuNext();
    }
    if (/^(QDEVTOOLS\/)?CODECOV\b/.test(u)) return this.codecovCommand(cmd);
    if (u === 'SIGNOFF') return this.signoff();
    this.msg = 'Selection or command is not valid.';
    this.menuNext();
  }

  /** Simulates QDEVTOOLS/CODECOV CMD(...) MODULE((...)) TESTID(...) */
  codecovCommand(cmd) {
    const param = (name) => {
      const i = cmd.toUpperCase().indexOf(name + '(');
      if (i < 0) return null;
      let depth = 0, j = i + name.length;
      for (; j < cmd.length; j++) {
        if (cmd[j] === '(') depth++;
        else if (cmd[j] === ')') { depth--; if (depth === 0) break; }
      }
      return cmd.slice(i + name.length + 1, j);
    };
    const inner = param('CMD');
    if (!inner) { this.msg = 'CPD0071 - Parameter CMD required.'; return this.menuNext(); }
    const modules = [...(param('MODULE') || '').matchAll(/\(\s*([\w/]+)/g)].map((m) => m[1].split('/').pop().toUpperCase());
    const testId = (param('TESTID') || `RDICODECOV_${Math.floor(Date.now() / 1000)}`).replace(/['"]/g, '');
    this.codecov = new CoverageTracker(this.registry, { programs: modules.length ? modules : null, id: testId });
    this.probe.add(this.codecov);
    this.runCommand(inner);
  }

  finishCodecov() {
    if (!this.codecov) return;
    this.probe.remove(this.codecov);
    const rep = this.codecov.report();
    this.hub.storeResult(rep.id, rep);
    this.msg = `Created code coverage result file (/home/${this.user}/${rep.id}.cczip).`;
    this.codecov = null;
  }

  callProgram(pgm) {
    if (pgm === 'ORDINQ') return this.ordStart();
    if (pgm === 'CUSTINQ') return this.custStart();
  }

  programReturned() {
    this.finishCodecov();
    if (this.returnTo === 'signoff') return this.signoff();
    this.menuNext();
  }

  signoff() {
    this.finishCodecov();
    this.user = null;
    this.data = freshData();
    this.renderSignon();
  }

  // ================================================================= ORDINQ
  ordStart() {
    this.ord = { custno: '', orders: [], page: 0, queue: [], detail: null, err: false };
    this.ordPromptLoop();
  }

  ordPromptLoop() {
    this.probe.hit('ORDINQ', 'dow not done;');
    this.probe.hit('ORDINQ', 'exfmt PROMPT;');
    this.renderOrdPrompt();
  }

  renderOrdPrompt() {
    this.state = 'ordinq.prompt';
    const p = new Painter();
    header(p, 'ORDINQ', 'Order Inquiry', this.sys);
    p.text(3, 2, 'Type customer number, press Enter.', ATTR.BLUE);
    p.text(5, 4, 'Customer number . . . . .');
    p.input('custno', 5, 31, 5, { numeric: true, value: this.ord.custno, error: this.ord.err });
    p.text(22, 2, 'F3=Exit   F12=Cancel', ATTR.BLUE);
    if (this.msg) p.text(23, 2, this.msg, ATTR.RED);
    this.msg = '';
    this.show(p);
  }

  ordEnd() {
    this.probe.hit('ORDINQ', 'dow not done;');
    this.probe.range('ORDINQ', '*inlr = *on;', 'return;');
    this.programReturned();
  }

  onOrdPrompt(aid, v) {
    const P = 'ORDINQ';
    if (v.custno !== undefined) this.ord.custno = v.custno.trim();
    this.probe.range(P, 'msg = *blanks;', 'ind.errCust = *off;');
    this.ord.err = false;
    this.probe.hit(P, 'if ind.exit or ind.cancel;');
    if (aid === 'F3' || aid === 'F12') {
      this.probe.range(P, 'done = *on;', 'iter;', { after: 'if ind.exit or ind.cancel;' });
      return this.ordEnd();
    }
    if (aid !== 'Enter') return this.ordPromptLoop();
    const custno = Number(this.ord.custno || 0);
    this.probe.hit(P, 'if custno = 0;');
    if (!custno) {
      this.probe.range(P, "msg = 'Customer number is required.';", 'iter;');
      this.msg = 'Customer number is required.'; this.ord.err = true;
      return this.ordPromptLoop();
    }
    this.probe.range(P, 'chain custno CUSTMAST;', 'if not %found(CUSTMAST);');
    const cust = this.data.customers[custno];
    if (!cust) {
      this.probe.range(P, "msg = 'Customer ' + %char(custno)", 'iter;');
      this.msg = `Customer ${custno} not found.`; this.ord.err = true;
      return this.ordPromptLoop();
    }
    this.probe.hit(P, "if cmstat = 'H';");
    if (cust.stat === 'H') {
      this.probe.range(P, "msg = 'Customer is on credit hold.", 'iter;');
      this.msg = 'Customer is on credit hold. Contact credit dept.'; this.ord.err = true;
      return this.ordPromptLoop();
    }
    this.ord.cust = { custno, ...cust };
    this.probe.hit(P, 'loadOrders();');
    this.ordLoad();
    this.probe.hit(P, 'showOrders();');
    this.ordListLoop();
  }

  ordLoad() {
    const P = 'ORDINQ';
    this.probe.range(P, 'ind.sflClr = *on;', 'reade custno ORDHDRL1;');
    this.ord.orders = this.data.orders.filter((o) => o.cust === this.ord.cust.custno);
    for (let i = 0; i < this.ord.orders.length; i++) this.probe.range(P, 'dow not %eof(ORDHDRL1);', 'enddo;');
    this.probe.hit(P, 'dow not %eof(ORDHDRL1);');
    this.probe.range(P, 'ind.sflDsp = (rrn > 0);', 'ind.sflEnd = *on;');
    this.ord.page = 0;
  }

  ordListLoop() {
    this.probe.range('ORDINQ', 'dow not back;', 'exfmt ORDCTL;');
    this.renderOrdList();
  }

  renderOrdList() {
    this.state = 'ordinq.list';
    const p = new Painter();
    p.text(1, 2, 'ORDINQ');
    p.text(1, 30, 'Orders for Customer', ATTR.WHITE);
    p.text(1, 51, String(this.ord.cust.custno));
    p.text(1, 58, this.ord.cust.name.slice(0, 22));
    p.text(3, 2, 'Type options, press Enter.', ATTR.BLUE);
    p.text(4, 4, '4=Cancel order   5=Display', ATTR.BLUE);
    p.text(6, 2, 'Opt  Order     Date                 Amount  Status', ATTR.WHITE);
    const start = this.ord.page * PAGE;
    const rows = this.ord.orders.slice(start, start + PAGE);
    rows.forEach((o, i) => {
      const r = 8 + i;
      p.input(`opt:${start + i}`, r, 3, 1);
      p.text(r, 7, String(o.ordno));
      p.text(r, 17, o.date);
      p.text(r, 30, editAmount(o.amt).padStart(14));
      p.text(r, 46, o.stat.padEnd(10));
    });
    if (!rows.length) p.text(8, 7, '(No orders found)');
    const more = start + PAGE < this.ord.orders.length;
    p.text(20, 72, more ? 'More...' : 'Bottom');
    p.text(22, 2, 'F3=Exit   F12=Cancel', ATTR.BLUE);
    if (this.msg) p.text(23, 2, this.msg, ATTR.RED);
    this.msg = '';
    this.show(p);
  }

  onOrdList(aid, v) {
    const P = 'ORDINQ';
    if (aid === 'PageDown' || aid === 'PageUp') {
      const maxPage = Math.max(0, Math.ceil(this.ord.orders.length / PAGE) - 1);
      const next = this.ord.page + (aid === 'PageDown' ? 1 : -1);
      if (next < 0 || next > maxPage) this.msg = 'Roll up or down past the first or last record in file.';
      else this.ord.page = next;
      return this.renderOrdList();
    }
    this.probe.hit(P, 'msg = *blanks;', { after: 'exfmt ORDCTL;' });
    this.probe.hit(P, 'if ind.exit;');
    if (aid === 'F3') {
      this.probe.range(P, 'done = *on;', 'return;', { after: 'if ind.exit;' });
      this.probe.hit(P, 'enddo;', { after: 'showOrders();' });
      return this.ordEnd();
    }
    this.probe.hit(P, 'if ind.cancel;', { after: 'dcl-proc showOrders' });
    if (aid === 'F12') {
      this.probe.range(P, 'back = *on;', 'iter;');
      this.probe.hit(P, 'enddo;', { after: 'readc ORDSFL;', n: 2 });
      this.probe.hit(P, 'dow not back;');
      this.probe.hit(P, 'enddo;', { after: 'showOrders();' });
      return this.ordPromptLoop();
    }
    this.probe.hit(P, 'readc ORDSFL;');
    this.ord.queue = Object.entries(v)
      .filter(([k, val]) => k.startsWith('opt:') && val.trim())
      .map(([k, val]) => ({ idx: Number(k.slice(4)), opt: val.trim() }))
      .sort((a, b) => a.idx - b.idx);
    this.ordProcessQueue();
  }

  ordProcessQueue() {
    const P = 'ORDINQ';
    while (this.ord.queue.length) {
      const { idx, opt } = this.ord.queue.shift();
      const order = this.ord.orders[idx];
      this.probe.hit(P, 'dow not %eof(ORDINQD);');
      this.probe.hit(P, 'select;');
      this.probe.hit(P, "when sopt = '5';");
      if (opt === '5') {
        this.probe.hit(P, 'showDetail(sordno);');
        this.probe.range(P, 'chain ordno ORDHDR;', 'if %found(ORDHDR);', { after: 'dcl-proc showDetail' });
        this.probe.range(P, 'dordno = ohordn;', 'exfmt DETAIL;');
        this.ord.detail = order;
        return this.renderOrdDetail(); // resumes in onOrdDetail
      }
      this.probe.hit(P, "when sopt = '4';");
      if (opt === '4') {
        this.probe.hit(P, 'cancelOrder(sordno);');
        this.ordCancel(order);
      } else {
        this.probe.hit(P, "when sopt <> ' ';");
        this.probe.hit(P, "msg = 'Option ' + sopt");
        this.msg = `Option ${opt} is not valid.`;
      }
      this.ordAfterOption();
    }
    this.probe.hit(P, 'dow not %eof(ORDINQD);');
    this.probe.hit(P, 'enddo;', { after: 'readc ORDSFL;', n: 2 });
    this.probe.hit(P, 'dow not back;');
    this.ordListLoop();
  }

  ordAfterOption() { this.probe.range('ORDINQ', 'sopt = *blanks;', 'readc ORDSFL;', { after: 'endsl;' }); }

  ordCancel(order) {
    const P = 'ORDINQ';
    this.probe.range(P, 'chain ordno ORDHDR;', 'if not %found(ORDHDR);', { after: 'dcl-proc cancelOrder' });
    this.probe.hit(P, "if ohstat <> 'OPEN';");
    if (order.stat !== 'OPEN') {
      this.probe.range(P, "msg = 'Only OPEN orders", 'return;');
      this.msg = 'Only OPEN orders can be cancelled.';
      return;
    }
    this.probe.range(P, "ohstat = 'CANCELLED';", "msg = 'Order ' + %char(ordno)");
    order.stat = 'CANCELLED';
    this.msg = `Order ${order.ordno} cancelled.`;
  }

  renderOrdDetail() {
    this.state = 'ordinq.detail';
    const o = this.ord.detail;
    const p = new Painter();
    header(p, 'ORDINQ', 'Order Detail', this.sys);
    p.text(4, 4, 'Order number  . . . . . :');
    p.text(4, 31, String(o.ordno));
    p.text(5, 4, 'Customer  . . . . . . . :');
    p.text(5, 31, String(this.ord.cust.custno));
    p.text(5, 38, this.ord.cust.name);
    p.text(6, 4, 'Order date  . . . . . . :');
    p.text(6, 31, o.date);
    p.text(7, 4, 'Amount  . . . . . . . . :');
    p.text(7, 31, editAmount(o.amt));
    p.text(8, 4, 'Status  . . . . . . . . :');
    p.text(8, 31, o.stat, o.stat === 'CANCELLED' ? ATTR.RED : ATTR.WHITE);
    p.text(22, 2, 'F3=Exit   F12=Cancel', ATTR.BLUE);
    p.at(1, 1);
    this.show(p);
  }

  onOrdDetail() {
    this.ordAfterOption();
    this.ordProcessQueue();
  }

  // ================================================================ CUSTINQ
  custStart() {
    this.cust = { ccust: '', rec: null, err: false };
    this.custPromptLoop();
  }

  custPromptLoop() {
    this.probe.hit('CUSTINQ', 'dow not done;');
    this.probe.hit('CUSTINQ', 'exfmt CPROMPT;');
    this.renderCustPrompt();
  }

  renderCustPrompt() {
    this.state = 'custinq.prompt';
    const p = new Painter();
    header(p, 'CUSTINQ', 'Customer Inquiry', this.sys);
    p.text(3, 2, 'Type customer number, press Enter.', ATTR.BLUE);
    p.text(5, 4, 'Customer number . . . . .');
    p.input('ccust', 5, 31, 5, { numeric: true, value: this.cust.ccust, error: this.cust.err });
    p.text(22, 2, 'F3=Exit   F12=Cancel', ATTR.BLUE);
    if (this.msg) p.text(23, 2, this.msg, ATTR.RED);
    this.msg = '';
    this.show(p);
  }

  custEnd() {
    this.probe.hit('CUSTINQ', 'dow not done;');
    this.probe.range('CUSTINQ', '*inlr = *on;', 'return;');
    this.programReturned();
  }

  onCustPrompt(aid, v) {
    const C = 'CUSTINQ';
    if (v.ccust !== undefined) this.cust.ccust = v.ccust.trim();
    this.cust.err = false;
    this.probe.hit(C, 'cmsg = *blanks;');
    this.probe.hit(C, 'if ind.exit or ind.cancel;');
    if (aid === 'F3' || aid === 'F12') {
      this.probe.range(C, 'done = *on;', 'iter;', { after: 'if ind.exit or ind.cancel;' });
      return this.custEnd();
    }
    if (aid !== 'Enter') return this.custPromptLoop();
    const id = Number(this.cust.ccust || 0);
    this.probe.range(C, 'chain ccust CUSTMAST;', 'if not %found(CUSTMAST);');
    const c = this.data.customers[id];
    if (!c) {
      this.probe.range(C, "cmsg = 'Customer '", 'iter;');
      this.msg = `Customer ${id} not found.`; this.cust.err = true;
      return this.custPromptLoop();
    }
    this.probe.range(C, 'avail = cmlimit - cmbal;', 'if avail < 0;');
    let avail = c.limit - c.bal;
    if (avail < 0) { this.probe.hit(C, 'avail = 0;'); avail = 0; }
    this.probe.hit(C, 'select;');
    this.probe.hit(C, "when cmstat = 'A';");
    let status;
    if (c.stat === 'A') { this.probe.hit(C, "cstatus = 'ACTIVE';"); status = 'ACTIVE'; }
    else {
      this.probe.hit(C, "when cmstat = 'H';");
      if (c.stat === 'H') { this.probe.hit(C, "cstatus = 'CREDIT HOLD';"); status = 'CREDIT HOLD'; }
      else { this.probe.hit(C, "cstatus = 'UNKNOWN';"); status = 'UNKNOWN'; }
    }
    this.probe.range(C, 'cname  = cmname;', 'exfmt CDETAIL;');
    this.cust.rec = { id, ...c, avail, status };
    this.renderCustDetail();
  }

  renderCustDetail() {
    this.state = 'custinq.detail';
    const c = this.cust.rec;
    const p = new Painter();
    header(p, 'CUSTINQ', 'Customer Detail', this.sys);
    const rows = [
      ['Customer number . . . . :', String(c.id)],
      ['Name  . . . . . . . . . :', c.name],
      ['City  . . . . . . . . . :', c.city],
      ['Credit limit  . . . . . :', editAmount(c.limit)],
      ['Balance . . . . . . . . :', editAmount(c.bal)],
      ['Available credit  . . . :', editAmount(c.avail)],
    ];
    rows.forEach(([l, val], i) => { p.text(4 + i, 4, l); p.text(4 + i, 31, val); });
    p.text(10, 4, 'Status  . . . . . . . . :');
    p.text(10, 31, c.status, c.status === 'ACTIVE' ? ATTR.WHITE : ATTR.RED);
    p.text(22, 2, 'Enter=Continue   F3=Exit', ATTR.BLUE);
    p.at(1, 1);
    this.show(p);
  }

  onCustDetail(aid) {
    const C = 'CUSTINQ';
    this.probe.hit(C, 'if ind.exit;');
    if (aid === 'F3') { this.probe.hit(C, 'done = *on;', { after: 'if ind.exit;' }); this.probe.hit(C, 'enddo;', { after: 'if ind.exit;' }); return this.custEnd(); }
    this.probe.hit(C, 'enddo;', { after: 'if ind.exit;' });
    this.custPromptLoop();
  }
}
