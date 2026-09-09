"use strict";

// ux-tablet-desktop-update1: the per-layer header button in the Recipe grid
// stops being "Match X" and becomes a Copy / Paste / Cancel tri-state.
//
// "Match X" hard-coded one source per layer (getLayerCopyRules: on a 5-layer
// line C and D could only ever match B, E only A, and so on), so copying
// D into C was simply not offered. The replacement has no pairs at all:
//
//   nothing armed   -> every layer's button reads "Copy"
//   layer X armed   -> X reads "Cancel", every other layer reads "Paste"
//
// A paste is a single act - it disarms, so every button returns to "Copy"
// immediately after. Cancel is the way out without pasting.
//
// Tablet and desktop only. The compact phone grid hides .splitCopyBtn and
// keeps its own selection-based Copy / Paste hoppers pair in the Edit
// toolbar, which this change does not touch.
//
// The one product rule that survives from "Match X" is the resin-only copy
// into a 3-layer line's B: B is the core layer and its split is set
// independently of the skins, so a paste into it carries resin only. See
// layer-copy-b-resin-only.test.js, which still pins that end of it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const app = fs.readFileSync("app.js", "utf8");
const styles = readStyles();
const buttons = fs.readFileSync("button-styling.css", "utf8");

function renderBody(){
  const start = app.indexOf("function renderSplitsArea(){");
  assert.notEqual(start, -1);
  const end = app.indexOf("\n    function renderDesktopRailTotals(", start);
  assert.notEqual(end, -1);
  return app.slice(start, end);
}

function fn(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const end = app.indexOf("\n      }", start);
  assert.notEqual(end, -1);
  return app.slice(start, end + "\n      }".length);
}

/* -------------------------------------------------------------------
 *   The fixed pairs are gone
 * ------------------------------------------------------------------- */

