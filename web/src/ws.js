// One shared WebSocket for the whole app, with automatic reconnect.
import { useEffect, useState } from 'react';
import { isMock } from './api.js';
import { mockWsSend } from './mock.js';

const listeners = new Set();
const statusListeners = new Set();
let socket = null;
let status = 'connecting';
let retry = 0;
let queue = [];

function setStatus(s) {
  status = s;
  statusListeners.forEach((fn) => fn(s));
}

function connect() {
  if (isMock()) { setStatus('mock'); return; }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${window.location.host}/ws`);
  setStatus('connecting');
  socket.onopen = () => {
    retry = 0;
    setStatus('open');
    queue.forEach((m) => socket.send(m));
    queue = [];
  };
  socket.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    listeners.forEach((fn) => fn(msg));
  };
  socket.onclose = () => {
    setStatus('closed');
    listeners.forEach((fn) => fn({ type: 'ws.closed' }));
    const delay = Math.min(10000, 500 * 2 ** retry++);
    setTimeout(connect, delay);
  };
  socket.onerror = () => socket.close();
}

let started = false;
function ensure() {
  if (!started) { started = true; connect(); }
}

export function wsSend(msg) {
  if (isMock()) { mockWsSend(msg); return; }
  ensure();
  const data = JSON.stringify(msg);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
  else queue.push(data);
}

export function wsSubscribe(fn) {
  ensure();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Subscribe to messages for the life of a component.
export function useWsMessages(handler, deps = []) {
  useEffect(() => wsSubscribe(handler), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useWsStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    ensure();
    statusListeners.add(setS);
    setS(status);
    return () => statusListeners.delete(setS);
  }, []);
  return s;
}

// For mock mode: let fake recorder push messages into listeners.
export function wsEmitLocal(msg) {
  listeners.forEach((fn) => fn(msg));
}
