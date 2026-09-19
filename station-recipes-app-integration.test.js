"use strict";

/* The application side of the recipes bridge, as source-level checks over
 * app.js, index.html, station-host.js and the harness - the same style as
 * the other two app-integration files, for the same reason: what these
 * guard against is the gradual version. A Station save that stops being
 * the Recipe Book's save. A second payload builder. A list kept in Station.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const app = read("app.js");
const indexHtml = read("index.html");
const harness = read("station/station.html");
const host = read("station-host.js");

function between(startAnchor, endAnchor) {
  const start = app.indexOf(startAnchor);
  assert.ok(start > -1, `anchor not found: ${startAnchor}`);
  const end = app.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `end anchor not found: ${endAnchor}`);
  return app.slice(start, end);
}

test("the application treats the recipes bridge as optional, connects it once, and swallows a failure to", () => {
  assert.match(app, /const stationRecipes = window\.PolynStationRecipesBridge \|\| null;/);
  assert.match(app, /let stationRecipesHandle = null;/);
  assert.match(app, /if \(!stationRecipes \|\| stationRecipesHandle\) return;/);
  const connect = between("function connectStationRecipes(){", "\n  function setupLineSync(){");
  assert.match(connect, /try\{/);
  assert.match(connect, /catch\(error\)\{ stationRecipesHandle = null; \}/);
  assert.equal((app.match(/connectStationRecipes\(\);/g) || []).length, 1, "called from exactly one place");
  // Inside setupLineSync, beside the connection bridge, before RT Sync
  // initializes - so the first sync render already has a book to announce.
  const setup = between("function setupLineSync(){", "void lineSync.initialize()");
  assert.match(setup, /connectStationRecipes\(\);/);
});

test("the book is projected from the configurations service's own cache for the selected workspace, named by the same line resolver", () => {
  const connect = between("function connectStationRecipes(){", "\n  function setupLineSync(){");
  assert.match(connect, /const workspaceId = syncState\?\.selectedWorkspaceId \|\| "";/);
  assert.match(connect, /workspaceConfigurations\.getCached\(workspaceId\)/);
  assert.match(connect, /const configuration = derivedLineConfiguration\(syncState\);/);
  assert.match(connect, /stationRecipes\.project\(/);
  assert.match(connect, /refreshing: workspaceConfigurationRefreshInFlight/);
  // No second cache, no direct read of storage, no second list.
  assert.doesNotMatch(connect, /localStorage|polyn\.workspaceConfigurations|listCached\(/);
});

test("Save Current IS the Recipe Book's save: the same payload builder, the same service create, the same finish", () => {
  const connect = between("function connectStationRecipes(){", "\n  function setupLineSync(){");
  // One payload builder, the application's own, used by the dialog too.
  assert.match(app, /function stationRecipePayload\(\)\{ return window\.PolynWorkspaceConfigurationPayloads\?\.createRecipePayload\(state\) \|\| null; \}/);
  const dialog = between("async function submitWorkspaceConfigurationDialog(){", "\n  function resolveWorkspaceConfigurationDuplicate(");
  assert.match(dialog, /window\.PolynWorkspaceConfigurationPayloads\?\.createRecipePayload\(state\)/);
  assert.match(dialog, /workspaceConfigurations\?\.create\(workspaceConfigurationWorkspaceId,pending\.type,name,payload\)/);
  // Station's save: the same create, on the selected workspace, as a recipe.
  const save = connect.slice(connect.indexOf("saveCurrentRecipe: async ({ name })=>{"), connect.indexOf("replaceRecipe: async"));
  assert.match(save, /const payload = stationRecipePayload\(\);/);
  assert.match(save, /await workspaceConfigurations\.create\(workspaceId, "recipe", name, payload\)/);
  assert.match(save, /finishWorkspaceConfigurationMutation\(result, "Configuration saved successfully\."\)/);
  // A duplicate is handed back for Station to resolve, not finished as a failure.
  assert.match(save, /if \(result\?\.code !== "duplicate_name"\) finishWorkspaceConfigurationMutation/);
  // Refresh: the floor UI's own refresh, with its in-flight guard.
  const refresh = connect.slice(connect.indexOf("refresh: async ()=>{"));
  assert.match(refresh, /await refreshWorkspaceConfigurations\(\);/);
  // Never the table, never an RPC, never the transport.
  assert.doesNotMatch(connect, /\.rpc\(|\.from\(|workspace_configurations|getWorkspaceConfigurationTransport/);
});

test("Save Next IS the floor UI's Save Next Recipe: the plan's own payload, held on the same isMeaningful test, the same create and finish", () => {
  const connect = between("function connectStationRecipes(){", "\n  function setupLineSync(){");
  const save = connect.slice(connect.indexOf("saveNextRecipe: async ({ name })=>{"), connect.indexOf("// Update, rename, duplicate and delete"));
  assert.match(save, /const payload = plannedRecipePayload\(\);/, "the plan as the state bridge projects it");
  assert.match(save, /if \(!payload \|\| !window\.PolynNextRecipe\?\.isMeaningful\(payload\)\) return \{ ok:false, code:"unavailable"/);
  assert.match(save, /await workspaceConfigurations\.create\(workspaceId, "recipe", name, payload\)/);
  assert.match(save, /if \(result\?\.code !== "duplicate_name"\) finishWorkspaceConfigurationMutation\(result, "Configuration saved successfully\."\)/);
  assert.doesNotMatch(save, /stationRecipePayload|createRecipePayload/, "never the running recipe");
  // The floor UI's own button is held on the same test.
  assert.match(app, /saveNextRecipeButton\.disabled=!window\.PolynNextRecipe\?\.isMeaningful\(state\.nextRecipe\);/);
});

test("Update, Rename, Duplicate and Delete ARE the floor UI's own mutation closure, on a recipe found in the service's own recipe list", () => {
  const connect = between("function connectStationRecipes(){", "\n  function setupLineSync(){");
  // A recipe is found in the service's OWN recipe list for the selected
  // workspace, and only a recipe - a weight profile's id answers not_found.
  assert.match(connect, /workspaceConfigurations\.listRecipes\(workspaceId\)\.items\.find\(item=>item\.id === id && item\.type === "recipe"\)/);
  assert.doesNotMatch(connect, /listReceiverWeightProfiles\(/);
  for (const [action, call] of [
    ["replaceRecipe", 'mutateWorkspaceConfiguration("update", existing)'],
    ["renameRecipe", 'mutateWorkspaceConfiguration("rename", existing, name)'],
    ["duplicateRecipe", 'mutateWorkspaceConfiguration("duplicate", existing, name)'],
    ["deleteRecipe", 'mutateWorkspaceConfiguration("delete", existing)']
  ]) {
    const start = connect.indexOf(`${action}: async (`);
    assert.ok(start > -1, `${action} is not offered`);
    const body = connect.slice(start, connect.indexOf("async (", start + action.length + 8));
    assert.ok(body.includes(`return ${call};`), `${action} does not run the floor UI's ${call}`);
    assert.match(body, /if \(!existing\) return GONE;/);
    assert.match(body, /if \(!workspaceId\) return NO_WORKSPACE;/);
  }
  // Never the service's write methods directly - the floor UI's closure has them.
  assert.doesNotMatch(connect, /workspaceConfigurations\.(update|rename|duplicate|delete|setFavorite)\(/);
  // No favourite from Station this round.
  assert.doesNotMatch(connect, /favorite/i);
});

test("Load IS the floor UI's apply, to the destination Station names - the layer-count guard, the validated write and RT Sync for Current; the plan for Next - and Station learns only whether it took", () => {
  const connect = between("function connectStationRecipes(){", "\n  function setupLineSync(){");
  const load = connect.slice(connect.indexOf("loadRecipe: async ({ id, destination })=>{"), connect.indexOf("refresh: async"));
  assert.match(load, /const result = applyWorkspaceConfiguration\(existing, destination\);/);
  assert.match(load, /code:"incompatible"/);
  assert.doesNotMatch(load, /applyRecipePayload|applyRecipeToActivePage|renderSplitsArea|validateAndCompute|notifyActiveJobMutation|nextRecipe/, "the tail is the apply's, not repeated here");
  // The apply now says whether it took; what it does is unchanged.
  const apply = between("function applyWorkspaceConfiguration(item,destination=null){", "\n  }");
  assert.match(apply, /const result=applyRecipeToActivePage\(item\.payload,\{kind:"load-workspace-configuration",destination\}\);/);
  assert.match(apply, /workspaceConfigurationStatus\(result\.ok \? `Recipe loaded into \$\{recipePageLabel\(destination\)\}\.` : \(result\.message \|\| "This shared configuration could not be loaded\."\)\);\n[^\n]*\n[^\n]*\n\s+return result;/);
  const into = between("function applyRecipeToActivePage(payload,{kind,lotByResin,destination}={}){", "\n  }\n");
  assert.match(into, /const intoNext=destination \? destination==="next" : isNextRecipePage\(\);/);
  assert.match(into, /notifyActiveJobMutation\(\{immediate:true,kind:kind\|\|"apply-recipe"\}\);/, "a Current load reaches RT Sync at once");
  assert.match(into, /state\.nextRecipe=stored;[\s\S]*saveSession\(\);\n\s+return \{ ok:true \};/, "a Next load replaces the plan and saves");
});

test("the book is announced from the cache's own subscription, the sync render, and around a refresh - and nowhere else", () => {
  const publishes = [...app.matchAll(/stationRecipesHandle\?\.publish\(\)/g)].map(match => match.index);
  assert.equal(publishes.length, 4, "the book is announced from exactly four places");
  const subscription = between("workspaceConfigurations.subscribe(snapshot=>{", "});");
  assert.match(subscription, /stationRecipesHandle\?\.publish\(\)/, "the cache's own subscription announces the book");
  const renderLineSync = between("function renderLineSync(syncState){", "function openRtSyncJoinFromUrl(");
  assert.match(renderLineSync, /stationRecipesHandle\?\.publish\(\)/, "the sync render announces the workspace change");
  assert.ok(renderLineSync.indexOf("stationConnectionHandle?.publish()") < renderLineSync.indexOf("stationRecipesHandle?.publish()"));
  const refresh = between("async function refreshWorkspaceConfigurations(){", "\n  function previewWorkspaceConfiguration(");
  assert.equal((refresh.match(/stationRecipesHandle\?\.publish\(\)/g) || []).length, 2, "a refresh announces its start and its end");
  // Not from the session commit point: the book is not job state.
  const saveSession = between("function saveSession(){", "function loadSession(){");
  assert.doesNotMatch(saveSession, /stationRecipesHandle/);
});

test("the bridge is loaded by both pages after the state bridge and before app.js; the Handbook modules only by the host and the harness", () => {
  for (const page of [indexHtml, harness]) {
    assert.ok(page.indexOf("station-state-bridge.js") < page.indexOf("station-recipes-bridge.js"));
  }
  assert.ok(indexHtml.indexOf("station-recipes-bridge.js") < indexHtml.indexOf('src="app.js'));
  assert.equal((indexHtml.match(/station-recipes-bridge\.js/g) || []).length, 1);
  assert.match(host, /"station\/station-recipe-book\.js"/);
  assert.match(host, /"station\/station-handbook\.js"/);
  assert.match(host, /"station\/styles\/components\/handbook\.css"/);
  assert.match(harness, /src="station-recipe-book\.js\?v=/);
  assert.match(harness, /src="station-handbook\.js\?v=/);
  assert.match(harness, /href="styles\/components\/handbook\.css\?v=/);
  // The section before the shell that hosts it, both before the boot file.
  assert.ok(host.indexOf("station-recipe-book.js") < host.indexOf("station-handbook.js"));
  assert.ok(host.indexOf("station-handbook.js") < host.indexOf("station/station.js"));
  assert.ok(harness.indexOf("station-recipe-book.js") < harness.indexOf("station-handbook.js"));
  assert.ok(harness.indexOf("station-handbook.js") < harness.indexOf('src="station.js'));
  // index.html loads neither - the Handbook is Station's, desktop only.
  assert.doesNotMatch(indexHtml, /station-handbook|station-recipe-book|handbook\.css/);
});
