// M3 — setext headings vs thematic breaks
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.Markdown !== 'undefined');
});

const render = (page, src) =>
  page.evaluate((s) => window.Markdown.render(s), src);

test('"Title\\n---" is a level-2 setext heading', async ({ page }) => {
  const html = await render(page, 'Title\n---\n');
  expect(html).toContain('<h2');
  expect(html).toContain('Title');
});

test('"Title\\n===" is a level-1 setext heading', async ({ page }) => {
  const html = await render(page, 'Title\n===\n');
  expect(html).toContain('<h1');
  expect(html).toContain('Title');
});

test('standalone "---" with no preceding text is an <hr>', async ({ page }) => {
  const html = await render(page, '---\n');
  expect(html).toContain('<hr>');
});

test('"---" between blank-separated paragraphs stays an <hr>', async ({ page }) => {
  const html = await render(page, 'a\n\n---\n\nb');
  expect(html).toContain('<hr>');
});
