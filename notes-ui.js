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
  const backupBtn = $("notesBackupBtn");
  const backupDialog = $("notesBackupDialog");
  const backupCloseBtn = $("notesBackupCloseBtn");
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
  const moveBtn = $("notesMoveBtn");
  const toolbar = panel.querySelector(".notesToolbar");

  // Folder UI (mobile-only, device-local). All of this is UI/query state -
  // none of it is persisted outside PolynNotesStore's own IndexedDB.
  const folderBar = $("notesFolderBar");
  const folderDialog = $("notesFolderDialog");
  const folderForm = $("notesFolderForm");
  const folderDialogTitle = $("notesFolderDialogTitle");
  const folderNameField = $("notesFolderNameInput");
  const folderDialogError = $("notesFolderDialogError");
  const folderSubmitBtn = $("notesFolderSubmitBtn");
  const folderCancelBtn = $("notesFolderCancelBtn");
  const folderManageDialog = $("notesFolderManageDialog");
  const folderManageName = $("notesFolderManageName");
  const folderRenameBtn = $("notesFolderRenameBtn");
  const folderDeleteBtn = $("notesFolderDeleteBtn");
  const folderManageCancelBtn = $("notesFolderManageCancelBtn");
  const moveDialog = $("notesMoveDialog");
  const moveList = $("notesMoveList");
  // Per-note-card action menu (Pin/Unpin, Move, Delete) - reachable from the
  // list without opening the editor. Same storage paths as the editor.
  const cardMenu = $("notesCardMenu");
  const cardMenuName = $("notesCardMenuName");
  const cardPinBtn = $("notesCardPinBtn");
  const cardMoveBtn = $("notesCardMoveBtn");
  const cardDeleteBtn = $("notesCardDeleteBtn");
  const cardMenuCancelBtn = $("notesCardMenuCancelBtn");

  const AUTOSAVE_DELAY = 600;

  // Built-in views are query concepts, never folder records in IndexedDB.
  const VIEW_ALL = "all";
  const VIEW_UNFILED = "unfiled";

  const store = NotesStore.isSupported() ? NotesStore.createStore() : null;

  let currentId = null;
  let currentNote = null;
  let saveTimer = 0;
  let savePending = false;

  // Currently selected folder view: VIEW_ALL, VIEW_UNFILED, or a folder id.
  // Local UI state only - deliberately not synced, not in any snapshot, and
  // reset to All Notes whenever the section is (re-)opened.
  let currentView = VIEW_ALL;
  let folders = [];
  // Folder-dialog context: "create" | "rename", plus the target id on rename.
  let folderDialogMode = "create";
  let folderDialogTargetId = null;
  let manageTargetId = null;
  // Card-menu target: the note whose "…" was tapped in the list, plus the
  // button element so its aria-expanded can be reset on close.
  let cardMenuNote = null;
  let cardMenuBtnEl = null;
  // Move dialog context. Editor moves keep you in the editor; list moves
  // re-render the filtered list. Both call store.moveNoteToFolder().
  let moveContext = null;
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
    if (backupBtn) backupBtn.disabled = true;
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
    currentView = VIEW_ALL;
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
    // Row wrapper = the tappable card button + a sibling action cluster. The
    // "…" button is never nested inside the card button.
    const row = document.createElement("div");
    row.className = "notesItemRow";
    row.setAttribute("role", "listitem");
    row.dataset.noteId = note.id;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "notesItem";
    if (note.pinned) item.classList.add("pinned");

    const head = document.createElement("div");
    head.className = "notesItemHead";

    const title = document.createElement("span");
    title.className = "notesItemTitle";
    title.textContent = NotesStore.titleFor(note);
    head.appendChild(title);
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
    row.appendChild(item);

    // Right-side action cluster: pin indicator (only when pinned - no empty
    // slot otherwise) then the "…" overflow. Sits above the card, not in it.
    const actions = document.createElement("div");
    actions.className = "notesItemActions";

    if (note.pinned) {
      const pin = document.createElement("span");
      pin.className = "notesItemPin";
      pin.setAttribute("role", "img");
      pin.setAttribute("aria-label", "Pinned");
      // Cloned (never innerHTML) from the editor's pin glyph so the marker is
      // the app's line-icon.
      const glyph = pinBtn && pinBtn.querySelector("svg");
      if (glyph) pin.appendChild(glyph.cloneNode(true));
      actions.appendChild(pin);
    }

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "notesItemMenuBtn";
    menuBtn.setAttribute("aria-haspopup", "dialog");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-label", "Note actions");
    menuBtn.title = "Note actions";
    // Cloned from the editor overflow "…" glyph.
    const menuGlyph = editorMenu && editorMenu.querySelector("summary svg");
    if (menuGlyph) menuBtn.appendChild(menuGlyph.cloneNode(true));
    else menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      // Belt-and-braces: the card button is a sibling, so a click here does
      // not reach it, but stop propagation anyway per the interaction spec.
      event.stopPropagation();
      openCardMenu(note, menuBtn);
    });
    actions.appendChild(menuBtn);

    row.appendChild(actions);
    return row;
  }

  function isFolderView() {
    return currentView !== VIEW_ALL && currentView !== VIEW_UNFILED;
  }

  function folderById(id) {
    return folders.find((folder) => folder.id === id) || null;
  }

  // The one filtering rule. Note ordering is whatever store.getAll() already
  // produced (pinned first, then most-recently-updated) - never re-sorted per
  // folder, and there is no per-folder pin state.
  function filterNotes(notes, view) {
    if (view === VIEW_ALL) return notes;
    if (view === VIEW_UNFILED) return notes.filter((note) => (note.folderId || null) === null);
    return notes.filter((note) => note.folderId === view);
  }

  function emptyStateText() {
    if (currentView === VIEW_ALL) return "No notes yet. Tap New note to start one.";
    if (currentView === VIEW_UNFILED) return "No unfiled notes.";
    const folder = folderById(currentView);
    return folder ? `No notes in ${folder.name} yet. Tap New note to add one.` : "No notes here.";
  }

  function makeChip(label, view, count) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "notesFolderChip";
    chip.dataset.view = view;
    chip.setAttribute("role", "tab");
    const on = currentView === view;
    chip.classList.toggle("is-active", on);
    chip.setAttribute("aria-selected", String(on));
    const name = document.createElement("span");
    name.className = "notesFolderChipName";
    name.textContent = label;
    chip.appendChild(name);
    if (typeof count === "number") {
      const badge = document.createElement("span");
      badge.className = "notesFolderCount";
      badge.textContent = String(count);
      chip.appendChild(badge);
    }
    chip.addEventListener("click", () => selectView(view));
    return chip;
  }

  function renderFolderBar(notes) {
    if (!folderBar) return;
    folderBar.replaceChildren();
    folderBar.appendChild(makeChip("All Notes", VIEW_ALL, notes.length));
    folderBar.appendChild(
      makeChip("Unfiled", VIEW_UNFILED, filterNotes(notes, VIEW_UNFILED).length)
    );
    folders.forEach((folder) => {
      const chip = makeChip(folder.name, folder.id, filterNotes(notes, folder.id).length);
      chip.classList.add("notesFolderChipUser");
      // Rename/Delete without a control on every chip: long-press or
      // right-click the chip, or use the manage button shown for the
      // active folder.
      chip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openFolderManage(folder);
      });
      attachLongPress(chip, () => openFolderManage(folder));
      folderBar.appendChild(chip);
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "notesFolderChip notesFolderAdd";
    add.id = "notesFolderAddBtn";
    add.setAttribute("aria-label", "New folder");
    add.textContent = "+ Folder";
    add.addEventListener("click", () => openFolderDialog("create"));
    folderBar.appendChild(add);

    if (isFolderView()) {
      const folder = folderById(currentView);
      if (folder) {
        const manage = document.createElement("button");
        manage.type = "button";
        manage.className = "notesFolderManage";
        manage.id = "notesFolderManageBtn";
        manage.setAttribute("aria-label", `Manage folder ${folder.name}`);
        manage.title = `Manage “${folder.name}”`;
        manage.textContent = "⋯"; // horizontal ellipsis glyph
        manage.addEventListener("click", () => openFolderManage(folder));
        folderBar.appendChild(manage);
      }
    }
  }

  // Best-effort long-press (~500ms) for touch. Purely additive - the manage
  // button and context menu cover devices where this never fires.
  function attachLongPress(el, handler) {
    let timer = 0;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    };
    el.addEventListener("pointerdown", () => {
      clear();
      timer = setTimeout(() => {
        timer = 0;
        handler();
      }, 500);
    });
    ["pointerup", "pointerleave", "pointercancel", "pointermove"].forEach((type) =>
      el.addEventListener(type, clear)
    );
  }

  function selectView(view) {
    if (currentView === view) return;
    currentView = view;
    renderList();
  }

  function renderList() {
    if (!listEl) return;
    return Promise.all([store.getAll(), store.getFolders()])
      .then(([notes, folderList]) => {
        folders = folderList || [];
        // A folder selected here but since deleted elsewhere -> fall back.
        if (isFolderView() && !folderById(currentView)) currentView = VIEW_ALL;
        renderFolderBar(notes);
        const visible = filterNotes(notes, currentView);
        listEl.replaceChildren();
        visible.forEach((note) => listEl.appendChild(makeListItem(note)));
        if (listEmpty) {
          listEmpty.hidden = visible.length > 0;
          if (!visible.length) listEmpty.textContent = emptyStateText();
        }
        listEl.hidden = visible.length === 0;
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

  // One wording for "delete note", used from the editor menu and the list
  // card menu. A note with a usable title names it; a blank note gets the
  // generic fallback.
  function noteDeleteMessage(note) {
    const label = note ? NotesStore.titleFor(note) : "";
    return label && label !== "Untitled note"
      ? `Delete “${label}”? This permanently removes the note from this device.`
      : "Delete this note? This permanently removes it from this device.";
  }

  function deleteCurrent() {
    if (!currentId) return;
    if (!window.confirm(noteDeleteMessage(currentNote))) return;
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

  // Backup is a modal overlay now, not an inline expansion - opening it must
  // not shift the folder bar or note list, change the selected folder, or add
  // a nav state. Android Back / Esc / the Close button all dismiss it.
  function openBackupDialog() {
    if (!backupDialog || !backupDialog.showModal) return;
    setBackupStatus("");
    try {
      backupDialog.showModal();
    } catch (error) {
      /* already open */
    }
  }

  function closeBackupDialog() {
    try {
      backupDialog.close();
    } catch (error) {
      /* already closed */
    }
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
        if (result.foldersAdded) parts.push(`${result.foldersAdded} folders`);
        if (result.renamed) parts.push(`${result.renamed} kept as copies`);
        if (result.skipped) parts.push(`${result.skipped} skipped`);
        setBackupStatus(`${parts.join(", ")}.`, "ok");
        if (importInput) importInput.value = "";
        renderList();
      })
      .catch(() => setBackupStatus("Import failed - your existing notes are unchanged.", "error"));
  }

  /* --------------------------------------------------------------------
   *   Folders: create / rename / delete / move note
   *
   *   Every mutation goes through PolynNotesStore (its serialized write
   *   chain), so a folder change can't race a note autosave or a pin.
   * ------------------------------------------------------------------ */

  function openFolderDialog(mode, folder) {
    folderDialogMode = mode === "rename" ? "rename" : "create";
    folderDialogTargetId = folder && folder.id ? folder.id : null;
    if (folderDialogTitle) {
      folderDialogTitle.textContent = folderDialogMode === "rename" ? "Rename folder" : "New folder";
    }
    if (folderSubmitBtn) {
      folderSubmitBtn.textContent = folderDialogMode === "rename" ? "Save" : "Create";
    }
    if (folderDialogError) folderDialogError.textContent = "";
    if (folderNameField) {
      folderNameField.value = folderDialogMode === "rename" && folder ? folder.name : "";
    }
    if (folderDialog && folderDialog.showModal) {
      try {
        folderDialog.showModal();
      } catch (error) {
        return;
      }
      // The user has intentionally entered the naming flow, so focusing the
      // field (and letting the keyboard open) is expected here.
      requestAnimationFrame(() => {
        try {
          folderNameField.focus();
        } catch (error) {
          /* focus is best-effort */
        }
      });
    }
  }

  function submitFolderDialog(event) {
    if (event) event.preventDefault();
    if (!folderNameField) return;
    const name = folderNameField.value;
    const op =
      folderDialogMode === "rename"
        ? store.renameFolder(folderDialogTargetId, name)
        : store.createFolder(name);
    op
      .then((folder) => {
        try {
          folderDialog.close();
        } catch (error) {
          /* already closed */
        }
        // Select the new (or just-renamed) folder automatically.
        if (folder && folder.id) currentView = folder.id;
        renderList();
      })
      .catch((error) => {
        if (folderDialogError) {
          folderDialogError.textContent =
            (error && error.message) || "That folder name couldn't be saved.";
        }
      });
  }

  function openFolderManage(folder) {
    if (!folder || !folderManageDialog || !folderManageDialog.showModal) return;
    manageTargetId = folder.id;
    if (folderManageName) folderManageName.textContent = folder.name;
    try {
      folderManageDialog.showModal();
    } catch (error) {
      /* already open */
    }
  }

  function closeFolderManage() {
    try {
      folderManageDialog.close();
    } catch (error) {
      /* already closed */
    }
  }

  function confirmDeleteFolder(folder) {
    if (!folder) return;
    const message = `Delete “${folder.name}”? Notes in this folder will be moved to Unfiled.`;
    if (!window.confirm(message)) return;
    store
      .deleteFolder(folder.id)
      .then(() => {
        // Land on Unfiled so the retained notes are visible right away.
        if (currentView === folder.id) currentView = VIEW_UNFILED;
        renderList();
      })
      .catch(() => {
        renderList();
      });
  }

  // `context`: { noteId, folderId, fromList }. Editor calls it with no arg
  // (defaults to the open note); the list card menu passes an explicit note
  // and fromList:true. Either way the same folder picker and the same
  // store.moveNoteToFolder() path are used - no duplicated storage logic.
  function openMoveDialog(context) {
    const ctx =
      context && context.noteId
        ? context
        : currentNote
        ? { noteId: currentId, folderId: currentNote.folderId || null, fromList: false }
        : null;
    if (!ctx || !moveDialog || !moveDialog.showModal || !moveList) return;
    moveContext = ctx;
    store
      .getFolders()
      .then((list) => {
        moveList.replaceChildren();
        const current = moveContext.folderId || null;
        const addOption = (label, value) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "notesMoveOption";
          btn.dataset.folderId = value == null ? "" : value;
          btn.textContent = label;
          if ((value || null) === current) btn.classList.add("is-current");
          btn.addEventListener("click", () => chooseMoveTarget(value));
          moveList.appendChild(btn);
        };
        // "All Notes" is a view, not a destination - deliberately omitted.
        addOption("Unfiled", null);
        (list || []).forEach((folder) => addOption(folder.name, folder.id));
        try {
          moveDialog.showModal();
        } catch (error) {
          /* already open */
        }
      })
      .catch(() => {});
  }

  function closeMoveDialog() {
    try {
      moveDialog.close();
    } catch (error) {
      /* already closed */
    }
  }

  function chooseMoveTarget(folderId) {
    const ctx = moveContext;
    if (!ctx || !ctx.noteId) return;
    const id = ctx.noteId;
    store
      .moveNoteToFolder(id, folderId)
      .then((saved) => {
        if (saved && saved.id === currentId) currentNote = saved;
        closeMoveDialog();
        if (ctx.fromList) {
          // Refresh counts and drop the note from the current filtered folder
          // if it no longer belongs. Never navigates into the editor.
          renderList();
        }
        // Editor move: stay put; the filtered list catches up on the way back.
      })
      .catch(() => {
        closeMoveDialog();
      });
  }

  /* --------------------------------------------------------------------
   *   Note-card action menu (list) - Pin/Unpin, Move, Delete
   *
   *   Reuses the editor's storage paths exactly: store.update({pinned}),
   *   store.moveNoteToFolder(), store.remove(). Nothing here navigates into
   *   the editor, and the active folder/filter (currentView) is preserved by
   *   going through renderList().
   * ------------------------------------------------------------------ */

  function openCardMenu(note, btnEl) {
    if (!note || !cardMenu || !cardMenu.showModal) return;
    cardMenuNote = note;
    cardMenuBtnEl = btnEl || null;
    if (cardMenuBtnEl) cardMenuBtnEl.setAttribute("aria-expanded", "true");
    if (cardMenuName) cardMenuName.textContent = NotesStore.titleFor(note);
    if (cardPinBtn) cardPinBtn.textContent = note.pinned ? "Unpin note" : "Pin note";
    try {
      cardMenu.showModal();
    } catch (error) {
      /* already open */
    }
  }

  function closeCardMenu() {
    if (cardMenuBtnEl) cardMenuBtnEl.setAttribute("aria-expanded", "false");
    cardMenuBtnEl = null;
    try {
      cardMenu.close();
    } catch (error) {
      /* already closed */
    }
  }

  function togglePinFromCard(note) {
    if (!note) return;
    const next = !note.pinned;
    store
      .update(note.id, { pinned: next })
      .then(() => renderList())
      .catch(() => {});
  }

  function deleteNoteFromCard(note) {
    if (!note) return;
    if (!window.confirm(noteDeleteMessage(note))) return;
    if (currentId === note.id) {
      currentId = null;
      currentNote = null;
    }
    store
      .remove(note.id)
      .then(() => renderList())
      .catch(() => {});
  }

  /* --------------------------------------------------------------------
   *   Wiring
   * ------------------------------------------------------------------ */

  if (newBtn) {
    newBtn.addEventListener("click", () => {
      // In a user folder -> create the note there. In All Notes or Unfiled ->
      // create it Unfiled (folderId: null).
      const seed = isFolderView() ? { folderId: currentView } : {};
      store
        .create(seed)
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

  if (moveBtn) {
    moveBtn.addEventListener("click", () => {
      if (editorMenu) editorMenu.open = false;
      openMoveDialog();
    });
  }

  // Note-card "…" menu. Each action dismisses the menu first, then (next
  // tick, so the modal is fully gone) runs against the stored note. Same
  // storage paths as the editor menu; none of them navigate anywhere.
  if (cardMenuCancelBtn) cardMenuCancelBtn.addEventListener("click", closeCardMenu);
  if (cardPinBtn) {
    cardPinBtn.addEventListener("click", () => {
      const note = cardMenuNote;
      closeCardMenu();
      if (note) setTimeout(() => togglePinFromCard(note), 0);
    });
  }
  if (cardMoveBtn) {
    cardMoveBtn.addEventListener("click", () => {
      const note = cardMenuNote;
      closeCardMenu();
      if (note) {
        setTimeout(
          () =>
            openMoveDialog({ noteId: note.id, folderId: note.folderId || null, fromList: true }),
          0
        );
      }
    });
  }
  if (cardDeleteBtn) {
    cardDeleteBtn.addEventListener("click", () => {
      const note = cardMenuNote;
      closeCardMenu();
      if (note) setTimeout(() => deleteNoteFromCard(note), 0);
    });
  }

  if (backupBtn) backupBtn.addEventListener("click", openBackupDialog);
  if (backupCloseBtn) backupCloseBtn.addEventListener("click", closeBackupDialog);

  if (folderForm) folderForm.addEventListener("submit", submitFolderDialog);
  if (folderCancelBtn) {
    folderCancelBtn.addEventListener("click", () => {
      try {
        folderDialog.close();
      } catch (error) {
        /* already closed */
      }
    });
  }
  // Explicit button handlers rather than a <form method="dialog"> + `close`
  // event: the dialog `close` event is unreliable in some WebViews. Each
  // action closes the manage dialog, then (on the next tick, so the modal is
  // fully dismissed first) opens the rename dialog or the delete confirm.
  if (folderRenameBtn) {
    folderRenameBtn.addEventListener("click", () => {
      const folder = folderById(manageTargetId);
      manageTargetId = null;
      closeFolderManage();
      if (folder) setTimeout(() => openFolderDialog("rename", folder), 0);
    });
  }
  if (folderDeleteBtn) {
    folderDeleteBtn.addEventListener("click", () => {
      const folder = folderById(manageTargetId);
      manageTargetId = null;
      closeFolderManage();
      if (folder) setTimeout(() => confirmDeleteFolder(folder), 0);
    });
  }
  if (folderManageCancelBtn) {
    folderManageCancelBtn.addEventListener("click", () => {
      manageTargetId = null;
      closeFolderManage();
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
      // Re-opening the section (or leaving the editor) resets to All Notes -
      // the selected folder is never persisted.
      currentView = VIEW_ALL;
      renderList();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["data-mobile-notes"] });

  renderList();
})(typeof globalThis !== "undefined" ? globalThis : this);
