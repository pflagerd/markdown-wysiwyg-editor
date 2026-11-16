#!/usr/bin/env node
// server.js — zero-dependency static file server for local development.
// A service worker needs a real origin, so the app must be served over HTTP
// (opening index.html via file:// won't register the SW or allow fetch).
//
//   node server.js            # serve ./ on http://localhost:8000
//   node server.js 3000       # custom port
//   PORT=3000 node server.js  # custom port via env
//
// Serves files under the project root with correct MIME types (including
// .webmanifest and .woff2), prevents path traversal, and falls back to
// index.html for extensionless navigation requests.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const HOST = process.env.HOST || 'localhost';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch (_) {
    return send(res, 400, 'Bad Request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Resolve within ROOT and reject traversal attempts.
  const filePath = path.join(ROOT, path.normalize(pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA/PWA-friendly fallback: serve index.html for navigations.
      if (!path.extname(filePath)) {
        return streamFile(res, path.join(ROOT, 'index.html'), 200);
      }
      return send(res, 404, 'Not Found');
    }
    streamFile(res, filePath, 200);
  });
});

function streamFile(res, filePath, status) {
  const stream = fs.createReadStream(filePath);
  stream.on('open', () => {
    res.writeHead(status, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-cache',
    });
  });
  stream.on('error', () => send(res, 404, 'Not Found'));
  stream.pipe(res);
}

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`  http://${HOST}:${PORT}/`);
  console.log('Press Ctrl+C to stop.');
});
