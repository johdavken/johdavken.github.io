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

// --- Bulk edit/Rearrange/Print Recipe live at the bottom of the panel,
// on both mobile and desktop -----------------------------------------------

test("the utility tabs, bulk-edit toolbar, saved-recipes panel, and active-rearrange mode bar all reorder below the table, unscoped to any viewport width", () => {
  assert.match(styles, /#splitsArea > \.recipeUtilityTabs,\s*#splitsArea > \.splitsBulkBar,\s*#splitsArea > \.splitsSavedRecipesPanel,\s*#splitsArea > \.rearrangeModeBar\{ order:1; position:static; \}/);
  // Not gated behind a mobile-only media query anymore - desktop gets the
  // same bottom placement now, not just mobile.
  assert.doesNotMatch(styles, /@media\(max-width:900px\)\{\s*#splitsArea > \.recipeUtilityTabs/);
});

test("the reordered bars also drop their sticky-to-top positioning, so they can't jump/force-scroll once moved after the table", () => {
  const reorderRuleStart = styles.indexOf("#splitsArea > .recipeUtilityTabs,");
  const reorderRule = styles.slice(reorderRuleStart, styles.indexOf("}", reorderRuleStart) + 1);
  assert.match(reorderRule, /position:static/);
  // Both elements' base rules define position:sticky elsewhere in the
  // file - this override only needs to win once reordered, not remove
  // the base declaration (still correct when not reordered).
  assert.match(styles, /\.splitsBulkBar\{\s*position:sticky;/);
  assert.match(styles, /\.rearrangeModeBar\{position:sticky;/);
});

test("the action button row (Scan/Print/Load Next/Info) is flush to the panel's own left edge, compact rather than stretched full-width", () => {
  // #splitsArea is a CSS grid - a plain item stretches to the full grid
  // track width by default, so this needs its own justify-self:start
  // (there is no wrapper div doing it indirectly any more, unlike the old
  // .splitsMatrixActions flex-column wrapper).
  const ruleStart = styles.indexOf("#splitsArea > .splitsBulkModeBar{");
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /order:2/);
  assert.match(rule, /justify-self: start/);
});

test("the utility tabs, saved-recipes panel and action row remain direct children while the bulk toolbar stays direct on desktop and moves into its mobile dialog", () => {
  assert.match(splitsArea, /recipeUtilityTabs\.className = "recipeUtilityTabs"/);
  assert.match(splitsArea, /toolbar\.className = "splitsBulkBar hide"/);
  assert.match(splitsArea, /savedRecipesPanel\.className = "splitsSavedRecipesPanel hide"/);
  // Desktop's tab strip, bulk toolbar and action row only exist in the DOM
  // at all when not on the compact mobile layout - the two mobile tiers
  // (built separately, see the next test) replace them there rather than
  // modeBar being emptied into a mobile-only grid.
  assert.match(splitsArea, /if \(!compactMobileRecipe\)\{\s*\n\s*area\.append\(recipeUtilityTabs\);\s*\n\s*area\.append\(toolbar\);\s*\n\s*\}/);
  assert.match(splitsArea, /area\.append\(savedRecipesPanel\);/);
  assert.match(splitsArea, /if \(!compactMobileRecipe\)\{\s*\n\s*area\.append\(modeBar\);\s*\n\s*\}/);
  assert.match(splitsArea, /mobileBulkEditSheet\.querySelector\("\.mobileBulkEditBody"\)\.appendChild\(toolbar\);/);
});

// --- Rearrange is now reachable and active on mobile --------------

test("Rearrange is no longer desktop-only, while Print Recipe still is", () => {
  const modeBarStart = app.indexOf('modeBar.className = "splitsBulkModeBar"');
  const modeBar = app.slice(modeBarStart, app.indexOf("const toolbar = document.createElement", modeBarStart));
  assert.match(modeBar, /rearrangeButton\.className="secondary"/);
  assert.doesNotMatch(modeBar, /rearrangeButton\.className="secondary rearrangeDesktopOnly"/);
  assert.match(modeBar, /printButton\.className="secondary rearrangeDesktopOnly recipeActionTertiary"/);
});

test("entering rearrange mode no longer bails out at mobile widths", () => {
  const buttonStart = app.indexOf("const rearrangeButton=");
  const blockEnd = app.indexOf("function clearTapSourceHighlight", buttonStart);
  const block = app.slice(buttonStart, blockEnd);
  assert.doesNotMatch(block, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.match(block, /hopperRearrangement=\{active:true,baseline:window\.PolynHopperRearrangement\.snapshot\(recipeLayers\(\)\),undo:\[\],tapSource:null\}/);
});

// --- Tap-to-select-then-tap-to-move, alongside (not replacing) drag -------

test("each rearrange-mode cell keeps its drag handlers and also gets a tap/click handler", () => {
  assert.match(splitsArea, /td\.addEventListener\("dragstart"/);
  assert.match(splitsArea, /td\.addEventListener\("dragover"/);
  assert.match(splitsArea, /td\.addEventListener\("drop"/);
  assert.match(splitsArea, /td\.addEventListener\("click",event=>\{/);
  assert.match(splitsArea, /activateCell\(\);/);
  assert.match(splitsArea, /td\.addEventListener\("keydown",event=>\{/);
});

test("tapping the already-selected source cell again deselects it without attempting a move", () => {
  assert.match(splitsArea, /if\(current&&current\.layer===L\.name&&current\.index===hi\)\{\s*hopperRearrangement\.tapSource=null;\s*td\.classList\.remove\("rearrangeSource"\);/);
  assert.match(splitsArea, /td\.setAttribute\("aria-pressed","false"\);/);
});

test("tapping an empty hopper as a source is a no-op, matching drag's guard against picking up nothing", () => {
  assert.match(splitsArea, /const hasAssignment=\(\)=>!!normName\(hopper\.resinName\)\|\|clampNum\(hopper\.pct\)>0;/);
  assert.match(splitsArea, /if\(!current\)\{\s*if\(!hasAssignment\(\)\) return;/);
  assert.match(splitsArea, /if\(!hasAssignment\(\)\)\{event\.preventDefault\(\);return;\}/);
});

test("tapping a second, different cell calls the exact same move() used by drop, with the same undo/failure handling", () => {
  assert.match(splitsArea, /completeMove\(current,window\.PolynHopperRearrangement\.move\(recipeLayers\(\),current,destination\)\);/);
  assert.match(splitsArea, /completeMove\(source,window\.PolynHopperRearrangement\.move\(recipeLayers\(\),source,destination\)\);/);
  assert.match(splitsArea, /hopperRearrangement\.undo\.push\(result\.before\);/);
  assert.match(splitsArea, /hopperRearrangement\.undoVisibleUntil=Date\.now\(\)\+5000;/);
});

test("a failed tap-move clears the stale source highlight instead of leaving it stuck, without a full re-render", () => {
  const completeStart=splitsArea.indexOf("function completeMove(source,result)");
  const successStart=splitsArea.indexOf("hopperRearrangement.undo.push",completeStart);
  const failureBranch=splitsArea.slice(completeStart,successStart);
  assert.match(failureBranch,/if\(!result\.ok\)\{/);
  assert.match(failureBranch, /clearTapSourceHighlight\(\);/);
  assert.doesNotMatch(failureBranch, /renderSplitsArea\(\)/);
});

test("clearTapSourceHighlight is scoped to the table, not the whole document", () => {
  assert.match(splitsArea, /function clearTapSourceHighlight\(\)\{\s*table\.querySelectorAll\("\.rearrangeSource"\)\.forEach\(el=>el\.classList\.remove\("rearrangeSource"\)\);\s*\}/);
});

test("starting a native drag cancels any pending tap-selection first, so the two input modes can't get out of sync", () => {
  assert.match(splitsArea, /td\.addEventListener\("dragstart",event=>\{[\s\S]*?hopperRearrangement\.tapSource=null;\s*clearTapSourceHighlight\(\);/);
});

test("Undo Last Move also clears any pending tap-selection", () => {
  const undoStart=splitsArea.indexOf("function undoRearrangement()");
  const undoHandler=splitsArea.slice(undoStart,splitsArea.indexOf("\n      }",undoStart));
  assert.match(undoHandler, /hopperRearrangement\.tapSource=null;/);
});

test("mobile rearrange uses a contextual toolbar and temporary Undo toast instead of the large mode card",()=>{
  assert.match(splitsArea,/mobileRearrangeContext\.innerHTML=/);
  assert.match(splitsArea,/mobileRearrangeCancel/);
  assert.match(splitsArea,/mobileRearrangeDone/);
  assert.match(splitsArea,/if\(hopperRearrangement\?\.active&&!compactMobileRecipe\)\{/);
  assert.match(splitsArea,/toast\.className="mobileRearrangeToast";/);
  assert.match(styles,/\.mobileRearrangeToast\{/);
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

// --- Rearrange mode cells no longer swallow taps on data-entry fields ----

test("setBulkMode's per-cell disable pass keeps rearrange-mode disabling in place instead of clobbering it back to enabled", () => {
  const setBulkModeStart = app.indexOf("function setBulkMode(enabled){");
  const setBulkModeBody = app.slice(setBulkModeStart, app.indexOf("\n      }", setBulkModeStart));
  assert.match(setBulkModeBody, /const rearranging = !!hopperRearrangement\?\.active;/);
  // Rearranging still takes the fields out of service everywhere. The other
  // half of the condition is now the device, not the width: pointer devices
  // keep the hybrid (typeable in Edit, locked in Summary), and every touch
  // surface leaves cells permanently inert and edits through the panel.
  assert.match(setBulkModeBody, /const readOnly = !cellsTypeable \|\| summaryView \|\| rearranging;/);
  assert.match(setBulkModeBody, /ref\.resinInput\.disabled = readOnly;/);
  assert.match(setBulkModeBody, /ref\.pctInput\.disabled = readOnly;/);
  assert.match(setBulkModeBody, /trackButton\.disabled = bulkMode \|\| rearranging;/);
});

test("setBulkMode runs unconditionally at the end of every render (reapplying the resolved bulkMode, not hardcoded false, so a render triggered by switching panels can seed bulk edit open) - this per-cell disable pass is exactly why the clobbering bug existed", () => {
  const endOfRenderStart = splitsArea.lastIndexOf("// Reapply (not force-close) the resolved state");
  const endOfRender = splitsArea.slice(endOfRenderStart, splitsArea.indexOf("renderSplitsSavedRecipes", endOfRenderStart));
  assert.match(endOfRender, /setBulkMode\(bulkMode\);/);
  assert.doesNotMatch(endOfRender, /setBulkMode\(false\);/);
});

test("disabled fields inside a rearranging cell are excluded from hit-testing, so a tap anywhere on the cell reaches the td instead of being silently swallowed", () => {
  assert.match(styles, /\.rearrangeTarget :disabled\{ pointer-events:none; \}/);
});
