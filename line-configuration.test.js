"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const identity = require("./line-identity.js");
const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const scanUi = fs.readFileSync("recipe-scan-ui.js", "utf8");

/* ============================================================
 *   Layer orientation, by line
 * ============================================================ */

test("Lines 1-4 are single layer, so no orientation is reported at all", () => {
  for (const line of [1, 2, 3, 4]){
    const configuration = identity.getLineConfiguration(line);
    assert.equal(configuration.layerCount, 1, `Line ${line} should stay a 1-layer line`);
    assert.equal(configuration.singleLayer, true);
    // Not "inside" and not a default - genuinely absent, so nothing downstream
    // can present a meaningless inside/outside answer for a single-layer line.
    assert.equal(configuration.layerAPosition, null, `Line ${line} must not claim an orientation`);
    assert.equal(configuration.layerOrder, null);
  }
});

test("Lines 5-8 run Layer A on the inside", () => {
  for (const line of [5, 6, 7, 8]){
    const configuration = identity.getLineConfiguration(line);
    assert.equal(configuration.layerAPosition, "inside", `Line ${line} should put A inside`);
    assert.deepEqual(configuration.layerOrder, [
      { layer: "A", position: "inside" },
      { layer: "C", position: "outside" }
    ]);
  }
});

test("Lines 9-16 run Layer A on the outside", () => {
  for (const line of [9, 10, 11, 12, 13, 14, 15, 16]){
    assert.equal(identity.getLineConfiguration(line).layerAPosition, "outside", `Line ${line} should put A outside`);
  }
});

test("Line 9 reports A Outside / C Inside, the case the Overview is specified against", () => {
  const configuration = identity.getLineConfiguration(9);
  assert.equal(configuration.lineNumber, 9);
  assert.equal(configuration.layerCount, 5 - 2); // 3, from the existing layer-count map
  assert.deepEqual(configuration.layerOrder, [
    { layer: "A", position: "outside" },
    { layer: "C", position: "inside" }
  ]);
});

test("a 5-layer line names its own opposite end rather than assuming C", () => {
  // C is the core on a 5-layer line. Reporting "C Inside" there would be
  // wrong, so the opposite end is read from the layer names, not hard-coded.
  const configuration = identity.getLineConfiguration(10);
  assert.equal(configuration.layerCount, 5);
  assert.deepEqual(configuration.layerOrder, [
    { layer: "A", position: "outside" },
    { layer: "E", position: "inside" }
  ]);
});

test("orientation and layer count stay independent - Line 16 knows its side without an invented layer count", () => {
  const configuration = identity.getLineConfiguration(16);
  assert.equal(configuration.layerAPosition, "outside");
  // The existing LAYER_COUNT_BY_LINE map stops at 15 and was deliberately not
  // extended, so the layer count is unknown and no order can be named.
  assert.equal(configuration.layerCount, null);
  assert.equal(configuration.layerOrder, null);
});

test("an unmapped or invalid line never guesses an orientation", () => {
  for (const line of [17, 20, 99]){
    assert.equal(identity.getLineConfiguration(line).layerAPosition, null, `Line ${line} is unmapped and must stay unknown`);
  }
  for (const value of [null, undefined, 0, -3, "", "abc", {}]){
    assert.equal(identity.getLineConfiguration(value), null, `${JSON.stringify(value)} is not a line`);
  }
});

test("the sync resolver reads the linked workspace and stays null when nothing is linked", () => {
  const linked = number => ({
    selectedWorkspaceId: "w1",
    selectedWorkspace: { id: "w1", name: `Line ${number}` },
    connected: true
  });
  assert.equal(identity.getLineConfigurationForSync(linked(9)).layerAPosition, "outside");
  assert.equal(identity.getLineConfigurationForSync(linked(5)).layerAPosition, "inside");
  assert.equal(identity.getLineConfigurationForSync(null), null);
  assert.equal(identity.getLineConfigurationForSync({}), null);
  // Unlinked by the operator: still no orientation, same as the layer count.
  assert.equal(identity.getLineConfigurationForSync({
    selectedWorkspaceId: "w1",
    selectedWorkspace: { id: "w1", name: "Line 9" },
    connected: false
  }), null);
  // A workspace that is not a recognized line resolves to nothing rather than
  // to a default orientation.
  assert.equal(identity.getLineConfigurationForSync({
    selectedWorkspaceId: "w1",
    selectedWorkspace: { id: "w1", name: "Pilot line" },
    connected: true
  }), null);
});

