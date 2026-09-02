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

test("Production, Scrap, and Total share one compact editable summary strip", () => {
  assert.match(html, /id="resinCalcSummary" class="productionSummaryStrip mt10"/);
  assert.match(html, /<label for="prodResinLb">Production<\/label>/);
  assert.match(html, /<label for="scrapResinLb">Scrap<\/label>/);
  assert.match(html, /<output class="productionSummaryMetricValue mono"><span id="resinCalcTotal">0<\/span><span class="productionSummaryMetricUnit">lb<\/span><\/output>/);
  assert.match(styles, /\.productionSummaryStrip\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);[\s\S]*?border:1px solid var\(--row-border-2\);/);
  assert.match(styles, /\.productionSummaryMetricValue\{[\s\S]*?font-size:19px;[\s\S]*?font-weight:950;/);
  assert.match(styles, /\.productionSummaryMetricValue input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\{[\s\S]*?background:transparent;/);
  assert.match(render, /const totalEl = \$\("resinCalcTotal"\);[\s\S]*?totalEl\.textContent = fmtLb\(total\);/);
  assert.doesNotMatch(render, /Resin totals/);
});

test("each material row has a dedicated lot lane without changing its displayed whole-pound value", () => {
  assert.match(render, /<div class="productionSummaryLotLane\$\{lot \? " hasLot" : ""\}">/);
  assert.match(render, /No scanned lot/);
  assert.match(render, /<div class="mono calcValue">\$\{fmtLb\(r\.lbs\)\} lb<\/div>/);
  assert.doesNotMatch(render, /--material-share|productionSummaryShare/);
});

test("the material list has no redundant Total issued footer", () => {
  assert.doesNotMatch(render, /productionSummaryIssuedTotal/);
  assert.doesNotMatch(render, /Total issued/);
});

test("the lot lane is layout-neutral on phones while tablet and desktop keep its dedicated center column", () => {
  assert.match(styles, /\.productionSummaryLotLane\{display:contents\}/);
  assert.match(styles, /\.productionSummaryLotEmpty\{display:none\}/);
  const start = styles.indexOf("@media (min-width:701px){", styles.indexOf(".productionSummaryLotEmpty{display:none}"));
  assert.notEqual(start, -1);
  const end = styles.indexOf("@media (max-width:600px){", start);
  const desktop = styles.slice(start, end);
  assert.match(desktop, /\.productionSummaryMaterialRow\{[\s\S]*?display:grid;/);
  assert.match(desktop, /grid-template-columns:minmax\(110px,\.75fr\) minmax\(0,1\.45fr\) 128px;/);
  assert.match(desktop, /\.productionSummaryLotLane\{[\s\S]*?grid-column:2;[\s\S]*?display:flex;/);
  assert.match(desktop, /\.productionSummaryLotEmpty\{[\s\S]*?display:block;/);
  assert.doesNotMatch(styles, /productionSummaryIssuedTotal/);
  assert.match(styles, /@media \(max-width:600px\)\{[\s\S]*?\.productionSummaryStrip\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
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
