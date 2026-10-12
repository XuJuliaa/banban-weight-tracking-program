# banban-weight-tracking-program

A private tracker for **weight, food and exercise**. There's no account, no sign-in and no remote server.

- **Running locally** with `npm run dev`, every profile is saved as plain CSV files in the project's `userdata/` folder.
- **Hosted as a static site** (GitHub Pages, or installed on a phone), data stays in that browser's storage.

Built with Vite + TypeScript. There's no UI framework and no charting library: the charts are hand-drawn SVG.

---

## Contents
- [Quick start](#quick-start)
- [Features](#features)
- [Using the app](#using-the-app)
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
3. Your entries are written to `userdata/<name>-weight.csv`, `-food.csv` and `-exercise.csv` right away.

---

## Features

### Weight
- **Log a weight.** Type the number and press Enter. The timestamp comes from the device.
- **10-day average.** The average over the last 10 calendar days, today included. Several weigh-ins on one day are averaged first, so each day counts once.
- **60-day logging frequency.** The share of the last 60 calendar days with at least one weigh-in, e.g. "70%" (42 of 60 days).
- **Weight trend chart.** One chart with two lines:
  - every weigh-in, as dots joined by a thin line
  - the 10-day average, as a smooth black line drawn on top

  It opens on the **last 30 days**. Change the From/To dates, or use the **10 / 30 / 90 days / All time** chips. Hover the chart for exact values.
- **Show data table.** Under the chart, it lists the entries in the range, newest first, up to 100 rows, with that day's average.
- **Correct a weight.** This sits at the end of the weight data table, so it stays out of the way. Pick a date and enter the right weight.
  - A confirmation pop-up shows exactly what will be overwritten.
  - Everything logged that day is then replaced by one entry.
  - Nothing can be deleted from the page.
- **kg | lb switch** next to the profile picker.
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
  - Either way, the change rewrites `userdata/<name>-food.csv`.

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
- **Several profiles per device.** A profile *is its name*: "Juju" and "juju" are the same profile, and creating an existing name opens it instead of making a duplicate.
- **Color themes.** Five swatches next to the title:
  - Warm coral (default)
  - Ocean blue
  - Soft lavender
  - Fresh mint
  - Graphite (black on tinted gray)

  Each has a matching dark mode that follows the system setting. Chart category colors come from a palette checked for color-blind separation and contrast.
- **Backup.** Export the weight, food and exercise logs as CSV, and import weigh-ins from a CSV.
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
| Change colors | The swatches next to the title |

---

## How data is stored
There are two places. The **Data & backup → Data folder** row in the app shows which one is in use.

1. **`userdata/` CSV files** are the source of truth whenever the app runs through `npm run dev` or `npm run preview`.
2. **Browser storage (IndexedDB)** is a cache when running locally, and the only copy on GitHub Pages or a phone.

### `userdata/` folder (while running locally)
A small save service built into the Vite dev server (`server/userdata-plugin.ts`) keeps every profile in `userdata/`:

```
userdata/
  profiles.csv          # name,unit
  juju-weight.csv       # timestamp,weight_kg,weight_lb,entered_unit
  juju-food.csv         # timestamp,food,category
  juju-exercise.csv     # timestamp,activity,category,minutes
  .migrated/            # originals kept from one-time file upgrades
```

- **On startup** the app lists the profiles in `userdata/`. Profiles it doesn't have yet are added to the browser; profiles that exist only in the browser are written out.
- **Selecting a profile** loads its latest data from the files, which win over the browser's copy.
- **Every change** is written back immediately. Files are replaced atomically, so a crash can't leave half a file.
- **Not in git.** `userdata/` is in `.gitignore`, so personal data is never committed.
- **Local only.** On GitHub Pages or a phone the save service doesn't exist. The app notices and runs on browser storage alone.

Local HTTP API (dev and preview only):

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/userdata` | `{ dir, profiles: [{ slug, name, unit }] }` |
| `GET` | `/api/userdata/<slug>` | `{ slug, name, unit, entries, foods, exercises }` or `null` |
| `PUT` | `/api/userdata/<slug>` | Validates the user record and rewrites that profile's CSV files |
| `DELETE` | `/api/userdata/<slug>` | Removes that profile's CSV files |

### Browser storage
IndexedDB database `keyval-store`. Each browser and each web address (`localhost:5173`, the GitHub Pages site…) keeps its own copy.

| Key | Value |
| --- | --- |
| `profiles` | List of `{ userId, name }` |
| `user:<userId>` | The whole record: name, unit, weigh-ins, foods, exercises, `updatedAt` |

---

## CSV formats
All files are UTF-8 with a header row, oldest row first. Fields containing commas or quotes are quoted (`"Weights, upper body"`).

**Timestamps.** A timestamp without an offset (e.g. `2026-10-11T07:15:00`) is local time. One with an offset (`Z`, `+02:00`) is that exact moment.

**Weight:** `userdata/<name>-weight.csv` and **Export weight CSV**.
```
timestamp,weight_kg,weight_lb,entered_unit
2026-08-13T07:42:00,72.1,158.95,kg
```
The unit it was typed in is exact; the other is converted (1 kg = 2.20462 lb, rounded to 0.01). **Import weight CSV** also accepts the older `timestamp,weight,unit` format. Rows at a time already in the profile are skipped, so importing the same file twice does nothing.

**Food:** `userdata/<name>-food.csv` and **Export food CSV**.
```
timestamp,food,category
2026-10-11T08:05:00,Oatmeal with berries,Grains & starches
```
The category may be blank (uncategorized). Older two-column files still load.

**Exercise:** `userdata/<name>-exercise.csv` and **Export exercise CSV**.
```
timestamp,activity,category,minutes
2026-10-11T06:54:00,Swim,Cardio,20
2026-10-11T18:30:00,"Weights, upper body",Strength,40
```
The category is `Cardio`, `Strength` or `Flexibility`; minutes run from 1 to 1440. Rows that don't fit are skipped when reading.

---

## Sample data
These are made-up data for trying the charts. The generators are seeded, so they produce the same rows each time.

| Command | Writes |
| --- | --- |
| `npm run sample-data` | `test/data/juju-60d.csv`: 60 days of weigh-ins (about 72 → 69.5 kg), ending today. Import it with **Import weight CSV** into a kg profile named **Juju**. |
| `npm run sample-food` | 60 days of meals in `userdata/juju-food.csv`. Backs up the current file to `userdata/.migrated/` first and keeps existing rows. |
| `npm run sample-exercise` | 60 days of workouts in `userdata/juju-exercise.csv`. Backs up an existing file first and keeps existing rows. |

Pass a different profile slug to the food and exercise scripts with `node scripts/generate-exercise-data.mts <slug>`.

---

## Project structure
```
index.html                 page markup: header, cards, dialogs
vite.config.ts             Vite + PWA config, and the userdata/ save service
src/
  main.ts                  wiring: profile selection, forms, ranges, tabs, import/export
  ui.ts                    rendering: stats, tables, today lists, food and exercise cards
  chart.ts                 weight line chart (SVG), axes and tick helpers
  bars.ts                  exercise minutes-per-day bar chart (SVG)
  pie.ts                   food breakdown pie (SVG)
  stats.ts                 10-day average, 60-day frequency, chart series, day helpers
  food.ts                  food categories and counts
  exercise.ts              exercise categories, summary, daily minutes
  units.ts                 kg/lb conversion and entries stored in both units
  edits.ts                 "correct a weight" logic
  csv.ts                   CSV read/write for weight, food and exercise
  storage.ts               IndexedDB, synced with userdata/
  userdata-api.ts          client for the local save service
  theme.ts                 color theme picker
  names.ts                 profile name → file slug
  types.ts                 shared types
  style.css                themes (light/dark) and layout
server/
  userdata-plugin.ts       HTTP routes added to the dev/preview server
  userdata-files.ts        reading, writing, validating and migrating userdata/ files
scripts/                   sample data generators
test/data/                 sample weight CSV
```

---

## Development
```sh
npm run dev        # dev server with the userdata/ save service
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
- the `userdata/` files: writing, reading, validation and migration

---

## Hosting on GitHub Pages
The app is a static site, so hosting is free. A GitHub Actions workflow (`.github/workflows/deploy.yml`, not added to the repo yet) will run the tests, build, and deploy to GitHub Pages on every push to `main`.

Adding a workflow file needs a token with the `workflow` scope.

Once the workflow is added, turn Pages on once:
1. In the repo on GitHub, open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.

The site is then served at `https://<user>.github.io/banban-weight-tracking-program/`. If you rename the repo, also update `REPO_BASE` in `vite.config.ts`.

> GitHub Pages on a **private** repo needs a paid plan (GitHub Pro / Team). Otherwise make the repo public, or use another static host such as Cloudflare Pages or Netlify, with `npm run build` as the build command and `dist` as the output folder.

On a hosted site there is no `userdata/` folder. Each visitor's data stays in their own browser. Use the CSV exports to back it up.

---

## Privacy
- No account, analytics or tracking, and no data is sent anywhere.
- Locally, data lives only in `userdata/` (git-ignored) and the browser's IndexedDB.
- On a hosted site, data lives only in the visitor's browser.
