(function (root) {
  "use strict";

  // Mobile-only Notes section. Self-booting like the other *-ui.js modules
  // (loads after app.js). All storage goes through PolynNotesStore, which is
  // its own IndexedDB database - nothing here touches localStorage session
  // state, RT Sync, or workspace state.

  const $ = (id) => document.getElementById(id);
  const NotesStore = root.PolynNotesStore;
  // TipTap experiment globals (see notes-editor-vendor.src.js / notes-markdown.js).
  // Both are optional: if either is missing the editor drops to a read-only
  // fallback rather than breaking RT Notes.
  const RTNotesEditor = root.RTNotesEditor || null;
  const NotesMarkdown = root.PolynNotesMarkdown || null;

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
  const editorMount = $("notesEditorMount");
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
  // TipTap experiment: the live editor instance for the open note, or null.
  // `editorMode` is "rich" while a TipTap instance is mounted, "fallback"
  // when we had to drop to the read-only textarea.
  let editor = null;
  let editorMode = "rich";

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
    destroyEditor();
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

    const preview = NotesStore.previewOf(note.body, undefined, note.bodyFormat);
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
          listEmpty.textContent = "RT Notes couldn't be loaded on this device.";
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
      reflectPin(note.pinned);
      setSaveState("Saved on this device");
      if (editorMenu) editorMenu.open = false;
      showEditor();
      // Mount the editor only once the view is visible so ProseMirror can
      // measure. Opening a legacy Markdown note converts it to HTML for
      // display only - the stored note is not rewritten until the first edit.
      initEditorFor(note);
      // A brand-new (empty) note lands on the title; an existing one in the
      // body so the operator can keep writing.
      const hasContent = note.title || note.body;
      if (!hasContent && titleInput) {
        requestAnimationFrame(() => titleInput.focus());
      } else if (editorMode === "rich" && editor) {
        requestAnimationFrame(() => {
          try {
            editor.commands.focus("end");
          } catch (error) {
            /* focus is best-effort */
          }
        });
      } else if (bodyInput) {
        requestAnimationFrame(() => bodyInput.focus());
      }
    });
  }

  /* --------------------------------------------------------------------
   *   TipTap editor lifecycle (EXPERIMENT - see notes-editor-vendor.src.js)
   * ------------------------------------------------------------------ */

  // The HTML to seed the editor with. HTML notes load as-is; legacy Markdown
  // notes are converted for display only (lazy migration). A conversion
  // failure degrades to escaped paragraphs rather than blocking the note.
  function noteBodyToHtml(note) {
    if (note && note.bodyFormat === "html") return note.body || "";
    const md = (note && note.body) || "";
    if (NotesMarkdown && typeof NotesMarkdown.markdownToHtml === "function") {
      try {
        return NotesMarkdown.markdownToHtml(md);
      } catch (error) {
        /* fall through */
      }
    }
    const escaped = md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    return "<p>" + escaped + "</p>";
  }

  function buildEditor(html) {
    if (!RTNotesEditor || !RTNotesEditor.Editor || !editorMount) {
      throw new Error("RT Notes rich editor is unavailable on this device.");
    }
    const Editor = RTNotesEditor.Editor;
    const StarterKit = RTNotesEditor.StarterKit;
    const TaskList = RTNotesEditor.TaskList;
    const TaskItem = RTNotesEditor.TaskItem;
    return new Editor({
      element: editorMount,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          // Keep the surface to exactly what the RT Notes toolbar produces.
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          code: false
          // history stays enabled -> normal undo/redo
        }),
        TaskList,
        TaskItem.configure({ nested: false })
      ],
      content: html || "",
      editorProps: {
        attributes: {
          class: "notesProse",
          spellcheck: "true",
          "aria-label": "Note body"
        }
      },
      onUpdate: () => {
        scheduleSave();
        refreshToolbarState();
      },
      onSelectionUpdate: refreshToolbarState,
      onBlur: () => flushSave({ immediate: true })
    });
  }

  function initEditorFor(note) {
    destroyEditor();
    const html = noteBodyToHtml(note);
    try {
      editor = buildEditor(html);
      editorMode = "rich";
      if (editorMount) editorMount.hidden = false;
      if (bodyInput) bodyInput.hidden = true;
      if (toolbar) toolbar.hidden = false;
    } catch (error) {
      editor = null;
      editorMode = "fallback";
      enterFallback(note);
    }
    refreshToolbarState();
  }

  // Never leave a note unreadable because the editor failed: show the stored
  // text in the plain textarea, read-only, and say so. No autosave in this
  // mode, so the stored note is never rewritten by a failed editor.
  function enterFallback(note) {
    if (editorMount) {
      editorMount.hidden = true;
      editorMount.replaceChildren();
    }
    if (toolbar) toolbar.hidden = true;
    if (bodyInput) {
      bodyInput.hidden = false;
      bodyInput.readOnly = true;
      bodyInput.value = (note && note.body) || "";
    }
    setSaveState("Rich editor unavailable - showing saved text (read-only)");
  }

  function destroyEditor() {
    if (editor) {
      try {
        editor.destroy();
      } catch (error) {
        /* already torn down */
      }
      editor = null;
    }
    editorMode = "rich";
    if (editorMount) editorMount.replaceChildren();
    if (bodyInput) {
      bodyInput.readOnly = false;
      bodyInput.hidden = true;
      bodyInput.value = "";
    }
  }

  // Read what the editor currently holds, as the pair we persist. Returns
  // null in fallback mode (read-only - nothing to save).
  function currentBody() {
    if (editorMode === "rich" && editor) {
      return { body: editor.getHTML(), bodyFormat: "html" };
    }
    return null;
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
    const content = currentBody();
    const patch = { title: titleInput ? titleInput.value : "" };
    if (content) {
      // First edit of a legacy Markdown note writes HTML + bodyFormat:"html".
      patch.body = content.body;
      patch.bodyFormat = content.bodyFormat;
    }
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
    destroyEditor();
    store
      .remove(id)
      .then(() => showList())
      .catch(() => setSaveState("Couldn't delete on this device"));
  }

  /* --------------------------------------------------------------------
   *   Formatting toolbar -> TipTap commands (EXPERIMENT)
   *
   *   Same seven controls and markup as before; each maps to a TipTap
   *   chained command. Inert (but harmless) in the read-only fallback.
   * ------------------------------------------------------------------ */

  // data-note-format -> [command, isActive-node, isActive-attrs]. undo/redo
  // have no active state.
  const FORMAT_ACTIONS = {
    bold: { run: (c) => c.toggleBold(), active: ["bold"] },
    heading: { run: (c) => c.toggleHeading({ level: 1 }), active: ["heading", { level: 1 }] },
    bullet: { run: (c) => c.toggleBulletList(), active: ["bulletList"] },
    number: { run: (c) => c.toggleOrderedList(), active: ["orderedList"] },
    check: { run: (c) => c.toggleTaskList(), active: ["taskList"] },
    undo: { run: (c) => c.undo() },
    redo: { run: (c) => c.redo() }
  };

  function applyFormat(kind) {
    if (editorMode !== "rich" || !editor) return;
    const action = FORMAT_ACTIONS[kind];
    if (!action) return;
    action.run(editor.chain().focus()).run();
    refreshToolbarState();
  }

  // Reflect the format under the cursor in the toolbar (e.g. Bold looks
  // pressed inside bold text).
  function refreshToolbarState() {
    if (!toolbar) return;
    const isActive = (name, attrs) => editorMode === "rich" && editor && editor.isActive(name, attrs);
    toolbar.querySelectorAll("[data-note-format]").forEach((btn) => {
      const action = FORMAT_ACTIONS[btn.dataset.noteFormat];
      if (!action || !action.active) return;
      const on = !!isActive(action.active[0], action.active[1]);
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
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
      setBackupStatus("Paste exported RT Notes JSON, or choose a file.", "error");
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

  // The title is still a plain input. The body change/blur signals come from
  // the TipTap editor's onUpdate / onBlur (see buildEditor).
  if (titleInput) {
    titleInput.addEventListener("input", scheduleSave);
    titleInput.addEventListener("blur", () => flushSave({ immediate: true }));
  }

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
      destroyEditor();
      currentId = null;
      currentNote = null;
      renderList();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["data-mobile-notes"] });

  renderList();
})(typeof globalThis !== "undefined" ? globalThis : this);
