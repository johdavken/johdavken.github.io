"use strict";

// Emptying a hopper from Edit view.
//
// The per-cell × that used to do this is gone from both views (it was too
// small to hit on a phone, and #splitsArea[data-recipe-view] .splitClearButton
// now hides it). Its replacement, the Edit panel's own button, exists in both
// toolbar templates - but on compact mobile that panel renders inside the
// bulk-edit sheet, where .mobileBulkEditSheet .splitsBulkActions is
// display:none. So on a phone there was no way at all to empty a hopper.
//
// Two things fix that: the persistent context bar gains its own Empty, and
// the vocabulary stops overloading one word. "Clear" now only ever means
// "drop the selection"; "Empty" means "erase what is in the cells". The two
// used to sit side by side as Clear selection / Clear cell contents.

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
  // Selection actions.
  assert.match(splitsArea, /<button id="clearSplitSelection" type="button" class="bulkTextAction">Clear selection<\/button>/);
  assert.match(splitsArea, /<button type="button" class="mobileBulkClear" disabled>Clear<\/button>/);
  // Content actions.
  assert.match(splitsArea, /<button id="clearSelectedCells" type="button" class="bulkTextAction" disabled>Empty cells<\/button>/);
  assert.match(splitsArea, /<button type="button" class="mobileBulkEmpty" disabled>Empty<\/button>/);
  // The old overloaded label is gone from both toolbar templates.
  assert.doesNotMatch(splitsArea, /Clear cell contents/);
});

test("the mobile bar's Clear still only drops the selection, and Empty is a separate button", () => {
  const clear = splitsArea.slice(splitsArea.indexOf('mobileBulkClear.addEventListener("click"'));
  const body = clear.slice(0, clear.indexOf("\n      });") + 9);
  assert.doesNotMatch(body, /hopper|resinName|pct|track/);
  // Two distinct elements, not one button that changes meaning.
  assert.match(splitsArea, /const mobileBulkClear = mobileBulkContext\.querySelector\("\.mobileBulkClear"\);/);
  assert.match(splitsArea, /const mobileBulkEmpty = mobileBulkContext\.querySelector\("\.mobileBulkEmpty"\);/);
});

/* ----------------------------------------------------------------------
 *   Reachability
 * -------------------------------------------------------------------- */

test("Empty is in the persistent bar, which is the only Edit chrome a phone actually shows", () => {
  assert.match(splitsArea, /<button type="button" class="mobileBulkEmpty" disabled>Empty<\/button>/);
  // The Edit panel's own copy remains unreachable on a phone; this is why the
  // bar needs its own button rather than a link into the sheet.
  assert.match(styles, /\.mobileBulkEditSheet \.splitsBulkActions,/);
});

// Measured in Chrome at 360px: as a grid the count was the only flexible
// track, so four actions plus the count left it 0px wide and it disappeared
// entirely. Wrapping keeps every item legible at 360px (count on its own
// line, actions beneath) and degrades by wrapping again at 320px rather than
// overflowing the panel.
test("the bar wraps instead of squeezing the live count out of existence", () => {
  assert.match(styles, /\.mobileBulkContext\{[\s\S]*?display:flex;[\s\S]*?flex-wrap:wrap;/);
  // The count leads the bar and claims a whole line.
  assert.match(styles, /\.mobileBulkCount\{flex:1 0 100%;/);
  assert.match(splitsArea, /mobileBulkContext\.innerHTML = `\s*\n\s*<strong class="mobileBulkCount"/);
  // The primary action stays pinned right, where it sat before the reflow.
  assert.match(styles, /\.mobileBulkContext \.mobileBulkEditSelected\{margin-left:auto\}/);
});

test("both buttons run the same handler, so the two surfaces cannot drift", () => {
  assert.match(splitsArea, /clearCellsButton\?\.addEventListener\("click", emptySelectedCells\);/);
  assert.match(splitsArea, /mobileBulkEmpty\.addEventListener\("click", emptySelectedCells\);/);
});

test("Empty is tinted apart from Clear - one slot away, and only one of them destroys anything", () => {
  assert.match(styles, /\.mobileBulkContext \.mobileBulkEmpty:not\(:disabled\)\{color:var\(--bad\)\}/);
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
  assert.match(splitsArea, /mobileBulkEmpty\.disabled=emptyable===0;/);
  // Selecting is still tracked by size - only emptying changed.
  assert.match(splitsArea, /mobileBulkClear\.disabled=selected\.size===0;/);
  assert.match(splitsArea, /mobileBulkEditSelected\.disabled=selected\.size===0;/);
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
