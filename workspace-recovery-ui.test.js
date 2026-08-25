"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const index = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("workspace-recovery-ui.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");
const resinAdmin = fs.readFileSync("resin-admin.js", "utf8");
const resinAdminUi = fs.readFileSync("resin-admin-ui.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("Workspace Management is hidden during initialization, when signed out, and for non-admins", () => {
  assert.match(index, /id="workspaceManagementButton"[^>]*hidden/);
  assert.match(ui, /const initializing = !state\?\.ready/);
  assert.match(ui, /const adminAccess = !initializing && !!state\?\.isAdmin/);
  assert.match(ui, /button\.hidden = initializing \|\| !adminAccess/);
  assert.match(ui, /if \(!adminAccess\) resetPanel\(\)/);
  assert.match(styles, /\.adminNavButton\[hidden\]\{ display: none !important; \}/);
});

test("visibility is driven by the shared admin instance, not a second admin session", () => {
  assert.match(resinAdminUi, /root\.PolynResinAdminInstance = admin/);
  const returnStatement = resinAdmin.match(/return \{ initialize[\s\S]*?\};/)?.[0];
  assert.ok(returnStatement, "Expected resin-admin.js create() to return an API object");
  assert.match(returnStatement, /getClient/);
  assert.match(ui, /adminInstance\.subscribe\(renderAccess\)/);
  assert.doesNotMatch(ui, /createClient/i);
  assert.doesNotMatch(ui, /supabaseLibrary/i);
});

