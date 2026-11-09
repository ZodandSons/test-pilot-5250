import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import {
  parseYamlTest, loadJsTest, validateTest, discoverTests, newId, mergeCoverage, Recorder,
  htmlReport, junitReport, jsonReport,
} from '@tp5250/core';
import { Store } from './db.js';
import { RunManager } from './runs.js';
import { dashboardSummary } from './dashboard.js';
import { parseCron, cronMatches, nextRun } from './cron.js';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Tiny router: add('GET', '/api/runs/:id', handler). */
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler });
  }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.re);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/** Derive metadata (name, suite, tags, steps) from test source. */
async function testMeta(type, content) {
  const def = type === 'js' ? await loadJsTest(content) : parseYamlTest(content);
  return { name: def.name, suite: def.suite, tags: def.tags, description: def.description, stepCount: def.steps.length, steps: def.steps };
}

export async function createApp({ dbFile, webDir, testsDir, seedDir, seedEnvs = [], log = console.log }) {
  const store = new Store(dbFile);
  const clients = new Set();
  const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of clients) if (c.readyState === 1) c.send(s); };
  fs.mkdirSync(testsDir, { recursive: true });
  const runs = new RunManager({ store, broadcast, testsDir, log });

  // ------------------------------------------------------------ seeding
  for (const e of seedEnvs) if (!store.getEnv(e.id)) store.saveEnv(e);
  if (seedDir && !store.listTests().length) {
    for (const f of discoverTests([seedDir])) {
      try {
        const content = fs.readFileSync(f.file, 'utf8');
        const meta = await testMeta(f.type, content);
        store.saveTest({ id: newId('t'), type: f.type, content, sourcePath: path.resolve(f.file), ...meta });
      } catch (e) { log(`[seed] skipped ${f.file}: ${e.message}`); }
    }
    log(`[seed] imported ${store.listTests().length} sample tests from ${seedDir}`);
  }

  // ------------------------------------------------------------- routes
  const r = new Router();
  r.add('GET', '/api/health', () => ({ ok: true, version: '0.1.0' }));

  // environments
  r.add('GET', '/api/environments', () => store.listEnvs());
  r.add('POST', '/api/environments', ({ body }) => {
    if (!body.name || !body.host) throw new HttpError(400, 'name and host are required');
    return store.saveEnv({ ...body, id: newId('env') });
  });
  r.add('PUT', '/api/environments/:id', ({ params, body }) => {
    if (!store.getEnv(params.id)) throw new HttpError(404, 'environment not found');
    return store.saveEnv({ ...body, id: params.id });
  });
  r.add('DELETE', '/api/environments/:id', ({ params }) => { store.run('DELETE FROM environments WHERE id = ?', params.id); return { ok: true }; });

  // tests
  r.add('GET', '/api/tests', () => store.listTests());
  r.add('GET', '/api/tests/:id', async ({ params }) => {
    const t = store.getTest(params.id);
    if (!t) throw new HttpError(404, 'test not found');
    try { t.steps = t.type === 'yaml' ? parseYamlTest(t.content).steps : []; } catch { t.steps = []; }
    return t;
  });
  r.add('POST', '/api/tests/validate', async ({ body }) => validateTest(body.type || 'yaml', body.content || ''));
  r.add('POST', '/api/tests', async ({ body }) => {
    const type = body.type === 'js' ? 'js' : 'yaml';
    const v = await validateTest(type, body.content || '');
    if (!v.ok) throw new HttpError(400, v.errors.join('\n'));
    const meta = await testMeta(type, body.content);
    return store.saveTest({ id: newId('t'), type, content: body.content, ...meta, name: body.name || meta.name, suite: body.suite || meta.suite });
  });
  r.add('PUT', '/api/tests/:id', async ({ params, body }) => {
    const prev = store.getTest(params.id);
    if (!prev) throw new HttpError(404, 'test not found');
    const content = body.content ?? prev.content;
    const v = await validateTest(prev.type, content);
    if (!v.ok) throw new HttpError(400, v.errors.join('\n'));
    const meta = await testMeta(prev.type, content);
    return store.saveTest({ ...prev, ...meta, content, name: body.name || meta.name, suite: body.suite || meta.suite });
  });
  r.add('DELETE', '/api/tests/:id', ({ params }) => { store.run('DELETE FROM tests WHERE id = ?', params.id); return { ok: true }; });

  // runs
  r.add('POST', '/api/runs', ({ body }) => ({ runId: runs.start({ ...body, trigger: body.trigger || 'manual' }) }));
  r.add('POST', '/api/runs/import', ({ body }) => ({ runId: runs.importRun(body) }));
  r.add('GET', '/api/runs', ({ query }) => store.listRuns(Number(query.get('limit') || 50)));
  r.add('GET', '/api/runs/:id', ({ params }) => {
    const run = store.getRun(params.id);
    if (!run) throw new HttpError(404, 'run not found');
    return { ...run, results: store.resultsForRun(params.id) };
  });
  r.add('DELETE', '/api/runs/:id', ({ params }) => { store.deleteRun(params.id); return { ok: true }; });
  const runWithCoverage = (id) => {
    const run = store.getRun(id);
    if (!run) throw new HttpError(404, 'run not found');
    run.results = store.resultsForRun(id);
    const inputs = run.results.map((res) => ({ res, data: store.getCoverage(res.id) })).filter((x) => x.data)
      .map(({ res, data }) => ({ source: { resultId: res.id, testName: res.testName, runId: id }, data }));
    return { run, coverage: inputs.length ? mergeCoverage(inputs) : null };
  };
  r.add('GET', '/api/runs/:id/report.html', ({ params }) => { const { run, coverage } = runWithCoverage(params.id); return { $raw: htmlReport(run, coverage), type: 'text/html; charset=utf-8' }; });
  r.add('GET', '/api/runs/:id/report.junit.xml', ({ params }) => { const { run } = runWithCoverage(params.id); return { $raw: junitReport(run), type: 'application/xml', download: `junit-${params.id}.xml` }; });
  r.add('GET', '/api/runs/:id/report.json', ({ params }) => { const { run, coverage } = runWithCoverage(params.id); return { $raw: jsonReport(run, coverage), type: 'application/json', download: `report-${params.id}.json` }; });

  // dashboard
  r.add('GET', '/api/dashboard/summary', ({ query }) => dashboardSummary(store, Math.min(365, Number(query.get('days') || 30))));

  // coverage
  const coverageFor = (rows) => {
    const inputs = rows.map((res) => ({ res, data: store.getCoverage(res.id) })).filter((x) => x.data)
      .map(({ res, data }) => ({ source: { resultId: res.id, testName: res.dataRow ? `${res.testName} [${res.iteration}]` : res.testName, runId: res.runId }, data }));
    return mergeCoverage(inputs);
  };
  r.add('GET', '/api/coverage/programs', () => {
    const seen = new Map();
    for (const row of store.all('SELECT data FROM coverage ORDER BY rowid DESC LIMIT 200')) {
      for (const p of JSON.parse(row.data).programs || []) {
        if (!seen.has(p.program)) seen.set(p.program, { program: p.program, library: p.library, sourceFile: p.sourceFile, executable: p.executable.length });
      }
    }
    return [...seen.values()].sort((a, b) => a.program.localeCompare(b.program));
  });
  r.add('GET', '/api/coverage/result/:id', ({ params }) => {
    const res = store.getResult(params.id);
    if (!res) throw new HttpError(404, 'result not found');
    return coverageFor([res]);
  });
  r.add('POST', '/api/coverage/merge', ({ body }) => {
    const rows = new Map();
    for (const id of body.resultIds || []) { const x = store.getResult(id); if (x) rows.set(x.id, x); }
    for (const id of body.runIds || []) for (const x of store.resultsForRun(id, { steps: false })) rows.set(x.id, x);
    for (const tid of body.testIds || []) {
      const latest = store.get('SELECT r.run_id FROM results r JOIN coverage c ON c.result_id = r.id WHERE r.test_id = ? ORDER BY r.started_at DESC LIMIT 1', tid);
      if (!latest) continue;
      for (const x of store.all('SELECT r.* FROM results r JOIN coverage c ON c.result_id = r.id WHERE r.test_id = ? AND r.run_id = ?', tid, latest.run_id)) {
        const res = store.resultFromRow(x, { steps: false }); rows.set(res.id, res);
      }
    }
    return coverageFor([...rows.values()]);
  });

  // schedules
  const withNext = (s) => { let next = null; try { next = s.enabled ? nextRun(s.cron)?.toISOString() : null; } catch { /* invalid */ } return { ...s, nextRunAt: next }; };
  r.add('GET', '/api/schedules', () => store.listSchedules().map(withNext));
  r.add('POST', '/api/schedules', ({ body }) => {
    try { parseCron(body.cron); } catch (e) { throw new HttpError(400, e.message); }
    return withNext(store.saveSchedule({ enabled: true, ...body, id: newId('sch') }));
  });
  r.add('PUT', '/api/schedules/:id', ({ params, body }) => {
    const prev = store.getSchedule(params.id);
    if (!prev) throw new HttpError(404, 'schedule not found');
    const s = { ...prev, ...body, id: params.id };
    try { parseCron(s.cron); } catch (e) { throw new HttpError(400, e.message); }
    return withNext(store.saveSchedule(s));
  });
  r.add('DELETE', '/api/schedules/:id', ({ params }) => { store.run('DELETE FROM schedules WHERE id = ?', params.id); return { ok: true }; });

  // --------------------------------------------------------- HTTP server
  const serveStatic = (req, res, pathname) => {
    if (!webDir || !fs.existsSync(webDir)) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('TestPilot 5250 API is running. Build the web UI with `npm run web:build`.'); }
    let file = path.join(webDir, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(webDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(webDir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'max-age=300' });
    fs.createReadStream(file).pipe(res);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    const m = r.match(req.method, url.pathname);
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!m) return send(404, { error: 'not found' });
    try {
      let raw = '';
      for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      const out = await m.handler({ params: m.params, query: url.searchParams, body, req });
      if (out && out.$raw != null) {
        const h = { 'content-type': out.type };
        if (out.download && url.searchParams.get('download') !== '0') h['content-disposition'] = `inline; filename="${out.download}"`;
        res.writeHead(200, h); return res.end(out.$raw);
      }
      send(200, out ?? { ok: true });
    } catch (e) {
      if (!e.status) log('[api]', req.method, url.pathname, e);
      send(e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.message });
    }
  });

  // ----------------------------------------------- WebSocket (live + recorder)
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    clients.add(ws);
    let rec = null;
    let chain = Promise.resolve();
    const reply = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
    const handle = async (msg) => {
      switch (msg.type) {
        case 'rec.start': {
          rec?.stop();
          const env = store.getEnv(msg.environmentId, { mask: false }) || store.getEnv(store.listEnvs()[0]?.id, { mask: false });
          if (!env) throw new Error('No environment configured');
          rec = new Recorder({ env, record: msg.record !== false, deviceName: 'TPREC' + Math.random().toString(36).slice(2, 7).toUpperCase() });
          rec.session.on('close', () => reply({ type: 'error', message: 'Host closed the connection' }));
          const screen = await rec.start();
          return reply({ type: 'rec.started', sessionId: newId('rec'), screen, steps: rec.steps, environment: { id: env.id, name: env.name } });
        }
        case 'rec.input': {
          if (!rec) throw new Error('No active session');
          const st = await rec.input(msg);
          return reply({ type: 'rec.screen', ...st });
        }
        case 'rec.assert': if (!rec) throw new Error('No active session'); return reply({ type: 'rec.steps', steps: rec.assert(msg) });
        case 'rec.removeStep': if (!rec) throw new Error('No active session'); return reply({ type: 'rec.steps', steps: rec.removeStep(msg.index) });
        case 'rec.stop': {
          if (!rec) return reply({ type: 'rec.stopped' });
          const steps = rec.steps;
          let testId = null;
          if (msg.save && steps.length) {
            const content = rec.toYaml({ name: msg.save.name || 'Recorded test', suite: msg.save.suite || 'recorded', tags: msg.save.tags || ['recorded'] });
            const meta = await testMeta('yaml', content);
            testId = store.saveTest({ id: newId('t'), type: 'yaml', content, ...meta }).id;
          }
          rec.stop(); rec = null;
          return reply(testId ? { type: 'rec.saved', testId } : { type: 'rec.stopped' });
        }
        case 'ping': return reply({ type: 'pong' });
      }
    };
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      chain = chain.then(() => handle(msg)).catch((e) => reply({ type: 'error', message: e.message, screen: rec?.session?.screen?.toJSON?.() }));
    });
    ws.on('close', () => { clients.delete(ws); rec?.stop(); });
  });

  // ------------------------------------------------------------ scheduler
  let lastTick = '';
  const tick = () => {
    const now = new Date();
    const key = now.toISOString().slice(0, 16);
    if (key === lastTick) return;
    lastTick = key;
    for (const s of store.listSchedules()) {
      if (!s.enabled) continue;
      try {
        if (!cronMatches(parseCron(s.cron), now)) continue;
        runs.start({ suite: s.suite || undefined, tags: s.tags?.length ? s.tags : undefined, testIds: s.testIds?.length ? s.testIds : undefined,
          environmentId: s.environmentId, coverage: s.coverage, name: `Scheduled: ${s.name}`, trigger: 'schedule' });
        store.saveSchedule({ ...s, lastRunAt: now.toISOString() });
      } catch (e) { log(`[schedule] ${s.name}: ${e.message}`); }
    }
  };
  const timer = setInterval(tick, 15000);
  timer.unref();

  return { server, store, runs, close: () => { clearInterval(timer); wss.close(); server.close(); } };
}
