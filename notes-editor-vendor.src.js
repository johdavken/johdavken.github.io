// -----------------------------------------------------------------------------
//  RT Notes — TipTap vendor entry  (EXPERIMENT, isolated from the rest of the app)
// -----------------------------------------------------------------------------
//
//  This file is NOT loaded by the browser. It is the single esbuild entry point
//  whose only job is to pull in the minimum TipTap pieces RT Notes needs and
//  re-export them. esbuild bundles it into a committed, self-contained IIFE:
//
//      vendor/tiptap-notes.min.js   ->   window.RTNotesEditor
//
//  The app keeps consuming plain globals with classic <script defer> tags; no
//  bundler, no modules, no CDN, fully offline. Nothing else in the app imports
//  from here.
//
//  REGENERATE THE BUNDLE (run from the repo root after `npm install`):
//
//      npm run build:notes-editor
//
//  which is exactly:
//
//      node_modules/.bin/esbuild notes-editor-vendor.src.js \
//        --bundle --minify --format=iife --global-name=RTNotesEditor \
//        --target=es2019 --legal-comments=none \
//        --outfile=vendor/tiptap-notes.min.js
//
//  TipTap packages pinned in package.json devDependencies (all 2.27.2):
//      @tiptap/core  @tiptap/pm  @tiptap/starter-kit
//      @tiptap/extension-task-list  @tiptap/extension-task-item
//
//  To remove the experiment: delete this file, vendor/tiptap-notes.min.js, the
//  <script> tag in index.html, the build:notes-editor script, and the five
//  @tiptap/* + esbuild devDependencies. See "How to remove TipTap" in the PR.
// -----------------------------------------------------------------------------

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";

// Re-exported verbatim; notes-ui.js composes the actual editor config so all
// RT Notes behaviour stays in the app, not in this vendor shim.
export { Editor, StarterKit, TaskList, TaskItem };
