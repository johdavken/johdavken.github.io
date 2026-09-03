"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

function desktopBlock(){
  const start = styles.indexOf("@media (min-width: 901px) and (pointer: fine){");
  assert.notEqual(start, -1, "expected the desktop Recipe matrix block");
  const end = styles.indexOf("\n}\n\n@media (hover:hover){", start);
  assert.notEqual(end, -1);
  return styles.slice(start, end);
}

test("the Recipe matrix left-aligns instead of centering, desktop only", () => {
  const body = desktopBlock();
  assert.match(body, /\.splitsMatrixFrame\{[\s\S]*?width: min\(100%, var\(--recipe-five-layer-rail\)\);[\s\S]*?margin-inline: 0;/);
  // The base (mobile-inclusive) rule must remain centered - only desktop
  // overrides it, so mobile's own width:100% override elsewhere is untouched.
  assert.match(styles, /\.splitsMatrixFrame\{\s*\n\s*width:max-content;\s*\n\s*margin-inline:auto;/);
});

test("the matrix frame is capped at min(100%, rail) rather than a bare rail width, and #splitsArea's grid column is pinned to the container - a fixed 1062px frame sized #splitsArea's auto/max-content column to 1062px even when the panel only had ~726px, so every sibling in that column resolved percentages against 1062px. That is what made opening Edit appear to widen the panel: #splitsBulkBar's own width:min(100%, rail) saw 100% = 1062px and painted past the rail, detaching the header from the grid's right edge", () => {
  const body = desktopBlock();
  assert.match(body, /#splitsArea\{\s*\n\s*grid-template-columns: minmax\(0, 1fr\);\s*\n\s*\}/);
  // The header row and the Edit toolbar already used this same capped rail -
  // the frame disagreeing with them is what split the layout into two rails.
  assert.match(styles, /#splitsBlock \.recipeHeaderRow,\s*\n\s*#splitsArea > \.splitsBulkBar\{\s*\n\s*width: min\(100%, var\(--recipe-five-layer-rail\)\);/);
});

test("desktop marks the active layer count and textures only the unused one- and three-layer rail space", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const body = desktopBlock();
  assert.match(app, /frame\.dataset\.layerCount = String\(layerNames\.length\);/);
  assert.match(body, /\.splitsMatrixFrame\[data-layer-count="1"\],\s*\n\s*#splitsArea \.splitsMatrixFrame\[data-layer-count="3"\]/);
  const latticeStart = body.indexOf('#splitsArea .splitsMatrixFrame[data-layer-count="1"],');
  const latticeBlock = body.slice(latticeStart, body.indexOf('}', latticeStart) + 1);
  assert.doesNotMatch(latticeBlock, /background:/, "the live cells stay on their existing transparent matrix surface");
  assert.match(body, /\.splitsMatrixFrame\[data-layer-count="1"\]\{ --recipe-active-rail: 268px; \}/);
  assert.match(body, /\.splitsMatrixFrame\[data-layer-count="3"\]\{ --recipe-active-rail: 664px; \}/);
  assert.match(body, /background-size: 42px 72px;/);
  assert.match(body, /pointer-events: none;/);
  assert.match(body, /\[data-theme="gruvbox-dark"\],[\s\S]*?\[data-theme="everforest"\],[\s\S]*?\.splitsMatrixFrame:is\(\[data-layer-count="1"\],\[data-layer-count="3"\]\)::after\{[\s\S]*?background-color: color-mix\(in srgb, var\(--bg\) 76%, #000\);/);
});

test("Summary no longer collapses the row gutter - it's a permanent column now, so toggling Edit never shifts Columns A-E. Same fix as the header-row/Edit-toolbar rail alignment work: the gutter is reserved everywhere, only its content (Select row label, interactive styling) changes with view", () => {
  const body = desktopBlock();
  assert.doesNotMatch(body, /#splitsArea\[data-recipe-view="summary"\] \.splitsMatrix tr > :first-child\{\s*\n\s*display: none;/);
  assert.match(styles, /#splitsBlock #splitsArea \.splitsMatrix tr > :first-child\{\s*\n\s*display: table-cell;\s*\n\s*min-width: 70px;\s*\n\s*width: 70px;\s*\n\s*max-width: 70px;\s*\n\s*\}/);
});

test("the 10% size increase is scoped to .splitsMatrixFrame, not #splitsArea - the surrounding toolbars must stay their normal size", () => {
  const body = desktopBlock();
  // A custom property that reads its own name back out is a cycle (even
  // through calc()) and Chromium resolves it to nothing, so the actual
  // scaling can't live in a --font-base: calc(var(--font-base) * 1.1)
  // declared on .splitsMatrixFrame itself. #splitsArea precomputes the
  // scaled value under a different name (--font-base-x11) and
  // .splitsMatrixFrame just reassigns the real token from that - #splitsArea
  // itself must never assign --font-base directly (only the "-x11" alias),
  // or every descendant, including the toolbars, would inherit the scaled
  // value instead of just the matrix.
  assert.match(body, /#splitsArea\{\s*\n\s*--font-base-x11: calc\(var\(--font-base\) \* 1\.1\);/);
  assert.match(body, /#splitsArea \.splitsMatrixFrame\{\s*\n\s*--font-base: var\(--font-base-x11\);/);
  assert.doesNotMatch(body, /#splitsArea\{\s*\n\s*--font-base:/, "the font scaling must not be declared directly on #splitsArea - that would also grow .recipeUtilityTabs/.splitsBulkModeBar");
});

test("column width, the hopper-designation badge, and the Track toggle clock icon are each ~10% larger on desktop", () => {
  const body = desktopBlock();
  assert.match(body, /#splitsArea \.splitsMatrix thead th,\s*\n\s*#splitsArea \.splitMatrixCell\{ min-width: 198px; width: 198px; max-width: 198px; \}/);
  assert.match(body, /#splitsArea \.splitCellHopperName\{ min-width: 29px; height: 24px;/);
  assert.match(body, /#splitsArea \.splitTrackButton\{ width: 25px; height: 25px; min-height: 25px; \}/);
  assert.match(body, /#splitsArea \.splitTrackButton svg\{ width: 21px; height: 21px; \}/);
});

test("desktop tracked cells retain their normal surface while the hopper badge itself highlights", () => {
  const body = desktopBlock();
  // Tracked (Summary or Edit) = a --ok wash over the cell's own fill, no shadow.
  assert.match(body, /\.splitMatrixCell\.tracked,\s*\n\s*#splitsArea\[data-recipe-view="edit"\][^{]*\.splitMatrixCell\.tracked\{[\s\S]*?background:var\(--desktop-recipe-cell-bg\);[\s\S]*?box-shadow: none;/);
  assert.match(body, /\.splitMatrixCell\.selected\{[\s\S]*?background: var\(--desktop-recipe-cell-bg\);[\s\S]*?box-shadow: inset 0 0 0 2px var\(--focus-border\);/);
  // A tracked cell selected in Edit keeps the ordinary cell surface under the selection outline.
  assert.match(body, /\.splitMatrixCell\.tracked\.selected\{[\s\S]*?background:var\(--desktop-recipe-cell-bg\);/);
  assert.match(body, /\.splitMatrixCell\.selected::after\{[\s\S]*?content: "EDIT";[\s\S]*?font-size: 8px;/);
  // Tracking sits inside the hopper badge itself (no clock icon, no
  // cell-corner marker, no spelled-out "TRACKING" label) - Summary view
  // only, so it never competes with Edit's own status label.
  assert.doesNotMatch(styles, /splitHopperTrackingClock/);
  assert.match(styles, /#splitsArea\[data-recipe-view="summary"\] \.splitsMatrix tbody \.splitMatrixCell\.tracked \.splitCellHopperName\{[\s\S]*?background:color-mix\(in srgb,var\(--ok\)[\s\S]*?color:var\(--ok\);/);
  assert.doesNotMatch(styles, /\.splitMatrixCell\.tracked::before/);
  assert.doesNotMatch(body, /content: "TRACKING"/);
});

test("hovering a cell no longer highlights its whole row", () => {
  assert.doesNotMatch(styles, /tbody tr:hover \.splitMatrixCell/);
});

test("the static row/column shading alternates by column (layer), not by row", () => {
  assert.doesNotMatch(styles, /\.splitsMatrix tbody tr:nth-child\(even\) \.splitMatrixCell/);
  assert.match(styles, /\.splitsMatrix tbody td\.splitMatrixCell:nth-child\(even\)\{background:color-mix\(in srgb,var\(--row-bg-2\) 55%,transparent\)\}/);
});

test("Saved recipes/Bulk edit/Rearrange panel content is 15% smaller on desktop, but the tab strip that opens them is untouched", () => {
  const body = desktopBlock();
  // Same self-reference cycle as the matrix's 1.1x block above, at 25
  // properties instead of 3 - #splitsBlock (not #splitsArea, so the same
  // "-x85" tokens also reach .recipeHeaderControls) precomputes the scaled
  // values under "-x85" names and the real tokens are reassigned from those.
  assert.match(body, /#splitsBlock\{\s*\n\s*--font-base-x85: calc\(var\(--font-base\) \* \.85\);/);
  assert.match(body, /--control-height-x85: calc\(var\(--control-height\) \* \.85\);/);
  assert.match(body, /\.splitsBulkBar,\s*\n\s*\.splitsSavedRecipesPanel,\s*\n\s*\.rearrangeModeBar,\s*\n\s*\.recipeHeaderControls\{/);
  assert.match(body, /--font-base: var\(--font-base-x85\);/);
  assert.match(body, /--control-height: var\(--control-height-x85\);/);
  // .recipeUtilityTabs/.recipeUtilityTab must never appear as a selector
  // inside this 0.85x block - the tab strip itself stays full size.
  const shrinkBlockStart = body.indexOf(".splitsBulkBar,\n  .splitsSavedRecipesPanel,\n  .rearrangeModeBar,\n  .recipeHeaderControls{");
  assert.notEqual(shrinkBlockStart, -1);
  const shrinkBlock = body.slice(shrinkBlockStart);
  assert.doesNotMatch(shrinkBlock, /recipeUtilityTab/);
});

test("Load Current/Next and Print physically relocate into the desktop header without gaining tab semantics", () => {
  const appJsPath = require.resolve("./app.js");
  const app = fs.readFileSync(appJsPath, "utf8");
  assert.match(app, /loadNextButton\?\.classList\.add\("recipeHeaderAction"\);/);
  assert.match(app, /printButton\.classList\.remove\("recipeActionTertiary"\);\s*\n\s*printButton\.classList\.add\("secondary", "recipeHeaderAction"\);/);
  // This must live inside the desktop-only (!compactMobileRecipe) branch,
  // not be applied unconditionally,
  // since loadNextButton is reused as-is (still in modeBar) on mobile.
  const elseBranchStart = app.indexOf('// Current/Next and Print are ordinary app buttons in the header.');
  const elseBranchEnd = app.indexOf("// Percentage problems", elseBranchStart);
  assert.notEqual(elseBranchStart, -1);
  assert.notEqual(elseBranchEnd, -1);
  const elseBranch = app.slice(elseBranchStart, elseBranchEnd);
  // .append() moves each node here from modeBar (its original parent) -
  // no separate removal call needed.
  assert.match(elseBranch, /if \(loadNextButton\) headerActions\?\.append\(loadNextButton\);/);
  assert.match(elseBranch, /if \(loadCurrentButton\) headerActions\?\.append\(loadCurrentButton\);/);
  assert.match(elseBranch, /headerActions\?\.append\(printButton\);/);
  assert.doesNotMatch(elseBranch, /savedRecipesButton/);
  assert.doesNotMatch(elseBranch, /setAttribute\("role", "tab"\)/, "the lower strip contains actions, not page tabs");
});

test(".recipeActionTab is a lean modifier (icon+label flex layout only) combined with .recipeUtilityTab, which supplies the actual tab shape - not a standalone duplicate of it", () => {
  const start = styles.indexOf(".recipeActionTab{");
  assert.notEqual(start, -1);
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /display: inline-flex;/);
  assert.doesNotMatch(rule, /border-radius:/, ".recipeActionTab must not redeclare the tab shape - that comes from .recipeUtilityTab once both classes are combined");
});
