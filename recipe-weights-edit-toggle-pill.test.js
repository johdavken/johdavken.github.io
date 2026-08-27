"use strict";

// Recipe's and Weights' Edit/Done toggle collapses to one visible button
// (Summary is CSS-hidden everywhere - see #recipeViewToggle > span), which
// used to inherit the app's plain button.secondary/button.primary look: a
// near-square outlined rectangle with nothing else nearby to relate it to,
// starkest on Receiver Hopper Weights where it has no sibling action at
// all. Mockup #1 in previews/edit-toggle-button-alternatives.html replaced
// that with an accent-filled pill, implemented here.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

function pillRule(){
  const start = styles.indexOf('#recipeHeaderControls .recipeViewToggle button[data-recipe-view="edit"],');
  assert.notEqual(start, -1, "expected the accent-filled pill rule");
  return styles.slice(start, styles.indexOf("\n.recipeHeaderActions{", start));
}

test("the pill targets both Recipe's and Weights' visible Edit button, never the CSS-hidden Summary one", () => {
  const rule = pillRule();
  assert.match(rule, /#recipeHeaderControls \.recipeViewToggle button\[data-recipe-view="edit"\],\s*\n#recipeHeaderControls \.recipeViewToggle button\[data-weight-view="edit"\]\{/);
  assert.doesNotMatch(rule, /data-recipe-view="summary"|data-weight-view="summary"/);
});

test("solid gradient fill in the theme accent, pill-rounded, white text - not the app's generic outlined button.secondary/button.primary", () => {
  const rule = pillRule();
  assert.match(rule, /border-radius: 999px;/);
  assert.match(rule, /background: linear-gradient\(180deg, color-mix\(in srgb, var\(--focus-border\) 88%, white\), color-mix\(in srgb, var\(--focus-border\) 78%, black 6%\)\);/);
  assert.match(rule, /color: #fff;/);
  assert.match(rule, /border: 0;/);
});

test("carries a pencil icon via a masked ::before (recolors with currentColor) rather than requiring every call site to add an <svg>", () => {
  const rule = pillRule();
  assert.match(rule, /::before,[\s\S]*?::before\{[\s\S]*?background-color: currentColor;[\s\S]*?mask-image: url\("data:image\/svg\+xml,/);
});

test("is scoped to this one control only - the app's shared button.secondary/button.primary/button.primary.actionRail rules are untouched", () => {
  assert.match(styles, /^button\.secondary,/m);
  assert.match(styles, /^button\.primary,/m);
  assert.match(styles, /^button\.primary\.actionRail\{/m);
});

test("#recipeHeaderControls-prefixed so it outranks button.primary.actionRail's tied specificity regardless of source order - both are 0,2,1 without the ID", () => {
  const rule = pillRule();
  assert.match(rule, /^#recipeHeaderControls \.recipeViewToggle button\[data-recipe-view="edit"\],/m);
});

test("a subtle hover brightness bump signals interactivity without a second color to maintain per theme", () => {
  const rule = pillRule();
  assert.match(rule, /:hover:not\(:disabled\),\s*\n#recipeHeaderControls \.recipeViewToggle button\[data-weight-view="edit"\]:hover:not\(:disabled\)\{\s*\n\s*filter: brightness\(1\.08\);/);
});
