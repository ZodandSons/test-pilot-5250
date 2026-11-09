import { interpolate } from './script.js';

export class AssertionError extends Error {
  constructor(msg, expected) { super(msg); this.name = 'AssertionError'; this.expected = expected; }
}

const describe = {
  connect: () => 'Connect to host',
  signon: (a) => `Sign on as ${a.user ?? '${env.user}'}`,
  waitFor: (a) => `Wait for "${a.text ?? a.regex}"${a.row ? ` on row ${a.row}` : ''}`,
  command: (a) => `Run command "${a.value}"`,
  fill: (a) => `Fill ${a.label ? `"${a.label}"` : a.index != null ? `field #${a.index}` : `field at ${a.row},${a.col}`} with "${a.masked ? '******' : a.value}"`,
  press: (a) => `Press ${a.key}${a.times > 1 ? ` x${a.times}` : ''}`,
  assertText: (a) => `Assert text "${a.text ?? a.regex}"${a.row ? ` at row ${a.row}${a.col ? `, col ${a.col}` : ''}` : ''}`,
  assertNotText: (a) => `Assert text absent "${a.text ?? a.regex}"`,
  assertField: (a) => `Assert field ${a.label ? `"${a.label}"` : `${a.row},${a.col}`} ${a.equals != null ? `= "${a.equals}"` : a.contains != null ? `contains "${a.contains}"` : `~ /${a.matches}/`}`,
  assertCursor: (a) => `Assert cursor at ${a.row},${a.col}`,
  screenshot: (a) => `Screenshot ${a.name || ''}`.trim(),
  wait: (a) => `Wait ${a.ms}ms`,
  setVar: (a) => `Set variable ${a.name}`,
  coverageStart: () => 'Start coverage collection',
  coverageStop: () => 'Stop coverage collection',
};
export function describeStep(action, args) { try { return (describe[action] || (() => action))(args || {}); } catch { return action; } }

const SECRET_KEYS = /pass(word)?|pwd|secret/i;

/**
 * Executes individual steps against a TN5250 Session. Shared by YAML playback,
 * the JS test API and the recorder's replay.
 */
export class StepExecutor {
  constructor({ session, env, data, vars = {}, coverage = null, defaultTimeout = 10000, onStep = null }) {
    Object.assign(this, { session, env, data, vars, coverage, defaultTimeout, onStep });
    this.steps = [];
  }

  scope() { return { env: this.env, data: this.data, vars: this.vars }; }

  /** Run one step; records a StepResult. Throws on failure. */
  async exec(action, rawArgs = {}, { name, continueOnFailure = false } = {}) {
    const index = this.steps.length;
    const started = Date.now();
    let args, error = null, expected = null, status = 'passed';
    try {
      args = interpolate(rawArgs, this.scope());
    } catch (e) { args = rawArgs; error = e; status = 'failed'; }
    const masked = args?.label && SECRET_KEYS.test(args.label) || (action === 'fill' && args?.hidden);
    const description = name || describeStep(action, { ...args, masked });
    if (!error) {
      try { await this[`_${action}`](args); }
      catch (e) { error = e; status = 'failed'; expected = e.expected ?? null; }
    }
    const step = {
      index, action, description, status, durationMs: Date.now() - started,
      error: error ? error.message : null, expected, screen: this.session?.screen?.toJSON?.() ?? null,
    };
    this.steps.push(step);
    this.onStep?.(step);
    if (error && !continueOnFailure) { error.stepIndex = index; throw error; }
    return step;
  }

  get screen() { return this.session.screen; }
  text() { return this.session.screen.textRows(); }

  read(row, col, length) { return this.text()[row - 1].slice(col - 1, col - 1 + length); }

  matchText(a) {
    const rows = this.text();
    const flags = a.ignoreCase ? 'i' : '';
    const test = (s) => {
      if (a.regex) return new RegExp(a.regex, flags).test(s);
      return a.ignoreCase ? s.toLowerCase().includes(String(a.text).toLowerCase()) : s.includes(String(a.text));
    };
    if (a.row && a.col) {
      const want = String(a.text ?? '');
      const got = this.read(a.row, a.col, a.length || want.length || 1);
      return a.regex ? test(got) : (a.ignoreCase ? got.toLowerCase() === want.toLowerCase() : got === want);
    }
    if (a.row) return test(rows[a.row - 1]);
    return test(rows.join('\n'));
  }

