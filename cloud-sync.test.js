const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeName, normalizedKey, isConflictError, ownMembershipsByWorkspace } = require("./cloud-sync.js");

test("normalizes synchronized line and setup names", () => {
  assert.equal(normalizeName("  Line   9  "), "Line 9");
  assert.equal(normalizedKey("  LINE   9 "), "line 9");
});

test("recognizes optimistic concurrency failures", () => {
  assert.equal(isConflictError({ code: "40001", message: "revision_conflict" }), true);
  assert.equal(isConflictError({ code: "PGRST301", message: "offline" }), false);
});

test("workspace role comes from the current device membership", () => {
  const memberships = [
    { workspace_id: "line-1", user_id: "desktop", role: "owner" },
    { workspace_id: "line-1", user_id: "phone", role: "member" }
  ];
  const desktopMembership = ownMembershipsByWorkspace(memberships, "desktop").get("line-1");
  assert.equal(desktopMembership.role, "owner");
  assert.equal(desktopMembership.user_id, "desktop");
});

test("a failed upload remains represented by one newest pending snapshot", () => {
  const storage = (()=>{
    const values = new Map();
    return {
      getItem: key=>values.get(key) || null,
      setItem: (key,value)=>values.set(key,String(value))
    };
  })();
  const store = require("./sync-storage.js").createStore(storage);
  store.queueActiveJob("line-1", { operationId: "first", payload: { lineRate: 100 } });
  store.queueActiveJob("line-1", { operationId: "latest", payload: { lineRate: 200 } });
  assert.equal(store.pendingCount(), 1);
  assert.equal(store.getOutbox().activeJobs["line-1"].operationId, "latest");
});

test("disabled configuration remains a no-op without Supabase", async () => {
  const storage = { getItem(){ return null; }, setItem(){} };
  const syncStorage = require("./sync-storage.js");
  const sync = require("./cloud-sync.js").create({
    config: { enabled: false }, syncStorage, storage,
    adapter: { onStateChange(){} }
  });
  const state = await sync.initialize();
  assert.equal(state.status, "Local only");
  sync.notifyActiveJobMutation();
  assert.equal(syncStorage.createStore(storage).pendingCount(), 0);
});

// --- Realtime channel lifecycle (subscribe() teardown/reuse) -------------

function memoryStorage(){
  const values = new Map();
  return { getItem: key=>values.get(key) ?? null, setItem: (key,value)=>values.set(key,String(value)), values };
}

