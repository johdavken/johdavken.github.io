"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// Recipe Setup's action row (Saved Recipes, Bulk edit, Rearrange, Scan
// Recipe, Print Recipe, plus the ⓘ info icon) picked "option A" from the
// mockup: one unified bordered strip with flat, divided segments instead
// of five individually-bordered floating buttons. Applies on both desktop
// and mobile (mobile just has fewer segments visible, since Scan Recipe/
// Print Recipe stay .rearrangeDesktopOnly).

function functionBodyLikeRule(selector){
  const start = styles.indexOf(`\n${selector}{`);
  assert.notEqual(start, -1, `expected a rule for ${selector}`);
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

test(".splitsBulkModeBar is itself the single bordered container - border, radius, and a shared background", () => {
  const rule = functionBodyLikeRule(".splitsBulkModeBar");
  assert.match(rule, /border: 1px solid var\(--btn-secondary-border\);/);
  assert.match(rule, /border-radius: var\(--control-radius\);/);
  assert.match(rule, /background: var\(--btn-secondary-bg\);/);
  assert.match(rule, /align-items: stretch;/, "so every segment (buttons, Scan Recipe's <summary>, the info <summary>) matches the row's own height automatically");
});

test("the container does NOT use overflow:hidden to clip corners - that would also clip Scan Recipe's popup, which intentionally escapes this row via position:absolute to open upward. Corners are rounded directly on the first/last segments instead", () => {
  const rule = functionBodyLikeRule(".splitsBulkModeBar");
  assert.doesNotMatch(rule, /overflow:\s*hidden/);
  assert.match(styles, /\.splitsBulkModeBar button\.secondary:first-child\{\s*\n\s*border-top-left-radius: var\(--control-radius\);\s*\n\s*border-bottom-left-radius: var\(--control-radius\);\s*\n\s*\}/);
  assert.match(styles, /\.splitsBulkModeBar > \.splitsInfo:last-child > summary\{border-top-right-radius:var\(--control-radius\);border-bottom-right-radius:var\(--control-radius\)\}/);
});

test("each plain button becomes a flat, transparent, un-rounded segment with a right-edge divider instead of its own bordered pill", () => {
  const rule = functionBodyLikeRule(".splitsBulkModeBar button.secondary");
  assert.match(rule, /border: 0;/);
  assert.match(rule, /border-right: 1px solid var\(--btn-secondary-border\);/);
  assert.match(rule, /border-radius: 0;/);
  assert.match(rule, /background: transparent;/);
});

test("the last real <button> in the row has no trailing divider - :last-of-type targets Print Recipe specifically, which is correct even on mobile where it's hidden (display:none doesn't change DOM order, and Rearrange - the last *visible* button there - still correctly keeps its own divider before the ⓘ icon)", () => {
  assert.match(styles, /\.splitsBulkModeBar button\.secondary:last-of-type\{ border-right: 0; \}/);
});

test("the ⓘ info icon at the row's end is now a flat divided segment (left divider, full-height, square corners) instead of a standalone circular icon button", () => {
  const rule = functionBodyLikeRule(".splitsInfo > summary");
  assert.match(rule, /border-left:1px solid var\(--btn-secondary-border\)/);
  assert.match(rule, /height:100%/);
  assert.match(rule, /border-radius:0/);
  assert.doesNotMatch(rule, /border-radius:50%/);
});

test("hover states use a neutral tint instead of the removed border/background swap, since these segments no longer have their own chrome to swap", () => {
  const barHover = functionBodyLikeRule(".splitsBulkModeBar button.secondary:hover");
  assert.match(barHover, /background: color-mix\(in srgb, var\(--text\) 6%, transparent\);/);
  const infoHoverStart = styles.indexOf(".splitsInfo > summary:hover,.splitsInfo[open] > summary{");
  assert.notEqual(infoHoverStart, -1);
  const infoHover = styles.slice(infoHoverStart, styles.indexOf("}", infoHoverStart) + 1);
  assert.match(infoHover, /background:color-mix\(in srgb, var\(--text\) 6%, transparent\)/);
});

test("this styling is unconditional (not gated behind a desktop-only media query), so it applies on mobile too - just with fewer visible segments", () => {
  const ruleStart = styles.indexOf("\n.splitsBulkModeBar{");
  const mediaStart = styles.indexOf("@media (max-width: 700px){");
  assert.ok(ruleStart > -1 && (mediaStart === -1 || ruleStart < mediaStart), "the toolbar-strip rule must be a base rule, not inside the mobile media query");
});
