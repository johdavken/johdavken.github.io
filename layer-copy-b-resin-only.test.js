"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

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
// independently of the skin layers (A/C), so its "Match A" button must only
// carry over which resin is loaded, never A's blend percentages. Every
// other copy pair (A<-C, C<-A, and all 5-layer pairs) keeps copying both
// pct and resinName via the existing copyLayer().

test("B gets a Match-A rule alongside the existing mutual A/C pair", () => {
  const rules = functionBody("getLayerCopyRules");
  const threeLayerStart = rules.indexOf("if (lineType === 3) return {");
  const threeLayerEnd = rules.indexOf("};", threeLayerStart);
  const threeLayerBody = rules.slice(threeLayerStart, threeLayerEnd);
  assert.match(threeLayerBody, /"A": "C"/);
  assert.match(threeLayerBody, /"B": "A"/);
  assert.match(threeLayerBody, /"C": "A"/);
});

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

test("the Match button dispatches to copyLayerResinOnly only for the resin-only target, and to copyLayer otherwise", () => {
  const renderStart = app.indexOf("const copyFrom = copyRules[L.name];");
  assert.notEqual(renderStart, -1);
  const body = app.slice(renderStart, renderStart + 1300);
  assert.match(body, /if \(resinOnly\) copyLayerResinOnly\(copyFrom, L\.name\);/);
  assert.match(body, /else copyLayer\(copyFrom, L\.name\);/);
});

test("the resin-only button's title/aria-label tells the operator percentages are unchanged, unlike the normal Match buttons", () => {
  const renderStart = app.indexOf("const copyFrom = copyRules[L.name];");
  const body = app.slice(renderStart, renderStart + 1300);
  assert.match(body, /Copy Layer \$\{copyFrom\}'s resin into Layer \$\{L\.name\} \(percentages unchanged\)/);
  assert.match(body, /Make Layer \$\{L\.name\} match Layer \$\{copyFrom\}/);
});

test("copyLayer (used by every non-B pair) is untouched: still copies both pct and resinName", () => {
  const body = nestedFunctionBody("copyLayer");
  assert.match(body, /to\.hoppers\[i\]\.pct = clampNum\(from\.hoppers\[i\]\.pct\);/);
  assert.match(body, /to\.hoppers\[i\]\.resinName = normName\(from\.hoppers\[i\]\.resinName\);/);
});
