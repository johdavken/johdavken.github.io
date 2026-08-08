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
// Height/circumference are physical-equipment values, same category as the
// existing `weight` field - they behave exactly like it: attached to the
// physical hopper slot (untouched by rearrangement, unaffected by which
// resin is currently assigned), synced via RT Sync same as weight already
// is, and (as of stage 2) part of the Receiver Weight Profile save/load
// contract too (see workspace-configuration-payloads.test.js).
//
// Stage 2: the actual computation - a smaller, non-interactive number
// under the operator's own weight field, shown only when this hopper's
// geometry (height, circumference) and its assigned resin's known density
// are all available. Packing factor is deliberately NOT a per-hopper
// field: it's a trait of the resin (like density), not the hopper, and
// belongs in the resin database once that field exists there. Until then,
// TEMP_RESIN_PACKING_FACTOR stands in as a fixed placeholder for every
// resin. Also: a small green "SMART" badge next to the tracking clock in
// Recipe Setup, shown under the exact same condition, so an operator
// looking at the recipe (not the weights grid) can still see at a glance
// that a hopper's weight is being computed rather than manually entered.
// Not wired yet: feeding the computed number into the run-down formula
// instead of the operator's entered weight - that's the next stage.

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

// --- Stage 2: the computed-weight readout, and the Recipe Setup badge ---

test("packing factor is not a per-hopper field anywhere - no packingFactor on the data model, no third wrench field. TEMP_RESIN_PACKING_FACTOR is a single fixed placeholder standing in for every resin until the resin database has its own per-resin value. (The Tools > Hopper Weight Calculator's own unrelated hopperPackingFactor field is untouched - checked separately, scoped to Smart Hoppers' own code only.)", () => {
  assert.match(app, /const TEMP_RESIN_PACKING_FACTOR = 0\.634;/);
  assert.doesNotMatch(app, /packingFactor/, "no camelCase packingFactor field anywhere (case-sensitive - distinct from the Tools calculator's own hopperPackingFactor id)");
  const ensureBody = functionBody("ensureLayers");
  assert.doesNotMatch(ensureBody, /packing/i);
  const applyStart = app.indexOf("function applyPayload(");
  const applyBody = app.slice(applyStart, app.indexOf("\n    function ", applyStart + 1));
  assert.doesNotMatch(applyBody, /packing/i);

  const weightsAreaStart = app.indexOf("function renderWeightsArea(");
  const weightsAreaBody = app.slice(weightsAreaStart, app.indexOf("\n    function printRecipeSheet", weightsAreaStart));
  assert.doesNotMatch(weightsAreaBody, /packingInput/, "no third wrench field - the Tools calculator's own packingInput lives in a different function entirely");
});

test("the wrench popover has exactly two fields (usable height, circumference) - no packing factor field", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /panel\.append\(heightLabel, circLabel\);/);
});

test("the computed-weight element is appended after .weightsCellRow, not before - it must sit visually below the weight field", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  const cellRowAppend = body.indexOf("td.appendChild(cellRow);");
  const computedAppend = body.indexOf("if (computedWeight) td.appendChild(computedWeight);");
  assert.notEqual(cellRowAppend, -1);
  assert.notEqual(computedAppend, -1);
  assert.ok(cellRowAppend < computedAppend, "cellRow must be appended to the <td> before computedWeight");
});

test("the computed-weight element starts hidden and is only ever built when Smart Hoppers is enabled, same gating as the wrench", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  const ifStart = body.indexOf("if (state.smartHoppersEnabled){");
  const ifEnd = body.indexOf("\n          }", ifStart);
  const ifBlock = body.slice(ifStart, ifEnd);
  assert.match(ifBlock, /computedWeight = document\.createElement\("div"\);/);
  assert.match(ifBlock, /computedWeight\.id = computedWeightId\(L\.name, hi\);/);
  assert.match(ifBlock, /computedWeight\.className = "weightsComputedWeight";/);
  assert.match(ifBlock, /computedWeight\.hidden = true;/);
});

test("the Recipe Setup matrix gets a small \"SMART\" badge next to the tracking clock, for every hopper (unlike the wrench, it's not gated on Smart Hoppers being on - it just stays hidden)", () => {
  const start = app.indexOf('trackButton.appendChild(clockIcon);');
  const body = app.slice(start, app.indexOf("cellHeader.append(", start) + 200);
  assert.match(body, /const smartBadge = document\.createElement\("span"\);/);
  assert.match(body, /smartBadge\.id = smartBadgeId\(L\.name, hi\);/);
  assert.match(body, /smartBadge\.className = "splitSmartBadge";/);
  assert.match(body, /smartBadge\.textContent = "SMART";/);
  assert.match(body, /smartBadge\.hidden = true;/);
  assert.match(body, /cellHeader\.append\(trackControl, smartBadge, clearButton\);/);
});

test("refreshSmartHopperState looks up the hopper's assigned resin via the same resinLookup/resinCatalogRecords the rest of the app already uses, computes via the shared calculators module (estimateBulkDensity -> calculateHopperWeight) using the temporary fixed packing factor, and updates both the weights-grid readout and the Recipe Setup badge from one pass - no duplicated formula or lookup logic", () => {
  const body = functionBody("refreshSmartHopperState");
  assert.match(body, /resinLookup\?\.findExactResin\?\.\(hopper\.resinName, resinCatalogRecords\)/);
  assert.match(body, /calculators\.estimateBulkDensity\(density, TEMP_RESIN_PACKING_FACTOR\)/);
  assert.match(body, /const value = calculators\.calculateHopperWeight\(circVal, heightVal, bulkDensity\);/);
  assert.match(body, /const computedEl = document\.getElementById\(computedWeightId\(L\.name, hi\)\);/);
  assert.match(body, /const badgeEl = document\.getElementById\(smartBadgeId\(L\.name, hi\)\);/);
  assert.match(body, /if \(badgeEl\) badgeEl\.hidden = computed === null;/);
});

test("a computed weight (and therefore the SMART badge) requires Smart Hoppers to be enabled AND all three: usable height and circumference (both > 0) and a known resin density - missing any one falls back to hiding both, not a fake/zero value", () => {
  const body = functionBody("refreshSmartHopperState");
  assert.match(body, /const resin = \(state\.smartHoppersEnabled && heightVal > 0 && circVal > 0 && hopper\.resinName\)/);
  assert.match(body, /if \(computed !== null\)\{/);
  assert.match(body, /computedEl\.hidden = false;/);
  assert.match(body, /computedEl\.hidden = true;/);
});

test("refreshSmartHopperState runs after the initial render (so values are correct on first paint) and again from validateAndCompute (so it stays correct after any edit anywhere - the wrench popover, or a resin change in Recipe Setup) - never from a full re-render, which would close an open popover mid-edit", () => {
  const renderStart = app.indexOf("function renderWeightsArea(");
  const renderBody = app.slice(renderStart, app.indexOf("\n    function refreshSmartHopperState", renderStart));
  assert.match(renderBody, /refreshSmartHopperState\(\);\s*\n\s*\}/);

  const vacStart = app.indexOf("function validateAndCompute(");
  const vacBody = app.slice(vacStart, app.indexOf("\n    function renderResultsFlat", vacStart));
  assert.match(vacBody, /refreshSmartHopperState\(\);/);
});

test("the SMART badge is small, green, and reuses the semantic --ok token rather than a new color", () => {
  const ruleStart = styles.indexOf(".splitSmartBadge{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /color: var\(--ok\);/);
  assert.match(rule, /font-size: 9px;/);
});
