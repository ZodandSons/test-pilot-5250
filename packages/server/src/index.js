#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0) return process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
  return process.env[`TP_${name.toUpperCase().replace(/-/g, '_')}`] ?? def;
};

export async function startServer({
  port = Number(arg('port', 4250)),
  dbFile = arg('db', path.join(ROOT, 'data/testpilot.db')),
  withSimulator = arg('no-simulator', false) === false,
  simPort = Number(arg('sim-port', 2323)),
  simHttpPort = Number(arg('sim-http-port', 2324)),
  seed = arg('no-seed', false) === false,
} = {}) {
  let sim = null;
  const seedEnvs = [];
  if (withSimulator) {
    const { startSimulator } = await import('@tp5250/simulator');
    sim = await startSimulator({ port: simPort, httpPort: simHttpPort, quiet: true });
    seedEnvs.push({ id: 'env_simulator', name: 'Built-in IBM i simulator', host: '127.0.0.1', port: sim.port, user: 'TESTER', password: 'TESTER1',
      deviceName: '', coverageAdapter: 'simulator', coveragePort: sim.httpPort, codecov: {}, variables: { LIB: 'ORDLIB' } });
    console.log(`[sim] IBM i simulator on tn5250://127.0.0.1:${sim.port} (user TESTER / TESTER1)`);
  }
  const app = await createApp({
    dbFile,
    webDir: path.join(ROOT, 'web/dist'),
    testsDir: path.join(ROOT, 'data/tests'),
    seedDir: seed ? path.join(ROOT, 'samples/tests') : null,
    seedEnvs,
  });
  await new Promise((r) => app.server.listen(port, r));
  console.log(`[server] TestPilot 5250 dashboard: http://localhost:${app.server.address().port}`);
  return { ...app, sim, port: app.server.address().port };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((e) => { console.error(e); process.exit(1); });
}
