"use strict";

// Mobile pass over the Recipe panel, on top of the Summary/Edit split.
//
// The rule that changed: typing directly into a hopper cell is a
// pointer-device capability, not a screen-width one. At hopper-cell size on
// touch it never felt right, so every touch surface - phones and the
// wide-but-touch tablet band alike - leaves cells inert and edits through
// the panel/sheet, while a real pointer keeps the desktop hybrid.
//
// The whole 5-layer grid deliberately stays on phones. Stepping through one
// layer at a time was tried and reads as tedious navigation, so the room
// comes from inside each cell instead: no clock, no clear x, no field
// chrome. That is roughly a third of a ~59px cell handed back to the two
// values operators actually read across the line.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

const splitsArea = functionBody("renderSplitsArea");

/* ----------------------------------------------------------------------
 *   Phones keep the full grid
 * -------------------------------------------------------------------- */

test("phones still show every layer at once - the fix is inside the cell, not fewer columns", () => {
  assert.match(splitsArea, /cell\.classList\.toggle\("mobile-layer-active", compactMobileRecipe \|\| cell\.dataset\.layerColumn === activeMobileLayer\);/);
  // The layer rail stays a wider-screen affordance; phones never gained a
  // one-layer-at-a-time picker.
  assert.match(splitsArea, /if \(!compactMobileRecipe\) mobileLayerLayout\.append\(mobileLayerNav\);/);
  assert.doesNotMatch(styles, /splitsMobileLayerPicker/);
});

/* ----------------------------------------------------------------------
 *   Static cells
 * -------------------------------------------------------------------- */

test("static cells expose no pointer target of their own, so the whole cell is one reliable tap target", () => {
  assert.match(styles, /#splitsArea\[data-recipe-cells="static"\] \.splitMatrixCell input\{[\s\S]*?pointer-events: none;/);
  assert.match(styles, /#splitsArea\[data-recipe-cells="static"\] \.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\{[\s\S]*?min-height:52px;[\s\S]*?cursor:pointer;/);
});

test("static cells render values at full strength - 'not editable' must not read as 'unavailable'", () => {
  assert.match(styles, /#splitsArea\[data-recipe-cells="static"\] \.splitMatrixCell input:disabled\{[\s\S]*?opacity: 1;/);
  assert.match(styles, /-webkit-text-fill-color: var\(--text\);/);
});

test("the percentage keeps its unit tucked against the digits, sized without relying on field-sizing", () => {
  const rule = styles.slice(styles.indexOf('#splitsArea[data-recipe-cells="static"] .splitsMatrix.compactMobileRecipe .splitPctControl input{'));
  const block = rule.slice(0, rule.indexOf("}") + 1);
  // An input's intrinsic width comes from its size attribute, not its
  // value, and field-sizing:content is not safe in the Android WebView this
  // also ships in - so the box is fixed and the digits right-align into it.
  assert.match(block, /width:30px;/);
  assert.match(block, /text-align:right;/);
  assert.doesNotMatch(styles, /field-sizing/);
});

/* ----------------------------------------------------------------------
 *   Mobile edit flow
 * -------------------------------------------------------------------- */

test("the mobile sheet drops the numbered steps and gains Clear cell contents, matching the desktop panel", () => {
  const mobileTemplate = splitsArea.slice(
    splitsArea.indexOf("toolbar.innerHTML = compactMobileRecipe ? `"),
    splitsArea.indexOf("} : `")
  );
  assert.doesNotMatch(mobileTemplate, /splitsBulkSteps/);
  assert.match(mobileTemplate, /id="clearSelectedCells"/);
  assert.match(mobileTemplate, /Reset Recipe/);
});

test("the slim context bar leads with Select all - leaving Edit is the toggle's job, not a buried Cancel", () => {
  assert.match(splitsArea, /<button type="button" class="mobileBulkCancel">Select all<\/button>/);
  const start = splitsArea.indexOf('mobileBulkContext.querySelector(".mobileBulkCancel").addEventListener');
  const body = splitsArea.slice(start, splitsArea.indexOf("});", start));
  assert.match(body, /cellRefs\.forEach\(\(_,key\)=>selected\.add\(key\)\);/);
});

/* ----------------------------------------------------------------------
 *   Resin autocomplete inside the mobile edit sheet
 * -------------------------------------------------------------------- */

test("the autocomplete popup is hosted inside an open dialog, not <body>, so the top layer cannot paint over it", () => {
  const show = functionBody("showResinAutocomplete");
  // showModal() puts the sheet in the browser's top layer, which paints
  // above everything in the ordinary DOM - a body-parented popup rendered
  // underneath the sheet, invisible and untappable, despite positioning
  // itself perfectly.
  assert.match(show, /const host = input\.closest\("dialog\[open\]"\) \|\| document\.body;/);
  assert.match(show, /if \(popup\.parentElement !== host\) host\.appendChild\(popup\);/);
});

test("popup positioning switches coordinate space with its host, and stays inside the overflow-hidden sheet", () => {
  const show = functionBody("showResinAutocomplete");
  // body -> viewport-fixed (unchanged desktop/grid behaviour)
  assert.match(show, /if \(host === document\.body\)\{\s*\n\s*popup\.style\.position = "fixed";/);
  // dialog -> absolute against the dialog's own box, which is immune to
  // whether that dialog carries a transform.
  assert.match(show, /popup\.style\.position = "absolute";/);
  // The sheet is overflow:hidden, so the popup flips above the field when
  // there is no room below and caps its height to what is left.
  assert.match(show, /const flip = spaceBelow < 120 && spaceAbove > spaceBelow;/);
  assert.match(show, /popup\.style\.maxHeight = `\$\{Math\.min\(220, available\)\}px`;/);
});

test("applying on mobile clears the selection but stays in Edit view", () => {
  const start = splitsArea.indexOf('mobileBulkEditSheet?.close("applied");');
  const body = splitsArea.slice(start, splitsArea.indexOf("});", start));
  assert.match(body, /selected\.clear\(\);/);
  // Edit is a persistent view now; kicking the operator out of it after
  // every apply would contradict the toggle still reading "Edit".
  assert.doesNotMatch(body, /setBulkMode\(false\)/);
});
