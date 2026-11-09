import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

export const ACTIONS = {
  connect: { short: null },
  signon: { short: null },
  waitFor: { short: 'text' },
  command: { short: 'value' },
  fill: { short: null },
  press: { short: 'key' },
  assertText: { short: 'text' },
  assertNotText: { short: 'text' },
  assertField: { short: null },
  assertCursor: { short: null },
  screenshot: { short: 'name' },
  wait: { short: 'ms' },
  setVar: { short: null },
  coverageStart: { short: null },
  coverageStop: { short: null },
};

/** Turn `{ press: 'Enter' }` style YAML steps into `{ action, args }`. */
export function normalizeStep(raw, i = 0) {
  if (raw && raw.action) return { action: raw.action, args: raw.args || {}, name: raw.name };
  if (typeof raw === 'string') raw = { [raw]: {} };
  if (!raw || typeof raw !== 'object') throw new Error(`Step ${i + 1}: must be an object`);
  const keys = Object.keys(raw).filter((k) => k !== 'name' && k !== 'continueOnFailure');
  if (keys.length !== 1) throw new Error(`Step ${i + 1}: expected exactly one action, got ${keys.join(', ') || 'none'}`);
  const action = keys[0];
  const def = ACTIONS[action];
  if (!def) throw new Error(`Step ${i + 1}: unknown action "${action}". Valid: ${Object.keys(ACTIONS).join(', ')}`);
  let args = raw[action];
  if (args == null) args = {};
  else if (typeof args !== 'object' || Array.isArray(args)) {
    if (!def.short) throw new Error(`Step ${i + 1}: "${action}" needs an object argument`);
    args = { [def.short]: args };
  }
  return { action, args, name: raw.name, continueOnFailure: !!raw.continueOnFailure };
}

function validateStep(s, i) {
  const e = [];
  const a = s.args;
  const loc = () => a.label != null || (a.row != null && a.col != null) || a.index != null;
  switch (s.action) {
    case 'fill': if (!loc()) e.push('fill needs label, row+col, or index'); if (a.value == null) e.push('fill needs value'); break;
    case 'press': if (!a.key) e.push('press needs key'); break;
    case 'assertText': case 'assertNotText': case 'waitFor': if (a.text == null && a.regex == null) e.push(`${s.action} needs text or regex`); break;
    case 'assertField': if (!loc()) e.push('assertField needs label, row+col, or index'); if (a.equals == null && a.contains == null && a.matches == null) e.push('assertField needs equals, contains or matches'); break;
    case 'assertCursor': if (a.row == null || a.col == null) e.push('assertCursor needs row and col'); break;
    case 'command': if (a.value == null) e.push('command needs value'); break;
    case 'setVar': if (!a.name) e.push('setVar needs name'); break;
  }
  return e.map((m) => `Step ${i + 1} (${s.action}): ${m}`);
}

/** Parse YAML source into a test definition. Throws with all validation errors. */
export function parseYamlTest(content, { file = null } = {}) {
  let doc;
  try { doc = YAML.parse(content); } catch (e) { throw new Error(`YAML syntax error: ${e.message}`); }
  if (!doc || typeof doc !== 'object') throw new Error('Test file is empty or not a mapping');
  const errors = [];
  if (!doc.name) errors.push('Missing "name"');
  if (!Array.isArray(doc.steps) || !doc.steps.length) errors.push('Missing "steps" list');
  const steps = [];
  (doc.steps || []).forEach((raw, i) => {
    try { const s = normalizeStep(raw, i); steps.push(s); errors.push(...validateStep(s, i)); } catch (e) { errors.push(e.message); }
  });
  if (errors.length) { const err = new Error(errors.join('\n')); err.errors = errors; throw err; }
  return {
    type: 'yaml', file, name: String(doc.name), suite: doc.suite || 'default', tags: doc.tags || [],
    description: doc.description || '', coverage: doc.coverage ?? null, data: doc.data ?? null,
    variables: doc.variables || {}, retries: doc.retries ?? 0, timeout: doc.timeout ?? null, steps,
  };
}

