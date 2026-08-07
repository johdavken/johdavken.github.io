"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// Mobile "icon-first compact bar" (option C from the mockup round): Save/
// Load/Update collapse to small round icon buttons in Recipe Setup's Saved
// Recipes header, so the row stops wrapping under the title. Desktop is
// untouched. Merged into the existing single mobile media query rather than
// a second one, since several other tests anchor on "the first
// @media (max-width: 700px){" being the main mobile block.

function mainMobileBlock(){
  // Anchored to this test's own unique landmark rule (only ever added
  // once) rather than "the first @media (max-width: 700px){" - several
  // other selectors used elsewhere as landmarks (e.g. .splitsInfoPanel,
  // .splitsMobileLayerNav) have a same-named base rule earlier in the file
  // too, so indexOf() alone would grab the wrong, non-mobile occurrence.
  const landmark = styles.indexOf("#splitsSaveRecipe, #splitsLoadRecipe, #splitsUpdateRecipe{");
  assert.notEqual(landmark, -1);
  const start = styles.lastIndexOf("@media (max-width: 700px){", landmark);
  assert.notEqual(start, -1);
  return styles.slice(start, styles.indexOf("\n}\n", start));
}

test("there is only one @media (max-width: 700px) block in styles.css - the new rules were merged into it, not added as a second one", () => {
  const matches = styles.match(/@media \(max-width: 700px\)\{/g) || [];
  assert.equal(matches.length, 1, "a second block would silently break every other test that does styles.indexOf(\"@media (max-width: 700px){\") expecting the first match to be the main mobile block");
});

test("Save/Load/Update become 32px round icon buttons on mobile, with font-size:0 so their real text (the accessible name) stays but isn't visually shown", () => {
  const block = mainMobileBlock();
  const rule = block.slice(block.indexOf("#splitsSaveRecipe, #splitsLoadRecipe, #splitsUpdateRecipe{"), block.indexOf("}", block.indexOf("#splitsSaveRecipe, #splitsLoadRecipe, #splitsUpdateRecipe{")) + 1);
  assert.match(rule, /width: 32px; height: 32px;/);
  assert.match(rule, /border-radius: 999px;/);
  assert.match(rule, /font-size: 0;/);
});

test("each icon button gets its own glyph via ::before, sized independently of the parent's font-size:0", () => {
  const block = mainMobileBlock();
  assert.match(block, /#splitsSaveRecipe::before\{ content: "\+"; font-size: 17px; line-height: 1; \}/);
  assert.match(block, /#splitsLoadRecipe::before\{ content: "✓"; font-size: 14px; line-height: 1; \}/);
  assert.match(block, /#splitsUpdateRecipe::before\{ content: "✎"; font-size: 13px; line-height: 1; \}/);
});

test("the overflow (⋯) summary also becomes a round icon button, scoped to the Saved Recipes panel's own overflow specifically", () => {
  const block = mainMobileBlock();
  const start = block.indexOf("#splitsRecipeOverflow > summary{");
  assert.notEqual(start, -1);
  const rule = block.slice(start, block.indexOf("}", start) + 1);
  assert.match(rule, /width: 32px; height: 32px;/);
  assert.match(rule, /border-radius: 999px;/);
});

test("nowrap is scoped to the Saved Recipes panel specifically, not the bare .splitsSavedRecipesActions class - that class is shared with Line Setup's Receiver Weight Profiles row, whose buttons keep full text and would overflow instead of wrap if forced nowrap", () => {
  const block = mainMobileBlock();
  assert.match(block, /\.splitsSavedRecipesPanel \.splitsSavedRecipesActions\{ flex-wrap: nowrap; \}/);
  assert.doesNotMatch(block, /\n\s*\.splitsSavedRecipesActions\{\s*flex-wrap:\s*nowrap;?\s*\}/, "must not apply nowrap to the bare shared class");
});

test("desktop is untouched - the base (non-mobile) rules never set font-size:0 or fixed round dimensions on these buttons", () => {
  const landmark = styles.indexOf("#splitsSaveRecipe, #splitsLoadRecipe, #splitsUpdateRecipe{");
  const mobileStart = styles.lastIndexOf("@media (max-width: 700px){", landmark);
  const beforeMobile = styles.slice(0, mobileStart);
  assert.doesNotMatch(beforeMobile, /#splitsSaveRecipe\{[^}]*font-size:\s*0/);
});
