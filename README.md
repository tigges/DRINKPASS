# Drink & Pass Journal: installable web app

A bladder and drink diary for your phone. Tap **Drink** or **Pass** when it happens; times, gaps, night passes and daily totals are worked out for you. It works offline and installs to the home screen. Your entries stay on the device: the app makes no network requests apart from loading its own files.

## What it does
- One-tap logging with optional size, drink type, urgency, stool type (Bristol scale) and notes
- Sleep markers (moon and sun) so night passes are counted from your actual night
- Insights for 24 hours to 30 days, with an optional comparison to the previous period
- A clinician summary with a frequency and volume table, a dot chart and a detailed diary, ready to print or copy as CSV
- Export everything as CSV or as a FHIR bundle for health-record systems
- Backups to a file, optionally encrypted with a password, plus automatic copies kept in the browser
- Optional drink reminders during the day
- Home-screen shortcuts for "Log a drink" and "Log a pass"

## What is inside
- `index.html`, `css/`, `js/`, `fonts/`: the app (no build step; `js/` is plain ES modules)
- `manifest.webmanifest`, `icons/`: lets phones install it with its own icon
- `sw.js`: keeps it working offline and offers updates
- `_headers`: security and caching headers (used by Cloudflare Pages and Netlify; GitHub Pages ignores it, and the same Content Security Policy is also set in `index.html`)
- `tests/`, `scripts/`, `package.json` and the config files are development tooling only

## 1. Pick the final address first
Your entries are stored per address. If the address changes later, you will need to back up and restore again, so choose the address you want to keep before you start using it for real. A free address such as `yourname.pages.dev` works; a custom domain can be added in the host's settings.

## 2. Put it online with GitHub Pages
1. Open the repository's **Settings**, then **Pages**. Under Build and deployment choose **Deploy from a branch**, pick the `main` branch and the `/ (root)` folder, then Save.
2. After a minute or two the page shows your address: `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. Open it on your phone. GitHub Pages serves it over https automatically.
3. Optional: add a custom domain on the same Pages screen and tick Enforce HTTPS.

Good to know
- A GitHub Free account needs a public repository for Pages. The repository only contains the app, never your entries. Don't commit backup files to it.
- Everything under `YOUR-USERNAME.github.io` shares one browser storage area. If you host other projects there, they could read this journal's saved data. A custom domain just for this app keeps it isolated.
- GitHub's terms don't allow Pages to run a commercial service. That's fine for personal use.

Cloudflare Pages and Netlify also work: connect the repository or drag the folder in. They also apply `_headers`.

## 3. Move your data
1. In the copy you use now: Settings (sliders inside Insights), tap **Download backup**, and save the file to Files or iCloud Drive. Add a password first if you want the file encrypted.
2. On your phone, open the new address.
3. iPhone: Safari, Share, **Add to Home Screen**. Android Chrome: menu, **Install app**.
4. Open the app from the new home-screen icon. On iPhone the browser tab and the installed app keep separate storage, so restore inside the installed app, not in the browser tab.
5. Settings, **Restore from file**, choose your backup (enter its password if it has one), check the preview, then **Add entries**. Entries already in the app are skipped, so restoring twice is safe.

## 4. Keep it safe
Tap **Download backup** now and then and save it to iCloud Drive or Google Drive. On iPhone, the share sheet offers "Save to Files". If you set a password, keep it somewhere safe: an encrypted backup can't be opened without it.

## Updating the app
Push the new files to `main`. Open copies download the new version in the background and show **A new version of the app is ready**; tapping **Update** switches over. Nothing changes mid-session without that tap.

When releasing, bump `version` in `package.json` and `VERSION` in `sw.js` together; `npm run lint` fails if they differ or if a file is missing from the offline cache list.

## Development
Requires Node 22.

```sh
npm ci
npm run serve        # http://localhost:8080/
npm run lint         # ESLint, HTML validation, offline-cache check
npm run test:unit    # node:test, logic in js/core.js, js/fhir.js, js/crypto.js
npx playwright install chromium
npm run test:e2e     # Playwright, including axe accessibility checks
npm run lighthouse   # Lighthouse CI against the local server
```

The app must be served over http(s) (ES modules and the service worker don't run from `file://`). CI runs lint, unit tests, end-to-end tests and Lighthouse on every pull request.

Code layout: `js/core.js` holds the pure logic (formatting, sleep and night detection, gaps, stats, validation and migration, CSV, frequency-volume, reminders) and has no DOM access, so it is unit-tested in Node. `js/app.js` is the interface and storage. `js/fhir.js` and `js/crypto.js` hold the FHIR export and backup encryption.

## Licence
MIT, see `LICENSE`. The bundled Bricolage Grotesque font is under the SIL Open Font License (`fonts/OFL.txt`).

This journal records what you enter. It isn't medical advice.
