"use strict";

// Notes is a mobile-only section wired into the existing workspace nav,
// mobile section navigation and Android Back handler. These checks pin the
// integration points and, above all, that Notes never leaks into the app's
// serialized state or RT Sync.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const activeJob = fs.readFileSync("active-job.js", "utf8");
const ui = fs.readFileSync("notes-ui.js", "utf8");

/* ----------------------------------------------------------------------
 *   Menu entry - present on mobile, absent on desktop
 * -------------------------------------------------------------------- */

test("Notes sits in the Workspace & support menu, directly below RT Sync", () => {
  const lineSync = html.indexOf('id="workspaceNavLineSync"');
  const notes = html.indexOf('id="workspaceNavNotes"');
  const tools = html.indexOf('id="workspaceNavTools"');
  assert.ok(lineSync !== -1 && notes !== -1 && tools !== -1);
  assert.ok(lineSync < notes && notes < tools, "order is RT Sync -> Notes -> Tools");
  assert.match(html, /id="workspaceNavNotes"[^>]*class="[^"]*workspaceNavExtra|class="workspaceNavButton workspaceNavExtra" id="workspaceNavNotes"/);
  assert.match(html, /id="workspaceNavNotes"[^>]*data-workspace-target="notesBlock"/);
  // The disclosure button names it in aria-controls too.
  assert.match(html, /aria-controls="workspaceNavLineSync workspaceNavNotes workspaceNavTools/);
});

test("the feature is branded 'RT Notes' in every visible label (internal ids stay 'notes')", () => {
  // Menu entry, section header, and editor back breadcrumb all read "RT Notes".
  assert.match(html, /<\/svg>RT Notes<\/span>\s*<small>On this device<\/small>/);
  assert.match(html, /<div class="layerTitle" role="heading" aria-level="1">RT Notes<\/div>/);
  assert.match(html, /id="notesBackBtn"[^>]*aria-label="Back to RT Notes"[^>]*title="Back to RT Notes"[\s\S]*?<span>RT Notes<\/span>/);
  // Backup / export / import carry the feature name.
  assert.match(html, /id="notesExportBtn"[^>]*>Export RT Notes</);
  assert.match(html, /id="notesImportBtn"[^>]*>Import RT Notes</);
  assert.match(html, /class="notesBackupIntro">RT Notes live only in this app/);
  assert.match(html, /id="notesDeviceHint"[^>]*>RT Notes are stored on this device only/);
  assert.match(html, /id="notesUnavailable"[^>]*>RT Notes need on-device storage/);
  // Changelog refers to it by the branded name.
  assert.match(html, /<h3>\(v1\.1\.21\)[^<]*- RT Notes<\/h3>/);
  assert.match(html, /New <strong>RT Notes<\/strong> section on mobile/);
  // Internals are untouched: module globals, ids, db name, store name.
  const store = fs.readFileSync("notes-store.js", "utf8");
  assert.match(store, /root\.PolynNotesStore = api/);
  assert.match(store, /const DB_NAME = "resin\.tools\.notes"/);
  assert.match(store, /const STORE_NAME = "notes"/);
  assert.match(ui, /root\.PolynNotesStore/);
  assert.match(html, /id="notesBlock"/);
  assert.match(html, /id="workspaceNavNotes"/);
});

test("the collapsed Workspace & support bar previews Notes in its icon cluster", () => {
  const cluster = html.slice(html.indexOf('class="mobileWorkspaceNavMoreIcons"'), html.indexOf("</span>", html.indexOf('class="mobileWorkspaceNavMoreIcons"')));
  // Cluster paint order is reverse nav order, so Notes sits between Tools and RT Sync.
  assert.ok(
    cluster.indexOf("moreIconTools") < cluster.indexOf("moreIconNotes") &&
    cluster.indexOf("moreIconNotes") < cluster.indexOf("moreIconRt"),
    "Notes glyph sits between Tools and RT Sync in the cluster"
  );
  // Each cluster glyph carries a hand-synced tint (see the comment in styles.css).
  assert.match(styles, /\.mobileWorkspaceNavMoreIcons \.moreIconNotes\{ --tint:var\(--muted\); \}/);
});

test("the Notes panel is a workspacePanel but is not a desktop-restorable section", () => {
  assert.match(html, /<details class="block card workspacePanel notesPanel" id="notesBlock">/);
  // Deliberately NOT in DETAILS_IDS: that list drives blocksOpen serialization
  // and loadWorkspacePreference. Notes must be in neither.
  const detailsIds = app.slice(app.indexOf("const DETAILS_IDS = ["), app.indexOf("]", app.indexOf("const DETAILS_IDS = [")));
  assert.doesNotMatch(detailsIds, /notesBlock/);
});

