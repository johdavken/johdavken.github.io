"use strict";

/* The application side of the admin bridge, as source-level checks over
 * workspace-recovery-ui.js (the producer), app.js, index.html,
 * station-host.js and the harness - the same style as the other
 * app-integration files, for the same reason: what these guard against is
 * the gradual version. A Station sign-in that stops being the floor UI's
 * sign-in. A second admin client. A second recovery service. A workspace
 * procedure called by a name of Station's own. A Create Line that skips RT
 * Sync's own path. An admin reference creeping into app.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const app = read("app.js");
const ui = read("workspace-recovery-ui.js");
const indexHtml = read("index.html");
const harness = read("station/station.html");
const host = read("station-host.js");

function between(source, startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  assert.ok(start > -1, `anchor not found: ${startAnchor}`);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `end anchor not found: ${endAnchor}`);
  return source.slice(start, end);
}

const connect = () => between(ui, "function connectStationAdmin(){", "\n  connectStationAdmin();");

test("the producer is the floor UI's own Workspace Management file, which treats the bridge as optional, connects it once, and swallows a failure to", () => {
  assert.match(ui, /const stationAdmin = root\.PolynStationAdminBridge \|\| null;/);
  assert.match(ui, /let stationAdminHandle = null;/);
  assert.match(ui, /if \(!stationAdmin \|\| stationAdminHandle\) return;/);
  const source = connect();
  assert.match(source, /try\{/);
  assert.match(source, /catch\(error\)\{ stationAdminHandle = null; \}/);
  assert.equal((ui.match(/connectStationAdmin\(\);/g) || []).length, 1, "called from exactly one place");
  // app.js - RT Sync's side - never learns the admin instance or the bridge exist.
  assert.doesNotMatch(app, /PolynResinAdminInstance|PolynStationAdminBridge|stationAdmin/);
});

test("ONE admin session: Station's access is the resin-admin instance this file already reads, and sign-in and sign-out are its own", () => {
  const source = connect();
  assert.match(ui, /function admin\(\)\{ return root\.PolynResinAdminInstance \|\| null; \}/);
  assert.match(source, /read: \(\)=>stationAdmin\.project\(admin\(\)\?\.getState\?\.\(\) \|\| null, descriptor\(\)\)/);
  assert.match(source, /const result = await instance\.signIn\(email, password\);/);
  assert.match(source, /signOut: async \(\)=>\{ await admin\(\)\?\.signOut\?\.\(\); return \{ ok:true \}; \}/);
  assert.match(source, /admin\(\)\?\.subscribe\?\.\(\(\)=>stationAdminHandle\?\.publish\(\)\);/);
  // Never a second client, a second sign-in, or an admin check of this file's own making.
  assert.doesNotMatch(ui, /createClient|signInWithPassword|admin_users|PolynResinAdmin\.create/);
  assert.match(read("resin-admin-ui.js"), /root\.PolynResinAdminInstance = admin;/);
  assert.ok(indexHtml.indexOf("resin-admin-ui.js") < indexHtml.indexOf("workspace-recovery-ui.js"), "the instance exists before the producer looks for it");
});

test("ONE workspace service: every Workspace Management action runs the SAME recovery service object the floor UI's panel runs, by the same procedure names", () => {
  const source = connect();
  assert.match(source, /const service = ensureRecovery\(\);/);
  assert.match(ui, /function ensureRecovery\(\)\{[\s\S]*?if \(!recovery\) recovery = serviceApi\.create\(\{ client \}\);/);
  assert.doesNotMatch(source, /serviceApi\.create|PolynWorkspaceRecovery\.create/, "no second service instance for Station");
  for (const procedure of [
    "service.listWorkspaces(descriptor().userId || null)",
    "service.getWorkspaceDetails(id)",
    "service.addDeviceToWorkspace({ workspaceId:id, targetUserId:device.userId, deviceId:device.deviceId, deviceLabel:device.deviceLabel })",
    "service.renameWorkspace({ workspaceId:id, name })",
    "service.transferOwnership({ workspaceId:id, newOwnerUserId:memberId })",
    "service.removeWorkspaceMember({ workspaceId:id, memberUserId:memberId })",
    "service.mergeWorkspace({ sourceWorkspaceId:id, targetWorkspaceId:targetId })",
    "service.deleteWorkspace({ workspaceId:id })"
  ]) {
    assert.ok(source.includes(procedure), `the producer runs ${procedure}`);
  }
  // The floor UI's panel runs the same procedures by the same names.
  const legacy = ui.slice(0, ui.indexOf("function connectStationAdmin(){"));
  for (const name of ["listWorkspaces", "getWorkspaceDetails", "addDeviceToWorkspace", "renameWorkspace", "transferOwnership", "removeWorkspaceMember", "mergeWorkspace", "deleteWorkspace"]) {
    assert.match(legacy, new RegExp(`service\\.${name}\\(`), `the floor UI runs ${name}`);
  }
  // Never the procedures by their server names, never the transport.
  assert.doesNotMatch(source, /\.rpc\(|\.from\(|admin_list_line_workspaces|admin_add_device_to_workspace|admin_delete_line_workspace/);
});

test("Create Line and the reconnect after Add This Device go through PolynRtSyncBridge, as the floor UI's panel does, with the same failure readings", () => {
  const source = connect();
  assert.match(source, /function descriptor\(\)\{ return bridge\(\)\?\.getRecoveryDescriptor\?\.\(\)/);
  assert.match(source, /await bridge\(\)\?\.createWorkspaceFromSudo\?\.\(name\)/);
  assert.match(source, /await bridge\(\)\?\.reconnectAfterRecovery\?\.\(id\)/);
  assert.match(source, /const message = workspaceOperationMessage\(error\);/, "a failed create is read by the floor UI's own function");
  const legacy = ui.slice(0, ui.indexOf("function connectStationAdmin(){"));
  assert.match(legacy, /bridge\(\)\?\.createWorkspaceFromSudo\?\.\(name\)/);
  assert.match(legacy, /bridge\(\)\?\.reconnectAfterRecovery\?\.\(workspaceId\)/);
  assert.match(legacy, /function workspaceOperationMessage\(error\)\{/);
  // The bridge's descriptor hook: told from the sync render, with nothing.
  assert.match(source, /bridge\(\)\?\.onRecoveryDescriptorChange\?\.\(\(\)=>stationAdminHandle\?\.publish\(\)\);/);
  assert.match(app, /onRecoveryDescriptorChange: \(listener\) => \{/);
  const renderLineSync = between(app, "function renderLineSync(syncState){", "function openRtSyncJoinFromUrl(");
  assert.match(renderLineSync, /for \(const listener of recoveryDescriptorListeners\)\{ try\{ listener\(\); \}catch\(error\)\{\} \}/);
  assert.doesNotMatch(app, /recoveryDescriptorListeners[^\n]*\(syncState|listener\(syncState|listener\(lineSync/, "a listener is told nothing but that it may re-read");
});

test("every action is guarded by the instance's own isAdmin, and an answer that says access is gone re-runs the instance's initialize()", () => {
  const source = connect();
  assert.match(source, /if \(!admin\(\)\?\.getState\?\.\(\)\.isAdmin\) return NO_ADMIN;/);
  assert.match(source, /if \(message === "Admin sign-in is required\."\)\{ void admin\(\)\?\.initialize\?\.\(\); return \{ ok:false, code:"not_authenticated", message \}; \}/);
  assert.match(source, /if \(message === "Admin access is required\."\)\{ void admin\(\)\?\.initialize\?\.\(\); return \{ ok:false, code:"access_denied", message \}; \}/);
  // Those two messages are the service's own for the two conditions.
  const service = read("workspace-recovery.js");
  assert.match(service, /admin_access_required"\)\) return "Admin access is required\.";/);
  assert.match(service, /not_authenticated"\)\) return "Admin sign-in is required\.";/);
  // And initialize() is the existing session check: verify, else sign out.
  const admin = read("resin-admin.js");
  assert.match(admin, /async function initialize\(\)\{[\s\S]*?else if \(user\) await adminClient\.auth\.signOut\(\);/);
  // The window is announced from the instance's subscription and the descriptor hook, and nowhere else.
  assert.equal((ui.match(/stationAdminHandle\?\.publish\(\)/g) || []).length, 2);
});

test("the bridge is loaded by both pages after the state bridge and before its producer; the Sudo modules only by the host and the harness", () => {
  assert.ok(indexHtml.indexOf("station-state-bridge.js") < indexHtml.indexOf("station-admin-bridge.js"));
  assert.ok(indexHtml.indexOf("station-admin-bridge.js") < indexHtml.indexOf("workspace-recovery-ui.js"));
  assert.ok(harness.indexOf("station-state-bridge.js") < harness.indexOf("station-admin-bridge.js"));
  assert.doesNotMatch(indexHtml, /station-sudo/, "index.html loads no Sudo module of its own");
  for (const page of [harness, host]) {
    assert.ok(page.indexOf("station-sudo-workspaces.js") < page.indexOf("station-sudo.js"), "the tool before the page that hosts it");
    assert.ok(page.indexOf("station-sudo-lines.js") < page.indexOf("station-sudo.js"), "the second tool before the page that hosts it");
    assert.ok(page.indexOf("station-sudo-resins.js") < page.indexOf("station-sudo.js"), "the third tool before the page that hosts it");
    assert.ok(page.indexOf("station-line-model.js") < page.indexOf("station-sudo-lines.js"), "the line model before the tool that derives roles from it");
    assert.ok(page.indexOf("station-sudo.js") < page.indexOf("station-handbook.js"), "the page before the Handbook that hosts it");
    assert.ok(page.includes("components/sudo.css"));
  }
  // The harness loads no application UI script for it: no producer there.
  assert.doesNotMatch(harness, /resin-admin|workspace-recovery/);
});

/* ----------------------------------------------------------------------
 *   Line Configuration: the same service the floor UI's panel runs
 * -------------------------------------------------------------------- */

