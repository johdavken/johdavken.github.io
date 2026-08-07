"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// Desktop's per-layer column header (ghosted letter, percentage, Copy)
// picked "option A" from the mockup: keep the giant translucent letter as
// is (it's still the bulk-edit "select this whole layer" tap target), just
// give the percentage a bolder/bigger treatment and promote Copy from a
// plain, low-opacity text link to a real bordered pill button. Scoped to
// the base (non-media-query) rules, since the mobile @media(max-width:700px)
// block already fully overrides both with its own two-chip layout.

function functionBodyLikeRule(selector){
  const start = styles.indexOf(`\n${selector}{`);
  assert.notEqual(start, -1, `expected a base-level rule for ${selector}`);
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

test("the ghosted letter itself is untouched - still the same size/opacity/position, still the bulk-edit column-select target", () => {
  const rule = functionBodyLikeRule(".splitLayerTitle");
  assert.match(rule, /font-size:64px;/);
  assert.match(rule, /opacity:\.14;/);
  assert.match(rule, /pointer-events:none;/);
});

test("the percentage number is bigger and bolder than before, still right-aligned in its own small field", () => {
  const rule = functionBodyLikeRule(".splitLayerPct input");
  assert.match(rule, /font-size:15px;/);
  assert.match(rule, /font-weight:900;/);
  assert.match(rule, /text-align:right;/);
});

test("Copy is now a real bordered pill button (border, background, radius, full opacity) instead of a faint plain-text link only revealed clearly on hover", () => {
  const rule = functionBodyLikeRule(".splitCopyBtn");
  assert.match(rule, /border:1px solid var\(--btn-secondary-border\);/);
  assert.match(rule, /border-radius:999px;/);
  assert.match(rule, /background:var\(--btn-secondary-bg\);/);
  assert.match(rule, /color:var\(--title\);/);
  assert.match(rule, /opacity:1;/);
});

test("Copy's hover/focus state shifts to the same gradient-fill treatment used elsewhere in this redesign, not the old underline", () => {
  const hoverStart = styles.indexOf(".splitCopyBtn:hover,.splitCopyBtn:focus-visible{");
  assert.notEqual(hoverStart, -1);
  const hoverRule = styles.slice(hoverStart, styles.indexOf("}", hoverStart) + 1);
  assert.match(hoverRule, /background:linear-gradient\(180deg, var\(--btn-primary-a\), var\(--btn-primary-b\)\);/);
  assert.doesNotMatch(hoverRule, /text-decoration:underline/);
});

test("the mobile layout still fully overrides the desktop pill treatment on narrow screens - this desktop refinement doesn't leak into or conflict with it", () => {
  // Anchored to the landmark itself (there's more than one
  // "@media (max-width: 700px){" block in the file now, e.g. the Saved
  // Recipes icon-button row's own mobile block) rather than blindly taking
  // the first match, which would grab the wrong one.
  const copyBtnLandmark = styles.indexOf("\n  .splitCopyBtn{");
  assert.notEqual(copyBtnLandmark, -1);
  const mobileStart = styles.lastIndexOf("@media (max-width: 700px){", copyBtnLandmark);
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const mobileCopyStart = mobileBlock.indexOf("\n  .splitCopyBtn{");
  assert.notEqual(mobileCopyStart, -1);
  const mobileCopyRule = mobileBlock.slice(mobileCopyStart, mobileBlock.indexOf("}", mobileCopyStart) + 1);
  assert.match(mobileCopyRule, /grid-area: copy;/);
  // Mobile (option 10, "minimal ghost") deliberately drops the desktop
  // pill's border/background/radius - not a leak, an intentional override.
  assert.match(mobileCopyRule, /border: none;/);
  assert.match(mobileCopyRule, /background: none;/);
  assert.match(mobileCopyRule, /border-radius: 0;/);
});
