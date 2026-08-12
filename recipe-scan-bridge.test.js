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

  // Routed through the one destination-aware entry point, which is what keeps
  // "a scan lands on the page you are viewing" implemented in a single place.
  assert.match(body, /applyRecipeToActivePage\(payload, \{ kind:"apply-recipe-scan" \}\)/);
  // Deliberately payload-in: no reference to PolynRecipeScanMapping, so a
  // review-screen edit to the payload is submitted as-is, not recomputed
  // from the raw scan and silently discarded.
  assert.doesNotMatch(body, /PolynRecipeScanMapping/);

  // Current still takes the established pathway, unchanged.
  const routerStart = app.indexOf("function applyRecipeToActivePage(");
  const router = app.slice(routerStart, app.indexOf("\n  function recipePageLabel(", routerStart));
  assert.match(router, /window\.PolynWorkspaceConfigurationPayloads\?\.applyRecipePayload\(state,payload\)/);
  assert.match(router, /renderWeightsArea\(\); renderSplitsArea\(\); validateAndCompute\(\); saveSession\(\);/);
  assert.match(router, /notifyActiveJobMutation\(\{immediate:true,kind:kind\|\|"apply-recipe"\}\)/);
  // A plan is not the running job: writing one must not publish an active job.
  const planBranch = router.slice(router.indexOf("const stored="));
  assert.doesNotMatch(planBranch, /notifyActiveJobMutation|validateAndCompute/);
});

test("a failed apply (e.g. layer percentages don't total 100%) returns ok:false with a message", () => {
  const fnStart = app.indexOf("function applyScannedRecipePayload(");
  const fnEnd = app.indexOf("\n  function openWorkspaceConfigurationDialog", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /return result\.ok \? \{ ok:true \} : \{ ok:false, message: result\.message/);
  const routerStart = app.indexOf("function applyRecipeToActivePage(");
  const router = app.slice(routerStart, app.indexOf("\n  function recipePageLabel(", routerStart));
  assert.match(router, /if\(!result\?\.ok\) return \{ ok:false, message:result\?\.errors\?\.\[0\] \}/);
});

test("hasNonEmptyRecipe asks about the page a scan will land on, not always the live recipe", () => {
  assert.match(app, /function hasNonEmptyRecipe\(\)\{[\s\S]*?if\(isNextRecipePage\(\)\) return !!window\.PolynNextRecipe\?\.isMeaningful\(state\.nextRecipe\);[\s\S]*?return state\.layers\.some\(layer=>layer\.hoppers\.some\(hopper=>hopper\.resinName && hopper\.resinName\.trim\(\)\)\);/);
});
