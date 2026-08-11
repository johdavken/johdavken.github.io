"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

test("PolynRecipeScanBridge exposes only what recipe-scan-ui.js needs - no raw client, no low-level Supabase access", () => {
  assert.match(app, /window\.PolynRecipeScanBridge = \{/);
  assert.match(app, /getWorkspaceId: \(\) => lineSync\?\.getState\?\.\(\)\.selectedWorkspaceId \|\| ""/);
  assert.match(app, /getAccessToken: \(\) => lineSync\?\.getAccessToken\?\.\(\) \|\| Promise\.resolve\(null\)/);
  assert.match(app, /getLineType: \(\) => state\.lineType/);
  assert.match(app, /getHopperNamingMode: \(\) => derivedHopperNamingMode\(\)/);
  assert.match(app, /applyPayload: applyScannedRecipePayload/);
  assert.doesNotMatch(app, /PolynRecipeScanBridge[\s\S]{0,400}createClient/i);
});

test("applyScannedRecipePayload applies whatever payload it's given via applyRecipePayload - the same pathway as loading a cloud recipe, with no scan-mapping dependency of its own", () => {
  const fnStart = app.indexOf("function applyScannedRecipePayload(");
  const fnEnd = app.indexOf("\n  function openWorkspaceConfigurationDialog", fnStart);
  assert.notEqual(fnStart, -1, "expected to find applyScannedRecipePayload");
  const body = app.slice(fnStart, fnEnd);

  assert.match(body, /window\.PolynWorkspaceConfigurationPayloads\?\.applyRecipePayload\(state, payload\)/);
  assert.match(body, /renderWeightsArea\(\); renderSplitsArea\(\); validateAndCompute\(\); saveSession\(\);/);
  assert.match(body, /notifyActiveJobMutation\(\{immediate:true,kind:"apply-recipe-scan"\}\)/);
  // Deliberately payload-in: no reference to PolynRecipeScanMapping, so a
  // review-screen edit to the payload is submitted as-is, not recomputed
  // from the raw scan and silently discarded.
  assert.doesNotMatch(body, /PolynRecipeScanMapping/);
});

test("a failed apply (e.g. layer percentages don't total 100%) returns ok:false with a message", () => {
  const fnStart = app.indexOf("function applyScannedRecipePayload(");
  const fnEnd = app.indexOf("\n  function openWorkspaceConfigurationDialog", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /if \(!result\?\.ok\) return \{ ok:false, message: result\?\.errors\?\.\[0\]/);
});

test("hasNonEmptyRecipe checks for any assigned resin name across all layers - used to decide whether to warn before overwrite", () => {
  assert.match(app, /function hasNonEmptyRecipe\(\)\{\s*return state\.layers\.some\(layer=>layer\.hoppers\.some\(hopper=>hopper\.resinName && hopper\.resinName\.trim\(\)\)\);/);
});
