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

test("delete is confirmed and tucked in an overflow menu, not an always-visible button", () => {
  assert.match(ui, /window\.confirm\("Delete this note\? This can't be undone\."\)/);
  // The only delete control lives inside the editor's <details> overflow menu.
  assert.match(html, /<details class="notesEditorMenu"[\s\S]*?<summary[\s\S]*?id="notesDeleteBtn"[\s\S]*?<\/details>/);
  const editor = html.slice(html.indexOf('id="notesEditorView"'), html.indexOf("</details>", html.indexOf('id="notesEditorView"')));
  assert.equal((editor.match(/id="notesDeleteBtn"/g) || []).length, 1, "exactly one delete control");
});

test("create / pin / unpin all write straight through the store", () => {
  assert.match(ui, /store\s*\n?\s*\.create\(\)/);
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
