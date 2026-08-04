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
  return { getItem: key=>values.get(key) ?? null, setItem: (key,value)=>values.set(key,String(value)) };
}

// Minimal fake Supabase client: a table query builder that resolves against
// in-memory fixture rows, and a channel mock whose status callback is the
// real one cloud-sync.js passes to .subscribe(), so emit() exercises the
// actual channelStatus-tracking code rather than a re-implementation of it.
function fakeRealtimeClient(rowsByTable){
  const channelCalls = [];
  const removeChannelCalls = [];
  const channels = [];

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
    const chan = {
      name,
      status: null,
      _statusCallback: null,
      on(){ return chan; },
      subscribe(callback){ chan._statusCallback = callback; return chan; },
      emit(status){ chan.status = status; chan._statusCallback?.(status); }
    };
    return chan;
  }

  const client = {
    auth: {
      async getSession(){ return { data: { session: { user: { id: "user-1" } } } }; },
      async signInAnonymously(){ return { data: { session: { user: { id: "user-1" } } } }; }
    },
    channel(name){
      channelCalls.push(name);
      const chan = makeChannel(name);
      channels.push(chan);
      return chan;
    },
    async removeChannel(chan){ removeChannelCalls.push(chan); },
    from(table){ return makeQuery(table); },
    async rpc(){ return { data: null, error: null }; }
  };

  return { client, channelCalls, removeChannelCalls, channels };
}

function fakeAdapter(){
  return {
    getActiveJob(){ return {}; },
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

function workspaceFixtures(...workspaces){
  const rows = { line_workspace_members: [], line_workspaces: [], active_jobs: [], saved_setups: [] };
  workspaces.forEach(({ id, name })=>{
    rows.line_workspace_members.push({
      workspace_id: id, user_id: "user-1", device_id: "device-1", device_label: "Test Device",
      role: "owner", joined_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-01T00:00:00Z"
    });
    rows.line_workspaces.push({ id, name, revision: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    rows.active_jobs.push({
      workspace_id: id,
      payload: { version: "0.17", lineRate: 0, lineType: 3, gauge: 0, changeoverTime: "", offsets: {}, layers: [], prodResinLb: 0, scrapResinLb: 0, hopperNamingLine9: "standard" },
      revision: 1, last_operation_id: "seed", updated_at: "2026-01-01T00:00:00Z", updated_by: "user-1"
    });
  });
  return rows;
}

function createSync(rows){
  const harness = fakeRealtimeClient(rows);
  const sync = require("./cloud-sync.js").create({
    config: { enabled: true, url: "https://example.supabase.co", publishableKey: "key" },
    syncStorage: require("./sync-storage.js"),
    storage: memoryStorage(),
    supabaseLibrary: { createClient: ()=>harness.client },
    adapter: fakeAdapter()
  });
  return { sync, ...harness };
}

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
