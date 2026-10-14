import './style.css';
import {
  createAccount,
  currentSession,
  endSession,
  findAccount,
  PASSWORD_MIN,
  saveAccount,
  startSession,
  usernameProblem,
  verifyPassword,
} from './accounts';
import { createProfile, loadUser, requestPersistentStorage, saveUser, loadUserFromFiles, setSyncErrorHandler } from './storage';
import { mergeNew, parseExerciseCsv, parseFoodCsv, parseWeightCsv, toExerciseCsv, toFoodCsv, toWeightCsv } from './csv';
import {
  chooseFolder,
  closeAccount,
  localService,
  onUserdataStatusChange,
  openAccount,
  pickAccountFolder,
  readAccountText,
  signOutDrive,
  useGoogleDrive,
  reconnectFolder,
  userdataPath,
  userdataStatus,
  writeAccountText,
} from './userdata-api';
import { profileSlug } from './names';
import { type AccountRecord, accountCsv, parseAccountCsv } from './profile-files';
import type { UserData } from './types';
import { dayKey, startOfDay } from './stats';
import { overrideDay } from './edits';
import { initThemePicker } from './theme';
import { makeEntry } from './units';
import {
  confirmChange,
  dom,
  formatEntry,
  renderChart,
  renderAccount,
  renderFolder,
  renderGate,
  renderLogin,
  renderOverride,
  renderExerciseBreakdown,
  renderFoodBreakdown,
  renderSignupFolder,
  renderUser,
  showFormError,
  showToast,
  type LoginMode,
  EXERCISE_TABS,
  type ExerciseTab,
} from './ui';
import { categoryFromText, categoryLabel } from './food';
import { exerciseCategoryFromText, validMinutes } from './exercise';

/** The logged-in account and its profile; both null on the login page. */
let account: AccountRecord | null = null;
let current: UserData | null = null;
/** The folder picked in the Create account form, before the account exists. */
let signupFolder: FileSystemDirectoryHandle | null = null;

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
  renderAccount(current?.name ?? null);
  renderUser(current, Date.now());
  renderFolder(userdataStatus(), userdataPath(), current);
  renderSignupFolder(userdataStatus(), userdataPath(), signupFolder?.name ?? null);
  // Saving to a folder is required: without one, show what to do instead of the app (Log out stays).
  if (renderGate(userdataStatus(), userdataPath(), current !== null)) {
    dom.login.hidden = true;
    dom.tracker.hidden = true;
  }
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
  render();
}

/** Reloads the open profile from the data folder, keeping the chosen date ranges. */
async function reloadCurrent(): Promise<void> {
  if (current) current = await loadUserFromFiles(current);
  render();
}

// --- Login: username + password, checked on this device (see accounts.ts). Each account has its own data folder.

const WRONG_LOGIN = 'Wrong username or password';

const parseAccount = (text: string | null, slug: string) => (text ? parseAccountCsv(text, slug) : null);

function readLoginForm(form: HTMLFormElement): { name: string; password: string; confirm: string } {
  const data = new FormData(form);
  return {
    name: String(data.get('username') ?? '').trim(),
    password: String(data.get('password') ?? ''),
    confirm: String(data.get('confirm') ?? ''),
  };
}

/**
 * Opens a logged-in account: its folder (`handle` if one was just picked, else the one remembered), then
 * its profile, loaded from that folder or created there. Returns true if the profile already had data.
 */
async function enter(found: AccountRecord, handle: FileSystemDirectoryHandle | null, ask: boolean): Promise<boolean> {
  await openAccount(found.slug, handle, ask);
  account = found;
  startSession(found.slug);
  const { user, existed } = await createProfile(found.name, 'kg');
  await selectProfile(user.userId);
  return existed;
}

async function logIn(form: HTMLFormElement): Promise<void> {
  const { name, password } = readLoginForm(form);
  const slug = profileSlug(name);
  // Running locally, userdata/ always holds the account; on a hosted site, this browser remembers it.
  const local = await localService();
  let found = local ? parseAccount(await readAccountText(slug), slug) : await findAccount(slug);
  let handle: FileSystemDirectoryHandle | null = null;
  if (!found && !local) {
    // First login in this browser: the account file is in the account's data folder.
    const ok = await confirmChange({
      title: 'Choose your data folder',
      message: `This browser hasn't been used to log in as "${name}" yet. Choose the folder where your data is saved, and your password is checked against the account file in it.`,
      confirmLabel: 'Choose folder…',
    });
    if (!ok) return;
    handle = await pickAccountFolder();
    if (!handle) return;
    found = parseAccount(await readAccountText(slug, handle), slug);
  }
  if (!found || !(await verifyPassword(found, password))) {
    showFormError(form, WRONG_LOGIN);
    return;
  }
  await saveAccount(found);
  form.reset();
  await enter(found, handle, true);
  showToast(`Welcome back, ${found.name}`);
}

