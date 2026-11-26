# BanBan Weight Tracker

A free, private **weight** tracker: https://xujuliaa.github.io/banban-weight-tracking-program/

It runs entirely in the browser and has no server. Your data is saved as files you own, in your Google Drive or in a
folder on your computer, and nothing is sent to the developer. See the
[privacy policy](https://xujuliaa.github.io/banban-weight-tracking-program/privacy.html).

## What it does
- **Weight:** log one weight per day in kg or lb, and see a trailing average (10 days by default), how regularly you log, and a chart of your daily weights.
- **Slope:** see your current pace, the weight gained or lost per 30 days, from a straight-line fit over the previous 60 days (adjustable).
- **Settings:** color scheme, kg or lb, the average and slope windows, and Log out, saved with your profile.
- **Your data:** download it as a CSV file, or upload a CSV in the same format to replace it.
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
