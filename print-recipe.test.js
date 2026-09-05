"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("Print Recipe remains desktop-only, even though Rearrange itself no longer is", () => {
  const modeBarStart = app.indexOf('modeBar.className = "splitsBulkModeBar"');
  const modeBar = app.slice(modeBarStart, app.indexOf("const toolbar = document.createElement", modeBarStart));
  assert.match(modeBar, /rearrangeButton\.className="bulkTextAction splitsRearrangeAction"/);
  assert.doesNotMatch(modeBar, /rearrangeButton\.className[^;]*rearrangeDesktopOnly/);
  assert.match(modeBar, /printButton\.className="secondary rearrangeDesktopOnly recipeActionTertiary"/);
  // Rearrange is no longer appended into modeBar at all (it lives in the
  // Edit toolbar's .splitsEditRowSecondary on every width now) - Scan
  // Recipe sits directly ahead of Print Recipe in modeBar's own append
  // order instead.
  assert.match(modeBar, /modeBar\.appendChild\(scanRecipeButton\)[\s\S]*modeBar\.appendChild\(printButton\)/);
  // Print now asks which recipe(s) to print before it does any rendering.
  assert.match(modeBar, /printButton\.addEventListener\("click", openPrintRecipeDialog\)/);
  assert.match(styles, /@media\(max-width:900px\), \(min-width: 901px\) and \(pointer: coarse\)\{\.rearrangeDesktopOnly\{display:none!important\}\}/);
});

test("the print button is enabled when either the page on screen or the planned Next recipe has content", () => {
  assert.match(app, /printButton\.disabled=!recipeLayers\(\)\.some\(L=>L\.hoppers\.some\(h=>normName\(h\.resinName\)\|\|clampNum\(h\.pct\)>0\)\) && !hasPlannedRecipe\(\);/);
});

test("choosing which recipe(s) to print is a dialog, gated on a planned Next recipe existing", () => {
  const body = functionBody("openPrintRecipeDialog");
  assert.match(body, /\$\("printRecipeDialog"\)/);
  assert.match(body, /hasPlannedRecipe\(\)/);
  assert.match(body, /nextButton\.disabled = !planned/);
  assert.match(body, /bothButton\.disabled = !planned/);
  assert.match(body, /dialog\.showModal\(\)/);
  assert.match(body, /printRecipeSheet\(value\)/);
});

test("the print choice dialog offers Current, Next and Both, plus Cancel", () => {
  const dialogStart = html.indexOf('<dialog id="printRecipeDialog"');
  assert.notEqual(dialogStart, -1);
  const dialog = html.slice(dialogStart, html.indexOf("</dialog>", dialogStart));
  assert.match(dialog, /<button value="current"[^>]*>Current<\/button>/);
  assert.match(dialog, /<button id="printRecipeNextButton" value="next"[^>]*>Next<\/button>/);
  assert.match(dialog, /<button id="printRecipeBothButton" value="both"[^>]*>Both<\/button>/);
  assert.match(dialog, /<button value="cancel"[^>]*>Cancel<\/button>/);
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

test("printRecipeSheet builds one section for Current or Next, and two (with a divider between) for Both, sharing one page", () => {
  const body = functionBody("printRecipeSheet");
  assert.match(body, /which === "both" \? \["current", "next"\] : \[which === "next" \? "next" : "current"\]/);
  assert.match(body, /buildRecipePrintSection\(page\)/);
  assert.match(body, /section\.classList\.add\("printSheetSectionDivider"\)/);
  assert.doesNotMatch(body, /printSheetSectionBreak|page-break/);
});

test("the print sheet is built from state and reflects only recipe fields, not weights/tracking/runtime state", () => {
  const body = functionBody("buildRecipePrintSection");
  // Reads whichever page was asked for, not whichever page happens to be
  // open in the editor.
  assert.match(body, /recipeSheetLayersFor\(page\)/);
  assert.match(body, /normName\(h\?\.resinName\)/);
  assert.match(body, /clampNum\(h\?\.pct\)/);
  assert.match(body, /clampNum\(layerPct\)/);
  assert.doesNotMatch(body, /h\.weight|h\?\.weight/);
  assert.doesNotMatch(body, /h\.track|h\?\.track/);
  assert.doesNotMatch(body, /h\.pumpOff|h\?\.pumpOff/);
});

test("Current reads the live recipe directly; Next reads the durable plan, not the working copy, reshaped to the same field names", () => {
  const body = functionBody("recipeSheetLayersFor");
  assert.match(body, /window\.PolynNextRecipe\?\.normalize\(state\.nextRecipe\)/);
  assert.doesNotMatch(body, /nextRecipeWorking/);
  assert.match(body, /resinName: hopper\.resin_name/);
  assert.match(body, /layerPct: layer\.layer_pct/);
  assert.match(body, /return state\.layers;/);
});

test("resin names and other user-controlled text are assigned via textContent, never interpolated into HTML", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /nameLine\.textContent = resinName \|\| "NOT USED"/);
  assert.doesNotMatch(body, /innerHTML/);
  assert.doesNotMatch(body, /\$\{[^}]*resinName[^}]*\}/);
});

