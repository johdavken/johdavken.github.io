"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const recoveryApi = require("./workspace-recovery.js");

function fakeClient(handlers = {}){
  const calls = [];
  return {
    calls,
    async rpc(name, args){
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { message: `unhandled rpc ${name}` } };
      return handler(args);
    }
  };
}

test("with no client every call fails locally without a network attempt", async () => {
  const service = recoveryApi.create({});
  assert.equal((await service.listWorkspaces("user-1")).ok, false);
  assert.equal((await service.getWorkspaceDetails("ws-1")).ok, false);
  assert.equal((await service.addDeviceToWorkspace({ workspaceId: "ws-1", targetUserId: "u", deviceId: "d" })).ok, false);
  assert.equal((await service.removeWorkspaceMember({ workspaceId: "ws-1", memberUserId: "u" })).ok, false);
  assert.equal((await service.deleteWorkspace({ workspaceId: "ws-1" })).ok, false);
  assert.equal((await service.mergeWorkspace({ sourceWorkspaceId: "ws-1", targetWorkspaceId: "ws-2" })).ok, false);
});

test("listWorkspaces calls the admin RPC with the current RT Sync identity and returns rows unmodified", async () => {
  const rows = [{ workspace_id: "ws-1", workspace_name: "Line 8", member_count: 2, recipe_count: 3, receiver_weight_profile_count: 1, is_current_device_member: false }];
  const client = fakeClient({ admin_list_line_workspaces: () => ({ data: rows, error: null }) });
  const service = recoveryApi.create({ client });
  const result = await service.listWorkspaces("user-1");
  assert.equal(result.ok, true);
  assert.deepEqual(result.workspaces, rows);
  assert.deepEqual(client.calls[0], { name: "admin_list_line_workspaces", args: { p_current_rt_sync_user_id: "user-1" } });
});

test("listWorkspaces passes null when no current identity is known yet", async () => {
  const client = fakeClient({ admin_list_line_workspaces: () => ({ data: [], error: null }) });
  const service = recoveryApi.create({ client });
  await service.listWorkspaces("");
  assert.equal(client.calls[0].args.p_current_rt_sync_user_id, null);
});

test("addDeviceToWorkspace requires all identifiers before calling the RPC", async () => {
  const client = fakeClient({ admin_add_device_to_workspace: () => ({ data: [{ member_role: "member", already_member: false }], error: null }) });
  const service = recoveryApi.create({ client });
  const missing = await service.addDeviceToWorkspace({ workspaceId: "ws-1", targetUserId: "", deviceId: "d-1" });
  assert.equal(missing.ok, false);
  assert.equal(client.calls.length, 0);
});

test("addDeviceToWorkspace reports a harmless already-member result rather than an error", async () => {
  const client = fakeClient({
    admin_add_device_to_workspace: () => ({ data: [{ workspace_id: "ws-1", member_user_id: "u-1", member_role: "member", already_member: true }], error: null })
  });
  const service = recoveryApi.create({ client });
  const result = await service.addDeviceToWorkspace({ workspaceId: "ws-1", targetUserId: "u-1", deviceId: "d-1", deviceLabel: "Line 8 Desktop" });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyMember, true);
  assert.equal(result.role, "member");
  assert.deepEqual(client.calls[0].args, {
    p_workspace_id: "ws-1", p_target_user_id: "u-1", p_device_id: "d-1", p_device_label: "Line 8 Desktop"
  });
});

test("failure messages are understandable and never leak raw Postgres/Supabase detail", async () => {
  const cases = [
    ["admin_access_required", "Admin access is required."],
    ["workspace_not_found", "That workspace no longer exists."],
    ["invalid_target_identity", "This device's RT Sync identity is not valid for recovery."],
    ["device_already_in_use", "That device ID is already registered to a different member of this workspace."]
  ];
  for (const [code, message] of cases) {
    const client = fakeClient({
      admin_add_device_to_workspace: () => ({ data: null, error: { message: code } }),
      admin_remove_workspace_member: () => ({ data: null, error: { message: code } })
    });
    const service = recoveryApi.create({ client });
    const addResult = await service.addDeviceToWorkspace({ workspaceId: "ws-1", targetUserId: "u-1", deviceId: "d-1" });
    assert.equal(addResult.ok, false);
    assert.equal(addResult.message, message);
    assert.doesNotMatch(addResult.message, /pg_|postgres|jwt|42501|23505/i);
  }
});

