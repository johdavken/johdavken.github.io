"use strict";

// Mobile Recipe -> Hopper Weights page: the editor and matrix must stay in
// normal document flow. A short phone viewport must scroll the browser page,
// not create an internal scroll boundary on the weights panel.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function phoneRecipeBlock(){
  const start = styles.indexOf("#splitsBlock.mobile-active #splitsArea > #weightsArea{");
  assert.notEqual(start, -1, "expected a mobile-only document-flow rule for the weights page");
  const media = styles.lastIndexOf("@media", start);
  const end = styles.indexOf("\n}\n\n@media (max-width: 720px)", media);
  return styles.slice(media, end);
}

test("the document-flow rule lives in the phone breakpoint, not tablet/desktop", () => {
  const idx = styles.indexOf("#splitsBlock.mobile-active #splitsArea > #weightsArea{");
  const media = styles.lastIndexOf("@media", idx);
  const mediaLine = styles.slice(media, styles.indexOf("{", media));
  assert.match(mediaLine, /max-width:\s*700px/,
    "weights-page scroll fix must be scoped to the <=700px phone shell");
});

test("Current, Next, and Weights have no phone-only viewport budget or internal vertical scroller", () => {
  const block = phoneRecipeBlock();
  assert.doesNotMatch(block, /body\[data-mobile-workspace="panel"\]:has\(#splitsBlock\.mobile-active\)/);
  assert.doesNotMatch(block, /height:\s*calc\(100dvh/);
  assert.doesNotMatch(block, /#splitsBlock\.mobile-active \#splitsArea > #weightsArea\{[^}]*overflow:/);
  assert.doesNotMatch(block, /\.splitsMatrixScroll\{[^}]*overflow-y:\s*auto/);
  assert.match(block, /#splitsBlock\.mobile-active \#splitsArea > \.splitsMobileLayerLayout,\s*\n\s*#splitsBlock\.mobile-active \#splitsArea > #weightsArea\{ min-width:0; \}/);
});

test("the shared mobile shell keeps dock-aware document padding", () => {
  assert.match(styles, /main\{height:auto;min-height:100vh;min-height:100dvh;padding-bottom:calc\(var\(--app-dock-height\) \+ env\(safe-area-inset-bottom\) \+ 22px\)!important\}/);
});

test("Done still returns to summary view without changing the layout model", () => {
  assert.match(app, /exitWeightsBulkModeFn = \(\) => setMobileWeightView\("visual"\);/);
  assert.match(app, /area\.dataset\.mobileWeightView = visualMode \? "visual" : "edit";/);
});
