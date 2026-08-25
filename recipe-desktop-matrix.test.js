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
  assert.match(body, /\.splitsMatrixFrame\{[\s\S]*?width: var\(--recipe-five-layer-rail\);[\s\S]*?margin-inline: 0;/);
  // The base (mobile-inclusive) rule must remain centered - only desktop
  // overrides it, so mobile's own width:100% override elsewhere is untouched.
  assert.match(styles, /\.splitsMatrixFrame\{\s*\n\s*width:max-content;\s*\n\s*margin-inline:auto;/);
});

test("Summary preserves Edit's selector track so the matrix never shifts between views", () => {
  const body = desktopBlock();
  assert.match(body, /#splitsArea\[data-recipe-view="summary"\] \.splitsMatrix tr > :first-child\{[\s\S]*?display: table-cell;[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/);
});

test("the 10% size increase is scoped to .splitsMatrixFrame, not #splitsArea - the surrounding toolbars must stay their normal size", () => {
  const body = desktopBlock();
  assert.match(body, /#splitsArea \.splitsMatrixFrame\{\s*\n\s*--font-base: calc\(var\(--font-base\) \* 1\.1\);/);
  assert.doesNotMatch(body, /#splitsArea\{\s*\n\s*--font-base/, "the font scaling must not be declared directly on #splitsArea - that would also grow .recipeUtilityTabs/.splitsBulkModeBar");
});

test("column width, the hopper-designation badge, and the Track toggle clock icon are each ~10% larger on desktop", () => {
  const body = desktopBlock();
  assert.match(body, /#splitsArea \.splitsMatrix thead th,\s*\n\s*#splitsArea \.splitMatrixCell\{ min-width: 198px; width: 198px; max-width: 198px; \}/);
  assert.match(body, /#splitsArea \.splitCellHopperName\{ min-width: 29px; height: 24px;/);
  assert.match(body, /#splitsArea \.splitTrackButton\{ width: 25px; height: 25px; min-height: 25px; \}/);
  assert.match(body, /#splitsArea \.splitTrackButton svg\{ width: 21px; height: 21px; \}/);
});

test("desktop tracked cells use an altered labeled badge while Edit owns the cell outline", () => {
  const body = desktopBlock();
  assert.match(body, /\.splitMatrixCell\.tracked,\s*\n\s*#splitsArea\[data-recipe-view="edit"\][^{]*\.splitMatrixCell\.tracked:not\(\.selected\)\{[\s\S]*?background: var\(--desktop-recipe-cell-bg\);[\s\S]*?box-shadow: none;/);
  assert.match(body, /\.splitMatrixCell\.selected\{[\s\S]*?background: var\(--desktop-recipe-cell-bg\);[\s\S]*?box-shadow: inset 0 0 0 2px var\(--focus-border\);/);
  assert.match(body, /\.splitMatrixCell\.selected::after\{[\s\S]*?content: "EDIT";[\s\S]*?font-size: 8px;/);
  assert.match(body, /\.splitMatrixCell\.tracked \.splitCellHopperName\{[\s\S]*?border-radius: 7px 14px 14px 7px;[\s\S]*?color: var\(--focus-border\);/);
  assert.match(body, /\.splitMatrixCell\.tracked \.splitCellHopperName::after\{[\s\S]*?width: 6px;[\s\S]*?border-radius: 50%;/);
  assert.match(body, /\.splitMatrixCell\.tracked \.splitCellHeader::after\{[\s\S]*?content: "TRACKING";/);
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
  assert.match(body, /\.splitsBulkBar,\s*\n\s*\.splitsSavedRecipesPanel,\s*\n\s*\.rearrangeModeBar\{/);
  assert.match(body, /--font-base: calc\(var\(--font-base\) \* \.85\);/);
  assert.match(body, /--control-height: calc\(var\(--control-height\) \* \.85\);/);
  // .recipeUtilityTabs/.recipeUtilityTab must never appear as a selector
  // inside this 0.85x block - the tab strip itself stays full size.
  const shrinkBlockStart = body.indexOf(".splitsBulkBar,\n  .splitsSavedRecipesPanel,\n  .rearrangeModeBar{");
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
  const elseBranchEnd = app.indexOf("\n      }\n\n      // Percentage problems", elseBranchStart);
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
