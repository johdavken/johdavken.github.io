"use strict";

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

test("Print Recipe remains desktop-only, even though Rearrange itself no longer is", () => {
  const modeBarStart = app.indexOf('modeBar.className = "splitsBulkModeBar"');
  const modeBar = app.slice(modeBarStart, app.indexOf("const toolbar = document.createElement", modeBarStart));
  assert.match(modeBar, /rearrangeButton\.className="secondary"/);
  assert.doesNotMatch(modeBar, /rearrangeButton\.className="secondary rearrangeDesktopOnly"/);
  assert.match(modeBar, /printButton\.className="secondary rearrangeDesktopOnly"/);
  // Rearrange is no longer appended into modeBar at all (it moved into the
  // desktop-only .recipeUtilityTabs strip alongside Saved recipes/Bulk
  // edit) - Scan Recipe sits between Rearrange's old spot and Print Recipe
  // in modeBar's own append order instead.
  assert.match(modeBar, /modeBar\.appendChild\(scanRecipeButton\)[\s\S]*modeBar\.appendChild\(printButton\)/);
  assert.match(modeBar, /printButton\.addEventListener\("click", printRecipeSheet\)/);
  assert.match(styles, /@media\(max-width:900px\)\{\.rearrangeDesktopOnly\{display:none!important\}\}/);
});

test("printing is a pure read/output action: no confirmation, no state mutation, no sync notification", () => {
  const body = functionBody("printRecipeSheet");
  assert.doesNotMatch(body, /confirm\(/);
  assert.doesNotMatch(body, /showModal/);
  assert.doesNotMatch(body, /saveSession/);
  assert.doesNotMatch(body, /notifyActiveJobMutation/);
  assert.doesNotMatch(body, /validateAndCompute/);
  assert.match(body, /window\.print\(\)/);
});

test("the print sheet is built from state and reflects only recipe fields, not weights/tracking/runtime state", () => {
  const body = functionBody("printRecipeSheet");
  // Prints the page being viewed, so a planned sheet can be carried to the
  // line without printing the recipe that is currently running.
  assert.match(body, /recipeLayers\(\)\.forEach/);
  assert.match(body, /L\.hoppers\.forEach\(h=>\{/);
  assert.match(body, /normName\(h\.resinName\)/);
  assert.match(body, /clampNum\(h\.pct\)/);
  assert.match(body, /clampNum\(L\.layerPct\)/);
  assert.doesNotMatch(body, /h\.weight/);
  assert.doesNotMatch(body, /h\.track/);
  assert.doesNotMatch(body, /h\.pumpOff/);
});

test("resin names and other user-controlled text are assigned via textContent, never interpolated into HTML", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /nameLine\.textContent = resinName \|\| "NOT USED"/);
  assert.doesNotMatch(body, /innerHTML/);
  assert.doesNotMatch(body, /\$\{[^}]*resinName[^}]*\}/);
});

test("the sheet identifies its source workspace (or Local) and is timestamped", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /lineSync\?\.getState\?\.\(\)\.selectedWorkspace\?\.name \|\| "Local"/);
  assert.match(body, /new Date\(\)\.toLocaleString\(\)/);
});

test("existing sheet is replaced rather than duplicated on repeated prints", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /getElementById\("recipePrintSheet"\)/);
  assert.match(body, /existing\.remove\(\)/);
});

test("print CSS hides the whole app and shows only the print sheet, forced to black on white", () => {
  assert.match(styles, /@media print\{/);
  const printBlock = styles.slice(styles.indexOf("@media print{"));
  assert.match(printBlock, /html, body\{ background:#fff !important; \}/);
  assert.match(printBlock, /body > \*:not\(#recipePrintSheet\)\{ display:none !important; \}/);
  assert.match(printBlock, /#recipePrintSheet\{ display:block !important; background:#fff !important; color:#000 !important; \}/);
  assert.match(printBlock, /#recipePrintSheet \*\{ color:#000 !important; background:transparent !important; \}/);
});

// --- single dosing-controller-style overview table, layers x hoppers ------

test("layers are rows and hoppers are columns in one combined table, not a separate table per layer", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /table\.className = "printSheetTable"/);
  assert.match(body, /sheet\.append\(table\)/);
  assert.doesNotMatch(body, /printSheetLayerTable|layersGrid|printSheetLayers/, "the old per-layer-table/grid structure should be fully replaced");
});

test("each layer row starts with the big layer-letter header cell, matching the dosing controller printout's row labels", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /layerLabel\.className = "printSheetLayerLabel"/);
  assert.match(body, /layerLabel\.textContent = L\.name/);
  assert.match(styles, /#recipePrintSheet \.printSheetLayerLabel\{[^}]*font-size:20px[^}]*font-weight:700/);
});

test("each hopper cell stacks the resin name and its blend percentage, like the controller's stacked value/percent readout", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /nameLine\.className = "printSheetResin"/);
  assert.match(body, /pctLine\.className = "printSheetPct"/);
  assert.match(body, /cell\.append\(nameLine, pctLine\)/);
});

test("an empty hopper prints as NOT USED, the controller printout's own label for an unused slot", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /nameLine\.textContent = resinName \|\| "NOT USED"/);
});

test("hopper column headers are naming-mode aware but not per-layer, since a shared header row can't repeat the layer letter per column", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /derivedHopperNamingMode\(\) === "main"\s*\n\s*\? \["Main", "1", "2", "3", "4", "5"\]\s*\n\s*: \["H1", "H2", "H3", "H4", "H5", "H6"\]/);
});

test("the overall layer percentage (distinct from any hopper's blend percentage) survives as a trailing column, since the dosing printout has no equivalent of it", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /layerPctHead\.textContent = "Layer %"/);
  assert.match(body, /layerPctCell\.className = "printSheetLayerPct"/);
  assert.match(body, /layerPctCell\.textContent = `\$\{fmtNum\(clampNum\(L\.layerPct\), 2\)\}%`/);
});

test("the print table is bordered and left-aligned like the source printout, not the app's own dark theme", () => {
  const printBlock = styles.slice(styles.indexOf("@media print{"));
  assert.match(printBlock, /#recipePrintSheet \.printSheetTable\{ width:100%; border-collapse:collapse; table-layout:fixed; \}/);
  assert.match(printBlock, /#recipePrintSheet \.printSheetTable th,\s*\n\s*#recipePrintSheet \.printSheetTable td\{ border:1px solid #000;/);
  assert.match(styles, /@page\{ margin:12mm; \}/);
});
