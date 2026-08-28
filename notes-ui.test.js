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

test("the collapsed Workspace & support bar previews Notes in its icon cluster and caption", () => {
  const cluster = html.slice(html.indexOf('class="mobileWorkspaceNavMoreIcons"'), html.indexOf("</span>", html.indexOf('class="mobileWorkspaceNavMoreIcons"')));
  // Cluster paint order is reverse nav order, so Notes sits between Tools and RT Sync.
  assert.ok(
    cluster.indexOf("moreIconTools") < cluster.indexOf("moreIconNotes") &&
    cluster.indexOf("moreIconNotes") < cluster.indexOf("moreIconRt"),
    "Notes glyph sits between Tools and RT Sync in the cluster"
  );
  assert.match(html, /<small>RT Sync · Notes · Tools · Get the app · Changelog · Sudo access<\/small>/);
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
  assert.match(ui, /bodyInput\.addEventListener\("input", scheduleSave\)/);
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
 *   Formatting - stored as Markdown, compact toolbar
 * -------------------------------------------------------------------- */

test("the toolbar offers exactly Bold / Heading / Bullet / Number / Check / Undo / Redo", () => {
  const toolbar = html.slice(html.indexOf('class="notesToolbar"'), html.indexOf("</div>", html.indexOf('class="notesToolbar"')));
  for (const kind of ["bold", "heading", "bullet", "number", "check", "undo", "redo"]) {
    assert.match(toolbar, new RegExp(`data-note-format="${kind}"`));
  }
  // Explicitly none of the heavy controls.
  assert.doesNotMatch(toolbar, /font-family|font-size|color|align/i);
});

test("the note body is a plain textarea and is stored as Markdown text, not HTML", () => {
  assert.match(html, /<textarea id="notesBodyInput"/);
  assert.match(ui, /wrapSelection\(bodyInput, "\*\*"\)/);
  assert.match(ui, /toggleLinePrefix\(bodyInput, kind\)/);
  // Insertions try execCommand first so the textarea's native undo stack
  // keeps working; direct value writes are the fallback.
  assert.match(ui, /document\.execCommand\("insertText", false, text\)/);
  assert.match(ui, /document\.execCommand\(kind, false, null\)/);
  // The list preview and title are rendered as text, never markup.
  assert.match(ui, /NotesStore\.previewOf\(note\.body\)/);
  assert.match(ui, /previewEl\.textContent = preview/);
  assert.match(ui, /title\.textContent = NotesStore\.titleFor\(note\)/);
  assert.doesNotMatch(ui, /innerHTML/);
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
