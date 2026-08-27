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

test("tinted-surface fill in the theme accent, pill-rounded, normal foreground text - not the app's generic outlined button.secondary/button.primary", () => {
  const rule = pillRule();
  assert.match(rule, /border-radius: 999px;/);
  // Three fills were tried here: a gradient read as a glossy skin that
  // didn't hold up across every theme's palette; a flat 100%-strength
  // var(--recipe-pill-accent) fill with white text was an improvement but
  // still read as too bright/saturated on several themes (worst on dark
  // ones); adding a ~45%-strength matching border to the tint after that
  // didn't sit cleanly on this fully round (border-radius:999px) pill, so
  // it was dropped again. color-mix(var(--recipe-pill-accent) 28%,
  // var(--panel2)) + var(--text), no border, is what's left.
  assert.match(rule, /border: 0;/);
  assert.match(rule, /background: color-mix\(in srgb, var\(--recipe-pill-accent\) 28%, var\(--panel2\)\);/);
  assert.doesNotMatch(rule, /linear-gradient/);
  assert.match(rule, /color: var\(--text\);/);
  assert.doesNotMatch(rule, /color: #fff;/);
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
