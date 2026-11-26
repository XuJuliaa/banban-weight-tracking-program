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
import { parseUpload, toWeightCsv } from './csv';
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
import { isMobileDevice } from './device';
import type { UserData, WeightUnit } from './types';
import { type ChartRange, chartPeriod, dayKey } from './stats';
import { overrideDay } from './edits';
import { parseSetting, SETTING_RANGES, type NumberSetting } from './settings';
import { applyPalette, initThemePicker } from './theme';
import { convertEntries, dateToTime } from './units';
import {
  confirmChange,
  dom,
  formatEntry,
  renderChart,
  renderSlopeChart,
  selectChartView,
  type ChartView,
  renderAccount,
  renderFolder,
  renderGate,
  renderLogin,
  renderOverride,
  renderSignupFolder,
  renderUser,
  showFormError,
  showToast,
  type LoginMode,
  type Page,
  showSettingsError,
} from './ui';

/** The logged-in profile; null on the login page. */
let current: UserData | null = null;
/** The folder picked in the Create account form, before the account exists. */
let signupFolder: FileSystemDirectoryHandle | null = null;

/** Reads a date input ("YYYY-MM-DD") as local midnight. */
function readDateInput(input: HTMLInputElement): number | null {
  const [y, m, d] = input.value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : null;
}

/** The weight chart's period: the past 90 days or all time, both ending on the last weigh-in. */
let chartRange: ChartRange = '90';
/** Which chart the card shows: Weight or Slope. Both use the same period. */
let chartView: ChartView = 'weight';

function drawChart(): void {
  for (const btn of dom.rangeButtons) btn.setAttribute('aria-pressed', String(btn.dataset.range === chartRange));
  if (!current) return;
  const { start, end } = chartPeriod(current.entries.map((e) => e.date), chartRange, Date.now());
  (chartView === 'slope' ? renderSlopeChart : renderChart)(current, start, end);
}

function showChartView(view: ChartView, focus = false): void {
  chartView = view;
  selectChartView(view, focus);
  drawChart();
}

/** The page a logged-in user is on: the tracker, or Settings. */
let page: Page = 'tracker';

function render(): void {
  renderAccount(current?.name ?? null);
  // The profile's color scheme (also remembered in this browser, for the login page).
  if (current) applyPalette(current.settings.palette, dom.themePicker);
  renderUser(current, Date.now(), page);
  renderFolder(userdataStatus(), userdataPath(), current);
  renderSignupFolder(userdataStatus(), userdataPath(), signupFolder?.name ?? null);
  // Saving to a folder is required: without one, show what to do instead of the app (with its own Log out).
  if (renderGate(userdataStatus(), userdataPath(), current !== null)) {
    dom.login.hidden = true;
    dom.tracker.hidden = true;
    dom.settingsPage.hidden = true;
    dom.settingsBtn.hidden = true;
  }
  if (current) renderOverride(current, readDateInput(dom.overrideDate));
  drawChart();
}

async function selectProfile(userId: string | null): Promise<void> {
  current = userId ? ((await loadUser(userId)) ?? null) : null;
  // When running locally, the testdata/ files hold the latest data for this name.
  if (current) current = await loadUserFromFiles(current);
  // The weight chart opens on the past 90 days.
  chartRange = '90';
  chartView = 'weight';
  selectChartView('weight');
  page = 'tracker';
  showSettingsError(null);
  dom.overrideDate.value = dayKey(Date.now());
  render();
}

/** Reloads the open profile from the data folder, keeping the chosen chart period. */
async function reloadCurrent(): Promise<void> {
  if (current) current = await loadUserFromFiles(current);
  render();
}

// --- Login by username and a weight from the profile's logged range. Each profile remembers its own data folder.

/** The username typed in Log in that has no profile yet, while "Create account" / "Find it" are offered. */
let missingName: string | null = null;

const usernameIn = (form: HTMLFormElement) => String(new FormData(form).get('username') ?? '').trim();

/** A profile's weigh-ins and the unit they're stored in, for checking the login weight. */
type KnownWeights = Pick<UserData, 'entries' | 'unit'>;

/**
 * The weigh-ins of the profile with this name, or null if there isn't one: from testdata/ when running
 * locally; on a hosted site, from this browser's copy (the browser also remembers the profile's folder).
 */