test("ONE line configuration service: Station's list and save run PolynLineConfigurations.createAdminService on the instance's own client - the pair the floor UI's Line Configuration panel runs - never the transport", () => {
  const source = connect();
  assert.match(source, /const lineConfigurations = root\.PolynLineConfigurations \|\| null;/);
  assert.match(source, /const client = admin\(\)\?\.getClient\?\.\(\);/);
  assert.match(source, /if \(!lineService\) lineService = lineConfigurations\.createAdminService\(client\);/);
  assert.match(source, /listLineConfigurations: guardedLines\(async service=>\{[\s\S]*?const result = await service\.list\(\);/);
  assert.match(source, /saveLineConfiguration: guardedLines\(async \(service, \{ id, line \}\)=>\{[\s\S]*?const result = await service\.save\(id \|\| null, line\);/);
  assert.match(source, /function guardedLines\(run\)\{[\s\S]*?if \(!admin\(\)\?\.getState\?\.\(\)\.isAdmin\) return NO_ADMIN;/, "the same isAdmin guard as every other action");
  assert.doesNotMatch(source, /admin_list_line_configurations|admin_save_line_configuration|line_configurations"/);
  // The floor UI's panel: the same factory on the same client, and the same two procedures.
  const legacy = read("line-configurations-ui.js");
  assert.match(legacy, /const client = admin\(\)\?\.getClient\?\.\(\);/);
  assert.match(legacy, /if \(!service\) service = api\.createAdminService\(client\);/);
  assert.match(legacy, /await current\.list\(\)/);
  assert.match(legacy, /await ensureService\(\)\.save\(selected\?\.id \|\| null,nextValues\)/);
  // And the service is where the procedures, the validation and the announcement live - once.
  const service = read("line-configurations-service.js");
  assert.match(service, /adminClient\.rpc\("admin_list_line_configurations"\)/);
  assert.match(service, /adminClient\.rpc\("admin_save_line_configuration", \{/);
  assert.match(service, /const checked = identity\.validateLineConfigurations\(\[candidate\]\);/);
  assert.match(service, /await refresh\(\);\s*return \{ ok:true, line:/, "a save re-reads the shared definitions and announces them");
  assert.match(service, /new CustomEvent\("polyn:line-configurations"/);
  // The service is loaded before the producer looks for it.
  assert.ok(indexHtml.indexOf("line-configurations-service.js") < indexHtml.indexOf("workspace-recovery-ui.js"));
});

test("a saved change reaches a running Station by the existing path: the announcement, the sync render, and the state bridge said to have moved - no second mechanism", () => {
  const listener = between(app, 'window.addEventListener("polyn:line-configurations"', "\n    });");
  assert.match(listener, /renderLineSync\(syncState\);/);
  assert.match(listener, /stationBridgeHandle\?\.publish\(\);/);
  // The sync render is where the layer count is brought into line with the
  // definition, and the connection console is announced.
  const renderLineSync = between(app, "function renderLineSync(syncState){", "function openRtSyncJoinFromUrl(");
  assert.match(renderLineSync, /syncDerivedLayerCount\(syncState\);/);
  assert.match(renderLineSync, /stationConnectionHandle\?\.publish\(\);/);
  // The snapshot reads the derived configuration when it is taken, so a
  // publish is enough: nothing is pushed into Station.
  assert.match(app, /lineConfiguration: derivedLineConfiguration\(\),/);
  assert.doesNotMatch(app, /PolynStationSudoLines|station-sudo-lines/, "app.js knows nothing of the tool");
  // The Station tool neither reads the definitions itself nor reloads.
  const tool = read("station/station-sudo-lines.js");
  assert.doesNotMatch(tool, /getLineConfigurations|setConfiguredLineConfigurations|loadCachedLineConfigurations|refreshResins|PolynLineConfigurations/);
  assert.match(tool, /lineIdentityModule\.validateLineConfigurations\(combined\)/, "it validates by line-identity's rules before asking");
});

/* ----------------------------------------------------------------------
 *   Resin Database: the same instance the floor UI's panel runs
 * -------------------------------------------------------------------- */

test("ONE resin database: Station's list, save and delete are the admin instance's own procedures - the same three the floor UI's Resin Database panel runs - and a save's catalog refresh is the service's, not the producer's", () => {
  const source = connect();
  assert.match(source, /function guardedResins\(run\)\{[\s\S]*?if \(!instance\?\.getState\?\.\(\)\.isAdmin\) return NO_ADMIN;/, "the same isAdmin guard as every other action, over the instance itself");
  assert.match(source, /listResins: guardedResins\(async instance=>\{[\s\S]*?const result = await instance\.listResins\(\);/);
  assert.match(source, /saveResin: guardedResins\(async \(instance, \{ id, resin \}\)=>\{[\s\S]*?const result = await instance\.saveResin\(id \|\| null, resinValues\(resin\)\);/);
  assert.match(source, /deleteResin: guardedResins\(\(instance, \{ id \}\)=>instance\.deleteResin\(id\)\)/);
  assert.match(source, /if \(message === "That resin code already exists\."\) return \{ ok:false, code:"duplicate_code", message \};/);
  // The producer neither touches the catalog nor the table, and announces nothing: the window has no resin in it.
  assert.doesNotMatch(source, /refreshResins|PolynResinCatalog|acceptConfirmedResin|\.from\(|"resins"|resins"\)/);
  assert.equal((ui.match(/stationAdminHandle\?\.publish\(\)/g) || []).length, 2, "a resin write moves no window value");
  // The floor UI's panel: the same three procedures on the same instance.
  const legacy = read("resin-admin-ui.js");
  assert.match(legacy, /await admin\.listResins\(\)/);
  assert.match(legacy, /await admin\.saveResin\(id \|\| null, values\)/);
  assert.match(legacy, /await admin\.deleteResin\(id\)/);
  // And the service is where the validation, the duplicate answer and the catalog refresh live - once.
  const service = read("resin-admin.js");
  assert.match(between(service, "async function saveResin(", "async function updateBulkDensity("), /await catalog\?\.refreshResins\?\.\(\);/);
  assert.match(between(service, "async function deleteResin(", "function subscribe("), /await catalog\?\.refreshResins\?\.\(\);/);
  assert.match(service, /"That resin code already exists\."/);
  assert.match(service, /function validateResin\(values\)\{/);
  // app.js knows nothing of the tool or the actions.
  assert.doesNotMatch(app, /PolynStationSudoResins|station-sudo-resins|listResins|saveResin|deleteResin/);
});

test("the Station tool neither reads the catalog nor refreshes it, holds no column name, and subscribes to nothing: the service's refresh is how a change reaches the running application", () => {
  const tool = read("station/station-sudo-resins.js");
  assert.doesNotMatch(tool, /refreshResins|PolynResinCatalog|getResins|acceptConfirmedResin|resin_code|density_g_cm3|bulk_density_lb_ft3|is_active|\.subscribe\s*\(/);
  assert.match(tool, /request\("listResins"\)/);
  assert.match(tool, /request\("saveResin", \{ id: values\.id \|\| "", resin: values \}\)/);
  assert.match(tool, /request\("deleteResin", \{ id: resin\.id \}\)/);
  // The value rules are the service's: the tool checks only what it can know on its own.
  assert.doesNotMatch(tool, /0\.001|\b10\b.*g\/cm|between 1 and 100/);
  assert.match(tool, /duplicateCode\(state\.resins, values\.resinCode, values\.id\)/);
  assert.match(tool, /Permanently delete \$\{resin\.resinCode\}\? Use Inactive instead if this catalog record may be needed again\. This cannot be undone\./);
});
