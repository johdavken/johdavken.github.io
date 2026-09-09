"use strict";

/* A changed stylesheet must ship under a moved ?v= tag.
 *
 * Returning browsers cache on the tag. Changed bytes under an unchanged tag
 * are simply not delivered, and the symptom - a fix that appears to do
 * nothing - looks like a CSS problem rather than a caching one, which is why
 * it has twice sent this project debugging the wrong thing.
 *
 * With styles.css split into parts, the odds get worse rather than better:
 * an edit touches one part, every other tag is legitimately untouched, and
 * nothing about the diff looks incomplete.
 *
 * css-cache-tags.json records the bytes each released tag describes. This
 * compares it to what is on disk. After a real change:
 *
 *   1. bump the file's ?v= in index.html
 *   2. node tools/css-cache-tags.js --update
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { survey, readManifest } = require("./tools/css-cache-tags");

test("no stylesheet has changed without its cache tag moving", () => {
  const stale = survey().rows.filter(r => r.changed && !r.tagMoved);
  assert.deepEqual(stale.map(r => `${r.file} (still ?v=${r.tag})`), [],
    "these stylesheets changed but kept their old ?v= - returning browsers " +
    "will keep serving the cached copy, and the change will look like it did " +
    "nothing. Bump the tag in index.html, then run " +
    "`node tools/css-cache-tags.js --update`.");
});

test("every linked stylesheet is tracked", () => {
  // A new part with no manifest entry is unguarded: it could then change
  // under a frozen tag forever without this test noticing.
  const untracked = survey().rows.filter(r => r.untracked).map(r => r.file);
  assert.deepEqual(untracked, [],
    "run `node tools/css-cache-tags.js --update` to record these");
});

test("the manifest describes exactly what index.html links", () => {
  const stale = survey().stale;
  assert.deepEqual(stale, [],
    "these are recorded but no longer linked - if a part was merged away or " +
    "renamed, re-run the updater");
});

test("every linked stylesheet actually carries a ?v= tag", () => {
  const untagged = survey().rows.filter(r => r.tag === null).map(r => r.file);
  assert.deepEqual(untagged, [],
    "an untagged stylesheet is cached by URL alone and can never be busted");
});

test("recorded hashes match the files on disk right now", () => {
  // The positive form of the first test: after a correct release the manifest
  // and the tree agree completely. If this fails while the others pass, the
  // manifest was updated without the files being committed, or vice versa.
  const drifted = survey().rows
    .filter(r => !r.untracked && r.changed)
    .map(r => `${r.file}: recorded ${r.recordedHash}, on disk ${r.hash}`);
  assert.deepEqual(drifted, [],
    "the manifest is out of date - run `node tools/css-cache-tags.js --update`");
});

test("no two stylesheets are recorded under the same hash", () => {
  // Two identical stylesheets means one is a stray copy, and edits to the
  // original would silently not apply to the duplicate.
  const manifest = readManifest();
  const byHash = new Map();
  for (const [file, entry] of Object.entries(manifest)) {
    const seen = byHash.get(entry.hash);
    assert.equal(seen, undefined, `${file} is byte-identical to ${seen}`);
    byHash.set(entry.hash, file);
  }
});
