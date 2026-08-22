"use strict";

// Desktop Recipe Setup gained the same Summary/Edit split Receiver Hopper
// Weights uses, and folded Bulk edit + Rearrange into the Edit view.
//
//   Summary - a read-only glance whose only interaction is tracking. Cells
//             show badge, resin and percentage; the fields are inert, the
//             per-cell clock and clear x are gone, and layer percentages /
//             "Match X" copy buttons are unreachable. Clicking a cell
//             toggles tracking, shown as a highlight.
//   Edit    - the whole change workflow: cells stay directly typeable (the
//             hybrid Weights already uses) AND clicking a cell body selects
//             it, with row/column headers selecting whole rows/columns, a
//             two-row panel above the grid, and Rearrange inside it.
//
// Tracking is deliberately absent on the Next page: the planned recipe
// structurally cannot hold tracking (see next-recipe.js / CLAUDE.md), so
// Next's Summary is a read-only preview with nothing to toggle.
//
// Compact mobile (<=700px) is untouched by this pass - it keeps its
// always-editable grid, its own bulk-mode toggle and its dialog sheets.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

const splitsArea = functionBody("renderSplitsArea");

/* ----------------------------------------------------------------------
 *   The toggle itself
 * -------------------------------------------------------------------- */

test("the view toggle sits in a header row beside the Current/Next page tabs, matching the Weights control", () => {
  assert.match(html, /<div class="recipeHeaderRow">/);
  assert.match(html, /<div class="recipeViewToggle" id="recipeViewToggle" role="group" aria-label="Recipe view">/);
  assert.match(html, /<button type="button" class="active" data-recipe-view="summary" aria-pressed="true">Summary<\/button>/);
  assert.match(html, /<button type="button" data-recipe-view="edit" aria-pressed="false">Edit<\/button>/);
  // Page tabs stay inside the same row so the two axes read as one header.
  const row = html.slice(html.indexOf('<div class="recipeHeaderRow">'), html.indexOf('id="splitsArea"'));
  assert.match(row, /class="recipePageTabs"/);
});

