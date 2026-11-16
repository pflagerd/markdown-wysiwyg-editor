// H3 — URL scheme allowlist (dangerous schemes neutralized to '#')
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.Markdown !== 'undefined');
});

const render = (page, src) =>
  page.evaluate((s) => window.Markdown.render(s), src);

test('javascript: link href is neutralized to #', async ({ page }) => {
  const html = await render(page, '[x](javascript:alert(1))');
  expect(html).toContain('href="#"');
  expect(html).not.toContain('javascript:');
});

test('vbscript: link href is neutralized to #', async ({ page }) => {
  const html = await render(page, '[x](vbscript:msgbox(1))');
  expect(html).toContain('href="#"');
  expect(html.toLowerCase()).not.toContain('vbscript:');
});

test('non-image data: link href is neutralized to #', async ({ page }) => {
  const html = await render(page, '[x](data:text/html,<script>1</script>)');
  expect(html).toContain('href="#"');
  expect(html).not.toContain('href="data:text/html');
});

test('data:image/ image src is allowed', async ({ page }) => {
  const html = await render(page, '![i](data:image/png;base64,AAAA)');
  expect(html).toContain('src="data:image/png;base64,AAAA"');
});
