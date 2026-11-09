import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/*
 * Normalized coverage data (what adapters return and the server stores):
 * { programs: [{ program, library, sourceFile, language, source: string[],
 *                executable: number[], hits: { [line]: count } }] }
 */

export function summarize(data) {
  let executable = 0, covered = 0;
  for (const p of data?.programs || []) {
    executable += p.executable.length;
    covered += p.executable.filter((l) => p.hits[l]).length;
  }
  return { executable, covered, pct: executable ? Math.round((covered / executable) * 1000) / 10 : 0 };
}

/**
 * Merge coverage from several results into the CoverageReport shape in docs/API.md.
 * inputs: [{ source: { resultId, testName, runId }, data }]
 */
export function mergeCoverage(inputs) {
  const sources = inputs.map((i) => i.source);
  const progs = new Map();
  inputs.forEach(({ data }, si) => {
    for (const p of data?.programs || []) {
      let m = progs.get(p.program);
      if (!m) {
        m = { program: p.program, library: p.library, sourceFile: p.sourceFile, language: p.language, source: p.source || [],
          executable: new Set(), hits: new Map(), coveredBy: new Map() };
        progs.set(p.program, m);
      }
      if ((p.source || []).length > m.source.length) m.source = p.source;
      p.executable.forEach((l) => m.executable.add(l));
      for (const [l, c] of Object.entries(p.hits || {})) {
        const ln = Number(l);
        if (!c) continue;
        m.hits.set(ln, (m.hits.get(ln) || 0) + c);
        if (!m.coveredBy.has(ln)) m.coveredBy.set(ln, new Set());
        m.coveredBy.get(ln).add(si);
      }
    }
  });
  let tE = 0, tC = 0;
  const programs = [...progs.values()].sort((a, b) => a.program.localeCompare(b.program)).map((m) => {
    const executable = m.executable.size;
    const covered = [...m.executable].filter((l) => m.hits.get(l)).length;
    tE += executable; tC += covered;
    const lineCount = Math.max(m.source.length, ...m.executable, 0);
    const lines = [];
    for (let no = 1; no <= lineCount; no++) {
      lines.push({ no, text: m.source[no - 1] ?? '', executable: m.executable.has(no), hits: m.hits.get(no) || 0,
        coveredBy: [...(m.coveredBy.get(no) || [])].sort((a, b) => a - b) });
    }
    return { program: m.program, library: m.library, sourceFile: m.sourceFile, language: m.language,
      executable, covered, pct: executable ? Math.round((covered / executable) * 1000) / 10 : 0, lines };
  });
  return { totals: { executable: tE, covered: tC, pct: tE ? Math.round((tC / tE) * 1000) / 10 : 0 }, sources, programs };
}

// ------------------------------------------------------------------ adapters

/** No-op adapter. */
export class NoCoverage {
  constructor() { this.name = 'none'; }
  async beforeTest() {}
  async afterTest() { return null; }
}

/** Device-scoped collection against the bundled simulator's coverage API. */
export class SimulatorCoverage {
  constructor(env, test) {
    this.name = 'simulator';
    this.url = env.coverageUrl || `http://${env.host}:${env.coveragePort || 2324}`;
    this.programs = test.coverage?.programs || null;
  }
  async beforeTest({ deviceName }) {
    this.device = deviceName;
    const r = await fetch(`${this.url}/coverage/start`, { method: 'POST', body: JSON.stringify({ device: deviceName, programs: this.programs }) });
    if (!r.ok) throw new Error(`Coverage start failed: ${r.status}`);
  }
  async afterTest() {
    const r = await fetch(`${this.url}/coverage/stop`, { method: 'POST', body: JSON.stringify({ device: this.device }) });
    if (!r.ok) return null;
    const rep = await r.json();
    return { programs: rep.programs };
  }
}

