// files.js — opening and saving .md files.
// Primary path: File System Access API (Chrome/Edge) for true in-place save.
// Fallback: <input type=file> to open, Blob download to save.
// Also provides IndexedDB-backed autosave of the last session, so an accidental
// reload or crash doesn't lose unsaved work.

const Files = (() => {
  'use strict';

  const supportsFSA = typeof window !== 'undefined' &&
    'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

  const PICKER_OPTS = {
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.txt'] } }],
  };

  let handle = null;      // current FileSystemFileHandle (FSA path only)
  let name = null;        // current file name for display / download

  // ---- open ---------------------------------------------------------------
  async function open() {
    if (supportsFSA) {
      const [h] = await window.showOpenFilePicker(PICKER_OPTS);
      const file = await h.getFile();
      handle = h; name = file.name;
      return { name, text: await file.text() };
    }
    return openViaInput();
  }

  function openViaInput() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return reject(new DOMException('No file', 'AbortError'));
        handle = null; name = file.name;
        const reader = new FileReader();
        reader.onload = () => resolve({ name, text: String(reader.result) });
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      };
      // user-gesture required; called from a click handler
      input.click();
    });
  }

  // Accept a handle delivered by the OS (launchQueue / file_handlers).
  async function openHandle(h) {
    const file = await h.getFile();
    handle = h; name = file.name;
    return { name, text: await file.text() };
  }

  // ---- save ---------------------------------------------------------------
  // Returns true if written to disk, false if it fell back to download.
  async function save(text) {
    if (supportsFSA && handle) {
      await writeHandle(handle, text);
      return true;
    }
    return saveAs(text);
  }

  async function saveAs(text) {
    if (supportsFSA) {
      try {
        const h = await window.showSaveFilePicker({
          ...PICKER_OPTS,
          suggestedName: name || 'untitled.md',
        });
        await writeHandle(h, text);
        handle = h; name = h.name;
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        // fall through to download on unexpected failures
      }
    }
    download(text, name || 'untitled.md');
    return false;
  }

  async function writeHandle(h, text) {
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  }

  function download(text, filename) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function currentName() { return name; }
  function hasHandle() { return !!handle; }
  function reset() { handle = null; name = null; }

  // ---- IndexedDB autosave -------------------------------------------------
  const DB = 'mdedit', STORE = 'session';
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function autosave(state) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(state, 'last');
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch (_) { /* best-effort */ }
  }
  async function loadAutosave() {
    try {
      const db = await idb();
      const val = await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get('last');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      db.close();
      return val || null;
    } catch (_) { return null; }
  }

  return {
    supportsFSA, open, openHandle, save, saveAs, download,
    currentName, hasHandle, reset, autosave, loadAutosave,
  };
})();

if (typeof window !== 'undefined') window.Files = Files;
