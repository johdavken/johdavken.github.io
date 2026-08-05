"use strict";

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

// --- Bulk edit no longer pushes the panel down on mobile -----------------

test("the action row, bulk-edit toolbar, and active-rearrange mode bar all reorder below the panel on mobile", () => {
  assert.match(styles, /@media\(max-width:900px\)\{\s*#splitsArea > \.splitsMatrixActions,\s*#splitsArea > \.splitsBulkBar,\s*#splitsArea > \.rearrangeModeBar\{ order:1; position:static; \}\s*\}/);
});

test("both reordered bars also drop their sticky-to-top positioning, so they can't jump/force-scroll once moved after the table", () => {
  const reorderRuleStart = styles.indexOf("@media(max-width:900px){\n  #splitsArea");
  const reorderRule = styles.slice(reorderRuleStart, styles.indexOf("}\n", reorderRuleStart) + 2);
  assert.match(reorderRule, /position:static/);
  // Both elements' base rules define position:sticky elsewhere in the
  // file - this override only needs to win at this breakpoint, not remove
  // the base declaration (still correct for desktop).
  assert.match(styles, /\.splitsBulkBar\{\s*position:sticky;/);
  assert.match(styles, /\.rearrangeModeBar\{position:sticky;/);
});

test("the action row (Bulk edit + Rearrange Hoppers) and the bulk toolbar are still the same direct children of #splitsArea targeted by the reorder rule", () => {
  assert.match(splitsArea, /actionRow\.className = "splitsMatrixActions"/);
  assert.match(splitsArea, /toolbar\.className = "splitsBulkBar hide"/);
  assert.match(splitsArea, /area\.append\(actionRow, toolbar\)/);
});

// --- Rearrange Hoppers is now reachable and active on mobile --------------

test("Rearrange Hoppers is no longer desktop-only, while Print Recipe still is", () => {
  const modeBarStart = app.indexOf('modeBar.className = "splitsBulkModeBar"');
  const modeBar = app.slice(modeBarStart, app.indexOf("const toolbar = document.createElement", modeBarStart));
  assert.match(modeBar, /rearrangeButton\.className="secondary"/);
  assert.doesNotMatch(modeBar, /rearrangeButton\.className="secondary rearrangeDesktopOnly"/);
  assert.match(modeBar, /printButton\.className="secondary rearrangeDesktopOnly"/);
});

test("entering rearrange mode no longer bails out at mobile widths", () => {
  const buttonStart = app.indexOf("const rearrangeButton=");
  const blockEnd = app.indexOf("function clearTapSourceHighlight", buttonStart);
  const block = app.slice(buttonStart, blockEnd);
  assert.doesNotMatch(block, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.match(block, /hopperRearrangement=\{active:true,baseline:window\.PolynHopperRearrangement\.snapshot\(state\.layers\),undo:\[\],tapSource:null\}/);
});

// --- Tap-to-select-then-tap-to-move, alongside (not replacing) drag -------

test("each rearrange-mode cell keeps its drag handlers and also gets a tap/click handler", () => {
  assert.match(splitsArea, /td\.addEventListener\("dragstart"/);
  assert.match(splitsArea, /td\.addEventListener\("dragover"/);
  assert.match(splitsArea, /td\.addEventListener\("drop"/);
  assert.match(splitsArea, /td\.addEventListener\("click",\(\)=>\{const current=hopperRearrangement\.tapSource;/);
});

test("tapping the already-selected source cell again deselects it without attempting a move", () => {
  const clickStart = splitsArea.indexOf('td.addEventListener("click"');
  const clickHandler = splitsArea.slice(clickStart, splitsArea.indexOf("\n", clickStart));
  assert.match(clickHandler, /if\(current&&current\.layer===L\.name&&current\.index===hi\)\{hopperRearrangement\.tapSource=null;td\.classList\.remove\("rearrangeSource"\);return;\}/);
});

test("tapping an empty hopper as a source is a no-op, matching drag's guard against picking up nothing", () => {
  const clickStart = splitsArea.indexOf('td.addEventListener("click"');
  const clickHandler = splitsArea.slice(clickStart, splitsArea.indexOf("\n", clickStart));
  assert.match(clickHandler, /if\(!current\)\{if\(!normName\(hopper\.resinName\)&&!clampNum\(hopper\.pct\)\)return;/);
  const dragStart = splitsArea.indexOf('td.addEventListener("dragstart"');
  const dragHandler = splitsArea.slice(dragStart, splitsArea.indexOf("\n", dragStart));
  assert.match(dragHandler, /if\(!normName\(hopper\.resinName\)&&!clampNum\(hopper\.pct\)\)\{event\.preventDefault\(\);return;\}/);
});

test("tapping a second, different cell calls the exact same move() used by drop, with the same undo/failure handling", () => {
  const clickStart = splitsArea.indexOf('td.addEventListener("click"');
  const clickHandler = splitsArea.slice(clickStart, splitsArea.indexOf("\n", clickStart));
  assert.match(clickHandler, /const result=window\.PolynHopperRearrangement\.move\(state\.layers,current,\{layer:L\.name,index:hi\}\);/);
  assert.match(clickHandler, /hopperRearrangement\.undo\.push\(result\.before\);renderSplitsArea\(\);validateAndCompute\(\);/);
  assert.match(clickHandler, /summary\.textContent=result\.reason==="invalid"\?"Move rejected: hopper percentages would be invalid\.":"No rearrangement made\.";/);

  const dropStart = splitsArea.indexOf('td.addEventListener("drop"');
  const dropHandler = splitsArea.slice(dropStart, splitsArea.indexOf("\n", dropStart));
  assert.match(dropHandler, /window\.PolynHopperRearrangement\.move\(state\.layers,hopperRearrangement\.drag,\{layer:L\.name,index:hi\}\)/);
});

test("a failed tap-move clears the stale source highlight instead of leaving it stuck, without a full re-render", () => {
  const clickStart = splitsArea.indexOf('td.addEventListener("click"');
  const clickHandler = splitsArea.slice(clickStart, splitsArea.indexOf("\n", clickStart));
  const failureBranch = clickHandler.slice(clickHandler.indexOf("}else{"));
  assert.match(failureBranch, /clearTapSourceHighlight\(\);/);
  assert.doesNotMatch(failureBranch, /renderSplitsArea\(\)/);
});

test("clearTapSourceHighlight is scoped to the table, not the whole document", () => {
  assert.match(splitsArea, /function clearTapSourceHighlight\(\)\{\s*table\.querySelectorAll\("\.rearrangeSource"\)\.forEach\(el=>el\.classList\.remove\("rearrangeSource"\)\);\s*\}/);
});

test("starting a native drag cancels any pending tap-selection first, so the two input modes can't get out of sync", () => {
  const dragStart = splitsArea.indexOf('td.addEventListener("dragstart"');
  const dragHandler = splitsArea.slice(dragStart, splitsArea.indexOf("\n", dragStart));
  assert.match(dragHandler, /hopperRearrangement\.tapSource=null;clearTapSourceHighlight\(\);/);
});

test("Undo Last Move also clears any pending tap-selection", () => {
  const undoStart = splitsArea.indexOf('undo.addEventListener("click"');
  const undoHandler = splitsArea.slice(undoStart, splitsArea.indexOf("\n", undoStart));
  assert.match(undoHandler, /hopperRearrangement\.tapSource=null;/);
});

test("the rearrange-mode help text mentions tapping as well as dragging", () => {
  assert.match(splitsArea, /Drag, or tap a hopper then tap another, to move assignments\./);
});

// --- Bulk Edit and Rearrange mode bars are more compact on mobile --------

test("the bulk-edit steps legend is a single right-aligned row on narrow mobile, not a bordered banner above the fields", () => {
  const narrowBlock = styles.slice(styles.indexOf("@media (max-width: 700px){"));
  const stepsRule = narrowBlock.slice(narrowBlock.indexOf(".splitsBulkSteps{"), narrowBlock.indexOf("}", narrowBlock.indexOf(".splitsBulkSteps{")) + 1);
  assert.match(stepsRule, /justify-content:flex-end/);
  assert.match(stepsRule, /border-bottom:0/);
  assert.match(stepsRule, /padding-bottom:0/);
  assert.doesNotMatch(stepsRule, /flex-direction:column/);
});

test("Reset all matches the compact text-style treatment already used by Select all / Clear selection", () => {
  const narrowBlock = styles.slice(styles.indexOf("@media (max-width: 700px){"));
  const dangerStart = narrowBlock.indexOf(".splitsBulkActions .danger{");
  const dangerRule = narrowBlock.slice(dangerStart, narrowBlock.indexOf("}", dangerStart) + 1);
  assert.match(dangerRule, /min-height:0/);
  assert.match(dangerRule, /border:0/);
  assert.match(dangerRule, /background:transparent/);
  assert.match(dangerRule, /color:var\(--bad\)/);
});

test("the bulk-edit bar and the rearrange mode bar both get tighter padding/gap on narrow mobile", () => {
  const narrowBlock = styles.slice(styles.indexOf("@media (max-width: 700px){"));
  assert.match(narrowBlock, /\.splitsBulkBar\{ padding:8px; gap:8px; \}/);
  assert.match(narrowBlock, /\.rearrangeModeBar\{padding:8px;gap:8px\}/);
});
