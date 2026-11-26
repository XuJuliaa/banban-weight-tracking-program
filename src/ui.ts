import { type ChartSeries, renderLineChart } from './chart';
import {
  dayKey,
  loggingFrequency30d,
  movingAverage10d,
  movingAverageSeries,
  SLOPE_MIN_DAYS,
  SLOPE_PER_DAYS,
  SLOPE_WINDOW_DAYS,
  slopeSeries,
  weightSeries,
} from './stats';
import type { UserData } from './types';
import { pointsIn } from './units';
import { folderSupported } from './folder-store';
import { driveAccount, googleLogin, type UserdataStatus } from './userdata-api';
import { driveConfigured } from './drive-store';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export const dom = {
  profileControls: el<HTMLDivElement>('profile-controls'),
  accountName: el<HTMLElement>('account-name'),
  logoutBtn: el<HTMLButtonElement>('logout-btn'),
  unitToggle: el<HTMLDivElement>('unit-toggle'),
  unitButtons: [...document.querySelectorAll<HTMLButtonElement>('#unit-toggle button[data-unit]')],
  login: el<HTMLElement>('login'),
  loginTabs: [...document.querySelectorAll<HTMLButtonElement>('#login [role="tab"]')],
  loginForm: el<HTMLFormElement>('login-form'),
  signupForm: el<HTMLFormElement>('signup-form'),
  loginWeight: el<HTMLInputElement>('login-weight'),
  loginUnitButtons: [...document.querySelectorAll<HTMLButtonElement>('#login-unit button[data-unit]')],
  loginMissing: el<HTMLDivElement>('login-missing'),
  loginMissingText: el<HTMLParagraphElement>('login-missing-text'),
  loginCreateBtn: el<HTMLButtonElement>('login-create-btn'),
  loginFindBtn: el<HTMLButtonElement>('login-find-btn'),
  signupFolder: el<HTMLDivElement>('signup-folder'),
  signupFolderStatus: el<HTMLParagraphElement>('signup-folder-status'),
  signupFolderBtn: el<HTMLButtonElement>('signup-folder-btn'),
  tracker: el<HTMLDivElement>('tracker'),
  entryForm: el<HTMLFormElement>('entry-form'),
  weightInput: el<HTMLInputElement>('weight-input'),
  unitLabel: el<HTMLSpanElement>('unit-label'),
  avgValue: el<HTMLSpanElement>('avg-value'),
  avgNote: el<HTMLSpanElement>('avg-note'),
  freqValue: el<HTMLSpanElement>('freq-value'),
  freqNote: el<HTMLSpanElement>('freq-note'),
  freqMeter: el<HTMLDivElement>('freq-meter'),
  exportBtn: el<HTMLButtonElement>('export-btn'),
  folderStatus: el<HTMLParagraphElement>('folder-status'),
  editDataBtn: el<HTMLButtonElement>('edit-data-btn'),
  folderActions: el<HTMLDivElement>('folder-actions'),
  chooseFolderBtn: el<HTMLButtonElement>('choose-folder-btn'),
  reconnectFolderBtn: el<HTMLButtonElement>('reconnect-folder-btn'),
  changeFolderBtn: el<HTMLButtonElement>('change-folder-btn'),
  folderGate: el<HTMLElement>('folder-gate'),
  folderGateTitle: el<HTMLHeadingElement>('folder-gate-title'),
  folderGateText: el<HTMLParagraphElement>('folder-gate-text'),
  folderGateBtn: el<HTMLButtonElement>('folder-gate-btn'),
  driveGateBtn: el<HTMLButtonElement>('drive-gate-btn'),
  googleLogin: el<HTMLDivElement>('google-login'),
  googleLoginBtn: el<HTMLButtonElement>('google-login-btn'),
  useDriveBtn: el<HTMLButtonElement>('use-drive-btn'),
  signOutDriveBtn: el<HTMLButtonElement>('sign-out-drive-btn'),
  overrideForm: el<HTMLFormElement>('override-form'),
  overrideDate: el<HTMLInputElement>('override-date'),
  overrideWeight: el<HTMLInputElement>('override-weight'),
  overrideUnit: el<HTMLSpanElement>('override-unit'),
  overrideCurrent: el<HTMLParagraphElement>('override-current'),
  editDialog: el<HTMLDialogElement>('edit-dialog'),
  editWhere: el<HTMLParagraphElement>('edit-where'),
  editFiles: el<HTMLUListElement>('edit-files'),
  editHow: el<HTMLParagraphElement>('edit-how'),
  confirmDialog: el<HTMLDialogElement>('confirm-dialog'),
  confirmTitle: el<HTMLHeadingElement>('confirm-title'),
  confirmBody: el<HTMLDivElement>('confirm-body'),
  confirmOk: el<HTMLButtonElement>('confirm-ok'),
  toast: el<HTMLParagraphElement>('toast'),
  rangeButtons: [...document.querySelectorAll<HTMLButtonElement>('#charts-card button[data-range]')],
  chartsCard: el<HTMLElement>('charts-card'),
  chartFigure: el<HTMLElement>('chart-figure'),
  chartHost: el<HTMLDivElement>('chart-host'),
  chartTabs: [...document.querySelectorAll<HTMLButtonElement>('#charts-card [role="tab"]')],
  weightLegend: el<HTMLDivElement>('weight-legend'),
  slopeLegend: el<HTMLDivElement>('slope-legend'),
};


