"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("Receiver Hopper Weights switches to an all-layer mobile matrix without changing desktop rendering",()=>{
  const render = functionBody("renderWeightsArea");
  // The split is the compact-mobile breakpoint now, not the pointer-based
  // desktop predicate: a tablet gets the wide grid on Weights for the same
  // reason it gets the reworked grid on Recipe.
  assert.match(render,/layoutModeQueries\.compactRecipe\.matches/);
  assert.match(render,/renderMobileWeightsArea\(area\);/);

  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/matrix\.style\.setProperty\("--mobile-weight-layer-count", String\(state\.layers\.length\)\);/);
  assert.match(mobile,/label\.textContent = hopperBadgeLabel\(L\.name, hi\);/);
  assert.match(mobile,/for \(let hi=0; hi<HOPPERS_PER_LAYER; hi\+\+\)/);
  assert.match(styles,/grid-template-columns:repeat\(var\(--mobile-weight-layer-count\),minmax\(0,1fr\)\);/);
});

test("mobile Smart Hoppers uses a workspace circumference plus a height in every cell, not a wrench popover",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/id = "mobileSharedCircumference"/);
  assert.match(mobile,/value=>setWorkspaceHopperCircumference\(value\)/);
  assert.match(mobile,/makeValueField\("W", hopper\.weight/);
  assert.match(mobile,/makeValueField\("H", hopper\.usableHeight/);
  assert.match(html,/How Smart Hoppers work/);
  assert.match(mobile,/mobileWeightSummaryWeight/);
  assert.doesNotMatch(mobile,/hopperGeometryPopover/);
  assert.match(mobile,/smartToggle\.id = "smartHoppersToggle"/);
});

test("mobile bulk entry comes with Edit view and can apply weight and height",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  // Bulk edit is no longer a mode of its own here: Edit view *is* bulk
  // edit, so Weight Profiles is all that remains in the action row.
  assert.doesNotMatch(mobile,/bulkToggleRow|mobileWeightsBulkToggle/);
  // Weight Profiles is a single icon button in the tab-row header cluster
  // now - no bottom action bar of its own.
  assert.match(mobile,/weightsHeaderActions\.replaceChildren\(profilesAction\)/);
  assert.doesNotMatch(mobile,/mobileWeightsActionToolbar/);
  assert.match(mobile,/setMobileWeightBulkMode\(!visualMode\);/);
  assert.doesNotMatch(mobile,/selector\.type = "checkbox"/);
  assert.match(mobile,/cell\.setAttribute\("aria-selected", "false"\)/);
  assert.match(mobile,/cell\.addEventListener\("keydown"/);
  assert.match(mobile,/function setMobileWeightBulkMode\(enabled\)/);
  assert.match(mobile,/area\.dataset\.mobileBulkMode = String\(bulkMode\);/);
  assert.match(mobile,/id="mobileBulkWeight"/);
  assert.match(mobile,/id="mobileBulkHeight"/);
  assert.match(mobile,/ref\.hopper\.weight = weightResult\.value;/);
  assert.match(mobile,/ref\.hopper\.usableHeight = heightResult\.value;/);
  assert.match(mobile,/applyButton\.disabled = selected\.size === 0 \|\| !hasValue \|\| !valuesAreValid;/);
  assert.match(styles,/#weightsArea\[data-mobile-bulk-mode="true"\] \.mobileWeightCell\.selected::after/);
});

test("mobile Weight editing uses Recipe's compact above-matrix pattern and keeps its selection count with the matrix",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/class="mobileWeightsBulkEditRow"/);
  assert.match(mobile,/class="mobileWeightsBulkToolbar"/);
  assert.match(mobile,/area\.append\(bulkBar, matrix, selectionHint\);/);
  assert.match(mobile,/TAP a hopper to edit · 0 selected/);
  assert.match(mobile,/selectionHint\.textContent = `TAP a hopper to edit · \$\{selected\.size\} selected`;/);
  assert.match(styles,/\.mobileWeightsBulkEditRow\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styles,/\.mobileWeightsBulkToolbar button\{[\s\S]*?width:40px;/);
});

test("mobile cells omit Smart Hopper geometry when Smart Hoppers is off",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/area\.dataset\.smartHoppers = String\(state\.smartHoppersEnabled\);/);
  assert.match(mobile,/\$\{state\.smartHoppersEnabled \? geometrySummaryMarkup : ""\}/);
  assert.match(styles,/#weightsArea\[data-smart-hoppers="false"\]\[data-mobile-weight-view\] \.mobileWeightVisualReadout\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
});

