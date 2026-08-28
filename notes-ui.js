(function (root) {
  "use strict";

  // Mobile-only Notes section. Self-booting like the other *-ui.js modules
  // (loads after app.js). All storage goes through PolynNotesStore, which is
  // its own IndexedDB database - nothing here touches localStorage session
  // state, RT Sync, or workspace state.

  const $ = (id) => document.getElementById(id);
  const NotesStore = root.PolynNotesStore;

  const panel = $("notesBlock");
  if (!panel || !NotesStore) return;

  const listView = $("notesListView");
  const editorView = $("notesEditorView");
  const listEl = $("notesList");
  const listEmpty = $("notesListEmpty");
  const unavailable = $("notesUnavailable");
  const newBtn = $("notesNewBtn");
  const backupMenu = $("notesBackupMenu");
  const backupStatus = $("notesBackupStatus");
  const exportBtn = $("notesExportBtn");
  const exportCopyBtn = $("notesExportCopyBtn");
  const exportOutput = $("notesExportOutput");
  const importFile = $("notesImportFile");
  const importInput = $("notesImportInput");
  const importBtn = $("notesImportBtn");

  const backBtn = $("notesBackBtn");
  const titleInput = $("notesTitleInput");
  const bodyInput = $("notesBodyInput");
  const saveState = $("notesSaveState");
  const pinBtn = $("notesPinBtn");
  const editorMenu = $("notesEditorMenu");
  const deleteBtn = $("notesDeleteBtn");
  const toolbar = panel.querySelector(".notesToolbar");

  const AUTOSAVE_DELAY = 600;

  const store = NotesStore.isSupported() ? NotesStore.createStore() : null;

  let currentId = null;
  let currentNote = null;
  let saveTimer = 0;
  let savePending = false;

  if (!store) {
    // No on-device storage (private mode, locked-down WebView). The section
    // stays reachable but inert rather than throwing on open.
    if (unavailable) unavailable.hidden = false;
    if (listEl) listEl.hidden = true;
    if (listEmpty) listEmpty.hidden = true;
    if (newBtn) newBtn.disabled = true;
    if (backupMenu) backupMenu.hidden = true;
    return;
  }

  /* --------------------------------------------------------------------
   *   View switching (mirrors the Tools home/panel pattern)
   * ------------------------------------------------------------------ */

  function inEditor() {
    return document.body.dataset.mobileNotes === "editor";
  }

  function showList() {
    flushSave({ immediate: true });
    currentId = null;
    currentNote = null;
    document.body.dataset.mobileNotes = "list";
    renderList();
  }

  function showEditor() {
    document.body.dataset.mobileNotes = "editor";
  }

  /* --------------------------------------------------------------------
   *   List
   * ------------------------------------------------------------------ */

  function relTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    const diff = Date.now() - n;
    const min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} d ago`;
    try {
      return new Date(n).toLocaleDateString();
    } catch (error) {
      return "";
    }
  }

  function makeListItem(note) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "notesItem";
    item.setAttribute("role", "listitem");
    item.dataset.noteId = note.id;
    if (note.pinned) item.classList.add("pinned");

    const head = document.createElement("div");
    head.className = "notesItemHead";

    const title = document.createElement("span");
    title.className = "notesItemTitle";
    title.textContent = NotesStore.titleFor(note);
    head.appendChild(title);

    if (note.pinned) {
      const pin = document.createElement("span");
      pin.className = "notesItemPin";
      pin.setAttribute("aria-label", "Pinned");
      pin.textContent = "📌";
      head.appendChild(pin);
    }
    item.appendChild(head);

    const preview = NotesStore.previewOf(note.body);
    if (preview) {
      const previewEl = document.createElement("span");
      previewEl.className = "notesItemPreview";
      previewEl.textContent = preview;
      item.appendChild(previewEl);
    }

    const meta = relTime(note.updatedAt);
    if (meta) {
      const metaEl = document.createElement("span");
      metaEl.className = "notesItemMeta";
      metaEl.textContent = `Updated ${meta}`;
      item.appendChild(metaEl);
    }

    item.addEventListener("click", () => openNote(note.id));
    return item;
  }

  function renderList() {
    if (!listEl) return;
    return store
      .getAll()
      .then((notes) => {
        listEl.replaceChildren();
        notes.forEach((note) => listEl.appendChild(makeListItem(note)));
        if (listEmpty) listEmpty.hidden = notes.length > 0;
        listEl.hidden = notes.length === 0;
      })
      .catch(() => {
        if (listEmpty) {
          listEmpty.hidden = false;
          listEmpty.textContent = "Notes couldn't be loaded on this device.";
        }
      });
  }

  /* --------------------------------------------------------------------
   *   Editor + autosave
   * ------------------------------------------------------------------ */

  function setSaveState(text) {
    if (saveState) saveState.textContent = text || "";
  }

  function openNote(id) {
    return store.get(id).then((note) => {
      if (!note) {
        renderList();
        return;
      }
      currentId = note.id;
      currentNote = note;
      if (titleInput) titleInput.value = note.title;
      if (bodyInput) bodyInput.value = note.body;
      reflectPin(note.pinned);
      setSaveState("Saved on this device");
      if (editorMenu) editorMenu.open = false;
      showEditor();
      // A brand-new (empty) note lands on the title; an existing one on the
      // body so the operator can keep writing.
      const target = note.title || note.body ? bodyInput : titleInput;
      if (target) requestAnimationFrame(() => target.focus());
    });
  }

  function scheduleSave() {
    if (!currentId) return;
    savePending = true;
    setSaveState("Saving…");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(), AUTOSAVE_DELAY);
  }

  function flushSave(options) {
    const immediate = options && options.immediate;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    if (!currentId || !savePending) {
      if (immediate) savePending = false;
      return Promise.resolve();
    }
    savePending = false;
    const id = currentId;
    const patch = {
      title: titleInput ? titleInput.value : "",
      body: bodyInput ? bodyInput.value : ""
    };
    return store
      .update(id, patch)
      .then((saved) => {
        if (saved && saved.id === currentId) currentNote = saved;
        if (!savePending) setSaveState("Saved on this device");
      })
      .catch(() => setSaveState("Not saved - storage error"));
  }

  function reflectPin(pinned) {
    if (!pinBtn) return;
    pinBtn.setAttribute("aria-pressed", String(!!pinned));
    pinBtn.setAttribute("aria-label", pinned ? "Unpin note" : "Pin note");
    pinBtn.title = pinned ? "Unpin note" : "Pin note";
    pinBtn.classList.toggle("active", !!pinned);
  }

  function togglePin() {
    if (!currentId || !currentNote) return;
    const next = !currentNote.pinned;
    reflectPin(next);
    store
      .update(currentId, { pinned: next })
      .then((saved) => {
        if (saved) currentNote = saved;
      })
      .catch(() => reflectPin(!next));
  }

  function deleteCurrent() {
    if (!currentId) return;
    if (!window.confirm("Delete this note? This can't be undone.")) return;
    const id = currentId;
    savePending = false;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    store
      .remove(id)
      .then(() => showList())
      .catch(() => setSaveState("Couldn't delete on this device"));
  }

  /* --------------------------------------------------------------------
   *   Lightweight Markdown formatting toolbar
   * ------------------------------------------------------------------ */

  // Replace a range of the textarea, keeping the browser's native undo
  // stack when the platform supports execCommand("insertText"); otherwise
  // fall back to setRangeText + an input event so autosave still fires.
  function replaceRange(el, start, end, text, selStart, selEnd) {
    el.focus();
    el.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (error) {
      ok = false;
    }
    if (!ok) {
      el.setRangeText(text, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const s = typeof selStart === "number" ? selStart : start + text.length;
    const e = typeof selEnd === "number" ? selEnd : s;
    el.setSelectionRange(s, e);
  }

  function wrapSelection(el, marker) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const selected = value.slice(start, end);
    const before = value.slice(Math.max(0, start - marker.length), start);
    const after = value.slice(end, end + marker.length);
    if (before === marker && after === marker) {
      // Toggle off: drop the surrounding markers.
      replaceRange(el, start - marker.length, end + marker.length, selected, start - marker.length, end - marker.length);
      return;
    }
    const inner = selected || "text";
    replaceRange(el, start, end, marker + inner + marker, start + marker.length, start + marker.length + inner.length);
  }

  function toggleLinePrefix(el, kind) {
    const value = el.value;
    let lineStart = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    let lineEnd = value.indexOf("\n", el.selectionEnd);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");

    const prefixRe = {
      bullet: /^(\s*)[-*+] (?!\[[ xX]\] )/,
      check: /^(\s*)[-*+] \[[ xX]\] /,
      number: /^(\s*)\d+\. /,
      heading: /^(\s*)#{1,6} /
    }[kind];

    const allPrefixed = lines.every((line) => line.trim() === "" || prefixRe.test(line));
    let n = 0;
    const next = lines
      .map((line) => {
        if (line.trim() === "") return line;
        if (allPrefixed) return line.replace(prefixRe, "$1");
        const stripped = line
          .replace(/^(\s*)[-*+] \[[ xX]\] /, "$1")
          .replace(/^(\s*)[-*+] /, "$1")
          .replace(/^(\s*)\d+\. /, "$1")
          .replace(/^(\s*)#{1,6} /, "$1");
        const indentMatch = stripped.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : "";
        const rest = stripped.slice(indent.length);
        n += 1;
        if (kind === "bullet") return `${indent}- ${rest}`;
        if (kind === "check") return `${indent}- [ ] ${rest}`;
        if (kind === "number") return `${indent}${n}. ${rest}`;
        return `${indent}# ${rest}`;
      })
      .join("\n");

    replaceRange(el, lineStart, lineEnd, next, lineStart, lineStart + next.length);
  }

  function applyFormat(kind) {
    if (!bodyInput) return;
    if (kind === "undo" || kind === "redo") {
      bodyInput.focus();
      try {
        document.execCommand(kind, false, null);
      } catch (error) {
        /* not supported - native Ctrl/Cmd+Z still works while typing */
      }
      bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (kind === "bold") {
      wrapSelection(bodyInput, "**");
      return;
    }
    toggleLinePrefix(bodyInput, kind);
  }

  /* --------------------------------------------------------------------
   *   Backup: export / import
   * ------------------------------------------------------------------ */

  function setBackupStatus(text, tone) {
    if (!backupStatus) return;
    backupStatus.textContent = text || "";
    backupStatus.dataset.tone = tone || "";
  }

  function runExport() {
    store
      .exportNotes()
      .then((json) => {
        if (exportOutput) {
          exportOutput.value = json;
          exportOutput.hidden = false;
        }
        if (exportCopyBtn) exportCopyBtn.hidden = false;
        setBackupStatus("Copy this text and keep it somewhere safe.", "ok");
        copyExport();
      })
      .catch(() => setBackupStatus("Couldn't read notes for export.", "error"));
  }

  function copyExport() {
    if (!exportOutput || !exportOutput.value) return;
    exportOutput.focus();
    exportOutput.select();
    const done = () => setBackupStatus("Copied to clipboard.", "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(exportOutput.value).then(done).catch(() => {});
    } else {
      try {
        document.execCommand("copy");
        done();
      } catch (error) {
        /* leave the text selected for a manual copy */
      }
    }
  }

  function runImport(text) {
    const payload = (text || "").trim();
    if (!payload) {
      setBackupStatus("Paste exported notes JSON, or choose a file.", "error");
      return;
    }
    store
      .importNotes(payload)
      .then((result) => {
        if (!result.ok) {
          setBackupStatus(result.error || "That file couldn't be imported.", "error");
          return;
        }
        const parts = [`Imported ${result.added}`];
        if (result.renamed) parts.push(`${result.renamed} kept as copies`);
        if (result.skipped) parts.push(`${result.skipped} skipped`);
        setBackupStatus(`${parts.join(", ")}.`, "ok");
        if (importInput) importInput.value = "";
        renderList();
      })
      .catch(() => setBackupStatus("Import failed - your existing notes are unchanged.", "error"));
  }

  /* --------------------------------------------------------------------
   *   Wiring
   * ------------------------------------------------------------------ */

  if (newBtn) {
    newBtn.addEventListener("click", () => {
      store
        .create()
        .then((note) => openNote(note.id))
        .catch(() => setSaveState("Couldn't create a note on this device"));
    });
  }

  if (backBtn) backBtn.addEventListener("click", showList);
  if (pinBtn) pinBtn.addEventListener("click", togglePin);
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (editorMenu) editorMenu.open = false;
      deleteCurrent();
    });
  }

  if (titleInput) titleInput.addEventListener("input", scheduleSave);
  if (bodyInput) bodyInput.addEventListener("input", scheduleSave);
  [titleInput, bodyInput].forEach((el) => {
    if (el) el.addEventListener("blur", () => flushSave({ immediate: true }));
  });

  if (toolbar) {
    toolbar.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-note-format]");
      if (!btn) return;
      event.preventDefault();
      applyFormat(btn.dataset.noteFormat);
    });
  }

  if (exportBtn) exportBtn.addEventListener("click", runExport);
  if (exportCopyBtn) exportCopyBtn.addEventListener("click", copyExport);
  if (importBtn) importBtn.addEventListener("click", () => runImport(importInput ? importInput.value : ""));
  if (importFile) {
    importFile.addEventListener("change", () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        if (importInput) importInput.value = text;
        runImport(text);
        importFile.value = "";
      };
      reader.onerror = () => setBackupStatus("Couldn't read that file.", "error");
      reader.readAsText(file);
    });
  }

  // Flush an in-flight edit if the app is being backgrounded or closed -
  // Android can kill the WebView without another chance to save.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave({ immediate: true });
  });
  window.addEventListener("pagehide", () => flushSave({ immediate: true }));

  // app.js sets body[data-mobile-notes]="list" every time the section is
  // (re-)opened from the nav. Re-read the list then, so a note added and a
  // trip out to Main and back never shows a stale list. The list view is
  // otherwise only rebuilt by its own mutations (create/delete/import/back).
  let lastNotesMode = document.body.dataset.mobileNotes || "";
  new MutationObserver(() => {
    const mode = document.body.dataset.mobileNotes || "";
    if (mode === lastNotesMode) return;
    lastNotesMode = mode;
    if (mode === "list") {
      currentId = null;
      currentNote = null;
      renderList();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["data-mobile-notes"] });

  renderList();
})(typeof globalThis !== "undefined" ? globalThis : this);
