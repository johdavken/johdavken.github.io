"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
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
// field: it's a trait of the resin (like density), not the hopper.
// Also: a small green "SMART" badge next to the tracking clock in
// Recipe Setup, shown under the exact same condition, so an operator
// looking at the recipe (not the weights grid) can still see at a glance
// that a hopper's weight is being computed rather than manually entered.
// Stage 3: the computed number now actually drives the run-down formula.
// smartHopperComputation(hopper) is the single source of truth for "is this
// hopper's weight computable, and what is it" - both refreshSmartHopperState
// (display) and effectiveHopperWeight (the value validateAndCompute's
// run-down math, and its "weights not set"/"missing weight" warnings, all
// use in place of the old bare hopper.weight) read from it, so there's
// exactly one computation, never two that could drift apart.
// Stage 4: after testing several real resins, packing factor turned out to
// be too much of a guessing game to estimate bulk density from polymer
// density automatically. Smart Hoppers now requires the resin's own
// directly-measured bulk_density_lb_ft3 (from the resin database) and
// never estimates it - a resin without a measured bulk density simply
// isn't computable, and the hopper falls back to the operator's entered
// weight, same as any other missing-data case.

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

test("ensureLayers gives every hopper usableHeight/circumference/usableGallons fields, preserving existing values and defaulting new ones to 0", () => {
  const body = functionBody("ensureLayers");
  assert.match(body, /usableHeight: clampNum\(h\.usableHeight\)/);
  assert.match(body, /circumference: clampNum\(h\.circumference\)/);
  assert.match(body, /usableGallons: clampNum\(h\.usableGallons\)/);
  assert.match(body, /usableHeight: 0,\s*\n\s*circumference: 0,\s*\n\s*usableGallons: 0/);
});

test("applyPayload's hopper reconstruction (local session load) also carries usableHeight/circumference/usableGallons through", () => {
  const start = app.indexOf("function applyPayload(");
  const body = app.slice(start, app.indexOf("\n    function ", start + 1));
  assert.match(body, /usableHeight: clampNum\(fh\.usableHeight\)/);
  assert.match(body, /circumference: clampNum\(fh\.circumference\)/);
  assert.match(body, /usableGallons: clampNum\(fh\.usableGallons\)/);
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
  // Lives in applyLineTypeChange since the automatic RT Sync layer
  // enforcement started sharing the same transition.
  const start = app.indexOf("function applyLineTypeChange(");
  const body = app.slice(start, app.indexOf("\n  }", start));
  assert.match(body, /clampNum\(hopper\.usableHeight\) > 0 \|\| clampNum\(hopper\.circumference\) > 0 \|\| clampNum\(hopper\.usableGallons\) > 0/);
});

test("hasMeaningfulActiveJob (active-job.js) also treats usableHeight/circumference/usableGallons as meaningful data", () => {
  const activeJob = fs.readFileSync("active-job.js", "utf8");
  const start = activeJob.indexOf("function hasMeaningfulActiveJob(");
  const body = activeJob.slice(start, activeJob.indexOf("\n  }", start));
  assert.match(body, /Number\(hopper\?\.usableHeight\) > 0 \|\| Number\(hopper\?\.circumference\) > 0 \|\| Number\(hopper\?\.usableGallons\) > 0/);
});

test("hopper rearrangement only ever moves resinName/pct - height/circumference (like weight/track/pumpOff) are never part of the moved assignment and stay attached to the physical hopper", () => {
  assert.match(rearrangement, /const assignment=h=>\(\{resinName:.*?,pct:.*?\}\);/);
  assert.doesNotMatch(rearrangement, /usableHeight/);
  assert.doesNotMatch(rearrangement, /circumference/);
});

