"use strict";

/* Cache-tag bookkeeping for the linked stylesheets and scripts.
 *
 * Every stylesheet and script in index.html is loaded with a ?v= tag, and
 * returning browsers cache aggressively on it. Shipping changed bytes under
 * an unchanged tag serves the old file, which presents as "the change did
 * nothing" - a misdiagnosis that has cost this project real debugging time
 * more than once.
 *
 * One file made that easy to remember. Splitting styles.css into parts makes
 * it easy to forget: an edit lands in one part, and the other tags are
 * untouched and correct, so nothing looks wrong.
 *
 * Scripts fail the same way, and worse: Station's own modules are loaded by
 * station-host.js under its own VERSION, which moves with every Station
 * change, while app.js is loaded by index.html under a tag nobody moved.
 * A returning browser then runs a brand-new Station UI over a cached app.js
 * that predates the executor - and Station, finding no application on its
 * bridges, correctly falls back to demo data and reads read-only. The
 * symptom looked like a missing connection; it was a stale tag.
 *
 * So the tags are bookkept. css-cache-tags.json and script-cache-tags.json
 * record, per file, the tag it was last released under and a hash of the
 * bytes that tag describes. The tests compare that against what is on disk
 * now and fail when they have diverged. This module holds the shared
 * reading, so the tests and the updater cannot disagree about what they are
 * measuring.
 *
 * To record a release:   node tools/css-cache-tags.js --update
 *
 * The updater refuses to record a changed file whose tag has not moved, so
 * it cannot be used to make a real failure go away.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "css-cache-tags.json");
const SCRIPT_MANIFEST = path.join(ROOT, "script-cache-tags.json");

/* The two kinds of linked asset, each with the attribute that names it and
 * the manifest that records it. */
const KINDS = Object.freeze({
  css: Object.freeze({ pattern: /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g, manifest: MANIFEST, noun: "stylesheets" }),
  js: Object.freeze({ pattern: /<script\b[^>]*src="([^"]+)"/g, manifest: SCRIPT_MANIFEST, noun: "scripts" })
});

function kindOf(kind) {
  return KINDS[kind === "js" ? "js" : "css"];
}

/** Linked assets of one kind in document order: { file, tag } with the ?v= split off. */
function linkedAssets(kind) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const out = [];
  const pattern = new RegExp(kindOf(kind).pattern.source, "g");
  let match;
  while ((match = pattern.exec(html))) {
    const href = match[1];
    if (/^[a-z]+:/i.test(href) || href.startsWith("//")) continue; // remote, not ours to version
    const [file, query = ""] = href.split("?");
    const tag = /(?:^|&)v=([^&]*)/.exec(query);
    out.push({ file, tag: tag ? tag[1] : null });
  }
  return out;
}

/** Linked stylesheets in document order: { file, tag } with the ?v= split off. */
function linkedStylesheets() {
  return linkedAssets("css");
}

/** Linked scripts in document order, the same shape. */
function linkedScripts() {
  return linkedAssets("js");
}

/** Content hash of one file. Short, but far past collision by accident. */
function hashOf(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function readManifest(kind) {
  const file = kindOf(kind).manifest;
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/* Everything the test needs to judge, computed once and described plainly, so
 * a failure names the file and the fix rather than a diffed blob. `kind` is
 * "css" (the default, so every existing caller reads as before) or "js". */
function survey(kind) {
  const manifest = readManifest(kind);
  const linked = linkedAssets(kind);
  const rows = linked.map(({ file, tag }) => {
    const recorded = manifest[file] || null;
    const hash = fs.existsSync(path.join(ROOT, file)) ? hashOf(file) : null;
    return {
      file,
      tag,
      hash,
      recordedTag: recorded ? recorded.v : null,
      recordedHash: recorded ? recorded.hash : null,
      untracked: !recorded,
      changed: recorded ? recorded.hash !== hash : false,
      tagMoved: recorded ? recorded.v !== tag : false,
    };
  });
  const linkedFiles = new Set(linked.map(r => r.file));
  const stale = Object.keys(manifest).filter(file => !linkedFiles.has(file));
  return { rows, stale };
}

function update(kind) {
  const { rows, stale } = survey(kind);
  const blocked = rows.filter(r => r.changed && !r.tagMoved);
  if (blocked.length) {
    console.error("Refusing to update. These files changed but their ?v= did not move:\n");
    for (const r of blocked) console.error(`  ${r.file}  still at ?v=${r.tag}`);
    console.error("\nBump the tag in index.html first. Recording the new bytes under the");
    console.error("old tag would tell returning browsers nothing changed.");
    process.exit(1);
  }
  const manifest = {};
  for (const r of rows) manifest[r.file] = { v: r.tag, hash: r.hash };
  fs.writeFileSync(kindOf(kind).manifest, JSON.stringify(manifest, null, 2) + "\n");
  const moved = rows.filter(r => r.tagMoved || r.untracked);
  console.log(`Recorded ${rows.length} ${kindOf(kind).noun}.`);
  for (const r of moved) console.log(`  ${r.file} -> ?v=${r.tag}`);
  for (const file of stale) console.log(`  dropped ${file} (no longer linked)`);
}

function report(kind) {
  const { rows, stale } = survey(kind);
  for (const r of rows) {
    const state = r.untracked ? "UNTRACKED" : r.changed ? (r.tagMoved ? "changed, tag moved" : "CHANGED, TAG STALE") : "current";
    console.log(`${r.file.padEnd(40)} ?v=${String(r.tag).padEnd(10)} ${state}`);
  }
  for (const file of stale) console.log(`${file.padEnd(40)} ${"".padEnd(14)} STALE MANIFEST ENTRY`);
}

module.exports = { linkedStylesheets, linkedScripts, hashOf, readManifest, survey, MANIFEST, SCRIPT_MANIFEST };

if (require.main === module) {
  // Both kinds, always: a release that moves one tag and not the other is
  // exactly the case this exists to catch.
  for (const kind of ["css", "js"]) {
    if (process.argv.includes("--update")) update(kind);
    else report(kind);
  }
}
