// Hand-built SVG charts (d3-scale for math). Thin marks, hairline grid, hover tooltips.
import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import { line as d3line, area as d3area, curveMonotoneX } from 'd3-shape';
import { fmtDay } from '../util.js';

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Tooltip({ x, y, w, children }) {
  if (x === null || x === undefined) return null;
  const left = Math.min(Math.max(x + 12, 0), w - 180);
  return <div className="chart-tip" style={{ left, top: Math.max(0, y - 10) }}>{children}</div>;
}

const M = { top: 12, right: 12, bottom: 26, left: 40 };

function tickEvery(n, width) {
  const max = Math.max(2, Math.floor(width / 70));
  return Math.max(1, Math.ceil(n / max));
}

// Stacked passed/failed bars per day. series: [{key,label,color}]
export function StackedBars({ data, xKey, series, height = 220, xFormat = fmtDay, valueLabel = '' }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const rows = data || [];
  const inner = { w: width - M.left - M.right, h: height - M.top - M.bottom };
  const x = useMemo(() => scaleBand().domain(rows.map((d) => d[xKey])).range([0, inner.w]).paddingInner(rows.length > 40 ? 0.15 : 0.3), [rows, inner.w, xKey]);
  const maxV = Math.max(1, ...rows.map((d) => series.reduce((a, s) => a + (d[s.key] || 0), 0)));
  const y = scaleLinear().domain([0, maxV]).nice(4).range([inner.h, 0]);
  const every = tickEvery(rows.length, inner.w);
  if (!rows.length) return <div className="chart-empty">No runs in this period yet.</div>;
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Stacked bar chart">
        <g transform={`translate(${M.left},${M.top})`}>
          {y.ticks(4).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x2={inner.w} className="grid" />
              <text x={-8} dy="0.32em" className="tick" textAnchor="end">{t}</text>
            </g>
          ))}
          {rows.map((d, i) => {
            let acc = 0;
            const bw = x.bandwidth();
            return (
              <g key={d[xKey]} transform={`translate(${x(d[xKey])},0)`}>
                {series.map((s, si) => {
                  const v = d[s.key] || 0;
                  if (!v) return null;
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const isTop = series.slice(si + 1).every((n) => !d[n.key]);
                  const h = Math.max(0, y0 - y1 - (acc - v > 0 ? 2 : 0));
                  const r = isTop ? Math.min(3, bw / 2, h) : 0;
                  return <path key={s.key} d={roundedTop(0, y1, bw, h, r)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
                })}
                <rect x={-x.step() * x.paddingInner() / 2} width={x.step()} height={inner.h} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            );
          })}
          <line y1={inner.h} y2={inner.h} x2={inner.w} className="axis" />
          {rows.map((d, i) => i % every === 0 && (
            <text key={d[xKey]} x={x(d[xKey]) + x.bandwidth() / 2} y={inner.h + 17} className="tick" textAnchor="middle">{xFormat(d[xKey])}</text>
          ))}
        </g>
      </svg>
      {hover !== null && rows[hover] && (
        <Tooltip x={M.left + x(rows[hover][xKey]) + x.bandwidth()} y={M.top + 10} w={width}>
          <strong>{xFormat(rows[hover][xKey])}</strong>
          {series.map((s) => (
            <div key={s.key} className="tip-row"><span className="swatch" style={{ background: s.color }} />{s.label}<b>{rows[hover][s.key] || 0}{valueLabel}</b></div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

function roundedTop(x, y, w, h, r) {
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Single-series line with crosshair tooltip. Title names the series, so no legend.
export function LineChart({ data, xKey, yKey, color = 'var(--series-1)', height = 200, yDomain, yFormat = (v) => v, xFormat = fmtDay, area = true }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const rows = (data || []).filter((d) => d[yKey] !== null && d[yKey] !== undefined);
  const inner = { w: width - M.left - M.right, h: height - M.top - M.bottom };
  if (!rows.length) return <div className="chart-empty">Nothing to plot yet.</div>;
  const x = scalePoint().domain(rows.map((d) => d[xKey])).range([0, inner.w]).padding(0.2);
  const vals = rows.map((d) => d[yKey]);
  const y = scaleLinear().domain(yDomain || [Math.min(...vals) * 0.95, Math.max(...vals) * 1.02]).nice(4).range([inner.h, 0]);
  const path = d3line().x((d) => x(d[xKey])).y((d) => y(d[yKey])).curve(curveMonotoneX)(rows);
  const fill = d3area().x((d) => x(d[xKey])).y0(inner.h).y1((d) => y(d[yKey])).curve(curveMonotoneX)(rows);
  const every = tickEvery(rows.length, inner.w);
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0;
    rows.forEach((d, i) => { if (Math.abs(x(d[xKey]) - px) < Math.abs(x(rows[best][xKey]) - px)) best = i; });
    setHover(best);
  };
  const last = rows[rows.length - 1];
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Line chart">
        <g transform={`translate(${M.left},${M.top})`}>
          {y.ticks(4).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x2={inner.w} className="grid" />
              <text x={-8} dy="0.32em" className="tick" textAnchor="end">{yFormat(t)}</text>
            </g>
          ))}
          {area && <path d={fill} fill={color} opacity={0.12} />}
          <path d={path} fill="none" stroke={color} strokeWidth={2} />
          <line y1={inner.h} y2={inner.h} x2={inner.w} className="axis" />
          {rows.map((d, i) => i % every === 0 && (
            <text key={d[xKey]} x={x(d[xKey])} y={inner.h + 17} className="tick" textAnchor="middle">{xFormat(d[xKey])}</text>
          ))}
          <circle cx={x(last[xKey])} cy={y(last[yKey])} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
          <text x={Math.min(x(last[xKey]), inner.w - 4)} y={y(last[yKey]) - 10} className="direct-label" textAnchor="end">{yFormat(last[yKey])}</text>
          {hover !== null && (
            <g>
              <line x1={x(rows[hover][xKey])} x2={x(rows[hover][xKey])} y2={inner.h} className="crosshair" />
              <circle cx={x(rows[hover][xKey])} cy={y(rows[hover][yKey])} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
          <rect width={inner.w} height={inner.h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </g>
      </svg>
      {hover !== null && (
        <Tooltip x={M.left + x(rows[hover][xKey])} y={M.top + y(rows[hover][yKey])} w={width}>
          <strong>{xFormat(rows[hover][xKey])}</strong>
          <div className="tip-row"><span className="swatch" style={{ background: color }} />{yFormat(rows[hover][yKey])}</div>
        </Tooltip>
      )}
    </div>
  );
}

// Horizontal stacked bars per category (e.g. by suite).
export function HStackedBars({ data, labelKey, series }) {
  const rows = data || [];
  const [hover, setHover] = useState(null);
  if (!rows.length) return <div className="chart-empty">No suites yet.</div>;
  const max = Math.max(1, ...rows.map((d) => series.reduce((a, s) => a + (d[s.key] || 0), 0)));
  return (
    <div className="hbars">
      {rows.map((d, i) => {
        const total = series.reduce((a, s) => a + (d[s.key] || 0), 0);
        return (
          <div className="hbar-row" key={d[labelKey]} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="hbar-label">{d[labelKey]}</span>
            <span className="hbar-track">
              {series.map((s) => (d[s.key] ? (
                <span key={s.key} className="hbar-seg" style={{ width: `${(d[s.key] / max) * 100}%`, background: s.color }} />
              ) : null))}
            </span>
            <span className="hbar-value">{total}</span>
            {hover === i && (
              <div className="chart-tip hbar-tip">
                <strong>{d[labelKey]}</strong>
                {series.map((s) => <div key={s.key} className="tip-row"><span className="swatch" style={{ background: s.color }} />{s.label}<b>{d[s.key] || 0}</b></div>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ series }) {
  return (
    <div className="legend">
      {series.map((s) => <span key={s.key}><span className="swatch" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}
