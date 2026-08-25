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
  // Membership was revoked (or the workspace is gone) - every RPC this
  // device's queued outbox items depend on raises this from the server
  // side, and no amount of retrying will ever make it succeed. Distinct
  // from isConflictError, which is transient (retrying after reconciling
  // does resolve it).
  function isAccessDeniedError(error){
    const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
    return text.includes("42501") || text.includes("workspace_access_denied");
  }
  // This device's session went stale (expired access token, a wedged
  // background refresh) rather than a plain network hiccup. Distinct from
  // both of the above: retrying the same upload against the same dead
  // session would just fail the same way again, so retry() uses this to
  // decide whether to re-establish the session first. False positives are
  // cheap (re-checking an already-good session is a harmless no-op), so
  // this is intentionally broad rather than tied to one exact message.
  function isAuthError(error){
    if (error?.status === 401 || error?.statusCode === 401) return true;
    const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
    return text.includes("authapierror") || text.includes("authsessionmissingerror")
      || text.includes("session_not_found") || text.includes("jwt");
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
      pendingSummary: [],
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
    let lastAutoRetryAt = 0;
    // Set by flushActiveJob's workspace_access_denied branch, reset at the
    // top of every retry() cycle - see retry()'s own comment for why.
    let lastActiveFlushDenied = false;
    // True for the duration of a single resolveActiveConflict() call, from
    // any of its three entry points (flushActiveJob, reconcileSelected,
    // handleRealtimeActive). Only flushActiveJob's own re-entrancy used to
    // be guarded (flushingActive) - a Realtime push arriving mid-resolution
    // could start a second, fully independent one: a second dialog.showModal()
    // on top of one already open (which throws), or a second overlapping
    // write. See resolveActiveConflict's own comment for the full story.
    let resolvingActiveConflict = false;
    // Set by flushActiveJob/flushSetupOperations on an auth-shaped failure
    // (isAuthError), consumed once by the next retry() - see retry()'s own
    // comment for why re-authenticating belongs there and not in the
    // catch blocks that notice it.
    let lastActiveFlushAuthError = false;

    /* ------------------------------------------------------------------
     *   Active-job conflict circuit breaker
     * ------------------------------------------------------------------
     * A conflict is normally rare and operator-paced: two people edit the
     * same line, one is asked which version wins, and it is over. Anything
     * arriving faster than a person can click is not that - it is a loop
     * between this module and whatever is regenerating the mutation, and
     * every turn of it costs a failed write against the database.
     *
     * This is deliberately a rate breaker rather than a consecutive-failure
     * counter. A loop can "resolve" each conflict successfully and still be
     * a loop, which would keep resetting a streak counter forever; what
     * actually identifies the condition is the rate, whatever shape the
     * cycle has. Past the budget, synchronization pauses exactly as an
     * unresolved conflict already does - local work stays safe on the
     * device, and the operator gets the existing Retry path back.
     *
     * The floor of one hard cap plus growing backoff is on purpose: even
     * below the budget, conflicts never retry instantly. */
    const CONFLICT_BURST_LIMIT = 12;
    const CONFLICT_BURST_WINDOW_MS = 10000;
    const CONFLICT_RETRY_BASE_MS = 400;
    const CONFLICT_RETRY_MAX_MS = 8000;
    let recentConflictTimes = [];

    function recordConflict(){
      const now = Date.now();
      recentConflictTimes = recentConflictTimes.filter(at=>now - at < CONFLICT_BURST_WINDOW_MS);
      recentConflictTimes.push(now);
      return recentConflictTimes.length;
    }
    function conflictRetryDelay(){
      const step = Math.max(1, recentConflictTimes.length);
      return Math.min(CONFLICT_RETRY_BASE_MS * Math.pow(2, step - 1), CONFLICT_RETRY_MAX_MS);
    }
    function clearConflictBudget(){ recentConflictTimes = []; }
    // Records one conflict against the budget and reports whether that was
    // the one that trips the breaker. Callers that get true must stop -
    // synchronization is now paused and the queued change stays on the
    // device for the operator's Retry.
    function tripIfConflictBursting(){
      if (recordConflict() < CONFLICT_BURST_LIMIT) return false;
      activeConflictPaused = true;
      clearConflictBudget();
      setStatus("Conflict", "Synchronization paused: this line kept conflicting faster than it could settle. Local work is safe on this device - use Retry once the other device has finished.");
      return true;
    }

    // Raw kind/action strings only - which internal mutation "kind" values
    // mean what is a UI presentation concern, not this module's.
    function buildPendingSummary(){
      const outbox = store?.getOutbox?.() || { activeJobs: {}, setupOperations: [] };
      const workspaceName = (id) => state.workspaces.find(w=>w.id === id)?.name || null;
      const items = [];
      Object.entries(outbox.activeJobs).forEach(([workspaceId, pending])=>{
        items.push({
          type: "active-job",
          workspaceId,
          workspaceName: workspaceName(workspaceId),
          kind: pending?.kind || "edit",
          createdAt: pending?.createdAt || "",
          operationId: pending?.operationId || ""
        });
      });
      outbox.setupOperations.forEach(operation=>{
        items.push({
          type: "saved-setup",
          workspaceId: operation.workspaceId,
          workspaceName: workspaceName(operation.workspaceId),
          action: operation.action,
          name: operation.name || "",
          createdAt: operation.createdAt || "",
          operationId: operation.operationId || ""
        });
      });
      return items;
    }
    // Permanently discards one pending-outbox item without ever trying to
    // sync it - the only recovery for an entry pinned to a workspace this
    // device is no longer a member of, which flushActiveJob/
    // flushSetupOperations (both scoped to the *selected* workspace) can
    // never reach no matter how many times sync retries.
    function discardPendingItem(item){
      if (!item || !item.type) return { ok: false };
      if (item.type === "active-job") store.clearActiveJob(item.workspaceId, item.operationId);
      else if (item.type === "saved-setup") store.clearSetupOperation(item.operationId);
      else return { ok: false };
      emit();
      return { ok: true };
    }
    function emit(){
      state.pendingCount = store?.pendingCount?.() || 0;
      state.pendingSummary = buildPendingSummary();
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
    // "Synced" is only accurate when the whole local outbox is empty - not
    // just the specific workspace/operation the caller happens to have just
    // finished with. Without this, a stuck change for a different workspace
    // (or a saved-setup operation) gets silently overwritten by an unrelated
    // "Synced" label, showing "Synced (2)" - accurate count, false status.
    function setSyncedStatus(syncedMessage, pendingMessage){
      if (store.pendingCount() === 0) setStatus("Synced", syncedMessage);
      else setStatus("Pending", pendingMessage);
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
    // No request here is allowed to hang forever. A single stuck connection
    // used to pin flushingActive (and, through runLineSyncAction,
    // lineSyncActionInFlight) true for the life of the page: synchronization
    // silently dead, the RT Sync panel's own controls dead with it, and no
    // way back short of a reload. Observed live on 2026-08-20 - one
    // update_active_job POST that never returned, while the identical call
    // from the same page answered in 214ms.
    //
    // An abort surfaces as an ordinary response error, so it is classified
    // as neither a conflict nor access-denied nor an auth failure: the
    // queued change stays on the device and retries, which is exactly how
    // any other transient network failure already behaves.
    const REQUEST_TIMEOUT_MS = 20000;
    function withRequestTimeout(builder){
      if (typeof AbortController === "undefined" || typeof builder?.abortSignal !== "function"){
        return Promise.resolve(builder);
      }
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(), REQUEST_TIMEOUT_MS);
      return Promise.resolve(builder.abortSignal(controller.signal)).finally(()=>clearTimeout(timer));
    }
    function rpc(name, args){ return withRequestTimeout(client.rpc(name, args)); }

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

    // Called by retry() after an upload noticed an auth-shaped failure
    // (isAuthError/lastActiveFlushAuthError). Deliberately reuses
    // ensureAnonymousSession() exactly as initialize() calls it, rather than
    // forcing a sign-out first: this device's anonymous identity is its
    // workspace membership, so a forced fresh sign-in would mint a new,
    // unrelated identity and silently orphan the device even if the
    // existing session was still perfectly recoverable. If the session
    // really is gone, ensureAnonymousSession() mints a fresh one exactly as
    // it would on a cold load, and a fresh identity that turns out not to
    // be a workspace member surfaces through the existing
    // isAccessDeniedError path, same as it always has - this function
    // does not need its own error handling for that case.
    async function reestablishSession(){
      try{
        await ensureAnonymousSession();
        await applyCurrentRealtimeAuth();
      }catch(error){
        // No network, or the auth server itself is unreachable - the
        // ordinary retry logic right after this call will hit the same
        // failure and report it normally.
      }
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
      setSyncedStatus("Shared active job is up to date.", "Shared active job is up to date, but other changes are still waiting to sync.");
    }

    async function resolveActiveConflict(pending, remoteRow, { alreadyCounted = false } = {}){
      // flushActiveJob, reconcileSelected and handleRealtimeActive all funnel
      // through here, but until now only flushActiveJob's own re-entrancy was
      // ever guarded (flushingActive). A Realtime push arriving while a
      // resolution from one of the other two paths was still in progress -
      // very possible on a workspace with real concurrent activity - started
      // a second, fully independent resolution: a second dialog.showModal()
      // on top of one already open (which throws), or a second overlapping
      // write attempt. That is what actually produced a burst of ~25
      // conflicts within 22ms in production, not the runaway retry loop the
      // Aug 12 breaker below already guards against - this is a different gap
      // in the same area. activeConflictPaused is checked here too: once
      // tripped, nothing should attempt another resolution until the
      // operator hits Retry, but before this only flushActiveJob's entry
      // point respected that.
      if (resolvingActiveConflict || activeConflictPaused) return;
      resolvingActiveConflict = true;
      try{
        // Trip the breaker before doing any other work, so a runaway cycle
        // cannot keep resolving-and-regenerating conflicts faster than an
        // operator could ever produce them. alreadyCounted means the caller
        // is flushActiveJob, which counted its own rejected write before
        // calling in - counting again here would spend two budget slots on
        // one conflict.
        if (!alreadyCounted && tripIfConflictBursting()) return;
        // A remote row can be missing entirely (the workspace has no active job
        // yet), in which case there is nothing to compare, back up or offer a
        // choice between. Treat it as a plain failed upload and leave the item
        // queued for the next retry rather than dereferencing a null row.
        if (!remoteRow){
          setStatus("Pending", "The shared active job could not be read. Changes are safe on this device and will retry.");
          return;
        }
        // A queued item can survive a page refresh from before the client-side
        // no-op guard ran. If it is semantically identical to the current
        // remote row, this is a stale-revision no-op, not a real operator
        // conflict. Discard it instead of prompting/re-queueing and feeding a
        // retry storm.
        if (activeJobLib?.activeJobsEqual?.(pending.payload, remoteRow?.payload)){
          activeConflictPaused = false;
          store.clearActiveJob(selectedId(), pending.operationId);
          await applyRemoteActive(remoteRow, "conflict-noop");
          return;
        }
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
          // Never immediate. If this re-upload conflicts again the same code
          // path runs again, so a zero-delay retry here is what turns two
          // devices disagreeing into a write storm.
          setTimeout(flushActiveJob, conflictRetryDelay());
          return;
        }
        activeConflictPaused = true;
        setStatus("Conflict", "Shared and local jobs differ. Synchronization is paused until resolved.");
      }finally{
        resolvingActiveConflict = false;
      }
    }

    async function fetchActiveRow(){
      const response = await withRequestTimeout(client.from("active_jobs")
        .select("workspace_id,payload,revision,last_operation_id,updated_at,updated_by")
        .eq("workspace_id", selectedId()).maybeSingle());
      if (response.error) throw response.error;
      return response.data;
    }

    async function flushActiveJob(){
      if (!state.available || !isConnected() || flushingActive || activeConflictPaused || resolvingActiveConflict) return;
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
            // Counted here, against the rejected write itself, and not only
            // inside resolveActiveConflict. Every early return in there -
            // the re-entrancy mutex, the already-paused check - happens
            // after a real update_active_job call has already been made and
            // refused, so a budget that only counted completed resolutions
            // never saw those writes. Production bursts kept overrunning a
            // nominal 12-per-10s budget for exactly that reason: 25 rejected
            // writes in 22ms on Aug 19, 36 in 39ms on Aug 20. The write is
            // what costs the database, so the write is what gets counted.
            if (tripIfConflictBursting()) return;
            const remote = await fetchActiveRow();
            await resolveActiveConflict(pending, remote, { alreadyCounted: true });
            return;
          }
          throw response.error;
        }
        // Deliberately does NOT clear the burst budget.
        //
        // It used to, on the reasoning that a write which lands means the
        // line has settled. It does not: update_active_job has two
        // idempotent success branches (matching last_operation_id, matching
        // payload), so a runaway cycle produces a steady mix of conflicts
        // and cheap successes - and each success wiped the evidence of every
        // conflict before it. That reintroduced exactly the streak-counter
        // weakness the rate breaker was built to avoid. Measured live on
        // 2026-08-20: 184,885 conflicts in 35 minutes, ~88/sec sustained,
        // against a nominal budget of 12 per 10s that never once tripped.
        //
        // Nothing is needed in its place. recentConflictTimes is a sliding
        // window, so an ordinary conflict earlier in the session ages out of
        // it after CONFLICT_BURST_WINDOW_MS on its own and still cannot
        // count toward a much later, unrelated one. Retry/refreshSelected
        // remain the deliberate way to clear a tripped breaker outright.
        const row = response.data?.[0];
        // The server returns the authoritative row instead of throwing for a
        // stale, non-identical update. That lets old clients settle their
        // stale outbox item without producing an unbounded error stream,
        // while current clients still preserve local work and use the normal
        // conflict-resolution dialog. A matching operation id is our write;
        // a matching payload is the existing idempotent no-op. Only the
        // remaining shape is a genuine remote winner.
        if (row && row.operation_id !== pending.operationId && !activeJobLib?.activeJobsEqual?.(pending.payload, row.payload)){
          if (tripIfConflictBursting()) return;
          await resolveActiveConflict(pending, row, { alreadyCounted: true });
          return;
        }
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
        setSyncedStatus("Active-job changes are synced.", "Active-job changes are synced, but other changes are still waiting.");
      }catch(error){
        if (isAccessDeniedError(error)){
          // Same permanent condition discardPendingItem exists for (see its
          // own comment above) - retrying can never succeed once membership
          // is gone, so this reuses that exact recovery instead of leaving
          // the item to be silently re-attempted (and re-failing) on every
          // future reconnect/tab-focus retry until the operator happens to
          // notice and discard it manually.
          discardPendingItem({ type: "active-job", workspaceId: selectedId(), operationId: pending.operationId });
          setStatus("Error", "This device no longer has access to this line. The unsynced change was discarded - reconnect via RT Sync to resume.");
          lastActiveFlushDenied = true;
          return;
        }
        if (isAuthError(error)){
          // Retrying the same upload against the same stale session would
          // just fail the same way again - flag it so the next retry()
          // re-establishes the session first instead of repeating this.
          lastActiveFlushAuthError = true;
          setStatus("Pending", "This device's connection needs to be refreshed. Changes are safe on this device - Retry will reconnect.");
          return;
        }
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
        setSyncedStatus("Saved Line Settings are synced.", "Saved Line Settings are synced, but other changes are still waiting.");
      }catch(error){
        if (isAccessDeniedError(error)){
          // Same permanent condition as flushActiveJob, and the whole
          // workspace's queue is equally unreachable, not just the
          // operation that happened to run first - discard all of it via
          // the same recovery discardPendingItem exists for, instead of
          // re-failing one at a time across future retries.
          store.getOutbox().setupOperations
            .filter(item=>item.workspaceId === selectedId())
            .forEach(item=>discardPendingItem({ type: "saved-setup", workspaceId: item.workspaceId, operationId: item.operationId }));
          setStatus("Error", "This device no longer has access to this line. Unsynced saved-setting changes were discarded - reconnect via RT Sync to resume.");
        } else if (isAuthError(error)){
          // Same flag flushActiveJob's catch sets - either flush can be the
          // first to notice a stale session, and retry() consumes it once
          // regardless of which one did.
          lastActiveFlushAuthError = true;
          setStatus("Pending", "This device's connection needs to be refreshed. Changes are safe on this device - Retry will reconnect.");
        } else {
          setStatus(navigator.onLine === false ? "Offline" : "Pending", "Saved-setting changes will retry.");
        }
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
        if (pending && pending.operationId !== activeInFlightOperationId){
          setStatus("Syncing", "Active-job changes are syncing.");
        } else {
          setSyncedStatus("Active-job changes are synced.", "Active-job changes are synced, but other changes are still waiting.");
        }
        return;
      }
      if (pending?.operationId === row.last_operation_id){
        store.clearActiveJob(selectedId(), pending.operationId);
        state.activeRevision = Number(row.revision);
        saveWorkspaceMetadata(selectedId(), { activeRevision: state.activeRevision, activePayload: row.payload });
        setSyncedStatus("Active-job changes are synced.", "Active-job changes are synced, but other changes are still waiting.");
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
          // This callback is a closure over `targetId`, but the channel it
          // belongs to can be torn down (leaveWorkspace, workspace switch)
          // while a join/error event for it is still in flight. Guard
          // against the stale event landing after teardown and re-asserting
          // a "connected" status for a workspace this device has left.
          if (channelWorkspaceId !== targetId) return;
          channelStatus = status;
          if (status === "SUBSCRIBED") setSyncedStatus("RT Sync is connected.", "RT Sync is connected, but local changes are still waiting to sync.");
          else if (["CHANNEL_ERROR","TIMED_OUT"].includes(status)) setStatus("Pending", "Realtime connection will retry.");
        });
    }

    async function reconcileSelected({ forceRemote = false, uploadLocalMissing = false } = {}){
      if (!selectedId() || !isConnected()) return;
      // Reset here (not just in retry()) so this always reflects only what
      // happens during *this* call, regardless of caller - refreshSelected()
      // and initialize() both call reconcileSelected() directly, without
      // going through retry() first.
      lastActiveFlushDenied = false;
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
      // Skip this if the flushActiveJob() call just above discarded a
      // workspace_access_denied item and set status to Error - otherwise
      // this unconditional "up to date" status immediately overwrites it,
      // and the operator never actually sees why their change was dropped.
      if (!lastActiveFlushDenied) setSyncedStatus("RT Sync is up to date.", "This line is up to date, but other changes are still waiting to sync.");
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
        else {
          const joinPrompt = typeof window !== "undefined" && window.matchMedia?.("(max-width: 900px)").matches
            ? "Join a line when ready."
            : "Create or join a line when ready.";
          setStatus("Local only", state.workspaces.length ? "Select a line to resume synchronization." : joinPrompt);
        }
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
      // Both of these must land before selectWorkspace, not after it.
      // selectWorkspace -> reconcileSelected reads this workspace's stored
      // baseline, and anything queued while that runs stamps its
      // expectedRevision from state.activeRevision. Setting them afterwards
      // left both at 0 while create_workspace had already put the row at
      // revision 1, so the first change queued on connect - in practice the
      // automatic layer-count normalization - was born stale and could
      // never land. It then sat in the outbox conflicting forever, which is
      // the seed every observed conflict storm grew from.
      state.activeRevision = Number(row.active_job_revision);
      saveWorkspaceMetadata(row.workspace_id, { activeRevision: state.activeRevision, workspaceRevision: Number(row.workspace_revision) });
      await selectWorkspace(row.workspace_id, { uploadLocalMissing: true });
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

      // The RPC above already succeeded server-side - this device is
      // definitely no longer a member. Reflect that locally and emit right
      // away, before the network-dependent refresh below, so a dropped
      // connection on this next call (common on the shop floor) can never
      // leave the UI stuck showing the old workspace as still "Synced" with
      // no way to join a different one.
      const current = ensureDeviceSettings();
      current.disconnectedWorkspaceIds = current.disconnectedWorkspaceIds.filter(id=>id !== workspaceId);
      current.selectedWorkspaceId = "";
      current.workspaceCache = (current.workspaceCache || []).filter(item=>item.id !== workspaceId);
      saveSettings(current);
      state.workspaces = state.workspaces.filter(item=>item.id !== workspaceId);
      state.selectedWorkspaceId = "";
      state.selectedWorkspace = null;
      await teardownChannel();
      setStatus("Local only", "This device left RT Sync. Local Resin.Tools data was preserved.");

      // Best-effort refresh: picks up another workspace this device still
      // belongs to, if any. A failure here (offline, flaky signal) leaves
      // the correct "Local only" state above in place rather than masking
      // it, instead of throwing back out to the caller's generic error path.
      try{
        await loadWorkspaces();
        if (selectedId()) await reconcileSelected({ forceRemote: true });
      }catch(error){ /* local state already reflects the successful leave */ }
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
      // Retry is the operator saying "go again" - deliberate, and the one
      // route out of a tripped breaker. Both the pause and the budget that
      // caused it clear together, or the very next conflict would re-trip
      // it immediately on a stale count.
      activeConflictPaused = false;
      clearConflictBudget();
      lastActiveFlushDenied = false;
      if (!state.available) await initialize();
      else {
        // Consumed once per cycle: initialize() (the branch above) already
        // re-authenticates from scratch, so this only runs when the client
        // itself is fine and a previous upload was the one that noticed the
        // session had gone stale. See reestablishSession's own comment for
        // why this re-checks the existing session rather than forcing a new
        // one.
        if (lastActiveFlushAuthError){
          lastActiveFlushAuthError = false;
          await reestablishSession();
        }
        await reconcileSelected();
        await flushActiveJob();
        // Skip the trailing flush if this cycle's active-job flush (whether
        // run just above or nested inside reconcileSelected) just discarded
        // a workspace_access_denied item and set status to Error - with
        // nothing else queued, flushSetupOperations' own setSyncedStatus
        // would otherwise immediately overwrite that with "Synced",
        // silently hiding the message the operator most needs to see.
        if (!lastActiveFlushDenied) await flushSetupOperations();
      }
    }

    async function refreshSelected(){
      if (!enabled) return;
      activeConflictPaused = false;
      clearConflictBudget();
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

    // Narrow accessor for the Android beta-access banner in Help, shaped
    // like getWorkspaceConfigurationTransport above: the two operations one
    // feature needs on one table, never the client itself.
    //
    // It has to be this client specifically. A beta request is keyed to the
    // browser's anonymous RT Sync identity, and resin-admin.js runs an
    // entirely separate Supabase client under its own storage key - reading
    // "my row" through that one would ask about the administrator's
    // identity, not the operator's.
    function getBetaAccessTransport(){
      if (!client || !state.available || !state.userId) return null;
      return Object.freeze({
        selectOwn: (fields) => client.from("beta_applicants").select(fields).maybeSingle(),
        rpc: (name, args) => client.rpc(name, args)
      });
    }

    // Narrow accessor for calling the recipe-scan Edge Function directly
    // (not through PostgREST/RPC, so it can't go through the transport
    // above) - returns just the current access token string, or null if
    // there's no live session. Never cached/stored by the caller; read
    // fresh immediately before each request.
    async function getAccessToken(){
      if (!client) return null;
      const current = await client.auth.getSession();
      return current?.data?.session?.access_token || null;
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

    // A flaky connection (e.g. spotty wifi) can fire "online" and
    // visibilitychange repeatedly within seconds of itself - each one calls
    // retry(), which hits the database (reconcileSelected + two outbox
    // flushes). Without a cooldown, a flapping connection turns into a
    // rapid-fire burst of RPCs instead of one settled retry. 4s is short
    // enough that a genuine reconnect is still handled promptly, long
    // enough to collapse a flap into a single attempt. Manual retry (the
    // Retry button, runLineSyncAction) calls retry() directly and is
    // intentionally NOT throttled by this - only these two automatic
    // triggers are.
    const AUTO_RETRY_COOLDOWN_MS = 4000;
    function autoRetry(){
      const now = Date.now();
      if (now - lastAutoRetryAt < AUTO_RETRY_COOLDOWN_MS) return;
      lastAutoRetryAt = now;
      retry();
    }
    if (typeof window !== "undefined"){
      window.addEventListener("online", autoRetry);
      document.addEventListener("visibilitychange", ()=>{ if (!document.hidden) autoRetry(); });
    }

    return {
      initialize,
      getState: ()=>JSON.parse(JSON.stringify(state)),
      getWorkspaceConfigurationTransport,
      getBetaAccessTransport,
      getRecoveryDescriptor,
      getAccessToken,
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
      retry,
      discardPendingItem
    };
  }

  return { create, normalizeName, normalizedKey, isConflictError, isAccessDeniedError, isAuthError, ownMembershipsByWorkspace };
});