async function signUp(form: HTMLFormElement): Promise<void> {
  const { name, password, confirm } = readLoginForm(form);
  const problem =
    usernameProblem(name) ??
    (password.length < PASSWORD_MIN ? `Use at least ${PASSWORD_MIN} characters for the password`
    : password !== confirm ? "The passwords don't match"
    : null);
  if (problem) {
    showFormError(form, problem);
    return;
  }
  const slug = profileSlug(name);
  const local = await localService();
  if (!local && !signupFolder) {
    showFormError(form, 'Choose a folder to save your data in');
    dom.signupFolderBtn.focus();
    return;
  }
  const taken = (!local && (await findAccount(slug))) || (await readAccountText(slug, signupFolder));
  if (taken) {
    showFormError(form, `"${name}" already has an account. Log in instead.`);
    return;
  }
  const created = await createAccount(name, password);
  await writeAccountText(slug, accountCsv(created), signupFolder);
  await saveAccount(created);
  const handle = signupFolder;
  signupFolder = null;
  form.reset();
  const existed = await enter(created, handle, true);
  showToast(existed ? `Account created. Loaded ${created.name}'s saved data` : `Welcome, ${created.name}`);
}

/** Runs a login form's action with its button disabled, showing any failure under the form. */
async function submitLogin(form: HTMLFormElement, action: (form: HTMLFormElement) => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  if (button.disabled) return;
  button.disabled = true;
  showFormError(form, null);
  try {
    await action(form);
  } catch (err) {
    console.error(err);
    showFormError(form, err instanceof Error ? err.message : 'Something went wrong. Try again.');
  } finally {
    button.disabled = false;
  }
}

dom.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitLogin(dom.loginForm, logIn);
});
dom.signupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitLogin(dom.signupForm, signUp);
});

dom.signupFolderBtn.addEventListener('click', async () => {
  try {
    signupFolder = (await pickAccountFolder()) ?? signupFolder;
    showFormError(dom.signupForm, null);
    render();
  } catch (err) {
    console.error(err);
    showToast("Couldn't open that folder");
  }
});

function selectLoginMode(mode: LoginMode, focus = false): void {
  renderLogin(mode, focus);
  showFormError(dom.loginForm, null);
  showFormError(dom.signupForm, null);
}

for (const tab of dom.loginTabs) tab.addEventListener('click', () => selectLoginMode(tab.dataset.mode as LoginMode));
// Left/right arrows switch tabs, as in a standard tab list.
dom.loginTabs[0].parentElement!.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  selectLoginMode(dom.signupForm.hidden ? 'signup' : 'login', true);
});

dom.logoutBtn.addEventListener('click', () => {
  endSession();
  account = null;
  current = null;
  closeAccount();
  selectLoginMode('login');
  render();
  dom.loginForm.querySelector('input')?.focus();
});

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

type ImportKind = 'weight' | 'food' | 'exercise';
const IMPORT_NOUN: Record<ImportKind, [string, string]> = {
  weight: ['weigh-in', 'weigh-ins'],
  food: ['food entry', 'food entries'],
  exercise: ['exercise session', 'exercise sessions'],
};

/**
 * Rows from an exported CSV, added to the selected profile after a confirmation. Rows already logged
 * (same time; for food and exercise also the same text) are skipped, so importing twice adds nothing.
 */
async function importCsv(kind: ImportKind, text: string, fileName: string): Promise<void> {
  if (!current) {
    showToast('Create or select a profile first, then import the CSV');
    return;
  }
  const user = current;
  let total: number;
  let skipped: number[] = [];
  let add: () => void;
  let count: number;
  if (kind === 'weight') {
    const parsed = parseWeightCsv(text, user.unit);
    skipped = parsed.skipped;
    total = parsed.entries.length;
    const fresh = mergeNew(user.entries, parsed.entries, (e) => String(e.timestamp));
    count = fresh.length;
    add = () => user.entries.push(...fresh.map((e) => ({ id: crypto.randomUUID(), ...e })));
  } else if (kind === 'food') {
    const rows = parseFoodCsv(text);
    total = rows.length;
    const fresh = mergeNew(user.foods ?? [], rows, (f) => `${f.timestamp}|${f.text}`);
    count = fresh.length;
    add = () => (user.foods = [...(user.foods ?? []), ...fresh.map((f) => ({ id: crypto.randomUUID(), ...f }))]);
  } else {
    const rows = parseExerciseCsv(text);
    total = rows.length;
    const fresh = mergeNew(user.exercises ?? [], rows, (x) => `${x.timestamp}|${x.name}`);
    count = fresh.length;
    add = () => (user.exercises = [...(user.exercises ?? []), ...fresh.map((x) => ({ id: crypto.randomUUID(), ...x }))]);
  }

  const [one, many] = IMPORT_NOUN[kind];
  const noun = (n: number) => `${n} ${n === 1 ? one : many}`;
  const notes = [
    total > count ? `${total - count} already logged` : '',
    skipped.length ? `${skipped.length} unreadable (line ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', …' : ''})` : '',
  ].filter(Boolean);
  if (count === 0) {
    showToast(`Nothing new to add from ${fileName}${notes.length ? ` (${notes.join('; ')})` : ''}`);
    return;
  }
  const question = `Add ${noun(count)} from ${fileName} to "${user.name}"?`;
  if (!confirm(notes.length ? `${question}\n\nSkipping: ${notes.join('; ')}.` : question)) return;
  add();
  await saveUser(user);
  render();
  showToast(`Added ${noun(count)} to "${user.name}"`);
}