export const formatWeight = (w: number) => w.toFixed(1);

/** The top bar: who is logged in, with Log out. Hidden on the login page. */
export function renderAccount(name: string | null): void {
  dom.profileControls.hidden = name === null;
  dom.accountName.textContent = name ?? '';
}

export type LoginMode = 'login' | 'signup';

/** The login page's two tabs: Log in and Create account. */
export function renderLogin(mode: LoginMode, focus = false): void {
  for (const tab of dom.loginTabs) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  dom.loginForm.hidden = mode !== 'login';
  dom.signupForm.hidden = mode !== 'signup';
}

/** Shows (or with null, clears) the error line under a login form's fields. */
export function showFormError(form: HTMLElement, message: string | null): void {
  const line = form.querySelector<HTMLElement>('[data-form-error]')!;
  line.textContent = message ?? '';
  line.hidden = message === null;
}

export function renderUser(user: UserData | null, now: number): void {
  dom.login.hidden = user !== null;
  dom.tracker.hidden = user === null;
  if (!user) return;

  dom.unitLabel.textContent = user.unit;
  for (const btn of dom.unitButtons) btn.setAttribute('aria-pressed', String(btn.dataset.unit === user.unit));

  // Weights are stored in the profile's unit, so they're shown as they are.
  const points = pointsIn(user.entries);
  const avg = movingAverage10d(points, now);
  dom.avgValue.textContent = avg === null ? '—' : `${formatWeight(avg)} ${user.unit}`;
  dom.avgNote.textContent = avg === null ? 'No entries in the last 10 days' : '';

  const freq = loggingFrequency30d(points, now);
  dom.freqValue.textContent = `${Math.round(freq.pct)}%`;
  dom.freqNote.textContent = `${freq.daysLogged} of the last ${freq.totalDays} days had an entry`;
  dom.freqMeter.style.width = `${freq.pct}%`;
  dom.freqMeter.parentElement?.setAttribute('aria-label', `${Math.round(freq.pct)}% of days logged`);
}

let toastTimer: number | undefined;
export function showToast(message: string): void {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.remove('show'), 2500);
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** Noon on the day of `timestamp`: where a whole-day value (the 10-day average) is plotted. */
const middayOf = (timestamp: number) => new Date(timestamp).setHours(12, 0, 0, 0);

/** Draws the daily weights and the 10-day average on one chart for local days `startDay`..`endDay`. */
export function renderChart(user: UserData, startDay: number, endDay: number): void {
  const points = pointsIn(user.entries);
  const weights = weightSeries(points, startDay, endDay);
  // The average is only known up to today, so a range ending in the future doesn't draw a flat line into it.
  const now = Date.now();
  const averages = movingAverageSeries(points, startDay, endDay)
    .filter((p) => p.x <= now)
    .map((p) => ({ ...p, x: middayOf(p.x) }));

  const from = new Date(startDay).setHours(0, 0, 0, 0);
  const to = new Date(endDay).setHours(23, 59, 59, 999);

  dom.chartFigure.hidden = false;
  const series: ChartSeries[] = [
    { label: 'Daily', points: weights, className: 'series-weight', dots: true, smooth: false },
    { label: '10-day avg', points: averages, className: 'series-average', dots: false, smooth: true },
  ];
  renderLineChart(dom.chartHost, series, from, to, {
    unit: user.unit,
    formatX: (x) => dayFormat.format(x),
  });
}

/** Which chart the weight card shows: weights and the 10-day average, or the 30-day pace. */
export type ChartView = 'weight' | 'slope';

/** Selects the Weight or Slope tab and shows that view's legend; the caller then draws the chart. */
export function selectChartView(view: ChartView, focus = false): void {
  for (const tab of dom.chartTabs) {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) {
      dom.chartFigure.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
    }
  }
  dom.weightLegend.hidden = view !== 'weight';
  dom.slopeLegend.hidden = view !== 'slope';
}

