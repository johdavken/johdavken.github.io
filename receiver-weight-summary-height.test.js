"use strict";

// Regression coverage for: applying a usable-height change through Bulk
// Edit updated calculated weight live but left the Summary view's height
// readout stale until Smart Hoppers was toggled off/on. Root cause: the
// Summary weight span is refreshed by id from refreshSmartHopperState (the
// shared render path validateAndCompute already calls after every
// state-mutating action, including bulk apply) - but the Summary height
// span had no id at all, and was only ever updated by a fragile positional
// selector (`.desktopWeightSummaryValues b:nth-child(2) > span`, or
// `visualReadout.querySelectorAll("b")[1]` on mobile) wired into the
// individual per-cell Edit-field handlers alone. Bulk Edit's apply loop
// never touched that selector, so it wrote the new height to canonical
// state and to the Edit-view input, but never to the Summary span.
//
// Fix: give both Summary height elements stable ids (desktopSummaryHeightId/
// mobileSummaryHeightId, mirroring the existing desktopSummaryWeightId/
// mobileSummaryWeightId), and have refreshSmartHopperState refresh them
// from the same canonical hopper.usableHeight weight already reads from -
// so every write path (individual edit, wrench popover, bulk apply)
// converges on one shared, id-based update instead of each maintaining its
// own positional DOM poke.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

/* ----------------------------------------------------------------------
 *   Canonical id helpers exist, mirroring the weight ones exactly
 * -------------------------------------------------------------------- */

test("Summary height elements have stable ids, mirroring the existing weight ids", () => {
  assert.match(app, /function mobileSummaryHeightId\(layerName, hi\)\{ return `msh_\$\{layerName\}_\$\{hi\}`; \}/);
  assert.match(app, /function desktopSummaryHeightId\(layerName, hi\)\{ return `dsh_\$\{layerName\}_\$\{hi\}`; \}/);
});

test("both Summary height <b> elements are rendered with those ids", () => {
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile, /<b id="\$\{mobileSummaryHeightId\(L\.name, hi\)\}"><span>\$\{clampNum\(hopper\.usableHeight\)\}<\/span><small>in<\/small><\/b>/);

  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /<b id="\$\{desktopSummaryHeightId\(L\.name, hi\)\}"><span>\$\{clampNum\(L\.hoppers\[hi\]\.usableHeight\)\}<\/span><small>in<\/small><\/b>/);
});

/* ----------------------------------------------------------------------
 *   1. Smart enabled + Summary view + bulk height change
 * -------------------------------------------------------------------- */

test("bulk apply writes usable height to canonical state on both platforms (or usable gallons in volume mode)", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /if \(heightResult\.value !== null\)\{\s*\n\s*if \(geometryMode === "volume"\) ref\.layer\.hoppers\[ref\.hi\]\.usableGallons = heightResult\.value;\s*\n\s*else ref\.layer\.hoppers\[ref\.hi\]\.usableHeight = heightResult\.value;/);

  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile, /if \(heightResult\.value !== null && ref\.heightInput\)\{\s*\n\s*if \(geometryMode === "volume"\) ref\.hopper\.usableGallons = heightResult\.value;\s*\n\s*else ref\.hopper\.usableHeight = heightResult\.value;/);
});