let importKind: ImportKind = 'weight';
for (const button of [dom.importBtn, dom.importFoodBtn, dom.importExerciseBtn]) {
  button.addEventListener('click', () => {
    importKind = button.dataset.import as ImportKind;
    dom.importFile.click();
  });
}
dom.importFile.addEventListener('change', async () => {
  const file = dom.importFile.files?.[0];
  dom.importFile.value = '';
  if (!file) return;
  try {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      showToast('Choose a .csv file');
      return;
    }
    await importCsv(importKind, await file.text(), file.name);
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Import failed');
  }
});

// --- Data folder: on a hosted site, Chrome/Edge can save the CSV files to a folder the user picks.

async function useFolder(name: string | null): Promise<void> {
  if (!name) return;
  if (userdataStatus() !== 'folder') {
    showToast(`The browser didn't allow access to "${name}"`);
    return;
  }
  await loadFromStore(`Saving to folder "${name}"`);
}

/**
 * After choosing or reconnecting the account's folder: its files for this profile load (they win over this
 * browser's copy), or the profile is written to it. A folder without the account file gets one.
 */
async function loadFromStore(message: string): Promise<void> {
  if (account && !(await readAccountText(account.slug))) await writeAccountText(account.slug, accountCsv(account));
  await reloadCurrent();
  showToast(message);
}

/** Signs in to Google (from a click) and saves to the "Weight Tracker" folder in that Drive. */
async function useDrive(): Promise<void> {
  try {
    const email = await useGoogleDrive();
    await loadFromStore(`Saving to Google Drive${email ? ` (${email})` : ''}`);
  } catch (err) {
    console.error(err);
    showToast(err instanceof Error ? err.message : "Couldn't connect to Google Drive");
  }
}

/** Switches to Google Drive; with profiles already here, first explains what happens to them. */
async function pickDrive(): Promise<void> {
  if (userdataStatus() === 'drive-signin' || !current) return useDrive();
  const ok = await confirmChange({
    title: 'Save to Google Drive?',
    message: 'Sign in with Google. Your profiles will be saved as CSV files in a "Weight Tracker" folder in your Drive after every change.',
    lines: [
      'If that folder already has files for a profile with the same name, those files are loaded and replace this browser\'s copy.',
      'Profiles that are only in this browser are written to Drive.',
      'The app can only see files it created, not the rest of your Drive.',
    ],
    confirmLabel: 'Continue to Google…',
  });
  if (ok) await useDrive();
}

/** Picks a new data folder for the logged-in account, after explaining what happens to the data. */
async function pickDataFolder(): Promise<void> {
  if (!current) return;
  const ok = await confirmChange({
    title: 'Save to a different folder?',
    message: `Pick a folder on this computer. ${current.name}'s data will be saved there as CSV files after every change.`,
    lines: [
      `If the folder already has files for ${current.name}, those files are loaded and replace this browser's copy.`,
      'Otherwise your data is written to it, along with your login.',
    ],
    confirmLabel: 'Choose folder…',
  });
  if (ok) await useChosenFolder();
}

async function useChosenFolder(): Promise<void> {
  try {
    await useFolder(await chooseFolder());
  } catch (err) {
    console.error(err);
    showToast("Couldn't open that folder");
  }
}

async function reconnect(): Promise<void> {
  if (await reconnectFolder()) await useFolder(userdataPath());
  else showToast("The browser didn't allow access to the folder");
}

/** The folder button in the create-profile forms and on the gate: choose, change or reconnect, by status. */
function folderAction(): void {
  void (userdataStatus() === 'folder-permission' ? reconnect() : pickDataFolder());
}

dom.chooseFolderBtn.addEventListener('click', () => void pickDataFolder());
dom.changeFolderBtn.addEventListener('click', () => void pickDataFolder());
dom.reconnectFolderBtn.addEventListener('click', () => void reconnect());
dom.folderGateBtn.addEventListener('click', folderAction);
dom.driveGateBtn.addEventListener('click', () => void pickDrive());
dom.useDriveBtn.addEventListener('click', () => void pickDrive());
dom.signOutDriveBtn.addEventListener('click', async () => {
  await signOutDrive();
  showToast('Signed out of Google Drive. Your files are still in Drive.');
});

setSyncErrorHandler((err) => {
  console.error(err);
  showToast("Saved here, but couldn't write the CSV files in the data folder");
});

onUserdataStatusChange(render);

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
// With Google Drive, also reload the profile: it may have been changed from another device.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (userdataStatus() === 'drive' && current) void reloadCurrent();
  else render();
});

initThemePicker(document.getElementById('theme-picker')!);
void requestPersistentStorage();
/** Reopens the account logged in on this tab (e.g. after a reload); otherwise shows the login page. */
async function start(): Promise<void> {
  await localService();
  const slug = currentSession();
  const saved = slug ? await findAccount(slug) : undefined;
  if (saved) await enter(saved, null, false);
  else render();
}

void start();
