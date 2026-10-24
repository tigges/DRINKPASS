# Drink & Pass Journal: installable web app

This folder is the whole app. It is plain files, so any static host can serve it. Your entries stay on the device (nothing is sent anywhere).

## What is inside
- `index.html`: the app
- `manifest.webmanifest`, `icons/`: lets phones install it with its own icon
- `sw.js`: keeps it working offline
- `_headers`: basic security and caching headers (used by Cloudflare Pages and Netlify)

## 1. Pick the final address first
Your entries are stored per address. If the address changes later, you will need to back up and restore again, so choose the address you want to keep before you start using it for real. A free address such as `yourname.pages.dev` works; a custom domain can be added in the host's settings.

## 2. Put it online with GitHub Pages
Do this on a computer, it takes about five minutes.
1. Sign in at github.com and create a **new repository**. Name it carefully, because the name becomes part of the address and renaming it later changes the address. It must be **public** on a free GitHub account.
2. Unzip this package. Open the folder, select **everything inside it** (including the hidden `.nojekyll` file and the `icons` folder) and drag it onto the repository page, or use Add file, Upload files. Commit the changes. `index.html` must sit at the top level of the repository.
3. Open the repository's **Settings**, then **Pages**. Under Build and deployment choose **Deploy from a branch**, pick the `main` branch and the `/ (root)` folder, then Save. (Labels can differ slightly.)
4. After a minute or two the page shows your address: `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. Open it on your phone. GitHub Pages serves it over https automatically.
5. Optional: add a custom domain on the same Pages screen and tick Enforce HTTPS.

Good to know
- A GitHub Free account needs a public repository for Pages. The repository only contains the app, never your entries.
- Everything under `YOUR-USERNAME.github.io` shares one browser storage area. If you host other projects there, they could read this journal's saved data. A custom domain just for this app, or a separate GitHub account, keeps it isolated.
- GitHub's terms don't allow Pages to run a commercial service. That's fine for personal use. If this becomes a commercial product, move it to another host, and use a custom domain from the start so the address, and everyone's saved data, stays the same.
- The `_headers` file is ignored by GitHub Pages. It only matters on Cloudflare Pages or Netlify.

Other hosts (Cloudflare Pages or Netlify) also work by dragging the folder in.

## 3. Move your data (do this once)
1. In the copy you use now: Settings (sliders inside Insights), tap **Download backup**, and save the file to Files or iCloud Drive.
2. On your phone, open the new address.
3. iPhone: Safari, Share, **Add to Home Screen**. Android Chrome: menu, **Install app**.
4. Open the app from the new home-screen icon. On iPhone the browser tab and the installed app keep separate storage, so restore inside the installed app, not in the browser tab.
5. Settings, **Restore from file**, choose your backup, check the preview, then **Add entries**. Leave "Also restore the settings" ticked.

## 4. Keep it safe
Tap **Download backup** now and then and save it to iCloud Drive or Google Drive. On iPhone, the share sheet offers "Save to Files".

## Updating the app
Replace the files on the host with a newer set. The app picks up the update the next time it is opened with a connection.
