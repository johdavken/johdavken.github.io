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

test("Print Recipe sits next to Rearrange Hoppers and remains desktop-only, even though Rearrange Hoppers itself no longer is", () => {
  const modeBarStart = app.indexOf('modeBar.className = "splitsBulkModeBar"');
  const modeBar = app.slice(modeBarStart, app.indexOf("const toolbar = document.createElement", modeBarStart));
  assert.match(modeBar, /rearrangeButton\.className="secondary"/);
  assert.doesNotMatch(modeBar, /rearrangeButton\.className="secondary rearrangeDesktopOnly"/);
  assert.match(modeBar, /printButton\.className="secondary rearrangeDesktopOnly"/);
  assert.match(modeBar, /modeBar\.appendChild\(rearrangeButton\)[\s\S]*modeBar\.appendChild\(printButton\)/);
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
  assert.match(body, /state\.layers\.forEach/);
  assert.match(body, /hopperBadgeLabel\(L\.name, hi\)/);
  assert.match(body, /normName\(h\.resinName\)/);
  assert.match(body, /clampNum\(h\.pct\)/);
  assert.match(body, /clampNum\(L\.layerPct\)/);
  assert.doesNotMatch(body, /h\.weight/);
  assert.doesNotMatch(body, /h\.track/);
  assert.doesNotMatch(body, /h\.pumpOff/);
});

test("resin names and other user-controlled text are assigned via textContent, never interpolated into HTML", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /resinCell\.textContent = normName\(h\.resinName\) \|\| "—"/);
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

test("layer tables are arranged in a compact two-column grid so a 5-layer recipe fits on one printed page", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /layersGrid\.className = "printSheetLayers"/);
  assert.match(body, /layersGrid\.append\(table\)/);
  assert.match(body, /sheet\.append\(layersGrid\)/);
  assert.doesNotMatch(body, /sheet\.append\(table\)/, "tables must go into the grid wrapper, not directly on the sheet");
  assert.match(styles, /@page\{ margin:12mm; \}/);
  assert.match(styles, /#recipePrintSheet \.printSheetLayers\{ display:grid; grid-template-columns:repeat\(2, 1fr\); gap:4px 14px; \}/);
  assert.match(styles, /#recipePrintSheet \.printSheetLayerTable\{[^}]*page-break-inside:avoid/);
});
