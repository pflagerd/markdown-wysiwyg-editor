# Markdown WYSIWYG Editor

A WYSIWYG markdown editor built with **plain HTML / CSS / JavaScript / SVG** — no
framework, no build step. Installable as a **PWA** and works **fully offline**,
with **KaTeX** math support.

## Features

- **Hybrid live preview** — content renders inline (Obsidian/Typora style); click
  a block to reveal its raw markdown, click away to re-render. The markdown string
  is always the source of truth, so undo/redo and round-tripping are exact.
- **Math** — inline `$…$` and block `$$…$$`, rendered with a locally vendored KaTeX
  (no CDN; works offline).
- **Markdown** — CommonMark basics plus GFM tables, task lists, strikethrough,
  autolinks, footnotes, definition-style references, and YAML/TOML front matter.
- **Code highlighting** — lightweight built-in highlighter (js/ts, python, html,
  css, json, bash, sql, markdown).
- **Files** — open & save real `.md` files in place via the File System Access API
  (Chrome/Edge), with an open/upload + download fallback (Firefox/Safari). Open
  `.md` straight from the OS into the installed app via file handlers.
- **Offline PWA** — service worker precaches the app shell, KaTeX, and fonts.
  Autosaves to IndexedDB so a reload never loses unsaved work.
- **Toolbar + keyboard shortcuts**, light/dark theme (auto + manual toggle).

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+O` | Open file |
| `Ctrl/Cmd+S` | Save (`Shift` = Save As) |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / Redo |
| `Ctrl/Cmd+B` / `I` / `K` / `E` | Bold / Italic / Link / Inline code |
| `Esc` | Commit the current block |
| `↑` / `↓` at a block edge | Move to the adjacent block |

## Running

It's fully static — serve the folder over HTTP (a service worker needs an origin).
A zero-dependency Node server is included:

```bash
node server.js        # serves ./ on http://localhost:8000
node server.js 3000   # custom port
```

Then use the browser's install button to install it as an app.

## Project layout

```
index.html              app shell + toolbar (inline SVG icons)
manifest.webmanifest    PWA manifest (installable, .md file handlers)
sw.js                   service worker (offline precache)
css/app.css             theme + editor + rendered-markdown styles
js/markdown.js          hand-written Markdown -> HTML engine
js/editor.js            hybrid live-preview editor core
js/highlight.js         lightweight syntax highlighter
js/math.js              KaTeX wrapper
js/files.js             File System Access + fallback + IndexedDB autosave
js/app.js               bootstrap, shortcuts, file ops, theme, PWA
vendor/katex/           vendored KaTeX (JS + CSS + woff2 fonts)
icons/                  app icons (SVG + PNG)
server.js               zero-dependency Node static dev server
```

## Tests

The markdown engine runs in Node too (`module.exports`), so core parsing can be
checked without a browser:

```bash
node -e "const M=require('./js/markdown.js'); console.log(M.render('# hi **there**'))"
```
