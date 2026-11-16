// app.js — bootstrap: wire the markdown hooks, build the editor, toolbar,
// shortcuts, file open/save, theme, autosave, and PWA registration.

(function () {
  'use strict';

  // Inject the math + highlight renderers into the markdown engine.
  Markdown.setHooks({
    math: (src, display) => MathRenderer.render(src, display),
    highlight: (code, lang) => Highlighter.highlight(code, lang),
  });

  const DEFAULT_DOC = [
    '---',
    'title: Welcome',
    'tags: [markdown, katex, pwa]',
    '---',
    '',
    '# Markdown WYSIWYG Editor',
    '',
    'Click any block to edit its **raw markdown**; click away to render it again.',
    'This is *hybrid live preview* — the text is always the source of truth.',
    '',
    '## Features',
    '',
    '- [x] GFM tables, task lists, ~~strikethrough~~, autolinks',
    '- [x] Inline math like $e^{i\\pi} + 1 = 0$ and display math below',
    '- [x] Footnotes[^note] and definition-style references',
    '- [ ] Your document goes here',
    '',
    '$$',
    '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
    '$$',
    '',
    '| Lang | Highlighted |',
    '|:-----|:-----------:|',
    '| js   | yes |',
    '| py   | yes |',
    '',
    '```js',
    'const greet = (name) => `Hello, ${name}!`;',
    'console.log(greet("world"));',
    '```',
    '',
    '> Open a local `.md` file with the folder icon, or press **Ctrl/Cmd+O**.',
    '',
    '[^note]: Footnotes render in their own section at the bottom.',
    '',
  ].join('\n');

  let editor;
  let savedText = '';         // last persisted/opened content, for dirty tracking
  let statusTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    const container = document.getElementById('editor');
    editor = Editor.create(container, {
      onChange: () => { markDirty(); queueAutosave(); },
    });

    // restore autosave or load default
    const auto = await Files.loadAutosave();
    if (auto && auto.text) {
      editor.setDoc(auto.text, { resetHistory: true });
      savedText = auto.savedText || '';
      if (auto.name) setFileName(auto.name);
      setStatus(auto.name ? `Restored unsaved work in ${auto.name}` : 'Restored unsaved work');
    } else {
      editor.setDoc(DEFAULT_DOC, { resetHistory: true });
      // Compare against the normalized doc (what getDoc returns), not the raw
      // DEFAULT_DOC, so a fresh load isn't flagged dirty.
      savedText = editor.getDoc();
      setFileName(null);
    }
    markDirty();

    wireToolbar();
    wireShortcuts();
    wireTheme();
    wireViewTabs();
    wireLaunchQueue();
    registerSW();

    window.addEventListener('beforeunload', (e) => {
      if (editor.isDirtyAgainst(savedText)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ---- toolbar ------------------------------------------------------------
  function wireToolbar() {
    document.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        editor.command(btn.dataset.cmd);
      });
    });
    byId('btn-open').addEventListener('click', openFile);
    byId('btn-save').addEventListener('click', () => saveFile(false));
    byId('btn-saveas').addEventListener('click', () => saveFile(true));
    byId('btn-new').addEventListener('click', newFile);
  }

  // ---- view tabs (edit / preview / source) --------------------------------
  function wireViewTabs() {
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        editor.setMode(btn.dataset.mode);
        document.getElementById('format-tools').style.visibility =
          btn.dataset.mode === 'edit' ? 'visible' : 'hidden';
      });
    });
  }

  // ---- keyboard shortcuts -------------------------------------------------
  function wireShortcuts() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveFile(e.shiftKey); }
      else if (k === 'o') { e.preventDefault(); openFile(); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); editor.command('undo'); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); editor.command('redo'); }
    });
  }

  // ---- file operations ----------------------------------------------------
  async function openFile() {
    if (editor.isDirtyAgainst(savedText) &&
        !confirm('Discard unsaved changes and open another file?')) return;
    try {
      const { name, text } = await Files.open();
      editor.setDoc(text, { resetHistory: true });
      savedText = editor.getDoc();
      setFileName(name);
      markDirty();
      setStatus('Opened ' + name);
      queueAutosave();
    } catch (err) {
      if (err && err.name !== 'AbortError') setStatus('Open failed: ' + err.message);
    }
  }

  async function saveFile(forceAs) {
    try {
      const text = editor.getDoc();
      const wrote = forceAs ? await Files.saveAs(text) : await Files.save(text);
      savedText = text;
      setFileName(Files.currentName());
      markDirty();
      setStatus(wrote ? 'Saved ' + (Files.currentName() || '') : 'Downloaded ' + (Files.currentName() || 'file'));
      queueAutosave();
    } catch (err) {
      if (err && err.name !== 'AbortError') setStatus('Save failed: ' + err.message);
    }
  }

  function newFile() {
    if (editor.isDirtyAgainst(savedText) &&
        !confirm('Discard unsaved changes and start a new document?')) return;
    Files.reset();
    editor.setDoc('# Untitled\n\n', { resetHistory: true });
    savedText = editor.getDoc();
    setFileName(null);
    markDirty();
    setStatus('New document');
    queueAutosave();
  }

  // Files opened from the OS (PWA file handler / launch queue).
  function wireLaunchQueue() {
    if (!('launchQueue' in window)) return;
    window.launchQueue.setConsumer(async (params) => {
      if (!params || !params.files || !params.files.length) return;
      try {
        const { name, text } = await Files.openHandle(params.files[0]);
        editor.setDoc(text, { resetHistory: true });
        savedText = editor.getDoc();
        setFileName(name);
        markDirty();
        setStatus('Opened ' + name);
      } catch (err) { setStatus('Could not open file'); }
    });
  }

  // ---- autosave -----------------------------------------------------------
  let autosaveTimer = null;
  function queueAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      Files.autosave({
        text: editor.getDoc(),
        savedText,
        name: Files.currentName(),
      });
    }, 800);
  }

  // ---- theme --------------------------------------------------------------
  function wireTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    byId('btn-theme').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
        : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }

  // ---- status / filename --------------------------------------------------
  function setFileName(name) {
    const el = byId('filename');
    el.textContent = name || 'untitled.md';
    document.title = (name || 'untitled.md') + ' — Markdown Editor';
  }
  function markDirty() {
    const dirty = editor.isDirtyAgainst(savedText);
    byId('dirty').style.visibility = dirty ? 'visible' : 'hidden';
  }
  function setStatus(msg) {
    const el = byId('status');
    el.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = ''; }, 4000);
  }

  // ---- service worker -----------------------------------------------------
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  function byId(id) { return document.getElementById(id); }
})();
