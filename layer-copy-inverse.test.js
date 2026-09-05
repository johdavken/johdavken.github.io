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

// A 5-layer line previously only let C/D/E copy from A/B (C<-B, D<-B, E<-A) -
// A and B had no copy button at all, which also meant A/B looked visually
// shorter than C/D/E on mobile's single-layer view. Adding the requested
// inverse pairs (A<-E, B<-D) is a pure data change: copyButton rendering
// (both the desktop matrix <th> and the shared mobile view, since <th>
// carries the same data-layer-column attribute the <td> cells use for
// mobile show/hide) is already fully generic and driven only by whether
// getLayerCopyRules(lineType)[layerName] exists - no new UI code needed.
//
// The 3-layer line's A/C pair was left one-way (C<-A only) when the above
// was done. Same fix, same reasoning: A now also copies from C, matching
// the mutual-pair pattern already used for 5-layer's A/E and B/D.
//
// B (the line's core layer) has since gained its own "Match A" button too,
// but B's split is set independently of the skin layers, so that copy is
// intentionally resin-only - see copyLayerResinOnly and
// layer-copy-b-resin-only.test.js.

test("a 5-layer line now offers both directions for the A/E and B/D pairs, leaving C's existing one-way copy from B untouched", () => {
  const rules = functionBody("getLayerCopyRules");
  const fiveLayerStart = rules.indexOf("if (lineType === 5) return {");
  const fiveLayerEnd = rules.indexOf("};", fiveLayerStart);
  const fiveLayerBody = rules.slice(fiveLayerStart, fiveLayerEnd);
  assert.match(fiveLayerBody, /"A": "E"/, "A must be able to copy from E");
  assert.match(fiveLayerBody, /"B": "D"/, "B must be able to copy from D");
  assert.match(fiveLayerBody, /"C": "B"/, "C's existing rule must be untouched");
  assert.match(fiveLayerBody, /"D": "B"/, "D's existing rule must be untouched");
  assert.match(fiveLayerBody, /"E": "A"/, "E's existing rule must be untouched");
});

test("the 3-layer line's A/C pair is mutual, and B now has its own Match-A button", () => {
  const rules = functionBody("getLayerCopyRules");
  assert.match(rules, /if \(lineType === 3\) return \{ "A": "C", "B": "A", "C": "A" \};/);
});

test("the copy button is still purely driven by copyRules[L.name], appended once per layer's <th>, with a resin-only branch for B's Match-A", () => {
  const renderStart = app.indexOf("const copyFrom = copyRules[L.name];");
  assert.notEqual(renderStart, -1);
  const body = app.slice(renderStart, renderStart + 1300);
  assert.match(body, /copyButton\.textContent = `Match \$\{copyFrom\}`;/);
  assert.match(body, /const resinOnly = isResinOnlyCopyTarget\(state\.lineType, L\.name\);/);
  assert.match(body, /if \(resinOnly\) copyLayerResinOnly\(copyFrom, L\.name\);/);
  assert.match(body, /th\.appendChild\(copyButton\);/);
});

test("<th> carries the same data-layer-column attribute the mobile show/hide mechanism uses on <td>, so the new A/B buttons reach mobile through the exact same path as the existing C/D/E ones - not a separate mobile implementation", () => {
  assert.match(app, /th\.dataset\.layerColumn = L\.name;/);
});

test("copyLayer itself is generic (any fromName -> toName) - the inverse pairs reuse it as-is, not a second copy function", () => {
  const copyLayer = functionBody("copyLayer");
  assert.match(copyLayer, /function copyLayer\(fromName, toName\)\{/);
  assert.match(copyLayer, /to\.hoppers\[i\]\.pct = clampNum\(from\.hoppers\[i\]\.pct\);/);
  assert.match(copyLayer, /to\.hoppers\[i\]\.resinName = normName\(from\.hoppers\[i\]\.resinName\);/);
});