test("bulk apply calls validateAndCompute, which refreshes the Summary height display by id from canonical state", () => {
  // This is the fix: the existing bulk-apply render path (validateAndCompute)
  // already ran refreshSmartHopperState for weight; extending that same
  // function to also cover height means bulk apply needs no new render call
  // of its own - the Summary height comes along for free.
  const desktop = functionBody("renderWeightsArea");
  const desktopApply = desktop.slice(desktop.indexOf("applyButton.addEventListener"), desktop.indexOf("updateSelectionUI();\n\n      hookToggle"));
  assert.match(desktopApply, /validateAndCompute\(\{ sync: true \}\);/);

  const mobile = functionBody("renderMobileWeightsArea");
  const mobileApply = mobile.slice(mobile.indexOf("applyButton.addEventListener"));
  assert.match(mobileApply, /validateAndCompute\(\{ sync:true \}\);/);

  const refresh = functionBody("refreshSmartHopperState");
  assert.match(refresh, /const geometryVal = geometryMode === "volume" \? clampNum\(hopper\.usableGallons\) : clampNum\(hopper\.usableHeight\);/);
  assert.match(refresh, /const mobileSummaryHeight=document\.getElementById\(mobileSummaryHeightId\(L\.name, hi\)\);\s*\n\s*if\(mobileSummaryHeight\) mobileSummaryHeight\.querySelector\("span"\)\.textContent=String\(geometryVal\);/);
  assert.match(refresh, /const desktopSummaryHeight=document\.getElementById\(desktopSummaryHeightId\(L\.name, hi\)\);\s*\n\s*if\(desktopSummaryHeight\) desktopSummaryHeight\.querySelector\("span"\)\.textContent=String\(geometryVal\);/);

  const validateAndCompute = functionBody("validateAndCompute");
  assert.match(validateAndCompute, /refreshSmartHopperState\(\);/);
});

test("calculated weight continues to update through the same unmodified weight refresh block", () => {
  const refresh = functionBody("refreshSmartHopperState");
  assert.match(refresh, /const desktopSummaryWeight=document\.getElementById\(desktopSummaryWeightId\(L\.name, hi\)\);/);
  assert.match(refresh, /const value=smart \? Math\.round\(smart\.value\) : clampNum\(hopper\.weight\);/);
});

/* ----------------------------------------------------------------------
 *   2 & 3. Multiple selected hoppers update; unselected hoppers untouched
 * -------------------------------------------------------------------- */

