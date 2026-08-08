"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const rearrangement = fs.readFileSync("hopper-rearrangement.js", "utf8");

// Smart Hoppers, stage 1: the toggle (replacing "Select row" in the
// Receiver Hopper Weights corner cell), the per-hopper wrench popover for
// entering usable height/circumference, and the underlying data model.
// Not wired yet: computing weight from those values + a resin's known
// density, or feeding a computed weight into the run-down formula - that's
// a later stage. Height/circumference are physical-equipment values, same
// category as the existing `weight` field - they should behave exactly
// like it: attached to the physical hopper slot (untouched by
// rearrangement, unaffected by which resin is currently assigned), synced
// via RT Sync same as weight already is, but not yet part of the
// Receiver Weight Profile save/load contract.

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("state defaults smartHoppersEnabled to false, as a local display preference (not shared job data)", () => {
  const stateStart = app.indexOf("const state = {");
  const stateBody = app.slice(stateStart, app.indexOf("};", stateStart));
  assert.match(stateBody, /smartHoppersEnabled: false/);
});

test("ensureLayers gives every hopper usableHeight/circumference fields, preserving existing values and defaulting new ones to 0", () => {
  const body = functionBody("ensureLayers");
  assert.match(body, /usableHeight: clampNum\(h\.usableHeight\)/);
  assert.match(body, /circumference: clampNum\(h\.circumference\)/);
  assert.match(body, /usableHeight: 0,\s*\n\s*circumference: 0/);
});

test("applyPayload's hopper reconstruction (local session load) also carries usableHeight/circumference through", () => {
  const start = app.indexOf("function applyPayload(");
  const body = app.slice(start, app.indexOf("\n    function ", start + 1));
  assert.match(body, /usableHeight: clampNum\(fh\.usableHeight\)/);
  assert.match(body, /circumference: clampNum\(fh\.circumference\)/);
});

test("snapshotPayload persists smartHoppersEnabled locally, and applyPayload reads it back", () => {
  const snapStart = app.indexOf("function snapshotPayload(");
  const snapBody = app.slice(snapStart, app.indexOf("\n    function ", snapStart + 1));
  assert.match(snapBody, /smartHoppersEnabled: !!state\.smartHoppersEnabled/);

  const applyStart = app.indexOf("function applyPayload(");
  const applyBody = app.slice(applyStart, app.indexOf("\n    function ", applyStart + 1));
  assert.match(applyBody, /state\.smartHoppersEnabled = !!payload\.smartHoppersEnabled/);
});

test("a shared active job never overrides this device's Smart Hoppers preference - it's in applySharedActiveJob's local-preferences allowlist, same as showPumpOffTracked", () => {
  const start = app.indexOf("function applySharedActiveJob(");
  const body = app.slice(start, app.indexOf("\n  \n  /*", start));
  assert.match(body, /smartHoppersEnabled: state\.smartHoppersEnabled/);
});

test("changing line type still warns before discarding a removed layer's configured Smart Hopper geometry, not just weight/resin/track/pumpOff", () => {
  const start = app.indexOf("function hookLineTypeChoice(");
  const body = app.slice(start, app.indexOf("\n  }", start));
  assert.match(body, /clampNum\(hopper\.usableHeight\) > 0 \|\| clampNum\(hopper\.circumference\) > 0/);
});

test("hasMeaningfulActiveJob (active-job.js) also treats usableHeight/circumference as meaningful data", () => {
  const activeJob = fs.readFileSync("active-job.js", "utf8");
  const start = activeJob.indexOf("function hasMeaningfulActiveJob(");
  const body = activeJob.slice(start, activeJob.indexOf("\n  }", start));
  assert.match(body, /Number\(hopper\?\.usableHeight\) > 0 \|\| Number\(hopper\?\.circumference\) > 0/);
});

test("hopper rearrangement only ever moves resinName/pct - height/circumference (like weight/track/pumpOff) are never part of the moved assignment and stay attached to the physical hopper", () => {
  assert.match(rearrangement, /const assignment=h=>\(\{resinName:.*?,pct:.*?\}\);/);
  assert.doesNotMatch(rearrangement, /usableHeight/);
  assert.doesNotMatch(rearrangement, /circumference/);
});

test("the corner cell (formerly plain \"Select row\" text) now holds the Smart Hoppers toggle: a role=switch styled like the existing Setup toggles, with an explanatory title", () => {
  const start = app.indexOf('corner.className = "weightsRowCorner";');
  const body = app.slice(start, app.indexOf("headerRow.appendChild(corner);", start));
  assert.doesNotMatch(body, /corner\.textContent = "Select row"/);
  assert.match(body, /smartToggle\.id = "smartHoppersToggle";/);
  assert.match(body, /smartToggle\.className = "toggle";/);
  assert.match(body, /smartToggle\.setAttribute\("role", "switch"\);/);
  assert.match(body, /smartToggle\.title = "Smart Hoppers:/);
});

test("the toggle is wired through the shared hookToggle helper (same as the other Setup switches), re-wired on every render since the corner cell is rebuilt each time", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /hookToggle\(\s*\n\s*"smartHoppersToggle",\s*\n\s*\(\)=> !!state\.smartHoppersEnabled,\s*\n\s*\(v\)=>\{ state\.smartHoppersEnabled = !!v; renderWeightsArea\(\); \}\s*\n\s*\);/);
});