test("the mode persists at module scope and is hooked once, like the page tabs", () => {
  assert.match(app, /let splitsViewMode = "summary";/);
  assert.match(app, /function hookRecipeViewToggle\(\)\{/);
  assert.match(app, /hookRecipePageTabs\(\);\s*\n\s*hookRecipeViewToggle\(\);/);
});

test("leaving Edit cancels an in-progress rearrangement rather than stranding it behind a hidden toolbar", () => {
  const body = functionBody("setRecipeViewMode");
  assert.match(body, /if \(next === "summary"\)\{/);
  assert.match(body, /splitsBulkModeActive = false;/);
  // Cancelled (restores the baseline), not committed - a half-finished
  // rearrangement is not an intention.
  assert.match(body, /window\.PolynHopperRearrangement\.apply\(recipeLayers\(\), hopperRearrangement\.baseline\);\s*\n\s*hopperRearrangement = null;/);
});

/* ----------------------------------------------------------------------
 *   View resolution, and mobile staying out of it
 * -------------------------------------------------------------------- */

test("Summary/Edit is the single mode axis on every surface - Edit *is* bulk edit, so there is no second mode anywhere", () => {
  assert.match(splitsArea, /const viewMode = splitsViewMode;/);
  assert.match(splitsArea, /const summaryView = viewMode === "summary";/);
  assert.match(splitsArea, /let bulkMode = viewMode === "edit";/);
  assert.match(splitsArea, /area\.dataset\.recipeView = viewMode;/);
});

test("typing in a cell is a pointer-device capability, not a width one - every touch surface edits through the panel", () => {
  assert.match(splitsArea, /const cellsTypeable = isDesktopLayout\(\);/);
  assert.match(splitsArea, /area\.dataset\.recipeCells = cellsTypeable \? "typeable" : "static";/);
  // Static cells swap the resin field for real text, so long codes
  // ("EXXON LD105.30", "00328 nexxstar") wrap instead of being ellipsised
  // away at phone column widths.
  assert.match(styles, /#splitsArea\[data-recipe-cells="static"\] \.splitCellResinText\{/);
  assert.match(styles, /#splitsArea\[data-recipe-cells="static"\] \.splitMatrixCell \.resinNameInput\{ display: none; \}/);
});

test("the resin mirror is kept in sync from refreshCellState - the one funnel every write path already ends in", () => {
  assert.match(splitsArea, /resinText\.textContent = hopper\.resinName \|\| "";/);
  const refreshStart = splitsArea.indexOf("function refreshCellState(){");
  assert.notEqual(refreshStart, -1);
  const body = splitsArea.slice(refreshStart, splitsArea.indexOf("\n          }", refreshStart));
  assert.match(body, /resinText\.textContent/);
  // Exactly one of field/text is ever visible, so they cannot read as two
  // separate values.
  assert.match(styles, /\.splitCellResinText\{ display: none; \}/);
});

test("the compact mobile grid keeps .bulk-editing to itself, so desktop presentation is driven only by data-recipe-view", () => {
  const body = functionBody("setBulkMode");
  assert.match(body, /area\.classList\.toggle\("bulk-editing", bulkMode && compactMobileRecipe\);/);
});

/* ----------------------------------------------------------------------
 *   Tracking is Summary's one interaction, and never on Next
 * -------------------------------------------------------------------- */

test("tracking view requires Summary and the Current page - the plan cannot carry tracking at all", () => {
  assert.match(splitsArea, /const trackingView = summaryView && !isNextRecipePage\(\);/);
  assert.match(splitsArea, /area\.classList\.toggle\("recipeTrackingView", trackingView\);/);
  // One condition, every surface - no per-platform special case left.
  assert.match(splitsArea, /if \(!trackingView \|\| bulkMode \|\| hopperRearrangement\?\.active\) return;/);
});

test("Summary's inert fields still let a click reach the cell, so the whole cell is the tracking target", () => {
  // Disabled inputs swallow clicks entirely, which would leave most of the
  // cell dead; pointer-events:none passes the click through to the <td>.
  assert.match(styles, /#splitsArea\[data-recipe-view="summary"\] \.splitMatrixCell input,\s*\n#splitsArea\[data-recipe-view="summary"\] \.splitLayerPct input\{\s*\n\s*pointer-events: none;/);
  assert.match(styles, /#splitsArea\.recipeTrackingView \.splitMatrixCell\{ cursor: pointer; \}/);
});

test("Summary and Edit mark cells differently - a filled bar for tracked, an outline for selected - so the two never read as the same state", () => {
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitsMatrix tbody \.splitMatrixCell\.selected\{[\s\S]*?box-shadow: inset 0 0 0 2px var\(--focus-border\);/);
  assert.match(styles, /#splitsArea\[data-recipe-view="summary"\] \.splitsMatrix tbody \.splitMatrixCell\.tracked\{[\s\S]*?box-shadow: inset 3px 0 0 0 var\(--ok\);/);
  // Tracking stays legible while editing, without competing with selection.
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitsMatrix tbody \.splitMatrixCell\.tracked:not\(\.selected\)\{/);
});

/* ----------------------------------------------------------------------
 *   Summary is strictly read-only
 * -------------------------------------------------------------------- */

test("Summary locks the cell fields and the layer percentage, and hides the Match copy buttons", () => {
  const setBulkModeBody = functionBody("setBulkMode");
  assert.match(setBulkModeBody, /const readOnly = !cellsTypeable \|\| summaryView \|\| rearranging;/);
  assert.match(splitsArea, /if\(hopperRearrangement\?\.active \|\| summaryView\) pctInput\.disabled=true;/);
  assert.match(styles, /#splitsArea\[data-recipe-view="summary"\] \.splitCopyBtn\{ display: none; \}/);
});

test("the per-cell clock and clear x are gone from both desktop views - replaced by clicking the cell and by the panel's Clear cell contents", () => {
  assert.match(styles, /#splitsArea\[data-recipe-view\] \.splitTrackControl,\s*\n\s*#splitsArea\[data-recipe-view\] \.splitClearButton\{ display: none; \}/);
});

/* ----------------------------------------------------------------------
 *   Edit view: hybrid cells, row/column selection, the panel
 * -------------------------------------------------------------------- */

test("Edit keeps cells directly typeable while a cell-body click selects - inputs and buttons retain their own behavior", () => {
  assert.match(splitsArea, /td\.addEventListener\("click",event=>\{\s*\n\s*if\(!bulkMode\|\|hopperRearrangement\?\.active\) return;\s*\n\s*if\(isOwnCellInteraction\(event\.target\)\) return;/);
});

// The percentage sits inside a <label> (it carries the "%" suffix), and the
// fields are pointer-events:none wherever a cell cannot be typed into - so a
// tap on the number lands on that label. Treating every <label> as its own
// interaction meant the top half of a cell selected/tracked and the
// percentage half did nothing, on every touch surface and in Summary.
test("a cell's percentage area is cell surface unless its field is genuinely typeable", () => {
  assert.match(splitsArea, /const cellFieldsTypeable = cellsTypeable && !summaryView;/);
  const guard = splitsArea.slice(splitsArea.indexOf("function isOwnCellInteraction("));
  const body = guard.slice(0, guard.indexOf("\n      }") + 8);
  assert.match(body, /const control = target\.closest\("input,button,label,a,select,textarea"\);/);
  assert.match(body, /if \(!control\) return false;/);
  // Only the label is conditional: real fields and buttons always win.
  assert.match(body, /if \(control\.tagName === "LABEL"\) return cellFieldsTypeable;/);
  assert.match(body, /return true;/);
});

test("the whole layer header selects its column, since the layer letter is a watermark the percentage field sits on top of", () => {
  assert.match(splitsArea, /th\.addEventListener\("click", event=>\{\s*\n\s*if \(!bulkMode \|\| hopperRearrangement\?\.active\) return;\s*\n\s*if \(event\.target\.closest\("input,button,label,a,select,textarea"\)\) return;\s*\n\s*toggleSelection\(/);
  // The letter's own handler still runs for a direct hit; the closest()
  // guard above is what stops it counting twice.
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitLayerTitle\{[\s\S]*?pointer-events: auto;/);
});

test("Edit restores the row/column select affordances that .bulk-editing used to supply, and brings back the header column", () => {
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitsMatrix tr > :first-child\{ display: table-cell; \}/);
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitRowSelect\.selected\{/);
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitLayerTitle\.partiallySelected\{/);
});

test("selection stays keyboard-reachable: the checkbox is visually hidden, not removed", () => {
  const rule = styles.slice(styles.indexOf('#splitsArea[data-recipe-view="edit"] .splitCellSelector{'));
  const block = rule.slice(0, rule.indexOf("}") + 1);
  assert.match(block, /display: block;/);
  assert.match(block, /clip: rect\(0,0,0,0\);/);
  assert.doesNotMatch(block, /display: none/);
});

test("the Edit panel is two rows above the grid: entry + selection, then the destructive/structural actions", () => {
  assert.match(splitsArea, /<div class="splitsEditRow splitsEditRowPrimary">/);
  assert.match(splitsArea, /<div class="splitsEditRow splitsEditRowSecondary">/);
  assert.match(splitsArea, /<button id="clearSelectedCells" type="button" class="bulkTextAction" disabled>Empty cells<\/button>/);
  assert.match(splitsArea, /<button id="resetAllSplits" type="button" class="danger">Reset Recipe<\/button>/);
  // Above the grid, not below it (the grid is order 0).
  assert.match(styles, /#splitsArea > \.splitsBulkBar\{ order: -1;/);
  // No numbered step captions on desktop - they remain in the mobile sheet.
  const desktopTemplate = splitsArea.slice(splitsArea.indexOf("} : `"));
  assert.doesNotMatch(desktopTemplate, /splitsBulkSteps/);
});

test("Empty cells empties only the selected hoppers and recomputes each affected layer's derived H1", () => {
  assert.match(splitsArea, /clearCellsButton\?\.addEventListener\("click", emptySelectedCells\);/);
  assert.match(splitsArea, /ref\.hopper\.resinName = "";\s*\n\s*ref\.hopper\.track = false;/);
  // H1's percentage is derived, never cleared directly.
  assert.match(splitsArea, /if \(ref\.hi > 0\)\{\s*\n\s*ref\.hopper\.pct = 0;/);
  assert.match(splitsArea, /touchedLayers\.forEach\(L=>\{\s*\n\s*recomputeAutoH1\(L\);/);
  // Disabled state moved from "nothing selected" to "nothing to empty" -
  // see recipe-empty-cells.test.js.
  assert.match(splitsArea, /if \(clearCellsButton\) clearCellsButton\.disabled = emptyable === 0;/);
});

/* ----------------------------------------------------------------------
 *   The bottom strip
 * -------------------------------------------------------------------- */

test("the bottom strip keeps Saved recipes / Load Next / Print, with Bulk edit gone and Rearrange relocated into the Edit panel", () => {
  assert.match(splitsArea, /recipeUtilityTabs\.append\(savedRecipesButton\);/);
  assert.match(splitsArea, /toolbar\.querySelector\("\.splitsEditRowSecondary"\)\?\.append\(rearrangeButton\);/);
  assert.match(splitsArea, /if \(loadNextButton\) recipeUtilityTabs\.append\(loadNextButton\);/);
  assert.match(splitsArea, /recipeUtilityTabs\.append\(printButton\);/);
});

test("Edit view and Saved Recipes no longer exclude each other on desktop - they occupy different halves of the panel", () => {
  const start = splitsArea.indexOf('savedRecipesButton.addEventListener("click", ()=>{');
  const body = splitsArea.slice(start, splitsArea.indexOf("      });", start));
  assert.match(body, /if \(turningOn && compactMobileRecipe\) setBulkMode\(false\);/);
});