test("removeWorkspaceMember calls the admin RPC with the workspace and member only", async () => {
  const client = fakeClient({ admin_remove_workspace_member: () => ({ data: true, error: null }) });
  const service = recoveryApi.create({ client });
  const result = await service.removeWorkspaceMember({ workspaceId: "ws-1", memberUserId: "u-2" });
  assert.equal(result.ok, true);
  assert.deepEqual(client.calls[0], { name: "admin_remove_workspace_member", args: { p_workspace_id: "ws-1", p_member_user_id: "u-2" } });
});

test("deleteWorkspace calls the dedicated admin RPC", async () => {
  const client = fakeClient({ admin_delete_line_workspace: () => ({ data: true, error: null }) });
  const service = recoveryApi.create({ client });
  const result = await service.deleteWorkspace({ workspaceId: "ws-1" });
  assert.equal(result.ok, true);
  assert.deepEqual(client.calls[0], { name: "admin_delete_line_workspace", args: { p_workspace_id: "ws-1" } });
});

test("mergeWorkspace copies into a distinct target through the dedicated admin RPC", async () => {
  const client = fakeClient({
    admin_merge_line_workspaces: () => ({ data: [{ recipes_merged: 3, receiver_weight_profiles_merged: 2 }], error: null })
  });
  const service = recoveryApi.create({ client });
  assert.equal((await service.mergeWorkspace({ sourceWorkspaceId: "ws-1", targetWorkspaceId: "ws-1" })).ok, false);
  const result = await service.mergeWorkspace({ sourceWorkspaceId: "ws-1", targetWorkspaceId: "ws-2" });
  assert.deepEqual(result, { ok: true, recipesMerged: 3, profilesMerged: 2 });
  assert.deepEqual(client.calls[0], {
    name: "admin_merge_line_workspaces",
    args: { p_source_workspace_id: "ws-1", p_target_workspace_id: "ws-2" }
  });
});

test("transferOwnership requires a workspace and member before calling the RPC", async () => {
  const client = fakeClient({ admin_transfer_workspace_ownership: () => ({ data: [{}], error: null }) });
  const service = recoveryApi.create({ client });
  const missing = await service.transferOwnership({ workspaceId: "ws-1", newOwnerUserId: "" });
  assert.equal(missing.ok, false);
  assert.equal(client.calls.length, 0);
});

test("transferOwnership calls the dedicated admin RPC, distinct from adding a device", async () => {
  const client = fakeClient({
    admin_transfer_workspace_ownership: () => ({
      data: [{ workspace_id: "ws-1", previous_owner_user_id: "old-owner", new_owner_user_id: "new-owner" }],
      error: null
    })
  });
  const service = recoveryApi.create({ client });
  const result = await service.transferOwnership({ workspaceId: "ws-1", newOwnerUserId: "new-owner" });
  assert.equal(result.ok, true);
  assert.equal(result.previousOwnerUserId, "old-owner");
  assert.equal(result.newOwnerUserId, "new-owner");
  assert.deepEqual(client.calls[0], {
    name: "admin_transfer_workspace_ownership",
    args: { p_workspace_id: "ws-1", p_new_owner_user_id: "new-owner" }
  });
});

test("transferOwnership surfaces a clear message when the target isn't a member yet", async () => {
  const client = fakeClient({
    admin_transfer_workspace_ownership: () => ({ data: null, error: { message: "new_owner_must_be_a_member" } })
  });
  const service = recoveryApi.create({ client });
  const result = await service.transferOwnership({ workspaceId: "ws-1", newOwnerUserId: "not-a-member" });
  assert.equal(result.ok, false);
  assert.match(result.message, /before reassigning ownership/i);
});

test("getWorkspaceDetails returns the member list from the admin RPC", async () => {
  const members = [{ member_user_id: "u-1", member_role: "owner", member_device_label: "Line 8 Desktop" }];
  const client = fakeClient({ admin_get_workspace_details: () => ({ data: members, error: null }) });
  const service = recoveryApi.create({ client });
  const result = await service.getWorkspaceDetails("ws-1");
  assert.equal(result.ok, true);
  assert.deepEqual(result.members, members);
});
