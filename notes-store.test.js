"use strict";

// Pure logic of the device-local Notes store: note shape, sorting,
// preview, and the export / import contract. No IndexedDB here - the
// wrapper is exercised in notes-integration.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const NotesStore = require("./notes-store.js");

/* ----------------------------------------------------------------------
 *   Note shape
 * -------------------------------------------------------------------- */

test("newNote has exactly the current fields, with sane defaults", () => {
  const note = NotesStore.newNote();
  assert.deepEqual(
    Object.keys(note).sort(),
    ["body", "bodyFormat", "createdAt", "folderId", "id", "pinned", "title", "updatedAt"]
  );
  assert.equal(note.title, "");
  assert.equal(note.body, "");
  assert.equal(note.bodyFormat, "markdown", "notes default to Markdown until edited in the rich editor");
  assert.equal(note.pinned, false);
  assert.equal(note.folderId, null, "a new note is Unfiled");
  assert.match(note.id, /^note_/);
  assert.equal(typeof note.createdAt, "number");
  assert.equal(note.updatedAt, note.createdAt);
});

test("newNote accepts seed fields but ignores anything unknown", () => {
  const note = NotesStore.newNote({ title: "Line 4 startup", body: "<h1>Steps</h1>", bodyFormat: "html", pinned: true, secret: "x" });
  assert.equal(note.title, "Line 4 startup");
  assert.equal(note.body, "<h1>Steps</h1>");
  assert.equal(note.bodyFormat, "html");
  assert.equal(note.pinned, true);
  assert.equal(note.secret, undefined);
});

test("newNote rejects an unknown bodyFormat and falls back to Markdown", () => {
  assert.equal(NotesStore.newNote({ bodyFormat: "xml" }).bodyFormat, "markdown");
  assert.equal(NotesStore.newNote({ bodyFormat: 7 }).bodyFormat, "markdown");
});

test("normalizeNote coerces types, drops unknown keys, and rejects non-objects", () => {
  assert.equal(NotesStore.normalizeNote(null), null);
  assert.equal(NotesStore.normalizeNote("nope"), null);
  assert.equal(NotesStore.normalizeNote([]), null);
  const n = NotesStore.normalizeNote({
    id: "  keep-me  ",
    title: 42,
    body: null,
    pinned: "yes",
    createdAt: "1700000000000",
    updatedAt: -5,
    junk: true
  });
  assert.equal(n.id, "keep-me");
  assert.equal(n.title, "42");
  assert.equal(n.body, "");
  assert.equal(n.bodyFormat, "markdown", "a record with no bodyFormat is Markdown");
  assert.equal(n.pinned, false, "only a strict true is pinned");
  assert.equal(n.createdAt, 1700000000000);
  assert.equal(n.updatedAt, 1700000000000, "a bad updatedAt falls back to createdAt");
  assert.equal(n.folderId, null, "a record with no folderId is Unfiled");
  assert.equal(n.junk, undefined);
});

test("normalizeNote keeps a valid folderId and drops any other shape", () => {
  assert.equal(NotesStore.normalizeNote({ id: "a", folderId: "folder_abc" }).folderId, "folder_abc");
  assert.equal(NotesStore.normalizeNote({ id: "b", folderId: "nope" }).folderId, null);
  assert.equal(NotesStore.normalizeNote({ id: "c", folderId: 7 }).folderId, null);
  assert.equal(NotesStore.normalizeNote({ id: "d", folderId: "" }).folderId, null);
});

test("normalizeNote mints an id when one is missing", () => {
  const n = NotesStore.normalizeNote({ title: "x" });
  assert.match(n.id, /^note_/);
});

/* ----------------------------------------------------------------------
 *   Sorting
 * -------------------------------------------------------------------- */

test("sortNotes puts pinned first, then most-recently-updated", () => {
  const notes = [
    { id: "a", pinned: false, updatedAt: 100 },
    { id: "b", pinned: true, updatedAt: 50 },
    { id: "c", pinned: false, updatedAt: 300 },
    { id: "d", pinned: true, updatedAt: 200 }
  ];
  assert.deepEqual(NotesStore.sortNotes(notes).map((n) => n.id), ["d", "b", "c", "a"]);
});