test("Notes is hidden in the desktop shell - nav entry and panel both", () => {
  const desktopBlock = styles.slice(
    styles.indexOf("@media (min-width: 901px) and (pointer: fine){"),
    styles.indexOf("@media (width <= 900px)")
  );
  assert.match(desktopBlock, /#workspaceNavNotes,\s*\n?\s*#notesBlock\{ display: none !important; \}/);
});

/* ----------------------------------------------------------------------
 *   Never enters serialized app / workspace / RT Sync state
 * -------------------------------------------------------------------- */

test("no note state is written into the localStorage session payload", () => {
  const snapshot = app.slice(app.indexOf("function snapshotPayload("), app.indexOf("function applySharedActiveJob("));
  assert.doesNotMatch(snapshot, /note|Note/);
  // blocksOpen only ever iterates DETAILS_IDS, which excludes notesBlock.
  assert.match(snapshot, /DETAILS_IDS\.forEach\(id=>\{/);
});

test("no note state is part of a shared active job", () => {
  assert.doesNotMatch(activeJob, /note|Note/, "active-job.js field list stays free of notes");
  const shared = app.slice(app.indexOf("function applySharedActiveJob("), app.indexOf("blocksOpen: snapshotPayload().blocksOpen"));
  assert.doesNotMatch(shared, /note|Note/);
});

test("the notes database is its own IndexedDB store, not localStorage or sync-storage", () => {
  const store = fs.readFileSync("notes-store.js", "utf8");
  assert.match(store, /indexedDB/);
  assert.match(store, /"resin\.tools\.notes"/);
  assert.doesNotMatch(store, /localStorage\s*[.[]/, "no localStorage access");
  assert.doesNotMatch(store, /PolynSyncStorage|PolynStorage/);
  assert.doesNotMatch(ui, /localStorage\s*[.[]|PolynSyncStorage/);
});

test("folders are a second object store on the same private database, still fully isolated", () => {
  const store = fs.readFileSync("notes-store.js", "utf8");
  assert.match(store, /const FOLDER_STORE_NAME = "folders"/);
  assert.match(store, /const SCHEMA_VERSION = 2/);
  // Created in its own layered upgrade block; notes are not bulk-rewritten.
  assert.match(store, /if \(from < 2\) \{[\s\S]*?createObjectStore\(FOLDER_STORE_NAME, \{ keyPath: "id" \}\)/);
  // No new external coupling: still only IndexedDB, no sync-storage module.
  assert.doesNotMatch(store, /PolynSyncStorage|PolynStorage|createClient|fetch\(/);
});

test("no folder or folder-view state enters the session payload or a shared active job", () => {
  const snapshot = app.slice(app.indexOf("function snapshotPayload("), app.indexOf("function applySharedActiveJob("));
  assert.doesNotMatch(snapshot, /folder|Folder/);
  assert.doesNotMatch(activeJob, /folder|Folder/, "active-job.js field list stays free of folders");
  const shared = app.slice(app.indexOf("function applySharedActiveJob("), app.indexOf("blocksOpen: snapshotPayload().blocksOpen"));
  assert.doesNotMatch(shared, /folder|Folder/);
});

test("app.js carries no knowledge of Notes folders - folder logic lives only in notes-ui.js", () => {
  assert.doesNotMatch(app, /notesFolder|moveNoteToFolder|createFolder|folderId/);
});

test("the selected folder view is never persisted or synced (local UI state only)", () => {
  assert.match(ui, /let currentView = VIEW_ALL;/);
  assert.doesNotMatch(ui, /currentView[\s\S]{0,40}localStorage/);
  // Changing folders just re-renders; it never touches navigation / history.
  assert.doesNotMatch(ui, /function selectView[\s\S]{0,160}(history\.|pushState|dataset\.mobileNotes)/);
});

/* ----------------------------------------------------------------------
 *   Mobile section navigation + Android Back
 * -------------------------------------------------------------------- */

test("entering Notes always starts on the list (like Tools always opens its home)", () => {
  assert.match(app, /if \(id === "notesBlock"\) document\.body\.dataset\.mobileNotes = "list";/);
});

test("Android Back goes Notes editor -> Notes list before falling through to Main", () => {
  const body = app.slice(app.indexOf("function handleAndroidBack()"), app.indexOf("window.handleAndroidBack = handleAndroidBack;"));
  const notesBranch = body.indexOf('activeWorkspaceId === "notesBlock" && document.body.dataset.mobileNotes === "editor"');
  const home = body.indexOf("showMobileWorkspaceHome();");
  assert.ok(notesBranch !== -1, "expected a Notes-editor branch in handleAndroidBack");
  assert.ok(notesBranch < home, "it must run before the section -> Main fallback");
  assert.match(body, /\$\("notesBackBtn"\)\?\.click\(\);/);
});

test("the editor Back button and the list Back share one handler", () => {
  assert.match(ui, /backBtn\.addEventListener\("click", showList\)/);
  assert.match(ui, /document\.body\.dataset\.mobileNotes = "editor"/);
  assert.match(ui, /document\.body\.dataset\.mobileNotes = "list"/);
  // The list/editor swap is CSS off body[data-mobile-notes], mirroring Tools.
  assert.match(styles, /body\[data-mobile-notes="editor"\] #notesBlock \.notesListView\{ display:none; \}/);
  assert.match(styles, /body\[data-mobile-notes="editor"\] #notesBlock > summary\{ display:none; \}/);
});

test("Notes navigation never persists as the restored workspace panel", () => {
  assert.match(app, /button\.id !== "workspaceNavNotes"/);
  assert.match(app, /setWorkspacePanel\(panel\.id, \{ reveal: false, persist: panel\.id !== "notesBlock" \}\)/);
});

/* ----------------------------------------------------------------------
 *   Autosave
 * -------------------------------------------------------------------- */

test("edits autosave on a short debounce - no Save button", () => {
  assert.match(ui, /AUTOSAVE_DELAY = 600/);
  assert.match(ui, /titleInput\.addEventListener\("input", scheduleSave\)/);
  // The body change signal now comes from the TipTap editor's update event.
  assert.match(ui, /onUpdate: \(\) => \{\s*scheduleSave\(\);/);
  assert.match(ui, /saveTimer = setTimeout\(\(\) => flushSave\(\), AUTOSAVE_DELAY\)/);
  // Subtle state feedback, both phrases from the brief.
  assert.match(ui, /setSaveState\("Saving…"\)/);
  assert.match(ui, /setSaveState\("Saved on this device"\)/);
  // No explicit Save/Apply control in the editor markup.
  const editor = html.slice(html.indexOf('id="notesEditorView"'), html.indexOf("</details>", html.indexOf('id="notesEditorView"')));
  assert.doesNotMatch(editor, />\s*(Save|Apply)\s*</);
});

test("an in-flight edit is flushed on blur and when the app is backgrounded", () => {
  assert.match(ui, /addEventListener\("blur", \(\) => flushSave\(\{ immediate: true \}\)\)/);
  assert.match(ui, /visibilitychange/);
  assert.match(ui, /pagehide/);
});

test("switching an unrelated field cannot wipe a note - saves go only through the store", () => {
  assert.match(ui, /store\s*\n?\s*\.update\(id, patch\)/);
  assert.doesNotMatch(ui, /innerHTML\s*=/);
});

/* ----------------------------------------------------------------------
 *   Formatting - TipTap rich editor (EXPERIMENT), compact toolbar
 * -------------------------------------------------------------------- */

test("the toolbar offers exactly Bold / Heading / Bullet / Number / Check / Undo / Redo", () => {
  const toolbar = html.slice(html.indexOf('class="notesToolbar"'), html.indexOf("</div>", html.indexOf('class="notesToolbar"')));
  for (const kind of ["bold", "heading", "bullet", "number", "check", "undo", "redo"]) {
    assert.match(toolbar, new RegExp(`data-note-format="${kind}"`));
  }
  // Explicitly none of the heavy controls.
  assert.doesNotMatch(toolbar, /font-family|font-size|color|align/i);
});

test("each toolbar control maps to the expected TipTap command", () => {
  assert.match(ui, /bold:\s*\{ run: \(c\) => c\.toggleBold\(\)/);
  assert.match(ui, /heading:\s*\{ run: \(c\) => c\.toggleHeading\(\{ level: 1 \}\)/);
  assert.match(ui, /bullet:\s*\{ run: \(c\) => c\.toggleBulletList\(\)/);
  assert.match(ui, /number:\s*\{ run: \(c\) => c\.toggleOrderedList\(\)/);
  assert.match(ui, /check:\s*\{ run: \(c\) => c\.toggleTaskList\(\)/);
  assert.match(ui, /undo:\s*\{ run: \(c\) => c\.undo\(\)/);
  assert.match(ui, /redo:\s*\{ run: \(c\) => c\.redo\(\)/);
  // Commands run off a focused chain.
  assert.match(ui, /editor\.chain\(\)\.focus\(\)/);
});

test("active formatting is reflected back onto the toolbar", () => {
  assert.match(ui, /editor\.isActive\(/);
  assert.match(ui, /classList\.toggle\("is-active", on\)/);
  assert.match(ui, /onSelectionUpdate: refreshToolbarState/);
});

test("the body is a TipTap editor mount; the textarea stays only as the rollback / fallback surface", () => {
  assert.match(html, /<div id="notesEditorMount" class="notesBodyEditor"><\/div>/);
  assert.match(html, /<textarea id="notesBodyInput"[^>]*hidden>/);
  assert.match(ui, /new Editor\(\{/);
  assert.match(ui, /RTNotesEditor\.Editor/);
  assert.match(ui, /StarterKit\.configure\(/);
  // New rich edits persist as HTML with an explicit discriminator.
  assert.match(ui, /return \{ body: editor\.getHTML\(\), bodyFormat: "html" \}/);
  // The list preview / title stay text-only and format-aware.
  assert.match(ui, /NotesStore\.previewOf\(note\.body, undefined, note\.bodyFormat\)/);
  assert.match(ui, /previewEl\.textContent = preview/);
  assert.match(ui, /title\.textContent = NotesStore\.titleFor\(note\)/);
  // Note content is never written through innerHTML.
  assert.doesNotMatch(ui, /innerHTML\s*=/);
});

test("the editor is created lazily per note and always destroyed on the way out", () => {
  assert.match(ui, /function initEditorFor\(note\)/);
  assert.match(ui, /initEditorFor\(note\);/);
  assert.match(ui, /function destroyEditor\(\)/);
  assert.match(ui, /editor\.destroy\(\);/);
  // destroyEditor runs before a fresh instance is built, and when leaving.
  assert.match(ui, /destroyEditor\(\);\s*\n\s*const html = noteBodyToHtml\(note\)/);
  const showList = ui.slice(ui.indexOf("function showList()"), ui.indexOf("function showEditor()"));
  assert.match(showList, /destroyEditor\(\);/);
});

test("legacy Markdown notes migrate lazily - converted for display, rewritten only on edit", () => {
  // Opening converts Markdown -> HTML for the editor...
  assert.match(ui, /if \(note && note\.bodyFormat === "html"\) return note\.body \|\| "";/);
  assert.match(ui, /NotesMarkdown\.markdownToHtml\(md\)/);
  // ...but openNote never writes; only flushSave (a real edit) does, and only
  // then does bodyFormat flip to "html".
  const openNote = ui.slice(ui.indexOf("function openNote("), ui.indexOf("function noteBodyToHtml("));
  assert.doesNotMatch(openNote, /store\s*\.\s*update/);
  assert.match(ui, /patch\.bodyFormat = content\.bodyFormat;/);
});

test("a failed editor init never destroys data - it falls back to read-only stored text", () => {
  assert.match(ui, /function enterFallback\(note\)/);
  assert.match(ui, /bodyInput\.readOnly = true;/);
  assert.match(ui, /bodyInput\.value = \(note && note\.body\) \|\| "";/);
  // Fallback mode saves nothing (currentBody returns null unless mode is rich).
  assert.match(ui, /if \(editorMode === "rich" && editor\) \{\s*\n\s*return \{ body: editor\.getHTML/);
});

/* ----------------------------------------------------------------------
 *   Note actions
 * -------------------------------------------------------------------- */

test("delete is confirmed and lives in an overflow menu (editor + list card), never an always-visible button", () => {
  // One shared confirm-message helper, used from both the editor menu and the
  // list card menu. Named note vs. blank-note fallback.
  assert.match(ui, /function noteDeleteMessage\(note\) \{/);
  assert.match(ui, /Delete “\$\{label\}”\? This permanently removes the note from this device\./);
  assert.match(ui, /"Delete this note\? This permanently removes it from this device\."/);
  assert.match(ui, /if \(!window\.confirm\(noteDeleteMessage\(currentNote\)\)\) return;/);
  assert.match(ui, /if \(!window\.confirm\(noteDeleteMessage\(note\)\)\) return;/);
  // Editor: the delete control still lives only inside its <details> overflow menu.
  assert.match(html, /<details class="notesEditorMenu"[\s\S]*?<summary[\s\S]*?id="notesDeleteBtn"[\s\S]*?<\/details>/);
  const editor = html.slice(html.indexOf('id="notesEditorView"'), html.indexOf("</details>", html.indexOf('id="notesEditorView"')));
  assert.equal((editor.match(/id="notesDeleteBtn"/g) || []).length, 1, "exactly one delete control in the editor header");
  // List: delete is an item in the shared card-menu dialog, not a per-card button.
  assert.match(html, /id="notesCardMenu"[\s\S]*?id="notesCardDeleteBtn"[\s\S]*?<\/dialog>/);
});

test("create / pin / unpin all write straight through the store", () => {
  // New note seeds folderId from the current view (see the folder tests).
  assert.match(ui, /store\s*\n?\s*\.create\(seed\)/);
  assert.match(ui, /store\s*\n?\s*\.update\(currentId, \{ pinned: next \}\)/);
  assert.match(ui, /store\s*\n?\s*\.remove\(id\)/);
});

/* ----------------------------------------------------------------------
 *   Local-data messaging + export / import
 * -------------------------------------------------------------------- */

test("the list makes the on-device-only nature explicit", () => {
  assert.match(html, /id="notesDeviceHint"[^>]*>[\s\S]*?stored on this device only/);
  assert.match(html, /Private notes, stored on this device only/);
});

test("Export and Import are offered as a portable JSON backup", () => {
  assert.match(html, /id="notesExportBtn"/);
  assert.match(html, /id="notesImportBtn"/);
  assert.match(html, /id="notesImportFile"[^>]*accept="application\/json/);
  assert.match(ui, /store\s*\n?\s*\.exportNotes\(\)/);
  assert.match(ui, /store\s*\n?\s*\.importNotes\(payload\)/);
  // A rejected import is surfaced, not swallowed.
  assert.match(ui, /setBackupStatus\(result\.error \|\| "That file couldn't be imported\.", "error"\)/);
});

test("a graceful message when on-device storage is unavailable", () => {
  assert.match(html, /id="notesUnavailable"/);
  assert.match(ui, /NotesStore\.isSupported\(\) \? NotesStore\.createStore\(\) : null/);
  assert.match(ui, /if \(unavailable\) unavailable\.hidden = false;/);
});

/* ----------------------------------------------------------------------
 *   Flat folders (device-local)
 * -------------------------------------------------------------------- */

test("the list screen has a compact folder chip bar above the note cards", () => {
  // Bar sits after the on-device hint and before the note list.
  const hint = html.indexOf('id="notesDeviceHint"');
  const bar = html.indexOf('id="notesFolderBar"');
  const list = html.indexOf('id="notesList"');
  assert.ok(hint !== -1 && bar !== -1 && list !== -1);
  assert.ok(hint < bar && bar < list, "order is hint -> folders -> notes");
  assert.match(html, /<div class="notesFolderBar" id="notesFolderBar" role="tablist"/);
  // Horizontal, scrollable, secondary - not big folder cards / a file tree.
  assert.match(styles, /\.notesFolderBar\{[^}]*overflow-x:auto/);
  assert.match(styles, /\.notesFolderChip\{[^}]*border-radius:999px/);
});

test("All Notes and Unfiled are built-in views, not folder records", () => {
  assert.match(ui, /const VIEW_ALL = "all";/);
  assert.match(ui, /const VIEW_UNFILED = "unfiled";/);
  assert.match(ui, /makeChip\("All Notes", VIEW_ALL/);
  assert.match(ui, /makeChip\("Unfiled", VIEW_UNFILED/);
  // They are never written to IndexedDB: only real folders come from the store.
  assert.match(ui, /folders = folderList \|\| \[\];/);
  assert.doesNotMatch(ui, /createFolder\("All Notes"\)|createFolder\("Unfiled"\)/);
});

test("user folders render from the store, after the built-in views", () => {
  assert.match(ui, /folders\.forEach\(\(folder\) => \{[\s\S]*?makeChip\(folder\.name, folder\.id/);
  assert.match(ui, /store\s*\.getFolders\(\)/);
  // "+ Folder" create affordance sits with the chips.
  assert.match(ui, /add\.textContent = "\+ Folder";/);
  assert.match(ui, /openFolderDialog\("create"\)/);
});

test("tapping a folder filters the list immediately, keeping pinned-first order", () => {
  assert.match(ui, /function selectView\(view\) \{\s*\n\s*if \(currentView === view\) return;\s*\n\s*currentView = view;\s*\n\s*renderList\(\);/);
  // filterNotes never re-sorts - it filters the already-sorted store.getAll().
  assert.match(ui, /function filterNotes\(notes, view\) \{/);
  assert.match(ui, /if \(view === VIEW_UNFILED\) return notes\.filter\(\(note\) => \(note\.folderId \|\| null\) === null\)/);
  assert.match(ui, /return notes\.filter\(\(note\) => note\.folderId === view\)/);
  assert.doesNotMatch(ui, /filterNotes[\s\S]{0,120}sort\(/);
});

test("New note inherits the selected user folder, but is Unfiled from All Notes / Unfiled", () => {
  assert.match(ui, /const seed = isFolderView\(\) \? \{ folderId: currentView \} : \{\};/);
  assert.match(ui, /store\s*\n?\s*\.create\(seed\)/);
  assert.match(ui, /function isFolderView\(\) \{\s*\n\s*return currentView !== VIEW_ALL && currentView !== VIEW_UNFILED;/);
});

test("Move to folder lives in the note overflow menu, not the editor header", () => {
  assert.match(html, /<div class="notesEditorMenuPanel">\s*<button type="button" id="notesMoveBtn"[^>]*>Move to folder<\/button>/);
  // Not a permanent header button.
  const headerEnd = html.indexOf('id="notesTitleInput"');
  const header = html.slice(html.indexOf('class="notesEditorHeader"'), headerEnd);
  assert.doesNotMatch(header, /Move to folder/);
  assert.match(ui, /store\s*\n?\s*\.moveNoteToFolder\(id, folderId\)/);
  // The chooser offers Unfiled + folders, never "All Notes".
  assert.match(ui, /addOption\("Unfiled", null\);/);
  assert.doesNotMatch(ui, /addOption\("All Notes"/);
});

test("moving a note keeps the editor open and refreshes the current note", () => {
  assert.match(ui, /if \(saved && saved\.id === currentId\) currentNote = saved;/);
  // No showList() / navigation on a move.
  const choose = ui.slice(ui.indexOf("function chooseMoveTarget("), ui.indexOf("function chooseMoveTarget(") + 500);
  assert.doesNotMatch(choose, /showList\(\)/);
});

test("folder rename / delete are on the manage dialog, never on every chip", () => {
  assert.match(html, /id="notesFolderManageDialog"[\s\S]*?id="notesFolderRenameBtn"[\s\S]*?id="notesFolderDeleteBtn"[\s\S]*?<\/dialog>/);
  assert.match(ui, /folderRenameBtn\.addEventListener\("click", \(\) => \{[\s\S]*?openFolderDialog\("rename", folder\)/);
  assert.match(ui, /folderDeleteBtn\.addEventListener\("click", \(\) => \{[\s\S]*?confirmDeleteFolder\(folder\)/);
  // Manage entry points: the active-folder "⋯" button and long-press - not a
  // control baked into each chip.
  assert.match(ui, /manage\.className = "notesFolderManage";/);
  assert.match(ui, /attachLongPress\(chip, \(\) => openFolderManage\(folder\)\)/);
});

test("deleting a folder explains the notes are kept, and lands the user on Unfiled", () => {
  assert.match(ui, /Delete “\$\{folder\.name\}”\? Notes in this folder will be moved to Unfiled\./);
  assert.match(ui, /store\s*\n?\s*\.deleteFolder\(folder\.id\)/);
  assert.match(ui, /if \(currentView === folder\.id\) currentView = VIEW_UNFILED;/);
});

test("built-in views expose no rename/delete affordance", () => {
  // Only user-folder chips get the context menu / long-press / manage button.
  assert.match(ui, /if \(isFolderView\(\)\) \{\s*\n\s*const folder = folderById\(currentView\);/);
  // The manage dialog's target is only ever set from a real folder object.
  assert.match(ui, /function openFolderManage\(folder\) \{\s*\n\s*if \(!folder \|\| !folderManageDialog/);
});

test("the selected folder is local UI state only - reset to All Notes on (re-)open", () => {
  assert.match(ui, /let currentView = VIEW_ALL;/);
  // showList() and the section-open MutationObserver both reset it.
  assert.match(ui, /function showList\(\) \{[\s\S]*?currentView = VIEW_ALL;/);
  assert.match(ui, /if \(mode === "list"\) \{[\s\S]*?currentView = VIEW_ALL;\s*\n\s*renderList\(\);/);
  // It is never read from or written to localStorage / a snapshot.
  assert.doesNotMatch(ui, /currentView[\s\S]{0,40}localStorage/);
});

test("per-view empty states, and subtle counts beside folders", () => {
  assert.match(ui, /if \(currentView === VIEW_UNFILED\) return "No unfiled notes\.";/);
  assert.match(ui, /`No notes in \$\{folder\.name\} yet\. Tap New note to add one\.`/);
  assert.match(ui, /badge\.className = "notesFolderCount";/);
  assert.match(ui, /badge\.textContent = String\(count\);/);
});

test("folder controls never reach for innerHTML or app state", () => {
  assert.doesNotMatch(ui, /innerHTML\s*=/);
  assert.doesNotMatch(ui, /localStorage\s*[.[]|PolynSyncStorage|PolynStorage/);
  assert.doesNotMatch(ui, /cloud-sync|active-job|workspace_configurations|supabase/i);
});

/* ----------------------------------------------------------------------
 *   Note-card overflow actions (list)
 * -------------------------------------------------------------------- */

test("every note card carries a right-side '…' overflow control, as a sibling of the card button", () => {
  // The card button is not nested inside anything interactive; the actions
  // cluster is a sibling within .notesItemRow.
  assert.match(ui, /row\.className = "notesItemRow";/);
  assert.match(ui, /item\.className = "notesItem";/);
  assert.match(ui, /row\.appendChild\(item\);/);
  assert.match(ui, /actions\.className = "notesItemActions";/);
  assert.match(ui, /menuBtn\.className = "notesItemMenuBtn";/);
  assert.match(ui, /menuBtn\.setAttribute\("aria-haspopup", "dialog"\);/);
  assert.match(ui, /menuBtn\.setAttribute\("aria-label", "Note actions"\);/);
  assert.match(ui, /row\.appendChild\(actions\);/);
  // Cluster is positioned over the card, not a row beneath it.
  assert.match(styles, /\.notesItemActions\{[^}]*position:absolute/);
  assert.match(styles, /\.notesItem\{[\s\S]*?padding:10px 44px 10px 12px/);
});

test("tapping the card opens the editor; tapping '…' does not", () => {
  // Card button opens the note.
  assert.match(ui, /item\.addEventListener\("click", \(\) => openNote\(note\.id\)\);/);
  // The overflow button stops propagation and opens the card menu instead.
  assert.match(ui, /menuBtn\.addEventListener\("click", \(event\) => \{[\s\S]*?event\.stopPropagation\(\);[\s\S]*?openCardMenu\(note, menuBtn\);/);
});

test("the card menu offers Pin/Unpin, Move to folder, Delete note", () => {
  assert.match(html, /id="notesCardMenu"[\s\S]*?id="notesCardPinBtn"[\s\S]*?id="notesCardMoveBtn"[\s\S]*?id="notesCardDeleteBtn"[\s\S]*?<\/dialog>/);
  // Pin label reflects current state when the menu opens.
  assert.match(ui, /cardPinBtn\.textContent = note\.pinned \? "Unpin note" : "Pin note";/);
});

test("Pin/Unpin from the list uses the same store.update path as the editor and refreshes in place", () => {
  assert.match(ui, /function togglePinFromCard\(note\) \{[\s\S]*?store\s*\n?\s*\.update\(note\.id, \{ pinned: next \}\)[\s\S]*?\.then\(\(\) => renderList\(\)\)/);
  // Same shape the editor pin uses.
  assert.match(ui, /store\s*\n?\s*\.update\(currentId, \{ pinned: next \}\)/);
  // renderList re-reads store.getAll() (pinned-first) and re-renders the card,
  // and it always filters by the unchanged currentView.
  assert.match(ui, /Promise\.all\(\[store\.getAll\(\), store\.getFolders\(\)\]\)/);
});

test("Move to folder from the list reuses moveNoteToFolder and the shared picker, without opening the editor", () => {
  // Same dialog, driven by an explicit context instead of the open note.
  assert.match(ui, /function openMoveDialog\(context\) \{/);
  assert.match(ui, /openMoveDialog\(\{ noteId: note\.id, folderId: note\.folderId \|\| null, fromList: true \}\)/);
  assert.match(ui, /store\s*\n?\s*\.moveNoteToFolder\(id, folderId\)/);
  // A list move refreshes the filtered list (counts + drop-from-folder);
  // it never navigates.
  assert.match(ui, /if \(ctx\.fromList\) \{[\s\S]*?renderList\(\);/);
  const choose = ui.slice(ui.indexOf("function chooseMoveTarget("), ui.indexOf("function chooseMoveTarget(") + 700);
  assert.doesNotMatch(choose, /openNote\(|showEditor\(|showList\(/);
});

test("Delete from the list uses store.remove and refreshes, preserving the active folder", () => {
  assert.match(ui, /function deleteNoteFromCard\(note\) \{[\s\S]*?window\.confirm\(noteDeleteMessage\(note\)\)[\s\S]*?store\s*\n?\s*\.remove\(note\.id\)[\s\S]*?\.then\(\(\) => renderList\(\)\)/);
  // Same remove path the editor delete uses.
  assert.match(ui, /store\s*\n?\s*\.remove\(id\)/);
  // No navigation on a list delete.
  const del = ui.slice(ui.indexOf("function deleteNoteFromCard("), ui.indexOf("function deleteNoteFromCard(") + 500);
  assert.doesNotMatch(del, /showList\(|showEditor\(|openNote\(/);
});

test("card-menu actions dismiss the menu first, then act on the next tick", () => {
  assert.match(ui, /cardPinBtn\.addEventListener\("click", \(\) => \{\s*\n\s*const note = cardMenuNote;\s*\n\s*closeCardMenu\(\);\s*\n\s*if \(note\) setTimeout\(\(\) => togglePinFromCard\(note\), 0\);/);
  assert.match(ui, /cardDeleteBtn\.addEventListener\("click", \(\) => \{\s*\n\s*const note = cardMenuNote;\s*\n\s*closeCardMenu\(\);\s*\n\s*if \(note\) setTimeout\(\(\) => deleteNoteFromCard\(note\), 0\);/);
  assert.match(ui, /if \(cardMenuCancelBtn\) cardMenuCancelBtn\.addEventListener\("click", closeCardMenu\);/);
});

test("editor overflow actions still exist and work (not removed because the list now has them too)", () => {
  // Editor menu markup intact.
  assert.match(html, /<div class="notesEditorMenuPanel">\s*<button type="button" id="notesMoveBtn"[^>]*>Move to folder<\/button>\s*<button type="button" id="notesDeleteBtn"[^>]*>Delete note<\/button>/);
  // Editor wiring intact.
  assert.match(ui, /if \(pinBtn\) pinBtn\.addEventListener\("click", togglePin\);/);
  assert.match(ui, /deleteBtn\.addEventListener\("click", \(\) => \{\s*\n\s*if \(editorMenu\) editorMenu\.open = false;\s*\n\s*deleteCurrent\(\);/);
  assert.match(ui, /moveBtn\.addEventListener\("click", \(\) => \{\s*\n\s*if \(editorMenu\) editorMenu\.open = false;\s*\n\s*openMoveDialog\(\);/);
});

test("note-card markup and actions never use innerHTML", () => {
  // Glyphs are cloned nodes, not markup strings.
  assert.match(ui, /editorMenu\.querySelector\("summary svg"\)/);
  assert.match(ui, /menuBtn\.appendChild\(menuGlyph\.cloneNode\(true\)\)/);
  assert.doesNotMatch(ui, /innerHTML\s*=/);
});

/* ----------------------------------------------------------------------
 *   Backup: modal dialog instead of an inline expansion
 * -------------------------------------------------------------------- */

test("the list bar is just New note + a Backup button - no inline backup panel in page flow", () => {
  const bar = html.slice(html.indexOf('class="notesListBar"'), html.indexOf("</div>", html.indexOf('class="notesListBar"')));
  assert.match(bar, /id="notesNewBtn"/);
  assert.match(bar, /id="notesBackupBtn"[^>]*aria-haspopup="dialog"/);
  // The old inline <details> expansion is gone from the list view.
  assert.doesNotMatch(html, /class="notesBackupMenu"|class="notesBackupPanel"|class="notesBackupToggle"/);
  const listView = html.slice(html.indexOf('id="notesListView"'), html.indexOf('id="notesEditorView"'));
  assert.doesNotMatch(listView, /id="notesExportBtn"|id="notesImportFile"|id="notesImportInput"/);
});

test("Backup content lives in a modal <dialog>, opened from the Backup button", () => {
  assert.match(html, /<dialog id="notesBackupDialog"[^>]*class="[^"]*notesDialog[^"]*"/);
  assert.match(html, /id="notesBackupDialog"[\s\S]*?id="notesExportBtn"[\s\S]*?id="notesImportFile"[\s\S]*?id="notesImportInput"[\s\S]*?id="notesBackupCloseBtn"[\s\S]*?<\/dialog>/);
  assert.match(ui, /function openBackupDialog\(\) \{[\s\S]*?backupDialog\.showModal\(\)/);
  assert.match(ui, /if \(backupBtn\) backupBtn\.addEventListener\("click", openBackupDialog\);/);
  // Feature-branded labels preserved.
  assert.match(html, /id="notesExportBtn"[^>]*>Export RT Notes</);
  assert.match(html, /id="notesImportBtn"[^>]*>Import RT Notes</);
  assert.match(html, /class="notesBackupIntro">RT Notes live only in this app/);
});

test("Export / file-import / paste-JSON import all still work, unchanged", () => {
  assert.match(ui, /store\s*\n?\s*\.exportNotes\(\)/);
  assert.match(ui, /store\s*\n?\s*\.importNotes\(payload\)/);
  assert.match(ui, /if \(exportBtn\) exportBtn\.addEventListener\("click", runExport\);/);
  assert.match(ui, /if \(importBtn\) importBtn\.addEventListener\("click", \(\) => runImport\(importInput \? importInput\.value : ""\)\);/);
  assert.match(ui, /importFile\.addEventListener\("change", \(\) => \{/);
  assert.match(html, /id="notesImportFile"[^>]*accept="application\/json/);
});

test("the paste-JSON textarea is behind an 'Advanced' disclosure, collapsed by default", () => {
  assert.match(html, /<details class="notesBackupAdvanced" id="notesBackupAdvanced">\s*<summary>Advanced[\s\S]*?id="notesImportInput"[\s\S]*?id="notesImportBtn"[\s\S]*?<\/details>/);
  // No `open` attribute on the <details> -> collapsed initially.
  assert.doesNotMatch(html, /<details class="notesBackupAdvanced" id="notesBackupAdvanced" open/);
});

test("Backup dialog closes on an explicit Close button (no reliance on the dialog 'close' event)", () => {
  assert.match(ui, /function closeBackupDialog\(\) \{[\s\S]*?backupDialog\.close\(\)/);
  assert.match(ui, /if \(backupCloseBtn\) backupCloseBtn\.addEventListener\("click", closeBackupDialog\);/);
  // Android Back already closes any open <dialog> first (handleAndroidBack).
  const body = app.slice(app.indexOf("function handleAndroidBack()"), app.indexOf("window.handleAndroidBack = handleAndroidBack;"));
  assert.match(body, /const dialog = document\.querySelector\("dialog\[open\]"\);\s*\n\s*if \(dialog\)\{ dialog\.close\(\); return true; \}/);
});

test("opening/closing Backup changes no list state - no currentView writes, no navigation, no layout element moves", () => {
  const open = ui.slice(ui.indexOf("function openBackupDialog("), ui.indexOf("function closeBackupDialog(") + 220);
  assert.doesNotMatch(open, /currentView\s*=|renderList\(|showList\(|showEditor\(|dataset\.mobileNotes/);
  // The folder bar + note list markup are untouched by the backup change.
  assert.match(html, /<div class="notesFolders" id="notesFolders">[\s\S]*?<div class="notesFolderBar" id="notesFolderBar"/);
  assert.match(html, /<div class="notesList" id="notesList" role="list"><\/div>/);
});

test("Backup <dialog> is a sibling of the list/editor views, not inside the list flow", () => {
  const listViewEnd = html.indexOf('id="notesEditorView"');
  const listView = html.slice(html.indexOf('id="notesListView"'), listViewEnd);
  assert.doesNotMatch(listView, /id="notesBackupDialog"/);
  assert.ok(html.indexOf('id="notesBackupDialog"') > listViewEnd, "backup dialog markup comes after the list view");
});
