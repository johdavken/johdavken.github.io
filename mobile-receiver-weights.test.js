"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

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
  assert.match(mobile,/label\.textContent = `\$\{L\.name\}\$\{hopperPositionLabel\(hi\)\}`;/);
  assert.match(mobile,/for \(let hi=0; hi<HOPPERS_PER_LAYER; hi\+\+\)/);
  assert.match(styles,/grid-template-columns:repeat\(var\(--mobile-weight-layer-count\),minmax\(0,1fr\)\);/);
});

test("mobile Smart Hoppers uses a workspace circumference plus a height in every cell, not a wrench popover",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/id = "mobileSharedCircumference"/);
  assert.match(mobile,/value=>setWorkspaceHopperCircumference\(value\)/);
  assert.match(mobile,/makeValueField\("W", hopper\.weight/);
  assert.match(mobile,/makeValueField\("H", hopper\.usableHeight/);
  assert.match(html,/How Smart Hoppers work/);
  assert.match(mobile,/mobileWeightSummaryWeight/);
  assert.doesNotMatch(mobile,/hopperGeometryPopover/);
  assert.match(mobile,/smartToggle\.id = "smartHoppersToggle"/);
});

test("mobile bulk entry is an explicit selector mode and can apply weight and height",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile,/bulkToggleRow\.id = "mobileWeightsBulkToggle"/);
  assert.match(mobile,/actionToolbar\.append\(profilesAction, bulkToggleRow\)/);
  assert.match(mobile,/area\.appendChild\(actionToolbar\)/);
  assert.doesNotMatch(mobile,/selector\.type = "checkbox"/);
  assert.match(mobile,/cell\.setAttribute\("aria-selected", "false"\)/);
  assert.match(mobile,/cell\.addEventListener\("keydown"/);
  assert.match(mobile,/function setMobileWeightBulkMode\(enabled\)/);
  assert.match(mobile,/area\.dataset\.mobileBulkMode = String\(bulkMode\);/);
  assert.match(mobile,/id="mobileBulkWeight"/);
  assert.match(mobile,/id="mobileBulkHeight"/);
  assert.match(mobile,/ref\.hopper\.weight = weightResult\.value;/);
  assert.match(mobile,/ref\.hopper\.usableHeight = heightResult\.value;/);
  assert.match(mobile,/applyButton\.disabled = selected\.size === 0 \|\| !hasValue \|\| !valuesAreValid;/);
  assert.match(styles,/#weightsArea\[data-mobile-bulk-mode="true"\] \.mobileWeightCell\.selected::after/);
});

test("Smart capacity replaces only the mobile Summary weight display and rounds visually",()=>{
  const refresh = functionBody("refreshSmartHopperState");
  assert.match(refresh,/mobileSummaryWeightId\(L\.name, hi\)/);
  assert.match(refresh,/const value=smart \? Math\.round\(smart\.value\) : clampNum\(hopper\.weight\);/);
  assert.match(refresh,/mobileSummaryWeight\.classList\.toggle\("smart",!!smart\)/);
  assert.match(refresh,/Smart-calculated weight/);
  assert.match(styles,/\.mobileWeightSummaryWeight\.smart\{color:var\(--ok\)\}/);
  assert.doesNotMatch(styles,/\.mobileWeightSummaryWeight\.smart::after/);
  assert.match(styles,/\.mobileWeightCell\.selected::after/);
});

test("mobile receiver Summary cells are compact text readouts with no repeated hopper artwork",()=>{
  const mobile = functionBody("renderMobileWeightsArea");
  const summary = mobile.slice(mobile.indexOf('visualReadout.innerHTML'), mobile.indexOf('const summaryWeight'));
  assert.doesNotMatch(summary,/<svg/);
  assert.match(styles,/#weightsArea\[data-mobile-weight-view="visual"\] \.mobileWeightCell\{height:70px;min-height:68px/);
  assert.match(styles,/\.mobileWeightsActionToolbar\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("mobile receiver profiles use the same bottom-sheet row pattern as Recipes",()=>{
  assert.match(app,/function ensureMobileWeightProfilesSheet\(trigger\)/);
  assert.match(app,/id="mobileWeightProfilesSheet"/);
  assert.match(app,/Receiver weight profiles/);
  assert.match(app,/id="mobileWeightProfilesSearch"/);
  assert.match(app,/id="mobileWeightProfilesSave"/);
  assert.match(app,/function renderMobileWeightProfileRows\(items,syncState\)/);
  assert.match(app,/sheet\.close\("load"\)/);
});

test("Smart Hopper help is a width-constrained wrapping block on mobile",()=>{
  assert.match(styles,/\.weightsSmartHow\{display:block;min-width:0;width:100%;max-width:100%;box-sizing:border-box/);
  assert.match(styles,/\.weightsSmartHow summary\{min-width:0;max-width:100%;[\s\S]*?white-space:normal;overflow-wrap:anywhere/);
  assert.match(styles,/\.weightsSmartHow p\{min-width:0;max-width:100%;[\s\S]*?white-space:normal;overflow-wrap:anywhere/);
  assert.doesNotMatch(styles,/\.weightsSmartHow\{width:max-content/);
});
