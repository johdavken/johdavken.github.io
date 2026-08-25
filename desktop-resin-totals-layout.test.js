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

const render = functionBody("renderResinCalculator");

test("tablet and desktop production/scrap inputs use the preview's boxed field structure", () => {
  assert.match(html, /class="productionSummaryInputField">\s*<label for="prodResinLb">Production Resin <span class="productionSummaryLabelUnit">\(lb\)<\/span><\/label>/);
  assert.match(html, /class="productionSummaryInputField">\s*<label for="scrapResinLb">Scrap Resin <span class="productionSummaryLabelUnit">\(lb\)<\/span><\/label>/);
  const start = styles.indexOf("@media (min-width:701px){", styles.indexOf(".productionSummaryIssuedTotal{display:none}"));
  const end = styles.indexOf("@media (max-width:600px){", start);
  const desktop = styles.slice(start, end);
  assert.match(desktop, /\.productionSummaryInputField\{[\s\S]*?border:1px solid var\(--row-border-2\);[\s\S]*?background:var\(--row-bg-2\);/);
  assert.match(desktop, /\.productionSummaryInputField label\{[\s\S]*?text-transform:uppercase;/);
  assert.match(desktop, /\.productionSummaryInputField::after\{[\s\S]*?content:"lb";/);
  assert.match(desktop, /\.productionSummaryInputField input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\{[\s\S]*?font-size:19px;[\s\S]*?font-weight:950;/);
  assert.match(desktop, /\.productionSummaryInputField \.productionSummaryLabelUnit\{display:none\}/);
});

test("each material row has a dedicated lot lane without changing its displayed whole-pound value", () => {
  assert.match(render, /<div class="productionSummaryLotLane\$\{lot \? " hasLot" : ""\}">/);
  assert.match(render, /No scanned lot/);
  assert.match(render, /<div class="mono calcValue">\$\{fmtLb\(r\.lbs\)\} lb<\/div>/);
  assert.doesNotMatch(render, /--material-share|productionSummaryShare/);
});

test("the material list ends with Total issued using the same total and whole-pound formatter", () => {
  assert.match(render, /issuedTotal\.className = "productionSummaryIssuedTotal";/);
  assert.match(render, /<strong>Total issued<\/strong><span class="mono">\$\{fmtLb\(total\)\} lb<\/span>/);
  assert.match(render, /out\.appendChild\(issuedTotal\);/);
});

test("the lot lane is layout-neutral on phones while tablet and desktop show Total issued", () => {
  assert.match(styles, /\.productionSummaryLotLane\{display:contents\}/);
  assert.match(styles, /\.productionSummaryLotEmpty,\s*\.productionSummaryIssuedTotal\{display:none\}/);
  const start = styles.indexOf("@media (min-width:701px){", styles.indexOf(".productionSummaryIssuedTotal{display:none}"));
  assert.notEqual(start, -1);
  const end = styles.indexOf("@media (max-width:600px){", start);
  const desktop = styles.slice(start, end);
  assert.match(desktop, /\.productionSummaryMaterialRow\{[\s\S]*?display:grid;/);
  assert.match(desktop, /grid-template-columns:minmax\(110px,\.75fr\) minmax\(0,1\.45fr\) 128px;/);
  assert.match(desktop, /\.productionSummaryLotLane\{[\s\S]*?grid-column:2;[\s\S]*?display:flex;/);
  assert.match(desktop, /\.productionSummaryLotEmpty\{[\s\S]*?display:block;/);
  assert.match(desktop, /\.productionSummaryIssuedTotal\{[\s\S]*?display:flex;/);
});

test("the optional lot remains in the center column and truncates before either anchor", () => {
  assert.match(styles, /\.productionSummaryLotLane\{[\s\S]*?grid-column:2;/);
  assert.match(styles, /\.productionSummaryMaterialRow \.calcValue\{grid-column:3;/);
  assert.match(styles, /\.calcLot\{[\s\S]*?min-width:0;[\s\S]*?text-overflow:ellipsis;/);
});

test("the pounds column has one fixed width so every lot lane shares both vertical boundaries", () => {
  assert.match(styles, /grid-template-columns:minmax\(110px,\.75fr\) minmax\(0,1\.45fr\) 128px;/);
  assert.doesNotMatch(styles, /grid-template-columns:minmax\(110px,\.75fr\) minmax\(0,1\.45fr\) max-content;/);
});