  // ------------------------------------------------------------- actions
  async _connect() { if (!this.session.ready) await this.session.waitForReady(); }

  async _signon(a) {
    const user = a.user ?? this.env.user;
    const password = a.password ?? this.env.password;
    if (!user) throw new Error('signon: no user (set env.user or pass user:)');
    const s = this.session;
    const tryFill = (label, idx, value) => {
      if (value == null || value === '') return;
      try { s.fill({ label }, value); } catch { s.fill({ index: idx }, value); }
    };
    tryFill('User', 0, user);
    tryFill('Password', 1, password);
    if (a.program) tryFill('Program/procedure', 2, a.program);
    if (a.menu) tryFill('Menu', 3, a.menu);
    if (a.library) tryFill('Current library', 4, a.library);
    await s.press('Enter', { timeout: a.timeout || this.defaultTimeout * 3 });
    // Handle "allocated to another job" informational screen (CPF1220 etc.) by pressing Enter
    const text = s.screen.text();
    if (/Display Program Messages|Press Enter to continue/i.test(text)) await s.press('Enter');
    const err = s.screen.errorLine || '';
    if (/^CPF1\d{3}/.test(err) || /Password not correct|does not exist|disabled/i.test(err)) throw new AssertionError(`Sign-on failed: ${err}`, 'Successful sign-on');
  }

  async _waitFor(a) {
    const timeout = a.timeout ?? this.defaultTimeout;
    const want = a.gone ? false : true;
    try {
      await this.session.waitUntil(() => this.matchText(a) === want, { timeout, interval: 50 });
    } catch {
      throw new AssertionError(`Timed out after ${timeout}ms waiting for ${a.gone ? 'text to disappear' : 'text'}: "${a.text ?? a.regex}"`, a.text ?? a.regex);
    }
  }

  async _command(a) {
    const s = this.session;
    let value = String(a.value);
    if (this.coverage?.transformCommand) value = this.coverage.transformCommand(value);
    let field;
    if (a.label || (a.row && a.col)) field = s.findField(a);
    else {
      const inputs = s.screen.fields.filter((f) => f.input && !f.bypass);
      field = inputs.find((f) => /===>\s*$/.test(s.screen.inferLabel(f))) || [...inputs].reverse().find((f) => f.length >= 40) || inputs[inputs.length - 1];
      if (!field) throw new Error('No command line on this screen');
    }
    if (value.length > field.length) throw new Error(`Command longer than command line (${field.length})`);
    s.fill(field, value);
    await s.press(a.key || 'Enter', { timeout: a.timeout || this.defaultTimeout * 3 });
  }

  async _fill(a) {
    const loc = a.label != null ? { label: a.label } : a.index != null ? { index: a.index } : { row: a.row, col: a.col };
    this.session.fill(loc, a.value);
  }

  async _press(a) {
    const times = a.times || 1;
    for (let i = 0; i < times; i++) await this.session.press(a.key, { timeout: a.timeout || this.defaultTimeout * 3 });
    if (a.expectError === false && this.session.screen.errorLine) throw new AssertionError(`Unexpected error line: ${this.session.screen.errorLine}`);
  }

  async _assertText(a) {
    if (!this.matchText(a)) {
      const where = a.row ? (a.col ? `at ${a.row},${a.col} (found "${this.read(a.row, a.col, (a.text ?? '').length || 1)}")` : `on row ${a.row} (found "${this.text()[a.row - 1].trim()}")`) : 'on screen';
      throw new AssertionError(`Expected text "${a.text ?? a.regex}" ${where}`, a.text ?? a.regex);
    }
  }

  async _assertNotText(a) {
    if (this.matchText(a)) throw new AssertionError(`Text "${a.text ?? a.regex}" should not be on screen`, `not "${a.text ?? a.regex}"`);
  }

