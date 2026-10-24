# Drink & Pass Journal: installable web app

A bladder and drink diary for your phone. Tap **Drink** or **Pass** when it happens; times, gaps, night passes and daily totals are worked out for you. It works offline and installs to the home screen. Your entries stay on the device: the app makes no network requests apart from loading its own files.

## What it does
- One-tap logging with optional size, drink type, urgency, stool type (Bristol scale) and notes
- Sleep markers (moon and sun) so night passes are counted from your actual night
- Insights for 24 hours to 30 days, grouped into drinks and output, passes (gaps, nights, passes each day, sizes and urgency) and bowel (days, Bristol types), with an optional comparison to the previous period
- A clinician summary with a frequency and volume table, a dot chart and a detailed diary. **Save as PDF** opens the print window with an A4 layout (name and date-of-birth lines, page numbers); it can also be copied or downloaded as CSV
- English, German, French, Italian, Dutch, Chinese (Simplified), Spanish and Portuguese. The phone's language is used until a flag is chosen in Settings
- Export everything as CSV or as a FHIR bundle for health-record systems
- Backups to a file, optionally encrypted with a password, plus automatic copies kept in the browser
- Optional drink reminders during the day
- ml or fl oz, and a 24-hour (default) or 12-hour clock
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

When releasing, bump `version` in `package.json` and `VERSION` in `sw.js` together, then run `npm run stamp`. That writes a hash of every app file into `sw.js`. The service worker refuses to install an update if any file it downloads doesn't match, which stops a CDN that briefly serves some files from the previous release from leaving phones with a mix of old and new files; the browser simply tries again later. `npm run lint` fails if the versions differ or the hashes are out of date.

## Development
Requires Node 22.

```sh
npm ci
npm run serve        # http://localhost:8080/
npm run lint         # ESLint, HTML validation, offline-cache and translation checks
npm run test:unit    # node:test, logic in js/core.js, js/i18n.js, js/fhir.js, js/crypto.js
npx playwright install chromium
npm run test:e2e     # Playwright, including axe accessibility checks
npm run lighthouse   # Lighthouse CI against the local server
```

The app must be served over http(s) (ES modules and the service worker don't run from `file://`). CI runs lint, unit tests, end-to-end tests and Lighthouse on every pull request.

Code layout: `js/core.js` holds the pure logic (formatting, sleep and night detection, gaps, stats, validation and migration, CSV, frequency-volume, reminders) and has no DOM access, so it is unit-tested in Node. `js/app.js` is the interface and storage. `js/fhir.js` and `js/crypto.js` hold the FHIR export and backup encryption.

Translations: the English text is the key. Interface code wraps text in `t('…')` (or `tn(n, one, other)` for plurals), and static text in `index.html` is translated at start-up unless it sits inside `translate="no"`. Each language is a file in `js/i18n/` mapping English to the translation, with `{placeholders}` kept as-is. A key such as `passed|Water` adds context when one English word needs two translations. `node scripts/check-i18n.mjs` (part of `npm run lint`) lists missing or unused strings and mismatched placeholders. To add a language, add it to `LANGS` in `js/i18n.js`, add its file to `js/i18n/` and to the cache list in `sw.js`, and add a flag button in Settings. CSV and FHIR exports stay in English.

## Licence
MIT, see `LICENSE`. The bundled Bricolage Grotesque font is under the SIL Open Font License (`fonts/OFL.txt`).

This journal records what you enter. It isn't medical advice.