test("the wrench popover is only built when Smart Hoppers is enabled - no dead markup left in the DOM when it's off", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /if \(state\.smartHoppersEnabled\)\{\s*\n\s*geometryPopover = document\.createElement\("details"\);/);
});

test("each wrench popover is a <details> using the same exclusive name so only one is open at a time, with an aria-labeled trigger naming the specific hopper", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /geometryPopover\.setAttribute\("name", "hopperGeometry"\);/);
  assert.match(body, /const geometryLabel = `Set \$\{hopperBadgeLabel\(L\.name, hi\)\} height and circumference`;/);
});

test("the wrench panel has two numeric fields (usable height, circumference), each validated and written straight to the hopper - same acceptNumericInput/validateAndCompute/saveSession pattern the weight field already uses", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /heightInput\.id = `gh_\$\{L\.name\}_\$\{hi\}`;/);
  assert.match(body, /circInput\.id = `gc_\$\{L\.name\}_\$\{hi\}`;/);
  assert.match(body, /value => \{ L\.hoppers\[hi\]\.usableHeight = value; \}/);
  assert.match(body, /value => \{ L\.hoppers\[hi\]\.circumference = value; \}/);
  const heightBlock = body.slice(body.indexOf("heightInput.addEventListener"), body.indexOf("circInput.addEventListener"));
  assert.match(heightBlock, /validateAndCompute\(\{ sync: true \}\);/);
  assert.match(heightBlock, /saveSession\(\);/);
});

test("clicking the wrench (or anything inside its popover) does not also toggle the cell's bulk-select checkbox", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /if \(e\.target === input \|\| e\.target === selector \|\| e\.target\.closest\("\.hopperGeometryPopover"\)\) return;/);
});

test("clicking outside any open wrench popover, or pressing Escape, closes it - same established pattern as the appearance-preferences and tools dropdowns", () => {
  assert.match(app, /document\.querySelectorAll\("\.hopperGeometryPopover\[open\]"\)\.forEach\(popover=>\{\s*\n\s*if \(!popover\.contains\(event\.target\)\) popover\.open = false;/);
  assert.match(app, /if \(event\.key === "Escape"\)\{\s*\n\s*document\.querySelectorAll\("\.hopperGeometryPopover\[open\]"\)\.forEach\(popover=>\{\s*\n\s*popover\.open = false;/);
});

test(".weightsMatrixCell stays a plain table cell (position:relative only, as an anchor for the popover) - display:flex lives on an inner .weightsCellRow wrapper instead, since overriding a <td>'s display away from table-cell drops it out of the table's column layout entirely", () => {
  const ruleStart = styles.indexOf("position: relative;\n  background:transparent;");
  assert.notEqual(ruleStart, -1);
  const cellRule = styles.slice(styles.lastIndexOf(".weightsMatrixCell{", ruleStart), styles.indexOf("}", ruleStart) + 1);
  assert.doesNotMatch(cellRule, /display: flex;/);
  assert.match(cellRule, /position: relative;/);

  const rowRuleStart = styles.indexOf(".weightsCellRow{");
  assert.notEqual(rowRuleStart, -1);
  const rowRule = styles.slice(rowRuleStart, styles.indexOf("}", rowRuleStart) + 1);
  assert.match(rowRule, /display: flex;/);
});

test("renderWeightsArea builds each cell's checkbox/input/wrench inside a .weightsCellRow wrapper, appended to the <td> once assembled", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /const cellRow = document\.createElement\("div"\);/);
  assert.match(body, /cellRow\.className = "weightsCellRow";/);
  assert.match(body, /cellRow\.append\(selector, fieldWrap\);/);
  assert.match(body, /td\.appendChild\(cellRow\);/);
});

test("the wrench trigger and its floating panel reuse the app's established small-popover look (bordered, rounded, shadowed) rather than inventing new chrome", () => {
  const triggerStart = styles.indexOf(".hopperGeometryTrigger{");
  assert.notEqual(triggerStart, -1);
  const panelStart = styles.indexOf(".hopperGeometryPanel{");
  const panelRule = styles.slice(panelStart, styles.indexOf("}", panelStart) + 1);
  assert.match(panelRule, /border: 1px solid var\(--border2\);/);
  assert.match(panelRule, /box-shadow: var\(--shadow2\);/);
});

test("the panel is position:fixed with JS-computed placement, not position:absolute - the matrix's overflow:hidden frame would otherwise clip it for any hopper near the table's bottom/right edge", () => {
  const panelStart = styles.indexOf(".hopperGeometryPanel{");
  const panelRule = styles.slice(panelStart, styles.indexOf("}", panelStart) + 1);
  assert.match(panelRule, /position: fixed;/);
  assert.doesNotMatch(panelRule, /position: absolute;/);

  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /geometryPopover\.addEventListener\("toggle", \(\)=>\{/);
  assert.match(body, /const rect = trigger\.getBoundingClientRect\(\);/);
  assert.match(body, /left = Math\.max\(8, Math\.min\(left, window\.innerWidth - panelWidth - 8\)\);/);
  assert.match(body, /if \(top \+ panelHeight > window\.innerHeight - 8\)\{/);
});
