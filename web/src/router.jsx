// Minimal hash router: #/runs/abc -> path "/runs/abc". Works with any static host.
import { useEffect, useState } from 'react';

const getPath = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];

export function usePath() {
  const [path, setPath] = useState(getPath());
  useEffect(() => {
    const on = () => setPath(getPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function navigate(to) {
  window.location.hash = to;
}

// Match "/runs/:id" against a path; returns params or null.
export function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, children, className, ...rest }) {
  return (
    <a href={`#${to}`} className={className} {...rest}>
      {children}
    </a>
  );
}
