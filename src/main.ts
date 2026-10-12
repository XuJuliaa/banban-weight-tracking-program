import './style.css';
import {
  createProfile,
  listProfiles,
  loadUser,
  requestPersistentStorage,
  saveUser,
  loadUserFromFiles,
  syncProfileListFromFiles,
  setSyncErrorHandler,
} from './storage';
import { parseWeightCsv, toExerciseCsv, toFoodCsv, toWeightCsv } from './csv';
import { onUserdataStatusChange, userdataPath, userdataStatus } from './userdata-api';
import type { ProfileSummary, UserData, WeightUnit } from './types';
import { dayKey, startOfDay } from './stats';
import { overrideDay } from './edits';
import { initThemePicker } from './theme';
import { makeEntry } from './units';
import {
  confirmChange,
  dom,
  formatEntry,
  renderChart,
  renderFolder,
  renderOverride,
  renderExerciseBreakdown,
  renderFoodBreakdown,
  renderProfiles,
  renderUser,
  showToast,
  EXERCISE_TABS,
  type ExerciseTab,
} from './ui';
import { categoryFromText, categoryLabel } from './food';
import { exerciseCategoryFromText, validMinutes } from './exercise';

const LAST_PROFILE_KEY = 'lastProfileId';

let profiles: ProfileSummary[] = [];
let current: UserData | null = null;

function rememberProfile(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(LAST_PROFILE_KEY, userId);
    else localStorage.removeItem(LAST_PROFILE_KEY);
  } catch {
    // Storage can be unavailable (e.g. private mode); this is only a convenience.
  }
}

function recalledProfile(): string | null {
  try {
    return localStorage.getItem(LAST_PROFILE_KEY);
  } catch {
    return null;
  }
}

/** Reads a date input ("YYYY-MM-DD") as local midnight. */
function readDateInput(input: HTMLInputElement): number | null {
  const [y, m, d] = input.value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : null;
}

function daysAgo(days: number): number {
  const d = new Date(startOfDay(Date.now()));
  d.setDate(d.getDate() - days);
  return d.getTime();
}

function firstEntryDay(): number {
  const first = Math.min(...(current?.entries.map((e) => e.timestamp) ?? []));
  return Number.isFinite(first) ? startOfDay(first) : startOfDay(Date.now());
}

function setRange(start: number, end: number): void {
  dom.rangeStart.value = dayKey(start);
  dom.rangeEnd.value = dayKey(end);
}

/** "30" / "90" sets the last N days ending today; "all" starts at the first entry. */
function applyPreset(preset: string): void {
  const start = preset === 'all' ? firstEntryDay() : daysAgo(Number(preset) - 1);
  setRange(start, Date.now());
  drawChart();
}

function drawChart(): void {
  if (!current) return;
  const start = readDateInput(dom.rangeStart);
  const end = readDateInput(dom.rangeEnd);
  if (start === null || end === null) {
    showToast('Choose a start and end date');
    return;
  }
  if (start > end) {
    showToast('The start date must be on or before the end date');
    return;
  }
  renderChart(current, start, end);
}

function render(): void {
  renderProfiles(profiles, current?.userId ?? null);
  renderUser(current, Date.now());
  renderFolder(userdataStatus(), userdataPath(), current);
  if (current) renderOverride(current, readDateInput(dom.overrideDate));
  drawChart();
  drawFoodBreakdown();
  drawExercise();
}

async function selectProfile(userId: string | null): Promise<void> {
  current = userId ? ((await loadUser(userId)) ?? null) : null;
  // When running locally, the userdata/ files hold the latest data for this name.
  if (current) current = await loadUserFromFiles(current);
  // The weight chart and the food pie both open on the last 30 days.
  setRange(daysAgo(29), Date.now());
  setFoodRange(daysAgo(29), Date.now());
  // The exercise card opens on the past week.
  setExerciseRange(daysAgo(6), Date.now());
  dom.overrideDate.value = dayKey(Date.now());
  rememberProfile(current?.userId ?? null);
  render();
}

async function refreshProfiles(selectId?: string | null): Promise<void> {
  profiles = await listProfiles();
  const wanted = selectId ?? current?.userId ?? recalledProfile();
  const found = profiles.find((p) => p.userId === wanted) ?? profiles[0];
  await selectProfile(found?.userId ?? null);
}

function readProfileForm(form: HTMLFormElement): { name: string; unit: WeightUnit } | null {
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  const unit = data.get('unit') === 'lb' ? 'lb' : 'kg';
  return name ? { name, unit } : null;
}

