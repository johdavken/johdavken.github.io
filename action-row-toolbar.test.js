"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

// Recipe Actions: Scan Recipe (primary), Load Next Recipe (secondary) and
// Print Recipe (tertiary) as three individually-shaped buttons at
// descending visual weight - replacing the old "option A" unified bordered
// strip with flat divided segments, which read as generic, equally-
// weighted footer controls rather than an intentional recipe workflow
// toolbar. Recipe Setup information is a separate small icon-only control
// pushed to the row's far right, not a fourth equal segment.

function functionBodyLikeRule(selector){
  const start = styles.indexOf(`\n${selector}{`);
  assert.notEqual(start, -1, `expected a rule for ${selector}`);
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

test(".splitsBulkModeBar is no longer a single bordered/backed container - each button now carries its own chrome, so the row reads as part of the section's normal rhythm instead of a boxed-off footer widget", () => {
  const rule = functionBodyLikeRule(".splitsBulkModeBar");
  assert.doesNotMatch(rule, /border:/);
  assert.doesNotMatch(rule, /background:/);
  assert.match(rule, /display: flex;/);
  assert.match(rule, /flex-wrap: wrap;/);
  assert.match(rule, /gap: 8px;/);
});

test("Scan Recipe (primary) reuses the app's existing button.primary gradient tokens, not a bespoke one-off treatment", () => {
  const ruleStart = styles.indexOf(".splitsBulkModeBar .splitsScanShortcut > summary{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /background: linear-gradient\(180deg, var\(--btn-primary-a\), var\(--btn-primary-b\)\);/);
  assert.match(rule, /border: 1px solid var\(--btn-border\);/);
  assert.match(rule, /font-weight: 800;/);
});

test("Load Next Recipe (secondary) is the app's ordinary secondary button - bordered, filled, one step down from Scan Recipe", () => {
  const rule = functionBodyLikeRule(".splitsBulkModeBar button.secondary");
  assert.match(rule, /border: 1px solid var\(--btn-secondary-border\);/);
  assert.match(rule, /border-radius: var\(--control-radius\);/);
  assert.match(rule, /background: var\(--btn-secondary-bg\);/);
  assert.doesNotMatch(rule, /border-right:/, "no divider-segment styling left over from the old unified strip");
});

test("Print Recipe (tertiary) is a quiet ghost button - transparent and muted until hovered, one step down from Load Next Recipe", () => {
  const rule = functionBodyLikeRule(".splitsBulkModeBar button.recipeActionTertiary");
  assert.match(rule, /border-color: transparent;/);
  assert.match(rule, /background: transparent;/);
  assert.match(rule, /color: var\(--muted\);/);
  const hoverRule = functionBodyLikeRule(".splitsBulkModeBar button.recipeActionTertiary:hover:not(:disabled)");
  assert.match(hoverRule, /border-color: var\(--btn-secondary-border\);/);
  assert.match(hoverRule, /background: var\(--btn-secondary-bg\);/);
});

test("printButton actually carries the tertiary class, alongside its existing secondary/rearrangeDesktopOnly classes - loadNextButton and scanRecipeButton do not, keeping the three-tier hierarchy distinct", () => {
  assert.match(app, /printButton\.className="secondary rearrangeDesktopOnly recipeActionTertiary";/);
  assert.doesNotMatch(app, /loadNextButton\.className = "secondary recipeActionTertiary"/);
  assert.doesNotMatch(app, /scanRecipeButton\.className = "splitsScanShortcut rearrangeDesktopOnly recipeActionTertiary"/);
});

test("the row's append order puts Scan Recipe first, Load Next Recipe second (when it exists), Print Recipe last - left to right in descending priority", () => {
  const modeBarStart = app.indexOf('modeBar.className = "splitsBulkModeBar"');
  const modeBar = app.slice(modeBarStart, app.indexOf("const toolbar = document.createElement", modeBarStart));
  const scanAppend = modeBar.indexOf("modeBar.appendChild(scanRecipeButton)");
  const loadNextAppend = modeBar.indexOf("modeBar.appendChild(loadNextButton)");
  const printAppend = modeBar.indexOf("modeBar.appendChild(printButton)");
  assert.ok(scanAppend > -1 && loadNextAppend > scanAppend && printAppend > loadNextAppend,
    "expected append order: scanRecipeButton, then loadNextButton, then printButton");
});

test("Recipe Setup information sits at the row's far right, separated by margin-left:auto and reduced to a small round icon-only control - not a fourth equal segment ending the strip", () => {
  const marginRule = functionBodyLikeRule(".splitsBulkModeBar > .splitsInfo");
  assert.match(marginRule, /margin-left: auto;/);
  const summaryRule = functionBodyLikeRule(".splitsBulkModeBar > .splitsInfo > summary");
  assert.match(summaryRule, /border-radius: 50%;/);
  assert.match(summaryRule, /width: 32px;/);
  assert.match(summaryRule, /height: 32px;/);
});

test("the container does NOT use overflow:hidden to clip corners - that would also clip Scan Recipe's popup, which intentionally escapes this row via position:absolute to open upward", () => {
  const rule = functionBodyLikeRule(".splitsBulkModeBar");
  assert.doesNotMatch(rule, /overflow:\s*hidden/);
});

test("icons (Scan/Print/Load Next/Info) reuse the app's existing stroke-line icon convention - fill:none, stroke:currentColor - rather than a filled/colored one-off style", () => {
  const rule = functionBodyLikeRule(".recipeActionIcon");
  assert.match(rule, /fill: none;/);
  assert.match(rule, /stroke: currentColor;/);
  assert.match(rule, /stroke-linecap: round;/);
  assert.match(rule, /stroke-linejoin: round;/);
});

test("this styling is unconditional (not gated behind a desktop-only media query) - it's simply never rendered on mobile, since modeBar/.splitsBulkModeBar only gets appended to the DOM when !compactMobileRecipe", () => {
  const ruleStart = styles.indexOf("\n.splitsBulkModeBar{");
  const mediaStart = styles.indexOf("@media (max-width: 700px){");
  assert.ok(ruleStart > -1 && (mediaStart === -1 || ruleStart < mediaStart), "the toolbar rule must be a base rule, not inside the mobile media query");
  assert.match(app, /if \(!compactMobileRecipe\)\{\s*\n\s*area\.append\(modeBar\);\s*\n\s*\}/);
});

test("the icons don't fit the mobile primary row's narrower slots (verified live: Scan Recipe's label clipped once the icon took part of a ~65px-wide slot), so they're hidden there rather than shrunk", () => {
  const narrowBlock = styles.slice(styles.indexOf("@media (max-width: 700px){"));
  assert.match(narrowBlock, /\.splitsMobilePrimaryRow \.recipeActionIcon\{ display:none; \}/);
});