test("bulk apply only mutates state for hoppers in the selected set, on both platforms", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /selected\.forEach\(key=>\{\s*\n\s*const ref = cellRefs\.get\(key\);/);

  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile, /selected\.forEach\(key=>\{\s*\n\s*const ref = cellRefs\.get\(key\);/);
});

test("refreshSmartHopperState iterates every hopper unconditionally, so any number of updated cells converge in one pass - no per-cell targeting to get wrong", () => {
  const refresh = functionBody("refreshSmartHopperState");
  assert.match(refresh, /state\.layers\.forEach\(L=>\{\s*\n\s*L\.hoppers\.forEach\(\(hopper, hi\)=>\{/);
  // Each hopper's own id-qualified lookup - a hopper whose height didn't
  // change is refreshed from its own unchanged canonical value, a no-op in
  // effect, never touching a different hopper's element.
  assert.match(refresh, /document\.getElementById\(desktopSummaryHeightId\(L\.name, hi\)\)/);
});

/* ----------------------------------------------------------------------
 *   4. Summary -> Edit -> Summary retains the new height without refresh
 * -------------------------------------------------------------------- */

test("view switching only toggles a CSS-driven view attribute - it never re-renders or re-reads stale markup", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /function setDesktopWeightView\(mode\)\{\s*\n\s*desktopWeightView = mode === "edit" \? "edit" : "summary";/);
  const setDesktopWeightViewBody = desktop.slice(
    desktop.indexOf("function setDesktopWeightView"),
    desktop.indexOf("\n      }", desktop.indexOf("function setDesktopWeightView"))
  );
  assert.match(setDesktopWeightViewBody, /area\.dataset\.desktopWeightView = desktopWeightView;/);
  assert.doesNotMatch(setDesktopWeightViewBody, /innerHTML|renderWeightsArea\(\)/);

  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile, /function setMobileWeightView\(mode\)\{\s*\n\s*visualMode = mode === "visual";\s*\n\s*area\.dataset\.mobileWeightView = visualMode \? "visual" : "edit";/);
});

/* ----------------------------------------------------------------------
 *   5. Individual Edit height changes still update Summary correctly
 * -------------------------------------------------------------------- */

test("the individual desktop Edit height field no longer pokes a fragile positional selector - it relies on the shared id-based refresh", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.doesNotMatch(desktop, /b:nth-child\(2\)/);
  assert.match(desktop, /visualHeightInput\?\.addEventListener\("input", event=>\{[\s\S]*?L\.hoppers\[hi\]\.usableHeight = value;\s*\n\s*\}\);\s*\n\s*if \(!accepted\) return;\s*\n\s*validateAndCompute\(\{ sync:true \}\); saveSession\(\);/);
});

test("the individual mobile Edit height field no longer pokes a fragile positional selector either", () => {
  const mobile = functionBody("renderMobileWeightsArea");
  assert.doesNotMatch(mobile, /querySelectorAll\("b"\)\[1\]/);
  assert.match(mobile, /heightInput = makeValueField\("H", hopper\.usableHeight, `\$\{hopperBadgeLabel\(L\.name, hi\)\} usable height in inches`, value=>\{ hopper\.usableHeight = value; \}\);/);
});

test("the desktop wrench-popover height field also converges on the shared refresh (previously stale in Summary too)", () => {
  const desktop = functionBody("renderWeightsArea");
  const wrench = desktop.slice(desktop.indexOf('heightInput.id = `gh_'), desktop.indexOf("heightInput.addEventListener") + 600);
  assert.match(wrench, /if \(isVolume\) L\.hoppers\[hi\]\.usableGallons = value;\s*\n\s*else L\.hoppers\[hi\]\.usableHeight = value;\s*\n\s*if \(visualHeightInput\) visualHeightInput\.value = value;/);
  assert.match(wrench, /validateAndCompute\(\{ sync: true \}\);/);
});

/* ----------------------------------------------------------------------
 *   6. Bulk weight-only changes continue updating Summary and Edit
 * -------------------------------------------------------------------- */

test("a weight-only bulk apply (height field left blank) still updates weight in both views and never touches height", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /if \(result\.value !== null\)\{ ref\.layer\.hoppers\[ref\.hi\]\.weight = result\.value; ref\.input\.value = String\(result\.value\); ref\.visualWeightInput\.value = String\(result\.value\); \}/);

  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile, /if \(weightResult\.value !== null\)\{\s*\n\s*ref\.hopper\.weight = weightResult\.value;\s*\n\s*ref\.weightInput\.value = String\(weightResult\.value\);\s*\n\s*\}/);
});

/* ----------------------------------------------------------------------
 *   7. No change / invalid / blank / zero-height semantics preserved
 * -------------------------------------------------------------------- */

test("Bulk Edit's optional-field validation and 'enter a weight or height' guard are untouched", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /const optionalValue = \(field, label\)=>\{\s*\n\s*if \(!field \|\| !field\.value\.trim\(\)\) return \{ valid:true, value:null \};/);
  assert.match(desktop, /if \(result\.value === null && heightResult\.value === null\)\{ status\.textContent = "Enter a weight or height to apply"; return; \}/);

  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile, /const readOptional = \(input, label\)=>\{\s*\n\s*if \(!input \|\| !input\.value\.trim\(\)\) return \{ valid:true, value:null \};/);
  assert.match(mobile, /if \(weightResult\.value === null && heightResult\.value === null\)\{\s*\n\s*selectionStatus\.textContent = "Enter a weight or height to apply";/);
});

test("min:0 validation on the bulk height field is unchanged, so zero remains a valid explicit height", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /const heightResult = optionalValue\(bulkHeightInput, "Bulk height"\);/);
  const optionalValueBody = desktop.slice(desktop.indexOf("const optionalValue = "), desktop.indexOf("const result = optionalValue"));
  assert.match(optionalValueBody, /validation\.validateNumber\(field\.value, \{ min:0, label \}\)/);
});