async function addProfile(form: HTMLFormElement): Promise<void> {
  const values = readProfileForm(form);
  if (!values) return;
  const { user, existed } = await createProfile(values.name, values.unit);
  form.reset();
  await refreshProfiles(user.userId);
  showToast(existed ? `"${user.name}" already exists — opened it` : `Profile "${user.name}" created`);
}

dom.onboardingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void addProfile(dom.onboardingForm);
});

dom.newProfileBtn.addEventListener('click', () => dom.newProfileDialog.showModal());
dom.newProfileCancel.addEventListener('click', () => dom.newProfileDialog.close());
dom.newProfileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  dom.newProfileDialog.close();
  void addProfile(dom.newProfileForm);
});

dom.profileSelect.addEventListener('change', () => void selectProfile(dom.profileSelect.value));

dom.entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!current) return;
  const weight = dom.weightInput.valueAsNumber;
  if (!Number.isFinite(weight) || weight <= 0) {
    showToast('Enter a weight greater than 0');
    return;
  }
  // Saved in both units; the one typed (the selected unit) is kept exactly.
  current.entries.push(makeEntry(crypto.randomUUID(), Date.now(), weight, current.unit));
  await saveUser(current);
  dom.entryForm.reset();
  render();
  showToast('Weight logged');
});

async function logFood(): Promise<void> {
  if (!current) return;
  const text = dom.foodInput.value.trim();
  const category = categoryFromText(dom.foodCategory.value);
  if (!text) {
    showToast('Type what you ate first');
    return;
  }
  if (!category) {
    showToast('Choose a category');
    return;
  }
  current.foods = [...(current.foods ?? []), { id: crypto.randomUUID(), timestamp: Date.now(), text, category }];
  await saveUser(current);
  // Keep the category selected for the next entry; only clear the text.
  dom.foodInput.value = '';
  dom.foodInput.focus();
  render();
  showToast('Food logged');
}

dom.foodForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void logFood();
});

// --- Food breakdown pie: its own date range, separate from the weight chart's.

function setFoodRange(start: number, end: number): void {
  dom.foodRangeStart.value = dayKey(start);
  dom.foodRangeEnd.value = dayKey(end);
}

function firstFoodDay(): number {
  const first = Math.min(...(current?.foods ?? []).map((f) => f.timestamp));
  return Number.isFinite(first) ? startOfDay(first) : startOfDay(Date.now());
}

function drawFoodBreakdown(): void {
  if (!current) return;
  const start = readDateInput(dom.foodRangeStart);
  const end = readDateInput(dom.foodRangeEnd);
  if (start === null || end === null) return;
  if (start > end) {
    showToast('The start date must be on or before the end date');
    return;
  }
  renderFoodBreakdown(current, start, end);
}

dom.foodRangeStart.addEventListener('change', drawFoodBreakdown);
dom.foodRangeEnd.addEventListener('change', drawFoodBreakdown);
dom.foodVizCard.addEventListener('click', (event) => {
  const preset = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-food-range]')?.dataset.foodRange;
  if (!preset) return;
  setFoodRange(preset === 'all' ? firstFoodDay() : daysAgo(Number(preset) - 1), Date.now());
  drawFoodBreakdown();
});

// --- Exercise log and the Exercise card (Summary + one bar chart per category), with its own date range.

async function logExercise(): Promise<void> {
  if (!current) return;
  const name = dom.exerciseName.value.trim();
  const category = exerciseCategoryFromText(dom.exerciseCategory.value);
  const minutes = dom.exerciseMinutes.valueAsNumber;
  if (!name) {
    showToast('Type what you did first');
    return;
  }
  if (!category) {
    showToast('Choose a category');
    return;
  }
  if (!validMinutes(minutes)) {
    showToast('Enter a duration between 1 and 1440 minutes');
    return;
  }
  current.exercises = [...(current.exercises ?? []), { id: crypto.randomUUID(), timestamp: Date.now(), name, category, minutes }];
  await saveUser(current);
  // Keep the category selected for the next entry; clear the name and duration.
  dom.exerciseName.value = '';
  dom.exerciseMinutes.value = '';
  dom.exerciseName.focus();
  render();
  showToast('Exercise logged');
}

dom.exerciseForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void logExercise();
});

const EXERCISE_TAB_KEY = 'exerciseTab';

function recalledExerciseTab(): ExerciseTab {
  try {
    const saved = localStorage.getItem(EXERCISE_TAB_KEY) as ExerciseTab | null;
    return saved && EXERCISE_TABS.includes(saved) ? saved : 'summary';
  } catch {
    return 'summary';
  }
}

let exerciseTab: ExerciseTab = recalledExerciseTab();

