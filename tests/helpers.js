// Shared helpers for driving the markdown editor through its real UI.
const { expect } = require('@playwright/test');

/**
 * Clear all persisted state (IndexedDB autosave + localStorage) so a fresh
 * load shows the DEFAULT_DOC and is not flagged dirty by a restored session.
 * Call BEFORE the first navigation via page.addInitScript, OR after a first
 * load followed by a reload.
 */
async function clearPersistence(context) {
  await context.clearCookies();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { indexedDB.deleteDatabase('mdedit'); } catch (_) {}
  });
}

/**
 * Drive a markdown document into the editor via Source mode, then switch to
 * Preview and return the #editor container locator for assertions.
 */
async function typeViaSource(page, markdown) {
  await page.locator('[data-mode="source"]').click();
  const ta = page.locator('textarea.source-edit');
  await expect(ta).toBeVisible();
  // Set value + dispatch input exactly like a real edit so blocks re-segment.
  await ta.evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, markdown);
  await page.locator('[data-mode="preview"]').click();
  // Preview mode renders .md-block elements in #editor.
  await expect(page.locator('#editor.mode-preview')).toBeVisible();
}

module.exports = { clearPersistence, typeViaSource };
