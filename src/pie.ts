// The "Food breakdown" pie: one slice per food category, sized by number of entries,
// with a legend that names every slice (count and percent) and doubles as its table view.

import type { CategoryCount } from './food';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 220;
const R = 100;
const C = SIZE / 2;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** SVG path for a pie slice from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
export function slicePath(a0: number, a1: number, r = R, cx = C, cy = C): string {
  const point = (a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx},${cy}L${point(a0)}A${r},${r} 0 ${large} 1 ${point(a1)}Z`;
}

/** Whole percents; slices under 1% show "<1%" rather than rounding to 0. */
export const formatPct = (pct: number) => (pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`);

/**
 * Renders the pie and its legend. Slice colours come from CSS (`.cat-<id>`), fixed per category,
 * so a category keeps its colour whatever the counts. Hovering a slice or legend row highlights it
 * and describes it in `detail`.
 */
export function renderFoodPie(host: HTMLElement, detail: HTMLElement, counts: CategoryCount[], total: number): void {
  host.replaceChildren();
  detail.textContent = '';
  if (total === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted chart-empty';
    empty.textContent = 'No food logged in this range.';
    host.append(empty);
    return;
  }

  const root = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'pie-svg', role: 'img' });
  root.setAttribute('aria-label', `Food by category: ${counts.map((c) => `${c.label} ${formatPct(c.pct)}`).join(', ')}`);
  const legend = document.createElement('ul');
  legend.className = 'pie-legend';

  const describe = (c: CategoryCount) => `${c.label} · ${c.count} of ${total} entries (${formatPct(c.pct)})`;
  const slices: SVGElement[] = [];
  const rows: HTMLLIElement[] = [];
  const highlight = (index: number | null) => {
    slices.forEach((s, i) => s.classList.toggle('dim', index !== null && i !== index));
    rows.forEach((r, i) => r.classList.toggle('active', i === index));
    detail.textContent = index === null ? `${total} entries` : describe(counts[index]);
  };

  let angle = 0;
  counts.forEach((c, i) => {
    const sweep = (c.count / total) * Math.PI * 2;
    const shape =
      counts.length === 1
        ? svg('circle', { cx: C, cy: C, r: R, class: `pie-slice cat-${c.id}` })
        : svg('path', { d: slicePath(angle, angle + sweep), class: `pie-slice cat-${c.id}` });
    angle += sweep;
    shape.addEventListener('pointerenter', () => highlight(i));
    shape.addEventListener('pointerleave', () => highlight(null));
    slices.push(shape);
    root.append(shape);

    const row = document.createElement('li');
    const swatch = document.createElement('i');
    swatch.className = `pie-swatch cat-${c.id}`;
    const label = document.createElement('span');
    label.className = 'pie-label';
    label.textContent = c.label;
    const count = document.createElement('span');
    count.className = 'pie-count';
    count.textContent = String(c.count);
    const pct = document.createElement('strong');
    pct.className = 'pie-pct';
    pct.textContent = formatPct(c.pct);
    row.append(swatch, label, count, pct);
    row.tabIndex = 0;
    row.addEventListener('pointerenter', () => highlight(i));
    row.addEventListener('pointerleave', () => highlight(null));
    row.addEventListener('focus', () => highlight(i));
    row.addEventListener('blur', () => highlight(null));
    rows.push(row);
    legend.append(row);
  });

  const figure = document.createElement('div');
  figure.className = 'pie-figure';
  figure.append(root);
  host.append(figure, legend);
  highlight(null);
}
