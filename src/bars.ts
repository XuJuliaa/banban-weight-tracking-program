// Minutes-per-day bar chart for one exercise category: one bar per calendar day on the same
// axes style as the weight chart, with a tooltip naming that day's sessions.

import { dateTicks, HEIGHT, MARGIN, niceTicks, svg, tickDate } from './chart';
import { type DayMinutes, formatMinutes } from './exercise';

const RADIUS = 4;
const GAP = 2;
/** Widest a bar gets, so a 7-day range doesn't draw slabs. */
const MAX_BAR = 48;

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** SVG path for a bar with rounded top corners and a square base sitting on the axis. */
export function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return (
    `M${x.toFixed(1)},${(y + h).toFixed(1)}V${(y + r).toFixed(1)}` +
    `Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}` +
    `H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}` +
    `V${(y + h).toFixed(1)}Z`
  );
}

/**
 * Renders `days` (consecutive calendar days) as bars in `host`. Days with 0 minutes get no bar but
 * still answer hover. `className` picks the bar colour (e.g. "ex-cardio"); `emptyText` shows when
 * every day is 0.
 */
export function renderBarChart(host: HTMLElement, days: DayMinutes[], className: string, emptyText: string): void {
  host.replaceChildren();
  if (!days.some((d) => d.minutes > 0)) {
    const empty = document.createElement('p');
    empty.className = 'muted chart-empty';
    empty.textContent = emptyText;
    host.append(empty);
    return;
  }

  const width = Math.max(280, host.clientWidth);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = plotW / days.length;
  const barW = Math.max(1, Math.min(MAX_BAR, slot - GAP));

  const yTicks = niceTicks(0, Math.max(...days.map((d) => d.minutes)));
  const yMax = yTicks[yTicks.length - 1];
  const sy = (m: number) => MARGIN.top + (1 - m / yMax) * plotH;
  const slotX = (i: number) => MARGIN.left + i * slot;
  const centerX = (i: number) => slotX(i) + slot / 2;

  const root = svg('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, class: `chart-svg bar-chart ${className}` });
  root.setAttribute('aria-hidden', 'true');

  for (const t of yTicks) {
    root.append(svg('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: sy(t), y2: sy(t), class: 'chart-grid' }));
    const label = svg('text', { x: MARGIN.left - 8, y: sy(t), class: 'chart-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    label.textContent = String(t);
    root.append(label);
  }

  // Date labels under the bar for that day, spaced by the same rule as the weight chart.
  const first = days[0].day;
  const indexOf = new Map(days.map((d, i) => [d.day, i]));
  for (const t of dateTicks(first, days[days.length - 1].day, plotW)) {
    const i = indexOf.get(t);
    if (i === undefined) continue;
    const x = centerX(i);
    const anchor = x < MARGIN.left + 24 ? 'start' : x > width - MARGIN.right - 24 ? 'end' : 'middle';
    const label = svg('text', { x, y: HEIGHT - 8, class: 'chart-tick', 'text-anchor': anchor });
    label.textContent = tickDate.format(t);
    root.append(label);
  }

  const bars = days.map((d, i) => {
    if (d.minutes <= 0) return null;
    const y = sy(d.minutes);
    const bar = svg('path', { d: barPath(centerX(i) - barW / 2, y, barW, MARGIN.top + plotH - y), class: 'bar' });
    root.append(bar);
    return bar;
  });
  root.append(svg('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: MARGIN.top + plotH, y2: MARGIN.top + plotH, class: 'chart-axis' }));

  // Hover: a full-height hit area per day, larger than the bar itself.
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  const highlight = (index: number | null) => bars.forEach((b, i) => b?.classList.toggle('dim', index !== null && i !== index));

  days.forEach((d, i) => {
    const hit = svg('rect', { x: slotX(i), y: MARGIN.top, width: slot, height: plotH, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => {
      highlight(i);
      const heading = document.createElement('span');
      heading.className = 'chart-tooltip-heading';
      heading.textContent = dayFormat.format(d.day);
      const row = document.createElement('span');
      row.className = 'chart-tooltip-row';
      const value = document.createElement('strong');
      value.textContent = d.minutes ? formatMinutes(d.minutes) : 'Rest day';
      row.append(value);
      tooltip.replaceChildren(heading, row);
      if (d.activities.length) {
        const names = document.createElement('span');
        names.className = 'chart-tooltip-note';
        names.textContent = d.activities.join(', ');
        tooltip.append(names);
      }
      const box = root.getBoundingClientRect();
      tooltip.hidden = false;
      tooltip.style.left = `${(centerX(i) / width) * box.width}px`;
      tooltip.style.top = `${(sy(d.minutes) / HEIGHT) * box.height}px`;
      tooltip.classList.toggle('flip', centerX(i) > width / 2);
    });
    hit.addEventListener('pointerleave', () => {
      highlight(null);
      tooltip.hidden = true;
    });
    root.append(hit);
  });

  host.append(root, tooltip);
}
