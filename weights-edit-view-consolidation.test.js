"use strict";

// Desktop Receiver Hopper Weights used to have three independent controls
// crowded together: Smart Hoppers (a calculation setting), View: Summary/
// Edit (a display-density choice), and a separate "Bulk edit" tab below the
// table (a batch-apply workflow). Two of those three shared the word
// "Edit" while meaning different things, which read as confusing rather
// than as three distinct, well-scoped controls.
//
// Consolidation: Summary stays "at a glance" (read-only numbers, can't be
// tapped into - a safety property, not just a display choice). Edit is now
// the single, whole change workflow: type directly into one cell's input,
// or click several cells to select them and apply one value to all via a
// compact toolbar. There is no more standalone "Bulk edit" mode/tab -
// selection is simply part of Edit view. The toolbar itself sits directly
// under the Smart Hoppers/View row (above the table, not below it), has no
// numbered step captions, and no separate "Done" button - switching View
// back to Summary is the exit.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("there is no standalone Bulk edit button/tab left in the desktop weights action row - Weight Profiles is the only item", () => {
  const body = functionBody("renderWeightsArea");
  assert.doesNotMatch(body, /<span>Bulk edit<\/span>/);
  assert.doesNotMatch(body, /bulkModeButton|desktopWeightsBulkToggle/);
  assert.match(body, /profilesAction\.innerHTML = '<span>Weight Profiles<\/span>/);
  assert.match(body, /actionToolbar\.append\(profilesAction\);/);
});

test("cell selection is gated on View being Edit, not a separate mode flag - desktopBulkMode is derived from setDesktopWeightView", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /function setDesktopWeightView\(mode\)\{\s*\n\s*desktopWeightView = mode === "edit" \? "edit" : "summary";\s*\n\s*weightsViewMode = desktopWeightView;\s*\n\s*desktopBulkMode = desktopWeightView === "edit";/);
  // The per-cell click/keydown handlers and header select buttons still
  // gate on the same desktopBulkMode variable - just no longer settable by
  // its own independent toggle.
  assert.match(body, /if \(!desktopBulkMode\) return;/);
  assert.match(body, /if \(!desktopBulkMode \|\| e\.target === input \|\| e\.target === selector/);
});

test("the Edit-view toolbar has no numbered step captions and no separate Done button - Summary is the only exit", () => {
  const body = functionBody("renderWeightsArea");
  assert.doesNotMatch(body, /Select hoppers<\/span>|Enter changes<\/span>|weightsBulkSteps/);
  assert.doesNotMatch(body, /doneBulkWeights|>Done</);
  // Select all was removed - a receiver-weight matrix never has a real
  // use case for selecting every hopper at once, so it just cost the row
  // a slot for nothing.
  assert.doesNotMatch(body, /id="selectAllWeights"/);
  assert.match(body, /id="clearWeightSelection"/);
});

test("the toolbar's own DOM order is Smart Hoppers/View controls, then the toolbar, then the table", () => {
  const body = functionBody("renderWeightsArea");
  const controlsAppend = body.indexOf("area.appendChild(desktopControls);");
  const toolbarAppend = body.indexOf("area.appendChild(toolbar);");
  const scrollAppend = body.indexOf("area.appendChild(scroll);");
  assert.ok(controlsAppend > -1 && toolbarAppend > controlsAppend && scrollAppend > toolbarAppend);
});

test("opening Weight Profiles switches View back to Summary, and switching to Edit closes Weight Profiles - the two still can't be open together", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /function setDesktopProfilesOpen\(open\)\{\s*\n\s*desktopProfilesOpen = !!open;\s*\n\s*if \(desktopProfilesOpen\)\{\s*\n\s*setDesktopWeightView\("summary"\);/);
  assert.match(body, /desktopBulkMode = desktopWeightView === "edit";\s*\n\s*if \(desktopBulkMode\) setDesktopProfilesOpen\(false\);/);
});

test("exiting Edit view (Android Back, or switching to Summary) clears any in-progress selection", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /if \(!desktopBulkMode\) selected\.clear\(\);/);
  assert.match(app, /exitWeightsBulkModeFn = \(\) => setDesktopWeightView\("summary"\);/);
});

test("the Edit toolbar renders as a single compact row directly under the controls row, not the old below-the-table bulk panel", () => {
  assert.match(desktop, /\.desktopWeightsBulkContext\{display:flex;align-items:center;/);
  assert.match(desktop, /\.desktopWeightsBulkContext \.weightsBulkFieldsRow\{/);
  // Fields/Apply on the left, selection status/Clear pushed to the right
  // via margin-left:auto - one row, not two stacked.
  assert.match(desktop, /\.desktopWeightsBulkContext \.weightsBulkActions\{[^}]*margin-left:auto/);
});
