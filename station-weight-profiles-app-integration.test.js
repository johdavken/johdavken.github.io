"use strict";

/* The application side of the weight-profiles bridge, as source-level
 * checks over app.js, index.html, station-host.js and the harness - the
 * same style as the recipes file, for the same reason: what these guard
 * against is the gradual version. A Station load that stops being the
 * floor UI's apply. A second payload builder. A list kept in Station. A
 * rename that is not the floor UI's rename.
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

const CONNECT_START = "function connectStationWeightProfiles(){";
const CONNECT_END = "\n  function stationRecipePayload(){";

test("the application treats the weight-profiles bridge as optional, connects it once, and swallows a failure to", () => {
  assert.match(app, /const stationWeightProfiles = window\.PolynStationWeightProfilesBridge \|\| null;/);
  assert.match(app, /let stationWeightProfilesHandle = null;/);
  assert.match(app, /if \(!stationWeightProfiles \|\| stationWeightProfilesHandle\) return;/);
  const connect = between(CONNECT_START, CONNECT_END);
  assert.match(connect, /try\{/);
  assert.match(connect, /catch\(error\)\{ stationWeightProfilesHandle = null; \}/);
  assert.equal((app.match(/connectStationWeightProfiles\(\);/g) || []).length, 1, "called from exactly one place");
  // Inside setupLineSync, beside the recipes bridge, before RT Sync
  // initializes - so the first sync render already has a book to announce.
  const setup = between("function setupLineSync(){", "void lineSync.initialize()");
  assert.match(setup, /connectStationRecipes\(\);\s*connectStationWeightProfiles\(\);/);
  // Declared before the recipes producer, so the recipes integration
  // test's slice of connectStationRecipes stays its own.
  assert.ok(app.indexOf(CONNECT_START) < app.indexOf("function connectStationRecipes(){"));
});

test("the book is projected from the configurations service's own cache for the selected workspace, named by the same line resolver", () => {
  const connect = between(CONNECT_START, CONNECT_END);
  assert.match(connect, /const workspaceId = syncState\?\.selectedWorkspaceId \|\| "";/);
  assert.match(connect, /workspaceConfigurations\.getCached\(workspaceId\)/);
  assert.match(connect, /const configuration = derivedLineConfiguration\(syncState\);/);
  assert.match(connect, /stationWeightProfiles\.project\(/);
  assert.match(connect, /refreshing: workspaceConfigurationRefreshInFlight/);
  // No second cache, no direct read of storage, no second list.
  assert.doesNotMatch(connect, /localStorage|polyn\.workspaceConfigurations|listCached\(/);
  // A profile is found in the service's OWN profile list for the selected
  // workspace, and only a profile - a recipe's id answers not_found.
  assert.match(connect, /workspaceConfigurations\.listReceiverWeightProfiles\(workspaceId\)\.items\.find\(item=>item\.id === id && item\.type === "receiver_weight_profile"\)/);
  assert.doesNotMatch(connect, /listRecipes\(/);
});

test("Save Current Weights IS the floor UI's save: the same payload builder, the same service create as a profile, the same finish", () => {
  const connect = between(CONNECT_START, CONNECT_END);
  assert.match(app, /function stationWeightProfilePayload\(\)\{ return window\.PolynWorkspaceConfigurationPayloads\?\.createReceiverWeightProfile\(state\) \|\| null; \}/);
  const dialog = between("async function submitWorkspaceConfigurationDialog(){", "\n  function resolveWorkspaceConfigurationDuplicate(");
  assert.match(dialog, /createReceiverWeightProfile\(state\)/);
  const save = connect.slice(connect.indexOf("saveCurrentWeights: async ({ name })=>{"), connect.indexOf("replaceWeightProfile: async"));
  assert.match(save, /const payload = stationWeightProfilePayload\(\);/);
  assert.match(save, /await workspaceConfigurations\.create\(workspaceId, "receiver_weight_profile", name, payload\)/);
  assert.match(save, /if \(result\?\.code !== "duplicate_name"\) finishWorkspaceConfigurationMutation\(result, "Configuration saved successfully\."\)/);
});

test("Update, Rename, Duplicate and Delete ARE the floor UI's own mutation closure, which now answers with the service's result", () => {
  const connect = between(CONNECT_START, CONNECT_END);
  for (const [action, call] of [
    ["replaceWeightProfile", 'mutateWorkspaceConfiguration("update", existing)'],
    ["renameWeightProfile", 'mutateWorkspaceConfiguration("rename", existing, name)'],
    ["duplicateWeightProfile", 'mutateWorkspaceConfiguration("duplicate", existing, name)'],
    ["deleteWeightProfile", 'mutateWorkspaceConfiguration("delete", existing)']
  ]) {
    const start = connect.indexOf(`${action}: async (`);
    assert.ok(start > -1, `${action} is not offered`);
    const body = connect.slice(start, connect.indexOf("async (", start + action.length + 8));
    assert.ok(body.includes(`return ${call};`), `${action} does not run the floor UI's ${call}`);
    assert.match(body, /if \(!existing\) return GONE;/);
  }
  // The closure returns what the service said, so Station can tell a
  // duplicate name from a failure; its own finish still runs first.
  const mutate = between("async function mutateWorkspaceConfiguration(action,item,value){", "\n  }");
  assert.match(mutate, /finishWorkspaceConfigurationMutation\(result,/);
  assert.match(mutate, /\n    return result;$/);
  // Never the table, never an RPC, never the transport, never the service's
  // write methods directly - the floor UI's closure has them.
  assert.doesNotMatch(connect, /\.rpc\(|\.from\(|workspace_configurations|getWorkspaceConfigurationTransport/);
  assert.doesNotMatch(connect, /workspaceConfigurations\.(update|rename|duplicate|delete|setFavorite)\(/);
});

test("Load IS the floor UI's apply, with its own validated write and its own tail; Station learns only whether it took", () => {
  const connect = between(CONNECT_START, CONNECT_END);
  const load = connect.slice(connect.indexOf("loadWeightProfile: async ({ id })=>{"), connect.indexOf("refresh: async"));
  assert.match(load, /const result = applyWorkspaceConfiguration\(existing\);/);
  assert.match(load, /code:"incompatible"/);
  assert.doesNotMatch(load, /applyReceiverWeightProfile|renderWeightsArea|validateAndCompute|notifyActiveJobMutation/, "the tail is the apply's, not repeated here");
  // The apply itself is unchanged in what it does, and now says so.
  const apply = between("function applyWorkspaceConfiguration(item,destination=null){", "\n  }");
  assert.match(apply, /window\.PolynWorkspaceConfigurationPayloads\?\.applyReceiverWeightProfile\(state,item\.payload\)/);
  assert.match(apply, /renderWeightsArea\(\); renderSplitsArea\(\); validateAndCompute\(\); saveSession\(\); notifyActiveJobMutation\(\{immediate:true,kind:"load-workspace-configuration"\}\);/);
  assert.match(apply, /return \{ ok:false, message \};/);
  assert.match(apply, /return \{ ok:true \};/);
  // Refresh: the floor UI's own refresh, with its in-flight guard.
  const refresh = connect.slice(connect.indexOf("refresh: async ()=>{"));
  assert.match(refresh, /await refreshWorkspaceConfigurations\(\);/);
});

test("the book is announced beside the recipes book - the cache's subscription, the sync render, around a refresh - and nowhere else", () => {
  const publishes = [...app.matchAll(/stationWeightProfilesHandle\?\.publish\(\)/g)].map(match => match.index);
  assert.equal(publishes.length, 4, "the book is announced from exactly four places");
  const recipes = [...app.matchAll(/stationRecipesHandle\?\.publish\(\)/g)].map(match => match.index);
  assert.equal(recipes.length, 4, "the recipes book's four are untouched");
  for (let i = 0; i < 4; i += 1) {
    assert.ok(publishes[i] > recipes[i] && publishes[i] - recipes[i] < 80, "each announcement follows the recipes book's, from the same moment");
  }
  const saveSession = between("function saveSession(){", "function loadSession(){");
  assert.doesNotMatch(saveSession, /stationWeightProfilesHandle/);
});

test("the bridge is loaded by both pages after the state bridge and before app.js", () => {
  for (const page of [indexHtml, harness]) {
    assert.ok(page.indexOf("station-state-bridge.js") < page.indexOf("station-weight-profiles-bridge.js"), "loads after the state bridge it requires");
    assert.ok(page.indexOf("station-recipes-bridge.js") < page.indexOf("station-weight-profiles-bridge.js"), "beside the recipes bridge");
  }
  assert.ok(indexHtml.indexOf("station-weight-profiles-bridge.js") < indexHtml.indexOf('src="app.js'));
  assert.equal((indexHtml.match(/station-weight-profiles-bridge\.js/g) || []).length, 1);
  assert.match(indexHtml, /src="station-weight-profiles-bridge\.js\?v=/);
  assert.match(harness, /src="\.\.\/station-weight-profiles-bridge\.js\?v=/);
  // The Weights page: the section before the shell that hosts it.
  assert.match(host, /"station\/station-weights\.js"/);
  assert.match(host, /"station\/styles\/components\/weights\.css"/);
  assert.ok(host.indexOf("station-weights.js") < host.indexOf("station-handbook.js"));
  assert.match(harness, /src="station-weights\.js\?v=/);
  assert.match(harness, /href="styles\/components\/weights\.css\?v=/);
  assert.ok(harness.indexOf("station-weights.js") < harness.indexOf("station-handbook.js"));
  assert.doesNotMatch(indexHtml, /station-weights\.js|weights\.css/);
});
