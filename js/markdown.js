// markdown.js — hand-written Markdown engine (CommonMark-ish + GFM + footnotes +
// definition lists + front matter + math). No dependencies except the math and
// highlight modules, which are injected to avoid circular imports.
//
// Public API:
//   Markdown.segment(text)            -> [{type, raw}]      block segmentation (for the editor)
//   Markdown.render(text, opts)       -> htmlString         full document -> HTML
//   Markdown.renderBlocks(blocks,ctx) -> htmlString         render pre-segmented blocks
//   Markdown.setHooks({math, highlight})                    inject renderers
//
// The editor treats the Markdown *string* as the source of truth. `segment`
// groups lines into editable blocks; `render` turns the whole document into the
// read view. Both share the same block/inline routines so what you edit matches
// what you see.

const Markdown = (() => {
  'use strict';

  let hooks = {
    // math(src, display) -> html string. Default: escaped passthrough.
    math: (src, display) =>
      `<code class="math-fallback">${esc(display ? '$$' + src + '$$' : '$' + src + '$')}</code>`,
    // highlight(code, lang) -> html string (already escaped). Default: escape only.
    highlight: (code, lang) => esc(code),
  };
  function setHooks(h) { hooks = Object.assign({}, hooks, h); }

  // ---- escaping -----------------------------------------------------------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ESC[c]); }
  function escAttr(s) { return String(s).replace(/[&<>"']/g, c => ESC[c]); }

  // ---- URL scheme allowlist ----------------------------------------------
  // Returns the URL if its scheme is safe to put in href/src, else '#'.
  // Allowed: relative/anchor URLs (no scheme, or starting / # . ?), and the
  // http:, https:, mailto: schemes. For images, data:image/ is also allowed.
  // Rejects javascript:, vbscript:, non-image data:, etc.
  function safeUrl(url, isImage) {
    const u = String(url).trim();
    // relative, root-relative, anchor, query, or anything without a scheme
    if (/^[/#.?]/.test(u) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return u;
    if (/^(https?|mailto):/i.test(u)) return u;
    if (isImage && /^data:image\//i.test(u)) return u;
    return '#';
  }

  // ---- block segmentation -------------------------------------------------
  // Splits a document into top-level editable blocks. A "block" is a unit the
  // hybrid editor reveals as raw markdown all at once (a whole list, table,
  // code fence, etc.). Blank lines are separators, not blocks.
  function segment(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;

    // front matter: --- at very top ... closing --- or ...
    if (lines[0] !== undefined && /^---\s*$/.test(lines[0])) {
      let j = 1;
      while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j])) j++;
      if (j < lines.length) {
        blocks.push({ type: 'frontmatter', raw: lines.slice(0, j + 1).join('\n') });
        i = j + 1;
        // consume one trailing blank line if present
        while (i < lines.length && lines[i].trim() === '') i++;
      }
    }

    const isBlank = l => l.trim() === '';
    const fenceRe = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
    const mathFenceRe = /^\s{0,3}\$\$(.*)$/;

    while (i < lines.length) {
      if (isBlank(lines[i])) { i++; continue; }
      const line = lines[i];

      // fenced code
      let m = line.match(fenceRe);
      if (m) {
        const fence = m[2][0], len = m[2].length;
        const start = i; i++;
        const closeRe = new RegExp('^\\s{0,3}' + (fence === '`' ? '`' : '~') + '{' + len + ',}\\s*$');
        while (i < lines.length && !closeRe.test(lines[i])) i++;
        if (i < lines.length) i++; // include closing fence
        blocks.push({ type: 'code', raw: lines.slice(start, i).join('\n') });
        continue;
      }

      // math block $$ ... $$
      if (mathFenceRe.test(line)) {
        const start = i;
        const single = line.replace(/^\s*\$\$/, '').trim();
        if (single.endsWith('$$') && single.length >= 2) { // one-liner $$ x $$
          i++;
          blocks.push({ type: 'mathblock', raw: lines[start] });
          continue;
        }
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) i++;
        if (i < lines.length) i++;
        blocks.push({ type: 'mathblock', raw: lines.slice(start, i).join('\n') });
        continue;
      }

      // ATX heading (single line)
      if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) {
        blocks.push({ type: 'heading', raw: line });
        i++; continue;
      }

      // thematic break
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        blocks.push({ type: 'hr', raw: line });
        i++; continue;
      }

      // blockquote: consecutive '>' lines (and lazy continuations)
      if (/^\s{0,3}>/.test(line)) {
        const start = i;
        while (i < lines.length && !isBlank(lines[i]) &&
               !/^\s{0,3}(#{1,6}\s|```|~~~)/.test(lines[i])) i++;
        blocks.push({ type: 'blockquote', raw: lines.slice(start, i).join('\n') });
        continue;
      }

      // footnote definition [^id]: ...
      if (/^\[\^[^\]]+\]:/.test(line)) {
        const start = i; i++;
        // continuation lines are indented
        while (i < lines.length && !isBlank(lines[i]) && /^\s+/.test(lines[i]) &&
               !/^\[\^[^\]]+\]:/.test(lines[i])) i++;
        blocks.push({ type: 'footnote', raw: lines.slice(start, i).join('\n') });
        continue;
      }

      // link reference definition  [id]: url "title"
      if (/^\s{0,3}\[[^\]]+\]:\s*\S+/.test(line)) {
        blocks.push({ type: 'linkref', raw: line });
        i++; continue;
      }

      // list: consecutive list items; blank lines between items stay in the block
      if (isListMarker(line)) {
        const start = i; i++;
        while (i < lines.length) {
          if (isBlank(lines[i])) {
            // peek: if the next non-blank line continues the list/indented, keep going
            let k = i; while (k < lines.length && isBlank(lines[k])) k++;
            if (k < lines.length && (isListMarker(lines[k]) || /^\s{2,}\S/.test(lines[k]))) {
              i = k; continue;
            }
            break;
          }
          if (/^\S/.test(lines[i]) && !isListMarker(lines[i]) &&
              !/^\s{0,3}>/.test(lines[i])) {
            // a non-indented, non-list line ends a tight list only if it's a new block
            // (lazy paragraph continuation stays); treat headings/hr/fence as end
            if (/^\s{0,3}(#{1,6}\s|```|~~~|[-*_](\s*[-*_]){2,}\s*$)/.test(lines[i])) break;
          }
          i++;
        }
        blocks.push({ type: 'list', raw: lines.slice(start, i).join('\n') });
        continue;
      }

      // table: a line with | followed by a delimiter row
      if (line.includes('|') && i + 1 < lines.length &&
          /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        const start = i; i += 2;
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) i++;
        blocks.push({ type: 'table', raw: lines.slice(start, i).join('\n') });
        continue;
      }

      // HTML block (starts with a block tag)
      if (/^\s{0,3}<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.test(line) &&
          /^(address|article|aside|base|blockquote|body|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|noscript|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul|video|details|summary|script|style)$/i
            .test((line.match(/^\s{0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)/) || [])[1] || '')) {
        const start = i;
        while (i < lines.length && !isBlank(lines[i])) i++;
        blocks.push({ type: 'html', raw: lines.slice(start, i).join('\n') });
        continue;
      }

      // paragraph: consecutive non-blank lines until a blank or a block starter
      {
        const start = i; i++;
        while (i < lines.length && !isBlank(lines[i]) &&
               !/^\s{0,3}(#{1,6}\s|>|```|~~~|\$\$)/.test(lines[i]) &&
               !isListMarker(lines[i])) {
          // A setext underline (=+ or -+ only) following paragraph text is
          // consumed into the block and ends it, so renderParagraph turns it
          // into <h1>/<h2>. Checked BEFORE the thematic-break test so a '---'
          // underline isn't mistaken for an <hr> (a standalone '---' with no
          // preceding paragraph line is caught by the earlier hr block).
          if (/^\s{0,3}(=+|-+)\s*$/.test(lines[i])) { i++; break; }
          // any other thematic break (e.g. *** or ___) ends the paragraph
          if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i])) break;
          i++;
        }
        blocks.push({ type: 'paragraph', raw: lines.slice(start, i).join('\n') });
      }
    }

    return blocks;
  }

  function isListMarker(line) {
    return /^\s{0,3}([-+*]|\d{1,9}[.)])(\s|$)/.test(line) &&
           !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line); // not an hr
  }

  // ---- document rendering -------------------------------------------------
  function render(text, opts) {
    const blocks = segment(text);
    const ctx = buildContext(blocks);
    // Render blocks first (this fills ctx.footnoteOrder), then append the
    // footnotes section once, at the top level only.
    return renderBlocks(blocks, ctx, opts) + renderFootnotes(ctx);
  }

  // Build cross-block context: link reference defs + footnote defs + ordering.
  function buildContext(blocks) {
    const linkrefs = {};
    const footnotes = {}; // id -> {raw, order}
    const footnoteOrder = [];
    for (const b of blocks) {
      if (b.type === 'linkref') {
        const m = b.raw.match(/^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(]([^"')]*)["')])?\s*$/);
        if (m) linkrefs[m[1].toLowerCase()] = { url: m[2], title: m[3] || '' };
      } else if (b.type === 'footnote') {
        const m = b.raw.match(/^\[\^([^\]]+)\]:\s*([\s\S]*)$/);
        if (m) footnotes[m[1]] = { body: m[2].replace(/\n\s+/g, '\n').trim() };
      }
    }
    return { linkrefs, footnotes, footnoteOrder, usedFootnotes: {} };
  }

  function renderBlocks(blocks, ctx, opts) {
    ctx = ctx || buildContext(blocks);
    opts = opts || {};
    let out = '';
    for (const b of blocks) {
      if (b.type === 'linkref') continue;            // definitions produce no output
      if (b.type === 'footnote') continue;           // rendered in the footnotes section
      out += renderBlock(b, ctx);
    }
    // Note: the footnotes section is appended by the top-level render()/editor,
    // NOT here — this function recurses for blockquotes and list items, and the
    // section must appear only once, at document level.
    return out;
  }

  // Footnotes section for a context whose order was populated during rendering.
  // Exposed so the live editor can append it after rendering blocks itself.
  function renderFootnotes(ctx) {
    const ids = ctx.footnoteOrder.filter(id => ctx.footnotes[id]);
    if (!ids.length) return '';
    let out = '<section class="footnotes"><hr><ol>';
    ids.forEach(id => {
      const body = parseInline(ctx.footnotes[id].body, ctx);
      out += `<li id="fn-${escAttr(id)}">${body} <a href="#fnref-${escAttr(id)}" class="fn-back" title="back">↩</a></li>`;
    });
    return out + '</ol></section>';
  }

  function renderBlock(b, ctx) {
    switch (b.type) {
      case 'frontmatter': return renderFrontmatter(b.raw);
      case 'heading':     return renderHeading(b.raw, ctx);
      case 'hr':          return '<hr>';
      case 'code':        return renderCode(b.raw);
      case 'mathblock':   return renderMathBlock(b.raw);
      case 'blockquote':  return renderBlockquote(b.raw, ctx);
      case 'list':        return renderList(b.raw, ctx);
      case 'table':       return renderTable(b.raw, ctx);
      case 'html':        return b.raw + '\n';
      case 'paragraph':   return renderParagraph(b.raw, ctx);
      default:            return renderParagraph(b.raw, ctx);
    }
  }

  function renderFrontmatter(raw) {
    const inner = raw.replace(/^---\s*\n?/, '').replace(/\n?(---|\.\.\.)\s*$/, '');
    const rows = inner.split('\n').filter(l => l.trim()).map(l => {
      const m = l.match(/^([^:]+):(.*)$/);
      if (!m) return `<div class="fm-row"><span class="fm-raw">${esc(l)}</span></div>`;
      return `<div class="fm-row"><span class="fm-key">${esc(m[1].trim())}</span>` +
             `<span class="fm-val">${esc(m[2].trim())}</span></div>`;
    }).join('');
    return `<div class="frontmatter"><div class="fm-label">front matter</div>${rows}</div>`;
  }

  function renderHeading(raw, ctx) {
    const m = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/) || raw.match(/^\s{0,3}(#{1,6})\s*$/);
    const level = (m && m[1]) ? m[1].length : 1;
    const content = (m && m[2]) ? parseInline(m[2], ctx) : '';
    const id = slug(stripTags(content));
    return `<h${level} id="${escAttr(id)}">${content}</h${level}>`;
  }

  function renderCode(raw) {
    const m = raw.match(/^(\s{0,3})(`{3,}|~{3,})([^\n]*)\n?([\s\S]*?)\n?(?:\2\s*)?$/);
    let lang = '', body = raw;
    if (m) { lang = (m[3] || '').trim().split(/\s+/)[0]; body = m[4] || ''; }
    const html = hooks.highlight(body, lang);
    const langAttr = lang ? ` class="language-${escAttr(lang)}"` : '';
    const label = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
    return `<pre class="code-block">${label}<code${langAttr}>${html}</code></pre>`;
  }

  function renderMathBlock(raw) {
    const src = raw.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '').trim();
    return `<div class="math-block">${hooks.math(src, true)}</div>`;
  }

  function renderBlockquote(raw, ctx) {
    const inner = raw.split('\n').map(l => l.replace(/^\s{0,3}>\s?/, '')).join('\n');
    // recurse so nested blocks/quotes render
    const blocks = segment(inner);
    return `<blockquote>${renderBlocks(blocks, ctx)}</blockquote>`;
  }

  function renderParagraph(raw, ctx) {
    // setext heading?
    const sm = raw.match(/^([\s\S]+?)\n\s{0,3}(=+|-+)\s*$/);
    if (sm) {
      const level = sm[2][0] === '=' ? 1 : 2;
      const content = parseInline(sm[1].trim(), ctx);
      return `<h${level} id="${escAttr(slug(stripTags(content)))}">${content}</h${level}>`;
    }
    const content = parseInline(raw.trim(), ctx);
    return `<p>${content}</p>`;
  }

  function renderTable(raw, ctx) {
    const lines = raw.split('\n').filter(l => l.trim());
    const header = splitRow(lines[0]);
    const align = splitRow(lines[1]).map(c => {
      const l = c.trim().startsWith(':'), r = c.trim().endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });
    let html = '<table><thead><tr>';
    header.forEach((c, k) => {
      const a = align[k] ? ` style="text-align:${align[k]}"` : '';
      html += `<th${a}>${parseInline(c.trim(), ctx)}</th>`;
    });
    html += '</tr></thead><tbody>';
    for (let r = 2; r < lines.length; r++) {
      const cells = splitRow(lines[r]);
      html += '<tr>';
      for (let k = 0; k < header.length; k++) {
        const a = align[k] ? ` style="text-align:${align[k]}"` : '';
        html += `<td${a}>${parseInline((cells[k] || '').trim(), ctx)}</td>`;
      }
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }

  function splitRow(line) {
    let s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = []; let cur = ''; let escp = false;
    for (const ch of s) {
      if (escp) { cur += ch; escp = false; continue; }
      if (ch === '\\') { cur += ch; escp = true; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  }

  // ---- lists (with nesting, task items, ordered/unordered, def lists) ------
  function renderList(raw, ctx) {
    const lines = raw.replace(/\s+$/, '').split('\n');
    const items = parseListItems(lines, 0).items;
    const ordered = /^\s*\d/.test(lines[0]);
    const startM = lines[0].match(/^\s*(\d{1,9})[.)]/);
    const startAttr = ordered && startM && startM[1] !== '1' ? ` start="${startM[1]}"` : '';
    return buildListHtml(items, ordered, startAttr, ctx);
  }

  function parseListItems(lines) {
    // returns {items:[{marker, ordered, task, content:[lines], indent}]}
    const items = [];
    let i = 0;
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-+*]|\d{1,9}[.)])(\s+)(.*)$/);
      if (!m) { i++; continue; }
      const indent = m[1].length;
      const ordered = /\d/.test(m[2]);
      const contentIndent = m[1].length + m[2].length + m[3].length;
      let first = m[4];
      let task = null;
      const t = first.match(/^\[([ xX])\]\s+(.*)$/);
      if (t) { task = t[1].toLowerCase() === 'x'; first = t[2]; }
      const content = [first];
      i++;
      // gather continuation/nested lines
      while (i < lines.length) {
        if (lines[i].trim() === '') {
          // blank: keep if a following line belongs to this item
          if (i + 1 < lines.length && (lines[i + 1].search(/\S/) >= contentIndent ||
              (lines[i + 1].match(/^(\s*)/)[1].length > indent && isListMarker(lines[i + 1])))) {
            content.push(''); i++; continue;
          }
          break;
        }
        const lead = lines[i].match(/^(\s*)/)[1].length;
        const isItem = /^(\s*)([-+*]|\d{1,9}[.)])(\s+)/.test(lines[i]);
        if (isItem && lead <= indent) break;            // sibling or outer item
        if (lead >= contentIndent || (isItem && lead > indent)) {
          content.push(lines[i].slice(Math.min(lead, contentIndent)));
          i++; continue;
        }
        // lazy continuation
        content.push(lines[i]); i++;
      }
      items.push({ ordered, task, content, indent });
    }
    return { items };
  }

  function buildListHtml(items, ordered, startAttr, ctx) {
    const tag = ordered ? 'ol' : 'ul';
    const hasTask = items.some(it => it.task !== null);
    const cls = hasTask ? ' class="task-list"' : '';
    let html = `<${tag}${startAttr}${cls}>`;
    for (const it of items) {
      const inner = it.content.join('\n');
      const sub = segment(inner);
      // if the item is a single paragraph, render tight (no <p>)
      let body;
      if (sub.length === 1 && sub[0].type === 'paragraph') {
        body = parseInline(sub[0].raw.trim(), ctx);
      } else {
        body = renderBlocks(sub, ctx);
      }
      if (it.task !== null) {
        const chk = it.task ? ' checked' : '';
        html += `<li class="task-item"><input type="checkbox" disabled${chk}> ${body}</li>`;
      } else {
        html += `<li>${body}</li>`;
      }
    }
    return html + `</${tag}>`;
  }

  // ---- inline parsing -----------------------------------------------------
  function parseInline(src, ctx) {
    ctx = ctx || { linkrefs: {}, footnotes: {}, footnoteOrder: [] };
    const store = [];
    const PH = n => `${n}`;
    const keep = html => { store.push(html); return PH(store.length - 1); };

    let s = src;

    // 1. protect inline code spans (`code`, ``co`de``)
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, code) =>
      keep(`<code>${esc(code.replace(/^ (.*) $/, '$1'))}</code>`));

    // 2. protect inline math  $...$  (not $$, not escaped, no space just inside)
    s = s.replace(/(?<![\\$])\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$(?!\$)/g, (_, m) =>
      keep(hooks.math(m, false)));

    // 3. protect backslash escapes of punctuation
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>~|"'$])/g, (_, c) => keep(esc(c)));

    // 4. protect raw inline HTML tags & autolinks before escaping
    s = s.replace(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?\/?>|<\/[a-zA-Z][a-zA-Z0-9-]*>/g,
      tag => keep(tag));
    s = s.replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_, url) =>
      keep(`<a href="${escAttr(url)}">${esc(url.replace(/^mailto:/, ''))}</a>`));

    // Images and links are processed on the RAW (unescaped) string, BEFORE the
    // global esc() below, so attribute values (src/href/title) are escaped
    // exactly once (e.g. a '&' in a URL becomes '&amp;', not '&amp;amp;').

    // 5. images  ![alt](url "title")
    // Image alt text has no inner markdown, so the whole image is stored as one
    // opaque keep() placeholder with attributes escaped once.
    s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s)]*?)>?(?:\s+["']([^"']*)["'])?\s*\)/g,
      (_, alt, url, title) =>
        keep(`<img src="${escAttr(safeUrl(url, true))}" alt="${escAttr(alt)}"${title ? ` title="${escAttr(title)}"` : ''}>`));

    // 6. inline links  [text](url "title")
    // Link text CAN contain inner markdown (e.g. [**bold**](url)), so the link
    // is NOT made opaque: emit the opening <a ...> and closing </a> as two
    // keep() placeholders (their sentinels survive esc + emphasis and restore
    // at the end) while the text stays in the stream to be escaped/emphasized.
    s = s.replace(/\[([^\]]*)\]\(\s*<?([^\s)]*?)>?(?:\s+["']([^"']*)["'])?\s*\)/g,
      (_, txt, url, title) =>
        keep(`<a href="${escAttr(safeUrl(url, false))}"${title ? ` title="${escAttr(title)}"` : ''}>`) + txt + keep('</a>'));

    // 7. reference links  [text][id]  and shortcut  [id]  — same sentinel scheme.
    s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (whole, txt, id) => {
      const ref = ctx.linkrefs[(id || txt).toLowerCase()];
      if (!ref) return whole;
      return keep(`<a href="${escAttr(safeUrl(ref.url, false))}"${ref.title ? ` title="${escAttr(ref.title)}"` : ''}>`) + txt + keep('</a>');
    });
    s = s.replace(/\[([^\]^]+)\](?!\()/g, (whole, txt) => {
      const ref = ctx.linkrefs[txt.toLowerCase()];
      if (!ref) return whole;
      return keep(`<a href="${escAttr(safeUrl(ref.url, false))}"${ref.title ? ` title="${escAttr(ref.title)}"` : ''}>`) + txt + keep('</a>');
    });

    // 8. escape everything else (link/image text still in the stream gets escaped here)
    s = esc(s);

    // 9. footnote references [^id]
    s = s.replace(/\[\^([^\]]+)\]/g, (whole, id) => {
      if (!ctx.footnotes[id]) return whole;
      if (ctx.footnoteOrder.indexOf(id) === -1) ctx.footnoteOrder.push(id);
      const n = ctx.footnoteOrder.indexOf(id) + 1;
      return `<sup class="fn-ref" id="fnref-${escAttr(id)}"><a href="#fn-${escAttr(id)}">${n}</a></sup>`;
    });

    // 10. bare autolinks (http/https/www). This runs after esc(), so `url` is
    // already HTML-escaped (escaped once) and is safe to drop into both the
    // href attribute and the link text without re-escaping.
    s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<)]+[^\s<).,;:!?])/g,
      (_, pre, url) => `${pre}<a href="${url.startsWith('www.') ? 'http://' + url : url}">${url}</a>`);

    // 11. emphasis: strong, em, strike (order matters)
    s = s.replace(/\*\*\*([^\s](?:[\s\S]*?[^\s])?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^\s](?:[\s\S]*?[^\s])?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\b__([^\s](?:[\s\S]*?[^\s])?)__\b/g, '<strong>$1</strong>');
    s = s.replace(/(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])/g, '<em>$1</em>');
    s = s.replace(/(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])/g, '<em>$1</em>');
    s = s.replace(/~~([^\s](?:[\s\S]*?[^\s])?)~~/g, '<del>$1</del>');
    s = s.replace(/==([^\s](?:[\s\S]*?[^\s])?)==/g, '<mark>$1</mark>');

    // 12. hard line breaks (two trailing spaces or backslash) then soft breaks
    s = s.replace(/(?:  +|\\)\n/g, '<br>\n');

    // restore protected spans
    s = s.replace(/(\d+)/g, (_, n) => store[+n]);
    return s;
  }

  // ---- helpers ------------------------------------------------------------
  function stripTags(html) { return html.replace(/<[^>]*>/g, ''); }
  function slug(text) {
    return text.toLowerCase().trim()
      .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
  }

  return { segment, render, renderBlocks, renderBlock, renderFootnotes, buildContext, parseInline, setHooks, esc };
})();

if (typeof window !== 'undefined') window.Markdown = Markdown;
if (typeof module !== 'undefined' && module.exports) module.exports = Markdown;
