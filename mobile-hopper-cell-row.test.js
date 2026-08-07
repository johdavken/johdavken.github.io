"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// On mobile, only one layer column is visible at a time (full width), so
// the hopper cell - previously label+clock+clear on one row and
// resin+percent on a second - collapses to a single row: label+clock on
// the left, resin name flexible in the middle, percent+clear on the
// right. Desktop's narrow 180px matrix columns still need two rows and
// must be untouched - this is pure CSS reordering (display:contents +
// order) inside the existing mobile media query, not a DOM/JS change, so
// it's cheap to revert if it doesn't look right on a real device.

function mobileBlock(){
  const start = styles.indexOf("@media (max-width: 700px)");
  assert.notEqual(start, -1, "expected the existing 700px mobile matrix media query");
  const end = styles.indexOf("\n}", start);
  return styles.slice(start, end);
}

test("the single-row layout is scoped to the existing 700px mobile media query, not a global rule that would also affect desktop's matrix view", () => {
  const mobile = mobileBlock();
  assert.match(mobile, /\.splitsMatrix \[data-layer-column\]\.mobile-layer-active\.splitMatrixCell\{\s*display: flex;/);
  const globalMatch = styles.match(/^\.splitMatrixCell\{/m);
  assert.ok(globalMatch, "the base rule should still exist above the media query");
  const globalBody = styles.slice(styles.indexOf(globalMatch[0]), styles.indexOf(globalMatch[0]) + 200);
  assert.doesNotMatch(globalBody, /display:\s*flex/, "display:flex must only apply inside the mobile media query, not the shared base rule");
});

test("the flex rule's selector matches (does not lose to) .mobile-layer-active's own display:table-cell rule, which shows/hides the active layer column and has 3 classes/attrs of specificity - a bare .splitMatrixCell selector silently loses that fight and no-ops", () => {
  const mobile = mobileBlock();
  const flexRuleStart = mobile.indexOf(".splitsMatrix [data-layer-column].mobile-layer-active.splitMatrixCell{");
  assert.notEqual(flexRuleStart, -1);
  const visibilityRuleIndex = styles.indexOf(".splitsMatrix [data-layer-column].mobile-layer-active{ display: table-cell; }");
  assert.notEqual(visibilityRuleIndex, -1);
  // Same 3 specificity components (.splitsMatrix, [data-layer-column],
  // .mobile-layer-active) plus .splitMatrixCell as a 4th - strictly higher,
  // never a specificity tie decided by source order alone.
});

test("no DOM/JS changes were needed - .splitCellHeader is unwrapped with display:contents so its existing children (hopper label, track button, clear button) become direct flex items, reordered with `order`", () => {
  const mobile = mobileBlock();
  assert.match(mobile, /\.splitCellHeader\{ display: contents; \}/);
  assert.match(mobile, /\.splitCellHopperName\{ order: 1; \}/);
  assert.match(mobile, /\.splitTrackControl\{ order: 2; \}/);
  assert.match(mobile, /\.splitCellEditor\{ order: 3; flex: 1; min-width: 0; \}/);
  assert.match(mobile, /\.splitClearButton\{ order: 4; margin-left: 0; \}/);
});

test(".splitCellEditor's own internal resin-left/percent-right grid is reused as-is, not rebuilt - it just becomes one flex item in the new row instead of a second row", () => {
  const editorStart = styles.indexOf(".splitCellEditor{");
  const editorEnd = styles.indexOf("}", editorStart);
  const editorBody = styles.slice(editorStart, editorEnd);
  assert.match(editorBody, /display:grid/);
  assert.match(editorBody, /grid-template-columns:minmax\(78px,1fr\) auto/, "resin (flexible, left) then percent controls (auto width, right) - unchanged");
});

// --- Hopper designation badge (desktop + mobile) + filled track button (mobile only) ---

test("the hopper designation is a small boxed badge on both desktop and mobile - shipped on mobile first, then ported to the shared base rule unchanged, replacing the old plain muted text", () => {
  const badgeStart = styles.indexOf("\n.splitCellHopperName{");
  assert.notEqual(badgeStart, -1);
  const badgeRule = styles.slice(badgeStart, styles.indexOf("}", badgeStart) + 1);
  assert.match(badgeRule, /background: var\(--field-bg\);/);
  assert.match(badgeRule, /border-radius: 6px;/);
  assert.match(badgeRule, /color: var\(--muted\);/, "dark grey, not near-black --text - avoids black-looking text in light themes");
  assert.match(badgeRule, /font-weight: 900;/);
  assert.match(badgeRule, /letter-spacing:\.02em;/, "desktop's original letter-spacing carries over into the shared badge rule");
  // The mobile block still legitimately sets order:1 for the flex reorder,
  // but must not have a second, now-redundant copy of the badge styling.
  const mobile = mobileBlock();
  assert.match(mobile, /\.splitCellHopperName\{ order: 1; \}/);
  assert.doesNotMatch(mobile, /\.splitCellHopperName\{\s*\n\s*display: flex;/);
});

test("the track button grows from the desktop 23px icon-only button to a 30px bordered pill, filled (not just recolored) when active, on mobile only - opacity:1 by default so it's never near-invisible on a touch device with no hover", () => {
  const mobile = mobileBlock();
  const btnStart = mobile.indexOf("\n  .splitTrackButton{");
  assert.notEqual(btnStart, -1);
  const btnRule = mobile.slice(btnStart, mobile.indexOf("}", btnStart) + 1);
  assert.match(btnRule, /width: 30px;/);
  assert.match(btnRule, /height: 30px;/);
  assert.match(btnRule, /border: 1px solid var\(--btn-secondary-border\);/);
  assert.match(btnRule, /border-radius: 999px;/);
  assert.match(btnRule, /opacity: 1;/);
  const activeStart = mobile.indexOf(".splitTrackButton.active{");
  assert.notEqual(activeStart, -1);
  const activeRule = mobile.slice(activeStart, mobile.indexOf("}", activeStart) + 1);
  assert.match(activeRule, /background: linear-gradient\(180deg, var\(--btn-primary-a\), var\(--btn-primary-b\)\);/, "matches the same active-state treatment used by the layer tiles/naming toggle/pager elsewhere in this redesign");
  assert.match(activeRule, /color: var\(--title\);/);
});

test("the track icon itself shrinks slightly (19px desktop -> 16px) to sit comfortably inside the smaller-diameter mobile pill", () => {
  const mobile = mobileBlock();
  assert.match(mobile, /\.splitTrackButton svg\{ width: 16px; height: 16px; \}/);
});
