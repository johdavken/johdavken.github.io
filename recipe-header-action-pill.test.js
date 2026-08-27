"use strict";

// Recipe's Edit/Done pill and its Load Next-or-Current/Print buttons used to
// be two unrelated visual languages (one accent pill, one pair of plain
// .secondary buttons) divided by a hairline. #recipeHeaderActionPill wraps
// both existing groups (same ids/classes, same JS append/hide/disable logic
// - see recipe-desktop-matrix.test.js, recipe-mobile-toolbar.test.js,
// recipe-load-current.test.js for those invariants) so they read as one
// segmented group on desktop/tablet - individually rounded segments
// separated by a real gap (recipe-edit-toolbar-pill.test.js's own pill went
// through the same seamless-clip-to-gap redesign first) - while staying a
// bare flex passthrough on mobile so the solo Edit pill there is
// pixel-identical to before.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

test("the wrapper sits around both existing groups, unchanged, inside #recipeHeaderControls", () => {
  const start = html.indexOf('<div class="recipeHeaderControls" id="recipeHeaderControls">');
  assert.notEqual(start, -1);
  const block = html.slice(start, html.indexOf("</div>\n      </div>", start));
  assert.match(block, /<div class="recipeHeaderActionPill" id="recipeHeaderActionPill">/);
  assert.match(block, /<div class="recipeViewToggle" id="recipeViewToggle" role="group" aria-label="Recipe view">/);
  assert.match(block, /<div class="recipeHeaderActions" id="recipeHeaderActions" role="group" aria-label="Recipe actions"><\/div>/);
  // recipeViewToggle and recipeHeaderActions must be inside the pill wrapper,
  // not siblings of it, or the joined-pill clip below has nothing to clip.
  const pillStart = block.indexOf('id="recipeHeaderActionPill"');
  const toggleStart = block.indexOf('id="recipeViewToggle"');
  const actionsStart = block.indexOf('id="recipeHeaderActions"');
  assert.ok(pillStart < toggleStart && toggleStart < actionsStart);
});

