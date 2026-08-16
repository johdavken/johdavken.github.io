"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");

// New "Hopper Volume Weight" tool: same Tools workflow as the existing
// "Hopper Weight" calculator, but for non-cylindrical hoppers where the
// operator already knows usable volume (gallons) rather than
// circumference/height. Built by reusing calculators.js and the existing
// validation patterns rather than duplicating the calculation logic.

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const nextFn = app.indexOf("\n  function ", start + 1);
  const nextLet = app.indexOf("\n  let ", start + 1);
  const candidates = [nextFn, nextLet].filter(index => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : app.length;
  return app.slice(start, end);
}

function sectionBody(id){
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `Expected element with id="${id}"`);
  const sectionStart = html.lastIndexOf("<section", start);
  const sectionEnd = html.indexOf("</section>", sectionStart);
  return html.slice(sectionStart, sectionEnd);
}

test("Tools menu lists Hopper Volume Weight next to Hopper Weight with the same hopper icon and distinguishing subtitles", () => {
  const hopperWeightTileStart = html.indexOf('data-mobile-tool-target="hopperWeightTool"');
  const hopperWeightTileEnd = html.indexOf("</button>", hopperWeightTileStart);
  const hopperWeightTile = html.slice(hopperWeightTileStart, hopperWeightTileEnd);
  assert.match(hopperWeightTile, /<small>For cylindrical hoppers<\/small>/);

  const volumeTileStart = html.indexOf('data-mobile-tool-target="hopperVolumeWeightTool"');
  assert.notEqual(volumeTileStart, -1, "expected a Hopper Volume Weight mobile tool tile");
  const volumeTileEnd = html.indexOf("</button>", volumeTileStart);
  const volumeTile = html.slice(volumeTileStart, volumeTileEnd);
  assert.match(volumeTile, /<span>Hopper Volume Weight<\/span>/);
  assert.match(volumeTile, /<small>For non-cylindrical hoppers<\/small>/);

  const hopperWeightIconPath = hopperWeightTile.match(/<svg[^>]*>.*?<\/svg>/s)[0];
  const volumeIconPath = volumeTile.match(/<svg[^>]*>.*?<\/svg>/s)[0];
  assert.equal(volumeIconPath, hopperWeightIconPath, "should reuse the same hopper icon as Hopper Weight");
});

test("a Hopper Volume Weight tab exists in the desktop tools nav, immediately after Hopper Weight", () => {
  const navStart = html.indexOf('<nav class="toolsIndex"');
  const navEnd = html.indexOf("</nav>", navStart);
  const nav = html.slice(navStart, navEnd);
  assert.match(nav, /id="hopperWeightToolTab"[^]*id="hopperVolumeWeightToolTab"/, "Hopper Volume Weight tab should follow Hopper Weight");
  assert.match(nav, /id="hopperVolumeWeightToolTab"[^>]*aria-controls="hopperVolumeWeightTool"[^>]*data-tool-target="hopperVolumeWeightTool"/);
});

test("the Hopper Volume Weight panel matches the Hopper Weight panel's layout: intro text, field order, and result panel", () => {
  const section = sectionBody("hopperVolumeWeightTool");
  assert.match(section, /class="toolPanel toolWorkspacePanel"/);
  assert.match(section, /Estimates usable resin weight from known hopper volume\./);

  const gallonsIndex = section.indexOf('id="hopperVolumeGallons"');
  const bulkIndex = section.indexOf('id="hopperVolumeBulkDensity"');
  const polymerIndex = section.indexOf('id="hopperVolumePolymerDensity"');
  const packingIndex = section.indexOf('id="hopperVolumePackingFactor"');
  assert.notEqual(gallonsIndex, -1);
  assert.notEqual(bulkIndex, -1);
  assert.notEqual(polymerIndex, -1);
  assert.notEqual(packingIndex, -1);
  assert.ok(gallonsIndex < bulkIndex && bulkIndex < polymerIndex && polymerIndex < packingIndex,
    "fields must appear in the order: volume, bulk density, polymer density, packing factor");

  assert.match(section, /<label for="hopperVolumeGallons">Hopper volume \(gal\)<\/label>/);
  assert.match(section, /<label for="hopperVolumeBulkDensity">Resin bulk density \(lb\/ft³\)<\/label>/);
  assert.match(section, /<label for="hopperVolumePolymerDensity">Polymer density \(g\/cm³\)<\/label>/);
  assert.match(section, /<label for="hopperVolumePackingFactor">Packing factor<\/label>/);

  assert.match(section, /<input id="hopperVolumePackingFactor" type="text" inputmode="decimal" value="0\.63" \/>/);
  assert.match(section, /Adjustable from 0\.58 to 0\.68 for different pellet shapes\./);
  assert.match(section, /A directly entered bulk density takes priority over the polymer-density estimate\./);

  assert.match(section, /<div class="toolResult mt10" aria-live="polite">/);
  assert.match(section, /<strong id="hopperVolumeWeightResult" class="mono">—<\/strong>/);
  assert.match(section, /<span id="hopperVolumeWeightMessage" class="muted">Enter hopper volume and either density value\.<\/span>/);
});

