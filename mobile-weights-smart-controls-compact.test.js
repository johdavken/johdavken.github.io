"use strict";

// Mobile Recipe -> Weights: the Smart Hoppers and Circumference cards used to
// render far taller than their content on a phone, and the Circumference
// numeric input was pinned to a fixed 48px width that clipped a value such as
// "36.25" once a real device font (wider than the desktop test font) was in
// play.
//
// Root causes, all in the shared touch block
// `@media (width <= 900px), (min-width: 901px) and (pointer: coarse)`:
//
//   1. min-height:52px on both .mobileWeightsSmartControl and
//      .mobileSharedCircumference forced oversized cards regardless of content
//      (worst on a phone, where the cards are ~half the rail width so the
//      fixed height dominates; also left a big empty panel when Smart Hoppers
//      was off and only the Smart card remained).
//   2. .mobileSharedCircumference is a <label>, so it inherited the global
//      `label{ margin-bottom:6px }` - never reset here. That phantom 6px
//      inflated the control rail and desynced the two cards' visual heights
//      (the rail's align-items:stretch could no longer make them match).
//   3. .mobileSharedCircumference input had `width:48px` - a fixed width the
//      value could overflow. The card grid also sized its value column to
//      `auto` (i.e. that 48px), so there was no slack.
//
// Fix (this same media block only - desktop uses .desktopSharedCircumference /
// .desktopSmartHopperInfo and is untouched):
//   - drop both min-heights; trim vertical padding; keep the 34px toggle and
//     32px field and all typography/colors/borders as they were;
//   - margin:0 on .mobileSharedCircumference to kill the inherited label margin;
//   - value column becomes minmax(50px,58px) (not `auto`/48px) and the input
//     keeps the base rule's width:100% + min-width:0, box-sizing:border-box,
//     so the full value always fits inside the card.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const desktopStyles = fs.readFileSync("desktop.css", "utf8");

// The later of the two touch blocks (the one that carried the min-heights and
// the fixed input width) - scoped so a stray match elsewhere can't pass these.
const touchBlock = (() => {
  const marker = ".mobileWeightsControlRail{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))";
  const start = styles.indexOf(marker);
  assert.notEqual(start, -1, "expected the compact mobile weights control-rail block");
  return styles.slice(start, start + 2600);
})();

test("neither mobile control card carries a min-height any more", () => {
  const smart = touchBlock.slice(
    touchBlock.indexOf(".mobileWeightsSmartControl{"),
    touchBlock.indexOf("}", touchBlock.indexOf(".mobileWeightsSmartControl{"))
  );
  assert.doesNotMatch(smart, /min-height/);

  const circ = touchBlock.match(/\.mobileSharedCircumference\{[^}]*\}/)[0];
  assert.doesNotMatch(circ, /min-height/);
});

test("the Circumference card resets the inherited global label margin", () => {
  const circ = touchBlock.match(/\.mobileSharedCircumference\{[^}]*\}/)[0];
  assert.match(circ, /margin:\s*0/);
  // And the thing it is compensating for still exists, so the reset stays load-bearing.
  assert.match(styles, /\nlabel\{[^}]*margin-bottom:\s*6px/);
});

test("vertical padding on both cards is trimmed below the old 6-7px", () => {
  const smart = touchBlock.slice(
    touchBlock.indexOf(".mobileWeightsSmartControl{"),
    touchBlock.indexOf("}", touchBlock.indexOf(".mobileWeightsSmartControl{"))
  );
  assert.match(smart, /padding:\s*[0-5]px\s/);

  const circ = touchBlock.match(/\.mobileSharedCircumference\{[^}]*\}/)[0];
  assert.match(circ, /padding:\s*[0-4]px\s/);
});

test("the Circumference value column is a sized range, not a fixed 48px auto column", () => {
  const circ = touchBlock.match(/\.mobileSharedCircumference\{[^}]*\}/)[0];
  assert.match(circ, /grid-template-columns:\s*auto\s+minmax\(\s*\d+px\s*,\s*\d+px\s*\)/);
});

test("the Circumference input has no fixed pixel width here and stays border-box", () => {
  const input = touchBlock.match(/\.mobileSharedCircumference input\{[^}]*\}/)[0];
  assert.doesNotMatch(input, /width:\s*\d+px/);
  assert.match(input, /box-sizing:\s*border-box/);
  // It relies on the base touch rule for the fluid width.
  assert.match(styles, /\.mobileSharedCircumference input\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
});

test("Smart Hopper label text sizes are unchanged - the cards got shorter, the text did not", () => {
  assert.match(touchBlock, /\.mobileWeightsSmartControl strong\{font-size:11px\}/);
  assert.match(touchBlock, /\.mobileWeightsSmartControl small\{font-size:8px\}/);
});

test("the fix is confined to the touch media query - desktop shared-circumference rules are elsewhere and untouched", () => {
  // Desktop keeps its own distinct selector; we never widened our changes onto it.
  assert.doesNotMatch(touchBlock, /desktopSharedCircumference/);
  assert.match(desktopStyles, /\.desktopSharedCircumference\{/); // still present, unchanged
});