  async _assertField(a) {
    let value;
    try {
      const f = this.session.findField(a.label != null ? { label: a.label } : a.index != null ? { index: a.index } : { row: a.row, col: a.col });
      value = this.screen.fieldValue(f).replace(/\s+$/, '');
    } catch (e) {
      if (a.row && a.col && a.length) value = this.read(a.row, a.col, a.length).trim();
      else throw e;
    }
    const ok = a.equals != null ? value === String(a.equals)
      : a.contains != null ? value.includes(String(a.contains))
        : new RegExp(a.matches).test(value);
    if (!ok) throw new AssertionError(`Field value "${value}" does not match ${a.equals != null ? `"${a.equals}"` : a.contains != null ? `contains "${a.contains}"` : `/${a.matches}/`}`, String(a.equals ?? a.contains ?? a.matches));
  }

  async _assertCursor(a) {
    const c = this.screen.rc(this.screen.cursor);
    if (c.row !== a.row || c.col !== a.col) throw new AssertionError(`Cursor at ${c.row},${c.col}; expected ${a.row},${a.col}`, `${a.row},${a.col}`);
  }

  async _screenshot() { /* screen is captured on every step */ }
  async _wait(a) { await new Promise((r) => setTimeout(r, Number(a.ms) || 0)); }

  async _setVar(a) {
    if (a.value != null) this.vars[a.name] = a.value;
    else if (a.row && a.col) this.vars[a.name] = this.read(a.row, a.col, a.length || 10).trim();
    else if (a.label) this.vars[a.name] = this.screen.fieldValue(this.session.findField({ label: a.label })).trim();
    else throw new Error('setVar needs value, row+col(+length) or label');
  }

  async _coverageStart() { await this.coverage?.start?.(); }
  async _coverageStop() { await this.coverage?.stop?.(); }
}

/** The `t` object handed to JS tests. Every call becomes a recorded step. */
export function createTestApi(exec) {
  const expect = (actual) => ({
    toBe: (v) => { if (actual !== v) throw new AssertionError(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(v)}`, String(v)); },
    toContain: (v) => { if (!String(actual).includes(v)) throw new AssertionError(`Expected "${actual}" to contain "${v}"`, String(v)); },
    toMatch: (re) => { if (!new RegExp(re).test(String(actual))) throw new AssertionError(`Expected "${actual}" to match ${re}`, String(re)); },
    toBeTruthy: () => { if (!actual) throw new AssertionError(`Expected ${JSON.stringify(actual)} to be truthy`); },
  });
  return {
    env: exec.env, data: exec.data, vars: exec.vars,
    get screen() { return exec.session.screen.toJSON(); },
    text: () => exec.text().join('\n'),
    read: (row, col, length) => exec.read(row, col, length),
    signon: (opts = {}) => exec.exec('signon', opts),
    command: (value, opts = {}) => exec.exec('command', { value, ...opts }),
    fill: (loc, value) => exec.exec('fill', { ...(typeof loc === 'string' ? { label: loc } : loc), value }),
    press: (key, opts = {}) => exec.exec('press', { key, ...opts }),
    waitFor: (text, opts = {}) => exec.exec('waitFor', { text, ...opts }),
    assertText: (text, opts = {}) => exec.exec('assertText', { text, ...opts }),
    assertNotText: (text, opts = {}) => exec.exec('assertNotText', { text, ...opts }),
    assertField: (loc, equals) => exec.exec('assertField', { ...(typeof loc === 'string' ? { label: loc } : loc), equals }),
    assertCursor: (row, col) => exec.exec('assertCursor', { row, col }),
    setVar: (name, opts) => exec.exec('setVar', { name, ...opts }),
    wait: (ms) => exec.exec('wait', { ms }),
    /** Custom named check that is recorded as a step. */
    step: async (name, fn) => {
      const index = exec.steps.length, started = Date.now();
      let error = null;
      try { await fn(); } catch (e) { error = e; }
      const st = { index, action: 'step', description: name, status: error ? 'failed' : 'passed', durationMs: Date.now() - started,
        error: error?.message ?? null, expected: error?.expected ?? null, screen: exec.session.screen.toJSON() };
      exec.steps.push(st); exec.onStep?.(st);
      if (error) { error.stepIndex = index; throw error; }
    },
    expect,
  };
}