/* ============================================================
 *   Single source of truth
 * ============================================================ */

test("the orientation rules are written down exactly once, in line-identity.js", () => {
  const source = fs.readFileSync("line-identity.js", "utf8");
  assert.match(source, /LAYER_A_POSITION_BY_LINE = Object\.freeze\(/);
  // Nobody else may re-derive a side from a line-number range.
  for (const [name, contents] of [["app.js", app], ["recipe-scan-ui.js", scanUi], ["recipe-scan-mapping.js", fs.readFileSync("recipe-scan-mapping.js", "utf8")]]){
    assert.doesNotMatch(contents, /line\w*\s*>=\s*5\s*&&/i, `${name} must not re-implement the line-range orientation rule`);
    assert.doesNotMatch(contents, /LAYER_A_POSITION_BY_LINE\s*=/, `${name} must not keep its own copy of the orientation table`);
  }
});

test("the existing layer-count map is reused, not replaced", () => {
  // getLineConfiguration must report exactly what LAYER_COUNT_BY_LINE says.
  for (const [line, count] of Object.entries(identity.LAYER_COUNT_BY_LINE)){
    assert.equal(identity.getLineConfiguration(line).layerCount, count, `Line ${line} layer count changed`);
  }
  assert.equal(identity.requiredLayerCount(9), 3, "Line 9 must still be a 3-layer line");
  assert.equal(identity.requiredLayerCount(10), 5);
  assert.equal(identity.requiredLayerCount(1), 1);
});

test("existing Line 9 hopper naming is untouched by the orientation work", () => {
  const line9 = { selectedWorkspaceId: "w9", selectedWorkspace: { id: "w9", name: "Line 9" }, connected: true };
  const line8 = { selectedWorkspaceId: "w8", selectedWorkspace: { id: "w8", name: "Line 8" }, connected: true };
  assert.equal(identity.hopperNamingMode(line9), "main");
  assert.equal(identity.hopperNamingMode(line8), "standard");
  assert.equal(identity.hopperPositionLabel(0, line9), "Main");
  assert.equal(identity.hopperBadgeLabel("A", 0, line9), "AM");
  assert.equal(identity.hopperBadgeLabel("A", 0, line8), "A1");
});

/* ============================================================
 *   Line Setup - Overview
 * ============================================================ */

function overviewMarkup(){
  const start = html.indexOf('<div class="lineOverview" id="lineOverview">');
  assert.notEqual(start, -1, "expected an Overview block in Line Setup");
  return html.slice(start, html.indexOf("</section>", start));
}

test("Overview sits below the Changeover/Output stack inside Line Setup", () => {
  const blockStart = html.indexOf('id="lineSetupBlock"');
  const block = html.slice(blockStart, html.indexOf("</section>", html.indexOf('class="lineOverview"')));
  const gauges = block.indexOf('class="setupFields setupPrimaryFields');
  const overview = block.indexOf('class="lineOverview"');
  assert.ok(gauges > -1 && overview > gauges, "Overview must come after the Changeover/Output fields");
});

test("Overview replaces the old Line configuration heading", () => {
  const panel = html.slice(html.indexOf('id="lineSetupBlock"'), html.indexOf('id="weightsBlock"'));
  assert.doesNotMatch(panel, /setupSectionHeading">Line configuration/, "the redundant section heading should be gone");
  assert.equal((panel.match(/setupSectionHeading/g) || []).length, 1, "Line Setup should carry exactly one section heading");
  assert.match(overviewMarkup(), /<h2 class="setupSectionHeading">Overview<\/h2>/);
});

test("Overview shows the line and the layer count as its prominent values", () => {
  const markup = overviewMarkup();
  assert.match(markup, /<dt>Line<\/dt>\s*<dd id="lineOverviewLine"/);
  assert.match(markup, /<dt>Layers<\/dt>\s*<dd id="lineOverviewLayers"/);
  assert.match(markup, /<span class="lineOverviewOrderLabel">Layer order<\/span>/);
  // Order rows and the single-layer note both start hidden - they are filled
  // in from the resolved configuration, never shown speculatively.
  assert.match(markup, /<div class="lineOverviewOrder" id="lineOverviewOrder" hidden>/);
  assert.match(markup, /<p class="lineOverviewNote" id="lineOverviewNote" hidden><\/p>/);
});

test("Overview is read-only - no inputs, buttons or editable controls", () => {
  const markup = overviewMarkup();
  assert.doesNotMatch(markup, /<input|<button|<select|<textarea|contenteditable/);
});

function renderer(){
  const start = app.indexOf("function renderLineOverview(");
  assert.notEqual(start, -1, "expected a renderLineOverview function");
  return app.slice(start, app.indexOf("\n  }", start));
}

test("the Overview renders from the shared line configuration, not its own lookup", () => {
  assert.match(app, /function derivedLineConfiguration\(syncState = lineSync\?\.getState\?\.\(\)\)\{\s*\n\s*return window\.PolynLineIdentity\?\.getLineConfigurationForSync\(syncState\) \|\| null;/);
  assert.match(renderer(), /derivedLineConfiguration\(syncState\)/);
});

test("the Overview shows the live layer count so an unmapped line still reads correctly", () => {
  const body = renderer();
  assert.match(body, /LINE_TYPES\.includes\(Number\(state\.lineType\)\)/);
  assert.match(body, /lineOverviewLayers/);
});

test("a single-layer line shows 'Single layer' instead of misleading inside/outside rows", () => {
  const body = renderer();
  assert.match(body, /const single = layerCount === 1;/);
  assert.match(body, /note\.textContent = single \? "Single layer" : "";/);
  // The order section is only revealed when there are real rows to show.
  assert.match(body, /if \(order\) order\.hidden = !orderRows;/);
});

test("an orientation is only shown when it belongs to the layer count on screen", () => {
  // Guards the mismatch case: a line whose rules describe 3 layers must not
  // label an A/C order onto a manually-selected 5-layer configuration.
  assert.match(renderer(), /configuration && configuration\.layerCount === layerCount\s*\n\s*\? configuration\.layerOrder\s*\n\s*: null;/);
});

test("with no line resolved the Overview shows a dash rather than assuming one", () => {
  const body = renderer();
  assert.match(body, /lineValue\.textContent = configuration \? String\(configuration\.lineNumber\) : "—";/);
});

test("the Overview re-renders on every layer-count transition and RT Sync lock pass", () => {
  const start = app.indexOf("function syncLineTypeUI(");
  const body = app.slice(start, app.indexOf("\n  }", start));
  assert.match(body, /renderLineOverview\(\);/);
  // syncLineTypeUI bails when the toggle is absent, so the Overview render
  // has to happen before that guard or it would never run on mobile.
  assert.ok(body.indexOf("renderLineOverview();") < body.indexOf('const group = $("lineTypeToggle");'));
});

test("Overview styling is a quiet readout built only from theme tokens", () => {
  const start = styles.indexOf(".lineOverview{");
  assert.notEqual(start, -1, "expected Overview styles");
  const block = styles.slice(start, styles.indexOf(".lineOverviewNote[hidden]", start));
  // No literal colors - light, dark and Gruvbox all resolve through the
  // palette they already define.
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i, "Overview must not hard-code colors");
  assert.match(block, /var\(--muted\)/);
  assert.match(block, /var\(--title\)/);
  // Read-only appearance: no field/control chrome borrowed from the inputs.
  assert.doesNotMatch(block, /--field-bg|--input-bg|--control-radius/);
});

/* ============================================================
 *   Scanners
 * ============================================================ */

function startScanBody(){
  const start = scanUi.indexOf("function startScan(");
  return scanUi.slice(start, scanUi.indexOf("\n  }", start));
}

test("Job Traveler and Heat Sheet take orientation from the line instead of prompting", () => {
  const body = startScanBody();
  assert.match(body, /const orientation = serviceApi\.getLineConfiguration\?\.\(\)\?\.layerAPosition \|\| null;/);
  assert.match(body, /pendingOrientation = orientation;/);
});

test("the bridge exposes the same configuration the Overview uses", () => {
  const start = app.indexOf("window.PolynRecipeScanBridge = {");
  const bridge = app.slice(start, app.indexOf("};", start));
  assert.match(bridge, /getLineConfiguration: \(\) => derivedLineConfiguration\(\)/);
});

test("the Dosing Screen scanner is unchanged - it still skips orientation entirely", () => {
  const body = startScanBody();
  assert.match(body, /if \(sourceType === "dosing_screen" \|\| lineType === 1\)\{ openCaptureDialog\(\); return; \}/);
  // It also still uses its own mapping function, with no orientation applied.
  assert.match(scanUi, /pendingSourceType === "dosing_screen"\s*\n\s*\? mapping\(\)\?\.buildDosingScreenRecipePayloadFromScan/);
  const mapping = fs.readFileSync("recipe-scan-mapping.js", "utf8");
  const dosing = mapping.slice(mapping.indexOf("function buildDosingScreenRecipePayloadFromScan("));
  assert.doesNotMatch(dosing, /orientation/, "the Dosing Screen mapping must stay orientation-free");
});

test("an unrecognized line falls back to asking rather than guessing a mirror", () => {
  const body = startScanBody();
  const resolved = body.indexOf("if (orientation){");
  assert.ok(body.indexOf("openOrientationDialog();") > resolved, "the prompt must sit after the resolution attempt");
  assert.match(html, /This workspace isn't a recognized line/);
});

test("the resolved orientation maps a scan onto the right layers, end to end", () => {
  const mapping = require("./recipe-scan-mapping.js");
  // The Edge Function returns layers in printed order, inside -> outside.
  const scan = () => ({
    layer_count: 3,
    layers: [1, 2, 3].map(n => ({
      layer_percentage: n === 2 ? 60 : 20,
      components: [{ resin_code: `PRINTED-${n}`, percentage: 100, hopper_designation: null }]
    }))
  });
  const build = lineNumber => {
    const configuration = identity.getLineConfiguration(lineNumber);
    const result = mapping.buildRecipePayloadFromScan(scan(), {
      lineType: 3,
      orientation: configuration.layerAPosition,
      hopperNamingMode: "standard"
    });
    assert.ok(result.ok, `Line ${lineNumber} should build a payload`);
    return result.payload.layers.map(layer => `${layer.name}=${layer.hoppers[0].resin_name}`).join(" ");
  };

  // A inside: printed order lands on A, B, C directly.
  assert.equal(build(5), "A=PRINTED-1 B=PRINTED-2 C=PRINTED-3");
  assert.equal(build(8), "A=PRINTED-1 B=PRINTED-2 C=PRINTED-3");
  // A outside: the printed order is mirrored, so A takes the last column.
  assert.equal(build(9), "A=PRINTED-3 B=PRINTED-2 C=PRINTED-1");
  assert.equal(build(12), "A=PRINTED-3 B=PRINTED-2 C=PRINTED-1");
});

test("the Edge Function is untouched - it never received an orientation to begin with", () => {
  const edge = fs.readFileSync("supabase/functions/recipe-scan/index.ts", "utf8");
  // It labels layers by printed position only; the client decides which end
  // is Layer A. Nothing about orientation is sent to or inferred by the model.
  assert.doesNotMatch(edge, /orientation/i);
  assert.match(edge, /Identify layers by COLUMN POSITION, left to right/);
});
