"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

// copyLayer/copyLayerResinOnly/isResinOnlyCopyTarget are nested (6-space
// indent) inside renderSplitsArea, not top-level, so functionBody's
// "next top-level function" boundary sweeps in unrelated code after them.
// Slice a small fixed window instead for these three.
function nestedFunctionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const end = app.indexOf("\n      }", start);
  assert.notEqual(end, -1, `Expected closing brace for ${name}`);
  return app.slice(start, end + "\n      }".length);
}

// 3-layer's B is the core layer: its own blend percentages are set
// independently of the skin layers (A/C), so a copy into it must only carry
// over which resin is loaded, never the source layer's blend percentages.
// Every other target keeps copying both pct and resinName via copyLayer().
//
// The fixed-pair "Match X" button this rule was written for is gone - the
// grid header now offers a free Copy / Paste / Cancel between any two layers
// (see recipe-layer-copy-paste.test.js) - but the rule itself is unchanged
// and still keyed on the *target*, so pasting either skin layer into B is
// resin-only exactly as "Match A" was.

test("copyLayerResinOnly copies only resinName, never pct, and is generic on from/to", () => {
  const body = nestedFunctionBody("copyLayerResinOnly");
  assert.match(body, /to\.hoppers\[i\]\.resinName = normName\(from\.hoppers\[i\]\.resinName\);/);
  assert.doesNotMatch(body, /\.pct\s*=/);
  assert.match(body, /const historyBefore=snapshotRecipeEdit\(\);/);
  assert.match(body, /recordRecipeEdit\(historyBefore\);/);
});

test("isResinOnlyCopyTarget flags only 3-layer's B, leaving every other lineType/layer on the normal pct+resin copy", () => {
  const body = nestedFunctionBody("isResinOnlyCopyTarget");
  assert.match(body, /return lineType === 3 && toName === "B";/);
});

test("a paste dispatches to copyLayerResinOnly only for the resin-only target, and to copyLayer otherwise", () => {
  const renderStart = app.indexOf("const canCopy = recipeLayers().length > 1;");
  assert.notEqual(renderStart, -1);
  const body = app.slice(renderStart, renderStart + 1600);
  assert.match(body, /if \(isResinOnlyCopyTarget\(state\.lineType, L\.name\)\) copyLayerResinOnly\(fromName, L\.name\);/);
  assert.match(body, /else copyLayer\(fromName, L\.name\);/);
});

test("the resin-only target's title/aria-label tells the operator percentages are unchanged, unlike a normal paste", () => {
  const body = app.slice(app.indexOf("function layerCopyDescription("), app.indexOf("\n      }", app.indexOf("function layerCopyDescription(")));
  assert.match(body, /Paste Layer \$\{source\}'s resin into Layer \$\{name\} \(percentages unchanged\)/);
  assert.match(body, /Paste Layer \$\{source\} into Layer \$\{name\}/);
});

test("copyLayer (used by every non-B target) is untouched: still copies both pct and resinName", () => {
  const body = nestedFunctionBody("copyLayer");
  assert.match(body, /to\.hoppers\[i\]\.pct = clampNum\(from\.hoppers\[i\]\.pct\);/);
  assert.match(body, /to\.hoppers\[i\]\.resinName = normName\(from\.hoppers\[i\]\.resinName\);/);
});