function setExerciseRange(start: number, end: number): void {
  dom.exerciseRangeStart.value = dayKey(start);
  dom.exerciseRangeEnd.value = dayKey(end);
}

function firstExerciseDay(): number {
  const first = Math.min(...(current?.exercises ?? []).map((e) => e.timestamp));
  return Number.isFinite(first) ? startOfDay(first) : startOfDay(Date.now());
}

function drawExercise(): void {
  if (!current) return;
  const start = readDateInput(dom.exerciseRangeStart);
  const end = readDateInput(dom.exerciseRangeEnd);
  if (start === null || end === null) return;
  if (start > end) {
    showToast('The start date must be on or before the end date');
    return;
  }
  renderExerciseBreakdown(current, start, end, exerciseTab);
}

function selectExerciseTab(tab: ExerciseTab, focus = false): void {
  exerciseTab = tab;
  try {
    localStorage.setItem(EXERCISE_TAB_KEY, tab);
  } catch {
    // Not remembered in private windows; the tab still switches.
  }
  drawExercise();
  if (focus) dom.exerciseTabs.find((b) => b.dataset.tab === tab)?.focus();
}

dom.exerciseRangeStart.addEventListener('change', drawExercise);
dom.exerciseRangeEnd.addEventListener('change', drawExercise);
dom.exerciseCard.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const tab = target.closest<HTMLButtonElement>('[role="tab"]')?.dataset.tab as ExerciseTab | undefined;
  if (tab) {
    selectExerciseTab(tab);
    return;
  }
  const preset = target.closest<HTMLButtonElement>('button[data-exercise-range]')?.dataset.exerciseRange;
  if (!preset) return;
  setExerciseRange(preset === 'all' ? firstExerciseDay() : daysAgo(Number(preset) - 1), Date.now());
  drawExercise();
});
// Arrow keys move between tabs (Home/End jump to the ends), as in a standard tab list.
document.getElementById('exercise-tabs')!.addEventListener('keydown', (event) => {
  const index = EXERCISE_TABS.indexOf(exerciseTab);
  const next =
    event.key === 'ArrowRight' ? (index + 1) % EXERCISE_TABS.length
    : event.key === 'ArrowLeft' ? (index - 1 + EXERCISE_TABS.length) % EXERCISE_TABS.length
    : event.key === 'Home' ? 0
    : event.key === 'End' ? EXERCISE_TABS.length - 1
    : null;
  if (next === null) return;
  event.preventDefault();
  selectExerciseTab(EXERCISE_TABS[next], true);
});

const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// Category dropdowns in the food data table. Adding a category to an uncategorized entry saves right
// away; changing an existing category asks first. Either way the save rewrites userdata/<name>-food.csv.
dom.foodTableBody.addEventListener('change', async (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('select.food-category-select');
  const food = current?.foods?.find((f) => f.id === select?.dataset.foodId);
  const next = categoryFromText(select?.value);
  if (!current || !select || !food || !next || next === food.category) return;

  if (food.category) {
    const ok = await confirmChange({
      title: 'Change this category?',
      message: `"${food.text}" on ${longDay.format(food.timestamp)}:`,
      lines: [`From: ${categoryLabel(food.category)}`, `To: ${categoryLabel(next)}`],
      confirmLabel: 'Change category',
    });
    if (!ok || !current) {
      select.value = food.category;
      return;
    }
  }
  const previous = food.category;
  current.foods = (current.foods ?? []).map((f) => (f.id === food.id ? { ...f, category: next } : f));
  await saveUser(current);
  render();
  showToast(previous ? `Changed to ${categoryLabel(next)}` : `Added ${categoryLabel(next)}`);
});

// --- Correct a weight: replace one date's weight, always after a confirmation pop-up.

dom.overrideDate.addEventListener('change', () => current && renderOverride(current, readDateInput(dom.overrideDate)));

dom.overrideForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!current) return;
  const day = readDateInput(dom.overrideDate);
  const weight = dom.overrideWeight.valueAsNumber;
  if (day === null || day > Date.now()) {
    showToast('Choose a date up to today');
    return;
  }
  if (!Number.isFinite(weight) || weight <= 0) {
    showToast('Enter a weight greater than 0');
    return;
  }
  const result = overrideDay(current.entries, day, weight, current.unit, Date.now(), crypto.randomUUID());
  const unit = current.unit;
  const ok = await confirmChange(
    result.replaced.length
      ? {
          title: 'Overwrite this weight?',
          message: `${longDay.format(day)} currently has:`,
          lines: result.replaced.map((e) => formatEntry(e[unit], e.timestamp, unit)),
          warning: `${result.replaced.length > 1 ? 'These entries' : 'This entry'} will be replaced by ${formatEntry(weight, result.entry.timestamp, unit)}. This can't be undone from the app.`,
          confirmLabel: 'Overwrite',
        }
      : {
          title: 'Add this weight?',
          message: `Nothing is logged on ${longDay.format(day)}. This will add ${formatEntry(weight, result.entry.timestamp, unit)}.`,
          confirmLabel: 'Add entry',
        },
  );
  if (!ok || !current) return;
  current.entries = result.entries;
  await saveUser(current);
  dom.overrideWeight.value = '';
  render();
  showToast(result.replaced.length ? 'Weight overwritten' : 'Weight added');
});

