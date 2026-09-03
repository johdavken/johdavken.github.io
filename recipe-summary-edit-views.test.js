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

test("the view toggle sits in a header row beside the Current/Next/Recipe Book tabs, matching the Weights control", () => {
  assert.match(html, /<div class="recipeHeaderRow">/);
  assert.match(html, /<div class="recipeViewToggle" id="recipeViewToggle" role="group" aria-label="Recipe view">/);
  assert.match(html, /<button type="button" class="primary actionRail active" data-button-kind="toggle" data-button-size="small" data-recipe-view="summary" aria-pressed="true">Summary<\/button>/);
  assert.match(html, /<button type="button" class="secondary" data-button-kind="toggle" data-button-size="small" data-recipe-view="edit" aria-pressed="false">Edit<\/button>/);
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

test("Summary/Edit survives on compact mobile only - the reworked wide grid has no mode axis at all", () => {
  assert.match(splitsArea, /const viewMode = splitsViewMode;/);
  // One flag decides it: above the compact-mobile breakpoint the grid is
  // always live, always selectable, and never in Summary.
  assert.match(splitsArea, /const reworkedGrid = !compactMobileRecipe;/);
  assert.match(splitsArea, /const summaryView = reworkedGrid \? false : viewMode === "summary";/);
  assert.match(splitsArea, /let bulkMode = reworkedGrid \? true : viewMode === "edit";/);
  assert.match(splitsArea, /area\.dataset\.recipeView = summaryView \? "summary" : "edit";/);
  // The new grid's CSS hangs off its own attribute rather than overloading
  // data-recipe-view, so the stacked mobile rules stay untouched.
  assert.match(splitsArea, /area\.dataset\.recipeLayout = reworkedGrid \? "transposed" : "stacked";/);
  // Nothing left to switch between, so the control goes away with the mode -
  // set by syncRecipePageUI, which owns that flag and runs after the
  // renderer, alongside the other pages that hide it.
  assert.match(app, /viewToggle\.hidden = isSavedRecipesPage\(\) \|\| isWeightsPage\(\) \|\| !layoutModeQueries\.compactRecipe\.matches;/);
});

test("the reworked grid types in the cell on tablet too; compact mobile still edits through the panel", () => {
  assert.match(splitsArea, /const cellsTypeable = reworkedGrid \|\| isDesktopLayout\(\);/);
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

test("tracking is Current-only - the plan cannot carry tracking at all - and no longer needs Summary on the reworked grid", () => {
  assert.match(splitsArea, /const trackingView = !isNextRecipePage\(\) && \(reworkedGrid \|\| summaryView\);/);
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

test("Summary and Edit mark cells differently - a background wash for tracked, an outline for selected - so the two never read as the same state", () => {
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitsMatrix tbody \.splitMatrixCell\.selected\{[\s\S]*?box-shadow: inset 0 0 0 2px var\(--focus-border\);/);
  // Tracked = a plain --ok background wash in both views, no bar or outline.
  assert.match(styles, /#splitsArea\[data-recipe-view="summary"\] \.splitsMatrix tbody \.splitMatrixCell\.tracked,\s*\n\s*#splitsArea\[data-recipe-view="edit"\] \.splitsMatrix tbody \.splitMatrixCell\.tracked:not\(\.selected\)\{ background:transparent; \}/);
  assert.doesNotMatch(styles, /\.splitMatrixCell\.tracked[^{]*\{[^}]*inset 3px 0 0/);
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

test("Edit restores the row/column select affordances that .bulk-editing used to supply - the header column itself is permanent now (both views), only the interactive styling/label toggle with view", () => {
  assert.match(styles, /#splitsBlock #splitsArea \.splitsMatrix tr > :first-child\{\s*\n\s*display: table-cell;/);
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitRowSelect\.selected\{/);
  assert.match(styles, /#splitsArea\[data-recipe-view="edit"\] \.splitLayerTitle\.partiallySelected\{/);
});

test("the row gutter's corner label is conditional on view, not the column's existence - Select row only in Edit, quiet/blank in Summary so a control that doesn't exist there isn't named", () => {
  assert.match(app, /corner\.textContent = summaryView \? "" : "Select row";/);
});

test("selection stays keyboard-reachable: the checkbox is visually hidden, not removed", () => {
  const rule = styles.slice(styles.indexOf('#splitsArea[data-recipe-view="edit"] .splitCellSelector{'));
  const block = rule.slice(0, rule.indexOf("}") + 1);
  assert.match(block, /display: block;/);
  assert.match(block, /clip: rect\(0,0,0,0\);/);
  assert.doesNotMatch(block, /display: none/);
});

test("the Edit panel is two rows above the grid: values/apply, then selection and structural actions", () => {
  assert.match(splitsArea, /<div class="splitsEditRow splitsEditRowPrimary">/);
  assert.match(splitsArea, /<div class="splitsEditRow splitsEditRowSecondary">/);
  const primary = splitsArea.slice(splitsArea.indexOf('<div class="splitsEditRow splitsEditRowPrimary">'), splitsArea.indexOf('<div class="splitsEditRow splitsEditRowSecondary">'));
  const secondary = splitsArea.slice(splitsArea.indexOf('<div class="splitsEditRow splitsEditRowSecondary">'));
  assert.doesNotMatch(primary, /id="splitSelectionStatus"/);
  assert.match(secondary, /id="splitSelectionStatus"/);
  // Select all was removed - there's no real case for selecting every
  // cell in the matrix at once, and Reset Recipe already covers "start
  // over" - so Clear selection took its slot instead.
  assert.doesNotMatch(secondary, /id="selectAllSplits"/);
  assert.match(secondary, /id="clearSplitSelection"/);
  assert.match(splitsArea, /<button id="clearSelectedCells"[^>]*data-button-variant="quiet"[^>]*aria-label="Empty selected cells"[^>]*disabled>[\s\S]*?<span>Empty cells<\/span><\/button>/);
  assert.match(splitsArea, /<button id="resetAllSplits"[^>]*data-button-variant="danger"[^>]*aria-label="Reset recipe"[^>]*>[\s\S]*?<span>Reset Recipe<\/span><\/button>/);
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

test("every recipe view ends with a quiet, layout-aware hopper-action reminder", () => {
  assert.match(splitsArea, /interactionHint\.className = "recipeInteractionHint";/);
  assert.match(splitsArea, /const interactionVerb = isDesktopLayout\(\) \? "CLICK" : "TAP";/);
  // The reworked grid selects and tracks at the same time, so it names both
  // rather than whichever mode happens to be on; compact mobile keeps the
  // one-mode-at-a-time wording.
  assert.match(splitsArea, /const interactionAction = reworkedGrid\s*\?\s*\(trackingView \? "select · click its dot to track" : "select"\)\s*:\s*\(viewMode === "edit" \? "edit" : \(trackingView \? "track" : "view"\)\);/);
  assert.match(splitsArea, /interactionCommand\.className = "recipeInteractionHintCommand";/);
  assert.match(splitsArea, /interactionCommand\.textContent = interactionVerb;/);
  assert.match(splitsArea, /document\.createTextNode\(` a hopper to \$\{interactionAction\}`\),/);
  assert.match(splitsArea, /interactionCount\.textContent = ` - \$\{count\} selected`;/);
  assert.match(splitsArea, /viewMode === "edit"\s*\? selected\.size\s*:\ \(trackingView \? trackedHopperCount\(\) : 0\);/);
  // Counts only appear once there is something to count, so an untouched
  // grid ends with no trailing " - 0 selected".
  assert.match(splitsArea, /interactionCount\.textContent = parts\.length \? ` - \$\{parts\.join\(" · "\)\}` : "";/);
  assert.match(splitsArea, /updateInteractionHint\(\);/);
  assert.match(splitsArea, /area\.append\(interactionHint\);/);
  assert.match(styles, /\.recipeInteractionHint\{[\s\S]*?color:var\(--muted\);[\s\S]*?font-size:calc\(var\(--font-tiny\) \* \.75\);[\s\S]*?text-align:center;/);
  assert.match(styles, /\.recipeInteractionHintCommand\{\s*color:var\(--recipe-pill-accent\);/);
});

test("on wide desktop the centered hint is capped to the five-layer rail, so it stays under the left-aligned matrix instead of centering on the whole panel", () => {
  // Inside the desktop @media (min-width: 901px) and (pointer: fine) block,
  // next to the same cap on .splitsMatrixFrame and .recipeHeaderRow.
  const desktopBlock = styles.slice(styles.indexOf("@media (min-width: 901px) and (pointer: fine)"));
  assert.match(
    desktopBlock,
    /#splitsArea > \.recipeInteractionHint\{\s*width: min\(100%, var\(--recipe-five-layer-rail\)\);\s*\}/
  );
  // The base rule keeps centering the text; only the box width is constrained.
  assert.match(styles, /\.recipeInteractionHint\{[\s\S]*?text-align:center;[\s\S]*?\}/);
});

/* ----------------------------------------------------------------------
 *   The bottom strip
 * -------------------------------------------------------------------- */

test("Load Current/Next and Print move beside the view buttons; Recipe Book remains beside Next", () => {
  assert.match(html, /data-recipe-page="next">[\s\S]*?data-recipe-page="saved" hidden><span class="recipeTabLabel">Recipe Book<\/span>/);
  assert.doesNotMatch(splitsArea, /recipeUtilityTabs\.append\(savedRecipesButton\);/);
  assert.match(splitsArea, /toolbar\.querySelector\("\.splitsEditRowSecondary"\)\?\.append\(rearrangeButton\);/);
  assert.match(html, /class="recipeHeaderActions" id="recipeHeaderActions" role="group" aria-label="Recipe actions"/);
  assert.match(splitsArea, /if \(loadNextButton\) headerActions\?\.append\(loadNextButton\);/);
  assert.match(splitsArea, /if \(loadCurrentButton\) headerActions\?\.append\(loadCurrentButton\);/);
  assert.match(splitsArea, /headerActions\?\.append\(printButton\);/);
  assert.doesNotMatch(splitsArea, /area\.append\(recipeUtilityTabs\)/);
});

test("Recipe Book is a page replacement, so Edit controls and the matrix cannot remain visible behind it", () => {
  const setter = functionBody("setRecipePage");
  assert.match(setter, /if \(next === "saved" \|\| next === "weights"\)\{\s*splitsBulkModeActive = false;/);
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > :not\(\.splitsSavedRecipesPanel\)\{\s*display: none!important;/);
  const sync = functionBody("syncRecipePageUI");
  assert.match(sync, /viewToggle\.hidden = isSavedRecipesPage\(\) \|\| isWeightsPage\(\) \|\| !layoutModeQueries\.compactRecipe\.matches;/);
});