test("sortNotes is stable for equal keys and does not mutate its input", () => {
  const notes = [
    { id: "a", pinned: false, updatedAt: 10 },
    { id: "b", pinned: false, updatedAt: 10 },
    { id: "c", pinned: false, updatedAt: 10 }
  ];
  const before = notes.slice();
  assert.deepEqual(NotesStore.sortNotes(notes).map((n) => n.id), ["a", "b", "c"]);
  assert.deepEqual(notes, before);
});

/* ----------------------------------------------------------------------
 *   Preview
 * -------------------------------------------------------------------- */

test("previewOf strips the Markdown the toolbar inserts and collapses whitespace", () => {
  const body = "# Heading\n\n- [ ] do a thing\n- bullet\n1. numbered\n\n**bold** text";
  const preview = NotesStore.previewOf(body);
  assert.doesNotMatch(preview, /[#*]|\[ \]|^-|\d\./);
  assert.match(preview, /Heading do a thing bullet numbered bold text/);
});

test("previewOf truncates to the requested length with an ellipsis", () => {
  const preview = NotesStore.previewOf("x".repeat(400), 40);
  assert.equal(preview.length, 40);
  assert.match(preview, /…$/);
  // Short bodies are returned whole. (The list renders this via textContent,
  // never innerHTML - see notes-ui.test.js - so it carries no markup risk.)
  assert.equal(NotesStore.previewOf("just a line"), "just a line");
});

test("previewOf('html') strips tags and never leaks markup into the preview text", () => {
  const html = '<h1>Startup</h1><p>check <strong>dryers</strong></p><ul data-type="taskList"><li data-checked="true"><p>bleed line</p></li></ul>';
  const preview = NotesStore.previewOf(html, undefined, "html");
  assert.equal(preview, "Startup check dryers bleed line");
  assert.doesNotMatch(preview, /[<>]/);
});

test("previewOf('html') removes real tags (a <script> element never survives as one)", () => {
  const preview = NotesStore.previewOf("<p>safe</p><script>alert(1)</script>", undefined, "html");
  assert.equal(preview, "safe alert(1)");
  assert.doesNotMatch(preview, /<\/?script/);
});

test("htmlToText decodes &amp; exactly once (no double-decode into a tag)", () => {
  assert.equal(NotesStore.htmlToText("<p>a &amp;lt; b</p>").trim(), "a &lt; b");
});

test("titleFor uses the first line of an HTML body, tag-free", () => {
  const note = { title: "", body: "<h1>Line 6 checklist</h1><p>more</p>", bodyFormat: "html" };
  assert.equal(NotesStore.titleFor(note), "Line 6 checklist");
});

test("htmlToText turns block boundaries into newlines so first-line logic still works", () => {
  const text = NotesStore.htmlToText("<h1>one</h1><p>two</p><ul><li>three</li></ul>");
  assert.deepEqual(
    text.split("\n").map((s) => s.trim()).filter(Boolean),
    ["one", "two", "three"]
  );
});

/* ----------------------------------------------------------------------
 *   Export
 * -------------------------------------------------------------------- */

test("buildExport carries the format tag, version, and every restorable field", () => {
  const note = {
    id: "note_1",
    title: "T",
    body: "B",
    bodyFormat: "markdown",
    pinned: true,
    folderId: null,
    createdAt: 1700000000000,
    updatedAt: 1700000009999
  };
  const dump = NotesStore.buildExport([note]);
  assert.equal(dump.format, "resin.tools/notes");
  assert.equal(dump.version, 2, "envelope bumped to 2 when folders were added");
  assert.equal(dump.count, 1);
  assert.equal(dump.folderCount, 0);
  assert.deepEqual(dump.folders, []);
  assert.match(dump.exportedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(dump.notes[0].bodyFormat, "markdown", "export carries the format discriminator");
  assert.deepEqual(dump.notes[0], note);
});

test("buildExport tags an HTML note as html and a field-less legacy note as markdown", () => {
  const dump = NotesStore.buildExport([
    { id: "a", title: "legacy", body: "# old", createdAt: 1, updatedAt: 1 },
    { id: "b", title: "new", body: "<h1>new</h1>", bodyFormat: "html", createdAt: 2, updatedAt: 2 }
  ]);
  assert.equal(dump.notes[0].bodyFormat, "markdown");
  assert.equal(dump.notes[1].bodyFormat, "html");
});

test("parseImport of a legacy export (no bodyFormat anywhere) yields markdown notes", () => {
  const legacy = JSON.stringify({
    format: "resin.tools/notes",
    version: 1,
    notes: [{ id: "x", title: "t", body: "**b**", createdAt: 1, updatedAt: 1 }]
  });
  const result = NotesStore.parseImport(legacy);
  assert.equal(result.ok, true);
  assert.equal(result.notes[0].bodyFormat, "markdown");
});

test("serializeExport round-trips through parseImport", () => {
  const notes = [NotesStore.newNote({ title: "one" }), NotesStore.newNote({ title: "two", pinned: true })];
  const json = NotesStore.serializeExport(notes);
  const parsed = NotesStore.parseImport(json);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.notes.length, 2);
  assert.deepEqual(parsed.notes.map((n) => n.title).sort(), ["one", "two"]);
});

/* ----------------------------------------------------------------------
 *   Import validation - must never throw or corrupt anything
 * -------------------------------------------------------------------- */

test("parseImport rejects malformed input without throwing", () => {
  for (const bad of ["", "{", "not json", "[]", "42", "null", JSON.stringify({ notes: [] }), JSON.stringify({ format: "resin.tools/notes" }), JSON.stringify({ format: "something/else", notes: [] })]) {
    const result = NotesStore.parseImport(bad);
    assert.equal(result.ok, false, `expected rejection for: ${bad}`);
    assert.equal(typeof result.error, "string");
  }
});

test("parseImport accepts a good envelope and reports how many entries it had to drop", () => {
  const payload = JSON.stringify({
    format: "resin.tools/notes",
    version: 1,
    notes: [{ id: "ok", title: "keep" }, null, "garbage", { title: "also kept" }]
  });
  const result = NotesStore.parseImport(payload);
  assert.equal(result.ok, true);
  assert.equal(result.notes.length, 2);
  assert.equal(result.skipped, 2);
});

/* ----------------------------------------------------------------------
 *   Merge - duplicate ids are kept, never silently overwritten
 * -------------------------------------------------------------------- */

test("mergeImport keeps an existing note when an incoming one reuses its id with different content", () => {
  const existing = [{ id: "dup", title: "mine", body: "original", pinned: false, createdAt: 1, updatedAt: 2 }];
  const incoming = [{ id: "dup", title: "theirs", body: "different", pinned: false, createdAt: 9, updatedAt: 9 }];
  const merged = NotesStore.mergeImport(existing, incoming);
  assert.equal(merged.notes.length, 2, "both notes survive");
  assert.equal(merged.added, 1);
  assert.equal(merged.renamed, 1);
  const original = merged.notes.find((n) => n.id === "dup");
  assert.equal(original.title, "mine", "the existing note is untouched");
  const copy = merged.notes.find((n) => n.id !== "dup");
  assert.equal(copy.title, "theirs");
  assert.notEqual(copy.id, "dup", "the clashing import got a fresh id");
});

test("mergeImport skips an incoming note that is byte-identical to an existing one", () => {
  const note = { id: "same", title: "t", body: "b", pinned: true, createdAt: 5, updatedAt: 7 };
  const merged = NotesStore.mergeImport([note], [Object.assign({}, note)]);
  assert.equal(merged.notes.length, 1);
  assert.equal(merged.added, 0);
  assert.equal(merged.skipped, 1);
});

test("mergeImport never drops or reorders the existing notes", () => {
  const existing = [
    NotesStore.newNote({ title: "a" }),
    NotesStore.newNote({ title: "b" }),
    NotesStore.newNote({ title: "c" })
  ];
  const merged = NotesStore.mergeImport(existing, [NotesStore.newNote({ title: "d" })]);
  assert.deepEqual(merged.notes.slice(0, 3).map((n) => n.title), ["a", "b", "c"]);
  assert.equal(merged.notes.length, 4);
});

/* ----------------------------------------------------------------------
 *   Namespacing / support detection
 * -------------------------------------------------------------------- */

test("the database name is clearly namespaced to Resin.Tools", () => {
  assert.equal(NotesStore.DB_NAME, "resin.tools.notes");
  assert.equal(NotesStore.STORE_NAME, "notes");
  assert.equal(NotesStore.FOLDER_STORE_NAME, "folders");
  assert.equal(NotesStore.META_STORE_NAME, "meta");
  assert.equal(NotesStore.SCHEMA_VERSION, 3);
});

test("isSupported is false when the environment has no IndexedDB", () => {
  assert.equal(typeof globalThis.indexedDB, "undefined");
  assert.equal(NotesStore.isSupported(), false);
});