// Minimal fake Supabase client: a table query builder that resolves against
// in-memory fixture rows, and a channel mock whose status callback is the
// real one cloud-sync.js passes to .subscribe(), so emit() exercises the
// actual channelStatus-tracking code rather than a re-implementation of it.
//
// options.session seeds what auth.getSession()/signInAnonymously() return;
// pass null to simulate no current session. setSession()/fireAuthStateChange()
// let a test change that mid-flow and drive the real onAuthStateChange
// listener cloud-sync.js registers.
function fakeRealtimeClient(rowsByTable, options = {}){
  const channelCalls = [];
  const removeChannelCalls = [];
  const channels = [];
  const realtimeSetAuthCalls = [];
  const authStateListeners = [];
  const callOrder = []; // shared ordering log, e.g. "setAuth:<token>" / "channel:<name>"
  let currentSession = "session" in options
    ? options.session
    : { user: { id: "user-1" }, access_token: "initial-access-token" };

  function resolveRows(table, filters){
    let rows = rowsByTable[table] || [];
    for (const [col, val] of Object.entries(filters)){
      rows = Array.isArray(val) ? rows.filter(row=>val.includes(row[col])) : rows.filter(row=>row[col] === val);
    }
    return rows;
  }

  function makeQuery(table){
    const filters = {};
    const query = {
      select(){ return query; },
      eq(col, val){ filters[col] = val; return query; },
      in(col, vals){ filters[col] = vals; return query; },
      order(){ return query; },
      async maybeSingle(){ return { data: resolveRows(table, filters)[0] || null, error: null }; },
      then(resolve, reject){ return Promise.resolve({ data: resolveRows(table, filters), error: null }).then(resolve, reject); }
    };
    return query;
  }

  function makeChannel(name){
    const handlers = [];
    const chan = {
      name,
      status: null,
      _statusCallback: null,
      handlers, // exposed so tests can inspect exactly which postgres_changes handlers were registered
      on(event, filter, handler){ handlers.push({ event, filter, handler }); return chan; },
      subscribe(callback){ chan._statusCallback = callback; return chan; },
      emit(status){ chan.status = status; chan._statusCallback?.(status); },
      // Test-only helper to simulate a postgres_changes UPDATE on active_jobs
      // arriving from another device, driving the real handleRealtimeActive.
      fireActiveJobUpdate(row){
        const match = handlers.find(h => h.filter?.table === "active_jobs");
        return match?.handler({ new: row });
      }
    };
    return chan;
  }

  const rpcCalls = [];

  const client = {
    auth: {
      async getSession(){ return { data: { session: currentSession } }; },
      async signInAnonymously(){
        if (!currentSession) currentSession = { user: { id: "user-1" }, access_token: "initial-access-token" };
        return { data: { session: currentSession } };
      },
      onAuthStateChange(callback){
        authStateListeners.push(callback);
        return { data: { subscription: { unsubscribe(){} } } };
      }
    },
    realtime: {
      setAuth(token){
        realtimeSetAuthCalls.push(token);
        callOrder.push(`setAuth:${token}`);
      }
    },
    channel(name){
      channelCalls.push(name);
      callOrder.push(`channel:${name}`);
      const chan = makeChannel(name);
      channels.push(chan);
      return chan;
    },
    async removeChannel(chan){ removeChannelCalls.push(chan); },
    from(table){ return makeQuery(table); },
    // Simulates update_active_job's idempotency/optimistic-concurrency
    // contract closely enough to test the client-side no-op guard against it.
    async rpc(name, args){
      rpcCalls.push({ name, args });
      if (name !== "update_active_job") return { data: null, error: null };
      const row = (rowsByTable.active_jobs || []).find(r => r.workspace_id === args.p_workspace_id);
      if (!row) return { data: null, error: { message: "not_found" } };
      if (row.last_operation_id !== args.p_operation_id){
        if (row.revision !== args.p_expected_revision){
          return { data: null, error: { code: "40001", message: "revision_conflict" } };
        }
        row.payload = args.p_payload;
        row.revision += 1;
        row.last_operation_id = args.p_operation_id;
        row.updated_at = new Date().toISOString();
      }
      return { data: [{ workspace_id: row.workspace_id, payload: row.payload, revision: row.revision, operation_id: row.last_operation_id, updated_at: row.updated_at, updated_by: row.updated_by }], error: null };
    }
  };

  return {
    client, channelCalls, removeChannelCalls, channels, rpcCalls,
    realtimeSetAuthCalls, callOrder, authStateListeners,
    fireAuthStateChange(event, session){ authStateListeners.forEach(cb => cb(event, session)); },
    setSession(session){ currentSession = session; }
  };
}

// getPayload lets a test control what the app "currently shows" as of each
// notifyActiveJobMutation() call, independent of what was last seeded/saved.
function fakeAdapter(getPayload = () => ({})){
  return {
    getActiveJob: () => getPayload(),
    validateActiveJob(){ return { valid: true }; },
    applyRemoteActiveJob(){},
    applyLocalReplacement(){},
    getSavedConfigs(){ return {}; },
    replaceSavedConfigs(){},
    resolveActiveConflict: async ()=>"remote",
    onStateChange(){},
    onStorageError(){}
  };
}

function activeJobPayload(overrides = {}){
  return {
    version: "0.17", lineRate: 0, lineType: 3, gauge: 0, changeoverTime: "",
    offsets: {}, layers: [], prodResinLb: 0, scrapResinLb: 0, hopperNamingLine9: "standard",
    ...overrides
  };
}

