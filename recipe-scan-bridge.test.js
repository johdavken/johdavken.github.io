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
  assert.doesNotMatch(app, /PolynRecipeScanBridge[\s\S]{0,400}createClient/i);
});

test("applyScannedRecipe builds a payload via PolynRecipeScanMapping, then reuses applyRecipePayload - the same pathway as loading a cloud recipe", () => {
  const fnStart = app.indexOf("function applyScannedRecipe(");
  const fnEnd = app.indexOf("\n  function openWorkspaceConfigurationDialog", fnStart);
  assert.notEqual(fnStart, -1, "expected to find applyScannedRecipe");
  const body = app.slice(fnStart, fnEnd);

  assert.match(body, /window\.PolynRecipeScanMapping/);
  assert.match(body, /mapping\.buildRecipePayloadFromScan\(scanRecipe,/);
  assert.match(body, /lineType: state\.lineType/);
  assert.match(body, /window\.PolynWorkspaceConfigurationPayloads\?\.applyRecipePayload\(state, built\.payload\)/);
  assert.match(body, /renderWeightsArea\(\); renderSplitsArea\(\); validateAndCompute\(\); saveSession\(\);/);
  assert.match(body, /notifyActiveJobMutation\(\{immediate:true,kind:"apply-recipe-scan"\}\)/);
});

test("a failed mapping (e.g. wrong layer count) returns ok:false with a message and never reaches applyRecipePayload's mutation", () => {
  const fnStart = app.indexOf("function applyScannedRecipe(");
  const fnEnd = app.indexOf("\n  function openWorkspaceConfigurationDialog", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /if \(!built\.ok\) return \{ ok:false, message: built\.message/);
});

test("hasNonEmptyRecipe checks for any assigned resin name across all layers - used to decide whether to warn before overwrite", () => {
  assert.match(app, /function hasNonEmptyRecipe\(\)\{\s*return state\.layers\.some\(layer=>layer\.hoppers\.some\(hopper=>hopper\.resinName && hopper\.resinName\.trim\(\)\)\);/);
});