test("the height refresh formats with the same clampNum(...) rounding the render template already used - no new rounding scheme introduced", () => {
  const refresh = functionBody("refreshSmartHopperState");
  assert.match(refresh, /const geometryVal = geometryMode === "volume" \? clampNum\(hopper\.usableGallons\) : clampNum\(hopper\.usableHeight\);/);
  assert.match(refresh, /String\(geometryVal\)/);
  // Not Math.round or any other formatter - geometry was never rounded like
  // Smart-computed weight is, and that stays true after the fix.
  assert.doesNotMatch(refresh.slice(refresh.indexOf("mobileSummaryHeight"), refresh.indexOf("computedEl")), /Math\.round/);
});

/* ----------------------------------------------------------------------
 *   8. Loading a receiver-weight/geometry profile
 * -------------------------------------------------------------------- */

test("loading a shared receiver weight profile already fully re-renders the weights area, so Summary height is fresh from canonical state - no separate fix needed there", () => {
  const start = app.indexOf("function applyWorkspaceConfiguration(");
  const body = app.slice(start, app.indexOf("\n  }", start));
  assert.match(body, /window\.PolynWorkspaceConfigurationPayloads\?\.applyReceiverWeightProfile/);
  assert.match(body, /renderWeightsArea\(\); renderSplitsArea\(\); validateAndCompute\(\); saveSession\(\);/);
});

test("the receiver weight profile payload includes usable height, and applying it writes straight to canonical state", () => {
  const payloads = fs.readFileSync("workspace-configuration-payloads.js", "utf8");
  assert.match(payloads, /usable_heights_in: Array\.from\(\{ length: HOPPERS_PER_LAYER \}, \(_, index\)=>layer\?\.hoppers\?\.\[index\]\?\.usableHeight \?\? 0\)/);
  const start = payloads.indexOf("function applyReceiverWeightProfile(");
  const body = payloads.slice(start, payloads.indexOf("\n  function ", start + 1));
  assert.match(body, /profileLayer\.usable_heights_in\.forEach\(\(value, hopperIndex\)=>\{ state\.layers\[layerIndex\]\.hoppers\[hopperIndex\]\.usableHeight = value; \}\);/);
});

/* ----------------------------------------------------------------------
 *   No duplicate persistence / mutation / rerender introduced by the fix
 * -------------------------------------------------------------------- */

test("refreshSmartHopperState performs no persistence, no RT Sync mutation, and no recursive validateAndCompute call", () => {
  const refresh = functionBody("refreshSmartHopperState");
  assert.doesNotMatch(refresh, /saveSession\(\)/);
  assert.doesNotMatch(refresh, /notifyActiveJobMutation/);
  assert.doesNotMatch(refresh, /validateAndCompute\(/);
});

test("refreshSmartHopperState never rebuilds DOM (no innerHTML/renderWeightsArea/appendChild) - only targeted text/attribute writes", () => {
  const refresh = functionBody("refreshSmartHopperState");
  assert.doesNotMatch(refresh, /innerHTML|renderWeightsArea\(\)|renderMobileWeightsArea\(|appendChild|replaceChildren/);
});

test("bulk apply still issues exactly one saveSession and one validateAndCompute call per apply, on both platforms", () => {
  const desktop = functionBody("renderWeightsArea");
  const desktopApply = desktop.slice(desktop.indexOf("applyButton.addEventListener"), desktop.indexOf("updateSelectionUI();\n\n      hookToggle"));
  assert.equal((desktopApply.match(/validateAndCompute\(/g) || []).length, 1);
  assert.equal((desktopApply.match(/saveSession\(\)/g) || []).length, 1);

  const mobile = functionBody("renderMobileWeightsArea");
  const mobileApply = mobile.slice(mobile.indexOf("applyButton.addEventListener"));
  assert.equal((mobileApply.match(/validateAndCompute\(/g) || []).length, 1);
  assert.equal((mobileApply.match(/saveSession\(\)/g) || []).length, 1);
});