test("desktop keeps the matrix corner compact and places the Smart Hoppers switch with the configuration controls above the grid", () => {
  const start = app.indexOf('corner.className = "weightsRowCorner";');
  const body = app.slice(start, app.indexOf("headerRow.appendChild(corner);", start));
  assert.doesNotMatch(body, /corner\.textContent = "Select row"/);
  // Transposed, the first column names layers and the header row names
  // hopper positions, so the corner label follows the column under it.
  assert.match(body, /corner\.textContent = "Layer"/);

  const renderStart = app.indexOf("function renderWeightsArea(");
  const renderBody = app.slice(renderStart, app.indexOf("\n    function printRecipeSheet", renderStart));
  assert.match(renderBody, /desktopControls\.className = "desktopWeightsControls"/);
  assert.match(renderBody, /id="smartHoppersToggle" class="toggle" role="switch" tabindex="0" title="Smart Hoppers:/);
});

test("the toggle is wired through the shared hookToggle helper (same as the other Setup switches), re-wired on every render since the corner cell is rebuilt each time", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /hookToggle\(\s*\n\s*"smartHoppersToggle",\s*\n\s*\(\)=> !!state\.smartHoppersEnabled,\s*\n\s*\(v\)=>\{ state\.smartHoppersEnabled = !!v; renderWeightsArea\(\); \}\s*\n\s*\);/);
});

test("the wrench popover is only built when Smart Hoppers is enabled AND a geometry mode is identified - no dead markup left in the DOM when it's off or when no line is identified", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /if \(state\.smartHoppersEnabled && geometryMode !== null\)\{\s*\n\s*const isVolume = geometryMode === "volume";\s*\n\s*geometryPopover = document\.createElement\("details"\);/);
});

test("each wrench popover is a <details> using the same exclusive name so only one is open at a time, with an aria-labeled trigger naming the specific hopper", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /geometryPopover\.setAttribute\("name", "hopperGeometry"\);/);
  assert.match(body, /const geometryLabel = `Set \$\{hopperBadgeLabel\(L\.name, hi\)\} usable \$\{isVolume \? "volume" : "height"\}`;/);
});

test("the wrench panel has one per-hopper geometry field (usable height, or usable volume on volume-mode lines); circumference is a shared workspace setting used only in cylindrical mode", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /heightInput\.id = `gh_\$\{L\.name\}_\$\{hi\}`;/);
  assert.match(body, /if \(isVolume\) L\.hoppers\[hi\]\.usableGallons = value;\s*\n\s*else L\.hoppers\[hi\]\.usableHeight = value;/);
  assert.match(body, /id="desktopSharedCircumference"/);
  assert.match(body, /setWorkspaceHopperCircumference/);
  const heightBlock = body.slice(body.indexOf("heightInput.addEventListener"), body.indexOf("computedWeight = document.createElement"));
  assert.match(heightBlock, /validateAndCompute\(\{ sync: true \}\);/);
  assert.match(heightBlock, /saveSession\(\);/);
});

test("clicking the wrench (or anything inside its popover) does not also toggle the cell's bulk-select checkbox", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /e\.target\.closest\("\.hopperGeometryPopover"\)/);
  assert.match(body, /e\.target\.closest\("\.desktopWeightVisualReadout input"\)/);
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

test("packing factor is not a per-hopper field anywhere, and Smart Hoppers never estimates bulk density from polymer density + a packing factor - it reads the resin's own measured bulk_density_lb_ft3 directly. (The Tools > Hopper Weight Calculator's own unrelated hopperPackingFactor field is untouched - checked separately, scoped to Smart Hoppers' own code only.)", () => {
  assert.doesNotMatch(app, /TEMP_RESIN_PACKING_FACTOR/);
  assert.doesNotMatch(app, /packingFactor/, "no camelCase packingFactor field anywhere (case-sensitive - distinct from the Tools calculator's own hopperPackingFactor id)");
  const ensureBody = functionBody("ensureLayers");
  assert.doesNotMatch(ensureBody, /packing/i);
  const applyStart = app.indexOf("function applyPayload(");
  const applyBody = app.slice(applyStart, app.indexOf("\n    function ", applyStart + 1));
  assert.doesNotMatch(applyBody, /packing/i);

  const weightsAreaStart = app.indexOf("function renderWeightsArea(");
  const weightsAreaBody = app.slice(weightsAreaStart, app.indexOf("\n    function printRecipeSheet", weightsAreaStart));
  assert.doesNotMatch(weightsAreaBody, /packingInput/, "no third wrench field - the Tools calculator's own packingInput lives in a different function entirely");

  const smartBody = functionBody("smartHopperComputation");
  assert.doesNotMatch(smartBody, /estimateBulkDensity/, "no packing-factor-based estimation - bulk density must come straight from the resin");
  assert.match(smartBody, /const bulkDensity = resin\?\.bulk_density_lb_ft3;/);
});

