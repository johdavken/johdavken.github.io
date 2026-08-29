"use strict";

// -----------------------------------------------------------------------------
//  RT Notes — TipTap rich-editor EXPERIMENT
// -----------------------------------------------------------------------------
//
//  Pure, dependency-free checks for the isolated TipTap integration:
//
//    * the vendored bundle is a self-contained classic-script IIFE, loaded
//      before notes-ui.js, and nothing else in the app consumes it;
//    * Notes is still walled off from RT Sync / shared state;
//    * the bounded Markdown <-> HTML converters cover exactly the toolbar
//      syntax and never throw;
//    * bodyFormat storage/rollback semantics.
//
//  Actual rich-text interaction (typing, Gboard, carets, checkbox taps, undo)
//  is verified in a browser / on-device — see the PR notes. This suite only
//  covers what node:test can hold without instantiating ProseMirror.
// -----------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("notes-ui.js", "utf8");
const store = fs.readFileSync("notes-store.js", "utf8");
const NotesStore = require("./notes-store.js");
const NotesMarkdown = require("./notes-markdown.js");

/* ----------------------------------------------------------------------
 *   Vendored bundle: isolated, offline, classic-script friendly
 * -------------------------------------------------------------------- */

test("the TipTap bundle is a committed, self-contained IIFE that exposes one global", () => {
  const bundlePath = path.join(__dirname, "vendor", "tiptap-notes.min.js");
  assert.ok(fs.existsSync(bundlePath), "vendor/tiptap-notes.min.js must be committed (build:notes-editor)");
  const code = fs.readFileSync(bundlePath, "utf8");
  assert.match(code.slice(0, 60), /^var RTNotesEditor=\(\(\)=>\{/, "browser-global IIFE, not ESM/CJS");
  // Fully offline: nothing in the bundle reaches the network or injects a
  // remote asset. (A single prosemirror.net doc link appears inside an error
  // string; it is never requested.)
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|importScripts/, "no network primitives");
  assert.doesNotMatch(code, /\bimport\s*\(/, "no dynamic import()");
  assert.doesNotMatch(code, /\/\/(unpkg|cdn|jsdelivr|esm\.sh|skypack)/i, "no CDN host references");
  assert.doesNotMatch(code, /createElement\(["']script["']\)/, "does not inject <script> tags");
});

test("the bundle loads before notes-ui.js and after the other vendored globals", () => {
  const tiptap = html.indexOf('src="vendor/tiptap-notes.min.js');
  const notesUi = html.indexOf('src="notes-ui.js');
  const notesMd = html.indexOf('src="notes-markdown.js');
  const notesStore = html.indexOf('src="notes-store.js');
  assert.ok(tiptap !== -1 && notesUi !== -1 && notesMd !== -1 && notesStore !== -1);
  assert.ok(tiptap < notesUi, "TipTap bundle must be parsed before notes-ui.js");
  assert.ok(notesStore < notesMd && notesMd < notesUi, "notes-markdown.js sits between the store and the UI");
  // Classic script, same as every other module (no type=module anywhere new).
  assert.match(html, /<script src="vendor\/tiptap-notes\.min\.js\?v=[^"]+" defer><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+type="module"/);
});

test("notes-ui.js consumes the editor only through globals and degrades if they are absent", () => {
  assert.match(ui, /const RTNotesEditor = root\.RTNotesEditor \|\| null;/);
  assert.match(ui, /const NotesMarkdown = root\.PolynNotesMarkdown \|\| null;/);
  // A missing bundle throws into the read-only fallback, never a hard crash.
  assert.match(ui, /if \(!RTNotesEditor \|\| !RTNotesEditor\.Editor \|\| !editorMount\) \{/);
  assert.match(ui, /enterFallback\(note\);/);
});

test("the experiment adds no bundler / framework to the app and no CDN", () => {
  // build-www.js is untouched; it copies the bundle purely because index.html
  // references it.
  const buildWww = fs.readFileSync(path.join("scripts", "build-www.js"), "utf8");
  assert.doesNotMatch(buildWww, /tiptap|esbuild/i);
  // No new module graph in the app entry.
  assert.doesNotMatch(html, /require\(|from ["']@tiptap/);
});

/* ----------------------------------------------------------------------
 *   Notes stays out of RT Sync / shared state (unchanged by the experiment)
 * -------------------------------------------------------------------- */

test("the rich editor introduces no localStorage / sync / workspace coupling", () => {
  assert.doesNotMatch(ui, /localStorage\s*[.[]|PolynSyncStorage|PolynStorage/);
  assert.doesNotMatch(ui, /cloud-sync|active-job|workspace_configurations|supabase/i);
  assert.doesNotMatch(store, /localStorage\s*[.[]/);
  // Still its own IndexedDB database. Schema is v3 now: v2 added the `folders`
  // object store, v3 added a small `meta` key/value store (RT Cloud config
  // lives there - see rt-cloud.js). The `bodyFormat` string field still needs
  // no migration on the keyPath notes store.
  assert.equal(NotesStore.DB_NAME, "resin.tools.notes");
  assert.equal(NotesStore.SCHEMA_VERSION, 3);
});

/* ----------------------------------------------------------------------
 *   bodyFormat storage / rollback semantics
 * -------------------------------------------------------------------- */

test("a note with no bodyFormat is Markdown; an explicit html is preserved; junk -> markdown", () => {
  assert.equal(NotesStore.normalizeNote({ id: "a", body: "# h" }).bodyFormat, "markdown");
  assert.equal(NotesStore.normalizeNote({ id: "b", body: "<h1>h</h1>", bodyFormat: "html" }).bodyFormat, "html");
  assert.equal(NotesStore.normalizeNote({ id: "c", body: "x", bodyFormat: "rtf" }).bodyFormat, "markdown");
});

test("import merge treats bodyFormat as content: same text, different format = kept as a copy", () => {
  const existing = [{ id: "dup", title: "t", body: "x", bodyFormat: "markdown", pinned: false, createdAt: 1, updatedAt: 1 }];
  const incoming = [{ id: "dup", title: "t", body: "x", bodyFormat: "html", pinned: false, createdAt: 1, updatedAt: 1 }];
  const merged = NotesStore.mergeImport(existing, incoming);
  assert.equal(merged.notes.length, 2, "format differs -> not a byte-identical duplicate");
  assert.equal(merged.renamed, 1);
});

/* ----------------------------------------------------------------------
 *   Markdown -> HTML  (only the toolbar's own syntax; never throws)
 * -------------------------------------------------------------------- */

test("markdownToHtml renders headings, bold, bullet/number/task lists and paragraphs", () => {
  const md = [
    "# Title",
    "",
    "Some **bold** and a line.",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "- [ ] todo",
    "- [x] done"
  ].join("\n");
  const out = NotesMarkdown.markdownToHtml(md);
  assert.match(out, /<h1>Title<\/h1>/);
  assert.match(out, /<p>Some <strong>bold<\/strong> and a line\.<\/p>/);
  assert.match(out, /<ul><li><p>one<\/p><\/li><li><p>two<\/p><\/li><\/ul>/);
  assert.match(out, /<ol><li><p>first<\/p><\/li><li><p>second<\/p><\/li><\/ol>/);
  assert.match(out, /<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>todo<\/p><\/li><li data-type="taskItem" data-checked="true"><p>done<\/p><\/li><\/ul>/);
});

test("markdownToHtml escapes raw text so a note can't inject markup", () => {
  const out = NotesMarkdown.markdownToHtml("a <script>alert(1)</script> & <b>x</b>");
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /&amp;/);
});

test("markdownToHtml never throws - a pathological input still returns a string", () => {
  for (const bad of [null, undefined, 42, "#".repeat(5000), "- ".repeat(5000), "**"]) {
    assert.equal(typeof NotesMarkdown.markdownToHtml(bad), "string");
  }
});

/* ----------------------------------------------------------------------
 *   HTML -> Markdown  (emergency rollback / export helper)
 * -------------------------------------------------------------------- */

test("htmlToMarkdown reverses the HTML this TipTap config emits", () => {
  const html2 = [
    "<h1>Title</h1>",
    "<p>Some <strong>bold</strong> text</p>",
    "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
    "<ol><li><p>first</p></li></ol>",
    '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>todo</p></div></li></ul>'
  ].join("");
  const md = NotesMarkdown.htmlToMarkdown(html2);
  assert.match(md, /^# Title$/m);
  assert.match(md, /^Some \*\*bold\*\* text$/m);
  assert.match(md, /^- one$/m);
  assert.match(md, /^- two$/m);
  assert.match(md, /^1\. first$/m);
  assert.match(md, /^- \[x\] done$/m);
  assert.match(md, /^- \[ \] todo$/m);
});

test("markdown -> html -> markdown preserves every toolbar-produced line", () => {
  const md = ["# Heading", "", "text with **bold**", "", "- a", "- b", "", "1. one", "", "- [x] done", "- [ ] todo"].join("\n");
  const back = NotesMarkdown.htmlToMarkdown(NotesMarkdown.markdownToHtml(md));
  for (const line of ["# Heading", "text with **bold**", "- a", "- b", "1. one", "- [x] done", "- [ ] todo"]) {
    assert.ok(back.split("\n").includes(line), `round-trip lost: ${line}\n---\n${back}`);
  }
});

test("htmlToMarkdown never throws and drops unknown tags to their text", () => {
  assert.equal(typeof NotesMarkdown.htmlToMarkdown(null), "string");
  assert.equal(
    NotesMarkdown.htmlToMarkdown("<p>keep <span style='x'>this</span> <img src=y></p>").trim(),
    "keep this"
  );
});
