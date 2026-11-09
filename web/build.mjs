// Build / dev server for the TestPilot 5250 web app.
//   node build.mjs            -> production bundle in dist/
//   node build.mjs --dev      -> watch + serve on :5173, proxies /api and /ws to :4250
//   node build.mjs --preview  -> serve dist/ on :4173 (same proxy)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const args = new Set(process.argv.slice(2));
const dev = args.has('--dev');
const preview = args.has('--preview');
const API = { host: process.env.TP_API_HOST || '127.0.0.1', port: Number(process.env.TP_API_PORT || 4250) };

const options = {
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true,
  outdir: path.join(dist, 'assets'),
  entryNames: 'app',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  minify: !dev,
  sourcemap: dev ? 'inline' : true,
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  logLevel: 'info',
};

function copyStatic() {
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.svg': 'image/svg+xml' };

function serve(port) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      const p = http.request({ ...API, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      p.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: `TestPilot server not reachable on ${API.host}:${API.port}` })); });
      req.pipe(p);
      return;
    }
    let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  // WebSocket upgrade passthrough for /ws
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    const upstream = net.connect(API.port, API.host, () => {
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  server.listen(port, () => console.log(`TestPilot web on http://localhost:${port}  (API proxied to ${API.host}:${API.port}; add ?mock=1 for fixture data)`));
}

if (preview) {
  serve(4173);
} else if (dev) {
  copyStatic();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  serve(5173);
} else {
  fs.rmSync(dist, { recursive: true, force: true });
  copyStatic();
  await esbuild.build(options);
}
