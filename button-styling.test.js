"use strict";

// Button Styling: a desktop-only Display setting that swaps the Recipe /
// Weights panel toolbar buttons between the shipped look ("Default") and
// "Station console" - the one treatment kept from a seven-way trial. Same
// shape as the Side Rail Style preference: one <body> data attribute, local
// across an RT Sync job, restored through the standard payload path.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const buttonCss = fs.readFileSync("button-styling.css", "utf8");

test("Display sheet exposes a Button Styling picker: Default + Station console only", () => {
  assert.match(html, /<label for="buttonStyleSel" class="buttonStyleField">Button Styling/);
  const select = html.slice(html.indexOf('<select id="buttonStyleSel">'), html.indexOf("</select>", html.indexOf('id="buttonStyleSel"')));
  assert.match(select, /<option value="default" selected>Default<\/option>/);
  assert.match(select, /<option value="console">Station console<\/option>/);
  // the six trialled-then-dropped treatments are gone from this picker
  for (const gone of ["blueprint", "underline", "markers", "ribbons", "dividers", "tiles"]) {
    assert.doesNotMatch(select, new RegExp(`value="${gone}"`));
  }
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
  // only "default" and "console" survive; every other value falls back
  assert.match(app, /new Set\(\["default", "console"\]\)/);
  assert.match(app, /allowed\.has\(String\(value\)\) \? String\(value\) : "default"/);
});

test("the preference persists locally and restores through the standard payload path", () => {
  assert.match(app, /buttonStyle: "default"/);
  const snapshots = app.match(/buttonStyle: state\.buttonStyle/g) || [];
  assert.equal(snapshots.length, 2, "buttonStyle should be in snapshotPayload and applySharedActiveJob");
  assert.match(app, /applyButtonStyle\(payload\.buttonStyle \|\| "default"\)/);
  assert.match(app, /applyButtonStyle\(state\.buttonStyle \|\| "default"\)/);
  assert.match(app, /\$\("buttonStyleSel"\)\?\.addEventListener\("change",\(e\)=>\{\s*\n\s*applyButtonStyle\(e\.target\.value\);/);
});

test("the treatment is desktop-scoped and confined to the Recipe / Weights panel", () => {
  assert.match(buttonCss, /@media \(min-width: 901px\) and \(pointer: fine\)\{/);
  const ruleLines = buttonCss
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith('body[data-button-style="'));
  assert.ok(ruleLines.length >= 5, "expected the console selectors");
  for (const line of ruleLines) {
    assert.ok(
      line.includes("#splitsBlock") || line.includes("#splitsArea"),
      `selector escapes the panel: ${line.trim()}`
    );
    assert.ok(line.includes('"console"'), `stray non-console selector: ${line.trim()}`);
  }
});

test("console covers every treated button and neutralises the pill container", () => {
  // header pill + Edit/Done toggle
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsBlock #recipeHeaderActionPill \.recipeHeaderAction/);
  assert.match(buttonCss, /button\[data-recipe-view="edit"\]/);
  // bulk .bulkTextAction (catches Clear / Empty cells / Rearrange)
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsBlock \.splitsBulkBar \.bulkTextAction/);
  // danger keeps a distinct fill
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsBlock #resetAllSplits\{[\s\S]*?background: var\(--btnstyle-danger\)/);
  // Apply + Undo/Redo radius match, scoped past the 3-id styles.css rule
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsArea #splitsBulkBar #applyBulkSplit/);
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsArea #splitsBulkBar \.recipeHistoryAction/);
  // the border-radius:999px bulk-row pill-clip is overridden
  assert.match(buttonCss, /body\[data-button-style="console"\] #splitsArea #splitsBulkBar \.splitsEditRowSecondary/);
});

test("the treatment reuses existing theme tokens, not hard-coded colours", () => {
  assert.match(buttonCss, /--btnstyle-accent: var\(--recipe-pill-accent/);
  assert.match(buttonCss, /--btnstyle-danger: var\(--recipe-pill-danger/);
  const hexes = buttonCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual([...new Set(hexes)], ["#fff"]);
});
