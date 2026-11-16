// M2 — a request for a path containing an encoded NUL byte is rejected (400),
// and the server keeps serving normal requests afterward (200).
//
// Playwright's request fixture / fetch normalize the path, so we use Node's
// built-in http module to send the raw, un-normalized path `/%00`.
const { test, expect } = require('@playwright/test');
const http = require('http');

function rawRequest(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port: 8080, method: 'GET', path: rawPath },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('encoded NUL-byte path returns 400 and server stays healthy', async () => {
  const bad = await rawRequest('/%00');
  expect(bad.status).toBe(400);

  // Server still serves a normal file afterward.
  const ok = await rawRequest('/index.html');
  expect(ok.status).toBe(200);
  expect(ok.body).toContain('Markdown Editor');
});
