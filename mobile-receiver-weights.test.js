"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("Receiver Hopper Weights switches to an all-layer mobile matrix without changing desktop rendering",()=>{
  const render = functionBody("renderWeightsArea");
  assert.match(render,/window\.matchMedia\("\(max-width: 900px\)"\)\.matches/);
  assert.match(render,/renderMobileWeightsArea\(area\);/);

  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/matrix\.style\.setProperty\("--mobile-weight-layer-count", String\(state\.layers\.length\)\);/);
  assert.match(mobile,/heading\.textContent = L\.name;/);
  assert.match(mobile,/for \(let hi=0; hi<HOPPERS_PER_LAYER; hi\+\+\)/);
  assert.match(styles,/grid-template-columns:repeat\(var\(--mobile-weight-layer-count\),minmax\(0,1fr\)\);/);
});

test("mobile Smart Hoppers uses shared circumference plus a height in every cell, not a wrench popover",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/id = "mobileSharedCircumference"/);
  assert.match(mobile,/state\.layers\.forEach\(L=>L\.hoppers\.forEach\(hopper=>\{ hopper\.circumference = value; \}\)\)/);
  assert.match(mobile,/makeValueField\("W", hopper\.weight/);
  assert.match(mobile,/makeValueField\("H", hopper\.usableHeight/);
  assert.doesNotMatch(mobile,/hopperGeometryPopover/);
  assert.match(mobile,/smartToggle\.id = "smartHoppersToggle"/);
});

test("mobile bulk entry is an explicit selector mode and can apply weight and height",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/bulkToggle\.id = "mobileWeightsBulkToggle"/);
  assert.match(mobile,/function setMobileWeightBulkMode\(enabled\)/);
  assert.match(mobile,/area\.dataset\.mobileBulkMode = String\(bulkMode\);/);
  assert.match(mobile,/id="mobileBulkWeight"/);
  assert.match(mobile,/id="mobileBulkHeight"/);
  assert.match(mobile,/ref\.hopper\.weight = weightResult\.value;/);
  assert.match(mobile,/ref\.hopper\.usableHeight = heightResult\.value;/);
  assert.match(styles,/#weightsArea\[data-mobile-bulk-mode="true"\] \.mobileWeightCellSelector\{ display:block; \}/);
});
