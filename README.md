# BanBan Weight Tracker

A free, private tracker for **weight, food and exercise**: https://xujuliaa.github.io/banban-weight-tracking-program/

It runs entirely in the browser and has no server. Your data is saved as files you own, in your Google Drive or in a
folder on your computer, and nothing is sent to the developer. See the
[privacy policy](https://xujuliaa.github.io/banban-weight-tracking-program/privacy.html).

## What it does
- **Weight:** log weigh-ins in kg or lb, and see your 10-day average, how regularly you log, and a trend chart.
- **Food:** log what you eat by category and see the mix as a pie chart.
- **Exercise:** log cardio, strength and flexibility sessions and see your minutes per day.
- **Your data:** download everything as a .zip, or edit the files directly.
- Works on phones and computers, offline too, and can be installed like an app.

## Where your data is saved
- **Google Drive**, with Continue with Google, on any device: one Google Sheet per log, in a "BanBan Weight Tracker"
  folder. The app can only see the files it created.
- **A folder on your computer**, with a username login (Chrome, Edge, Brave or Arc on a computer).
- **`testdata/`** in this project, while running it locally.

## Development
Requires Node.js 20 or newer.

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

Built with Vite and TypeScript; the charts are hand-drawn SVG. Every push to `main` deploys to GitHub Pages. If the app
starts storing, sending or asking Google for anything new, update `public/privacy.html` in the same change.

Google sign-in needs an OAuth client ID of type *Web application* from the Google Cloud console, with the authorized
origins `http://localhost:5173`, `http://localhost:4173` and `https://xujuliaa.github.io`. Put it in `.env.local` as
`VITE_GOOGLE_CLIENT_ID` (see `.env.example`), and save it as a repository variable of the same name for the live site.
While the Google app is in Testing, add each person under Google Auth Platform → Audience → Test users.