/** "−2.3" / "+0.4": a pace with its sign, so gaining and losing read at a glance. */
const signed = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? '0.0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
};

/**
 * Draws the 30-day pace (see slopeSeries in stats.ts) for each weigh-in between local days `startDay` and
 * `endDay`, with a line at 0: above it is gaining, below it losing.
 */
export function renderSlopeChart(user: UserData, startDay: number, endDay: number): void {
  const points = slopeSeries(pointsIn(user.entries), startDay, endDay);
  const from = new Date(startDay).setHours(0, 0, 0, 0);
  const to = new Date(endDay).setHours(23, 59, 59, 999);
  dom.chartFigure.hidden = false;
  renderLineChart(dom.chartHost, [{ label: '30-day pace', points, className: 'series-slope', dots: true, smooth: false }], from, to, {
    unit: user.unit,
    formatX: (x) => dayFormat.format(x),
    formatY: (y) => `${signed(y)} ${user.unit} / ${SLOPE_PER_DAYS} days`,
    zeroLine: true,
    emptyText: `Not enough weigh-ins yet: the slope needs entries on at least ${SLOPE_MIN_DAYS} of the previous ${SLOPE_WINDOW_DAYS} days.`,
  });
}


/** The "Data folder" row: where this profile's data is saved, which is testdata/ when running locally. */
/** What the app can offer for saving: a folder (Chrome/Edge on a computer) and/or Google Drive (if set up). */
const canFolder = () => folderSupported();
// Google Drive comes back as a "Continue with Google" login; until then the folder is the only choice.
const canDrive = () => false;

export function renderFolder(status: UserdataStatus, path: string | null, user: UserData | null): void {
  const saving = user ? `${user.name}'s data is saved there as CSV files after every change.` : '';
  const account = driveAccount();
  const text: Record<UserdataStatus, string> = {
    unknown: 'Data folder: checking…',
    connected: `Data folder: ${path ?? "the project's testdata/ folder"}. ${saving}`,
    offline: "Data folder: can't reach the local save service, so changes are only saved in this browser for now. Is npm run dev still running?",
    folder: `Data folder: "${path}" (the folder you chose). ${saving}`,
    'folder-permission': `Data folder: "${path}". The browser needs your OK to use it again.`,
    drive: `Data folder: ${path}${account ? ` in ${account}'s Drive` : ''}. ${user ? `${user.name}'s data is saved there as Google Sheets after every change.` : ''}`,
    'drive-signin': `Data folder: ${path}. Sign in to Google again to keep saving there.`,
    unavailable: 'Data folder: none chosen yet.',
    unsupported: "Data folder: none. This browser can't save to a folder.",
  };
  dom.folderStatus.textContent = text[status];

  // Switching between a folder and Google Drive (hosted site only; never back to browser-only saving).
  const hosted = status !== 'connected' && status !== 'offline' && status !== 'unknown';
  const onDrive = status === 'drive' || status === 'drive-signin';
  dom.changeFolderBtn.textContent = onDrive ? 'Use a folder instead…' : 'Change folder…';
  dom.useDriveBtn.textContent = status === 'drive-signin' ? 'Sign in to Google' : 'Use Google Drive instead';
  const buttons: [HTMLButtonElement, boolean][] = [
    [dom.chooseFolderBtn, status === 'unavailable' && canFolder()],
    [dom.reconnectFolderBtn, status === 'folder-permission'],
    // A Google login always saves to its Drive (Log out signs out of Google), so it gets no switches.
    [dom.changeFolderBtn, hosted && status !== 'unavailable' && canFolder() && !googleLogin()],
    [dom.useDriveBtn, hosted && status !== 'drive' && canDrive()],
    [dom.signOutDriveBtn, onDrive && !googleLogin()],
  ];
  for (const [button, show] of buttons) button.hidden = !show;
  dom.folderActions.hidden = !buttons.some(([, show]) => show);
}

/** True when data can be saved to files: the local testdata/ folder, a chosen folder, or Google Drive. */
export const folderReady = (status: UserdataStatus) => status === 'connected' || status === 'folder' || status === 'drive';

/**
 * The required "Where to save your data" field when creating an account: the folder picked so far
 * (`picked`), or the project's testdata/ folder when running locally.
 */
