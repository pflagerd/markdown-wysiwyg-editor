// H2 — Content-Security-Policy present and enforced by the browser.
const { test, expect } = require('@playwright/test');
const { typeViaSource } = require('./helpers');

test('CSP meta tag declares script-src \'self\'', async ({ page }) => {
  await page.goto('/');
  const content = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(content).toBeTruthy();
  expect(content).toContain("script-src 'self'");
});

test('inline <script> injected through markdown does not execute', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.Markdown !== 'undefined');

  // A raw <script> block, injected into the preview as raw HTML.
  await typeViaSource(page, '<script>window.__pwned = 1<\/script>\n');

  // Give any (blocked) script a chance; web-first wait on the editor already
  // flushed a frame. Assert the global was never set.
  const pwned = await page.evaluate(() => window.__pwned);
  expect(pwned).toBeUndefined();
});

test('inline event-handler (img onerror) injected through markdown does not fire', async ({ page }) => {
  const violations = [];
  await page.goto('/');
  await page.waitForFunction(() => typeof window.Markdown !== 'undefined');

  // Capture CSP violation events raised in the page.
  await page.evaluate(() => {
    window.__cspViolations = 0;
    document.addEventListener('securitypolicyviolation', () => { window.__cspViolations++; });
  });

  // An inline onerror handler is blocked by script-src 'self' (no unsafe-inline).
  await typeViaSource(page, '<img src="x" onerror="window.__ohno = 1">\n');

  // The broken image loads and would fire onerror, but the inline handler is
  // blocked by CSP, so the global is never set.
  const ohno = await page.evaluate(() => window.__ohno);
  expect(ohno).toBeUndefined();

  const count = await page.evaluate(() => window.__cspViolations);
  expect(count).toBeGreaterThan(0);
});

test('CSP does not break the app: KaTeX renders and no console errors on load', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await page.waitForFunction(() => typeof window.Markdown !== 'undefined');

  // The default document contains math, so KaTeX output should appear.
  await expect(page.locator('.katex').first()).toBeVisible();

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
});