test("getLayerCopyRules and its copyRules lookup no longer exist - any layer can now feed any other, so there is nothing left to look up", () => {
  assert.doesNotMatch(app, /function getLayerCopyRules\(/, "the rules table itself is gone");
  assert.doesNotMatch(app, /= getLayerCopyRules\(/, "and nothing calls it");
  assert.doesNotMatch(app, /copyRules\[/, "and nothing reads a per-layer source out of one");
  assert.doesNotMatch(app, /`Match \$\{/, "no Match label is built anywhere");
});

test("copyLayer stays generic (any fromName -> toName) - it is what a paste calls, unchanged", () => {
  const body = fn("copyLayer");
  assert.match(body, /function copyLayer\(fromName, toName\)\{/);
  assert.match(body, /to\.hoppers\[i\]\.pct = clampNum\(from\.hoppers\[i\]\.pct\);/);
  assert.match(body, /to\.hoppers\[i\]\.resinName = normName\(from\.hoppers\[i\]\.resinName\);/);
  // Still one undo step per copy, so a paste is one undo away.
  assert.match(body, /const historyBefore=snapshotRecipeEdit\(\);/);
  assert.match(body, /recordRecipeEdit\(historyBefore\);/);
});

/* -------------------------------------------------------------------
 *   The armed layer
 * ------------------------------------------------------------------- */

test("recipeLayerCopySource is module-level runtime state, declared beside the phone's own clipboard", () => {
  assert.match(app, /let recipeCellClipboard = null;[\s\S]{0,900}?let recipeLayerCopySource = null;/);
});

test("it is never persisted or synced - it appears as no key in any payload object", () => {
  assert.doesNotMatch(app, /recipeLayerCopySource\s*:/, "an object-literal key would put it in a session/active-job/recipe payload");
});

test("switching Recipe page disarms it - Layer A on Current and Layer A on Next are different recipes", () => {
  const setPage = app.slice(app.indexOf("function setRecipePage(page){"), app.indexOf("\n    }", app.indexOf("function setRecipePage(page){")));
  assert.match(setPage, /activeRecipePage = next;[\s\S]*?recipeLayerCopySource = null;/);
});

test("a layer that stops existing disarms it too - a 5->3 line-type change can strip the armed layer out from under the grid", () => {
  const sync = fn("syncLayerCopyButtons");
  assert.match(sync, /if \(recipeLayerCopySource && !layerCopyButtons\.has\(recipeLayerCopySource\)\) recipeLayerCopySource = null;/);
});

/* -------------------------------------------------------------------
 *   The three states
 * ------------------------------------------------------------------- */

test("syncLayerCopyButtons is the single owner of every button's label and state", () => {
  const sync = fn("syncLayerCopyButtons");
  assert.match(sync, /const mode = !source \? "copy" : source === name \? "cancel" : "paste";/);
  assert.match(sync, /button\.dataset\.layerCopyState = mode;/);
  assert.match(sync, /button\.textContent = mode === "copy" \? "Copy" : mode === "cancel" \? "Cancel" : "Paste";/);
  assert.match(sync, /button\.setAttribute\("aria-label", description\);/);
  assert.match(sync, /button\.title = description;/);
  // The armed layer's own header is ringed.
  assert.match(sync, /button\.closest\("th"\)\?\.classList\.toggle\("layerCopySource", mode === "cancel"\);/);
});

test("each state gets its own description, and Paste keeps the resin-only wording for a 3-layer B target", () => {
  const describe = app.slice(app.indexOf("function layerCopyDescription("), app.indexOf("\n      }", app.indexOf("function layerCopyDescription(")));
  assert.match(describe, /if \(mode === "copy"\) return `Copy Layer \$\{name\}`;/);
  assert.match(describe, /if \(mode === "cancel"\) return `Cancel copying Layer \$\{name\}`;/);
  assert.match(describe, /isResinOnlyCopyTarget\(state\.lineType, name\)/);
  assert.match(describe, /Paste Layer \$\{source\}'s resin into Layer \$\{name\} \(percentages unchanged\)/);
  assert.match(describe, /Paste Layer \$\{source\} into Layer \$\{name\}/);
});

test("the initial labels are applied once the headers exist, alongside the other post-build passes", () => {
  const body = renderBody();
  assert.match(body, /updateHopperTotals\(\);\s*\n\s*updateTrackingUI\(\);[\s\S]{0,220}?syncLayerCopyButtons\(\);/);
});

/* -------------------------------------------------------------------
 *   The button itself
 * ------------------------------------------------------------------- */

test("every layer gets a button when there is more than one layer; a single-layer line gets none and keeps .noCopy", () => {
  const body = renderBody();
  assert.match(body, /const canCopy = recipeLayers\(\)\.length > 1;\s*\n\s*th\.classList\.toggle\("noCopy", !canCopy\);\s*\n\s*if \(canCopy\)\{/);
  assert.match(body, /copyButton\.className = "copyBtn splitCopyBtn";/);
  assert.match(body, /copyButton\.dataset\.layerCopyTarget = L\.name;/);
  assert.match(body, /layerCopyButtons\.set\(L\.name, copyButton\);/);
  assert.match(body, /th\.appendChild\(copyButton\);/);
});

test("arming and cancelling relabel in place rather than re-rendering - a copy must never clear the operator's cell selection", () => {
  const body = renderBody();
  const handler = body.slice(body.indexOf('copyButton.addEventListener("click"'), body.indexOf("th.appendChild(copyButton);"));
  assert.match(handler, /if \(!recipeLayerCopySource\)\{\s*\n\s*recipeLayerCopySource = L\.name;\s*\n\s*syncLayerCopyButtons\(\);\s*\n\s*return;\s*\n\s*\}/);
  assert.match(handler, /if \(recipeLayerCopySource === L\.name\)\{\s*\n\s*recipeLayerCopySource = null;\s*\n\s*syncLayerCopyButtons\(\);\s*\n\s*return;\s*\n\s*\}/);
  // Only the paste branch - which actually changes hopper values - rebuilds.
  assert.equal((handler.match(/renderSplitsArea\(\);/g) || []).length, 1);
});

test("a paste is a single act: it disarms before the re-render, so every button is back to Copy straight after", () => {
  const body = renderBody();
  const handler = body.slice(body.indexOf('copyButton.addEventListener("click"'), body.indexOf("th.appendChild(copyButton);"));
  assert.match(handler, /recipeLayerCopySource = null;\s*\n\s*renderSplitsArea\(\);/);
});

test("a paste routes through the same two copy functions Match X used, with the 3-layer B exception intact, and still validates and saves", () => {
  const body = renderBody();
  const handler = body.slice(body.indexOf('copyButton.addEventListener("click"'), body.indexOf("th.appendChild(copyButton);"));
  assert.match(handler, /const fromName = recipeLayerCopySource;/);
  assert.match(handler, /if \(isResinOnlyCopyTarget\(state\.lineType, L\.name\)\) copyLayerResinOnly\(fromName, L\.name\);/);
  assert.match(handler, /else copyLayer\(fromName, L\.name\);/);
  assert.match(handler, /validateAndCompute\(\{ sync: true \}\);/);
  assert.match(handler, /saveSession\(\);/);
});

/* -------------------------------------------------------------------
 *   Presentation
 * ------------------------------------------------------------------- */

test("the labels are uppercased in CSS, not in the text - the accessible name stays ordinary sentence case", () => {
  assert.match(styles, /\.splitCopyBtn\[data-layer-copy-state\]\{\s*\n\s*text-transform:uppercase;/);
});

test("PASTE is the only state that takes the accent; CANCEL stays quiet and the armed layer is marked by an inset ring that cannot shift the grid", () => {
  assert.match(styles, /\.splitCopyBtn\[data-layer-copy-state="paste"\]\{[\s\S]*?color:var\(--focus-border\);/);
  assert.match(styles, /\.splitCopyBtn\[data-layer-copy-state="cancel"\]\{\s*\n\s*color:var\(--muted\);\s*\n\}/);
  const ring = styles.slice(styles.indexOf(".splitsMatrix th.splitLayerHeader.layerCopySource{"));
  assert.match(ring.slice(0, 400), /box-shadow:inset 0 0 0 1px var\(--focus-border\);/);
});

test("both wide-grid orientations render the control as plain text, not a key - a chip in the Layers Top header cell crowded the layer letter and its percentage field", () => {
  const top = "[data-recipe-orientation=\"top\"] .splitCopyBtn{";
  const rule = styles.slice(styles.indexOf(top), styles.indexOf("}", styles.indexOf(top)) + 1);
  assert.notEqual(styles.indexOf(top), -1);
  for (const stripped of [/border:0;/, /border-radius:0;/, /background:none;/, /box-shadow:none;/, /padding:0;/]){
    assert.match(rule, stripped, "the key chrome comes off in Layers Top too");
  }
  assert.match(rule, /color:var\(--muted\);/);
  // Layers Left has read this way since before the tri-state.
  assert.match(styles, /\[data-recipe-layout="transposed"\] \.splitsMatrix tbody \.splitCopyBtn\{[\s\S]*?background:none;/);
});

test("each orientation restates the PASTE accent at its own specificity, since both outrank button-styling.css's key colours", () => {
  // Layers down the side.
  assert.match(styles, /\[data-recipe-layout="transposed"\] \.splitsMatrix tbody \.splitCopyBtn\[data-layer-copy-state="paste"\]\{\s*\n\s*color:var\(--focus-border\);/);
  // Layers across the top - its own base rule above is more specific than
  // button-styling.css, so the accent has to be restated at that level too.
  assert.match(styles, /\[data-recipe-orientation="top"\] \.splitCopyBtn\[data-layer-copy-state="paste"\]\{\s*\n\s*color:var\(--focus-border\);/);
});

test("button-styling.css still carries the states for any surface that keeps the console-key treatment", () => {
  assert.match(buttons, /body #splitsArea\[data-recipe-view="edit"\] \.splitCopyBtn\[data-layer-copy-state="paste"\]\{[\s\S]*?color: var\(--btnstyle-accent\);/);
  assert.match(buttons, /body #splitsArea\[data-recipe-view="edit"\] \.splitCopyBtn\[data-layer-copy-state="cancel"\]\{[\s\S]*?color: var\(--muted\);/);
  assert.match(buttons, /body\[data-shell="touch"\] #splitsArea\[data-recipe-view="edit"\] \.splitCopyBtn\[data-layer-copy-state="paste"\]\{[\s\S]*?color: var\(--btnstyle-accent\);/);
  assert.match(buttons, /body\[data-shell="touch"\] #splitsArea\[data-recipe-view="edit"\] \.splitCopyBtn\[data-layer-copy-state="cancel"\]\{[\s\S]*?color: var\(--muted\);/);
});

/* -------------------------------------------------------------------
 *   The phone is untouched
 * ------------------------------------------------------------------- */

test("the compact phone grid still hides the per-layer button entirely and keeps its own selection-based Copy / Paste hoppers pair", () => {
  assert.match(styles, /\.splitsMatrix\.compactMobileRecipe \.splitCopyBtn\{ display:none; \}/);
  assert.match(app, /id="copySelectedCells"/);
  assert.match(app, /id="pasteSelectedCells"/);
  assert.match(app, /copyCellsButton\?\.addEventListener\("click", copySelectedHoppers\);/);
  assert.match(app, /pasteCellsButton\?\.addEventListener\("click", pasteHoppersIntoSelection\);/);
});
