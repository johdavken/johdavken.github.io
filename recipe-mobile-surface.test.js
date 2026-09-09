"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const styles = readStyles();

function mediaBlockContaining(marker){
  const markerIndex = styles.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected CSS marker: ${marker}`);
  const start = styles.lastIndexOf("@media ", markerIndex);
  const open = styles.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < styles.length; index += 1){
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;
    if (depth === 0) return styles.slice(start, index + 1);
  }
  assert.fail(`Unclosed media query containing ${marker}`);
}

test("Compact Touch removes only Recipe's redundant outer card surface", () => {
  const block = mediaBlockContaining("Compact Touch Recipe surface");
  assert.match(block, /^@media \(width <= 700px\)\{/);
  assert.match(block, /body\[data-shell="touch"\]\[data-mobile-workspace="panel"\] #splitsBlock\.mobile-active,/);
  assert.match(block, /#splitsBlock\.mobile-active\[open\]\{[\s\S]*?padding:0;[\s\S]*?border:0;[\s\S]*?border-radius:0;[\s\S]*?background:transparent;[\s\S]*?box-shadow:none;/);
  assert.match(block, /#splitsBlock\.mobile-active > \.blockBody\{[\s\S]*?padding-right:0;[\s\S]*?padding-left:0;/);
  assert.doesNotMatch(block, /\.splitsMatrixFrame\s*\{/);
});

test("Compact Touch gives Recipe a modest page inset and preserves the matrix frame", () => {
  const block = mediaBlockContaining("Compact Touch Recipe surface");
  assert.match(block, /:has\(#splitsBlock\.mobile-active\) main\{[\s\S]*?padding-left:max\(12px, env\(safe-area-inset-left\)\);[\s\S]*?padding-right:max\(12px, env\(safe-area-inset-right\)\);/);
  assert.match(styles, /\.splitsMatrixFrame\{[\s\S]*?overflow:hidden;[\s\S]*?border:1px solid var\(--row-border\);[\s\S]*?border-radius:var\(--radius-row\);/);
});

test("Compact Touch puts a faint theme-aware workspace surface behind #splitsArea only - not a card, and not around the header/tabs", () => {
  const block = mediaBlockContaining("Compact Touch Recipe surface");
  const rule = block.slice(
    block.indexOf('#splitsBlock.mobile-active #splitsArea{'),
    block.indexOf('}', block.indexOf('#splitsBlock.mobile-active #splitsArea{')) + 1
  );
  assert.notEqual(rule, "", "expected a #splitsArea surface rule in the Compact Touch block");
  // Same touch/panel/mobile-active scope as the flatten rules above it.
  assert.match(block, /body\[data-shell="touch"\]\[data-mobile-workspace="panel"\] #splitsBlock\.mobile-active #splitsArea\{/);
  // A wash of the panel token, so it tracks every theme (and collapses on flat palettes).
  assert.match(rule, /background:color-mix\(in srgb, var\(--panel\) \d+%, transparent\);/);
  // Section surface, not a card: no border, at most a hairline radius.
  assert.doesNotMatch(rule, /border:/);
  assert.match(rule, /border-radius:[0-3]px;/);
  // Vertical breathing room only - horizontal padding is zeroed so the
  // matrix keeps its full width.
  assert.match(rule, /padding-inline:0;/);
  assert.match(rule, /padding-block:\d+px;/);
  // The surface lives on #splitsArea (which wraps the toolbar/matrix/helper),
  // never on the block, its summary, or the header row.
  assert.doesNotMatch(rule, /#splitsBlock\.mobile-active\s*\{/);
});

test("the surface reaches up to the tab divider: .blockBody row-gap is zeroed and the active tab is retinted to match", () => {
  const block = mediaBlockContaining("Compact Touch Recipe surface");
  // No grid gap between .recipeHeaderRow and #splitsArea, so the surface's
  // top edge sits on the divider the tabs are attached to.
  assert.match(block, /#splitsBlock\.mobile-active > \.blockBody\{[\s\S]*?gap:0;/);
  // The active page tab takes the same faint wash as the surface (not the
  // base rule's solid --panel) and its 1px seam shadow is retinted too, so
  // the tab reads as cut from the surface.
  const tab = block.slice(
    block.indexOf('#splitsBlock.mobile-active .recipePageTab.active{'),
    block.indexOf('}', block.indexOf('#splitsBlock.mobile-active .recipePageTab.active{')) + 1
  );
  assert.notEqual(tab, "", "expected an active-tab retint in the Compact Touch block");
  assert.match(tab, /background:color-mix\(in srgb, var\(--panel\) 40%, transparent\);/);
  assert.match(tab, /box-shadow:0 1px 0 0 color-mix\(in srgb, var\(--panel\) 40%, transparent\);/);
});

test("the workspace surface is Compact Touch only - the >=701px block never gives #splitsArea its own background", () => {
  const wide = mediaBlockContaining("--- Recipe ------------------------------------------------------");
  assert.match(wide, /^@media \(min-width: 701px\)\{/);
  assert.doesNotMatch(wide, /#splitsArea\{[^}]*background:/);
});

test("the compact A-E layer headers blend into the surface: no fill, no column lines, one grid line beneath, and the frame's rounded top is opened", () => {
  // Header: no fill, no column borders, but a border-bottom in the plain
  // grid-line colour so it reads as the top edge of the hopper grid.
  assert.match(styles, /\.splitsMatrix\.compactMobileRecipe th\.splitLayerHeader\.mobile-layer-active\{\s*\n\s*border:0;\s*\n\s*border-bottom:1px solid var\(--row-border-2\);\s*\n\s*background:transparent;\s*\n\s*\}/);
  // Frame: top border + top corners removed on the compact grid only,
  // sides/bottom kept.
  assert.match(styles, /\.splitsMatrixFrame:has\(\.splitsMatrix\.compactMobileRecipe\)\{\s*\n\s*border-top:0;\s*\n\s*border-top-left-radius:0;\s*\n\s*border-top-right-radius:0;\s*\n\s*\}/);
  // The base th fill and the mobile-layer-active divider it overrides, and
  // the base rounded frame, all still stand for the non-compact grid.
  assert.match(styles, /\.splitsMatrix thead th\{[\s\S]*?background:color-mix\(in srgb,var\(--panelOpen\) 72%,transparent\);/);
  assert.match(styles, /\.splitsMatrix th\.splitLayerHeader\.mobile-layer-active\{[\s\S]*?border-bottom: 1px solid var\(--border\);/);
  assert.match(styles, /\.splitsMatrixFrame\{[\s\S]*?border:1px solid var\(--row-border\);[\s\S]*?border-radius:var\(--radius-row\);/);
});

test("mobile legal metadata is visible on Main and hidden on section screens", () => {
  assert.match(styles, /\.mobileFooterMeta\{display:none\}/);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.mobileFooterMeta\{[\s\S]*?position:fixed;[\s\S]*?display:flex;/);
  assert.doesNotMatch(styles, /body\[data-mobile-workspace="panel"\] \.mobileFooterMeta\{[^}]*display:flex/);
});
