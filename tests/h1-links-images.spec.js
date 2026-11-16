// H1 — titled links/images + single URL escaping (engine-level, window.Markdown)
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait until the engine is exposed before calling into it.
  await page.waitForFunction(() => typeof window.Markdown !== 'undefined');
});

const render = (page, src) =>
  page.evaluate((s) => window.Markdown.render(s), src);

test('titled inline link renders href + title', async ({ page }) => {
  const html = await render(page, '[docs](/g "T")');
  expect(html).toContain('<a href="/g" title="T">docs</a>');
});

test('titled image renders src, alt, title', async ({ page }) => {
  const html = await render(page, '![a](/i.png "C")');
  expect(html).toContain('<img src="/i.png" alt="a" title="C">');
});

test('ampersand in link URL is escaped exactly once', async ({ page }) => {
  const html = await render(page, '[x](http://h?y=1&z=2)');
  expect(html).toContain('href="http://h?y=1&amp;z=2"');
  expect(html).not.toContain('&amp;amp;');
});

test('inner emphasis is preserved inside a link', async ({ page }) => {
  const html = await render(page, '[**b**](/u)');
  expect(html).toContain('<a href="/u"><strong>b</strong></a>');
});

test('reference link with title resolves', async ({ page }) => {
  const html = await render(page, '[a][r]\n\n[r]: /u "t"\n');
  expect(html).toContain('<a href="/u" title="t">a</a>');
});
