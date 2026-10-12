import { dayKey, type SeriesPoint } from './stats';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const HEIGHT = 260;
export const MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const DAY_MS = 86_400_000;

export interface ChartSeries {
  label: string;
  points: SeriesPoint[];
  /** Added to the line's class list; colours come from CSS (.chart-line.<className>). */
  className: string;
  /** Draw a dot on each point (raw entries). */
  dots: boolean;
  /** Smooth monotone curve instead of straight segments (never overshoots the data). */
  smooth: boolean;
}

export interface ChartOptions {
  unit: string;
  /** Tooltip heading for the hovered x value. */
  formatX: (x: number, series: ChartSeries) => string;
}

type Pt = { x: number; y: number };

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Round, evenly spaced y ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Midnight ticks spaced so the labels fit. */
export function dateTicks(from: number, to: number, width: number): number[] {
  const maxTicks = Math.max(2, Math.floor(width / 80));
  const spanDays = Math.max(1, (to - from) / DAY_MS);
  const stepDays = [1, 2, 7, 14, 30, 61, 91, 182, 365].find((s) => spanDays / s <= maxTicks) ?? 365;
  const ticks: number[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < from) d.setDate(d.getDate() + 1);
  while (d.getTime() <= to) {
    ticks.push(d.getTime());
    d.setDate(d.getDate() + stepDays);
  }
  return ticks;
}