async function knownEntries(name: string, local: boolean): Promise<KnownWeights | null> {
  if (local) return (await findProfileData(name)) ?? null;
  const summary = await findProfileByName(name);
  if (!summary) return null;
  return (await loadUser(summary.userId)) ?? { entries: [], unit: 'kg' };
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
function weightAccepted(known: KnownWeights): boolean {
  const weight = dom.loginWeight.valueAsNumber;
  if (weightMatches(known.entries, known.unit, weight, loginUnit)) return true;
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
    if (!weightAccepted(data)) return;
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

/** True when the login page offers only Continue with Google (see updateLoginOptions). */
let googleOnly = false;

/**
 * Phones and tablets only sign in with Google, even when running locally: the username + weight login is taken
 * off the page. Safari and Firefox on a computer can't save to a folder either, so on a hosted site they get the
 * same; running locally, testdata/ works in any browser.
 */
async function updateLoginOptions(): Promise<void> {
  googleOnly = isMobileDevice() || (driveConfigured() && !folderSupported() && !(await localService()));
  if (!googleOnly) return;
  dom.login.classList.add('google-only');
  for (const part of dom.login.querySelectorAll('.login-tabs, .login-form, .or-divider, .login-note')) part.remove();
  if (!driveConfigured()) {
    dom.googleLogin.hidden = false;
    dom.googleLoginBtn.hidden = true;
    showFormError(dom.googleLogin, "Sign-in with Google isn't set up for this copy of the app yet.");
  }
}
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
  page = 'tracker';
  closeAccount();
  void refreshTakenNames();
  selectLoginMode('login');
  render();
  (googleOnly ? dom.googleLoginBtn : dom.loginForm.querySelector('input'))?.focus();
});

dom.entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!current) return;
  const weight = dom.weightInput.valueAsNumber;
  if (!Number.isFinite(weight) || weight <= 0) {
    showToast('Enter a weight greater than 0');
    return;
  }
  // One weight per date: if today already has one, ask before overwriting it.
  const unit = current.unit;
  const result = overrideDay(current.entries, dayKey(Date.now()), weight, crypto.randomUUID());
  if (result.replaced) {
    const ok = await confirmChange({
      title: 'Overwrite today\'s weight?',
      message: `You already logged ${formatEntry(result.replaced.weight, unit)} today.`,
      warning: `It will be replaced by ${formatEntry(result.entry.weight, unit)}. Each day keeps one weight.`,
      confirmLabel: 'Overwrite',
    });
    if (!ok || !current) return;
  }
  current.entries = result.entries;
  await saveUser(current);
  dom.entryForm.reset();
  render();
  showToast(result.replaced ? 'Today\'s weight updated' : 'Weight logged');
});

const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

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
  const result = overrideDay(current.entries, dayKey(day), weight, crypto.randomUUID());
  const unit = current.unit;
  const ok = await confirmChange(
    result.replaced
      ? {
          title: 'Overwrite this weight?',
          message: `${longDay.format(day)} currently has ${formatEntry(result.replaced.weight, unit)}.`,
          warning: `It will be replaced by ${formatEntry(result.entry.weight, unit)}. This can't be undone from the app.`,
          confirmLabel: 'Overwrite',
        }
      : {
          title: 'Add this weight?',
          message: `Nothing is logged on ${longDay.format(day)}. This will add ${formatEntry(result.entry.weight, unit)}.`,
          confirmLabel: 'Add entry',
        },
  );
  if (!ok || !current) return;
  current.entries = result.entries;
  await saveUser(current);
  dom.overrideWeight.value = '';
  render();
  showToast(result.replaced ? 'Weight overwritten' : 'Weight added');
});