/**
 * IBM i CODECOV adapter (5770WDS option 60, QDEVTOOLS/CODECOV).
 * Wraps `CALL` commands issued by the test in
 *   QDEVTOOLS/CODECOV CMD(CALL PGM(X)) MODULE((X *PGM *ALL)) CCVIEW(*SOURCE) TESTID(id)
 * then reads the "Created code coverage result file (...cczip)" message from the
 * screen, retrieves the .cczip and parses it.
 * Transport: 'sftp' (needs optional `ssh2`), 'mount' (IFS mounted locally), or
 * 'simulator' (the bundled simulator emulates CODECOV).
 */
export class CodecovCoverage {
  constructor(env, test, { testId }) {
    this.name = 'codecov';
    this.env = env;
    this.cfg = env.codecov || {};
    this.programs = (test.coverage?.programs || []).map((p) => p.toUpperCase());
    this.testId = 'TP' + Buffer.from(testId).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
    this.files = [];
    this.calls = 0;
  }
  async beforeTest({ session }) {
    this.session = session;
    session.on('screen', (scr) => {
      const m = scr.text().match(/code coverage result file \(([^)]+\.cczip)\)/i);
      if (m && !this.files.includes(m[1])) this.files.push(m[1]);
    });
  }
  transformCommand(cmd) {
    const m = cmd.trim().match(/^CALL\s+(?:PGM\()?([\w*/]+?)\)?(\s|$)/i);
    if (!m || /^(QDEVTOOLS\/)?CODECOV/i.test(cmd)) return cmd;
    const pgm = m[1].split('/').pop().toUpperCase();
    const mods = (this.programs.length ? this.programs : [pgm]).map((p) => `(${p} *PGM *ALL)`).join(' ');
    const id = `${this.testId}_${++this.calls}`;
    const wrapped = `QDEVTOOLS/CODECOV CMD(${cmd.trim()}) MODULE(${mods}) CCVIEW(*SOURCE) TESTID(${id})`;
    return wrapped;
  }
  async afterTest() {
    if (!this.files.length) return null;
    const merged = [];
    for (const f of this.files) {
      const id = path.basename(f, '.cczip');
      try {
        if (this.cfg.transport === 'simulator' || this.env.coverageAdapter === 'codecov-sim') {
          const url = this.env.coverageUrl || `http://${this.env.host}:${this.env.coveragePort || 2324}`;
          const r = await fetch(`${url}/coverage/results/${encodeURIComponent(id)}`);
          if (r.ok) merged.push({ programs: (await r.json()).programs });
        } else {
          const buf = await this.fetchFile(f);
          merged.push(await parseCczip(buf, { sourceProvider: this.cfg.sourceDir }));
        }
      } catch (e) { console.warn(`[codecov] could not read ${f}: ${e.message}`); }
    }
    return combineData(merged);
  }
  async fetchFile(ifsPath) {
    if (this.cfg.transport === 'mount') {
      const local = path.join(this.cfg.mountPath, path.relative(this.cfg.ifsRoot || '/', ifsPath));
      return fs.readFileSync(local);
    }
    let ssh2;
    try { ssh2 = await import('ssh2'); } catch { throw new Error('SFTP transport needs the optional "ssh2" package (npm i ssh2)'); }
    const { Client } = ssh2.default || ssh2;
    return new Promise((resolve, reject) => {
      const c = new Client();
      c.on('ready', () => c.sftp((err, sftp) => {
        if (err) { c.end(); return reject(err); }
        sftp.readFile(ifsPath, (e, data) => { c.end(); e ? reject(e) : resolve(data); });
      })).on('error', reject).connect({
        host: this.cfg.sshHost || this.env.host, port: this.cfg.sshPort || 22,
        username: this.cfg.sshUser || this.env.user, password: this.cfg.sshPassword || this.env.password,
        privateKey: this.cfg.sshKeyFile ? fs.readFileSync(this.cfg.sshKeyFile) : undefined,
      });
    });
  }
}

function combineData(list) {
  const out = new Map();
  for (const d of list) for (const p of d?.programs || []) {
    const cur = out.get(p.program);
    if (!cur) { out.set(p.program, { ...p, hits: { ...p.hits } }); continue; }
    cur.executable = [...new Set([...cur.executable, ...p.executable])].sort((a, b) => a - b);
    for (const [l, c] of Object.entries(p.hits)) cur.hits[l] = (cur.hits[l] || 0) + c;
  }
  return out.size ? { programs: [...out.values()] } : null;
}