test("Smart capacity replaces only the mobile Summary weight display and rounds visually",()=>{
  const refresh = functionBody("refreshSmartHopperState");
  assert.match(refresh,/mobileSummaryWeightId\(L\.name, hi\)/);
  assert.match(refresh,/const value=smart \? Math\.round\(smart\.value\) : clampNum\(hopper\.weight\);/);
  assert.match(refresh,/mobileSummaryWeight\.classList\.toggle\("smart",!!smart\)/);
  assert.match(refresh,/Smart-calculated weight/);
  assert.match(styles,/\.mobileWeightSummaryWeight\.smart\{color:var\(--ok\)\}/);
  assert.doesNotMatch(styles,/\.mobileWeightSummaryWeight\.smart::after/);
  assert.match(styles,/\.mobileWeightCell\.selected::after/);
});

test("mobile receiver Summary cells are compact text readouts with no repeated hopper artwork",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  const summary = mobile.slice(mobile.indexOf('visualReadout.innerHTML'), mobile.indexOf('const summaryWeight'));
  assert.doesNotMatch(summary,/<svg/);
  // Cells are static in both views now, so the readout sizing is keyed on
  // the attribute's presence rather than on Summary specifically.
  assert.match(styles,/#weightsArea\[data-mobile-weight-view\] \.mobileWeightCell\{height:auto;min-height:40px/);
  // The old bottom Weight Profiles bar is gone entirely.
  assert.doesNotMatch(styles,/mobileWeightsActionToolbar/);
});

test("the Summary/Edit mode persists at module scope, shared by both weights render paths",()=>{
  // renderWeightsArea now splits on the compact-mobile breakpoint, so
  // "mobile" here means phone-width; the wide grid keeps no view of its own
  // (it is always live) and simply writes "edit" back to the shared flag.
  assert.match(app,/let weightsViewMode = "summary";/);
  assert.match(app,/weightsViewMode = visualMode \? "summary" : "edit";/);
  assert.match(app,/weightsViewMode = desktopWeightView;/);
  // Re-renders (Smart Hoppers, profile load, layer change) reapply the
  // persisted view instead of dropping the operator back into Summary.
  assert.match(app,/setMobileWeightView\(weightsViewMode === "edit" \? "edit" : "visual"\);/);
  assert.match(app,/setDesktopWeightView\(weightsViewMode\);/);
});

test("touch cells never present an editable field - the per-hopper inputs survive only as the value carrier bulk apply writes through",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/input\.disabled = true;\s*\n\s*input\.tabIndex = -1;/);
  assert.match(styles,/#weightsArea\[data-mobile-weight-view\] \.mobileWeightValueFields\{display:none\}/);
  assert.match(styles,/#weightsArea\[data-mobile-weight-view\] \.mobileWeightVisualReadout\{display:grid/);
  // Height still applies on a bulk apply even though the per-cell input is
  // no longer the thing that decides whether it can.
  assert.match(mobile,/if \(heightResult\.value !== null && geometryMode !== null\)\{/);
});

test("mobile receiver profiles use the same bottom-sheet row pattern as Recipes",()=>{
  assert.match(app,/function ensureMobileWeightProfilesSheet\(trigger\)/);
  assert.match(app,/id="mobileWeightProfilesSheet"/);
  assert.match(app,/Receiver weight profiles/);
  assert.match(app,/id="mobileWeightProfilesSearch"/);
  assert.match(app,/id="mobileWeightProfilesSave"/);
  assert.match(app,/function renderMobileWeightProfileRows\(items,syncState\)/);
  assert.match(app,/sheet\.close\("load"\)/);
});

test("receiver profile overflow opens upward inside a sheet tall enough for its actions",()=>{
  const profiles = functionBody("renderMobileWeightProfileRows");
  assert.match(profiles,/overflow\.addEventListener\("toggle",\(\)=>sheet\.classList\.toggle\("profileMenuOpen",overflow\.open\)\)/);
  assert.match(styles,/\.mobileWeightProfilesSheet\{min-height:min\(360px,calc\(100dvh/);
  assert.match(styles,/\.mobileWeightProfilesSheet\.profileMenuOpen \.mobileSavedRecipesList\{overflow:visible\}/);
  assert.match(styles,/\.mobileWeightProfilesSheet \.mobileSavedRecipeOverflow\[open\] \.mobileSavedRecipeMenu\{top:auto;bottom:calc\(100% \+ 4px\)\}/);
});

test("Smart Hopper help is a width-constrained wrapping block on mobile",()=>{
  assert.match(styles,/\.weightsSmartHow\{display:block;min-width:0;width:100%;max-width:100%;box-sizing:border-box/);
  assert.match(styles,/\.weightsSmartHow summary\{min-width:0;max-width:100%;[\s\S]*?white-space:normal;overflow-wrap:anywhere/);
  assert.match(styles,/\.weightsSmartHow p\{min-width:0;max-width:100%;[\s\S]*?white-space:normal;overflow-wrap:anywhere/);
  assert.doesNotMatch(styles,/\.weightsSmartHow\{width:max-content/);
});
