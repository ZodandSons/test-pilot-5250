import { Session } from '@tp5250/tn5250';
import { stepsToYaml } from './script.js';

export function screenTitle(screen) {
  const row = screen.textRows()[0] || '';
  const segs = row.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return null;
  return segs.reduce((a, b) => (b.length > a.length ? b : a));
}

export function messageLine(screen) {
  const rows = screen.textRows();
  for (const r of [rows.length - 1, rows.length - 2]) {
    const t = (rows[r] || '').trim();
    if (t && !/F\d+=/.test(t) && !/^(More\.\.\.|Bottom)$/.test(t)) return { row: r + 1, text: t };
  }
  return null;
}

/**
 * Records interactions on a live TN5250 session as test steps.
 * Used by the server's WebSocket recorder and live terminal.
 */
export class Recorder {
  constructor({ env, record = true, deviceName }) {
    this.env = env;
    this.record = record;
    this.steps = [];
    this.session = new Session({
      host: env.host, port: Number(env.port || 23), tls: !!env.tls,
      deviceName: deviceName || env.deviceName || '', readyTimeout: env.readyTimeout || 30000,
    });
    this.session.on('error', () => {});
    this.lastTitle = null;
    this.lastMsg = null;
  }

  async start() {
    await this.session.connect();
    this.lastTitle = screenTitle(this.session.screen);
    return this.session.screen.toJSON();
  }

  add(action, args) { if (this.record) this.steps.push({ action, args }); }

  isSignon(scr) {
    const labels = scr.fields.filter((f) => f.input).map((f) => scr.inferLabel(f).toLowerCase());
    return labels.includes('user') && labels.includes('password');
  }

  /** Apply edits + AID from the UI; returns updated screen + steps. */
  async input({ fields = [], aid = 'Enter', cursor = null }) {
    const s = this.session;
    const scr = s.screen;
    const changes = [];
    for (const f of fields) {
      const fld = scr.fieldAt(f.row, f.col);
      if (!fld || fld.bypass) continue;
      const old = scr.fieldValue(fld).replace(/\s+$/, '');
      const val = String(f.value ?? '').replace(/\s+$/, '');
      if (old === val && !(scr.toJSON().fields.find((x) => x.id === fld.id)?.hidden && val)) continue;
      changes.push({ fld, val, label: scr.inferLabel(fld), hidden: (fld.attr & 0x07) === 0x07 });
    }

    if (this.isSignon(scr) && aid === 'Enter') {
      const get = (l) => changes.find((c) => c.label.toLowerCase() === l);
      const user = get('user')?.val;
      const args = { user: user && user.toUpperCase() === String(this.env.user || '').toUpperCase() ? '${env.user}' : user, password: '${env.password}' };
      for (const [k, l] of [['program', 'program/procedure'], ['menu', 'menu'], ['library', 'current library']]) if (get(l)) args[k] = get(l).val;
      if (!user) delete args.user;
      this.add('signon', args);
      for (const c of changes) scr.setFieldValue(c.fld, c.val);
      if (cursor) s.setCursor(cursor.row, cursor.col);
      await s.press('Enter');
      this.checkpoint(true);
      return this.state();
    }

    const inputs = scr.fields.filter((f) => f.input && !f.bypass);
    const labelCount = (l) => inputs.filter((f) => scr.inferLabel(f) === l).length;
    let commandStep = null;
    for (const c of changes) {
      const isCmdLine = /===>\s*$/.test(c.label) || (c.fld.length >= 60 && inputs.length <= 2);
      if (isCmdLine && aid === 'Enter' && changes.length === 1) { commandStep = { value: c.val }; continue; }
      const { row, col } = scr.rc(c.fld.start);
      const loc = c.label && labelCount(c.label) === 1 && !/===>/.test(c.label) ? { label: c.label } : { row, col };
      const value = c.hidden ? `\${secrets.FIELD_${row}_${col}}` : c.val;
      this.add('fill', { ...loc, value });
    }
    for (const c of changes) scr.setFieldValue(c.fld, c.val);
    if (cursor) s.setCursor(cursor.row, cursor.col);
    if (commandStep) this.add('command', commandStep);
    else this.add('press', { key: aid });
    await s.press(aid);
    this.checkpoint();
    return this.state();
  }

  /** Auto-insert assertions identifying the new screen and any message shown. */
  checkpoint(force = false) {
    const scr = this.session.screen;
    const title = screenTitle(scr);
    if (title && (force || title !== this.lastTitle)) this.add('assertText', { text: title, row: 1 });
    this.lastTitle = title;
    const msg = messageLine(scr);
    if (msg && msg.text !== this.lastMsg?.text) this.add('assertText', { text: msg.text, row: msg.row });
    this.lastMsg = msg;
  }

  assert({ kind = 'text', row, col, length, text, label }) {
    const scr = this.session.screen;
    if (kind === 'field') {
      const f = scr.fieldAt(row, col);
      if (f) {
        const l = label || scr.inferLabel(f);
        this.steps.push({ action: 'assertField', args: { ...(l ? { label: l } : { row, col }), equals: scr.fieldValue(f).replace(/\s+$/, '') } });
        return this.steps;
      }
    }
    const t = text ?? scr.textRows()[row - 1].slice(col - 1, col - 1 + (length || 1));
    const trimmed = t.trim();
    const lead = t.length - t.trimStart().length;
    this.steps.push({ action: 'assertText', args: { text: trimmed, row, col: col + lead } });
    return this.steps;
  }

  removeStep(i) { this.steps.splice(i, 1); return this.steps; }

  state() { return { screen: this.session.screen.toJSON(), steps: this.steps }; }

  toYaml({ name, suite, tags, description }) { return stepsToYaml({ name, suite, tags, description, steps: this.steps }); }

  stop() { this.session.close(); }
}