export function createCoverageAdapter(env, test, opts) {
  if (test.coverage === false || opts.enabled === false) return new NoCoverage();
  switch (env.coverageAdapter) {
    case 'simulator': return new SimulatorCoverage(env, test);
    case 'codecov': case 'codecov-sim': return new CodecovCoverage(env, test, opts);
    default: return new NoCoverage();
  }
}

// ------------------------------------------------------------- .cczip parsing

/** Minimal ZIP reader (stored + deflate) using the central directory. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnl = buf.readUInt16LE(local + 26), lxl = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnl + lxl, local + 30 + lnl + lxl + csize);
    if (!name.endsWith('/')) files[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

/**
 * Best-effort .cczip parser.
 * IBM does not publish the .cczip layout; this handles the formats observed in
 * practice and common exports. VALIDATE against a .cczip from your system:
 *  1. Cobertura XML (<coverage><packages>...<class filename><lines><line number hits/>)
 *  2. Generic XML where elements carry line + hit attributes (e.g. <line ln="12" hits="3"/>,
 *     <stmt line="12" count="1"/>) grouped under a file/module element with a name attribute
 *  3. Source text from a `src/` folder when present (used to show source lines)
 */
export async function parseCczip(buf, { sourceProvider } = {}) {
  const files = unzip(buf);
  const programs = new Map();
  const sources = {};
  for (const [name, data] of Object.entries(files)) {
    if (/(^|\/)src\//i.test(name) && !/\.xml$/i.test(name)) sources[path.basename(name).replace(/\.\w+$/, '').toUpperCase()] = data.toString('utf8').replace(/\r/g, '').split('\n');
  }
  for (const [name, data] of Object.entries(files)) {
    if (!/\.(xml|ccresult|cc)$/i.test(name)) continue;
    const xml = data.toString('utf8');
    const groupRe = /<(class|file|module|source|program)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let g;
    while ((g = groupRe.exec(xml))) {
      const attrs = g[2];
      const nm = (attrs.match(/\b(?:filename|name|path|module)="([^"]+)"/i) || [])[1];
      if (!nm) continue;
      const program = path.basename(nm).replace(/\.\w+$/, '').toUpperCase();
      const lineRe = /<(?:line|stmt|statement|l)\b([^>]*?)\/?>/gi;
      let l, any = false;
      const prog = programs.get(program) || { program, library: '', sourceFile: nm, language: /\.clle$/i.test(nm) ? 'CLLE' : 'RPGLE', source: [], executable: [], hits: {} };
      while ((l = lineRe.exec(g[3]))) {
        const no = Number((l[1].match(/\b(?:number|line|ln|no)="(\d+)"/i) || [])[1]);
        const hits = Number((l[1].match(/\b(?:hits|count|hit|executed)="(\w+)"/i) || [])[1] === 'true' ? 1 : (l[1].match(/\b(?:hits|count|hit)="(\d+)"/i) || [])[1] || 0);
        if (!no) continue;
        any = true;
        if (!prog.executable.includes(no)) prog.executable.push(no);
        if (hits) prog.hits[no] = (prog.hits[no] || 0) + hits;
      }
      if (any) programs.set(program, prog);
    }
  }
  for (const p of programs.values()) {
    p.executable.sort((a, b) => a - b);
    p.source = sources[p.program] || (sourceProvider ? readSourceFromDir(sourceProvider, p.program) : []);
  }
  if (!programs.size) throw new Error(`No line data recognised in .cczip (entries: ${Object.keys(files).join(', ')})`);
  return { programs: [...programs.values()] };
}

function readSourceFromDir(dir, program) {
  for (const sub of ['', 'QRPGLESRC', 'QCLLESRC']) {
    for (const ext of ['.rpgle', '.sqlrpgle', '.clle', '.RPGLE', '.CLLE']) {
      const f = path.join(dir, sub, program + ext);
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n');
    }
  }
  return [];
}