test("Add This Device reads the target identity from the existing RT Sync client only, never a typed UUID", () => {
  assert.match(app, /window\.PolynRtSyncBridge = \{/);
  assert.match(app, /getRecoveryDescriptor: \(\) => lineSync\?\.getRecoveryDescriptor\?\.\(\)/);
  assert.match(cloudSync, /function getRecoveryDescriptor\(\)/);
  assert.match(cloudSync, /ready: !!\(state\.available && state\.userId\)/);
  const descriptorBody = cloudSync.match(/function getRecoveryDescriptor\(\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(descriptorBody, "expected to find the getRecoveryDescriptor function body");
  assert.doesNotMatch(descriptorBody, /(token|session|outbox)/i);
  assert.match(ui, /bridge\(\)\?\.getRecoveryDescriptor\?\.\(\)/);
  assert.doesNotMatch(index, /workspaceRecoveryTargetUserId.*type="text"/i);
  assert.doesNotMatch(ui, /prompt\(/);
});

test("the workspace list and recovery actions go through the admin RPC service only", () => {
  assert.match(ui, /service\.listWorkspaces/);
  assert.match(ui, /service\.getWorkspaceDetails/);
  assert.match(ui, /service\.addDeviceToWorkspace/);
  assert.match(ui, /service\.removeWorkspaceMember/);
  assert.match(ui, /service\.deleteWorkspace/);
  assert.match(ui, /service\.mergeWorkspace/);
  assert.doesNotMatch(ui, /\.from\("line_workspace_members"\)/);
  assert.doesNotMatch(ui, /\.from\("line_workspaces"\)/);
  assert.match(ui, /admin_list_line_workspaces|listWorkspaces/);
});

test("Add This Device requires an explicit confirmation dialog before mutating membership", () => {
  assert.match(index, /id="workspaceRecoveryConfirmDialog"/);
  assert.match(ui, /This will not:/);
  assert.match(ui, /transfer workspace ownership/);
  assert.match(ui, /function confirmAddDevice\(\)/);
  assert.match(ui, /dialog\.showModal\(\)/);
  assert.match(ui, /if \(dialog\.returnValue === "confirm"\) void addDevice\(\)/);
  assert.doesNotMatch(ui, /addDevice\(\);\s*\}\s*\);\s*dialog\.showModal/);
});

test("successful recovery reconnects through established RT Sync APIs and refreshes configurations", () => {
  assert.match(app, /reconnectAfterRecovery: async \(workspaceId\) => \{/);
  assert.match(app, /await lineSync\.loadWorkspaces\(\)/);
  assert.match(app, /await lineSync\.selectWorkspace\(workspaceId\)/);
  assert.match(app, /await refreshWorkspaceConfigurations\(\)/);
  assert.match(cloudSync, /loadWorkspaces,/);
  assert.match(ui, /await bridge\(\)\?\.reconnectAfterRecovery\?\.\(workspaceId\)/);
  assert.doesNotMatch(ui, /location\.reload/);
});

test("a failed recovery attempt never reconnects or mutates state", () => {
  const body = ui.slice(ui.indexOf("async function addDevice()"), ui.indexOf("async function removeMember"));
  assert.match(body, /if \(!result\.ok\)\{ setMessage\(result\.message, "bad"\); return; \}/);
  const beforeReturn = body.slice(0, body.indexOf('if (!result.ok)'));
  assert.doesNotMatch(beforeReturn, /reconnectAfterRecovery/);
});

test("sign-out closes Workspace Management and admin/RT Sync sessions stay separate", () => {
  assert.match(ui, /function resetPanel\(\)/);
  assert.match(ui, /if \(panel\) panel\.open = false/);
  assert.match(ui, /data-workspace-target="resultsBlock"/);
  assert.doesNotMatch(app, /PolynResinAdminInstance/);
  assert.doesNotMatch(resinAdminUi, /PolynRtSyncBridge/);
});

test("Workspace Management is a main-panel workspacePanel, not an oversized modal", () => {
  assert.match(index, /id="workspaceManagementButton"[^>]*data-workspace-target="workspaceManagementBlock"/);
  assert.match(index, /<details class="block card workspacePanel adminResinPanel" id="workspaceManagementBlock">/);
  assert.match(index, /Reconnect a line computer after a browser reset/);
});

test("Workspace recovery uses the shared action treatments for refresh and adding this device", () => {
  assert.match(index, /id="workspaceRecoveryRefreshBtn" type="button" class="secondary">Refresh workspaces<\/button>/);
  assert.match(index, /id="workspaceRecoveryAddDeviceBtn" type="button" class="primary actionRail">Add This Device<\/button>/);
  assert.match(styles, /button\.primary\.actionRail\{[\s\S]*?border-radius:2px;\s*\n\}/);
});

test("desktop Workspace Management reserves two lines inside every workspace row", () => {
  const desktop = fs.readFileSync("desktop.css", "utf8");
  assert.match(desktop, /\.workspaceRecoveryRow\{grid-template-rows:auto auto;align-content:center;min-height:58px;line-height:1\.25\}/);
  assert.match(desktop, /\.workspaceRecoveryRow strong,\.workspaceRecoveryRow small\{display:block\}/);
});

test("ownership reassignment is a distinct, explicit action separate from Add This Device", () => {
  assert.match(index, /id="workspaceRecoveryTransferOwnershipBtn"[^>]*disabled/);
  assert.match(index, /id="workspaceRecoveryOwnershipConfirmDialog"/);
  assert.match(ui, /function confirmTransferOwnership\(\)/);
  assert.match(ui, /service\.transferOwnership/);
  const confirmAddDeviceBody = ui.slice(ui.indexOf("function confirmAddDevice()"), ui.indexOf("async function addDevice()"));
  assert.doesNotMatch(confirmAddDeviceBody, /transferOwnership/);
});

test("ownership reassignment is only enabled once this device is already a member, and warns it cannot verify the previous owner is gone", () => {
  assert.match(ui, /currentMembership = members\.find\(m => m\.member_user_id === descriptor\?\.userId\)/);
  assert.match(ui, /transferBtn\.disabled = !descriptor\?\.ready \|\| !currentMembership \|\| currentMembership\.member_role === "owner"/);
  assert.match(ui, /Resin\.Tools cannot verify that from here/);
  assert.match(ui, /demote the previous owner's membership row to an ordinary member \(it is not deleted\)/);
});

test("a failed ownership reassignment never reconnects or mutates local state", () => {
  const body = ui.slice(ui.indexOf("async function transferOwnership()"), ui.indexOf("async function removeMember"));
  assert.match(body, /if \(!result\.ok\)\{ setMessage\(result\.message, "bad"\); if \(transferBtn\) transferBtn\.disabled = false; return; \}/);
});

test("diagnostic details are opt-in and member identifiers are abbreviated in the UI layer", () => {
  assert.match(index, /workspaceRecoveryDiagnostic/);
  assert.match(index, /<summary>Diagnostic details<\/summary>/);
  assert.match(ui, /function shortId\(id\)/);
  assert.match(ui, /shortId\(descriptor\.userId\)/);
  assert.match(ui, /shortId\(member\.member_user_id\)/);
});

test("incident controls can disconnect every linked device and delete a workspace only through admin RPCs", () => {
  assert.match(index, /id="workspaceRecoveryDeleteWorkspaceBtn"[^>]*class="danger"/);
  assert.match(index, /<summary>Linked devices<\/summary>/);
  assert.match(ui, /removeBtn\.textContent = "Disconnect"/);
  assert.doesNotMatch(ui, /member\.member_role !== "owner"/);
  assert.match(ui, /function deleteWorkspace\(\)/);
  assert.match(ui, /Permanently delete/);
  assert.doesNotMatch(index, /id="lineSyncDeleteBtn"/);
  assert.doesNotMatch(app, /lineSyncDeleteBtn/);
});

test("each non-owner member row offers Make Owner, reusing the same admin RPC and confirmation dialog as the recovery-flow reassignment button", () => {
  assert.match(ui, /makeOwnerBtn\.textContent = "Make Owner"/);
  assert.match(ui, /member\.member_role === "member"/);
  const renderMembersBody = ui.slice(ui.indexOf("function renderMembers()"), ui.indexOf("function renderDetail()"));
  assert.match(renderMembersBody, /makeOwnerBtn\.addEventListener\("click", \(\) => confirmMakeOwner\(member, makeOwnerBtn\)\)/);
  assert.match(ui, /function confirmMakeOwner\(member, makeOwnerBtn\)/);
  assert.match(ui, /async function makeOwner\(member, makeOwnerBtn\)/);
  // Both entry points share one dialog-building helper, so the same warning
  // and "not deleted" language apply regardless of which button was used.
  assert.match(ui, /function ownershipConfirmLines\(newOwnerLabel\)/);
  assert.match(ui, /showOwnershipConfirmDialog\(descriptor\.deviceLabel \|\| "This device", transferOwnership\)/);
  assert.match(ui, /showOwnershipConfirmDialog\(label, \(\) => makeOwner\(member, makeOwnerBtn\)\)/);
});

test("Make Owner is withheld for a row that is already the owner - only the dedicated recovery button reassigns to this device", () => {
  const renderMembersBody = ui.slice(ui.indexOf("function renderMembers()"), ui.indexOf("function renderDetail()"));
  assert.match(renderMembersBody, /if \(member\.member_role === "member"\)\{/);
});

test("a failed Make Owner re-enables that row's own button and never reconnects or mutates local state", () => {
  const body = ui.slice(ui.indexOf("async function makeOwner("), ui.indexOf("async function removeMember"));
  assert.match(body, /if \(!result\.ok\)\{ setMessage\(result\.message, "bad"\); if \(makeOwnerBtn\) makeOwnerBtn\.disabled = false; return; \}/);
  const beforeReturn = body.slice(0, body.indexOf("if (!result.ok)"));
  assert.doesNotMatch(beforeReturn, /loadWorkspaces|selectWorkspace/);
});

test("workspace merge presents an explicit target, preserves target data, and deletes only the selected source", () => {
  assert.match(index, /id="workspaceRecoveryMergeTarget"/);
  assert.match(index, /id="workspaceRecoveryMergeBtn"[^>]*>Merge &amp; Delete This Workspace/);
  assert.match(ui, /function mergeWorkspace\(\)/);
  assert.match(ui, /sourceWorkspaceId/);
  assert.match(ui, /targetWorkspaceId/);
  assert.match(ui, /Existing same-name items in the target are preserved/);
  assert.match(ui, /active job, and its linked-device memberships will then be permanently deleted/);
});