/** Load a JS test module from source text (data: URL) or a file. */
export async function loadJsTest(content, { file = null } = {}) {
  const mod = file && !content
    ? await import(pathToFileURL(path.resolve(file)).href + `?t=${Date.now()}`)
    : await import('data:text/javascript;base64,' + Buffer.from(content).toString('base64'));
  const def = mod.default;
  if (!def || typeof def.run !== 'function') throw new Error('JS test must `export default { name, run(t) { ... } }`');
  return {
    type: 'js', file, name: def.name || path.basename(file || 'js-test'), suite: def.suite || 'default', tags: def.tags || [],
    description: def.description || '', coverage: def.coverage ?? null, data: def.data ?? null, variables: def.variables || {},
    retries: def.retries ?? 0, timeout: def.timeout ?? null, run: def.run, steps: [],
  };
}

export async function validateTest(type, content) {
  try {
    if (type === 'js') await loadJsTest(content); else parseYamlTest(content);
    return { ok: true, errors: [] };
  } catch (e) { return { ok: false, errors: e.errors || [e.message] }; }
}

/** Minimal RFC4180 CSV parser -> array of objects. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); if (row.some((v) => v !== '')) rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Expand a test's `data` into rows: inline list or { file: 'x.csv' }. */
export function resolveDataRows(test, baseDir = process.cwd()) {
  const d = test.data;
  if (!d) return [null];
  if (Array.isArray(d)) return d.length ? d : [null];
  if (d.file) {
    const f = path.resolve(test.file ? path.dirname(test.file) : baseDir, d.file);
    const text = fs.readFileSync(f, 'utf8');
    return f.endsWith('.json') ? JSON.parse(text) : parseCsv(text);
  }
  return [null];
}

/** ${...} interpolation. */
export function interpolate(value, scope) {
  if (typeof value === 'string') {
    return value.replace(/\$\{\s*([\w.]+)\s*\}/g, (m, expr) => {
      const v = lookup(expr, scope);
      if (v === undefined) throw new Error(`Unresolved variable \${${expr}}`);
      return String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, scope));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, scope)]));
  return value;
}

function lookup(expr, { env = {}, data = {}, vars = {} }) {
  const [head, ...rest] = expr.split('.');
  const key = rest.join('.');
  const envLookup = (k) => env.variables?.[k] ?? env[k] ?? process.env[k];
  if (head === 'env' && key) return envLookup(key);
  if (head === 'data' && key) return data?.[key];
  if (head === 'vars' && key) return vars[key];
  if (head === 'secrets' && key) return process.env[key] ?? env.variables?.[key];
  return vars[expr] ?? data?.[expr] ?? envLookup(expr);
}

/** Discover test files under paths. */
export function discoverTests(paths) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f)); return; }
    if (/\.(ya?ml)$/.test(p) && !/env\./.test(path.basename(p))) out.push({ file: p, type: 'yaml' });
    else if (/\.test\.(m?js)$/.test(p)) out.push({ file: p, type: 'js' });
  };
  for (const p of paths) walk(p);
  return out;
}

export async function loadTestFile({ file, type }) {
  if (type === 'js') return loadJsTest(null, { file });
  return parseYamlTest(fs.readFileSync(file, 'utf8'), { file });
}

/** Serialize steps back to YAML (used by the recorder). */
export function stepsToYaml({ name, suite = 'default', tags = [], description = '', coverage = null, steps }) {
  const doc = { name, suite, tags };
  if (description) doc.description = description;
  if (coverage) doc.coverage = coverage;
  doc.steps = steps.map((s) => {
    const def = ACTIONS[s.action];
    const keys = Object.keys(s.args || {});
    if (def?.short && keys.length === 1 && keys[0] === def.short) return { [s.action]: s.args[def.short] };
    return { [s.action]: s.args };
  });
  const ydoc = new YAML.Document(doc);
  // compact flow style for step arguments: `- fill: { label: Customer, value: "1" }`
  for (const item of ydoc.get('steps').items) for (const pair of item.items) if (YAML.isMap(pair.value)) pair.value.flow = true;
  return ydoc.toString({ lineWidth: 140 });
}
