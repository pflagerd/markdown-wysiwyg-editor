// L3 — a fresh load of the default document shows no unsaved-changes dot.
const { test, expect } = require('@playwright/test');

test('no spurious dirty dot on a fresh default document', async ({ page, context }) => {
  await context.clearCookies();

  // First load, then wipe any persisted autosave/localStorage and reload so the
  // restore path cannot interfere and the default doc loads clean.
  await page.goto('/');
  await page.evaluate(async () => {
    try { localStorage.clear(); } catch (_) {}
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('mdedit');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.Markdown !== 'undefined');

  const dirty = page.locator('#dirty');
  // Clean state => CSS visibility:hidden.
  await expect(dirty).toHaveCSS('visibility', 'hidden');
});
