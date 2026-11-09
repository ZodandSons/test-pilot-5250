/** Minimal 5-field cron (minute hour day-of-month month day-of-week). */
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function parseField(expr, [lo, hi]) {
  const set = new Set();
  for (const part of expr.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let a = lo, b = hi;
    if (rangePart !== '*') {
      const [x, y] = rangePart.split('-').map(Number);
      a = x; b = y ?? (stepPart ? hi : x);
    }
    if ([a, b, step].some((n) => Number.isNaN(n)) || a < lo || b > hi || step < 1) throw new Error(`Invalid cron field "${expr}"`);
    for (let v = a; v <= b; v += step) set.add(v === 7 && hi === 6 ? 0 : v);
  }
  return set;
}

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron must have 5 fields: m h dom mon dow');
  const f = parts.map((p, i) => parseField(p, RANGES[i]));
  return { f, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

export function cronMatches(c, d) {
  const [m, h, dom, mon, dow] = c.f;
  if (!m.has(d.getMinutes()) || !h.has(d.getHours()) || !mon.has(d.getMonth() + 1)) return false;
  const domOk = dom.has(d.getDate()), dowOk = dow.has(d.getDay());
  if (c.domStar || c.dowStar) return domOk && dowOk;
  return domOk || dowOk;
}

export function nextRun(expr, from = new Date()) {
  const c = parseCron(expr);
  const d = new Date(from); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 366; i++) { if (cronMatches(c, d)) return d; d.setMinutes(d.getMinutes() + 1); }
  return null;
}
