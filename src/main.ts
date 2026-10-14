import './style.css';
import { currentSession, endSession, googleProfileName, startSession, usernameProblem, weightMatches } from './accounts';
import {
  createProfile,
  findProfileByName,
  listProfiles,
  loadUser,
  openGoogleProfile,
  requestPersistentStorage,
  saveUser,
  loadUserFromFiles,
  setSyncErrorHandler,
} from './storage';
import { toExerciseCsv, toFoodCsv, toWeightCsv } from './csv';
import { type DataKind, planImport, unzipCsvs, zipFiles } from './backup';
import {
  chooseFolder,
  closeAccount,
  localService,
  onUserdataStatusChange,
  openAccount,
  pickAccountFolder,
  fetchProfileList,
  findProfileData,
  googleLogin,
  reconnectGoogle,
  resumeGoogle,
  signInWithGoogle,
  signOutDrive,
  useGoogleDrive,
  reconnectFolder,
  userdataPath,
  userdataStatus,
} from './userdata-api';
import { profileSlug } from './names';
import { folderSupported } from './folder-store';
import { driveConfigured, preloadGoogle } from './drive-store';
import type { UserData, WeightEntry, WeightUnit } from './types';
import { dayKey, startOfDay } from './stats';
import { overrideDay } from './edits';
import { initThemePicker } from './theme';
import { makeEntry } from './units';
import {
  chooseExport,
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

/** The logged-in profile; null on the login page. */
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
  // When running locally, the testdata/ files hold the latest data for this name.
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

// --- Login by username and a weight from the profile's logged range. Each profile remembers its own data folder.

/** The username typed in Log in that has no profile yet, while "Create account" / "Find it" are offered. */
let missingName: string | null = null;

const usernameIn = (form: HTMLFormElement) => String(new FormData(form).get('username') ?? '').trim();

/**
 * The weigh-ins of the profile with this name, or null if there isn't one: from testdata/ when running
 * locally; on a hosted site, from this browser's copy (the browser also remembers the profile's folder).
 */
async function knownEntries(name: string, local: boolean): Promise<WeightEntry[] | null> {
  if (local) return (await findProfileData(name))?.entries ?? null;
  const summary = await findProfileByName(name);
  return summary ? ((await loadUser(summary.userId))?.entries ?? []) : null;
}

const LOGIN_UNIT_KEY = 'loginUnit';

function recalledLoginUnit(): WeightUnit {
  try {
    return localStorage.getItem(LOGIN_UNIT_KEY) === 'lb' ? 'lb' : 'kg';
  } catch {
    return 'kg';
  }
}

/** The unit the login weight is typed in; remembered in this browser. */
let loginUnit: WeightUnit = recalledLoginUnit();

function setLoginUnit(unit: WeightUnit): void {
  loginUnit = unit;
  for (const btn of dom.loginUnitButtons) btn.setAttribute('aria-pressed', String(btn.dataset.unit === unit));
  try {
    localStorage.setItem(LOGIN_UNIT_KEY, unit);
  } catch {
    // Not remembered in private windows; the toggle still works.
  }
}

/** The login weight must be in the profile's login range (see loginRange in accounts.ts). Shows the error if not. */
function weightAccepted(entries: WeightEntry[]): boolean {
  const weight = dom.loginWeight.valueAsNumber;
  if (weightMatches(entries, weight, loginUnit)) return true;
  showFormError(
    dom.loginForm,
    Number.isFinite(weight)
      ? `That weight isn't in the range you've logged. Check the unit (${loginUnit}).`
      : "Enter a weight you've logged before",
  );
  dom.loginWeight.focus();
  return false;
}

/**
 * Opens a profile: its folder (`handle` if one was just picked, else the one remembered), then its data,
 * loaded from that folder or created there. Returns true if the profile already had data.
 */
async function enter(name: string, handle: FileSystemDirectoryHandle | null, ask: boolean): Promise<boolean> {
  await openAccount(profileSlug(name), handle, ask);
  const { user, existed } = await createProfile(name, 'kg');
  startSession(user.name);
  await selectProfile(user.userId);
  return existed;
}

function showMissing(name: string | null, local: boolean): void {
  missingName = name;
  dom.loginMissing.hidden = name === null;
  if (name === null) return;
  const findable = !local && folderSupported();
  dom.loginMissingText.textContent = local
    ? `There's no profile named "${name}" yet. Create an account to start one.`
    : `This browser doesn't have a profile named "${name}". Create an account for it${findable ? ', or find it in the folder where its data is saved' : ''}.`;
  dom.loginFindBtn.hidden = !findable;
}

async function logIn(form: HTMLFormElement): Promise<void> {
  const name = usernameIn(form);
  const problem = usernameProblem(name);
  if (problem) {
    showFormError(form, problem);
    return;
  }
  const local = await localService();
  const entries = await knownEntries(name, local);
  if (!entries) {
    showMissing(name, local);
    return;
  }
  if (!weightAccepted(entries)) return;
  form.reset();
  await enter(name, null, true);
  showToast(`Welcome back, ${current?.name ?? name}`);
}

async function signUp(form: HTMLFormElement): Promise<void> {
  const name = usernameIn(form);
  const problem = usernameProblem(name);
  if (problem) {
    showFormError(form, problem);
    return;
  }
  const local = await localService();
  if (!local && !signupFolder) {
    showFormError(form, 'Choose a folder to save your data in');
    dom.signupFolderBtn.focus();
    return;
  }
  if ((await knownEntries(name, local)) !== null) {
    showFormError(form, `"${name}" already exists. Log in instead.`);
    return;
  }
  const handle = signupFolder;
  signupFolder = null;
  form.reset();
  // A folder that already has this name's files opens them rather than starting over.
  const existed = await enter(name, handle, true);
  showToast(existed ? `Opened ${current?.name ?? name}'s saved data from the folder` : `Welcome, ${name}`);
}

/** Runs a login form's action with its button disabled, showing any failure under the form. */
async function submitLogin(form: HTMLFormElement, action: (form: HTMLFormElement) => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  if (button.disabled) return;
  button.disabled = true;
  showFormError(form, null);
  showMissing(null, false);
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

// "Create account" from a username that wasn't found: switch tabs with the name filled in.
dom.loginCreateBtn.addEventListener('click', () => {
  const name = missingName ?? '';
  selectLoginMode('signup');
  dom.signupForm.querySelector<HTMLInputElement>('input[name="username"]')!.value = name;
  (dom.signupFolderBtn.hidden ? dom.signupForm.querySelector<HTMLButtonElement>('button[type="submit"]')! : dom.signupFolderBtn).focus();
});

// "Find it in a folder…": a profile this browser hasn't seen, saved in a folder from another browser.
dom.loginFindBtn.addEventListener('click', async () => {
  const name = missingName;
  if (!name) return;
  try {
    const handle = await pickAccountFolder();
    if (!handle) return;
    const data = await findProfileData(name, handle);
    if (!data) {
      showFormError(dom.loginForm, `There are no files for "${name}" in "${handle.name}".`);
      return;
    }
    showMissing(null, false);
    if (!weightAccepted(data.entries)) return;
    dom.loginForm.reset();
    await enter(name, handle, true);
    showToast(`Welcome back, ${current?.name ?? name}`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't open that folder");
  }
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

// --- Continue with Google: one profile per Google account, saved in that account's Drive.

/** Username profile names (this browser's, and testdata/'s when running locally) a Google profile mustn't take. */
let takenNames = new Set<string>();

async function refreshTakenNames(): Promise<void> {
  const names = (await listProfiles()).filter((p) => !p.googleEmail).map((p) => p.name);
  if (await localService()) names.push(...((await fetchProfileList().catch(() => null)) ?? []).map((p) => p.name));
  takenNames = new Set(names.map(profileSlug));
}

async function continueWithGoogle(): Promise<void> {
  showFormError(dom.googleLogin, null);
  dom.googleLoginBtn.disabled = true;
  try {
    // signInWithGoogle opens Google's pop-up, so it runs first, straight from the click.
    const { email, displayName } = await signInWithGoogle();
    const name = googleProfileName(displayName, email, (n) => takenNames.has(profileSlug(n)));
    const { user, existed } = await openGoogleProfile(name, email);
    startSession(user.name, 'google');
    await selectProfile(user.userId);
    showToast(existed ? `Welcome back, ${user.name}` : `Welcome, ${user.name}`);
  } catch (err) {
    console.error(err);
    if (googleLogin()) closeAccount();
    showFormError(dom.googleLogin, err instanceof Error ? err.message : "Couldn't sign in with Google");
  } finally {
    dom.googleLoginBtn.disabled = false;
  }
}

/** The gate's "Sign in to Google" for a Google login: after a reload, or when the hour-long sign-in ran out. */
async function signInAgain(): Promise<void> {
  try {
    await reconnectGoogle();
    await loadFromStore('Signed in to Google');
  } catch (err) {
    console.error(err);
    showToast(err instanceof Error ? err.message : "Couldn't sign in to Google");
  }
}

dom.googleLogin.hidden = !driveConfigured();
dom.googleLoginBtn.addEventListener('click', () => void continueWithGoogle());
preloadGoogle();

function selectLoginMode(mode: LoginMode, focus = false): void {
  renderLogin(mode, focus);
  showFormError(dom.loginForm, null);
  showFormError(dom.signupForm, null);
  showMissing(null, false);
}

for (const tab of dom.loginTabs) tab.addEventListener('click', () => selectLoginMode(tab.dataset.mode as LoginMode));
// Left/right arrows switch tabs, as in a standard tab list.
dom.loginTabs[0].parentElement!.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  selectLoginMode(dom.signupForm.hidden ? 'signup' : 'login', true);
});

dom.loginUnitButtons.forEach((btn) => btn.addEventListener('click', () => setLoginUnit(btn.dataset.unit === 'lb' ? 'lb' : 'kg')));
setLoginUnit(loginUnit);

dom.logoutBtn.addEventListener('click', () => {
  endSession();
  current = null;
  closeAccount();
  void refreshTakenNames();
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
// away; changing an existing category asks first. Either way the save rewrites testdata/<name>-food.csv.
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

/** Starts a download of `blob` as `fileName`. */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Exports all three logs, as one "Juju-data-2026-10-14.zip" or as three CSVs ("weight-Juju-2026-10-14.csv",
 * "food-…", "exercise-…"). Every file is included even when empty, so the export imports back as is.
 */
dom.exportBtn.addEventListener('click', async () => {
  if (!current) return;
  const choice = await chooseExport();
  if (!choice || !current) return;
  const name = current.name.replace(/[^\w-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  const files: Record<string, string> = {
    [`weight-${name}-${date}.csv`]: toWeightCsv(current),
    [`food-${name}-${date}.csv`]: toFoodCsv(current),
    [`exercise-${name}-${date}.csv`]: toExerciseCsv(current),
  };
  if (choice === 'zip') {
    download(new Blob([zipFiles(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${name}-data-${date}.zip`);
    return;
  }
  // Browsers drop downloads started at the same instant, so space them out.
  for (const [fileName, csv] of Object.entries(files)) {
    download(new Blob([csv], { type: 'text/csv' }), fileName);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});

const IMPORT_NOUN: Record<DataKind, [string, string]> = {
  weight: ['weigh-in', 'weigh-ins'],
  food: ['food entry', 'food entries'],
  exercise: ['exercise session', 'exercise sessions'],
};
const KIND_LABEL: Record<DataKind, string> = { weight: 'Weight', food: 'Food', exercise: 'Exercise' };

/** The CSV files picked: each .csv as is, or the CSVs inside a single exported .zip. */
async function readPicked(picked: File[]): Promise<{ files: { name: string; text: string }[]; ignored: string[] }> {
  const zips = picked.filter((f) => /\.zip$/i.test(f.name) || f.type === 'application/zip');
  const csvs = picked.filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv');
  const ignored = picked.filter((f) => !zips.includes(f) && !csvs.includes(f)).map((f) => `${f.name} (not a CSV or zip file)`);
  if (zips.length && (zips.length > 1 || csvs.length)) throw new Error('Pick one .zip file, or up to three CSV files.');
  if (zips.length) {
    const files = unzipCsvs(new Uint8Array(await zips[0].arrayBuffer()));
    if (!files.length) throw new Error(`${zips[0].name} has no CSV files in it.`);
    return { files, ignored };
  }
  return { files: await Promise.all(csvs.map(async (f) => ({ name: f.name, text: await f.text() }))), ignored };
}

/**
 * Replaces the current profile's weight, food and/or exercise data with the picked files, one file per
 * kind (or an exported .zip), after one confirmation. Kinds without a file are left as they are.
 */
async function importFiles(picked: File[]): Promise<void> {
  if (!current) {
    showToast('Create or select a profile first, then import your data');
    return;
  }
  const user = current;
  const { files, ignored } = await readPicked(picked);
  const plan = planImport(files, user.unit);
  const skipped = [...ignored, ...plan.ignored.map((i) => `${i.fileName} (${i.reason})`)];
  const noun = (kind: DataKind, n: number) => `${n} ${n === 1 ? IMPORT_NOUN[kind][0] : IMPORT_NOUN[kind][1]}`;
  const currentCounts: Record<DataKind, number> = {
    weight: user.entries.length,
    food: user.foods?.length ?? 0,
    exercise: user.exercises?.length ?? 0,
  };
  const kinds = (['weight', 'food', 'exercise'] as const).filter((k) => plan[k]);
  if (!kinds.length) {
    showToast(`Nothing to import${skipped.length ? `: ${skipped.join('; ')}` : ''}`);
    return;
  }

  const lines = kinds.map((k) => {
    const part = plan[k]!;
    const replaceWith = part.rows.length ? `with ${noun(k, part.rows.length)}` : 'with nothing (it will be emptied)';
    const unreadable = part.unreadable.length ? `, skipping ${part.unreadable.length} unreadable line(s)` : '';
    return `${KIND_LABEL[k]}: replace ${noun(k, currentCounts[k])} ${replaceWith} from ${part.fileName}${unreadable}`;
  });
  const kept = (['weight', 'food', 'exercise'] as const).filter((k) => !plan[k]).map((k) => KIND_LABEL[k].toLowerCase());
  if (kept.length) lines.push(`Unchanged: ${kept.join(' and ')}`);
  if (skipped.length) lines.push(`Not imported: ${skipped.join('; ')}`);
  const ok = await confirmChange({
    title: `Replace data for "${user.name}"?`,
    message: 'Importing will:',
    lines,
    warning: 'This overwrites the current entries. Export first if you want a backup.',
    confirmLabel: 'Replace',
  });
  if (!ok || current !== user) return;

  if (plan.weight) user.entries = plan.weight.rows.map((e) => ({ id: crypto.randomUUID(), ...e }));
  if (plan.food) user.foods = plan.food.rows.map((f) => ({ id: crypto.randomUUID(), ...f }));
  if (plan.exercise) user.exercises = plan.exercise.rows.map((x) => ({ id: crypto.randomUUID(), ...x }));
  await saveUser(user);
  render();
  showToast(`Replaced ${kinds.map((k) => KIND_LABEL[k].toLowerCase()).join(', ')} for "${user.name}"`);
}

dom.importBtn.addEventListener('click', () => dom.importFile.click());
dom.importFile.addEventListener('change', async () => {
  const picked = [...(dom.importFile.files ?? [])];
  dom.importFile.value = '';
  if (!picked.length) return;
  try {
    await importFiles(picked);
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

/** After choosing or reconnecting the folder: its files for this profile load (they win over this browser's copy), or the profile is written to it. */
async function loadFromStore(message: string): Promise<void> {
  await reloadCurrent();
  showToast(message);
}

/** Signs in to Google (from a click) and saves to the "BanBan Weight Tracker" folder in that Drive. */
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
    message: 'Sign in with Google. Your profiles will be saved as CSV files in a "BanBan Weight Tracker" folder in your Drive after every change.',
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
      'Otherwise your data is written to it.',
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
dom.driveGateBtn.addEventListener('click', () => void (googleLogin() ? signInAgain() : pickDrive()));
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
/** Reopens the profile logged in on this tab (e.g. after a reload); otherwise shows the login page. */
async function start(): Promise<void> {
  const session = currentSession();
  if (session?.kind === 'google' && driveConfigured()) {
    // Back to the Google login's Drive; the gate asks to sign in to Google again (it needs a click).
    await resumeGoogle();
    const summary = (await listProfiles()).find((p) => p.googleEmail && p.name === session.name);
    if (summary) return selectProfile(summary.userId);
    endSession();
    closeAccount();
  }
  const local = await localService();
  await refreshTakenNames();
  if (session?.kind === 'username' && (await knownEntries(session.name, local)) !== null) await enter(session.name, null, false);
  else render();
}

void start();
