"use strict";

// Bug: the compact-mobile (<=700px) tracked-hopper badge and the active
// track button were hardcoded to a fixed blue (#72b9e8/#397fae/#4d9bd0/
// #b9e2ff), so every theme showed the same blue on mobile even though
// tablet and desktop already derive the same accent from var(--focus-border)
// and correctly follow the active theme. Fix: mobile now reads the same
// per-theme variable everywhere the old code hardcoded a hex blue.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

function compactMobileRecipeBlock(){
  const landmark = styles.indexOf(".splitsMatrix.compactMobileRecipe .splitMatrixCell.tracked:not(.selected){");
  assert.notEqual(landmark, -1);
  const start = styles.lastIndexOf("@media (max-width: 700px){", landmark);
  assert.notEqual(start, -1);
  return styles.slice(start, styles.indexOf("\n}\n", start));
}

test("none of the old hardcoded blues remain anywhere in the compact mobile matrix block", () => {
  const block = compactMobileRecipeBlock();
  assert.doesNotMatch(block, /#72b9e8|#397fae|#4d9bd0|#b9e2ff/);
});

test("the tracked hopper-name badge restyle is gone - tracking is a plain --ok cell wash", () => {
  const block = compactMobileRecipeBlock();
  assert.doesNotMatch(block, /\.splitMatrixCell\.tracked \.splitCellHopperName/);
  assert.match(block, /\.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\.tracked:not\(\.selected\)\{[\s\S]*?background:color-mix\(in srgb,var\(--ok\) 22%,var\(--compact-recipe-row-bg\)\);/);
});

test("no per-theme override recolors a tracked hopper name any more", () => {
  const theme = fs.readFileSync("theme.css", "utf8");
  assert.doesNotMatch(theme, /\.splitMatrixCell\.tracked \.splitCellHopperName/);
});

test("the active track button's solid fill is var(--focus-border), matching the same solid-fill-plus-fixed-icon pairing already used by Weights' selected-header checkmark", () => {
  const block = compactMobileRecipeBlock();
  assert.match(block, /\.splitsMatrix\.compactMobileRecipe \.splitTrackButton\.active\{[\s\S]*?background:var\(--focus-border\);[\s\S]*?color:#f6fbff;[\s\S]*?box-shadow:0 0 0 1px color-mix\(in srgb,var\(--focus-border\) 70%,transparent\);/);
  // The precedent this borrows the fixed-icon-color reasoning from - proof
  // a solid var(--focus-border) fill has already been vetted against every
  // theme's accent elsewhere in the app, not just introduced here.
  assert.match(styles, /\.weightsSelectHeader\.selected::before\{content:"✓";border-color:var\(--focus-border\);background:var\(--focus-border\);color:#fff\}/);
});

test("the active button's pulse animation rings itself with the theme accent at both keyframe stops", () => {
  assert.match(styles, /@keyframes compactRecipeTrackPulse\{\s*\n\s*0%,100%\{ transform:scale\(1\); box-shadow:0 0 0 1px color-mix\(in srgb,var\(--focus-border\) 70%,transparent\); \}\s*\n\s*50%\{ transform:scale\(1\.06\); box-shadow:0 0 0 3px color-mix\(in srgb,var\(--focus-border\) 24%,transparent\); \}/);
});

test("unrelated mobile-only colors (the smart-hopper green badge) were left alone - this fix is scoped to tracking only", () => {
  const block = compactMobileRecipeBlock();
  assert.match(block, /\.splitsMatrix\.compactMobileRecipe \.splitCellHopperName\.smart\{ color:color-mix\(in srgb,#2f9e62 78%,var\(--text\)\); \}/);
});