// kg | lb switch: the unit is a setting of the whole profile, so every saved weight is converted to the new
// unit (kept to 2 decimals, so switching back and forth loses almost nothing) and the weight file is rewritten.
dom.unitToggle.addEventListener('click', async (event) => {
  const unit = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-unit]')?.dataset.unit;
  if (!current || (unit !== 'kg' && unit !== 'lb') || unit === current.unit) return;
  current.entries = convertEntries(current.entries, current.unit, unit);
  current.unit = unit;
  render();
  // profiles.csv keeps the unit for other browsers, and the weight file is rewritten in it.
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

/** Download data: the weight log as "weight-Juju-2026-10-14.csv", in the same format Upload data reads. */
dom.downloadBtn.addEventListener('click', () => {
  if (!current) return;
  const name = current.name.replace(/[^\w-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  download(new Blob([toWeightCsv(current)], { type: 'text/csv' }), `weight-${name}-${date}.csv`);
});

/** Largest CSV Upload data accepts; a download of decades of daily weigh-ins is well under 1 MB. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const uploadDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
/** "Sep 26, 2026 – Nov 24, 2026" for entries oldest first; "" for none. */
const spanOf = (entries: { date: string }[]) =>
  entries.length ? `${uploadDay.format(dateToTime(entries[0].date))} – ${uploadDay.format(dateToTime(entries[entries.length - 1].date))}` : '';

// Upload data: replaces every weigh-in with a CSV's, after a confirmation. The file must look like a download.
dom.uploadBtn.addEventListener('click', () => dom.uploadInput.click());
dom.uploadInput.addEventListener('change', async () => {
  const file = dom.uploadInput.files?.[0];
  // Cleared right away, so choosing the same file again still triggers a change.
  dom.uploadInput.value = '';
  if (!current || !file) return;
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast('That file is too large for a weight log (over 2 MB)');
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    showToast("Couldn't read that file");
    return;
  }
  const result = parseUpload(text, current.unit, dayKey(Date.now()));
  if ('error' in result) {
    showSettingsError(result.error);
    return;
  }
  showSettingsError(null);

  const unit = current.unit;
  const before = [...current.entries].sort((a, b) => a.date.localeCompare(b.date));
  const count = (n: number) => `${n} ${n === 1 ? 'weigh-in' : 'weigh-ins'}`;
  const lines: string[] = [];
  if (result.fileUnit !== unit) lines.push(`Weights converted from ${result.fileUnit} to ${unit}.`);
  if (result.merged.length) {
    lines.push(`Dates with more than one row were averaged: ${result.merged.slice(0, 5).join(', ')}${result.merged.length > 5 ? ', …' : ''}.`);
  }
  const ok = await confirmChange({
    title: 'Replace your weight data?',
    message:
      `This replaces your ${count(before.length)}${before.length ? ` (${spanOf(before)})` : ''} ` +
      `with ${count(result.entries.length)} from "${file.name}" (${spanOf(result.entries)}).`,
    lines,
    warning: 'Your current weigh-ins will be deleted. Download your data first if you want to keep a copy.',
    confirmLabel: 'Replace data',
  });
  if (!ok || !current || current.unit !== unit) return;
  current.entries = result.entries.map((e, i) => ({ id: `u${i}-${e.date}`, ...e }));
  await saveUser(current);
  render();
  showToast(`Uploaded ${count(result.entries.length)}`);
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

dom.chartsCard.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const view = target.closest<HTMLButtonElement>('[role="tab"][data-view]')?.dataset.view;
  if (view === 'weight' || view === 'slope') {
    if (view !== chartView) showChartView(view);
    return;
  }
  const range = target.closest<HTMLButtonElement>('button[data-range]')?.dataset.range;
  if (range !== '90' && range !== 'all') return;
  chartRange = range;
  drawChart();
});
// Left/Right arrows (and Home/End) move between the Weight and Slope tabs, as in a standard tab list.
dom.chartTabs[0]?.parentElement?.addEventListener('keydown', (event) => {
  const next =
    event.key === 'ArrowRight' || event.key === 'End' ? 'slope'
    : event.key === 'ArrowLeft' || event.key === 'Home' ? 'weight'
    : null;
  if (!next) return;
  event.preventDefault();
  showChartView(next, true);
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

// Recompute stats when the app comes back into view, since the windows depend on today's date.
// Also reload the profile from its files: they may have been edited by hand or changed
// from another device.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (current) void reloadCurrent();
  else render();
});

// --- Settings page: color scheme, unit (above), trailing average and slope settings, and Log out.

function openPage(next: Page): void {
  page = next;
  showSettingsError(null);
  render();
  window.scrollTo({ top: 0 });
  (next === 'settings' ? dom.settingsBackBtn : dom.settingsBtn).focus();
}

dom.settingsBtn.addEventListener('click', () => openPage('settings'));
dom.gateLogoutBtn.addEventListener('click', () => dom.logoutBtn.click());
dom.settingsBackBtn.addEventListener('click', () => openPage('tracker'));

initThemePicker(dom.themePicker, async (palette) => {
  if (!current || palette === current.settings.palette) return;
  current.settings = { ...current.settings, palette };
  render();
  await saveUser(current);
});

// Number settings save when the field is left or Enter is pressed. A value out of range is put back.
for (const input of dom.settingInputs) {
  input.addEventListener('change', async () => {
    if (!current) return;
    const key = input.dataset.setting as NumberSetting;
    const value = parseSetting(key, input.value);
    if (value === null) {
      const { min, max } = SETTING_RANGES[key];
      showSettingsError(`Enter a whole number from ${min} to ${max}.`);
      input.value = String(current.settings[key]);
      return;
    }
    showSettingsError(null);
    if (value === current.settings[key]) return;
    current.settings = { ...current.settings, [key]: value };
    render();
    await saveUser(current);
    showToast('Setting saved');
  });
}
void requestPersistentStorage();
/** Reopens the profile logged in on this tab (e.g. after a reload); otherwise shows the login page. */
async function start(): Promise<void> {
  const session = currentSession();
  if (session?.kind === 'google' && driveConfigured()) {
    // Back to the Google login's Drive: still signed in within the hour, otherwise the gate asks (it needs a click).
    await resumeGoogle();
    const summary = (await listProfiles()).find((p) => p.googleEmail && p.name === session.name);
    if (summary) return selectProfile(summary.userId);
    endSession();
    closeAccount();
  }
  const local = await localService();
  await updateLoginOptions();
  await refreshTakenNames();
  // A username login isn't offered on this device (phones and tablets), so its session isn't reopened either.
  if (session?.kind === 'username' && !googleOnly && (await knownEntries(session.name, local)) !== null) await enter(session.name, null, false);
  else render();
}

void start();
