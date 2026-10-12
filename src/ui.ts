import { renderBarChart } from './bars';
import { type ChartSeries, renderLineChart } from './chart';
import {
  dailyMinutes,
  EXERCISE_CATEGORIES,
  type ExerciseCategoryId,
  exerciseCategoryLabel,
  exercisesIn,
  exerciseSummary,
  formatMinutes,
} from './exercise';
import { categoryCounts, categoryLabel, FOOD_CATEGORIES, UNCATEGORIZED } from './food';
import { renderFoodPie } from './pie';
import { dayKey, loggingFrequency60d, movingAverage10d, movingAverageSeries, weightSeries } from './stats';
import { profileSlug } from './names';
import type { ProfileSummary, UserData } from './types';
import { pointsIn } from './units';
import type { UserdataStatus } from './userdata-api';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export const dom = {
  profileControls: el<HTMLDivElement>('profile-controls'),
  profileSelect: el<HTMLSelectElement>('profile-select'),
  newProfileBtn: el<HTMLButtonElement>('new-profile-btn'),
  unitToggle: el<HTMLDivElement>('unit-toggle'),
  unitButtons: [...document.querySelectorAll<HTMLButtonElement>('#unit-toggle button[data-unit]')],
  onboarding: el<HTMLElement>('onboarding'),
  onboardingForm: el<HTMLFormElement>('onboarding-form'),
  tracker: el<HTMLDivElement>('tracker'),
  entryForm: el<HTMLFormElement>('entry-form'),
  weightInput: el<HTMLInputElement>('weight-input'),
  unitLabel: el<HTMLSpanElement>('unit-label'),
  avgValue: el<HTMLSpanElement>('avg-value'),
  avgNote: el<HTMLSpanElement>('avg-note'),
  freqValue: el<HTMLSpanElement>('freq-value'),
  freqNote: el<HTMLSpanElement>('freq-note'),
  freqMeter: el<HTMLDivElement>('freq-meter'),
  foodForm: el<HTMLFormElement>('food-form'),
  foodInput: el<HTMLInputElement>('food-input'),
  foodCategory: el<HTMLSelectElement>('food-category'),
  foodVizCard: el<HTMLElement>('food-viz-card'),
  foodRangeStart: el<HTMLInputElement>('food-range-start'),
  foodRangeEnd: el<HTMLInputElement>('food-range-end'),
  foodPie: el<HTMLDivElement>('food-pie'),
  foodPieDetail: el<HTMLParagraphElement>('food-pie-detail'),
  foodTableSummary: el<HTMLElement>('food-table-summary'),
  foodTableBody: el<HTMLTableSectionElement>('food-table-body'),
  foodEmpty: el<HTMLParagraphElement>('food-empty'),
  foodList: el<HTMLDivElement>('food-list'),
  exportCsvBtn: el<HTMLButtonElement>('export-csv-btn'),
  exportFoodCsvBtn: el<HTMLButtonElement>('export-food-csv-btn'),
  exportExerciseCsvBtn: el<HTMLButtonElement>('export-exercise-csv-btn'),
  exerciseForm: el<HTMLFormElement>('exercise-form'),
  exerciseName: el<HTMLInputElement>('exercise-name'),
  exerciseCategory: el<HTMLSelectElement>('exercise-category'),
  exerciseMinutes: el<HTMLInputElement>('exercise-minutes'),
  exerciseEmpty: el<HTMLParagraphElement>('exercise-empty'),
  exerciseList: el<HTMLDivElement>('exercise-list'),
  exerciseCard: el<HTMLElement>('exercise-card'),
  exerciseRangeStart: el<HTMLInputElement>('exercise-range-start'),
  exerciseRangeEnd: el<HTMLInputElement>('exercise-range-end'),
  exerciseTabs: [...document.querySelectorAll<HTMLButtonElement>('#exercise-tabs [role="tab"]')],
  exercisePanel: el<HTMLDivElement>('exercise-panel'),
  exerciseCaption: el<HTMLParagraphElement>('exercise-caption'),
  exerciseSummary: el<HTMLDivElement>('exercise-summary'),
  exerciseChart: el<HTMLDivElement>('exercise-chart'),
  exerciseTableSummary: el<HTMLElement>('exercise-table-summary'),
  exerciseTableBody: el<HTMLTableSectionElement>('exercise-table-body'),
  folderStatus: el<HTMLParagraphElement>('folder-status'),
  folderFiles: el<HTMLUListElement>('folder-files'),
  importBtn: el<HTMLButtonElement>('import-btn'),
  importFile: el<HTMLInputElement>('import-file'),
  overrideForm: el<HTMLFormElement>('override-form'),
  overrideDate: el<HTMLInputElement>('override-date'),
  overrideWeight: el<HTMLInputElement>('override-weight'),
  overrideUnit: el<HTMLSpanElement>('override-unit'),
  overrideCurrent: el<HTMLParagraphElement>('override-current'),
  confirmDialog: el<HTMLDialogElement>('confirm-dialog'),
  confirmTitle: el<HTMLHeadingElement>('confirm-title'),
  confirmBody: el<HTMLDivElement>('confirm-body'),
  confirmOk: el<HTMLButtonElement>('confirm-ok'),
  newProfileDialog: el<HTMLDialogElement>('new-profile-dialog'),
  newProfileForm: el<HTMLFormElement>('new-profile-form'),
  newProfileCancel: el<HTMLButtonElement>('new-profile-cancel'),
  toast: el<HTMLParagraphElement>('toast'),
  rangeStart: el<HTMLInputElement>('range-start'),
  rangeEnd: el<HTMLInputElement>('range-end'),
  chartsCard: el<HTMLElement>('charts-card'),
  chartFigure: el<HTMLElement>('chart-figure'),
  chartTitle: el<HTMLElement>('chart-title'),
  chartHost: el<HTMLDivElement>('chart-host'),
  chartTableValue: el<HTMLTableCellElement>('chart-table-value'),
  chartTableAverage: el<HTMLTableCellElement>('chart-table-average'),
  chartTableSummary: el<HTMLElement>('chart-table-summary'),
  chartTableBody: el<HTMLTableSectionElement>('chart-table-body'),
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const formatWeight = (w: number) => w.toFixed(1);

export function renderProfiles(profiles: ProfileSummary[], currentId: string | null): void {
  dom.profileControls.hidden = profiles.length === 0;
  dom.profileSelect.replaceChildren(
    ...profiles.map((p) => {
      const option = new Option(p.name, p.userId);
      option.selected = p.userId === currentId;
      return option;
    }),
  );
}

export function renderUser(user: UserData | null, now: number): void {
  dom.onboarding.hidden = user !== null;
  dom.tracker.hidden = user === null;
  if (!user) return;

  dom.unitLabel.textContent = user.unit;
  for (const btn of dom.unitButtons) btn.setAttribute('aria-pressed', String(btn.dataset.unit === user.unit));

  // Everything on the page reads the weight column for the chosen unit.
  const points = pointsIn(user.entries, user.unit);
  const avg = movingAverage10d(points, now);
  dom.avgValue.textContent = avg === null ? '—' : `${formatWeight(avg)} ${user.unit}`;
  dom.avgNote.textContent = avg === null ? 'No entries in the last 10 days' : '';

  const freq = loggingFrequency60d(points, now);
  dom.freqValue.textContent = `${Math.round(freq.pct)}%`;
  dom.freqNote.textContent = `${freq.daysLogged} of the last ${freq.totalDays} days had an entry`;
  dom.freqMeter.style.width = `${freq.pct}%`;
  dom.freqMeter.parentElement?.setAttribute('aria-label', `${Math.round(freq.pct)}% of days logged`);

  renderFoods(user, now);
  renderExercises(user, now);
}

/** Most rows the weight and food data tables show; older entries are reached by narrowing the date range. */
export const TABLE_ROW_LIMIT = 100;
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** Below the food log: only what was eaten today, newest first. Older entries are in the breakdown's data table. */
function renderFoods(user: UserData, now: number): void {
  const today = dayKey(now);
  const foods = (user.foods ?? []).filter((f) => dayKey(f.timestamp) === today).sort((a, b) => b.timestamp - a.timestamp);
  dom.foodEmpty.hidden = foods.length > 0;
  if (!foods.length) {
    dom.foodList.replaceChildren();
    return;
  }
  const section = document.createElement('section');
  section.className = 'food-day';
  const heading = document.createElement('h3');
  heading.textContent = `Today (${foods.length})`;
  const list = document.createElement('ul');
  list.append(
    ...foods.map((f) => {
      const li = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = timeFormat.format(f.timestamp);
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = f.text;
      const tag = document.createElement('span');
      tag.className = `food-tag cat-${f.category ?? UNCATEGORIZED.id}`;
      tag.append(document.createElement('i'), categoryLabel(f.category));
      li.append(time, text, tag);
      return li;
    }),
  );
  section.append(heading, list);
  dom.foodList.replaceChildren(section);
}

let toastTimer: number | undefined;
export function showToast(message: string): void {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.remove('show'), 2500);
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Noon on the day of `timestamp`: where a whole-day value (the 10-day average) is plotted. */
const middayOf = (timestamp: number) => new Date(timestamp).setHours(12, 0, 0, 0);

/**
 * Draws weight entries and the 10-day average on one chart for local days `startDay`..`endDay`,
 * and fills the data table (one row per entry, newest first, with that day's average).
 */
export function renderChart(user: UserData, startDay: number, endDay: number): void {
  const points = pointsIn(user.entries, user.unit);
  const weights = weightSeries(points, startDay, endDay);
  // The average is only known up to today, so a range ending in the future doesn't draw a flat line into it.
  const now = Date.now();
  const averages = movingAverageSeries(points, startDay, endDay)
    .filter((p) => p.x <= now)
    .map((p) => ({ ...p, x: middayOf(p.x) }));
  const averageByDay = new Map(averages.map((p) => [dayKey(p.x), p.y]));

  const from = new Date(startDay).setHours(0, 0, 0, 0);
  const to = new Date(endDay).setHours(23, 59, 59, 999);

  dom.chartFigure.hidden = false;
  dom.chartTitle.textContent = `Weight (${user.unit}), ${shortDayFormat.format(from)} – ${shortDayFormat.format(to)}`;

  const series: ChartSeries[] = [
    { label: 'Weight', points: weights, className: 'series-weight', dots: true, smooth: false },
    { label: '10-day avg', points: averages, className: 'series-average', dots: false, smooth: true },
  ];
  renderLineChart(dom.chartHost, series, from, to, {
    unit: user.unit,
    formatX: (x, s) => (s.dots ? dateFormat.format(x) : dayFormat.format(x)),
  });

  dom.chartTableValue.textContent = `Weight (${user.unit})`;
  dom.chartTableAverage.textContent = `10-day avg (${user.unit})`;
  const allRows = weights.filter((p): p is { x: number; y: number; id?: string } => p.y !== null).reverse();
  const rows = allRows.slice(0, TABLE_ROW_LIMIT);
  dom.chartTableSummary.textContent = tableSummary(rows.length, allRows.length);
  dom.chartTableBody.replaceChildren(
    ...rows.map((p) => {
      const tr = document.createElement('tr');
      const date = document.createElement('td');
      date.textContent = dateFormat.format(p.x);
      const value = document.createElement('td');
      value.textContent = formatWeight(p.y);
      const avg = document.createElement('td');
      const dayAvg = averageByDay.get(dayKey(p.x));
      avg.textContent = dayAvg == null ? '—' : formatWeight(dayAvg);
      tr.append(date, value, avg);
      return tr;
    }),
  );
}


/** The "Data folder" row: where this profile's data is saved, which is userdata/ when running locally. */
export function renderFolder(status: UserdataStatus, path: string | null, user: UserData | null): void {
  const where = path ?? 'the project\'s userdata/ folder';
  const text: Record<UserdataStatus, string> = {
    unknown: 'Data folder: checking for the local userdata/ folder…',
    connected: `Data folder: ${where}. ${user ? `${user.name}'s data is saved to these files after every change:` : ''}`,
    offline: "Data folder: can't reach the local save service, so changes are only saved in this browser for now. Is npm run dev still running?",
    unavailable:
      'Data folder: none here. This copy of the app saves only inside this browser, so use Export now and then. ' +
      'When you run the app with npm run dev, it saves to the project\'s userdata/ folder instead.',
  };
  dom.folderStatus.textContent = text[status];

  const showFiles = status === 'connected' && user !== null;
  dom.folderFiles.hidden = !showFiles;
  if (showFiles) {
    const slug = profileSlug(user.name);
    dom.folderFiles.replaceChildren(
      ...[`${slug}-weight.csv`, `${slug}-food.csv`].map((name) => {
        const li = document.createElement('li');
        const code = document.createElement('code');
        code.textContent = `userdata/${name}`;
        li.append(code);
        return li;
      }),
    );
  }
}

const overrideDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function formatEntry(weight: number, timestamp: number, unit: string): string {
  return `${formatWeight(weight)} ${unit} at ${timeFormat.format(timestamp)}`;
}

/** The "Correct a weight" section: unit label and what's logged on the chosen date. */
export function renderOverride(user: UserData, day: number | null): void {
  dom.overrideUnit.textContent = user.unit;
  dom.overrideDate.max = dayKey(Date.now());
  if (day === null) {
    dom.overrideCurrent.textContent = '';
  } else {
    const key = dayKey(day);
    const onDay = user.entries.filter((e) => dayKey(e.timestamp) === key).sort((a, b) => a.timestamp - b.timestamp);
    dom.overrideCurrent.textContent = onDay.length
      ? `Logged on ${overrideDayFormat.format(day)}: ${onDay.map((e) => formatEntry(e[user.unit], e.timestamp, user.unit)).join(', ')}`
      : `Nothing logged on ${overrideDayFormat.format(day)}. Saving will add an entry.`;
  }
}

/**
 * Shows the confirmation pop-up and resolves true only if the user presses the confirm button.
 * Cancel, Esc, and clicking outside all count as "no". `lines` are shown as a list under `message`.
 */
export function confirmChange(opts: { title: string; message: string; lines?: string[]; warning?: string; confirmLabel: string }): Promise<boolean> {
  dom.confirmTitle.textContent = opts.title;
  const message = document.createElement('p');
  message.textContent = opts.message;
  const parts: HTMLElement[] = [message];
  if (opts.lines?.length) {
    const list = document.createElement('ul');
    list.append(
      ...opts.lines.map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      }),
    );
    parts.push(list);
  }
  if (opts.warning) {
    const warning = document.createElement('p');
    warning.className = 'warning';
    warning.textContent = opts.warning;
    parts.push(warning);
  }
  dom.confirmBody.replaceChildren(...parts);
  dom.confirmOk.textContent = opts.confirmLabel;
  dom.confirmDialog.returnValue = '';
  dom.confirmDialog.showModal();
  return new Promise((resolve) => {
    dom.confirmDialog.addEventListener('close', () => resolve(dom.confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

/** The "Food breakdown" pie for local days `startDay`..`endDay`, counted by number of entries. */
export function renderFoodBreakdown(user: UserData, startDay: number, endDay: number): void {
  const { total, counts } = categoryCounts(user.foods ?? [], startDay, endDay);
  renderFoodPie(dom.foodPie, dom.foodPieDetail, counts, total);

  // The entries behind the pie, newest first, for "Show data table".
  const from = new Date(startDay).setHours(0, 0, 0, 0);
  const to = new Date(endDay).setHours(23, 59, 59, 999);
  const allRows = (user.foods ?? []).filter((f) => f.timestamp >= from && f.timestamp <= to).sort((a, b) => b.timestamp - a.timestamp);
  const rows = allRows.slice(0, TABLE_ROW_LIMIT);
  dom.foodTableSummary.textContent = tableSummary(rows.length, allRows.length);
  dom.foodTableBody.replaceChildren(
    ...rows.map((f) => {
      const tr = document.createElement('tr');
      const date = document.createElement('td');
      date.textContent = dateFormat.format(f.timestamp);
      const food = document.createElement('td');
      food.textContent = f.text;
      // Category is editable here: a dropdown per row (see the change handler in main.ts).
      const category = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = `food-tag cat-${f.category ?? UNCATEGORIZED.id}`;
      const select = document.createElement('select');
      select.className = 'food-category-select';
      select.dataset.foodId = f.id;
      select.setAttribute('aria-label', `Category for ${f.text}, ${date.textContent}`);
      if (!f.category) select.append(new Option('Add category…', '', true, true));
      select.append(...FOOD_CATEGORIES.map((c) => new Option(c.label, c.id, false, c.id === f.category)));
      if (!f.category) select.options[0].disabled = true;
      tag.append(document.createElement('i'), select);
      category.append(tag);
      tr.append(date, food, category);
      return tr;
    }),
  );
}

/** "Show data table (42 entries)", or "(latest 100 of 210 entries)" when the table is capped. */
export function tableSummary(shown: number, total: number): string {
  const noun = total === 1 ? 'entry' : 'entries';
  return shown < total ? `Show data table (latest ${shown} of ${total} ${noun})` : `Show data table (${total} ${noun})`;
}

/** Below the exercise log: only today's sessions, newest first, with the day's total. */
function renderExercises(user: UserData, now: number): void {
  const today = dayKey(now);
  const list = (user.exercises ?? []).filter((e) => dayKey(e.timestamp) === today).sort((a, b) => b.timestamp - a.timestamp);
  dom.exerciseEmpty.hidden = list.length > 0;
  if (!list.length) {
    dom.exerciseList.replaceChildren();
    return;
  }
  const section = document.createElement('section');
  section.className = 'food-day';
  const heading = document.createElement('h3');
  heading.textContent = `Today (${list.length}) · ${formatMinutes(list.reduce((sum, e) => sum + e.minutes, 0))}`;
  const ul = document.createElement('ul');
  ul.append(
    ...list.map((e) => {
      const li = document.createElement('li');
      li.className = 'exercise-row';
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = timeFormat.format(e.timestamp);
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = e.name;
      const tag = document.createElement('span');
      tag.className = `food-tag ex-${e.category}`;
      tag.append(document.createElement('i'), exerciseCategoryLabel(e.category));
      const minutes = document.createElement('span');
      minutes.className = 'exercise-duration';
      minutes.textContent = formatMinutes(e.minutes);
      li.append(time, text, tag, minutes);
      return li;
    }),
  );
  section.append(heading, ul);
  dom.exerciseList.replaceChildren(section);
}

export type ExerciseTab = 'summary' | ExerciseCategoryId;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const perDay = (minutes: number) => `${Math.round(minutes)} min/day`;

/** The Exercise card: the selected tab (summary tiles or one category's bars) and the data table, for one range. */
export function renderExerciseBreakdown(user: UserData, startDay: number, endDay: number, tab: ExerciseTab): void {
  const exercises = user.exercises ?? [];
  const summary = exerciseSummary(exercises, startDay, endDay);

  dom.exerciseTabs.forEach((b) => {
    const selected = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
    if (selected) dom.exercisePanel.setAttribute('aria-labelledby', b.id);
  });
  dom.exerciseSummary.hidden = tab !== 'summary';
  dom.exerciseChart.hidden = tab === 'summary';

  if (tab === 'summary') {
    dom.exerciseCaption.textContent = `All exercise: ${formatMinutes(summary.minutes)} · ${plural(summary.sessions, 'session')} over ${plural(summary.days, 'day')}`;
    dom.exerciseSummary.replaceChildren(
      ...summary.categories.map((c) => {
        const tile = document.createElement('div');
        tile.className = `exercise-tile ex-${c.id}`;
        const name = document.createElement('span');
        name.className = 'exercise-tile-name';
        name.append(document.createElement('i'), c.label);
        const total = document.createElement('strong');
        total.className = 'exercise-tile-total';
        total.textContent = formatMinutes(c.minutes);
        const detail = document.createElement('span');
        detail.className = 'muted small';
        detail.textContent = `${plural(c.sessions, 'session')} · ${perDay(c.avgPerDay)}`;
        tile.append(name, total, detail);
        return tile;
      }),
    );
  } else {
    const c = summary.categories.find((x) => x.id === tab)!;
    dom.exerciseCaption.textContent = `${c.label}: ${plural(c.sessions, 'session')} · ${formatMinutes(c.minutes)} · ${perDay(c.avgPerDay)} avg`;
    renderBarChart(
      dom.exerciseChart,
      dailyMinutes(exercises, tab, startDay, endDay),
      `ex-${tab}`,
      `No ${c.label.toLowerCase()} logged in this range.`,
    );
  }

  // The sessions behind the selected tab (all categories on Summary), newest first, for "Show data table".
  const allRows = exercisesIn(exercises, startDay, endDay)
    .filter((e) => tab === 'summary' || e.category === tab)
    .sort((a, b) => b.timestamp - a.timestamp);
  const rows = allRows.slice(0, TABLE_ROW_LIMIT);
  dom.exerciseTableSummary.textContent = tableSummary(rows.length, allRows.length);
  dom.exerciseTableBody.replaceChildren(
    ...rows.map((e) => {
      const tr = document.createElement('tr');
      const date = document.createElement('td');
      date.textContent = dateFormat.format(e.timestamp);
      const name = document.createElement('td');
      name.textContent = e.name;
      const category = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = `food-tag ex-${e.category}`;
      tag.append(document.createElement('i'), exerciseCategoryLabel(e.category));
      category.append(tag);
      const minutes = document.createElement('td');
      minutes.className = 'num';
      minutes.textContent = String(e.minutes);
      tr.append(date, name, category, minutes);
      return tr;
    }),
  );
}

export const EXERCISE_TABS: ExerciseTab[] = ['summary', ...EXERCISE_CATEGORIES.map((c) => c.id)];
