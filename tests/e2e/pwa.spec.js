import { test, expect } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stored } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function controlled(page) {
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('the app starts offline once installed', async ({ page, context }) => {
  await controlled(page);
  await page.locator('#drinkBtn').click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#drinkBtn')).toBeVisible();
  await expect(page.locator('#todayCount')).toHaveText('1 today');
  expect(await page.evaluate(() => document.fonts.check('600 16px "Bricolage Grotesque"'))).toBe(true);
});

test('an error page is never cached as the app', async ({ page, context }) => {
  await controlled(page);
  const res = await page.goto('./missing-page');
  expect(res.status()).toBe(404);
  await context.setOffline(true);
  await page.goto('./');
  await expect(page.locator('#drinkBtn')).toBeVisible();
});

/** Runs `body` against a private, installed copy of the app on its own port, so a test can publish a "new release". */
async function withRelease(page, body) {
  const dir = mkdtempSync(join(tmpdir(), 'dp-release-'));
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'css', 'js', 'fonts', 'icons']) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  const port = 4300 + test.info().workerIndex;
  const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, ROOT: dir, PORT: String(port) }, stdio: 'ignore' });
  try {
    const base = `http://localhost:${port}/`;
    await expect.poll(() => fetch(base).then((r) => r.status, () => 0)).toBe(200);
    await page.goto(base);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const edit = (f, change) => writeFileSync(join(dir, f), change(readFileSync(join(dir, f), 'utf8')));
    await body({ edit, publish: (v) => edit('sw.js', (s) => s.replace(/var VERSION = '[^']+'/, `var VERSION = '${v}'`)) });
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}
const checkForUpdate = (page) => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()).catch(() => {}));
const cacheNames = (page) => page.evaluate(() => caches.keys());

test('a new version waits for the user to tap Update', async ({ page }) => {
  await withRelease(page, async ({ publish }) => {
    await page.locator('#drinkBtn').click();
    publish('test-next');
    await checkForUpdate(page);
    await expect(page.locator('#updateBar')).toBeVisible();
    expect((await cacheNames(page)).some((k) => k.startsWith('dp-shell-test-next-'))).toBe(true);

    await Promise.all([page.waitForEvent('load'), page.locator('#updateNow').click()]);
    await expect.poll(async () => (await cacheNames(page)).map((k) => k.replace(/-[0-9a-f]+$/, ''))).toEqual(['dp-shell-test-next']);
    await expect(page.locator('#updateBar')).toBeHidden();
    expect(await stored(page)).toHaveLength(1);
  });
});

test('an update is refused while the server still sends a file from another release, then retried', async ({ page }) => {
  await withRelease(page, async ({ edit, publish }) => {
    const before = await cacheNames(page);
    edit('css/app.css', (s) => s + '\n/* previous release */\n');
    publish('test-next');
    await checkForUpdate(page);
    await page.waitForTimeout(1500);
    await expect(page.locator('#updateBar')).toBeHidden();
    expect(await cacheNames(page)).toEqual(before);
    await expect(page.locator('#drinkBtn')).toBeVisible();

    edit('css/app.css', (s) => s.replace('\n/* previous release */\n', ''));
    await checkForUpdate(page);
    await expect(page.locator('#updateBar')).toBeVisible();
  });
});

test('home-screen shortcuts log once and clear the address', async ({ page }) => {
  await page.goto('./?log=pass');
  await expect(page.locator('#barMsg')).toContainText('Pass logged');
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  expect(await stored(page)).toHaveLength(1);
});