test("the wrench popover has exactly one per-hopper field (usable height) - no circumference or packing factor field", () => {
  const start = app.indexOf("function renderWeightsArea(");
  const body = app.slice(start, app.indexOf("\n    function printRecipeSheet", start));
  assert.match(body, /panel\.append\(heightLabel\);/);
  assert.doesNotMatch(body, /circInput\.id/);
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
  const ifStart = body.indexOf("if (state.smartHoppersEnabled && geometryMode !== null){");
  const ifEnd = body.indexOf("\n          }", ifStart);
  const ifBlock = body.slice(ifStart, ifEnd);
  assert.match(ifBlock, /computedWeight = document\.createElement\("div"\);/);
  assert.match(ifBlock, /computedWeight\.id = computedWeightId\(L\.name, hi\);/);
  assert.match(ifBlock, /computedWeight\.className = "weightsComputedWeight";/);
  assert.match(ifBlock, /computedWeight\.hidden = true;/);
});

test("the Recipe Setup matrix gets a small \"SMART\" badge for every hopper (unlike the wrench, it's not gated on Smart Hoppers being on - it just stays hidden)", () => {
  const start = app.indexOf('trackButton.appendChild(clockIcon);');
  const body = app.slice(start, app.indexOf("cellHeader.append(", start) + 200);
  assert.match(body, /const smartBadge = document\.createElement\("span"\);/);
  assert.match(body, /smartBadge\.id = smartBadgeId\(L\.name, hi\);/);
  assert.match(body, /smartBadge\.className = "splitSmartBadge";/);
  assert.match(body, /smartBadge\.textContent = "SMART";/);
  assert.match(body, /smartBadge\.hidden = true;/);
  assert.match(body, /cellTop\.appendChild\(smartBadge\);/);
  assert.match(body, /cellHeader\.append\(trackControl, clearButton\);/);
  assert.match(body, /else\{\s*cellHeader\.append\(trackControl, smartBadge, clearButton\);/);
});

test("refreshSmartHopperState delegates entirely to smartHopperComputation and updates both the weights-grid readout and the Recipe Setup badge from that one result - no duplicated formula or lookup logic in this function itself", () => {
  const body = functionBody("refreshSmartHopperState");
  assert.match(body, /const smart = smartHopperComputation\(hopper\);/);
  assert.match(body, /const computedEl = document\.getElementById\(computedWeightId\(L\.name, hi\)\);/);
  assert.match(body, /const badgeEl = document\.getElementById\(smartBadgeId\(L\.name, hi\)\);/);
  assert.match(body, /if \(badgeEl\) badgeEl\.hidden = !smart;/);
});

test("a computed weight (and therefore the SMART badge) requires Smart Hoppers to be enabled AND all three: usable height and circumference (both > 0) and a known resin bulk density - missing any one falls back to hiding both, not a fake/zero value", () => {
  const body = functionBody("smartHopperComputation");
  assert.match(body, /if \(!state\.smartHoppersEnabled\) return null;/);
  assert.match(body, /if \(!\(heightVal > 0 && circVal > 0 && hopper\.resinName\)\) return null;/);
  assert.match(body, /if \(!bulkDensity\) return null;/);
  const refreshBody = functionBody("refreshSmartHopperState");
  assert.match(refreshBody, /if \(smart\)\{/);
  assert.match(refreshBody, /computedEl\.hidden = false;/);
  assert.match(refreshBody, /computedEl\.hidden = true;/);
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

test("the SMART badge is suppressed on tablet and desktop without changing Smart Hopper computation", () => {
  assert.match(styles, /@media \(min-width:701px\)\{\s*#splitsArea \.splitSmartBadge\{display:none!important\}/);
  const refresh = functionBody("refreshSmartHopperState");
  assert.match(refresh, /if \(badgeEl\) badgeEl\.hidden = !smart;/);
});

// --- Stage 3: the computed weight actually drives the run-down formula ---

test("smartHopperComputation is the one place that decides whether a hopper is smart-computable and what the value is - returns null (never a fallback number) when Smart Hoppers is off, geometry is incomplete, or the resin's bulk density is unknown", () => {
  const body = functionBody("smartHopperComputation");
  assert.match(body, /if \(!state\.smartHoppersEnabled\) return null;/);
  assert.match(body, /if \(!\(heightVal > 0 && circVal > 0 && hopper\.resinName\)\) return null;/);
  assert.match(body, /if \(!bulkDensity\) return null;/);
  assert.match(body, /if \(!Number\.isFinite\(value\) \|\| value <= 0\) return null;/);
  assert.match(body, /return \{ value, resin, bulkDensity \};/);
});

// --- Line-aware geometry mode: cylindrical vs. volume, resolved from the
// connected line via currentSmartHopperGeometryMode() (line-identity.js's
// getSmartHopperGeometryModeForSync) - never asked of the operator. See
// smart-hopper-geometry-mode.test.js for the line -> mode mapping itself.

test("currentSmartHopperGeometryMode is the one call site smartHopperComputation and refreshSmartHopperState both use to resolve geometry mode", () => {
  const helperBody = functionBody("currentSmartHopperGeometryMode");
  assert.match(helperBody, /window\.PolynLineIdentity\?\.getSmartHopperGeometryModeForSync\(lineSync\?\.getState\?\.\(\)\) \?\? null/);

  const smartBody = functionBody("smartHopperComputation");
  assert.match(smartBody, /const geometryMode = currentSmartHopperGeometryMode\(\);/);

  const refreshBody = functionBody("refreshSmartHopperState");
  assert.match(refreshBody, /const geometryMode = currentSmartHopperGeometryMode\(\);/);
});

test("smartHopperComputation's volume branch requires usable gallons and a resin bulk density, and calls calculators.calculateHopperVolumeWeight - never circumference/usable height", () => {
  const body = functionBody("smartHopperComputation");
  const volumeBranch = body.slice(body.indexOf('geometryMode === "volume"'), body.indexOf('geometryMode === "cylindrical"'));
  assert.match(volumeBranch, /const gallonsVal = clampNum\(hopper\.usableGallons\);/);
  assert.match(volumeBranch, /if \(!\(gallonsVal > 0 && hopper\.resinName\)\) return null;/);
  assert.match(volumeBranch, /if \(!bulkDensity\) return null;/);
  assert.match(volumeBranch, /calculators\.calculateHopperVolumeWeight\(gallonsVal, bulkDensity\)/);
  assert.match(volumeBranch, /if \(!Number\.isFinite\(value\) \|\| value <= 0\) return null;/);
  assert.doesNotMatch(volumeBranch, /circVal|usableHeight/);
});

test("smartHopperComputation's cylindrical branch is byte-for-byte the same formula as before this feature - only reached when geometryMode === \"cylindrical\"", () => {
  const body = functionBody("smartHopperComputation");
  const cylindricalBranch = body.slice(body.indexOf('geometryMode === "cylindrical"'));
  assert.match(cylindricalBranch, /const heightVal = clampNum\(hopper\.usableHeight\);/);
  assert.match(cylindricalBranch, /const circVal = clampNum\(state\.hopperCircumference\);/);
  assert.match(cylindricalBranch, /if \(!\(heightVal > 0 && circVal > 0 && hopper\.resinName\)\) return null;/);
  assert.match(cylindricalBranch, /calculators\.calculateHopperWeight\(circVal, heightVal, bulkDensity\)/);
});

test("smartHopperComputation returns null (not a fallback value) when Smart Hoppers is off, or when geometryMode is null (no identified line)", () => {
  const body = functionBody("smartHopperComputation");
  assert.match(body, /if \(!state\.smartHoppersEnabled\) return null;/);
  assert.match(body, /return null;\s*\n\s*\}/, "the function falls through to a final `return null;` when geometryMode matches neither branch");
});

test("refreshSmartHopperState and effectiveHopperWeight both read from smartHopperComputation - no second copy of the resin-lookup/formula logic", () => {
  const refreshBody = functionBody("refreshSmartHopperState");
  assert.match(refreshBody, /const smart = smartHopperComputation\(hopper\);/);
  assert.doesNotMatch(refreshBody, /calculators\.estimateBulkDensity/, "the formula call itself should only exist inside smartHopperComputation now");

  const effectiveBody = functionBody("effectiveHopperWeight");
  assert.match(effectiveBody, /return smartHopperComputation\(hopper\)\?\.value \?\? clampNum\(hopper\.weight\);/);
});

test("the computed-weight tooltip now says it's used for the run-down formula, since stage 3 makes that true", () => {
  const body = functionBody("refreshSmartHopperState");
  assert.match(body, /Used for the run-down formula instead of the entered weight above\./);
});

test("the computed-weight tooltip cites the resin's bulk density in lb/ft³, not polymer density in g/cm³ - stage 4 dropped the packing-factor estimate entirely", () => {
  const body = functionBody("refreshSmartHopperState");
  assert.match(body, /bulk density \(\$\{smart\.bulkDensity\} lb\/ft³\)/);
  assert.doesNotMatch(body, /g\/cm³/);
});

test("validateAndCompute's run-down math uses effectiveHopperWeight instead of the bare hopper weight, so a computed weight (when available) actually drives minutesToEmpty/timeline results, not just the display", () => {
  const start = app.indexOf("function validateAndCompute(");
  const body = app.slice(start, app.indexOf("\n    function renderResultsFlat", start));
  assert.match(body, /const weight = effectiveHopperWeight\(h\);/);
  assert.doesNotMatch(body, /const weight = clampNum\(h\.weight\);/);
});

test("the \"weights not set\" and \"missing weight\" warnings also account for smart-computed weight, not just the operator's raw entry - a hopper fully covered by Smart Hoppers shouldn't be flagged as missing", () => {
  const start = app.indexOf("function validateAndCompute(");
  const body = app.slice(start, app.indexOf("\n    function renderResultsFlat", start));
  assert.match(body, /L\.hoppers\.every\(h=>effectiveHopperWeight\(h\) === 0\)/);
  assert.match(body, /tracked\.filter\(x=>effectiveHopperWeight\(x\.h\) <= 0\)\.length/);
});

test("the computed-weight readout uses the checkmark-verified style (mockup option 9): a checkmark, and --ok green instead of the theme's own accent color, since --title reads as a warning in some themes (e.g. Light, a brick red)", () => {
  const body = functionBody("refreshSmartHopperState");
  // One compact "✓ N lb" form on every surface: the always-live wide grid's
  // cell is too narrow for a "Calculated:" label, and the mobile readout was
  // already compact. The full explanation stays on the hover title.
  assert.match(body, /computedEl\.textContent = `✓ \$\{fmtNum\(smart\.value, 1\)\} lb`;/);
  assert.doesNotMatch(body, /✓ Calculated:/);
  const ruleStart = styles.indexOf(".weightsComputedWeight{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /color: var\(--ok\);/);
  assert.doesNotMatch(rule, /color: var\(--title\);/);
});

test("the always-live wide weights grid surfaces the Smart Hoppers computed weight per cell (it has no Summary view for the green .desktopWeightSummaryWeight)", () => {
  // Was in the blanket display:none!important list beside .weightsCellRow /
  // .weightsCellSelector / .hopperGeometryPopover; pulled out so
  // refreshSmartHopperState's per-cell [hidden] toggle governs it.
  assert.match(desktop, /\.weightsCellRow,\.weightsCellSelector,\.hopperGeometryPopover\{display:none!important\}/);
  assert.doesNotMatch(desktop, /\.weightsCellRow,\.weightsCellSelector,\.hopperGeometryPopover,\.weightsComputedWeight\{display:none!important\}/);
  assert.match(desktop, /#weightsArea \.weightsComputedWeight\{[^}]*border-top:1px solid var\(--row-border-2\)[^}]*text-align:right\}/);
  // Row height reserved whenever Smart Hoppers is on, so cells with and
  // without a computed value stay aligned.
  assert.match(app, /area\.dataset\.smartHoppers = String\(state\.smartHoppersEnabled\);/);
  assert.match(desktop, /#weightsArea\[data-smart-hoppers="true"\]\[data-desktop-weight-view="edit"\] \.weightsMatrixCell\{height:84px\}/);
  // Touch-shell mirror keeps lockstep.
  assert.doesNotMatch(styles, /:has\(\.weightsLayerHeader\) \.weightsComputedWeight\{\s*display:none!important/);
  assert.match(styles, /body\[data-shell="touch"\] #weightsArea\[data-smart-hoppers="true"\] \.weightsMatrix:has\(\.weightsLayerHeader\) \.weightsMatrixCell\{\s*height:84px;/);
});
