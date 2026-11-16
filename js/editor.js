// editor.js — hybrid live-preview editor.
//
// Model: the Markdown STRING is the source of truth. It is segmented into
// blocks (Markdown.segment). Every block renders to HTML; the one block the
// caret is in swaps to a <textarea> showing its raw markdown, and re-renders
// when you leave it (whole-block reveal). Because the raw text is authoritative,
// undo/redo and round-tripping are just string snapshots.
//
// Modes:
//   'edit'    hybrid live preview (default)
//   'preview' everything rendered, read-only
//   'source'  one textarea with the whole document

const Editor = (() => {
  'use strict';

  function create(container, opts = {}) {
    const state = {
      blocks: [],          // [{type, raw}]
      activeIndex: null,    // index of block being edited, or null
      mode: 'edit',
      undoStack: [],
      redoStack: [],
      lastSnapshot: '',
      ta: null,             // active textarea element
      sourceTa: null,       // source-mode textarea
      onChange: opts.onChange || (() => {}),
      onActivate: opts.onActivate || (() => {}),
    };

    // ---- document get/set -------------------------------------------------
    // Live document: reflects the active textarea's current value without
    // committing (so autosave/save never interrupt typing).
    function liveDoc() {
      const parts = state.blocks.map((b, i) =>
        (i === state.activeIndex && state.ta) ? state.ta.value : b.raw);
      const joined = parts.map(s => s.replace(/\s+$/, '')).filter((s, i) =>
        s !== '' || state.blocks.length === 1).join('\n\n');
      return joined.replace(/\n*$/, '\n');
    }

    function setDoc(text, { resetHistory = false } = {}) {
      commit(true);
      state.blocks = Markdown.segment(text || '');
      state.activeIndex = null;
      if (resetHistory) { state.undoStack = []; state.redoStack = []; }
      state.lastSnapshot = liveDoc();
      render();
    }

    function getDoc() { return liveDoc(); }

    // ---- undo / redo ------------------------------------------------------
    function snapshot() {
      const cur = liveDoc();
      if (cur === state.lastSnapshot) return;
      state.undoStack.push(state.lastSnapshot);
      if (state.undoStack.length > 200) state.undoStack.shift();
      state.redoStack = [];
      state.lastSnapshot = cur;
      state.onChange(cur);
    }
    function undo() {
      commit(true);
      if (!state.undoStack.length) return;
      const cur = liveDoc();
      state.redoStack.push(cur);
      const prev = state.undoStack.pop();
      state.lastSnapshot = prev;
      state.blocks = Markdown.segment(prev);
      state.activeIndex = null;
      render(); state.onChange(prev);
    }
    function redo() {
      commit(true);
      if (!state.redoStack.length) return;
      state.undoStack.push(liveDoc());
      const next = state.redoStack.pop();
      state.lastSnapshot = next;
      state.blocks = Markdown.segment(next);
      state.activeIndex = null;
      render(); state.onChange(next);
    }

    // ---- activation / commit ---------------------------------------------
    // Commit the active block: re-segment its textarea value in place. Returns
    // the change in block count at activeIndex (for index adjustment on switch).
    function commit(silent) {
      if (state.activeIndex === null || !state.ta) return 0;
      const i = state.activeIndex;
      const val = state.ta.value;
      const sub = Markdown.segment(val);
      const delta = sub.length - 1;
      if (sub.length === 0) {
        state.blocks.splice(i, 1);          // emptied -> remove block
      } else {
        state.blocks.splice(i, 1, ...sub);
      }
      state.activeIndex = null;
      state.ta = null;
      if (!silent) snapshot();
      return delta;
    }

    function activate(target, caret = 'end') {
      if (state.mode !== 'edit') return;
      if (state.activeIndex !== null && state.activeIndex !== target) {
        const from = state.activeIndex;
        const delta = commit(false);
        if (from < target) target += delta;
      } else if (state.activeIndex === target) {
        return; // already editing
      }
      target = Math.max(0, Math.min(target, state.blocks.length - 1));
      if (!state.blocks.length) return;
      state.activeIndex = target;
      render();
      focusActive(caret);
    }

    function deactivate() {
      if (state.activeIndex === null) return;
      commit(false);
      render();
    }

    function focusActive(caret) {
      if (!state.ta) return;
      const ta = state.ta;
      ta.focus();
      const pos = caret === 'start' ? 0
        : caret === 'end' ? ta.value.length
        : typeof caret === 'number' ? caret : ta.value.length;
      try { ta.setSelectionRange(pos, pos); } catch (_) {}
      autosize(ta);
      ta.scrollIntoView({ block: 'nearest' });
    }

    // ---- rendering --------------------------------------------------------
    function render() {
      if (state.mode === 'source') return renderSource();
      container.className = 'editor mode-' + state.mode;
      container.innerHTML = '';
      state.sourceTa = null;

      if (!state.blocks.length) {
        const empty = el('div', 'md-empty', state.mode === 'edit'
          ? 'Start writing — click here' : '');
        if (state.mode === 'edit') empty.addEventListener('click', () => {
          state.blocks = [{ type: 'paragraph', raw: '' }];
          activate(0, 'end');
        });
        container.appendChild(empty);
        return;
      }

      const ctx = Markdown.buildContext(state.blocks);
      const frag = document.createDocumentFragment();

      state.blocks.forEach((b, i) => {
        const wrap = el('div', 'md-block');
        wrap.dataset.i = i;
        wrap.dataset.type = b.type;

        if (state.mode === 'edit' && i === state.activeIndex) {
          const ta = buildTextarea(b.raw, i);
          wrap.classList.add('editing');
          wrap.appendChild(ta);
          state.ta = ta;
          // advance footnote order so numbering stays stable while editing
          try { Markdown.renderBlock(b, ctx); } catch (_) {}
        } else {
          wrap.innerHTML = renderBlockDisplay(b, ctx);
          if (state.mode === 'edit') wrap.classList.add('rendered');
        }
        frag.appendChild(wrap);
      });

      container.appendChild(frag);

      const fn = Markdown.renderFootnotes(ctx);
      if (fn) {
        const sec = el('div', 'md-block footnotes-wrap');
        sec.innerHTML = fn;
        container.appendChild(sec);
      }
      typesetPending(container);
    }

    // Display HTML for a block. Definition blocks (footnote/linkref) are hidden
    // in preview but must stay visible+editable in edit mode.
    function renderBlockDisplay(b, ctx) {
      if (b.type === 'footnote' || b.type === 'linkref') {
        if (state.mode === 'preview') return '';
        return `<div class="def-block" title="definition">${Markdown.esc(b.raw)}</div>`;
      }
      return Markdown.renderBlock(b, ctx) || '<p class="md-blank">&nbsp;</p>';
    }

    function buildTextarea(value, index) {
      const ta = el('textarea', 'block-edit');
      ta.value = value;
      ta.spellcheck = true;
      ta.rows = 1;
      ta.addEventListener('input', () => { autosize(ta); scheduleChange(); });
      ta.addEventListener('blur', () => {
        // defer so a click landing on another block can take over first
        setTimeout(() => { if (state.ta === ta) deactivate(); }, 120);
      });
      ta.addEventListener('keydown', e => onEditKeydown(e, ta, index));
      requestAnimationFrame(() => autosize(ta));
      return ta;
    }

    let changeTimer = null;
    function scheduleChange() {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => { snapshot(); }, 400);
    }

    function renderSource() {
      container.className = 'editor mode-source';
      container.innerHTML = '';
      const ta = el('textarea', 'source-edit');
      ta.value = liveDoc();
      ta.spellcheck = false;
      ta.addEventListener('input', () => {
        state.blocks = Markdown.segment(ta.value);
        scheduleChange();
      });
      container.appendChild(ta);
      state.sourceTa = ta;
      ta.focus();
    }

    // ---- keyboard inside a block -----------------------------------------
    function onEditKeydown(e, ta, index) {
      // Escape commits and deactivates
      if (e.key === 'Escape') { e.preventDefault(); deactivate(); return; }
      // Ctrl/Cmd formatting shortcuts
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); wrap(ta, '**', '**'); return; }
        if (k === 'i') { e.preventDefault(); wrap(ta, '*', '*'); return; }
        if (k === 'k') { e.preventDefault(); linkWrap(ta); return; }
        if (k === 'e') { e.preventDefault(); wrap(ta, '`', '`'); return; }
      }
      // Arrow navigation across block boundaries
      if (e.key === 'ArrowUp' && caretOnFirstLine(ta) && index > 0) {
        e.preventDefault(); activate(index - 1, 'end');
      } else if (e.key === 'ArrowDown' && caretOnLastLine(ta) && index < state.blocks.length - 1) {
        e.preventDefault(); activate(index + 1, 'start');
      }
    }

    function caretOnFirstLine(ta) {
      return ta.value.lastIndexOf('\n', ta.selectionStart - 1) === -1;
    }
    function caretOnLastLine(ta) {
      return ta.value.indexOf('\n', ta.selectionEnd) === -1;
    }

    // ---- selection helpers (used by toolbar + shortcuts) -----------------
    function wrap(ta, before, after) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e);
      // toggle off if already wrapped
      const outer = ta.value.slice(s - before.length, s) + ta.value.slice(e, e + after.length);
      if (sel && outer === before + after) {
        ta.value = ta.value.slice(0, s - before.length) + sel + ta.value.slice(e + after.length);
        ta.setSelectionRange(s - before.length, e - before.length);
      } else {
        ta.value = ta.value.slice(0, s) + before + (sel || '') + after + ta.value.slice(e);
        if (sel) ta.setSelectionRange(s + before.length, e + before.length);
        else ta.setSelectionRange(s + before.length, s + before.length);
      }
      autosize(ta); scheduleChange(); ta.focus();
    }

    function linkWrap(ta) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e) || 'text';
      const ins = `[${sel}](url)`;
      ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
      // select the "url" placeholder
      const urlStart = s + sel.length + 3;
      ta.setSelectionRange(urlStart, urlStart + 3);
      autosize(ta); scheduleChange(); ta.focus();
    }

    function prefixLines(ta, prefix, { toggle = true } = {}) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const startLine = ta.value.lastIndexOf('\n', s - 1) + 1;
      let endLine = ta.value.indexOf('\n', e);
      if (endLine === -1) endLine = ta.value.length;
      const chunk = ta.value.slice(startLine, endLine);
      const lines = chunk.split('\n');
      const allHave = toggle && lines.every(l => l.startsWith(prefix));
      const out = lines.map(l => allHave ? l.slice(prefix.length) : prefix + l).join('\n');
      ta.value = ta.value.slice(0, startLine) + out + ta.value.slice(endLine);
      autosize(ta); scheduleChange(); ta.focus();
    }

    // ---- toolbar command API ---------------------------------------------
    // Ensures there's an editable target, then applies the command.
    function ensureActive() {
      if (state.mode !== 'edit') return null;
      if (state.activeIndex !== null && state.ta) return state.ta;
      if (!state.blocks.length) {
        state.blocks = [{ type: 'paragraph', raw: '' }];
        activate(0, 'end');
      } else {
        activate(Math.min(state.blocks.length - 1, Math.max(0, state.activeIndex ?? 0)), 'end');
      }
      return state.ta;
    }

    function command(name, arg) {
      if (name === 'undo') return undo();
      if (name === 'redo') return redo();
      const ta = state.ta || ensureActive();
      if (!ta) return;
      switch (name) {
        case 'bold':      wrap(ta, '**', '**'); break;
        case 'italic':    wrap(ta, '*', '*'); break;
        case 'strike':    wrap(ta, '~~', '~~'); break;
        case 'code':      wrap(ta, '`', '`'); break;
        case 'math':      wrap(ta, '$', '$'); break;
        case 'link':      linkWrap(ta); break;
        case 'h1':        setHeading(ta, 1); break;
        case 'h2':        setHeading(ta, 2); break;
        case 'h3':        setHeading(ta, 3); break;
        case 'quote':     prefixLines(ta, '> '); break;
        case 'ul':        prefixLines(ta, '- '); break;
        case 'ol':        prefixLines(ta, '1. '); break;
        case 'task':      prefixLines(ta, '- [ ] '); break;
        case 'codeblock': blockInsert(ta, '```\n', '\n```'); break;
        case 'mathblock': blockInsert(ta, '$$\n', '\n$$'); break;
        case 'table':     insertText(ta, '\n| Col A | Col B |\n|-------|-------|\n| a | b |\n'); break;
        case 'hr':        insertText(ta, '\n\n---\n\n'); break;
      }
    }

    function setHeading(ta, level) {
      const s = ta.selectionStart;
      const startLine = ta.value.lastIndexOf('\n', s - 1) + 1;
      let endLine = ta.value.indexOf('\n', s); if (endLine === -1) endLine = ta.value.length;
      let line = ta.value.slice(startLine, endLine).replace(/^#{1,6}\s*/, '');
      const prefix = '#'.repeat(level) + ' ';
      ta.value = ta.value.slice(0, startLine) + prefix + line + ta.value.slice(endLine);
      autosize(ta); scheduleChange(); ta.focus();
    }

    function blockInsert(ta, before, after) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e);
      ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
      const pos = s + before.length + sel.length;
      ta.setSelectionRange(pos, pos);
      autosize(ta); scheduleChange(); ta.focus();
    }

    function insertText(ta, text) {
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
      const pos = s + text.length;
      ta.setSelectionRange(pos, pos);
      autosize(ta); scheduleChange(); ta.focus();
    }

    // ---- container-level interaction -------------------------------------
    container.addEventListener('mousedown', e => {
      if (state.mode !== 'edit') return;
      // let clicks on links/checkboxes behave; otherwise enter edit on the block
      const a = e.target.closest('a');
      if (a) return;
      const wrap = e.target.closest('.md-block');
      if (!wrap || wrap.classList.contains('editing') || wrap.classList.contains('footnotes-wrap')) return;
      const i = parseInt(wrap.dataset.i, 10);
      if (!isNaN(i)) { e.preventDefault(); activate(i, 'end'); }
    });

    // ---- mode switching ---------------------------------------------------
    function setMode(mode) {
      if (mode === state.mode) return;
      commit(true);
      // when leaving source mode, blocks already reflect edits
      state.mode = mode;
      state.activeIndex = null;
      render();
      state.onChange(liveDoc());
    }

    // ---- utilities --------------------------------------------------------
    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function autosize(ta) {
      ta.style.height = 'auto';
      ta.style.height = (ta.scrollHeight) + 'px';
    }
    // KaTeX already typeset inline during render; this is a hook for future
    // async typesetting. Kept as a no-op that also fixes any lazy elements.
    function typesetPending() { /* KaTeX renders synchronously via the hook */ }

    // initial paint
    render();

    return {
      setDoc, getDoc, setMode,
      getMode: () => state.mode,
      command, undo, redo,
      focus: () => { if (state.sourceTa) state.sourceTa.focus(); else ensureActive(); },
      isDirtyAgainst: (saved) => liveDoc() !== saved,
    };
  }

  return { create };
})();

if (typeof window !== 'undefined') window.Editor = Editor;