// kg | lb switch: only changes which stored column the page reads, so no data is converted or lost.
dom.unitToggle.addEventListener('click', async (event) => {
  const unit = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-unit]')?.dataset.unit;
  if (!current || (unit !== 'kg' && unit !== 'lb') || unit === current.unit) return;
  current.unit = unit;
  render();
  // Remember the choice for this profile (profiles.csv keeps it for other browsers too).
  await saveUser(current);
});

/** Saves `csv` as e.g. "weight-Juju-2026-10-12.csv", "food-…" or "exercise-…". */
function downloadCsv(csv: string, kind: 'weight' | 'food' | 'exercise'): void {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${kind}-${current.name.replace(/[^\w-]+/g, '_')}-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

dom.exportCsvBtn.addEventListener('click', () => current && downloadCsv(toWeightCsv(current), 'weight'));
dom.exportFoodCsvBtn.addEventListener('click', () => current && downloadCsv(toFoodCsv(current), 'food'));
dom.exportExerciseCsvBtn.addEventListener('click', () => current && downloadCsv(toExerciseCsv(current), 'exercise'));

/** Entries from a CSV, added to the selected profile. Rows already logged at the same time are skipped. */
async function importCsv(text: string, fileName: string): Promise<void> {
  if (!current) {
    showToast('Create or select a profile first, then import the CSV');
    return;
  }
  const { entries, skipped } = parseWeightCsv(text, current.unit);
  const seen = new Set(current.entries.map((e) => e.timestamp));
  const fresh = entries.filter((e) => !seen.has(e.timestamp) && seen.add(e.timestamp));
  const notes = [
    entries.length > fresh.length ? `${entries.length - fresh.length} already logged` : '',
    skipped.length ? `${skipped.length} unreadable (line ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', …' : ''})` : '',
  ].filter(Boolean);
  if (fresh.length === 0) {
    showToast(`Nothing new to add from ${fileName}${notes.length ? ` (${notes.join('; ')})` : ''}`);
    return;
  }
  const question = `Add ${fresh.length} entries from ${fileName} to "${current.name}"?`;
  if (!confirm(notes.length ? `${question}\n\nSkipping: ${notes.join('; ')}.` : question)) return;
  current.entries.push(...fresh.map((e) => ({ id: crypto.randomUUID(), ...e })));
  await saveUser(current);
  render();
  showToast(`Added ${fresh.length} entries to "${current.name}"`);
}

dom.importBtn.addEventListener('click', () => dom.importFile.click());
dom.importFile.addEventListener('change', async () => {
  const file = dom.importFile.files?.[0];
  dom.importFile.value = '';
  if (!file) return;
  try {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      showToast('Choose a .csv file');
      return;
    }
    await importCsv(await file.text(), file.name);
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Import failed');
  }
});

setSyncErrorHandler((err) => {
  console.error(err);
  showToast("Saved here, but couldn't write the userdata/ CSV files");
});

onUserdataStatusChange(() => renderFolder(userdataStatus(), userdataPath(), current));

dom.rangeStart.addEventListener('change', drawChart);
dom.rangeEnd.addEventListener('change', drawChart);
dom.chartsCard.addEventListener('click', (event) => {
  const chip = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-range-days]');
  if (chip?.dataset.rangeDays) applyPreset(chip.dataset.rangeDays);
});

// Redraw at the new width when the layout changes size.
let lastChartWidth = 0;
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (width !== lastChartWidth) {
    lastChartWidth = width;
    drawChart();
  }
}).observe(dom.chartsCard);
let lastExerciseWidth = 0;
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (width !== lastExerciseWidth) {
    lastExerciseWidth = width;
    drawExercise();
  }
}).observe(dom.exerciseCard);

// Recompute stats when the app comes back into view, since the windows depend on today's date.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});

initThemePicker(document.getElementById('theme-picker')!);
void requestPersistentStorage();
// Pick up profiles that exist in userdata/ (e.g. created in another browser) before showing the list.
void syncProfileListFromFiles().then(() => refreshProfiles());