test("mobile gets zero visual footprint from the wrapper - no decorative properties outside min-width:701px", () => {
  const bare = styles.slice(
    styles.indexOf("#recipeHeaderActionPill{"),
    styles.indexOf("@media (min-width: 701px){\n  #recipeHeaderActionPill")
  );
  assert.match(bare, /#recipeHeaderActionPill\{\s*\n\s*display: flex;\s*\n\s*align-items: stretch;\s*\n\s*gap: 0;\s*\n\s*\}/);
  assert.doesNotMatch(bare, /overflow:\s*hidden/);
  assert.doesNotMatch(bare, /border-radius:\s*999px/);
});

test("Load Next-or-Current and Print adopt the Edit pill's gradient/white-text look, icons recolor for free via currentColor", () => {
  const start = styles.indexOf("@media (min-width: 701px){\n  #recipeHeaderActionPill");
  const block = styles.slice(start, styles.indexOf("\n}\n", start) + 2);
  assert.match(block, /#recipeHeaderActionPill\.recipeHeaderActionPill \.recipeHeaderAction\{\s*\n\s*border: 0;\s*\n\s*background: linear-gradient\(180deg, color-mix\(in srgb, var\(--focus-border\) 88%, white\), color-mix\(in srgb, var\(--focus-border\) 78%, black 6%\)\);\s*\n\s*color: #fff;/);
  // .recipeActionIcon already uses stroke:currentColor (styles.css), so no
  // icon markup change is needed for the recolor - just documenting the
  // dependency so it isn't accidentally broken.
  assert.match(styles, /\.recipeActionIcon\{[\s\S]*?stroke: currentColor;/);
  assert.match(block, /#recipeHeaderActionPill\.recipeHeaderActionPill \.recipeHeaderAction:disabled\{\s*\n\s*opacity: \.5;\s*\n\s*\}/);
});

test("focus rings keep their inset offset, unchanged by the divider-to-gap redesign", () => {
  const start = styles.indexOf("@media (min-width: 701px){\n  #recipeHeaderActionPill");
  const block = styles.slice(start, styles.indexOf("\n}\n", start) + 2);
  assert.match(block, /#recipeHeaderActionPill\.recipeHeaderActionPill button:focus-visible\{\s*\n\s*outline-offset: -2px;\s*\n\s*\}/);
});

test("the wrapper no longer clips to a pill or forces flat inner corners - segments are individually rounded and separated by a real gap instead, matching the edit toolbar pill", () => {
  const start = styles.indexOf("@media (min-width: 701px){\n  #recipeHeaderActionPill");
  const block = styles.slice(start, styles.indexOf("\n}\n", start) + 2);
  assert.doesNotMatch(block, /overflow: hidden;/);
  assert.doesNotMatch(block, /border-radius: 999px;/);
  assert.match(block, /#recipeHeaderActionPill\.recipeHeaderActionPill\{[\s\S]*?gap: 2px;\s*\n\s*\}/);
  assert.match(block, /#recipeHeaderActionPill\.recipeHeaderActionPill \.recipeViewToggle button\[data-recipe-view="edit"\],\n\s*#recipeHeaderActionPill\.recipeHeaderActionPill \.recipeViewToggle button\[data-weight-view="edit"\],\n\s*#recipeHeaderActionPill\.recipeHeaderActionPill \.recipeHeaderAction\{\s*\n\s*border-radius: var\(--control-radius\);/);
});

test("tablet: the old empty-Load/Print-group divider guard is fully removed, not just made harmless - there's no border/padding-driven divider left for an empty group to paint as a dangling notch", () => {
  assert.doesNotMatch(styles, /recipeHeaderActions:not\(:has\(/, "the guard selector should no longer exist anywhere");
  const start = styles.indexOf("@media (min-width: 701px){\n  #recipeHeaderActionPill");
  const block = styles.slice(start, styles.indexOf("\n}\n", start) + 2);
  assert.match(block, /#recipeHeaderActionPill\.recipeHeaderActionPill \.recipeHeaderActions\{\s*\n\s*gap: 2px;\s*\n\s*padding-left: 0;\s*\n\s*border-left: 0;\s*\n\s*\}/);
});

test("on true desktop the divider stays unconditional - Print is only ever disabled there, never hidden, so the group is never empty", () => {
  assert.match(styles, /\.recipeHeaderActions\{\s*\n\s*display: flex;\s*\n\s*align-items: center;\s*\n\s*gap: 6px;\s*\n\s*padding-left: 10px;\s*\n\s*border-left: 1px solid var\(--row-border-2\);\s*\n\s*\}/);
});

test("Weights' own solo Edit/Done toggle is relocated outside the new wrapper, untouched", () => {
  // placeWeightsViewToggleForPage still targets #recipeHeaderControls
  // directly (a prepend), landing as a sibling of #recipeHeaderActionPill,
  // never inside it - so Weights keeps its existing solo pill unconditionally.
  assert.match(app, /\$\("recipeHeaderControls"\)\?\.prepend\(toggle\);/);
  assert.doesNotMatch(app, /\$\("recipeHeaderActionPill"\)/);
});

test("layout-critical direct-child selectors were repointed to the new nesting depth, not left dangling", () => {
  // .recipeViewToggle moved one level deeper (inside #recipeHeaderActionPill)
  // so any ">"-combinator rule that assumed it was a direct child of
  // #recipeHeaderControls needed repointing - .weightsHeaderViewToggle
  // stays a true direct child (prepended outside the wrapper) and keeps its
  // original selector.
  assert.doesNotMatch(styles, /\.recipeHeaderControls > \.recipeViewToggle\b/);
  assert.match(styles, /#recipeHeaderActionPill > \.recipeViewToggle\b/);
  assert.match(styles, /\.recipeHeaderControls > \.weightsHeaderViewToggle\b/);
});
