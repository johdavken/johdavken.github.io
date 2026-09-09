"use strict";

/* Cache-tag bookkeeping for the linked stylesheets.
 *
 * Every stylesheet in index.html is loaded with a ?v= tag, and returning
 * browsers cache aggressively on it. Shipping changed bytes under an unchanged
 * tag serves the old file, which presents as "the change did nothing" - a
 * misdiagnosis that has cost this project real debugging time more than once.
 *
 * One file made that easy to remember. Splitting styles.css into parts makes
 * it easy to forget: an edit lands in one part, and the other tags are
 * untouched and correct, so nothing looks wrong.
 *
 * So the tags are bookkept. css-cache-tags.json records, per stylesheet, the
 * tag it was last released under and a hash of the bytes that tag describes.
 * css-cache-tags.test.js compares that against what is on disk now and fails
 * when they have diverged. This module holds the shared reading, so the test
 * and the updater cannot disagree about what they are measuring.
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

/** Linked stylesheets in document order: { file, tag } with the ?v= split off. */
function linkedStylesheets() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const out = [];
  const pattern = /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g;
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

/** Content hash of one stylesheet. Short, but far past collision by accident. */
function hashOf(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return {};
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

/* Everything the test needs to judge, computed once and described plainly, so
 * a failure names the file and the fix rather than a diffed blob. */
function survey() {
  const manifest = readManifest();
  const linked = linkedStylesheets();
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

function update() {
  const { rows, stale } = survey();
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
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  const moved = rows.filter(r => r.tagMoved || r.untracked);
  console.log(`Recorded ${rows.length} stylesheets.`);
  for (const r of moved) console.log(`  ${r.file} -> ?v=${r.tag}`);
  for (const file of stale) console.log(`  dropped ${file} (no longer linked)`);
}

module.exports = { linkedStylesheets, hashOf, readManifest, survey, MANIFEST };

if (require.main === module) {
  if (process.argv.includes("--update")) update();
  else {
    const { rows, stale } = survey();
    for (const r of rows) {
      const state = r.untracked ? "UNTRACKED" : r.changed ? (r.tagMoved ? "changed, tag moved" : "CHANGED, TAG STALE") : "current";
      console.log(`${r.file.padEnd(28)} ?v=${String(r.tag).padEnd(10)} ${state}`);
    }
    for (const file of stale) console.log(`${file.padEnd(28)} ${"".padEnd(14)} STALE MANIFEST ENTRY`);
  }
}
