"use strict";

// Smart Hoppers rendering (desktop + mobile) branches on the same three
// geometry modes calculation does (see smart-hopper-geometry-mode.test.js
// for the line -> mode mapping, and smart-hoppers.test.js for
// smartHopperComputation's own mode dispatch): "cylindrical" (unchanged
// behavior), "volume" (gallons, no circumference), and null (no identified
// line - Smart Hoppers is not presented as usable at all). This file covers
// the render-time branch itself, in both renderWeightsArea (desktop) and
// renderMobileWeightsArea (mobile).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

/* ----------------------------------------------------------------------
 *   null mode: no identified line - Smart Hoppers is not presented as
 *   usable, and manual weight-only cells keep working normally
 * -------------------------------------------------------------------- */

test("desktop: with no identified line, the Smart Hoppers control shows a neutral 'join a workspace' state instead of a working toggle", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /geometryMode === null\s*\n(\s*\/\/.*\n)*\s*\? '<div class="desktopWeightsSmartControl unavailable"><div><strong>Smart Hoppers<\/strong><small>Join a workspace to enable Smart Hoppers\.<\/small><\/div><\/div>'/);
});

test("mobile: with no identified line, the Smart Hoppers control shows the same neutral 'join a workspace' state", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.match(body, /if \(geometryMode === null\)\{/);
  assert.match(body, /smartControl\.classList\.add\("unavailable"\);/);
  assert.match(body, /'<strong>Smart Hoppers<\/strong><small>Join a workspace to enable Smart Hoppers\.<\/small>'/);
});

test("desktop: circumference is omitted entirely (not just hidden) when geometryMode is not cylindrical", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /const desktopCircumferenceMarkup = geometryMode === "cylindrical"/);
  assert.match(body, /circumferenceInput\?\.addEventListener/, "the listener attach must be optional-chained since the input won't exist outside cylindrical mode");
});

test("mobile: the circumference field is only built in cylindrical mode", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.match(body, /if \(state\.smartHoppersEnabled && geometryMode === "cylindrical"\)\{/);
});

test("desktop: no geometry value renders in any hopper cell when geometryMode is null - only weight in lb", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /const desktopGeometrySummaryMarkup = geometryMode === "volume"[\s\S]*?: "";/);
  assert.match(body, /const desktopGeometryEditMarkup = state\.smartHoppersEnabled && geometryMode === "volume"[\s\S]*?: "";/);
});

test("mobile: no geometry value renders in any hopper cell when geometryMode is null - only weight in lb", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.match(body, /const geometrySummaryMarkup = geometryMode === "volume"[\s\S]*?: "";/);
});

test("desktop: the wrench and computed-weight readout are both gated on geometryMode !== null, not just Smart Hoppers being enabled", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /if \(state\.smartHoppersEnabled && geometryMode !== null\)\{/);
});

test("mobile: the per-hopper Edit-view geometry field is gated on geometryMode !== null", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.doesNotMatch(body, /if \(state\.smartHoppersEnabled\)\{\s*\n\s*\/\/ Summary height/, "the old unconditional gate must be gone");
});

/* ----------------------------------------------------------------------
 *   volume mode: gallons, no circumference anywhere
 * -------------------------------------------------------------------- */

test("desktop: volume mode shows gallons in the summary readout and Edit-view field, unit 'gal'", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /<b id="\$\{desktopSummaryHeightId\(L\.name, hi\)\}"><span>\$\{clampNum\(L\.hoppers\[hi\]\.usableGallons\)\}<\/span><small>gal<\/small><\/b>/);
  assert.match(body, /<small>Volume \(gal\)<\/small>/);
});

test("mobile: volume mode shows gallons in the summary readout, unit 'gal', and a 'G' Edit-view field writing to usableGallons", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.match(body, /<b id="\$\{mobileSummaryHeightId\(L\.name, hi\)\}"><span>\$\{clampNum\(hopper\.usableGallons\)\}<\/span><small>gal<\/small><\/b>/);
  assert.match(body, /makeValueField\("G", hopper\.usableGallons, `\$\{hopperBadgeLabel\(L\.name, hi\)\} usable volume in gallons`, value=>\{ hopper\.usableGallons = value; \}\);/);
});

test("desktop: the wrench relabels to 'Usable volume (gal)' and writes usableGallons in volume mode", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /heightCaption\.textContent = isVolume \? "Usable volume \(gal\)" : "Usable height \(in\)";/);
  assert.match(body, /heightInput\.value = String\(clampNum\(isVolume \? L\.hoppers\[hi\]\.usableGallons : L\.hoppers\[hi\]\.usableHeight\)\);/);
});

test("desktop: the Edit toolbar shows 'Volume' (unit gal) in volume mode and 'Height' (unit in) in cylindrical mode, never both - matching mobile's existing short labels", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /geometryMode === "volume" \? '<label class="weightsBulkField" for="bulkHeight"><span>Volume<\/span>[\s\S]*?<span>gal<\/span>/);
  assert.match(body, /geometryMode === "cylindrical" \? '<label class="weightsBulkField" for="bulkHeight"><span>Height<\/span>[\s\S]*?<span>in<\/span>/);
});

test("mobile: the bulk-edit bar shows 'Volume' in volume mode and 'Height' in cylindrical mode, never both", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.match(body, /geometryMode === "volume" \? '<label><span>Volume<\/span>/);
  assert.match(body, /geometryMode === "cylindrical" \? '<label><span>Height<\/span>/);
});

test("desktop: bulk apply writes to usableGallons in volume mode, usableHeight otherwise", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /if \(geometryMode === "volume"\) ref\.layer\.hoppers\[ref\.hi\]\.usableGallons = heightResult\.value;\s*\n\s*else ref\.layer\.hoppers\[ref\.hi\]\.usableHeight = heightResult\.value;/);
});

test("mobile: bulk apply writes to usableGallons in volume mode, usableHeight otherwise", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.match(body, /if \(geometryMode === "volume"\) ref\.hopper\.usableGallons = heightResult\.value;\s*\n\s*else ref\.hopper\.usableHeight = heightResult\.value;/);
});

/* ----------------------------------------------------------------------
 *   cylindrical mode: unchanged behavior
 * -------------------------------------------------------------------- */

test("desktop: cylindrical mode keeps the shared circumference control, unit 'in'", () => {
  const body = functionBody("renderWeightsArea");
  assert.match(body, /<label class="desktopSharedCircumference"><span>Circumference<\/span>[\s\S]*?<span>in<\/span>/);
});

test("mobile: cylindrical mode keeps the shared circumference control, unit 'in'", () => {
  const body = functionBody("renderMobileWeightsArea");
  assert.match(body, /circumferenceLabel\.innerHTML = "<span>Circumference<\/span><small>in<\/small>";/);
});

test("both renderers resolve geometry mode exactly once per render, from the same helper", () => {
  const desktop = functionBody("renderWeightsArea");
  assert.match(desktop, /const geometryMode = currentSmartHopperGeometryMode\(\);/);
  const mobile = functionBody("renderMobileWeightsArea");
  assert.match(mobile, /const geometryMode = currentSmartHopperGeometryMode\(\);/);
});
