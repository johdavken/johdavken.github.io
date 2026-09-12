"use strict";

/* A changed script must ship under a moved ?v= tag - the stylesheet rule
 * (css-cache-tags.test.js), applied to the scripts index.html loads.
 *
 * How this was learned, the third time: Station's own modules are loaded by
 * station-host.js under its VERSION constant, which moves with every Station
 * change; app.js is loaded by index.html under a tag that two commits and a
 * working tree of app.js changes had not moved. A returning browser ran a
 * brand-new Station UI over a cached app.js from before the executor - and
 * before the state bridge. Station, correctly, found no application on either
 * bridge, fell back to the demo line, and told the operator that "no
 * application is connected to Station commands". Every word true; the tag was
 * stale.
 *
 * script-cache-tags.json records the bytes each released tag describes. After
 * a real change:
 *
 *   1. bump the file's ?v= in index.html
 *   2. node tools/css-cache-tags.js --update
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { survey, readManifest, linkedScripts } = require("./tools/css-cache-tags");

test("no script has changed without its cache tag moving", () => {
  const stale = survey("js").rows.filter(r => r.changed && !r.tagMoved);
  assert.deepEqual(stale.map(r => `${r.file} (still ?v=${r.tag})`), [],
    "these scripts changed but kept their old ?v= - returning browsers will " +
    "keep running the cached copy under the new stylesheets and the new " +
    "Station modules, and the change will look like a missing connection. " +
    "Bump the tag in index.html, then run `node tools/css-cache-tags.js --update`.");
});

test("every linked script is tracked", () => {
  const untracked = survey("js").rows.filter(r => r.untracked).map(r => r.file);
  assert.deepEqual(untracked, [],
    "run `node tools/css-cache-tags.js --update` to record these");
});

test("the script manifest describes exactly what index.html loads", () => {
  assert.deepEqual(survey("js").stale, [],
    "these are recorded but no longer loaded - re-run the updater");
});

test("every linked script actually carries a ?v= tag", () => {
  const untagged = survey("js").rows.filter(r => r.tag === null).map(r => r.file);
  assert.deepEqual(untagged, [],
    "an untagged script is cached by URL alone and can never be busted");
});

test("recorded hashes match the scripts on disk right now", () => {
  const drifted = survey("js").rows
    .filter(r => !r.untracked && r.changed)
    .map(r => `${r.file}: recorded ${r.recordedHash}, on disk ${r.hash}`);
  assert.deepEqual(drifted, [],
    "the manifest is out of date - run `node tools/css-cache-tags.js --update`");
});

test("the manifest covers app.js and every Station runtime file index.html loads", () => {
  // The files whose staleness produced the symptom, named so the guard
  // cannot quietly stop covering them if the survey's pattern ever narrows.
  const manifest = readManifest("js");
  for (const file of ["app.js", "station-host.js", "station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js", "station-connection-bridge.js"]) {
    assert.ok(manifest[file], `${file} is not in script-cache-tags.json`);
    assert.ok(linkedScripts().some(r => r.file === file), `${file} is not loaded by index.html`);
  }
});

test("the stylesheet survey is untouched by the script survey", () => {
  // survey() with no kind is the stylesheet reading it always was.
  const css = survey();
  assert.ok(css.rows.length > 0);
  assert.ok(css.rows.every(r => r.file.endsWith(".css")));
  assert.ok(survey("js").rows.every(r => r.file.endsWith(".js")));
});
