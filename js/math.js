// math.js — thin wrapper around the vendored KaTeX build.
// Exposes a render function matching the Markdown engine's `math` hook signature:
//   MathRenderer.render(src, displayMode) -> html string
//
// KaTeX is loaded globally from vendor/katex/katex.min.js (window.katex).
// We render to a string with throwOnError:false so a bad expression shows the
// source in red rather than breaking the whole document. Results are memoised
// because the live editor re-renders the same formulas often.

const MathRenderer = (() => {
  'use strict';
  const cache = new Map();
  const MAX_CACHE = 500;

  function escape(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(src, displayMode) {
    const key = (displayMode ? 'D:' : 'I:') + src;
    if (cache.has(key)) return cache.get(key);
    let html;
    if (typeof window !== 'undefined' && window.katex) {
      try {
        html = window.katex.renderToString(src, {
          displayMode: !!displayMode,
          throwOnError: false,
          errorColor: '#e2504a',
          strict: false,
          trust: false,
          output: 'htmlAndMathml',
        });
      } catch (e) {
        html = `<span class="math-error" title="${escape(String(e.message || e))}">${escape(src)}</span>`;
      }
    } else {
      // KaTeX not loaded (e.g. unit test): escaped passthrough.
      html = `<code class="math-fallback">${escape(displayMode ? '$$' + src + '$$' : '$' + src + '$')}</code>`;
    }
    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(key, html);
    return html;
  }

  return { render };
})();

if (typeof window !== 'undefined') window.MathRenderer = MathRenderer;
if (typeof module !== 'undefined' && module.exports) module.exports = MathRenderer;
