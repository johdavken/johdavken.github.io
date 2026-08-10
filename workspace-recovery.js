(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynWorkspaceRecovery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function friendlyError(error){
    const source = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (source.includes("admin_access_required")) return "Admin access is required.";
    if (source.includes("authentication_required") || source.includes("not_authenticated")) return "Admin sign-in is required.";
    if (source.includes("workspace_not_found")) return "That workspace no longer exists.";
    if (source.includes("invalid_target_identity")) return "This device's RT Sync identity is not valid for recovery.";
    if (source.includes("device_already_in_use")) return "That device ID is already registered to a different member of this workspace.";
    if (source.includes("invalid_device_label")) return "Device name is too long.";
    if (source.includes("invalid_recovery_input") || source.includes("invalid_workspace_id")) return "Recovery could not be completed: missing information.";
    if (source.includes("membership_not_found")) return "That membership no longer exists.";
    if (source.includes("new_owner_must_be_a_member")) return "Add this device to the workspace before reassigning ownership to it.";
    return "Recovery could not be completed.";
  }

  function create(options = {}){
    const client = options.client || null;

    async function listWorkspaces(currentRtSyncUserId){
      if (!client) return { ok: false, message: "Admin connection is unavailable.", workspaces: [] };
      try{
        const response = await client.rpc("admin_list_line_workspaces", {
          p_current_rt_sync_user_id: currentRtSyncUserId || null
        });
        if (response.error) throw response.error;
        return { ok: true, workspaces: response.data || [] };
      }catch(error){ return { ok: false, message: friendlyError(error), workspaces: [] }; }
    }

    async function getWorkspaceDetails(workspaceId){
      if (!client) return { ok: false, message: "Admin connection is unavailable.", members: [] };
      if (!workspaceId) return { ok: false, message: "A workspace is required.", members: [] };
      try{
        const response = await client.rpc("admin_get_workspace_details", { p_workspace_id: workspaceId });
        if (response.error) throw response.error;
        return { ok: true, members: response.data || [] };
      }catch(error){ return { ok: false, message: friendlyError(error), members: [] }; }
    }

    async function addDeviceToWorkspace({ workspaceId, targetUserId, deviceId, deviceLabel } = {}){
      if (!client) return { ok: false, message: "Admin connection is unavailable." };
      if (!workspaceId || !targetUserId || !deviceId) return { ok: false, message: "This device's RT Sync identity is not ready yet." };
      try{
        const response = await client.rpc("admin_add_device_to_workspace", {
          p_workspace_id: workspaceId,
          p_target_user_id: targetUserId,
          p_device_id: deviceId,
          p_device_label: deviceLabel || null
        });
        if (response.error) throw response.error;
        const row = response.data?.[0];
        return { ok: true, alreadyMember: !!row?.already_member, role: row?.member_role || "member" };
      }catch(error){ return { ok: false, message: friendlyError(error) }; }
    }

    async function transferOwnership({ workspaceId, newOwnerUserId } = {}){
      if (!client) return { ok: false, message: "Admin connection is unavailable." };
      if (!workspaceId || !newOwnerUserId) return { ok: false, message: "A workspace and member are required." };
      try{
        const response = await client.rpc("admin_transfer_workspace_ownership", {
          p_workspace_id: workspaceId,
          p_new_owner_user_id: newOwnerUserId
        });
        if (response.error) throw response.error;
        const row = response.data?.[0];
        return { ok: true, previousOwnerUserId: row?.previous_owner_user_id || "", newOwnerUserId: row?.new_owner_user_id || newOwnerUserId };
      }catch(error){ return { ok: false, message: friendlyError(error) }; }
    }

    async function removeWorkspaceMember({ workspaceId, memberUserId } = {}){
      if (!client) return { ok: false, message: "Admin connection is unavailable." };
      if (!workspaceId || !memberUserId) return { ok: false, message: "A membership is required." };
      try{
        const response = await client.rpc("admin_remove_workspace_member", {
          p_workspace_id: workspaceId,
          p_member_user_id: memberUserId
        });
        if (response.error) throw response.error;
        return { ok: true };
      }catch(error){ return { ok: false, message: friendlyError(error) }; }
    }

    async function deleteWorkspace({ workspaceId } = {}){
      if (!client) return { ok: false, message: "Admin connection is unavailable." };
      if (!workspaceId) return { ok: false, message: "A workspace is required." };
      try{
        const response = await client.rpc("admin_delete_line_workspace", { p_workspace_id: workspaceId });
        if (response.error) throw response.error;
        return { ok: true };
      }catch(error){ return { ok: false, message: friendlyError(error) }; }
    }

    async function mergeWorkspace({ sourceWorkspaceId, targetWorkspaceId } = {}){
      if (!client) return { ok: false, message: "Admin connection is unavailable." };
      if (!sourceWorkspaceId || !targetWorkspaceId || sourceWorkspaceId === targetWorkspaceId) return { ok: false, message: "Choose a different target workspace." };
      try{
        const response = await client.rpc("admin_merge_line_workspaces", {
          p_source_workspace_id: sourceWorkspaceId,
          p_target_workspace_id: targetWorkspaceId
        });
        if (response.error) throw response.error;
        const row = response.data?.[0] || {};
        return { ok: true, recipesMerged: Number(row.recipes_merged || 0), profilesMerged: Number(row.receiver_weight_profiles_merged || 0) };
      }catch(error){ return { ok: false, message: friendlyError(error) }; }
    }

    return { listWorkspaces, getWorkspaceDetails, addDeviceToWorkspace, removeWorkspaceMember, transferOwnership, deleteWorkspace, mergeWorkspace };
  }

  return { friendlyError, create };
});