/** Splits a series into runs of consecutive non-null points (a null breaks the line). */
function segments(points: SeriesPoint[]): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push({ x: p.x, y: p.y });
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * Monotone cubic path through pixel points (Fritsch–Carlson, as in d3's curveMonotoneX):
 * smooth, but never bulges above or below the data between points.
 */
export function monotonePath(pts: Pt[]): string {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const n = pts.length;
  const h = (i: number) => pts[i + 1].x - pts[i].x;
  const s = (i: number) => (pts[i + 1].y - pts[i].y) / (h(i) || 1);
  const m: number[] = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const s0 = s(i - 1);
    const s1 = s(i);
    const p = (s0 * h(i) + s1 * h(i - 1)) / (h(i - 1) + h(i) || 1);
    m[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  // Ends: tangent that keeps the end segment monotone.
  m[0] = (3 * s(0) - m[1]) / 2;
  m[n - 1] = (3 * s(n - 2) - m[n - 2]) / 2;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = h(i) / 3;
    d +=
      `C${(pts[i].x + dx).toFixed(1)},${(pts[i].y + m[i] * dx).toFixed(1)}` +
      ` ${(pts[i + 1].x - dx).toFixed(1)},${(pts[i + 1].y - m[i + 1] * dx).toFixed(1)}` +
      ` ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

export const tickDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/**
 * Renders a multi-series line chart into `host`, sharing one y axis, with a hover crosshair and a
 * tooltip listing every series' value on the hovered day. `from`/`to` set the x range.
 */
export function renderLineChart(host: HTMLElement, series: ChartSeries[], from: number, to: number, opts: ChartOptions): void {
  host.replaceChildren();
  const valued = series.map((s) => s.points.filter((p): p is Pt & SeriesPoint => p.y !== null));
  const all = valued.flat();
  if (all.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted chart-empty';
    empty.textContent = 'No data in this date range.';
    host.append(empty);
    return;
  }

  const width = Math.max(280, host.clientWidth);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const ys = all.map((p) => p.y);
  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys));
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const xSpan = Math.max(1, to - from);
  const sx = (x: number) => MARGIN.left + ((x - from) / xSpan) * plotW;
  const sy = (y: number) => MARGIN.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  const root = svg('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, class: 'chart-svg' });
  root.setAttribute('aria-hidden', 'true');

  for (const t of yTicks) {
    root.append(svg('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: sy(t), y2: sy(t), class: 'chart-grid' }));
    const label = svg('text', { x: MARGIN.left - 8, y: sy(t), class: 'chart-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    label.textContent = String(Number(t.toFixed(1)));
    root.append(label);
  }
  root.append(svg('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: MARGIN.top + plotH, y2: MARGIN.top + plotH, class: 'chart-axis' }));

  for (const t of dateTicks(from, to, plotW)) {
    // Anchor labels near either edge inward so they are not clipped.
    const x = sx(t);
    const anchor = x < MARGIN.left + 24 ? 'start' : x > width - MARGIN.right - 24 ? 'end' : 'middle';
    const label = svg('text', { x, y: HEIGHT - 8, class: 'chart-tick', 'text-anchor': anchor });
    label.textContent = tickDate.format(t);
    root.append(label);
  }

  // Each series is drawn whole (line, then its dots) in order, so later series sit on top.
  series.forEach((s, i) => {
    for (const run of segments(s.points)) {
      const px = run.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
      const d = s.smooth ? monotonePath(px) : px.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
      root.append(svg('path', { d, class: `chart-line ${s.className}` }));
      if (run.length === 1 && !s.dots) root.append(svg('circle', { cx: px[0].x, cy: px[0].y, r: 3, class: `chart-dot ${s.className}` }));
    }
    if (s.dots) for (const p of valued[i]) root.append(svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 4, class: `chart-dot ${s.className}` }));
  });

  // Hover layer: snap to the nearest point of any series, then show every series' value for that day.
  const crosshair = svg('line', { y1: MARGIN.top, y2: MARGIN.top + plotH, class: 'chart-crosshair', visibility: 'hidden' });
  const focus = series.map((s) => svg('circle', { r: 5, class: `chart-focus ${s.className}`, visibility: 'hidden' }));
  const hit = svg('rect', { x: MARGIN.left, y: 0, width: plotW, height: HEIGHT, fill: 'transparent' });
  root.append(crosshair, ...focus, hit);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;

  const hide = () => {
    crosshair.setAttribute('visibility', 'hidden');
    focus.forEach((f) => f.setAttribute('visibility', 'hidden'));
    tooltip.hidden = true;
  };

  hit.addEventListener('pointermove', (event) => {
    const box = root.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    let nearest = { p: all[0], s: 0 };
    valued.forEach((points, s) => {
      for (const p of points) if (Math.abs(sx(p.x) - px) < Math.abs(sx(nearest.p.x) - px)) nearest = { p, s };
    });
    const cx = sx(nearest.p.x);
    const day = dayKey(nearest.p.x);
    crosshair.setAttribute('x1', String(cx));
    crosshair.setAttribute('x2', String(cx));
    crosshair.setAttribute('visibility', 'visible');

    tooltip.replaceChildren();
    const heading = document.createElement('span');
    heading.className = 'chart-tooltip-heading';
    heading.textContent = opts.formatX(nearest.p.x, series[nearest.s]);
    tooltip.append(heading);

    series.forEach((s, i) => {
      // The hovered point for its own series; for the others, their point on the same day closest in time.
      const match =
        i === nearest.s
          ? nearest.p
          : valued[i]
              .filter((p) => dayKey(p.x) === day)
              .sort((a, b) => Math.abs(a.x - nearest.p.x) - Math.abs(b.x - nearest.p.x))[0];
      if (!match) {
        focus[i].setAttribute('visibility', 'hidden');
        return;
      }
      focus[i].setAttribute('cx', String(sx(match.x)));
      focus[i].setAttribute('cy', String(sy(match.y)));
      focus[i].setAttribute('visibility', 'visible');
      const row = document.createElement('span');
      row.className = 'chart-tooltip-row';
      const swatch = document.createElement('i');
      swatch.className = `chart-swatch ${s.className}`;
      const label = document.createElement('span');
      label.textContent = s.label;
      const value = document.createElement('strong');
      value.textContent = `${match.y.toFixed(1)} ${opts.unit}`;
      row.append(swatch, label, value);
      tooltip.append(row);
    });

    tooltip.hidden = false;
    // Keep the tooltip inside the chart: flip to the left of the point past the midpoint.
    tooltip.style.left = `${(cx / width) * box.width}px`;
    tooltip.style.top = `${(sy(nearest.p.y) / HEIGHT) * box.height}px`;
    tooltip.classList.toggle('flip', cx > width / 2);
  });
  hit.addEventListener('pointerleave', hide);

  host.append(root, tooltip);
}