test("updateHopperVolumeWeightCalculator reuses calculators.js and validation.js instead of duplicating logic", () => {
  const body = functionBody("updateHopperVolumeWeightCalculator");
  assert.match(body, /validation\.validateNumber\(volumeInput\.value, \{ min: 0, label: "Hopper volume" \}\)/);
  assert.match(body, /calculators\.estimateBulkDensity\(polymerResult\.value, packingResult\.value, 62\.428\)/,
    "polymer-density estimate must use the 62.428 g/cm3-to-lb/ft3 constant specified for this tool");
  assert.match(body, /calculators\.calculateHopperVolumeWeight\(volumeResult\.value, bulkDensity\)/);
});

test("a directly entered bulk density takes priority over the polymer-density estimate", () => {
  const body = functionBody("updateHopperVolumeWeightCalculator");
  const directBranch = body.indexOf("useDirectBulkDensity");
  const polymerBranch = body.indexOf("calculators.estimateBulkDensity", directBranch);
  const directBulkUse = body.indexOf("bulkDensity = result.value;", directBranch);
  assert.ok(directBulkUse !== -1 && directBulkUse < polymerBranch,
    "the direct bulk-density branch must be evaluated and used before falling back to the polymer-density estimate");
  assert.match(body, /if \(useDirectBulkDensity\)\{/);
});

test("missing volume or density inputs show a neutral instruction instead of calculating", () => {
  const body = functionBody("updateHopperVolumeWeightCalculator");
  assert.match(body, /if \(volumeInput\.value\.trim\(\) === ""\)\{[^]*?"Enter hopper volume and either density value\."/);
  assert.match(body, /if \(polymerInput\.value\.trim\(\) === ""\)\{[^]*?"Enter resin bulk density or polymer density\."/);
});

test("invalid volume, bulk density, and polymer density inputs are rejected without calculating", () => {
  const body = functionBody("updateHopperVolumeWeightCalculator");
  assert.match(body, /const volumeResult = validation\.validateNumber\(volumeInput\.value, \{ min: 0, label: "Hopper volume" \}\);/);
  assert.match(body, /if \(!volumeResult\.valid\)\{/);
  assert.match(body, /"Hopper volume must be greater than 0\."/);
  assert.match(body, /"Resin bulk density must be greater than 0\."/);
  assert.match(body, /"Polymer density must be greater than 0\."/);
  assert.match(body, /min: 0\.58, max: 0\.68, label: "Packing factor"/);
});

test("input listeners are wired for all four Hopper Volume Weight fields", () => {
  assert.match(app, /"hopperVolumeGallons",\s*"hopperVolumeBulkDensity",\s*"hopperVolumePolymerDensity",\s*"hopperVolumePackingFactor"\s*\]\.forEach\(id=>\$\(id\)\?\.addEventListener\("input", updateHopperVolumeWeightCalculator\)\);/);
});

test("the existing Hopper Weight calculator's ids, formula wiring, and validation are unchanged", () => {
  const section = sectionBody("hopperWeightTool");
  assert.match(section, /Estimates usable resin weight from cylindrical hopper dimensions\./);
  assert.match(section, /<label for="hopperCircumference">Hopper circumference \(in\)<\/label>/);
  assert.match(section, /<label for="hopperUsableHeight">Hopper usable height \(in\)<\/label>/);
  assert.match(section, /<label for="hopperBulkDensity">Resin bulk density \(lb\/ft³\)<\/label>/);
  assert.match(section, /<label for="hopperPolymerDensity">Polymer density \(g\/cm³\)<\/label>/);
  assert.match(section, /<label for="hopperPackingFactor">Packing factor<\/label>/);
  assert.match(section, /<strong id="hopperWeightResult" class="mono">—<\/strong>/);

  const body = functionBody("updateHopperWeightCalculator");
  assert.match(body, /calculators\.calculateHopperWeight\(dimensions\[0\], dimensions\[1\], bulkDensity\)/);
  assert.match(body, /calculators\.estimateBulkDensity\(polymerResult\.value, packingResult\.value\)/,
    "Hopper Weight must keep calling estimateBulkDensity with its original two-argument default (62.43 constant)");
  assert.doesNotMatch(body, /62\.428/, "Hopper Weight's estimate must not pick up the new tool's conversion constant");
});
