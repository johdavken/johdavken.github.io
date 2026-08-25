"use strict";

// Emptying a hopper from Edit view.
//
// The per-cell × that used to do this is gone from both views (it was too
// small to hit on a phone, and #splitsArea[data-recipe-view] .splitClearButton
// now hides it). Its replacement is the shared inline Edit panel used by
// phone and tablet. "Clear selection" only drops the working selection;
// "Empty cells" erases the selected hopper assignments.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

const splitsArea = functionBody("renderSplitsArea");

function handlerBody(name){
  const start = splitsArea.indexOf(`function ${name}(){`);
  assert.notEqual(start, -1, `Expected ${name}`);
  const end = splitsArea.indexOf("\n      }", start);
  assert.ok(end > start, `Expected ${name} to close`);
  return splitsArea.slice(start, end + 8);
}

/* ----------------------------------------------------------------------
 *   One word per action
 * -------------------------------------------------------------------- */

test("Clear and Empty mean different things and never trade places", () => {
  assert.match(splitsArea, /<button id="clearSplitSelection"[^>]*data-button-variant="quiet"[^>]*>Clear selection<\/button>/);
  assert.match(splitsArea, /<button id="clearSelectedCells"[^>]*data-button-variant="quiet"[^>]*disabled>Empty cells<\/button>/);
  assert.doesNotMatch(splitsArea, /Clear cell contents/);
});

test("Clear selection only drops the selection, while Empty has its own handler", () => {
  const clear = splitsArea.slice(splitsArea.indexOf('toolbar.querySelector("#clearSplitSelection").addEventListener'));
  const body = clear.slice(0, clear.indexOf("\n      });") + 9);
  assert.doesNotMatch(body, /hopper|resinName|pct|track/);
  assert.match(splitsArea, /clearCellsButton\?\.addEventListener\("click", emptySelectedCells\);/);
});

/* ----------------------------------------------------------------------
 *   Reachability
 * -------------------------------------------------------------------- */

test("Empty remains reachable in the compact inline panel", () => {
  assert.match(styles, /#splitsArea \.splitsEditRowSecondary :is\(\.bulkTextAction,button\.danger\)/);
  assert.match(splitsArea, /clearCellsButton\?\.addEventListener\("click", emptySelectedCells\);/);
});

/* ----------------------------------------------------------------------
 *   When it is offered
 * -------------------------------------------------------------------- */

test("availability tracks what is in the selection, not how big it is", () => {
  const count = handlerBody("emptyableHopperCount");
  // The same condition refreshCellState() uses for a cell's own clearable
  // state, so the button and the cells agree on what "empty" means.
  assert.match(count, /!!normName\(ref\.hopper\.resinName\)/);
  assert.match(count, /\(ref\.hi > 0 && clampNum\(ref\.hopper\.pct\) > 0\)/);
  assert.match(count, /!!ref\.hopper\.track/);
  // H1's percentage is derived, so it is never on its own a reason to empty.
  assert.doesNotMatch(count, /ref\.hi >= 0|ref\.hi === 0/);

  assert.match(splitsArea, /const emptyable = emptyableHopperCount\(\);\s*\n\s*if \(clearCellsButton\) clearCellsButton\.disabled = emptyable === 0;/);
  assert.match(splitsArea, /applyButton\.disabled = selected\.size === 0 \|\| !hasBulkValue\(\);/);
});

/* ----------------------------------------------------------------------
 *   What it does
 * -------------------------------------------------------------------- */

test("one hopper goes immediately; more than one asks first", () => {
  const body = handlerBody("emptySelectedCells");
  assert.match(body, /if \(!emptyable\) return;/);
  assert.match(body, /if \(emptyable > 1 && !confirm\(`Empty \$\{emptyable\} hoppers\?/);
  // The count in the prompt is what will actually be emptied, not the
  // selection size - selecting a whole layer to empty two hoppers must not
  // claim six.
  assert.doesNotMatch(body, /confirm\([\s\S]{0,80}selected\.size/);
});

test("it empties only the selected hoppers and recomputes each affected layer's derived H1", () => {
  const body = handlerBody("emptySelectedCells");
  assert.match(body, /ref\.hopper\.resinName = "";\s*\n\s*ref\.hopper\.track = false;/);
  assert.match(body, /if \(ref\.hi > 0\)\{\s*\n\s*ref\.hopper\.pct = 0;/);
  assert.match(body, /touchedLayers\.forEach\(L=>\{\s*\n\s*recomputeAutoH1\(L\);/);
  // Scanned lots survive: only Reset Recipe, which wipes the whole page,
  // goes that far.
  assert.doesNotMatch(body, /resinLots/);
  // Persisted and synced, exactly as before the extraction.
  assert.match(body, /validateAndCompute\(\{ sync: true, immediate: true, kind: "recipe-clear" \}\);/);
  assert.match(body, /saveSession\(\);/);
});

test("emptying works on whichever page is showing, because it goes through the cell refs", () => {
  const body = handlerBody("emptySelectedCells");
  // cellRefs are built from recipeLayers(), so Next's plan is emptied by the
  // same handler without it knowing two pages exist.
  assert.match(body, /cellRefs\.get\(key\)/);
  assert.doesNotMatch(body, /state\.layers/);
});
