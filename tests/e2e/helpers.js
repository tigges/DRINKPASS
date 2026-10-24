import { fileURLToPath } from 'node:url';

export const SAMPLE_BACKUP = fileURLToPath(new URL('../fixtures/sample-backup.json', import.meta.url));

export async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('drink-pass-log-v1') || '[]'));
}

export async function openSettings(page) {
  await page.locator('#openInsights').click();
  await page.locator('#openSettings').click();
}

export async function restoreSample(page) {
  await openSettings(page);
  await page.locator('#restoreFile').setInputFiles(SAMPLE_BACKUP);
  await page.locator('#restoreGo').click();
}