function workspaceFixtures(...workspaces){
  const rows = { line_workspace_members: [], line_workspaces: [], active_jobs: [], saved_setups: [] };
  workspaces.forEach(({ id, name, payload })=>{
    rows.line_workspace_members.push({
      workspace_id: id, user_id: "user-1", device_id: "device-1", device_label: "Test Device",
      role: "owner", joined_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-01T00:00:00Z"
    });
    rows.line_workspaces.push({ id, name, revision: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    rows.active_jobs.push({
      workspace_id: id,
      payload: payload || activeJobPayload(),
      revision: 1, last_operation_id: "seed", updated_at: "2026-01-01T00:00:00Z", updated_by: "user-1"
    });
  });
  return rows;
}

function createSync(rows, getPayload, clientOptions){
  const harness = fakeRealtimeClient(rows, clientOptions);
  const storage = memoryStorage();
  const syncStorageModule = require("./sync-storage.js");
  const sync = require("./cloud-sync.js").create({
    config: { enabled: true, url: "https://example.supabase.co", publishableKey: "key" },
    syncStorage: syncStorageModule,
    storage,
    supabaseLibrary: { createClient: ()=>harness.client },
    adapter: fakeAdapter(getPayload),
    activeJob: require("./active-job.js")
  });
  return { sync, storage, syncStorageModule, ...harness };
}

test("the created channel registers only one postgres_changes handler, for active_jobs", async () => {
  const { sync, channels } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  assert.equal(channels.length, 1);
  assert.equal(channels[0].handlers.length, 1, "supabase_realtime now publishes only active_jobs; saved_setups/line_workspaces/line_workspace_members must not be subscribed");
  const [handler] = channels[0].handlers;
  assert.equal(handler.event, "postgres_changes");
  assert.equal(handler.filter.event, "UPDATE");
  assert.equal(handler.filter.schema, "public");
  assert.equal(handler.filter.table, "active_jobs");
});

test("the registered active_jobs handler has no server-side filter", async () => {
  // Workaround for the bundled realtime-js/server combination rejecting a
  // workspace_id filter here ("invalid column for filter workspace_id").
  const { sync, channels } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  const [handler] = channels[0].handlers;
  assert.equal(handler.filter.filter, undefined);
  assert.equal(Object.hasOwn(handler.filter, "filter"), false);
});

test("an active_jobs event for the selected workspace is handled", async () => {
  const seedPayload = activeJobPayload({ lineRate: 100 });
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A", payload: seedPayload });
  const { sync, channels } = createSync(rows, () => seedPayload);
  await sync.initialize();
  assert.equal(sync.getState().activeRevision, 1);

  const remotePayload = activeJobPayload({ lineRate: 777 });
  await channels[0].fireActiveJobUpdate({
    workspace_id: "ws-a", payload: remotePayload, revision: 2,
    last_operation_id: "remote-op", updated_at: new Date().toISOString(), updated_by: "other-device"
  });

  assert.equal(sync.getState().activeRevision, 2, "an event for this channel's own workspace must be applied");
});

test("an active_jobs event for a different workspace is ignored (client-side guard, since the subscription is unfiltered)", async () => {
  const seedPayload = activeJobPayload({ lineRate: 100 });
  const rows = workspaceFixtures(
    { id: "ws-a", name: "Line A", payload: seedPayload },
    { id: "ws-b", name: "Line B", payload: activeJobPayload({ lineRate: 200 }) }
  );
  const { sync, channels } = createSync(rows, () => seedPayload);
  await sync.initialize(); // subscribes to ws-a only
  assert.equal(sync.getState().activeRevision, 1);

  await channels[0].fireActiveJobUpdate({
    workspace_id: "ws-b", payload: activeJobPayload({ lineRate: 999 }), revision: 5,
    last_operation_id: "other-workspace-op", updated_at: new Date().toISOString(), updated_by: "other-device"
  });

  assert.equal(sync.getState().activeRevision, 1, "an event for a workspace other than the one this channel was created for must be ignored");
});

test("repeated reconcile calls for the same workspace create only one channel", async () => {
  const { sync, channelCalls, removeChannelCalls, channels } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  assert.equal(channelCalls.length, 1);
  channels[0].emit("SUBSCRIBED");
  await sync.refreshSelected();
  await sync.retry();
  assert.equal(channelCalls.length, 1, "expected exactly one channel across repeated reconciles for the same workspace");
  assert.equal(removeChannelCalls.length, 0, "a healthy channel for the same workspace must not be removed");
});

test("switching workspaces removes the old channel and creates one new channel", async () => {
  const { sync, channelCalls, removeChannelCalls, channels } = createSync(
    workspaceFixtures({ id: "ws-a", name: "Line A" }, { id: "ws-b", name: "Line B" })
  );
  await sync.initialize();
  assert.equal(channelCalls[0], "line-sync-ws-a");
  channels[0].emit("SUBSCRIBED");
  await sync.selectWorkspace("ws-b");
  assert.equal(channelCalls.length, 2);
  assert.equal(channelCalls[1], "line-sync-ws-b");
  assert.equal(removeChannelCalls.length, 1);
  assert.equal(removeChannelCalls[0], channels[0]);
});

test("CHANNEL_ERROR allows the channel to be replaced on the next reconcile", async () => {
  const { sync, channelCalls, removeChannelCalls, channels } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  channels[0].emit("CHANNEL_ERROR");
  await sync.refreshSelected();
  assert.equal(channelCalls.length, 2, "a channel in CHANNEL_ERROR must be replaced, not reused");
  assert.equal(removeChannelCalls.length, 1);
  assert.equal(removeChannelCalls[0], channels[0]);
});

test("TIMED_OUT allows the channel to be replaced on the next reconcile", async () => {
  const { sync, channelCalls, removeChannelCalls, channels } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  channels[0].emit("TIMED_OUT");
  await sync.retry();
  assert.equal(channelCalls.length, 2, "a channel in TIMED_OUT must be replaced, not reused");
  assert.equal(removeChannelCalls.length, 1);
});

test("disconnectLocal clears tracked channel state so reconnecting creates a fresh channel", async () => {
  const { sync, channelCalls, removeChannelCalls, channels } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  channels[0].emit("SUBSCRIBED");
  await sync.disconnectLocal();
  assert.equal(removeChannelCalls.length, 1, "disconnect must remove the live channel");
  assert.equal(removeChannelCalls[0], channels[0]);
  await sync.refreshSelected();
  assert.equal(channelCalls.length, 2, "reconnecting after disconnect must create a fresh channel, proving no stale tracked state remained");
});

// --- Active-job no-op guard (notifyActiveJobMutation) --------------------

function writeCalls(rpcCalls){ return rpcCalls.filter(c => c.name === "update_active_job"); }

test("identical payload after initial remote load does not call update_active_job", async () => {
  const seedPayload = activeJobPayload({ lineRate: 500 });
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A", payload: seedPayload });
  const { sync, rpcCalls } = createSync(rows, () => seedPayload);
  await sync.initialize();

  sync.notifyActiveJobMutation({ immediate: true });

  assert.equal(writeCalls(rpcCalls).length, 0, "no write should follow a payload identical to the just-loaded remote state");
});

test("repeated notify calls with the same queued payload create only one queued/write attempt", async () => {
  const seedPayload = activeJobPayload({ lineRate: 100 });
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A", payload: seedPayload });
  let currentPayload = seedPayload;
  const { sync, rpcCalls, storage, syncStorageModule } = createSync(rows, () => currentPayload);
  await sync.initialize();

  currentPayload = activeJobPayload({ lineRate: 250 });
  sync.notifyActiveJobMutation();
  const firstOperationId = syncStorageModule.createStore(storage).getOutbox().activeJobs["ws-a"].operationId;
  assert.ok(firstOperationId);

  sync.notifyActiveJobMutation(); // same (unchanged) payload again, while still queued
  const secondOperationId = syncStorageModule.createStore(storage).getOutbox().activeJobs["ws-a"].operationId;
  assert.equal(secondOperationId, firstOperationId, "the already-queued attempt must not be replaced with a new operation ID");

  await sync.retry(); // forces the flush without waiting for the debounce timer
  const calls = writeCalls(rpcCalls);
  assert.equal(calls.length, 1, "only one write attempt should ever reach the RPC");
  assert.equal(calls[0].args.p_operation_id, firstOperationId);
});

test("a genuine payload change still calls update_active_job", async () => {
  const seedPayload = activeJobPayload({ lineRate: 100 });
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A", payload: seedPayload });
  let currentPayload = seedPayload;
  const { sync, rpcCalls } = createSync(rows, () => currentPayload);
  await sync.initialize();

  currentPayload = activeJobPayload({ lineRate: 999 });
  sync.notifyActiveJobMutation();
  await sync.retry();

  const calls = writeCalls(rpcCalls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.p_payload.lineRate, 999);
});

test("after a successful save, notifying the same payload again is a no-op", async () => {
  const seedPayload = activeJobPayload({ lineRate: 100 });
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A", payload: seedPayload });
  let currentPayload = seedPayload;
  const { sync, rpcCalls } = createSync(rows, () => currentPayload);
  await sync.initialize();

  currentPayload = activeJobPayload({ lineRate: 250 });
  sync.notifyActiveJobMutation();
  await sync.retry();
  assert.equal(writeCalls(rpcCalls).length, 1, "sanity check: the save itself happened");

  sync.notifyActiveJobMutation({ immediate: true }); // nothing changed since the save
  assert.equal(writeCalls(rpcCalls).length, 1, "no additional write should be attempted for an unchanged payload");
});

test("after accepting a remote update, notifying the same payload is a no-op", async () => {
  const seedPayload = activeJobPayload({ lineRate: 100 });
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A", payload: seedPayload });
  let currentPayload = seedPayload;
  const { sync, rpcCalls, channels } = createSync(rows, () => currentPayload);
  await sync.initialize();

  const remotePayload = activeJobPayload({ lineRate: 777 });
  await channels[0].fireActiveJobUpdate({
    workspace_id: "ws-a", payload: remotePayload, revision: 2,
    last_operation_id: "remote-op", updated_at: new Date().toISOString(), updated_by: "other-device"
  });
  currentPayload = remotePayload; // the app now reflects the applied remote state

  sync.notifyActiveJobMutation({ immediate: true });
  assert.equal(writeCalls(rpcCalls).length, 0, "no write should follow accepting an identical remote payload");
});

test("switching workspaces does not reuse the previous workspace's comparison baseline", async () => {
  const payloadA = activeJobPayload({ lineRate: 111 });
  const payloadB = activeJobPayload({ lineRate: 222 });
  const rows = workspaceFixtures(
    { id: "ws-a", name: "Line A", payload: payloadA },
    { id: "ws-b", name: "Line B", payload: payloadB }
  );
  let currentPayload = payloadA;
  const { sync, rpcCalls } = createSync(rows, () => currentPayload);
  await sync.initialize(); // selects ws-a ("Line A" sorts first); baseline = payloadA
  await sync.selectWorkspace("ws-b"); // baseline is now ws-b's own remote payload (payloadB)

  // Same value as ws-a's baseline, but genuinely different from ws-b's own baseline.
  currentPayload = activeJobPayload({ lineRate: 111 });
  sync.notifyActiveJobMutation();
  await sync.retry();

  const calls = writeCalls(rpcCalls);
  assert.equal(calls.length, 1, "ws-a's baseline must not suppress a genuinely different save in ws-b");
  assert.equal(calls[0].args.p_workspace_id, "ws-b");
  assert.equal(calls[0].args.p_payload.lineRate, 111);
});

// --- Realtime authentication token (setAuth) ------------------------------

test("setAuth is called with the current session access token before subscribe()", async () => {
  const { sync, realtimeSetAuthCalls, callOrder, channelCalls } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();

  assert.ok(realtimeSetAuthCalls.includes("initial-access-token"), "setAuth must be called with the session's access_token");
  assert.equal(channelCalls.length, 1, "the channel must still be created once auth is applied");

  const setAuthIndex = callOrder.indexOf("setAuth:initial-access-token");
  const channelIndex = callOrder.indexOf("channel:line-sync-ws-a");
  assert.ok(setAuthIndex > -1 && channelIndex > -1 && setAuthIndex < channelIndex,
    "setAuth must complete before the channel is created/subscribed");
});

test("no token value is logged or stored outside the Supabase client", async () => {
  const originalLog = console.log, originalWarn = console.warn, originalError = console.error;
  const logged = [];
  console.log = (...args) => logged.push(args);
  console.warn = (...args) => logged.push(args);
  console.error = (...args) => logged.push(args);
  try{
    const { sync, storage } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
    await sync.initialize();

    const loggedText = JSON.stringify(logged);
    assert.doesNotMatch(loggedText, /initial-access-token/, "the access token must never be logged");

    // Inspect exactly what was persisted to local storage (the same object
    // passed in as `storage`) - the token must not appear anywhere in it.
    const persisted = JSON.stringify(Object.fromEntries(storage.values ? storage.values : []));
    assert.doesNotMatch(persisted, /initial-access-token/, "the access token must never be persisted to local storage");

    // getState() is the only snapshot handed to the rest of the app (UI,
    // adapter.onStateChange, etc.) - it must not carry the token either.
    const stateText = JSON.stringify(sync.getState());
    assert.doesNotMatch(stateText, /initial-access-token/, "the access token must not appear in the public sync state");
  } finally {
    console.log = originalLog; console.warn = originalWarn; console.error = originalError;
  }
});

test("TOKEN_REFRESHED updates Realtime auth", async () => {
  const { sync, realtimeSetAuthCalls, fireAuthStateChange } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  assert.ok(realtimeSetAuthCalls.includes("initial-access-token"));

  fireAuthStateChange("TOKEN_REFRESHED", { user: { id: "user-1" }, access_token: "refreshed-token" });

  assert.ok(realtimeSetAuthCalls.includes("refreshed-token"), "a refreshed token must be applied to Realtime auth");
});

test("SIGNED_OUT tears down the existing channel", async () => {
  const { sync, channels, removeChannelCalls, fireAuthStateChange } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  channels[0].emit("SUBSCRIBED");
  assert.equal(removeChannelCalls.length, 0);

  fireAuthStateChange("SIGNED_OUT", null);
  // teardownChannel() is async and not awaited by the listener; give its
  // microtask a turn to run.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(removeChannelCalls.length, 1, "SIGNED_OUT must tear down the channel through the existing cleanup path");
  assert.equal(removeChannelCalls[0], channels[0]);
});

test("repeated initialization does not register duplicate auth listeners", async () => {
  const { sync, authStateListeners } = createSync(workspaceFixtures({ id: "ws-a", name: "Line A" }));
  await sync.initialize();
  await sync.initialize();
  assert.equal(authStateListeners.length, 1, "a second initialize() must not attach a second onAuthStateChange listener");
});

test("absence of a session/token does not crash and does not falsely authenticate Realtime", async () => {
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A" }, { id: "ws-b", name: "Line B" });
  const { sync, realtimeSetAuthCalls, setSession } = createSync(rows);
  await sync.initialize();
  const callsAfterInit = realtimeSetAuthCalls.length;

  setSession(null); // simulate the session becoming unavailable
  await assert.doesNotReject(() => sync.selectWorkspace("ws-b"), "switching workspaces with no session must not throw");

  assert.equal(realtimeSetAuthCalls.length, callsAfterInit, "setAuth must not be called with a missing/undefined token");
});

// --- getAccessToken() - narrow accessor for calling the recipe-scan Edge Function directly ---

test("getAccessToken returns the current session's access token after initialize", async () => {
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A" });
  const { sync } = createSync(rows, undefined, { session: { user: { id: "user-1" }, access_token: "token-abc" } });
  await sync.initialize();
  assert.equal(await sync.getAccessToken(), "token-abc");
});

test("getAccessToken reflects a session change made after initialize, not a stale cached value", async () => {
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A" });
  const { sync, setSession } = createSync(rows, undefined, { session: { user: { id: "user-1" }, access_token: "token-abc" } });
  await sync.initialize();
  setSession({ user: { id: "user-1" }, access_token: "token-refreshed" });
  assert.equal(await sync.getAccessToken(), "token-refreshed");
});

test("getAccessToken returns null when there's no live session", async () => {
  const rows = workspaceFixtures({ id: "ws-a", name: "Line A" });
  const { sync, setSession } = createSync(rows);
  await sync.initialize();
  setSession(null);
  assert.equal(await sync.getAccessToken(), null);
});

test("getAccessToken returns null when cloud sync was never initialized (no client yet)", async () => {
  const storage = { getItem(){ return null; }, setItem(){} };
  const syncStorage = require("./sync-storage.js");
  const sync = require("./cloud-sync.js").create({
    config: { enabled: false }, syncStorage, storage,
    adapter: { onStateChange(){} }
  });
  assert.equal(await sync.getAccessToken(), null);
});
