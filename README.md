# banban-weight-tracking-program

A private tracker for **weight, food and exercise**. There's no account, no sign-in and no remote server.

- **Running locally** with `npm run dev`, every profile is saved as plain CSV files in the project's `testdata/` folder.
- **Hosted as a static site** (just open a link), you choose where the same CSV files are kept when creating a profile:
  - a **folder on your computer** (Chrome, Edge, Brave or Arc on a computer), or
  - your **Google Drive**, which works in any browser, phones included.

  There's no browser-only mode, because browser storage is too easy to lose.

Built with Vite + TypeScript. There's no UI framework and no charting library: the charts are hand-drawn SVG.

---

## Contents
- [Quick start](#quick-start)
- [Features](#features)
- [Using the app](#using-the-app)
- [Logging in](#logging-in)
- [How data is stored](#how-data-is-stored)
- [CSV formats](#csv-formats)
- [Sample data](#sample-data)
- [Project structure](#project-structure)
- [Development](#development)
- [Hosting on GitHub Pages](#hosting-on-github-pages)
- [Privacy](#privacy)

---

## Quick start
You need **Node.js 20 or newer** (22 is used in CI).

```sh
npm install
npm run dev        # serves http://localhost:5173
```

1. Create a profile: type a name and pick **kg** or **lb**.
2. Log a weight, a meal or a workout. The date and time always come from the device clock.
3. Your entries are written to `testdata/<name>-weight.csv`, `-food.csv` and `-exercise.csv` right away.

---

## Features

### Weight
- **Log a weight.** Type the number and press Enter. The timestamp comes from the device.
- **10-day average.** The average over the last 10 calendar days, today included. Several weigh-ins on one day are averaged first, so each day counts once.
- **30-day logging frequency.** The share of the past 30 calendar days with at least one weigh-in, e.g. "70%" (21 of 30 days).
- **Weight trend chart.** One chart with three lines:
  - every weigh-in, as dots joined by a thin line
  - the 10-day average, as a smooth black line
  - a red dotted **trend line**: the straight line that best fits the range's weigh-ins (least-squares linear regression)

  In the chart's top right corner, a sentence sums up the trend in whole numbers (shown in bold), in the unit chosen with the **kg | lb** switch: "You have lost **3** pounds over the past **30** days. Congrats!", or "You have gained … Work harder!!" when the line goes up ("held your weight steady" when it rounds to 0). The amount is how far the trend line falls or rises between the first and last weigh-in in the range, so it's never stretched past your data; the days are the length of the chosen range. A range ending before today reads "over these 30 days". With fewer than two weigh-ins in the range there's no trend.

  It opens on the **last 30 days**. Change the From/To dates, or use the **10 / 30 / 90 days / All time** chips. Hover the chart for exact values.
- **Show data table.** Under the chart, it lists the entries in the range, newest first, up to 100 rows, with that day's average.
- **Correct a weight.** This sits at the end of the weight data table, so it stays out of the way. Pick a date and enter the right weight.
  - A confirmation pop-up shows exactly what will be overwritten.
  - Everything logged that day is then replaced by one entry.
  - Nothing can be deleted from the page.
- **kg | lb switch** in the header.
  - Every weigh-in is stored in both units, so switching only changes which column is shown: stats, chart, table and corrections all follow.
  - Nothing is converted or rewritten.
  - The choice is remembered per profile.

### Food
- **Food log.** On one row: what you ate, a **category**, then Enter. The six categories are:
  - Protein
  - Vegetables & fruit
  - Grains & starches
  - Dairy
  - Snacks & sweets
  - Drinks

  The category stays selected for the next entry. Only **today's** foods are listed under the log.
- **Food breakdown pie.** The share of entries in each category, **counted by number of entries**, over its own date range. It opens on the last 30 days and has the 7 / 30 / 90 days / All time chips. The legend shows every category's count and percent; hover a slice or legend row to highlight it.
- **Editable categories.** In the food **Show data table**, each row's category is a dropdown.
  - Adding a category to an uncategorized entry saves immediately.
  - Changing an existing category asks for confirmation first.
  - Either way, the change rewrites `testdata/<name>-food.csv`.

### Exercise
- **Exercise log.** On one row:
  - the activity (e.g. "Morning run")
  - its category: **Cardio**, **Strength** or **Flexibility**
  - its duration in minutes

  Then press Enter. Today's sessions are listed below with the day's total, e.g. "Today (2) · 50 min".
- **Exercise card.** It has its own date range, opening on the **past 7 days**, with the same chips. The range is shared by four tabs:
  - **Summary:** one tile per category with total time, number of sessions and average minutes per day, plus an overall line, e.g. "All exercise: 4 h 25 min · 8 sessions over 7 days".
  - **Cardio / Strength / Flexibility:** a bar chart of **minutes per day** for that category, as a time series. Days with nothing logged have no bar. Hover a bar to see the date, the total and that day's activities.
  - **Show data table:** lists the sessions behind the selected tab (every category on Summary).

  Tabs can be switched with the arrow keys, and the selected tab is remembered in this browser.

### Everything else
- **Log in with a username.** A username is a profile's name, and each profile has its own data folder. Usernames ignore case and punctuation, so "Juju" and "juju" are the same profile. See [Logging in](#logging-in).
- **Color themes.** Five swatches next to the title:
  - Warm coral (default)
  - Ocean blue
  - Soft lavender
  - Fresh mint
  - Graphite (black on tinted gray)

  Each has a matching dark mode that follows the system setting. Chart category colors come from a palette checked for color-blind separation and contrast.
- **Required data folder on a hosted site.** Creating an account includes choosing the [folder on your computer](#saving-to-a-folder-on-a-hosted-site) where its CSV files are saved.
- **Backup and restore.** Export the weight, food and exercise logs as CSV, and import any of them back.
- **Works offline and installs like an app** (PWA). On a phone, use *Add to Home Screen*.

---

## Using the app

| I want to… | Where |
| --- | --- |
| Log today's weight | **Today's weight** at the top, then **Log weight** |
| See my trend | **Weight trend** card. Change the range with From/To or the chips |
| Fix a wrong weigh-in | Weight trend → **Show data table** → **Correct a weight** at the bottom |
| Switch kg / lb | The **kg \| lb** toggle in the header |
| Log a meal | **Food log**: text, category, Enter |
| Recategorize a meal | Food breakdown → **Show data table** → change the row's dropdown |
| Log a workout | **Exercise log**: activity, category, minutes, Enter |
| See a week of exercise | **Exercise** card → **Summary** tab |
| See daily cardio minutes | **Exercise** card → **Cardio** tab |
| Back up my data | **Data & backup** → Export weight / food / exercise CSV |
| Restore a backup | **Data & backup** → Import weight / food / exercise CSV |
| Pick the data folder (hosted site) | When creating an account; later **Data & backup** → **Change folder…** |
| Switch person | **Log out** in the header, then log in as someone else |
| Change colors | The swatches next to the title |

---

## Logging in
The first screen has two tabs: **Log in** and **Create account**. There's no password; a weight you've logged stands in for one.

- **Log in:** type your username and a weight close to what you've logged, in kg or lb (pick with the toggle next to the field; it's remembered). Both ends of the range are included, and the range uses whole numbers in the unit you pick:
  - **Usually:** from your lowest weigh-in rounded down to your highest rounded up. For 120, 126 and 130 lb that's 120–130 lb; for 130 and 130.8 lb it's 130–131 lb.
  - **Only one day logged** (e.g. a single weigh-in): also the nearest whole number ± 1. A single 128.6 lb allows 128–130 lb.
  - In kg the same rules use kilograms, so 120–130 lb becomes 54–59 kg.

  A profile with no weigh-ins yet needs no weight. If the profile exists and the weight fits, it opens and its data loads from its folder (the browser may ask to allow the folder again). If there's no profile with that name, the app offers **Create account**, with the name filled in. On a hosted site it also offers **Find it in a folder…**, for a profile saved from another browser: pick the folder that holds its files, and the weight is checked against them.
- **Create account:** a username and, on a hosted site, the folder to save your data in. New profiles show weights in kg; switch with the **kg | lb** toggle. If the chosen folder already has files for that name, they're opened instead of starting over.
- **Staying logged in:** a reload keeps you logged in; closing the tab or the browser logs you out. **Log out** in the header does it straight away.
- **Where a profile "exists":** running locally, in `testdata/`. On a hosted site, in this browser, which remembers each profile's folder.
- **Light protection only.** The weight check stops someone opening a profile by just typing a name, but a range of weights is easy to guess for someone who knows you, and the CSV files in the folder aren't protected at all.

---

## How data is stored
Data is always saved as CSV files in a data folder. The **Data & backup → Data folder** row in the app shows which one:

1. **`testdata/`**, whenever the app runs through `npm run dev` or `npm run preview`.
2. **A folder you chose**, on a hosted site (Chrome, Edge, Brave or Arc on a computer).
3. **Google Drive**, on a hosted site in any browser, once it's [set up](#saving-to-google-drive).

The app doesn't let you log anything without a data folder. Browser storage (IndexedDB) keeps a copy as a cache only, and the folder's files are the source of truth.

### `testdata/` folder (while running locally)
A small save service built into the Vite dev server (`server/userdata-plugin.ts`) keeps every profile in `testdata/`:

```
testdata/
  profiles.csv          # name,unit
  juju-weight.csv       # timestamp,weight_kg,weight_lb,entered_unit
  juju-food.csv         # timestamp,food,category
  juju-exercise.csv     # timestamp,activity,category,minutes
  .migrated/            # originals kept from one-time file upgrades
```

- **Logging in** looks for the username's files in `testdata/`, so a profile works from any browser on this computer.
- **After logging in** the profile's latest data loads from the files, which win over the browser's copy.
- **Every change** is written back immediately. Files are replaced atomically, so a crash can't leave half a file.
- **Not in git.** `testdata/` is in `.gitignore`, so personal data is never committed.
- **Local only.** On GitHub Pages or a phone the save service doesn't exist. The app notices and runs on browser storage alone.

Local HTTP API (dev and preview only):

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/userdata` | `{ dir, profiles: [{ slug, name, unit }] }` |
| `GET` | `/api/userdata/<slug>` | `{ slug, name, unit, entries, foods, exercises }` or `null` |
| `PUT` | `/api/userdata/<slug>` | Validates the user record and rewrites that profile's CSV files |
| `DELETE` | `/api/userdata/<slug>` | Removes that profile's CSV files |

### Saving to a folder on a hosted site
On a hosted copy of the app there's no `testdata/` service. The browser saves to a folder you pick instead, using the File System Access API.

| Browser | What happens |
| --- | --- |
| Chrome, Edge, Brave, Arc on a computer | Choose a folder |
| Safari, Firefox, any phone browser | A notice asks you to open the link in Chrome or Edge on a computer instead (Google Drive will cover these browsers, see below). |

1. **Creating an account** includes a required **Where to save your data** field. Click **Choose folder…** and pick or create a folder, e.g. *Documents/Weight Tracker*, then allow access. **Create account** stays blocked until a folder is chosen. The folder is remembered for that profile, so two people can use different folders in one browser.
2. **Saving:** the app writes `profiles.csv` and `<name>-weight.csv`, `-food.csv` and `-exercise.csv` there after every change. These are exactly the same files as `testdata/`, so you can even pick the project's `testdata/` folder. Several profiles can share one folder.
3. **Existing files:** if the folder already has files for that name, they are loaded and win over this browser's copy.
4. **After a browser restart**, Chrome may need your OK again. The app shows a **Reconnect your data folder** screen until you click **Reconnect folder**, so nothing is logged without reaching the folder.
5. **Data & backup → Change folder…** switches to another folder. There's no browser-only mode.

Browsers only reveal the folder's name to the page, not its full path.

### Saving to Google Drive
> **Not offered right now.** With username logins, Drive saving is being reworked into a **Continue with Google** login (one profile per Google account, saved in that person's Drive). The code and setup below stay as they are for that.

**Use Google Drive** signs in with Google and keeps the same CSV files in a **Weight Tracker** folder in your own Drive. It works in every browser, phones included, and the page talks to Google directly with no server in between.

- **Narrow permission.** The app asks only for `drive.file`, so it can see the files it created and nothing else in your Drive.
- **Signing in.** Google's sign-in lasts an hour and isn't kept between visits. Each visit, and after an hour, the app shows **Sign in to Google** (one tap) before you can log anything.
- **Several devices.** The phone and the computer use the same files. When you come back to the tab, the open profile reloads from Drive. Saves replace whole files, so the last save wins.
- **Files added by hand aren't visible.** Because of the narrow permission, CSVs you upload to that folder yourself can't be seen by the app. Use **Import … CSV** to bring existing data in.
- **Signing out.** **Data & backup → Sign out of Google Drive** leaves the files in Drive; the app then asks where to save.

#### One-time setup (by whoever hosts the site)
Drive needs a Google OAuth client ID. It's free and has no client secret.
1. Go to [console.cloud.google.com](https://console.cloud.google.com/), create a project (e.g. *Weight Tracker*), and enable the **Google Drive API** (*APIs & Services → Library*).
2. **OAuth consent screen:**
   - choose **External**, then fill in the app name and support email;
   - add the scope `.../auth/drive.file`;
   - leave it in **Testing** and add every user's Gmail address under **Test users** (up to 100).
3. **Credentials → Create credentials → OAuth client ID:**
   - type **Web application**;
   - under **Authorized JavaScript origins**, add `http://localhost:5173`, `http://localhost:8080` and, later, the hosted site's origin (e.g. `https://<name>.pages.dev`). Origins have no path.
4. Copy the client ID into `.env.local` in the project (see `.env.example`):
   ```
   VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```
   For a hosted build, set the same variable in the host's build settings. Then rebuild.

While the app is in Testing, Google shows an "unverified app" notice and only the listed test users can sign in. That's fine for personal and family use. Without a client ID, the Drive option is simply hidden.

### Browser storage
IndexedDB database `keyval-store`. Each browser and each web address (`localhost:5173`, the GitHub Pages site…) keeps its own copy.

| Key | Value |
| --- | --- |
| `profiles` | List of `{ userId, name }` |
| `user:<userId>` | The whole record: name, unit, weigh-ins, foods, exercises, `updatedAt` |
| `dataFolder` | The folder chosen with **Choose folder…**, if any |
| `driveState` | The Google Drive folder id and account email, if Drive is used. The sign-in token itself is never stored. |

---

## CSV formats
All files are UTF-8 with a header row, oldest row first. Fields containing commas or quotes are quoted (`"Weights, upper body"`).

**Timestamps.** A timestamp without an offset (e.g. `2026-10-11T07:15:00`) is local time. One with an offset (`Z`, `+02:00`) is that exact moment.

**Weight:** `testdata/<name>-weight.csv` and **Export weight CSV**.
```
timestamp,weight_kg,weight_lb,entered_unit
2026-08-13T07:42:00,72.1,158.95,kg
```
The unit it was typed in is exact; the other is converted (1 kg = 2.20462 lb, rounded to 0.01). **Import weight CSV** also accepts the older `timestamp,weight,unit` format. Rows at a time already in the profile are skipped, so importing the same file twice does nothing.

**Food:** `testdata/<name>-food.csv` and **Export food CSV**.
```
timestamp,food,category
2026-10-11T08:05:00,Oatmeal with berries,Grains & starches
```
The category may be blank (uncategorized). Older two-column files still load. **Import food CSV** skips rows with the same time and food as an existing entry.

**Exercise:** `testdata/<name>-exercise.csv` and **Export exercise CSV**.
```
timestamp,activity,category,minutes
2026-10-11T06:54:00,Swim,Cardio,20
2026-10-11T18:30:00,"Weights, upper body",Strength,40
```
The category is `Cardio`, `Strength` or `Flexibility`; minutes run from 1 to 1440. Rows that don't fit are skipped when reading. **Import exercise CSV** skips rows with the same time and activity as an existing entry.

---

## Sample data
These are made-up data for trying the charts. The generators are seeded, so they produce the same rows each time.

| Command | Writes |
| --- | --- |
| `npm run sample-data` | `test/data/juju-60d.csv`: 60 days of weigh-ins (about 72 → 69.5 kg), ending today. Import it with **Import weight CSV** into a kg profile named **Juju**. |
| `npm run sample-food` | 60 days of meals in `testdata/juju-food.csv`. Backs up the current file to `testdata/.migrated/` first and keeps existing rows. |
| `npm run sample-exercise` | 60 days of workouts in `testdata/juju-exercise.csv`. Backs up an existing file first and keeps existing rows. |

Pass a different profile slug to the food and exercise scripts with `node scripts/generate-exercise-data.mts <slug>`.

---

## Project structure
```
index.html                 page markup: header, cards, dialogs
vite.config.ts             Vite + PWA config, and the testdata/ save service
src/
  main.ts                  wiring: login, forms, ranges, tabs, import/export
  accounts.ts              username check and the logged-in session
  ui.ts                    rendering: stats, tables, today lists, food and exercise cards
  chart.ts                 weight line chart (SVG), axes and tick helpers
  bars.ts                  exercise minutes-per-day bar chart (SVG)
  pie.ts                   food breakdown pie (SVG)
  stats.ts                 10-day average, 30-day frequency, chart series, day helpers
  food.ts                  food categories and counts
  exercise.ts              exercise categories, summary, daily minutes
  units.ts                 kg/lb conversion and entries stored in both units
  edits.ts                 "correct a weight" logic
  csv.ts                   CSV read/write for weight, food and exercise
  storage.ts               IndexedDB, synced with the data folder
  userdata-api.ts          picks the data folder: local save service, chosen folder, or none
  profile-files.ts         the folder's file layout (profiles.csv, <slug>-*.csv), shared by both
  folder-store.ts          a folder picked in the browser (File System Access API)
  drive-store.ts           Google Drive as the data folder (Google sign-in + Drive REST API)
  theme.ts                 color theme picker
  names.ts                 profile name → file slug
  types.ts                 shared types
  style.css                themes (light/dark) and layout
server/
  userdata-plugin.ts       HTTP routes added to the dev/preview server
  userdata-files.ts        the Node adapter for testdata/ and one-time file migrations
scripts/                   sample data generators
test/data/                 sample weight CSV
```

---

## Development
```sh
npm run dev        # dev server with the testdata/ save service
npm test           # unit tests (Vitest)
npm run build      # type-check and production build into dist/
npm run preview    # serve the production build (save service included)
```

The tests cover:
- the statistics
- unit conversion and corrections
- CSV reading and writing for all three logs
- food counts, the exercise summary and daily minutes
- the chart geometry: monotone curve, pie slices and bar shapes
- the folder file layout (in memory and on disk): writing, reading, validation and migration
- import duplicate-skipping
- the Google Drive store, against a fake Drive API

---

## Hosting on GitHub Pages
The app is a static site, so hosting is free. A GitHub Actions workflow (`.github/workflows/deploy.yml`, not added to the repo yet) will run the tests, build, and deploy to GitHub Pages on every push to `main`.

Adding a workflow file needs a token with the `workflow` scope.

Once the workflow is added, turn Pages on once:
1. In the repo on GitHub, open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.

The site is then served at `https://<user>.github.io/banban-weight-tracking-program/`. If you rename the repo, also update `REPO_BASE` in `vite.config.ts`.

> GitHub Pages on a **private** repo needs a paid plan (GitHub Pro / Team). Otherwise make the repo public, or use another static host such as Cloudflare Pages or Netlify, with `npm run build` as the build command and `dist` as the output folder.

On a hosted site there is no `testdata/` folder. Each visitor saves to a folder on their own computer (Chrome/Edge) or to their own Google Drive. The CSV exports remain available as an extra backup.

To try the hosted behaviour locally, serve the build from a plain static server under the same base path. For example, from an empty folder that contains a link named `banban-weight-tracking-program` pointing at `dist/`:
```sh
python3 -m http.server 8080
# open http://localhost:8080/banban-weight-tracking-program/
```

---

## Privacy
- No analytics or tracking, and no data is sent anywhere. There's no account with us: a username only names a profile.
- Locally, data lives only in `testdata/` (git-ignored) and the browser's IndexedDB.
- On a hosted site, data lives only in the folder the visitor chooses, or in their own Google Drive, plus a browser cache. The page sends data nowhere else.