test("each section identifies its source recipe page, workspace (or Local), and is timestamped", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /title\.textContent = page === "next" \? "Next Recipe" : "Current Recipe"/);
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

test("Both shares one sheet of paper, separated by a visual divider rather than a page break", () => {
  const printBlock = styles.slice(styles.indexOf("@media print{"));
  assert.match(printBlock, /#recipePrintSheet \.printSheetSectionDivider\{[^}]*border-top:2px solid #000;[^}]*\}/);
  assert.doesNotMatch(printBlock, /page-break/);
});

// --- single dosing-controller-style overview table, layers x hoppers ------

test("layers are rows and hoppers are columns in one combined table, not a separate table per layer", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /table\.className = "printSheetTable"/);
  assert.match(body, /section\.append\(table\)/);
  assert.doesNotMatch(body, /printSheetLayerTable|layersGrid|printSheetLayers/, "the old per-layer-table/grid structure should be fully replaced");
});

test("each layer/hopper row or column starts with the big letter header cell, matching the dosing controller printout's row labels", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /cell\.className = "printSheetLayerLabel"/);
  assert.match(body, /hopperLabel\.className = "printSheetLayerLabel"/);
  assert.match(styles, /#recipePrintSheet \.printSheetLayerLabel\{[^}]*font-size:20px[^}]*font-weight:700/);
});

test("each hopper cell stacks the resin name and its blend percentage, like the controller's stacked value/percent readout", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /nameLine\.className = "printSheetResin"/);
  assert.match(body, /pctLine\.className = "printSheetPct"/);
  assert.match(body, /cell\.append\(nameLine, pctLine\)/);
});

test("an empty hopper prints as NOT USED, the controller printout's own label for an unused slot", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /nameLine\.textContent = resinName \|\| "NOT USED"/);
});

test("hopper column headers are naming-mode aware but not per-layer, since a shared header row can't repeat the layer letter per column", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /derivedHopperNamingMode\(\) === "main"\s*\n\s*\? \["Main", "1", "2", "3", "4", "5"\]\s*\n\s*: \["H1", "H2", "H3", "H4", "H5", "H6"\]/);
});

test("the overall layer percentage (distinct from any hopper's blend percentage) rides next to the layer letter itself, not a whole extra row/column", () => {
  const body = functionBody("buildRecipePrintSection");
  const helper = body.slice(body.indexOf("const layerLabelCell"), body.indexOf("const table = document.createElement"));
  assert.match(helper, /pctSpan\.className = "printSheetLayerPct"/);
  assert.match(helper, /`\$\{fmtNum\(clampNum\(layerPct\), 2\)\}%`/);
  assert.match(helper, /cell\.append\(nameSpan, pctSpan\)/);
  assert.doesNotMatch(body, /Layer %/, "no separate 'Layer %' row/column header remains");
});

test("the print table is bordered and left-aligned like the source printout, not the app's own dark theme", () => {
  const printBlock = styles.slice(styles.indexOf("@media print{"));
  assert.match(printBlock, /#recipePrintSheet \.printSheetTable\{ width:100%; border-collapse:collapse; table-layout:fixed; \}/);
  assert.match(printBlock, /#recipePrintSheet \.printSheetTable th,\s*\n\s*#recipePrintSheet \.printSheetTable td\{ border:1px solid #000;/);
  assert.match(styles, /@page\{ margin:12mm; \}/);
});

// --- orientation follows the on-screen Recipe matrix setting --------------

test("layersLeft ('left' orientation, the default) puts layers as rows and hoppers as columns", () => {
  const body = functionBody("buildRecipePrintSection");
  assert.match(body, /const layersLeft = state\.recipeLayerOrientation !== "top";/);
  assert.match(body, /if \(layersLeft\)\{/);
});

test("'top' orientation transposes the sheet: hoppers as rows, layers as columns, each column header carrying its layer's percentage", () => {
  const body = functionBody("buildRecipePrintSection");
  const transposed = body.slice(body.indexOf("} else {"));
  assert.match(transposed, /layers\.forEach\(L=> headRow\.appendChild\(layerLabelCell\(L\.name, L\.layerPct, "col"\)\)\)/);
  assert.match(transposed, /hopperColumnLabels\.forEach\(\(label, hi\)=>\{/);
  assert.match(transposed, /row\.appendChild\(hopperCell\(L\.hoppers\[hi\]\)\)/);
});
