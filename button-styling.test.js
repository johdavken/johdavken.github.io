"use strict";

// Button Styling: a desktop-only Display setting that swaps the visual
// treatment of the Recipe / Weights panel toolbar buttons between seven
// ports of previews/recipe-weights-toolbar-button-directions.html (02, 04,
// 05, 08, 09, 11, 12) plus "default" (no change). Same shape as the Side
// Rail Style preference: one <body> data attribute, local across an RT Sync
// job, restored through the standard payload path.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const buttonCss = fs.readFileSync("button-styling.css", "utf8");

const STYLES = ["blueprint", "console", "underline", "markers", "ribbons", "dividers", "tiles"];

test("Display sheet exposes a Button Styling picker with default + the seven ports", () => {
  assert.match(html, /<label for="buttonStyleSel" class="buttonStyleField">Button Styling/);
  assert.match(html, /<option value="default" selected>Default<\/option>/);
  for (const style of STYLES) {
    assert.match(html, new RegExp(`<option value="${style}"`));
  }
  // desktop-only, like Side Rail Style
  assert.match(html, /desktop only<\/small>\s*<\/label>/i);
  assert.match(styles, /\.buttonStyleField\{display:none!important\}/);
});

test("the stylesheet is loaded after the existing three", () => {
  assert.match(html, /<link rel="stylesheet" href="styles\.css[^>]*>\s*<link rel="stylesheet" href="theme\.css[^>]*>\s*<link rel="stylesheet" href="desktop\.css[^>]*>\s*<link rel="stylesheet" href="button-styling\.css/);
});

test("applyButtonStyle mirrors applyDesktopRailStyle: one body attribute, echoed to the select", () => {
  assert.match(app, /function applyButtonStyle\(value\)\{/);
  assert.match(app, /document\.body\.dataset\.buttonStyle = style;/);
  assert.match(app, /const select = \$\("buttonStyleSel"\);\s*\n\s*if \(select\) select\.value = style;/);
  // unknown / legacy values fall back to the no-op "default"
  assert.match(app, /new Set\(\["default", "blueprint", "console", "underline", "markers", "ribbons", "dividers", "tiles"\]\)/);
  assert.match(app, /allowed\.has\(String\(value\)\) \? String\(value\) : "default"/);
});

test("the preference persists locally and restores through the standard payload path", () => {
  assert.match(app, /buttonStyle: "default"/);
  // written into both snapshotPayload and applySharedActiveJob's localPreferences
  const snapshots = app.match(/buttonStyle: state\.buttonStyle/g) || [];
  assert.equal(snapshots.length, 2, "buttonStyle should be in snapshotPayload and applySharedActiveJob");
  assert.match(app, /applyButtonStyle\(payload\.buttonStyle \|\| "default"\)/);
  assert.match(app, /applyButtonStyle\(state\.buttonStyle \|\| "default"\)/);
  assert.match(app, /\$\("buttonStyleSel"\)\?\.addEventListener\("change",\(e\)=>\{\s*\n\s*applyButtonStyle\(e\.target\.value\);/);
});

test("every style rule is desktop-scoped and confined to the Recipe / Weights panel", () => {
  // All rules live under the same desktop media query the rail style uses.
  assert.match(buttonCss, /@media \(min-width: 901px\) and \(pointer: fine\)\{/);
  // No rule escapes #splitsBlock.
  const ruleLines = buttonCss
    .split("\n")
    .filter(line => line.includes('body[data-button-style="'));
  assert.ok(ruleLines.length >= STYLES.length, "expected per-style selectors");
  for (const line of ruleLines) {
    assert.ok(line.includes("#splitsBlock"), `selector escapes the panel: ${line.trim()}`);
  }
});

test("each style has a rule; default is a no-op (only referenced to exclude it from the focus ring)", () => {
  for (const style of STYLES) {
    assert.match(buttonCss, new RegExp(`body\\[data-button-style="${style}"\\] #splitsBlock`));
  }
  // "default" never gets its own treatment block.
  assert.doesNotMatch(buttonCss, /body\[data-button-style="default"\] #splitsBlock #recipeHeaderActionPill \.recipeHeaderAction\{/);
  assert.match(buttonCss, /:not\(\[data-button-style="default"\]\)/);
});

test("danger (Reset Recipe) keeps a distinct treatment in every style", () => {
  for (const style of STYLES) {
    assert.match(buttonCss, new RegExp(`body\\[data-button-style="${style}"\\] #splitsBlock #resetAllSplits\\b`));
  }
});

test("treatments reuse existing theme tokens, not hard-coded colours", () => {
  assert.match(buttonCss, /--btnstyle-accent: var\(--recipe-pill-accent/);
  assert.match(buttonCss, /--btnstyle-danger: var\(--recipe-pill-danger/);
  // the only literal colour is the on-fill text, kept as a single retunable token
  const hexes = buttonCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual([...new Set(hexes)], ["#fff"]);
});