export function renderSignupFolder(status: UserdataStatus, path: string | null, picked: string | null): void {
  const local = status === 'connected';
  dom.signupFolder.classList.toggle('ready', local || picked !== null);
  dom.signupFolderBtn.hidden = local || !canFolder();
  dom.signupFolderBtn.textContent = picked ? 'Change…' : 'Choose folder…';
  dom.signupFolderStatus.textContent =
    local ? `Saved in the project's testdata/ folder (${path ?? 'testdata/'}).`
    : picked ? `Saved in "${picked}".`
    : !canFolder() ? `This browser can't save to a folder. ${driveConfigured() ? 'Use Continue with Google above, or open' : 'Open'} this page in Chrome or Edge on a computer.`
    : 'Choose a folder on this computer for your CSV files, e.g. Documents/Weight Tracker.';
}

/**
 * The full-page notice shown instead of the app when data can't be saved yet: the logged-in account's folder
 * or Google Drive needs reconnecting or isn't chosen, or this browser has nothing to offer.
 * Returns true when it's shown (the caller then hides everything else).
 */
export function renderGate(status: UserdataStatus, path: string | null, loggedIn: boolean): boolean {
  let gate: { title: string; text: string; folder?: string; drive?: string } | null = null;
  if (status === 'unsupported') {
    gate = {
      title: 'Open this in Chrome or Edge on a computer',
      text:
        'This app saves your data as CSV files in a folder on your computer, so it isn\'t lost if the browser clears its storage. ' +
        'This browser can\'t save to a folder. Open the same link in Chrome, Edge, Brave or Arc on a Mac or PC.',
    };
  } else if (!loggedIn) {
    // Before logging in, the login page itself asks for the folder.
  } else if (status === 'folder-permission') {
    gate = {
      title: 'Reconnect your data folder',
      text: `Your data is saved in the folder "${path}". The browser needs your OK to use it again after a restart.`,
      folder: 'Reconnect folder',
    };
  } else if (status === 'drive-signin') {
    const account = driveAccount();
    gate = {
      title: 'Sign in to Google Drive',
      text: `Your data is saved in ${path}${account ? ` (${account})` : ''}. Sign in to continue: Google asks again on each visit and after an hour.`,
      drive: 'Sign in to Google',
    };
  } else if (status === 'unavailable') {
    gate = {
      title: 'Choose where to save your data',
      text: canFolder()
        ? 'Pick the folder on this computer where your data is kept. Your files already in it are loaded from it.'
        : "This browser can't save to a folder. Log out and use Continue with Google, or open this page in Chrome or Edge on a computer.",
      folder: canFolder() ? 'Choose folder…' : undefined,
      drive: canDrive() ? 'Use Google Drive' : undefined,
    };
  }
  dom.folderGate.hidden = gate === null;
  if (gate) {
    dom.folderGateTitle.textContent = gate.title;
    dom.folderGateText.textContent = gate.text;
    dom.folderGateBtn.hidden = !gate.folder;
    dom.folderGateBtn.textContent = gate.folder ?? '';
    dom.driveGateBtn.hidden = !gate.drive;
    dom.driveGateBtn.textContent = gate.drive ?? '';
    dom.driveGateBtn.classList.toggle('secondary', Boolean(gate.folder));
  }
  return gate !== null;
}

const overrideDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function formatEntry(weight: number, unit: string): string {
  return `${formatWeight(weight)} ${unit}`;
}

/** The "Correct a weight" section: unit label and what's logged on the chosen date. */
export function renderOverride(user: UserData, day: number | null): void {
  dom.overrideUnit.textContent = user.unit;
  dom.overrideDate.max = dayKey(Date.now());
  if (day === null) {
    dom.overrideCurrent.textContent = '';
  } else {
    const logged = user.entries.find((e) => e.date === dayKey(day));
    dom.overrideCurrent.textContent = logged
      ? `Logged on ${overrideDayFormat.format(day)}: ${formatEntry(logged.weight, user.unit)}`
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

/** Where a profile's files are, for the "Edit data" dialog. A file with a `url` opens in a new tab. */
export interface DataFiles {
  where: string;
  files: { label: string; name: string; url?: string }[];
  how: string;
}

/** Shows where to edit the data files. Resolves true when the user is done editing and wants a reload. */
export function showDataFiles(info: DataFiles): Promise<boolean> {
  dom.editWhere.textContent = info.where;
  dom.editFiles.replaceChildren(
    ...info.files.map((f) => {
      const li = document.createElement('li');
      li.append(`${f.label}: `);
      if (f.url) {
        const link = document.createElement('a');
        link.href = f.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = f.name;
        li.append(link);
      } else {
        const code = document.createElement('code');
        code.textContent = f.name;
        li.append(code);
      }
      return li;
    }),
  );
  dom.editHow.textContent = info.how;
  dom.editDialog.returnValue = '';
  dom.editDialog.showModal();
  return new Promise((resolve) => {
    dom.editDialog.addEventListener('close', () => resolve(dom.editDialog.returnValue === 'reload'), { once: true });
  });
}
