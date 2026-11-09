import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelnetCodec } from '@tp5250/tn5250';
import { SourceRegistry, CoverageTracker } from './coverage.js';
import { AppSession } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCE_DIR = path.resolve(__dirname, '../../../samples/ibmi');

/** Tracks sessions by device name and coverage collections. */
class CoverageHub {
  constructor(registry) {
    this.registry = registry;
    this.sessions = new Map();
    this.deviceTrackers = new Map();
    this.results = new Map();
  }
  register(dev, s) {
    this.sessions.set(dev, s);
    const t = this.deviceTrackers.get(dev);
    if (t) s.probe.add(t);
  }
  unregister(dev, s) { if (this.sessions.get(dev) === s) this.sessions.delete(dev); }
  startDevice(dev, programs) {
    const t = new CoverageTracker(this.registry, { programs, id: dev });
    this.deviceTrackers.set(dev, t);
    this.sessions.get(dev)?.probe.add(t);
    return t;
  }
  stopDevice(dev) {
    const t = this.deviceTrackers.get(dev);
    if (!t) return null;
    this.deviceTrackers.delete(dev);
    this.sessions.get(dev)?.probe.remove(t);
    return t.report();
  }
  storeResult(id, rep) { this.results.set(id, rep); if (this.results.size > 500) this.results.delete(this.results.keys().next().value); }
}

export function startSimulator({ port = 2323, httpPort = 2324, host = '0.0.0.0', sourceDir = DEFAULT_SOURCE_DIR,
  systemName = 'TPSIM01', users = { TESTER: 'TESTER1', QSECOFR: 'SECRET' }, quiet = false } = {}) {
  const registry = new SourceRegistry(sourceDir);
  const hub = new CoverageHub(registry);
  const config = { systemName, users };
  let devSeq = 0;
  const log = (...a) => { if (!quiet) console.log('[sim]', ...a); };

  const tnServer = net.createServer((sock) => {
    sock.setNoDelay(true);
    let app = null;
    let dev = null;
    const codec = new TelnetCodec({ role: 'server', write: (b) => { if (!sock.destroyed) sock.write(b); } });
    let ttOk = false, envOk = false, started = false;
    const maybeStart = () => {
      if (started || !ttOk) return;
      started = true;
      dev = (codec.receivedEnv.DEVNAME || `QPADEV${String(++devSeq).padStart(4, '0')}`).toUpperCase().slice(0, 10);
      app = new AppSession({
        send: (rec) => codec.sendRecord(rec), close: () => sock.end(), registry, hub, config, device: dev,
      });
      hub.register(dev, app);
      log(`session ${dev} started (${codec.receivedTerminalType})`);
      app.start();
    };
    codec.on('terminalType', () => { ttOk = true; setTimeout(maybeStart, envOk ? 0 : 50); });
    codec.on('env', () => { envOk = true; maybeStart(); });
    codec.on('record', (r) => app?.onRecord(r));
    sock.on('data', (d) => codec.feed(d));
    sock.on('error', () => {});
    sock.on('close', () => { if (dev) { hub.unregister(dev, app); log(`session ${dev} closed`); } });
    codec.startServerNegotiation();
  });

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const httpServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const data = body ? JSON.parse(body) : {};
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, sessions: [...hub.sessions.keys()] });
    if (req.method === 'POST' && url.pathname === '/coverage/start') {
      if (!data.device) return json(res, 400, { error: 'device required' });
      hub.startDevice(String(data.device).toUpperCase(), data.programs || null);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/coverage/stop') {
      const rep = hub.stopDevice(String(data.device || '').toUpperCase());
      return rep ? json(res, 200, rep) : json(res, 404, { error: 'no active collection for device' });
    }
    const m = url.pathname.match(/^\/coverage\/results\/(.+)$/);
    if (req.method === 'GET' && m) {
      const rep = hub.results.get(decodeURIComponent(m[1]));
      return rep ? json(res, 200, rep) : json(res, 404, { error: 'not found' });
    }
    if (req.method === 'GET' && url.pathname === '/programs') {
      return json(res, 200, [...registry.programs.values()].map(({ execSet, ...p }) => p));
    }
    json(res, 404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    tnServer.listen(port, host, () => {
      httpServer.listen(httpPort, host, () => {
        log(`TN5250 listening on ${host}:${tnServer.address().port}, coverage API on :${httpServer.address().port}`);
        resolve({
          port: tnServer.address().port, httpPort: httpServer.address().port, registry, hub,
          close: () => new Promise((r) => { tnServer.close(); httpServer.close(); r(); }),
          tnServer, httpServer,
        });
      });
    });
  });
}
