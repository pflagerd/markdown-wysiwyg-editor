// highlight.js — tiny, dependency-free syntax highlighter.
// Produces escaped HTML with <span class="tok-*"> wrappers. Covers the common
// languages for a markdown editor; unknown languages fall back to plain escape.
//
// Approach: per-language ordered rule list. Each rule is [regex, tokenClass].
// We scan left-to-right, at each position trying rules in order; the first match
// at the current index wins. This avoids the classic "highlight inside already
// highlighted" problem without needing a full tokenizer per language.

const Highlighter = (() => {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

  // Common token groups reused across languages.
  const C = {
    lineComment: [/\/\/[^\n]*/y, 'comment'],
    hashComment: [/#[^\n]*/y, 'comment'],
    blockComment: [/\/\*[\s\S]*?\*\//y, 'comment'],
    dquote: [/"(?:\\.|[^"\\])*"/y, 'string'],
    squote: [/'(?:\\.|[^'\\])*'/y, 'string'],
    backtick: [/`(?:\\.|[^`\\])*`/y, 'string'],
    number: [/\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/y, 'number'],
    ws: [/\s+/y, null],
  };

  const kw = words => new RegExp('\\b(?:' + words.join('|') + ')\\b', 'y');

  const LANGS = {
    javascript: [
      C.blockComment, C.lineComment, C.backtick, C.dquote, C.squote,
      [kw(['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','class','extends','super','this','typeof','instanceof','in','of','await','async','yield','try','catch','finally','throw','delete','void','import','export','from','default','static','get','set']), 'keyword'],
      [kw(['true','false','null','undefined','NaN','Infinity']), 'literal'],
      [/[A-Za-z_$][\w$]*(?=\s*\()/y, 'function'],
      C.number,
      [/[A-Za-z_$][\w$]*/y, null],
    ],
    python: [
      C.hashComment, [/"""[\s\S]*?"""|'''[\s\S]*?'''/y, 'string'], C.dquote, C.squote,
      [kw(['def','class','return','if','elif','else','for','while','in','is','not','and','or','import','from','as','with','try','except','finally','raise','lambda','yield','global','nonlocal','pass','break','continue','assert','del','async','await']), 'keyword'],
      [kw(['True','False','None','self','cls']), 'literal'],
      [/[A-Za-z_]\w*(?=\s*\()/y, 'function'],
      C.number, [/[A-Za-z_]\w*/y, null],
    ],
    html: [
      [/<!--[\s\S]*?-->/y, 'comment'],
      [/<\/?[a-zA-Z][\w-]*/y, 'tag'],
      [/[a-zA-Z-]+(?==)/y, 'attr'],
      C.dquote, C.squote, [/[<>\/=]/y, 'tag'],
    ],
    css: [
      C.blockComment, [/[.#]?[-\w]+(?=\s*\{)/y, 'tag'],
      [/[-a-z]+(?=\s*:)/y, 'attr'], C.dquote, C.squote,
      [/#[0-9a-fA-F]{3,8}\b/y, 'number'], C.number,
      [/[{}:;]/y, 'punct'],
    ],
    json: [
      C.dquote, [kw(['true','false','null']), 'literal'], C.number, [/[{}\[\]:,]/y, 'punct'],
    ],
    bash: [
      C.hashComment, C.dquote, C.squote,
      [kw(['if','then','else','elif','fi','for','while','do','done','case','esac','function','in','return','export','local','echo','cd','source']), 'keyword'],
      [/\$\{?[A-Za-z_]\w*\}?/y, 'literal'], [/-{1,2}[\w-]+/y, 'attr'], C.number,
    ],
    sql: [
      [/--[^\n]*/y, 'comment'], C.blockComment, C.squote, C.dquote,
      [kw(['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','ALTER','DROP','JOIN','LEFT','RIGHT','INNER','OUTER','ON','GROUP','BY','ORDER','HAVING','LIMIT','AS','AND','OR','NOT','NULL','PRIMARY','KEY','FOREIGN','REFERENCES','INDEX','DISTINCT','COUNT','SUM','AVG','MIN','MAX','select','from','where','insert','into','values','update','set','delete','create','table','join','on','group','by','order','and','or','as']), 'keyword'],
      C.number,
    ],
    markdown: [
      [/^#{1,6}[^\n]*/y, 'keyword'], [/\*\*[^*]+\*\*|__[^_]+__/y, 'literal'],
      [/`[^`]+`/y, 'string'], [/\[[^\]]+\]\([^)]+\)/y, 'function'],
    ],
  };

  // aliases
  const ALIAS = { js: 'javascript', ts: 'javascript', typescript: 'javascript', jsx: 'javascript', tsx: 'javascript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', htm: 'html', xml: 'html', yml: 'json', yaml: 'json' };

  function highlight(code, lang) {
    const key = ALIAS[(lang || '').toLowerCase()] || (lang || '').toLowerCase();
    const rules = LANGS[key];
    if (!rules) return esc(code);
    let out = '', i = 0;
    const n = code.length;
    outer: while (i < n) {
      for (const [re, cls] of rules) {
        re.lastIndex = i;
        const m = re.exec(code);
        if (m && m.index === i && m[0].length) {
          out += cls ? `<span class="tok-${cls}">${esc(m[0])}</span>` : esc(m[0]);
          i += m[0].length;
          continue outer;
        }
      }
      out += esc(code[i]); i++;
    }
    return out;
  }

  return { highlight, languages: Object.keys(LANGS) };
})();

if (typeof window !== 'undefined') window.Highlighter = Highlighter;
if (typeof module !== 'undefined' && module.exports) module.exports = Highlighter;
