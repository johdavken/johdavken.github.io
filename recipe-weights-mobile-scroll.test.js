"use strict";

// Mobile Recipe -> Hopper Weights page: opening Edit reveals the
// Weight/Height bulk-edit controls (#mobileWeightsBulkBar) below the
// matrix. On phones #splitsArea is a fixed-height, overflow:hidden flex
// column, and the moved live editor (#weightsArea) is its only child.
// Nothing inside #weightsArea was a scroll boundary, so the expanded
// controls were clipped past the bottom edge with no way to reach them.
// The fix makes #weightsArea itself the scroller in that state.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function mobileWeightsScrollRule(){
  const start = styles.indexOf("#splitsBlock.mobile-active #splitsArea > #weightsArea{");
  assert.notEqual(start, -1, "expected a mobile-only scroll rule for the weights page");
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

test("the rule lives in the phone breakpoint, not tablet/desktop", () => {
  const idx = styles.indexOf("#splitsBlock.mobile-active #splitsArea > #weightsArea{");
  const media = styles.lastIndexOf("@media", idx);
  const mediaLine = styles.slice(media, styles.indexOf("{", media));
  assert.match(mediaLine, /max-width:\s*700px/,
    "weights-page scroll fix must be scoped to the <=700px phone shell");
});

test("#weightsArea becomes the vertical scroller with no horizontal scroll", () => {
  const rule = mobileWeightsScrollRule();
  // Fills the remaining flex budget and is allowed to shrink below content.
  assert.match(rule, /flex:\s*1 1 0/);
  assert.match(rule, /min-height:\s*0/);
  // Vertical scroll only - horizontal stays clipped.
  assert.match(rule, /overflow:\s*hidden auto/);
  assert.doesNotMatch(rule, /overflow-x:\s*(auto|scroll)/);
  // Keeps a focused Weight/Height input clear of the fixed app dock when
  // the mobile keyboard scrolls it into view.
  assert.match(rule, /scroll-padding-bottom:/);
});

test("the fix relies on the existing scroll boundary, not extra height or margin", () => {
  const rule = mobileWeightsScrollRule();
  assert.doesNotMatch(rule, /margin-bottom:\s*\d{2,}/);
  assert.doesNotMatch(rule, /height:\s*calc/);
  assert.doesNotMatch(rule, /min-height:\s*[1-9]/);
});

test("Done returns to summary view, which has no overflow to scroll", () => {
  // exitWeightsBulkModeFn / the view toggle both route back through
  // setMobileWeightView("visual"); the scroll rule is inert there because
  // summary content does not exceed the budget.
  assert.match(app, /exitWeightsBulkModeFn = \(\) => setMobileWeightView\("visual"\);/);
  assert.match(app, /area\.dataset\.mobileWeightView = visualMode \? "visual" : "edit";/);
});
