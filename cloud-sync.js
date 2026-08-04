(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynCloudSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeName(value){ return String(value || "").trim().replace(/\s+/g, " "); }
  function normalizedKey(value){ return normalizeName(value).toLocaleLowerCase(); }
  function ownMembershipsByWorkspace(rows, userId){
    return new Map(
      (Array.isArray(rows) ? rows : [])
        .filter(item=>item?.user_id === userId)
        .map(item=>[item.workspace_id, item])
    );
  }
  function uuid(){
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character=>{
      const random = Math.random() * 16 | 0;
      return (character === "x" ? random : (random & 3 | 8)).toString(16);
    });
  }
  function defaultDeviceLabel(){
    const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    return mobile ? "Operator Phone" : "Resin.Tools Desktop";
  }
  function isConflictError(error){
    const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
    return text.includes("40001") || text.includes("revision_conflict");
  }

  function create(options){
    const config = options.config || {};
    const syncStorage = options.syncStorage;
    const storage = options.storage;
    const adapter = options.adapter;
    const sdk = options.supabaseLibrary;
    // Reuses the existing, already-tested field-scoped comparator from
    // active-job.js rather than a second one; falls back to the global UMD
    // export so no other caller needs to change how it wires this module up.
    const activeJobLib = options.activeJob || (typeof globalThis !== "undefined" ? globalThis.PolynActiveJob : null);
    const store = syncStorage?.createStore(storage);
    const enabled = !!(config.enabled && config.url && config.publishableKey && sdk?.createClient && store);
    const state = {
      enabled,
      available: false,
      status: enabled ? "Connecting" : "Local only",
      message: enabled ? "Preparing RT Sync…" : "RT Sync is unavailable; local mode is active.",
      userId: "",
      deviceLabel: "",
      connected: false,
      workspaces: [],
      selectedWorkspaceId: "",
      selectedWorkspace: null,
      members: [],
      activeRevision: 0,
      workspaceRevision: 0,
      lastSyncAt: "",
      pendingCount: store?.pendingCount?.() || 0,
      generatedCode: "",
      generatedCodeExpiresAt: "",
      isApplyingRemote: false
    };
    let client = null;
    let channel = null;
    let channelWorkspaceId = "";
    let channelStatus = "";
    let activeUploadTimer = null;
    let flushingActive = false;
    let flushingSetups = false;
    let activeConflictPaused = false;
    let activeInFlightOperationId = "";
    let realtimeAuthListenerRegistered = false;

    function emit(){
      state.pendingCount = store?.pendingCount?.() || 0;
      const current = store?.getSettings?.() || {};
      state.deviceLabel = current.deviceLabel || "";
      state.connected = isConnected();
      adapter.onStateChange?.(JSON.parse(JSON.stringify(state)));
    }
    function setStatus(status, message){
      state.status = status;
      state.message = message || "";
      emit();
    }
    function settings(){ return store.getSettings(); }
    function saveSettings(next){
      const result = store.saveSettings(next);
      if (!result.ok) adapter.onStorageError?.("RT Sync settings could not be saved locally.");
      return result.ok;
    }
    function ensureDeviceSettings(){
      const current = settings();
      if (!current.deviceId) current.deviceId = uuid();
      if (!current.deviceLabel) current.deviceLabel = defaultDeviceLabel();
      if (!Array.isArray(current.disconnectedWorkspaceIds)) current.disconnectedWorkspaceIds = [];
      if (!Array.isArray(current.workspaceCache)) current.workspaceCache = [];
      saveSettings(current);
      return current;
    }
    function workspaceMetadata(workspaceId){
      const metadata = store.getMetadata();
      metadata.workspaces[workspaceId] ||= { activeRevision: 0, workspaceRevision: 0, setups: {}, configCache: {} };
      return { metadata, entry: metadata.workspaces[workspaceId] };
    }
    function saveWorkspaceMetadata(workspaceId, changes){
      const { metadata, entry } = workspaceMetadata(workspaceId);
      Object.assign(entry, changes);
      metadata.lastSyncAt = new Date().toISOString();
      const result = store.saveMetadata(metadata);
      state.lastSyncAt = metadata.lastSyncAt;
      if (!result.ok) adapter.onStorageError?.("RT Sync metadata could not be saved locally.");
    }
    function saveActiveCache(workspaceId, payload){
      const { metadata, entry } = workspaceMetadata(workspaceId);
      entry.activePayload = payload;
      const result = store.saveMetadata(metadata);
      if (!result.ok) adapter.onStorageError?.("The RT Sync job cache could not be saved locally.");
    }
    function selectedId(){ return state.selectedWorkspaceId; }
    function isConnected(){
      const current = settings();
      return !!selectedId() && !current.disconnectedWorkspaceIds.includes(selectedId());
    }
    function rpc(name, args){ return client.rpc(name, args); }

    // Passes the token straight through to the existing client's Realtime
    // transport - never stored, logged, or read back from anywhere else.
    function setRealtimeAuth(accessToken){
      if (accessToken) client?.realtime?.setAuth(accessToken);
    }

    // Reused both right before a channel is created and by the auth-state
    // listener below, so a filtered/unfiltered subscribe always carries the
    // current session's token rather than joining anonymously and being
    // rejected by RLS on delivery.
    async function applyCurrentRealtimeAuth(){
      if (!client) return;
      const current = await client.auth.getSession();
      setRealtimeAuth(current?.data?.session?.access_token);
    }

    // Registered once per client instance (guarded so a second initialize()
    // call - which already creates a new client, an existing, unrelated
    // behavior this fix doesn't change - can't stack a second listener on
    // top). Keeps Realtime's auth current for the lifetime of the page;
    // there is no broader "destroy this cloud-sync instance" lifecycle to
    // hook an unsubscribe into.
    function registerRealtimeAuthListener(){
      if (realtimeAuthListenerRegistered || !client) return;
      realtimeAuthListenerRegistered = true;
      client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION"){
          setRealtimeAuth(session?.access_token);
        } else if (event === "SIGNED_OUT"){
          teardownChannel();
        }
      });
    }

    async function ensureAnonymousSession(){
      const current = await client.auth.getSession();
      if (current.error) throw current.error;
      let session = current.data.session;
      if (!session){
        const signedIn = await client.auth.signInAnonymously();
        if (signedIn.error) throw signedIn.error;
        session = signedIn.data.session;
      }
      state.userId = session?.user?.id || "";
      if (!state.userId) throw new Error("Anonymous authentication did not return a user.");
    }

    async function loadWorkspaces(){
      const memberships = await client
        .from("line_workspace_members")
        .select("workspace_id,user_id,device_id,device_label,role,joined_at,last_seen_at");
      if (memberships.error) throw memberships.error;
      const membershipByWorkspace = ownMembershipsByWorkspace(memberships.data, state.userId);
      const ids = Array.from(membershipByWorkspace.keys());
      let workspaceRows = [];
      if (ids.length){
        const response = await client.from("line_workspaces").select("id,name,revision,created_at,updated_at").in("id", ids);
        if (response.error) throw response.error;
        workspaceRows = response.data;
      }
      state.workspaces = workspaceRows
        .map(workspace=>({ ...workspace, membership: membershipByWorkspace.get(workspace.id) }))
        .sort((left,right)=>left.name.localeCompare(right.name));

      const current = ensureDeviceSettings();
      const known = new Set(state.workspaces.map(item=>item.id));
      let nextId = current.selectedWorkspaceId;
      if (!known.has(nextId)) nextId = state.workspaces[0]?.id || "";
      current.selectedWorkspaceId = nextId;
      current.workspaceCache = state.workspaces;
      saveSettings(current);
      state.selectedWorkspaceId = nextId;
      state.selectedWorkspace = state.workspaces.find(item=>item.id === nextId) || null;
      state.workspaceRevision = state.selectedWorkspace?.revision || 0;
      emit();
      return state.workspaces;
    }

    async function loadMembers(){
      if (!selectedId()) { state.members = []; emit(); return []; }
      const response = await client
        .from("line_workspace_members")
        .select("workspace_id,user_id,device_id,device_label,role,joined_at,last_seen_at")
        .eq("workspace_id", selectedId())
        .order("joined_at", { ascending: true });
      if (response.error) throw response.error;
      state.members = response.data;
      emit();
      return response.data;
    }

    function backup(reason, localPayload, remotePayload){
      const result = store.addBackup({
        id: uuid(), reason, workspaceId: selectedId(), createdAt: new Date().toISOString(),
        local: localPayload || null, remote: remotePayload || null
      });
      if (!result.ok) adapter.onStorageError?.("An RT Sync conflict backup could not be saved.");
    }

    async function applyRemoteActive(row, reason){
      if (!row?.payload) return;
      const validationResult = adapter.validateActiveJob?.(row.payload);
      if (validationResult && !validationResult.valid){
        setStatus("Error", "The shared active job failed validation and was not applied.");
        return;
      }
      state.isApplyingRemote = true;
      try{
        await adapter.applyRemoteActiveJob(row.payload, { reason, revision: row.revision });
        state.activeRevision = Number(row.revision) || 0;
        saveWorkspaceMetadata(selectedId(), { activeRevision: state.activeRevision, activePayload: row.payload });
      }finally{
        state.isApplyingRemote = false;
      }
      setStatus("Synced", "Shared active job is up to date.");
    }

    async function resolveActiveConflict(pending, remoteRow){
      backup("active-job-conflict", pending.payload, remoteRow.payload);
      const choice = await adapter.resolveActiveConflict?.({
        local: pending.payload,
        remote: remoteRow.payload,
        localRevision: pending.expectedRevision,
        remoteRevision: remoteRow.revision
      });
      if (choice === "remote"){
        activeConflictPaused = false;
        store.clearActiveJob(selectedId());
        await applyRemoteActive(remoteRow, "conflict-remote");
        return;
      }
      if (choice === "local"){
        activeConflictPaused = false;
        store.queueActiveJob(selectedId(), {
          ...pending,
          expectedRevision: Number(remoteRow.revision),
          operationId: uuid(),
          createdAt: new Date().toISOString()
        });
        setTimeout(flushActiveJob, 0);
        return;
      }
      activeConflictPaused = true;
      setStatus("Conflict", "Shared and local jobs differ. Synchronization is paused until resolved.");
    }

    async function fetchActiveRow(){
      const response = await client.from("active_jobs")
        .select("workspace_id,payload,revision,last_operation_id,updated_at,updated_by")
        .eq("workspace_id", selectedId()).maybeSingle();
      if (response.error) throw response.error;
      return response.data;
    }

    async function flushActiveJob(){
      if (!state.available || !isConnected() || flushingActive || activeConflictPaused) return;
      const pending = store.getOutbox().activeJobs[selectedId()];
      if (!pending) return;
      flushingActive = true;
      activeInFlightOperationId = pending.operationId;
      let continueWithNewerPending = false;
      setStatus("Syncing", "Uploading active-job changes…");
      try{
        const response = await rpc("update_active_job", {
          p_workspace_id: selectedId(),
          p_payload: pending.payload,
          p_expected_revision: pending.expectedRevision,
          p_operation_id: pending.operationId
        });
        if (response.error){
          if (isConflictError(response.error)){
            const remote = await fetchActiveRow();
            await resolveActiveConflict(pending, remote);
            return;
          }
          throw response.error;
        }
        const row = response.data?.[0];
        if (row){
          state.activeRevision = Number(row.revision);
          saveWorkspaceMetadata(selectedId(), { activeRevision: state.activeRevision, activePayload: row.payload });
        }
        store.clearActiveJob(selectedId(), pending.operationId);
        const newer = store.getOutbox().activeJobs[selectedId()];
        if (newer && newer.operationId !== pending.operationId && row){
          store.queueActiveJob(selectedId(), { ...newer, expectedRevision: Number(row.revision) });
          continueWithNewerPending = true;
        }
        setStatus("Synced", "Active-job changes are synced.");
      }catch(error){
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        const detail = String(error?.message || error?.details || error || "Unknown synchronization error");
        setStatus(
          offline ? "Offline" : "Pending",
          offline
            ? "Changes are safe on this device and will retry when the connection returns."
            : `Changes are safe on this device. Upload failed: ${detail}`
        );
      }finally{
        flushingActive = false;
        activeInFlightOperationId = "";
        emit();
        if (continueWithNewerPending && !activeConflictPaused && state.available && isConnected() && store.getOutbox().activeJobs[selectedId()]){
          setTimeout(flushActiveJob, 0);
        }
      }
    }

    function notifyActiveJobMutation({ immediate = false, kind = "edit" } = {}){
      if (state.isApplyingRemote || !enabled || !isConnected()) return;
      const payload = adapter.getActiveJob();
      const validationResult = adapter.validateActiveJob?.(payload);
      if (validationResult && !validationResult.valid) return;

      // No-op guard: compare against whatever is already queued for this
      // workspace, else the last known accepted/persisted payload for it.
      // Workspace-scoped on both sides, so a different workspace's baseline
      // can never suppress this one's first save.
      const workspaceId = selectedId();
      const queuedPending = store.getOutbox().activeJobs[workspaceId];
      const baseline = queuedPending ? queuedPending.payload : workspaceMetadata(workspaceId).entry.activePayload;
      if (baseline && activeJobLib?.activeJobsEqual?.(baseline, payload)) return;

      const pending = {
        payload,
        expectedRevision: state.activeRevision,
        operationId: uuid(),
        kind,
        createdAt: new Date().toISOString()
      };
      const result = store.queueActiveJob(workspaceId, pending);
      if (!result.ok){ adapter.onStorageError?.("Unsynced active-job changes could not be queued."); return; }
      saveActiveCache(workspaceId, payload);
      emit();
      clearTimeout(activeUploadTimer);
      if (immediate) flushActiveJob();
      else activeUploadTimer = setTimeout(flushActiveJob, 700);
    }

    function setupMetadataByName(entry, name){
      const key = normalizedKey(name);
      return Object.values(entry.setups || {}).find(item=>normalizedKey(item.name) === key && !item.deletedAt) || null;
    }

    async function flushSetupOperations(){
      if (!state.available || !isConnected() || flushingSetups) return;
      flushingSetups = true;
      try{
        let operations = store.getOutbox().setupOperations.filter(item=>item.workspaceId === selectedId());
        for (const operation of operations){
          const rpcName = {
            create: "create_saved_setup", update: "update_saved_setup",
            rename: "rename_saved_setup", delete: "delete_saved_setup"
          }[operation.action];
          if (!rpcName) continue;
          const args = { p_workspace_id: operation.workspaceId, p_setup_id: operation.setupId, p_operation_id: operation.operationId };
          if (operation.action === "create") Object.assign(args, { p_name: operation.name, p_payload: operation.payload });
          if (operation.action === "update") Object.assign(args, { p_payload: operation.payload, p_expected_revision: operation.expectedRevision });
          if (operation.action === "rename") Object.assign(args, { p_name: operation.name, p_expected_revision: operation.expectedRevision });
          if (operation.action === "delete") Object.assign(args, { p_expected_revision: operation.expectedRevision });
          const response = await rpc(rpcName, args);
          if (response.error){
            if (isConflictError(response.error)){
              setStatus("Conflict", `Saved setup “${operation.name || ""}” changed on another device.`);
              break;
            }
            throw response.error;
          }
          const row = response.data?.[0];
          const { metadata, entry } = workspaceMetadata(selectedId());
          entry.setups[operation.setupId] = {
            id: operation.setupId,
            name: row?.name || operation.name,
            revision: Number(row?.revision) || operation.expectedRevision + 1,
            deletedAt: row?.deleted_at || (operation.action === "delete" ? new Date().toISOString() : null)
          };
          store.saveMetadata(metadata);
          saveWorkspaceMetadata(selectedId(), {});
          store.clearSetupOperation(operation.operationId);
        }
        setStatus("Synced", "Saved Line Settings are synced.");
      }catch(error){
        setStatus(navigator.onLine === false ? "Offline" : "Pending", "Saved-setting changes will retry.");
      }finally{
        flushingSetups = false;
        emit();
      }
    }

    function queueSetup(action, details){
      if (!enabled || !isConnected()) return;
      const operation = {
        workspaceId: selectedId(), action, operationId: uuid(), createdAt: new Date().toISOString(), ...details
      };
      const result = store.queueSetupOperation(operation);
      if (!result.ok){ adapter.onStorageError?.("A Saved Line Settings change could not be queued."); return; }
      emit();
      flushSetupOperations();
    }

    function notifySavedSetupUpsert(name, payload){
      const { entry } = workspaceMetadata(selectedId());
      const existing = setupMetadataByName(entry, name);
      const outbox = store.getOutbox();
      const pending = [...outbox.setupOperations].reverse().find(item=>
        item.workspaceId === selectedId() && ["create", "update"].includes(item.action) && normalizedKey(item.name) === normalizedKey(name)
      );
      if (pending){
        store.queueSetupOperation({ ...pending, payload, createdAt: new Date().toISOString() });
        emit();
        flushSetupOperations();
        return;
      }
      queueSetup(existing ? "update" : "create", existing
        ? { setupId: existing.id, name, payload, expectedRevision: existing.revision }
        : { setupId: uuid(), name, payload, expectedRevision: 0 });
    }
    function notifySavedSetupRename(oldName, newName){
      const outbox = store.getOutbox();
      const pendingCreate = outbox.setupOperations.find(item=>
        item.workspaceId === selectedId() && item.action === "create" && normalizedKey(item.name) === normalizedKey(oldName)
      );
      if (pendingCreate){
        store.queueSetupOperation({ ...pendingCreate, name: newName, createdAt: new Date().toISOString() });
        emit();
        flushSetupOperations();
        return;
      }
      const { entry } = workspaceMetadata(selectedId());
      const existing = setupMetadataByName(entry, oldName);
      if (existing) queueSetup("rename", { setupId: existing.id, name: newName, expectedRevision: existing.revision });
    }
    function notifySavedSetupDelete(name){
      const outbox = store.getOutbox();
      const pendingCreate = outbox.setupOperations.find(item=>
        item.workspaceId === selectedId() && item.action === "create" && normalizedKey(item.name) === normalizedKey(name)
      );
      if (pendingCreate){
        outbox.setupOperations = outbox.setupOperations.filter(item=>item.operationId !== pendingCreate.operationId);
        store.saveOutbox(outbox);
        emit();
        return;
      }
      const { entry } = workspaceMetadata(selectedId());
      const existing = setupMetadataByName(entry, name);
      if (existing) queueSetup("delete", { setupId: existing.id, name, expectedRevision: existing.revision });
    }

    async function reconcileSavedSetups({ uploadLocalMissing = false, replaceLocal = false } = {}){
      const response = await client.from("saved_setups")
        .select("id,name,payload,revision,last_operation_id,updated_at,deleted_at")
        .eq("workspace_id", selectedId());
      if (response.error) throw response.error;
      const local = adapter.getSavedConfigs();
      const next = replaceLocal ? {} : { ...local };
      const remoteNames = new Set();
      const { metadata, entry } = workspaceMetadata(selectedId());
      entry.setups = {};
      response.data.forEach(row=>{
        entry.setups[row.id] = { id: row.id, name: row.name, revision: Number(row.revision), deletedAt: row.deleted_at };
        if (row.deleted_at){ delete next[row.name]; return; }
        remoteNames.add(normalizedKey(row.name));
        next[row.name] = row.payload;
      });
      store.getOutbox().setupOperations
        .filter(operation=>operation.workspaceId === selectedId())
        .forEach(operation=>{
          const metadataEntry = entry.setups[operation.setupId];
          const currentName = metadataEntry?.name || operation.name;
          if (operation.action === "delete") delete next[currentName];
          else if (operation.action === "rename"){
            const payload = next[currentName];
            delete next[currentName];
            if (payload) next[operation.name] = payload;
          }else if (operation.payload){
            next[operation.name || currentName] = operation.payload;
          }
        });
      entry.configCache = next;
      store.saveMetadata(metadata);
      saveWorkspaceMetadata(selectedId(), {});
      adapter.replaceSavedConfigs(next);
      if (uploadLocalMissing){
        Object.entries(local).forEach(([name,payload])=>{
          if (!remoteNames.has(normalizedKey(name))) notifySavedSetupUpsert(name,payload);
        });
      }
    }

    async function handleRealtimeActive(payload){
      const row = payload.new;
      // No server-side filter on this subscription (see subscribe()), so
      // events for every workspace arrive here - only act on the one this
      // channel was actually created for, ignore everything else.
      if (!row || row.workspace_id !== channelWorkspaceId || Number(row.revision) <= state.activeRevision) return;
      const pending = store.getOutbox().activeJobs[selectedId()];
      if (activeInFlightOperationId && row.last_operation_id === activeInFlightOperationId){
        state.activeRevision = Number(row.revision);
        if (pending?.operationId === activeInFlightOperationId){
          store.clearActiveJob(selectedId(), pending.operationId);
        }else if (pending){
          store.queueActiveJob(selectedId(), { ...pending, expectedRevision: state.activeRevision });
        }
        saveWorkspaceMetadata(selectedId(), { activeRevision: state.activeRevision, activePayload: row.payload });
        setStatus(pending && pending.operationId !== activeInFlightOperationId ? "Syncing" : "Synced", "Active-job changes are syncing.");
        return;
      }
      if (pending?.operationId === row.last_operation_id){
        store.clearActiveJob(selectedId(), pending.operationId);
        state.activeRevision = Number(row.revision);
        saveWorkspaceMetadata(selectedId(), { activeRevision: state.activeRevision, activePayload: row.payload });
        setStatus("Synced", "Active-job changes are synced.");
        return;
      }
      if (pending){ await resolveActiveConflict(pending, row); return; }
      await applyRemoteActive(row, "realtime");
    }

    // Cleared together so no stale channel/workspace/status combination can
    // ever be read as "still healthy" after teardown.
    async function teardownChannel(){
      if (channel) await client.removeChannel(channel);
      channel = null;
      channelWorkspaceId = "";
      channelStatus = "";
    }

    async function subscribe(){
      const targetId = selectedId();
      const targetConnected = !!targetId && isConnected();
      const healthy = !!channel
        && channelWorkspaceId === targetId
        && targetConnected
        && channelStatus !== "CHANNEL_ERROR"
        && channelStatus !== "TIMED_OUT";
      if (healthy) return;

      if (channel) await teardownChannel();
      if (!targetConnected) return;

      // Must complete before the channel is created/subscribed: otherwise
      // it joins without the current access_token and the server rejects
      // delivered rows under RLS (401 Unauthorized), even though the join
      // itself succeeds.
      await applyCurrentRealtimeAuth();

      channelWorkspaceId = targetId;
      channelStatus = "PENDING";
      // supabase_realtime currently publishes only public.active_jobs;
      // saved_setups/line_workspaces/line_workspace_members refresh through
      // their existing explicit REST/RPC paths (init, workspace selection,
      // reconnect, manual refresh) instead of a live subscription.
      //
      // No `filter` here: the bundled realtime-js 2.15.5 / server combination
      // rejects a workspace_id filter on this table ("invalid column for
      // filter workspace_id"). Temporary workaround until that's resolved -
      // subscribe unfiltered and reject other workspaces' events client-side
      // in handleRealtimeActive instead (guarded against channelWorkspaceId,
      // the id this channel was created for).
      channel = client.channel(`line-sync-${targetId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "active_jobs" }, handleRealtimeActive)
        .subscribe(status=>{
          channelStatus = status;
          if (status === "SUBSCRIBED") setStatus("Synced", "RT Sync is connected.");
          else if (["CHANNEL_ERROR","TIMED_OUT"].includes(status)) setStatus("Pending", "Realtime connection will retry.");
        });
    }

    async function reconcileSelected({ forceRemote = false, uploadLocalMissing = false } = {}){
      if (!selectedId() || !isConnected()) return;
      const { entry } = workspaceMetadata(selectedId());
      state.activeRevision = Number(entry.activeRevision) || 0;
      const remote = await fetchActiveRow();
      const pending = store.getOutbox().activeJobs[selectedId()];
      if (pending && remote && Number(remote.revision) !== Number(pending.expectedRevision)){
        await resolveActiveConflict(pending, remote);
      } else if (pending){
        await flushActiveJob();
      } else if (remote && (forceRemote || Number(remote.revision) > state.activeRevision)){
        await applyRemoteActive(remote, "reconcile");
      } else if (remote){
        state.activeRevision = Number(remote.revision);
      }
      await reconcileSavedSetups({ uploadLocalMissing, replaceLocal: forceRemote && !uploadLocalMissing });
      await loadMembers();
      await subscribe();
      setStatus("Synced", "RT Sync is up to date.");
    }

    async function selectWorkspace(workspaceId, { uploadLocalMissing = false } = {}){
      const workspace = state.workspaces.find(item=>item.id === workspaceId);
      if (!workspace) return;
      const current = ensureDeviceSettings();
      current.selectedWorkspaceId = workspaceId;
      current.disconnectedWorkspaceIds = current.disconnectedWorkspaceIds.filter(id=>id !== workspaceId);
      saveSettings(current);
      state.selectedWorkspaceId = workspaceId;
      state.selectedWorkspace = workspace;
      state.workspaceRevision = workspace.revision;
      const { entry } = workspaceMetadata(workspaceId);
      if (entry.activePayload){
        state.isApplyingRemote = true;
        try{ await adapter.applyRemoteActiveJob(entry.activePayload, { reason: "local-cache", revision: entry.activeRevision }); }
        finally{ state.isApplyingRemote = false; }
      }
      if (entry.configCache) adapter.replaceSavedConfigs(entry.configCache);
      emit();
      await reconcileSelected({ forceRemote: true, uploadLocalMissing });
    }

    async function initialize(){
      const localSettings = ensureDeviceSettings();
      state.workspaces = localSettings.workspaceCache || [];
      state.selectedWorkspaceId = localSettings.selectedWorkspaceId || "";
      state.selectedWorkspace = state.workspaces.find(item=>item.id === state.selectedWorkspaceId) || null;
      if (state.selectedWorkspaceId){
        const { entry } = workspaceMetadata(state.selectedWorkspaceId);
        if (entry.activePayload){
          state.isApplyingRemote = true;
          try{ await adapter.applyRemoteActiveJob(entry.activePayload, { reason: "startup-cache", revision: entry.activeRevision }); }
          finally{ state.isApplyingRemote = false; }
        }
        if (entry.configCache) adapter.replaceSavedConfigs(entry.configCache);
      }
      if (!enabled){ emit(); return state; }
      try{
        client = sdk.createClient(config.url, config.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
        registerRealtimeAuthListener();
        await ensureAnonymousSession();
        state.available = true;
        await loadWorkspaces();
        const current = settings();
        if (selectedId() && !current.disconnectedWorkspaceIds.includes(selectedId())) await reconcileSelected();
        else setStatus("Local only", state.workspaces.length ? "Select a line to resume synchronization." : "Create or join a line when ready.");
      }catch(error){
        state.available = false;
        setStatus("Local only", "RT Sync is unavailable; Resin.Tools remains local and fully usable.");
      }
      return state;
    }

    async function createWorkspace(name, deviceLabel){
      if (!state.available) throw new Error("RT Sync is unavailable.");
      const current = ensureDeviceSettings();
      const workspaceName = normalizeName(name);
      current.deviceLabel = normalizeName(deviceLabel) || current.deviceLabel;
      const pendingCreation = current.pendingWorkspaceCreation;
      const operationId = pendingCreation?.name === workspaceName
        ? pendingCreation.operationId
        : uuid();
      current.pendingWorkspaceCreation = { name: workspaceName, operationId };
      saveSettings(current);
      const response = await rpc("create_workspace", {
        p_name: workspaceName, p_device_id: current.deviceId, p_device_label: current.deviceLabel,
        p_initial_active_job: adapter.getActiveJob(), p_operation_id: operationId
      });
      if (response.error) throw response.error;
      const completedSettings = ensureDeviceSettings();
      if (completedSettings.pendingWorkspaceCreation?.operationId === operationId){
        delete completedSettings.pendingWorkspaceCreation;
        saveSettings(completedSettings);
      }
      await loadWorkspaces();
      const row = response.data[0];
      await selectWorkspace(row.workspace_id, { uploadLocalMissing: true });
      state.activeRevision = Number(row.active_job_revision);
      saveWorkspaceMetadata(row.workspace_id, { activeRevision: state.activeRevision, workspaceRevision: Number(row.workspace_revision) });
      return row;
    }

    async function joinWorkspace(code, deviceLabel){
      if (!state.available) throw new Error("RT Sync is unavailable.");
      const current = ensureDeviceSettings();
      current.deviceLabel = normalizeName(deviceLabel) || current.deviceLabel;
      saveSettings(current);
      const response = await rpc("join_workspace", {
        p_link_code: String(code || "").trim().toUpperCase(),
        p_device_id: current.deviceId, p_device_label: current.deviceLabel
      });
      if (response.error) throw response.error;
      const row = response.data?.[0];
      if (!row) throw new Error("The link code is invalid, expired, or temporarily rate-limited.");
      backup("join-line", adapter.getActiveJob(), row.active_job_payload);
      await loadWorkspaces();
      current.selectedWorkspaceId = row.workspace_id;
      current.disconnectedWorkspaceIds = current.disconnectedWorkspaceIds.filter(id=>id !== row.workspace_id);
      saveSettings(current);
      state.selectedWorkspaceId = row.workspace_id;
      state.selectedWorkspace = state.workspaces.find(item=>item.id === row.workspace_id) || null;
      state.activeRevision = Number(row.active_job_revision);
      await applyRemoteActive({ payload: row.active_job_payload, revision: row.active_job_revision }, "join");
      await reconcileSelected({ forceRemote: true });
      return row;
    }

    async function generateLinkCode(){
      state.generatedCode = "";
      state.generatedCodeExpiresAt = "";
      setStatus("Syncing", "Generating a new link code…");
      const response = await rpc("generate_link_code", { p_workspace_id: selectedId() });
      if (response.error) throw response.error;
      const row = response.data?.[0];
      if (!row?.link_code) throw new Error("RT Sync did not return a link code.");
      state.generatedCode = row.link_code;
      state.generatedCodeExpiresAt = row.expires_at;
      setStatus("Synced", "A new one-time link code is ready for 30 minutes.");
      return row;
    }

    async function renameWorkspace(name){
      const response = await rpc("rename_workspace", {
        p_workspace_id: selectedId(), p_name: normalizeName(name), p_expected_revision: state.workspaceRevision
      });
      if (response.error) throw response.error;
      await loadWorkspaces();
      return response.data[0];
    }

    async function updateDeviceLabel(label){
      const current = ensureDeviceSettings();
      current.deviceLabel = normalizeName(label) || current.deviceLabel;
      saveSettings(current);
      emit();
      if (state.available && selectedId() && isConnected()){
        const response = await rpc("update_device_label", {
          p_workspace_id: selectedId(), p_device_label: current.deviceLabel
        });
        if (response.error) throw response.error;
        await loadMembers();
      }
    }

    async function disconnectLocal(){
      const current = ensureDeviceSettings();
      if (selectedId() && !current.disconnectedWorkspaceIds.includes(selectedId())) current.disconnectedWorkspaceIds.push(selectedId());
      saveSettings(current);
      await teardownChannel();
      setStatus("Local only", "Disconnected on this device. Server membership is preserved.");
    }

    async function leaveWorkspace(){
      const workspaceId = selectedId();
      const response = await rpc("leave_workspace", { p_workspace_id: workspaceId });
      if (response.error) throw response.error;
      const current = ensureDeviceSettings();
      current.disconnectedWorkspaceIds = current.disconnectedWorkspaceIds.filter(id=>id !== workspaceId);
      current.selectedWorkspaceId = "";
      saveSettings(current);
      await loadWorkspaces();
      if (selectedId()) await reconcileSelected({ forceRemote: true });
      else {
        await teardownChannel();
        setStatus("Local only", "This device left RT Sync. Local Resin.Tools data was preserved.");
      }
    }

    async function transferOwnership(userId){
      const response = await rpc("transfer_workspace_ownership", { p_workspace_id: selectedId(), p_new_owner_user_id: userId });
      if (response.error) throw response.error;
      await loadWorkspaces();
      await loadMembers();
    }
    async function removeMember(userId){
      const response = await rpc("remove_workspace_member", { p_workspace_id: selectedId(), p_member_user_id: userId });
      if (response.error) throw response.error;
      await loadMembers();
    }
    async function deleteWorkspace(){
      const workspaceId = selectedId();
      const response = await rpc("delete_workspace", { p_workspace_id: workspaceId, p_expected_revision: state.workspaceRevision });
      if (response.error) throw response.error;
      const current = ensureDeviceSettings();
      current.selectedWorkspaceId = "";
      current.disconnectedWorkspaceIds = current.disconnectedWorkspaceIds.filter(id=>id !== workspaceId);
      saveSettings(current);
      await loadWorkspaces();
      if (selectedId()) await reconcileSelected({ forceRemote: true });
      else {
        await teardownChannel();
        setStatus("Local only", "The shared line workspace was deleted. Local data remains available.");
      }
    }

    async function replaceActiveJob(payload, reason="new-job"){
      backup(reason, adapter.getActiveJob(), null);
      await adapter.applyLocalReplacement(payload);
      notifyActiveJobMutation({ immediate: true, kind: reason });
    }

    async function retry(){
      if (!enabled) return;
      activeConflictPaused = false;
      if (!state.available) await initialize();
      else {
        await reconcileSelected();
        await flushActiveJob();
        await flushSetupOperations();
      }
    }

    async function refreshSelected(){
      if (!enabled) return;
      activeConflictPaused = false;
      if (!state.available) await initialize();
      if (!selectedId()) return;
      const current = ensureDeviceSettings();
      current.disconnectedWorkspaceIds = current.disconnectedWorkspaceIds.filter(id=>id !== selectedId());
      saveSettings(current);
      setStatus("Syncing", "Refreshing the selected line…");
      await reconcileSelected({ forceRemote: true });
    }

    function getWorkspaceConfigurationTransport(){
      if (!client || !state.available || !state.userId) return null;
      return Object.freeze({
        list: (workspaceId, fields) => client.from("workspace_configurations")
          .select(fields).eq("workspace_id", workspaceId),
        rpc: (name, args) => client.rpc(name, args)
      });
    }

    // Narrow, read-only descriptor for admin-assisted device recovery. Exposes
    // only what's needed to identify "this browser's current RT Sync identity"
    // to the separate admin client — never tokens, sessions, or outbox state.
    function getRecoveryDescriptor(){
      const current = settings();
      return Object.freeze({
        ready: !!(state.available && state.userId),
        userId: state.userId || "",
        deviceId: current.deviceId || "",
        deviceLabel: current.deviceLabel || ""
      });
    }

    if (typeof window !== "undefined"){
      window.addEventListener("online", retry);
      document.addEventListener("visibilitychange", ()=>{ if (!document.hidden) retry(); });
    }

    return {
      initialize,
      getState: ()=>JSON.parse(JSON.stringify(state)),
      getWorkspaceConfigurationTransport,
      getRecoveryDescriptor,
      loadWorkspaces,
      notifyActiveJobMutation,
      notifySavedSetupUpsert,
      notifySavedSetupRename,
      notifySavedSetupDelete,
      createWorkspace,
      joinWorkspace,
      selectWorkspace,
      generateLinkCode,
      renameWorkspace,
      updateDeviceLabel,
      disconnectLocal,
      leaveWorkspace,
      transferOwnership,
      removeMember,
      deleteWorkspace,
      replaceActiveJob,
      refreshSelected,
      retry
    };
  }

  return { create, normalizeName, normalizedKey, isConflictError, ownMembershipsByWorkspace };
});
