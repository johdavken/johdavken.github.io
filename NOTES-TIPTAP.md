# RT Notes — TipTap rich-text editor (EXPERIMENT)

An **isolated experiment**: RT Notes' body field is now a live WYSIWYG editor
(TipTap / ProseMirror) instead of a Markdown `<textarea>`. Nothing else in the
app changed — no bundler, no modules, no touch to RT Sync / Supabase / Recipe /
Weights / Timeline. Everything runs locally and offline.

## Files that belong to the experiment

| File | Role |
|---|---|
| `notes-editor-vendor.src.js` | esbuild entry — imports the 4 TipTap pieces, re-exports them |
| `vendor/tiptap-notes.min.js` | **committed** build output — classic-script IIFE → `window.RTNotesEditor` |
| `notes-markdown.js` | `window.PolynNotesMarkdown` — bounded Markdown⇄HTML + HTML→text helpers |
| `notes-editor.test.js` | tests for the bundle, isolation, converters, `bodyFormat` |
| `index.html` | one `<script>` for the bundle before `notes-ui.js`; `#notesEditorMount` div; `hidden` on the textarea |
| `notes-ui.js` | editor lifecycle, toolbar→commands, autosave from `onUpdate`, read-only fallback |
| `notes-store.js` | `bodyFormat` field + `htmlToText()` for previews/titles |
| `package.json` | `build:notes-editor` script + `@tiptap/*` / `esbuild` devDependencies |

## Regenerating the bundle

```
npm install            # once, to get @tiptap/* + esbuild
npm run build:notes-editor
```

which is exactly:

```
node_modules/.bin/esbuild notes-editor-vendor.src.js \
  --bundle --minify --format=iife --global-name=RTNotesEditor \
  --target=es2019 --legal-comments=none \
  --outfile=vendor/tiptap-notes.min.js
```

TipTap **2.27.2** (`@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`,
`@tiptap/extension-task-list`, `@tiptap/extension-task-item`). Bundle ≈ **292 KB**
minified (one file, no source map shipped, no CDN).

`scripts/build-www.js` needs no change: it copies `vendor/tiptap-notes.min.js`
automatically because `index.html` references it.

## Storage / rollback model

* Every note has `bodyFormat: "markdown" | "html"`. Missing ⇒ `"markdown"`.
* Legacy notes stay untouched Markdown until the user **edits** one — then, and
  only then, it is saved as HTML with `bodyFormat: "html"` (lazy migration).
* Opening a note never rewrites it.
* IndexedDB schema stays at **v1** — a new string field on a `keyPath` store
  needs no migration.
* Export/import carry `bodyFormat`; an old export without it imports as Markdown.

## How to remove TipTap

Restores the previous Markdown `<textarea>` editor. **No note data is lost** —
existing Markdown notes were never touched; notes edited during the experiment
are stored as HTML and can be converted back with
`PolynNotesMarkdown.htmlToMarkdown()` (or left as-is — see step 5).

1. `git revert` / check out the pre-experiment versions of `notes-ui.js`,
   `notes-store.js`, `index.html`, `styles.css`, `notes-ui.test.js`,
   `notes-store.test.js`, `package.json`, `package-lock.json`.
2. Delete `notes-editor-vendor.src.js`, `notes-markdown.js`,
   `notes-editor.test.js`, `vendor/tiptap-notes.min.js`, this file.
3. `npm install` (drops the `@tiptap/*` + `esbuild` devDependencies).
4. Run `node --test *.test.js`.
5. Optional data cleanup — only if you want the store back to pure Markdown:
   for each note with `bodyFormat === "html"`, set
   `body = PolynNotesMarkdown.htmlToMarkdown(body)` and `bodyFormat = "markdown"`
   **before** removing `notes-markdown.js`. If skipped, the reverted textarea
   simply shows the raw HTML string for those few notes — recoverable, not lost.

The reverted `notes-store.js` ignores the extra `bodyFormat` key on existing
records automatically (`normalizeNote` drops unknown keys), so step 5 is not
required for the app to work.
