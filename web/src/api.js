// REST client for the TestPilot server (docs/API.md). Add ?mock=1 to the URL to use fixture data.
import { mockRequest } from './mock.js';

export function isMock() {
  return new URLSearchParams(window.location.search).has('mock');
}

async function request(method, url, body) {
  if (isMock()) return mockRequest(method, url, body);
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `${method} ${url} failed with HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // environments
  environments: () => request('GET', '/api/environments'),
  createEnvironment: (e) => request('POST', '/api/environments', e),
  updateEnvironment: (id, e) => request('PUT', `/api/environments/${id}`, e),
  deleteEnvironment: (id) => request('DELETE', `/api/environments/${id}`),
  // tests
  tests: () => request('GET', '/api/tests'),
  test: (id) => request('GET', `/api/tests/${id}`),
  createTest: (t) => request('POST', '/api/tests', t),
  updateTest: (id, t) => request('PUT', `/api/tests/${id}`, t),
  deleteTest: (id) => request('DELETE', `/api/tests/${id}`),
  validateTest: (type, content) => request('POST', '/api/tests/validate', { type, content }),
  // runs
  startRun: (body) => request('POST', '/api/runs', body),
  runs: (limit = 50) => request('GET', `/api/runs${qs({ limit })}`),
  run: (id) => request('GET', `/api/runs/${id}`),
  deleteRun: (id) => request('DELETE', `/api/runs/${id}`),
  reportUrl: (id, kind) => `/api/runs/${id}/${{ html: 'report.html', junit: 'report.junit.xml', json: 'report.json' }[kind]}`,
  // dashboard
  summary: (days = 30) => request('GET', `/api/dashboard/summary${qs({ days })}`),
  // coverage
  coveragePrograms: () => request('GET', '/api/coverage/programs'),
  coverageResult: (resultId) => request('GET', `/api/coverage/result/${resultId}`),
  coverageMerge: (body) => request('POST', '/api/coverage/merge', body),
  // schedules
  schedules: () => request('GET', '/api/schedules'),
  createSchedule: (s) => request('POST', '/api/schedules', s),
  updateSchedule: (id, s) => request('PUT', `/api/schedules/${id}`, s),
  deleteSchedule: (id) => request('DELETE', `/api/schedules/${id}`),
};

// Small hook-free helper used by pages: run an async loader and track state.
import { useCallback, useEffect, useState } from 'react';
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return loader()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState((s) => ({ data: s.data, error, loading: false })));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}
