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
    assert.ok(page.indexOf("station-sudo.js") < page.indexOf("station-handbook.js"), "the page before the Handbook that hosts it");
    assert.ok(page.includes("components/sudo.css"));
  }
  // The harness loads no application UI script for it: no producer there.
  assert.doesNotMatch(harness, /resin-admin|workspace-recovery/);
});
