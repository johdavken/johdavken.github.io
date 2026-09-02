(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const serviceApi = root.PolynWorkspaceRecovery;
  if (!serviceApi) return;

  let recovery = null;
  let workspaces = [];
  let selectedWorkspaceId = "";
  let selectedWorkspaceRow = null;
  let members = [];
  let listInFlight = false;
  let workspaceDialogMode = "";

  function shortId(id){ return id ? String(id).slice(0, 8) : "—"; }
  function fmtDate(value){ return value ? new Date(value).toLocaleString() : "unknown"; }

  function setMessage(text, type = ""){
    const el = $("workspaceRecoveryMessage");
    if (!el) return;
    el.textContent = text || "";
    el.className = `tiny workspaceRecoveryMessage${type ? ` ${type}` : ""}`;
  }

  function admin(){ return root.PolynResinAdminInstance || null; }
  function bridge(){ return root.PolynRtSyncBridge || null; }

  function ensureRecovery(){
    const adminInstance = admin();
    const client = adminInstance?.getClient?.();
    if (!client) return null;
    if (!recovery) recovery = serviceApi.create({ client });
    return recovery;
  }

  function renderDeviceCard(){
    const descriptor = bridge()?.getRecoveryDescriptor?.() || { ready: false, userId: "", deviceId: "", deviceLabel: "" };
    const label = $("workspaceRecoveryDeviceLabel");
    const status = $("workspaceRecoveryDeviceStatus");
    const ids = $("workspaceRecoveryDeviceIds");
    if (label) label.textContent = descriptor.deviceLabel || "This device";
    if (ids) ids.textContent = `RT Sync user: ${shortId(descriptor.userId)} · Device: ${shortId(descriptor.deviceId)}`;
    if (status){
      if (!descriptor.ready){
        status.textContent = "RT Sync identity not ready yet. Wait for RT Sync to connect, then try again.";
      } else {
        const memberOf = workspaces.filter(w => w.is_current_device_member).map(w => w.workspace_name);
        status.textContent = memberOf.length
          ? `RT Sync ready. Already connected to: ${memberOf.join(", ")}.`
          : "RT Sync ready. Not currently connected to any workspace.";
      }
    }
    const addBtn = $("workspaceRecoveryAddDeviceBtn");
    if (addBtn) addBtn.disabled = !descriptor.ready || !selectedWorkspaceId;
    return descriptor;
  }

  function renderList(){
    const host = $("workspaceRecoveryList");
    const listMeta = $("workspaceRecoveryListMeta");
    if (!host) return;
    host.replaceChildren();
    if (listMeta) listMeta.textContent = `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`;
    if (!workspaces.length){
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No workspaces found.";
      host.append(empty);
      return;
    }
    workspaces.forEach(workspace => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `workspaceRecoveryRow${workspace.workspace_id === selectedWorkspaceId ? " selected" : ""}`;
      const meta = document.createElement("small");
      meta.textContent = `${workspace.member_count} member${workspace.member_count === 1 ? "" : "s"} · ${workspace.recipe_count} recipe${workspace.recipe_count === 1 ? "" : "s"} · ${workspace.receiver_weight_profile_count} weight profile${workspace.receiver_weight_profile_count === 1 ? "" : "s"} · Last activity ${fmtDate(workspace.last_activity_at)}${workspace.is_current_device_member ? " · This device is already a member" : ""}`;
      const title = document.createElement("strong");
      title.textContent = workspace.workspace_name;
      row.append(title, meta);
      row.addEventListener("click", () => selectWorkspace(workspace.workspace_id));
      host.appendChild(row);
    });
  }

  function renderMembers(){
    const host = $("workspaceRecoveryMembersList");
    const count = $("workspaceRecoveryMemberCount");
    if (!host) return;
    host.replaceChildren();
    if (count) count.textContent = String(members.length);
    const descriptor = bridge()?.getRecoveryDescriptor?.() || {};
    if (!members.length){
      const empty = document.createElement("div");
      empty.className = "muted tiny";
      empty.textContent = "No members.";
      host.append(empty);
      return;
    }
    members.forEach(member => {
      const row = document.createElement("div");
      row.className = "workspaceRecoveryMemberRow";
      const isCurrent = member.member_user_id && member.member_user_id === descriptor.userId;
      const info = document.createElement("div");
      info.className = "workspaceRecoveryMemberInfo";
      const name = document.createElement("strong");
      name.textContent = member.member_device_label || "Unnamed device";
      const meta = document.createElement("small");
      meta.className = "mono";
      meta.textContent = `${member.member_role} · ${shortId(member.member_user_id)} · Last seen ${fmtDate(member.member_last_seen_at)}${isCurrent ? " · this device" : ""}`;
      info.append(name, meta);
      row.append(info);
      const actions = document.createElement("div");
      actions.className = "workspaceRecoveryMemberActions";
      if (member.member_role === "member"){
        const makeOwnerBtn = document.createElement("button");
        makeOwnerBtn.type = "button";
        makeOwnerBtn.className = "secondary";
        makeOwnerBtn.textContent = "Make Owner";
        makeOwnerBtn.addEventListener("click", () => confirmMakeOwner(member, makeOwnerBtn));
        actions.append(makeOwnerBtn);
      }
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "danger";
      removeBtn.textContent = "Disconnect";
      removeBtn.addEventListener("click", () => removeMember(member, isCurrent));
      actions.append(removeBtn);
      row.append(actions);
      host.appendChild(row);
    });
  }

  function renderDetail(){
    const panel = $("workspaceRecoveryDetail");
    const transferBtn = $("workspaceRecoveryTransferOwnershipBtn");
    const mergeTarget = $("workspaceRecoveryMergeTarget");
    const mergeBtn = $("workspaceRecoveryMergeBtn");
    if (!panel) return;
    if (!selectedWorkspaceRow){
      panel.hidden = true;
      if (transferBtn) transferBtn.disabled = true;
      if (mergeBtn) mergeBtn.disabled = true;
      const memberCount = $("workspaceRecoveryMemberCount");
      if (memberCount) memberCount.textContent = "0";
      return;
    }
    panel.hidden = false;
    $("workspaceRecoveryDetailName").textContent = selectedWorkspaceRow.workspace_name;
    $("workspaceRecoveryDetailMeta").textContent = `Created ${fmtDate(selectedWorkspaceRow.created_at)} · ${selectedWorkspaceRow.member_count} members · ${selectedWorkspaceRow.recipe_count} recipes · ${selectedWorkspaceRow.receiver_weight_profile_count} weight profiles`;
    renderMembers();
    renderDeviceCard();
    if (transferBtn){
      const descriptor = bridge()?.getRecoveryDescriptor?.();
      const currentMembership = members.find(m => m.member_user_id === descriptor?.userId);
      transferBtn.disabled = !descriptor?.ready || !currentMembership || currentMembership.member_role === "owner";
    }
    if (mergeTarget){
      mergeTarget.replaceChildren();
      const targets = workspaces.filter(workspace => workspace.workspace_id !== selectedWorkspaceId);
      if (!targets.length){
        mergeTarget.append(new Option("No other workspace", ""));
      }else{
        mergeTarget.append(new Option("Choose target workspace…", ""));
        targets.forEach(workspace => mergeTarget.append(new Option(workspace.workspace_name, workspace.workspace_id)));
      }
      mergeTarget.disabled = !targets.length;
      if (mergeBtn) mergeBtn.disabled = !targets.length;
    }
  }

  function setWorkspaceDialogMessage(text, type = ""){
    const el = $("workspaceRecoveryWorkspaceDialogMessage");
    if (!el) return;
    el.textContent = text || "";
    el.className = `tiny mt10${type ? ` ${type}` : ""}`;
  }

  function workspaceOperationMessage(error){
    const raw = String(error?.message || error || "");
    if (/invalid_workspace_name/i.test(raw)) return "Enter a line name between 1 and 80 characters.";
    if (/invalid_(layer|hopper|offset|numeric_job)|unsupported_active_job/i.test(raw)) return "The current desktop setup is incomplete. Finish the Line Setup details, then create the line again.";
    if (/RT Sync is not ready/i.test(raw)) return "RT Sync is still starting. Wait a moment, then try again.";
    return "Could not create the line. No changes were applied.";
  }

  function openWorkspaceDialog(mode){
    const dialog = $("workspaceRecoveryWorkspaceDialog");
    const input = $("workspaceRecoveryWorkspaceName");
    const title = $("workspaceRecoveryWorkspaceDialogTitle");
    const save = $("workspaceRecoveryWorkspaceDialogSave");
    if (!dialog?.showModal || !input || !title || !save) return;
    if (mode === "create" && !bridge()?.getRecoveryDescriptor?.().ready){
      setMessage("RT Sync identity not ready. Wait for RT Sync to connect, then try again.", "bad");
      return;
    }
    if (mode === "rename" && !selectedWorkspaceRow) return;
    workspaceDialogMode = mode;
    title.textContent = mode === "rename" ? "Rename Line" : "Create Line";
    save.textContent = mode === "rename" ? "Save Name" : "Create Line";
    input.value = mode === "rename" ? selectedWorkspaceRow.workspace_name : "";
    setWorkspaceDialogMessage("");
    dialog.showModal();
    input.focus();
    if (mode === "rename") input.select();
  }

  async function saveWorkspaceDialog(event){
    event.preventDefault();
    const service = ensureRecovery();
    const dialog = $("workspaceRecoveryWorkspaceDialog");
    const input = $("workspaceRecoveryWorkspaceName");
    const save = $("workspaceRecoveryWorkspaceDialogSave");
    const name = input?.value.trim() || "";
    if (!service || !name || !save) return;
    save.disabled = true;
    setWorkspaceDialogMessage(workspaceDialogMode === "rename" ? "Renaming line…" : "Creating line…");
    let result;
    if (workspaceDialogMode === "rename"){
      result = await service.renameWorkspace({ workspaceId: selectedWorkspaceId, name });
    } else {
      try{
        const workspace = await bridge()?.createWorkspaceFromSudo?.(name);
        result = workspace ? { ok: true, workspace } : { ok: false, message: "RT Sync is not ready." };
      }catch(error){ result = { ok: false, message: workspaceOperationMessage(error) }; }
    }
    save.disabled = false;
    if (!result.ok){ setWorkspaceDialogMessage(result.message, "bad"); return; }
    const workspace = result.workspace;
    dialog?.close();
    await loadWorkspaces();
    const workspaceId = workspace?.workspace_id || selectedWorkspaceId;
    if (workspaceId) await selectWorkspace(workspaceId);
    setMessage(workspaceDialogMode === "rename" ? `Renamed line to ${name}.` : `Created ${name} and connected this desktop.`, "ok");
    workspaceDialogMode = "";
  }

  async function loadWorkspaces(){
    const service = ensureRecovery();
    if (!service || listInFlight) return;
    listInFlight = true;
    setMessage("Loading workspaces…");
    const descriptor = bridge()?.getRecoveryDescriptor?.();
    const result = await service.listWorkspaces(descriptor?.userId || null);
    listInFlight = false;
    if (!result.ok){ setMessage(result.message, "bad"); return; }
    workspaces = result.workspaces;
    if (selectedWorkspaceId){
      selectedWorkspaceRow = workspaces.find(w => w.workspace_id === selectedWorkspaceId) || null;
      if (!selectedWorkspaceRow) selectedWorkspaceId = "";
    }
    renderList();
    renderDetail();
    renderDeviceCard();
    setMessage(`${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} loaded.`, "ok");
  }

  async function selectWorkspace(workspaceId){
    const service = ensureRecovery();
    if (!service) return;
    selectedWorkspaceId = workspaceId;
    selectedWorkspaceRow = workspaces.find(w => w.workspace_id === workspaceId) || null;
    renderList();
    setMessage("Loading workspace details…");
    const result = await service.getWorkspaceDetails(workspaceId);
    if (!result.ok){ setMessage(result.message, "bad"); return; }
    members = result.members.filter(m => m.member_user_id);
    renderDetail();
    setMessage("");
  }

  function confirmAddDevice(){
    if (!selectedWorkspaceRow) return;
    const descriptor = bridge()?.getRecoveryDescriptor?.();
    if (!descriptor?.ready){ setMessage("RT Sync identity not ready. Wait for RT Sync to connect, then try again.", "bad"); return; }
    const dialog = $("workspaceRecoveryConfirmDialog");
    const details = $("workspaceRecoveryConfirmDetails");
    if (!dialog?.showModal) return;
    details.innerHTML = "";
    const lines = [
      `Workspace: ${selectedWorkspaceRow.workspace_name}`,
      `Device: ${descriptor.deviceLabel || "This device"}`,
      "",
      "This will:",
      "• add this browser's current RT Sync identity to " + selectedWorkspaceRow.workspace_name + ";",
      "• restore access to the workspace and its shared configurations.",
      "",
      "This will not:",
      "• delete the previous device membership;",
      "• delete recipes or weight profiles;",
      "• change another device's access;",
      "• transfer workspace ownership."
    ];
    lines.forEach(line => {
      const p = document.createElement("div");
      p.textContent = line;
      details.append(p);
    });
    dialog.addEventListener("close", () => {
      if (dialog.returnValue === "confirm") void addDevice();
    }, { once: true });
    dialog.showModal();
  }

  async function addDevice(){
    const service = ensureRecovery();
    if (!service || !selectedWorkspaceRow) return;
    const descriptor = bridge()?.getRecoveryDescriptor?.();
    if (!descriptor?.ready){ setMessage("RT Sync identity not ready. Wait for RT Sync to connect, then try again.", "bad"); return; }
    const addBtn = $("workspaceRecoveryAddDeviceBtn");
    if (addBtn) addBtn.disabled = true;
    setMessage("Connecting this device…");
    const workspaceName = selectedWorkspaceRow.workspace_name;
    const workspaceId = selectedWorkspaceRow.workspace_id;
    const result = await service.addDeviceToWorkspace({
      workspaceId,
      targetUserId: descriptor.userId,
      deviceId: descriptor.deviceId,
      deviceLabel: descriptor.deviceLabel
    });
    if (addBtn) addBtn.disabled = false;
    if (!result.ok){ setMessage(result.message, "bad"); return; }
    setMessage(`This device is now connected to ${workspaceName}.`, "ok");
    await bridge()?.reconnectAfterRecovery?.(workspaceId);
    await loadWorkspaces();
    await selectWorkspace(workspaceId);
  }

  // Shared by both ownership-reassignment entry points: the dedicated
  // "Reassign Ownership to This Device" button (recovery flow, always
  // targets this browser's own identity) and each member row's "Make
  // Owner" button (targets that specific already-listed member). Same
  // underlying admin RPC, same warning, same confirmation dialog.
  function ownershipConfirmLines(newOwnerLabel){
    return [
      `Workspace: ${selectedWorkspaceRow.workspace_name}`,
      `New owner: ${newOwnerLabel}`,
      "",
      "This will:",
      "• make " + newOwnerLabel + " the owner of " + selectedWorkspaceRow.workspace_name + ";",
      "• demote the previous owner's membership row to an ordinary member (it is not deleted).",
      "",
      "This will not:",
      "• delete any membership, recipes, or weight profiles;",
      "• change other devices' access.",
      "",
      "Only do this if the previous owner's device is genuinely gone — Resin.Tools cannot verify that from here. If the previous owner is actually still active elsewhere, it will be demoted to an ordinary member."
    ];
  }

  function showOwnershipConfirmDialog(newOwnerLabel, onConfirm){
    const dialog = $("workspaceRecoveryOwnershipConfirmDialog");
    const details = $("workspaceRecoveryOwnershipConfirmDetails");
    if (!dialog?.showModal) return;
    details.innerHTML = "";
    ownershipConfirmLines(newOwnerLabel).forEach(line => {
      const p = document.createElement("div");
      p.textContent = line;
      details.append(p);
    });
    dialog.addEventListener("close", () => {
      if (dialog.returnValue === "confirm") void onConfirm();
    }, { once: true });
    dialog.showModal();
  }

  function confirmTransferOwnership(){
    if (!selectedWorkspaceRow) return;
    const descriptor = bridge()?.getRecoveryDescriptor?.();
    if (!descriptor?.ready) return;
    showOwnershipConfirmDialog(descriptor.deviceLabel || "This device", transferOwnership);
  }

  async function transferOwnership(){
    const service = ensureRecovery();
    if (!service || !selectedWorkspaceRow) return;
    const descriptor = bridge()?.getRecoveryDescriptor?.();
    if (!descriptor?.ready) return;
    const transferBtn = $("workspaceRecoveryTransferOwnershipBtn");
    if (transferBtn) transferBtn.disabled = true;
    setMessage("Reassigning ownership…");
    const workspaceName = selectedWorkspaceRow.workspace_name;
    const workspaceId = selectedWorkspaceRow.workspace_id;
    const result = await service.transferOwnership({ workspaceId, newOwnerUserId: descriptor.userId });
    if (!result.ok){ setMessage(result.message, "bad"); if (transferBtn) transferBtn.disabled = false; return; }
    setMessage(`This device is now the owner of ${workspaceName}.`, "ok");
    await loadWorkspaces();
    await selectWorkspace(workspaceId);
  }

  function confirmMakeOwner(member, makeOwnerBtn){
    if (!selectedWorkspaceRow) return;
    const label = member.member_device_label || "this device";
    showOwnershipConfirmDialog(label, () => makeOwner(member, makeOwnerBtn));
  }

  async function makeOwner(member, makeOwnerBtn){
    const service = ensureRecovery();
    if (!service || !selectedWorkspaceRow) return;
    if (makeOwnerBtn) makeOwnerBtn.disabled = true;
    setMessage("Reassigning ownership…");
    const workspaceName = selectedWorkspaceRow.workspace_name;
    const workspaceId = selectedWorkspaceRow.workspace_id;
    const label = member.member_device_label || "this device";
    const result = await service.transferOwnership({ workspaceId, newOwnerUserId: member.member_user_id });
    if (!result.ok){ setMessage(result.message, "bad"); if (makeOwnerBtn) makeOwnerBtn.disabled = false; return; }
    setMessage(`${label} is now the owner of ${workspaceName}.`, "ok");
    await loadWorkspaces();
    await selectWorkspace(workspaceId);
  }

  async function removeMember(member, isCurrent){
    const service = ensureRecovery();
    if (!service || !selectedWorkspaceId) return;
    const label = member.member_device_label || "this device";
    const ownerWarning = member.member_role === "owner"
      ? " This is the workspace owner; disconnecting it can leave the workspace without an owner."
      : "";
    const warning = isCurrent
      ? `${label} is the device you just recovered. Disconnect it anyway?${ownerWarning}`
      : `Disconnect ${label} from this workspace?${ownerWarning}`;
    if (!confirm(warning)) return;
    const result = await service.removeWorkspaceMember({ workspaceId: selectedWorkspaceId, memberUserId: member.member_user_id });
    if (!result.ok){ setMessage(result.message, "bad"); return; }
    setMessage("Device disconnected. Its next RT Sync request will be denied.", "ok");
    await loadWorkspaces();
    await selectWorkspace(selectedWorkspaceId);
  }

  async function deleteWorkspace(){
    const service = ensureRecovery();
    if (!service || !selectedWorkspaceRow) return;
    const workspaceId = selectedWorkspaceRow.workspace_id;
    const name = selectedWorkspaceRow.workspace_name;
    if (!confirm(`Permanently delete “${name}”? This deletes its active job, recipes, weight profiles, and every linked-device membership. This cannot be undone.`)) return;
    const button = $("workspaceRecoveryDeleteWorkspaceBtn");
    if (button) button.disabled = true;
    setMessage("Deleting workspace…");
    const result = await service.deleteWorkspace({ workspaceId });
    if (button) button.disabled = false;
    if (!result.ok){ setMessage(result.message, "bad"); return; }
    selectedWorkspaceId = "";
    selectedWorkspaceRow = null;
    members = [];
    await loadWorkspaces();
    setMessage(`Deleted ${name}.`, "ok");
  }

  async function mergeWorkspace(){
    const service = ensureRecovery();
    const targetSelect = $("workspaceRecoveryMergeTarget");
    if (!service || !selectedWorkspaceRow || !targetSelect?.value) return;
    const sourceWorkspaceId = selectedWorkspaceRow.workspace_id;
    const sourceName = selectedWorkspaceRow.workspace_name;
    const targetWorkspaceId = targetSelect.value;
    const targetName = workspaces.find(workspace => workspace.workspace_id === targetWorkspaceId)?.workspace_name || "the selected workspace";
    const warning = `Merge “${sourceName}” into “${targetName}”? Recipes and receiver-weight profiles will be copied. Existing same-name items in the target are preserved; imported duplicates are renamed with “(from ${sourceName})”. “${sourceName}”, its active job, and its linked-device memberships will then be permanently deleted.`;
    if (!confirm(warning)) return;
    const button = $("workspaceRecoveryMergeBtn");
    if (button) button.disabled = true;
    setMessage("Merging workspace…");
    const result = await service.mergeWorkspace({ sourceWorkspaceId, targetWorkspaceId });
    if (button) button.disabled = false;
    if (!result.ok){ setMessage(result.message, "bad"); return; }
    selectedWorkspaceId = "";
    selectedWorkspaceRow = null;
    members = [];
    await loadWorkspaces();
    setMessage(`Merged ${result.recipesMerged} recipe${result.recipesMerged === 1 ? "" : "s"} and ${result.profilesMerged} weight profile${result.profilesMerged === 1 ? "" : "s"} into ${targetName}; deleted ${sourceName}.`, "ok");
  }

  function resetPanel(){
    workspaces = [];
    selectedWorkspaceId = "";
    selectedWorkspaceRow = null;
    members = [];
    recovery = null;
    setMessage("");
    renderList();
    renderDetail();
    const panel = $("workspaceManagementBlock");
    if (panel?.classList.contains("desktop-active") || panel?.open){
      document.querySelector('[data-workspace-target="resultsBlock"]')?.click();
    }
    if (panel) panel.open = false;
  }

  function renderAccess(state){
    const initializing = !state?.ready;
    const adminAccess = !initializing && !!state?.isAdmin;
    const button = $("workspaceManagementButton");
    if (button) button.hidden = initializing || !adminAccess;
    if (!adminAccess) resetPanel();
  }

  const adminInstance = admin();
  if (adminInstance){
    adminInstance.subscribe(renderAccess);
    renderAccess(adminInstance.getState());
  }

  $("workspaceManagementButton")?.addEventListener("click", async () => {
    if (!admin()?.getState().isAdmin) return;
    $("workspaceManagementBlock").open = true;
    renderDeviceCard();
    await loadWorkspaces();
  });

  // Public entry point for other admin panels (see conflict storm alerts in
  // database-health-ui.js) that need to land an admin directly on a specific
  // workspace's Workspace Management detail, instead of the operator having
  // to find it in the list themselves.
  async function openWorkspace(workspaceId){
    if (!admin()?.getState().isAdmin || !workspaceId) return;
    $("workspaceManagementBlock").open = true;
    renderDeviceCard();
    await loadWorkspaces();
    await selectWorkspace(workspaceId);
  }
  root.PolynWorkspaceRecoveryUI = { openWorkspace };
  $("workspaceRecoveryRefreshBtn")?.addEventListener("click", () => void loadWorkspaces());
  $("workspaceRecoveryCreateWorkspaceBtn")?.addEventListener("click", () => openWorkspaceDialog("create"));
  $("workspaceRecoveryRenameWorkspaceBtn")?.addEventListener("click", () => openWorkspaceDialog("rename"));
  $("workspaceRecoveryWorkspaceForm")?.addEventListener("submit", event => void saveWorkspaceDialog(event));
  $("workspaceRecoveryWorkspaceDialog")?.querySelector("[data-workspace-recovery-dialog-close]")?.addEventListener("click", () => {
    workspaceDialogMode = "";
    $("workspaceRecoveryWorkspaceDialog")?.close();
  });
  $("workspaceRecoveryDetailRefreshBtn")?.addEventListener("click", () => { if (selectedWorkspaceId) void selectWorkspace(selectedWorkspaceId); });
  $("workspaceRecoveryAddDeviceBtn")?.addEventListener("click", confirmAddDevice);
  $("workspaceRecoveryTransferOwnershipBtn")?.addEventListener("click", confirmTransferOwnership);
  $("workspaceRecoveryDeleteWorkspaceBtn")?.addEventListener("click", () => void deleteWorkspace());
  $("workspaceRecoveryMergeBtn")?.addEventListener("click", () => void mergeWorkspace());
})(typeof globalThis !== "undefined" ? globalThis : this);
