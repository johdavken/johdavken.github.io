"use strict";

/* Outbound RT Sync: a Station command reaches the line through the
 * application's own path and no other.
 *
 *   Station command (the real command bridge and contract)
 *     -> the real executor lifted from app.js
 *     -> validateAndCompute({ sync }) -> notifyActiveJobMutation
 *     -> the REAL cloud-sync.js: no-op guard, one queued item, one
 *        update_active_job RPC over a fake client
 *
 * What this file pins, for each of the four Station edits: the application's
 * state moves once, the state bridge publishes, cloud-sync queues exactly one
 * change and uploads it exactly once, and no Station file - and not the
 * executor - publishes, queues or uploads anything of its own.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

const contract = require("./station-command-contract.js");
const commandBridgeModule = require("./station-command-bridge.js");
const stateBridgeModule = require("./station-state-bridge.js");
const hookups = require("./hookup-sources.js");
const nextRecipe = require("./next-recipe.js");
const validation = require("./validation.js");
const rearrangement = require("./hopper-rearrangement.js");
const activeJob = require("./active-job.js");
const cloudSync = require("./cloud-sync.js");
const syncStorage = require("./sync-storage.js");

/* ----------------------------------------------------------------------
 *   Lifting the application's own code (as station-command-executor.test.js)
 * -------------------------------------------------------------------- */

function block(startAnchor, endAnchor) {
  const start = app.indexOf(startAnchor);
  assert.ok(start > -1, `anchor not found: ${startAnchor}`);
  const end = app.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `end anchor not found after ${startAnchor}: ${endAnchor}`);
  return app.slice(start, end + (endAnchor.startsWith("\n") ? endAnchor.length : 0));
}

const LIFTED = [
  block("    function recomputeAutoH1(layer){", "\n    }\n"),
  block("    function recomputeAutoFirstLayerPct(layers){", "\n    }\n"),
  block("    function ensureNextRecipeWorking(){", "    function hasPlannedRecipe(){"),
  block("    const RECIPE_HISTORY_LIMIT = 40;", "    /* The plan's own percentage totals"),
  block("    function plannedRecipePayload(){", "\n    }\n"),
  block("    function hookupRecipePositions(){", "    function renderResultsFlat("),
  block("  function createStationCommandExecutor(){", "\n  }\n")
].join("\n");

/* ----------------------------------------------------------------------
 *   A fake RT Sync client that records uploads
 * -------------------------------------------------------------------- */

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

function fakeClient(rows) {
  const rpcCalls = [];
  const channels = [];
  function query(table) {
    const filters = {};
    const q = {
      select() { return q; }, eq(c, v) { filters[c] = v; return q; }, in(c, v) { filters[c] = v; return q; }, order() { return q; },
      rows() { let out = rows[table] || []; for (const [c, v] of Object.entries(filters)) out = out.filter(r => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)); return out; },
      async maybeSingle() { return { data: q.rows()[0] || null, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: q.rows(), error: null }).then(resolve, reject); }
    };
    return q;
  }
  return {
    rpcCalls, channels,
    client: {
      auth: {
        async getSession() { return { data: { session: { user: { id: "anon-desktop" }, access_token: "t" } } }; },
        async signInAnonymously() { return { data: { session: { user: { id: "anon-desktop" }, access_token: "t" } } }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
      },
      realtime: { setAuth() {} },
      channel(name) { const chan = { name, on() { return chan; }, subscribe(cb) { chan.cb = cb; return chan; } }; channels.push(chan); return chan; },
      async removeChannel() {},
      from(table) { return query(table); },
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        if (name !== "update_active_job") return { data: null, error: null };
        const row = rows.active_jobs.find(r => r.workspace_id === args.p_workspace_id);
        if (row.last_operation_id !== args.p_operation_id) {
          if (row.revision !== args.p_expected_revision) return { data: null, error: { code: "40001", message: "revision_conflict" } };
          row.payload = args.p_payload; row.revision += 1; row.last_operation_id = args.p_operation_id;
        }
        return { data: [{ workspace_id: row.workspace_id, payload: row.payload, revision: row.revision, operation_id: row.last_operation_id }], error: null };
      }
    }
  };
}

function layersFor(names) {
  return names.map(name => ({
    name, layerPct: Math.round(100 / names.length),
    hoppers: Array.from({ length: 6 }, (_, index) => ({
      pct: index === 0 ? 60 : index === 1 ? 40 : 0, weight: index < 2 ? 400 : 0,
      resinName: index === 0 ? `LIVE-${name}0` : index === 1 ? `LIVE-${name}1` : "",
      track: index === 0, pumpOff: false, usableHeight: 30, circumference: 0, usableGallons: 0
    }))
  }));
}

/* The application: the executor over real state, whose tail now ends in the
 * REAL cloud-sync (as validateAndCompute({sync}) -> notifyActiveJobMutation
 * does in app.js), connected to a Line 9 workspace over the fake client. */
async function boot() {
  const state = {
    lineType: 3, lineRate: 900, gauge: 0, changeoverTime: "", hopperNamingLine9: "standard",
    layers: layersFor(["A", "B", "C"]), nextRecipe: null,
    hookupSources: { current: { "A:0": { resin: "LIVE-A0", source: "SILO 1" } }, next: {} },
    resinLots: {}, nextRecipeLots: {}
  };
  const payloadOf = () => ({
    version: "0.17", lineRate: state.lineRate, lineType: state.lineType, gauge: 0, changeoverTime: "", offsets: {},
    layers: JSON.parse(JSON.stringify(state.layers)), prodResinLb: 0, scrapResinLb: 0, hopperNamingLine9: "standard",
    hookupSources: JSON.parse(JSON.stringify(state.hookupSources)), nextRecipe: state.nextRecipe
  });

  const storage = memoryStorage();
  syncStorage.createStore(storage).saveSettings({ deviceId: "dev-desktop", deviceLabel: "Line 9 Desktop", selectedWorkspaceId: "ws-9", disconnectedWorkspaceIds: [], workspaceCache: [{ id: "ws-9", name: "Line 9", revision: 1 }] });
  const remote = fakeClient({
    line_workspace_members: [{ workspace_id: "ws-9", user_id: "anon-desktop", device_id: "dev-desktop", device_label: "Line 9 Desktop", role: "owner", joined_at: "2026-09-01T08:00:00Z", last_seen_at: "2026-09-01T08:00:00Z" }],
    line_workspaces: [{ id: "ws-9", name: "Line 9", revision: 1 }],
    active_jobs: [{ workspace_id: "ws-9", payload: payloadOf(), revision: 1, last_operation_id: "seed" }],
    saved_setups: []
  });
  const log = { saves: 0, notified: [], syncRenders: 0 };
  let lineSync = null;

  const factory = new Function("env", `
    const window = env.window;
    const state = env.state;
    const validation = env.validation;
    const HOPPERS_PER_LAYER = 6;
    const stationBridge = env.stateBridgeModule.create({ scheduler: run => run() });
    const stationCommandContract = env.contract;
    let uiPage = "current";
    let nextRecipeWorking = null;
    let hopperRearrangement = null;
    const lineSync = { getState: () => env.lineSync().getState() };
    const log = env.log;
    const $ = () => null;
    const document = { querySelectorAll: () => [] };
    const clampNum = value => { const n = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
    const normName = s => String(s || "").trim().replace(/\\s+/g, " ");
    const LINE_LAYERS = { 1: ["A"], 3: ["A", "B", "C"], 5: ["A", "B", "C", "D", "E"] };
    function getLayerNamesForType(lineType){ return LINE_LAYERS[Number(lineType)] || []; }
    function isNextRecipePage(){ return uiPage === "next"; }
    function recipeLayers(){ return isNextRecipePage() ? ensureNextRecipeWorking() : state.layers; }
    function syncPlannedRecipeIndicator(){}
    function autoFirstLayerPctActive(){ return false; }
    function renderSplitsArea(){}
    function renderTimelineHookups(){}
    // app.js's tail, with the real RT Sync notification at the end of it.
    function notifyActiveJobMutation(options){ log.notified.push(options); env.lineSync().notifyActiveJobMutation(options); }
    function validateAndCompute({ sync = false, immediate = false, kind = "edit" } = {}){
      reconcileHookupSources();
      saveSession();
      if (sync) notifyActiveJobMutation({ immediate, kind });
    }
    function saveSession(){
      commitNextRecipeWorking();
      log.saves += 1;
      stationBridgeHandle.publish();
      return true;
    }
    ${LIFTED}
    const stationBridgeHandle = stationBridge.connect({
      read: () => stationBridge.project(state, { plannedRecipe: plannedRecipePayload(), history: recipeHistoryAvailability() })
    });
    const commands = env.commandBridgeModule.create();
    const executor = createStationCommandExecutor();
    commands.connect({ execute: executor.execute, capabilities: executor.capabilities });
    return { commands, stationBridge, recipeEditHistory };
  `);
  const built = factory({
    window: { PolynHookupSources: hookups, PolynNextRecipe: nextRecipe, PolynHopperRearrangement: rearrangement },
    state, validation, contract, stateBridgeModule, commandBridgeModule, log, lineSync: () => lineSync
  });

  lineSync = cloudSync.create({
    config: { enabled: true, url: "https://example.invalid", publishableKey: "pk" },
    syncStorage, storage, supabaseLibrary: { createClient: () => remote.client }, activeJob,
    adapter: {
      getActiveJob: payloadOf,
      validateActiveJob: () => ({ valid: true }),
      applyRemoteActiveJob: () => {},
      applyLocalReplacement() {}, getSavedConfigs: () => ({}), replaceSavedConfigs() {},
      resolveActiveConflict: async () => "remote",
      onStateChange: () => { log.syncRenders += 1; }, onStorageError() {}
    }
  });
  await lineSync.initialize();
  remote.channels[0].cb?.("SUBSCRIBED");
  const uploadsBefore = remote.rpcCalls.filter(c => c.name === "update_active_job").length;
  return {
    state, log, remote, lineSync, commands: built.commands, stationBridge: built.stationBridge, history: built.recipeEditHistory,
    uploads: () => remote.rpcCalls.filter(c => c.name === "update_active_job").slice(uploadsBefore),
    settle: async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); },
    flush: async () => { await new Promise(resolve => setTimeout(resolve, 750)); }
  };
}

const CUR = { recipe: "current", layer: "B" };

async function expectOneUpload(h, kind, immediate) {
  assert.equal(h.log.notified.length, 1, "one RT Sync notification from the application's tail");
  assert.deepEqual(h.log.notified[0], { immediate, kind });
  assert.equal(h.lineSync.getState().pendingCount, 1, "cloud-sync queued exactly one change");
  if (immediate) await h.settle(); else await h.flush();
  const uploads = h.uploads();
  assert.equal(uploads.length, 1, "exactly one update_active_job");
  assert.equal(uploads[0].args.p_workspace_id, "ws-9");
  assert.equal(h.lineSync.getState().pendingCount, 0);
  assert.equal(h.lineSync.getState().status, "Synced");
  return uploads[0].args.p_payload;
}

/* ----------------------------------------------------------------------
 *   The four Station edits
 * -------------------------------------------------------------------- */

test("change resin: state moves once, the bridge publishes, cloud-sync queues one change and uploads it once", async () => {
  const h = await boot();
  const revision = h.stationBridge.getRevision();
  const result = h.commands.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "NEW-B2" }));
  assert.equal(result.ok, true);
  assert.equal(h.state.layers[1].hoppers[2].resinName, "NEW-B2");
  assert.ok(h.stationBridge.getRevision() > revision, "the state bridge published");
  assert.equal(result.snapshot.layers[1].hoppers[2].resinName, "NEW-B2", "the answer carries the application's own snapshot");
  const uploaded = await expectOneUpload(h, "edit", false);
  assert.equal(uploaded.layers[1].hoppers[2].resinName, "NEW-B2", "the line receives what the application holds");
});

test("change percentage: one edit notification, H1 re-derived by the application, one upload", async () => {
  const h = await boot();
  const result = h.commands.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 25 }));
  assert.equal(result.ok, true);
  assert.equal(h.state.layers[1].hoppers[1].pct, 25);
  assert.equal(h.state.layers[1].hoppers[0].pct, 75, "H1 = 100 - the rest, by the application's own rule");
  const uploaded = await expectOneUpload(h, "edit", false);
  assert.equal(uploaded.layers[1].hoppers[0].pct, 75);
});

test("change source: one notification through the Hookups tail, one upload carrying the label", async () => {
  const h = await boot();
  const result = h.commands.dispatch("setSource", Object.assign({}, CUR, { index: 0, source: "SILO 7" }));
  assert.equal(result.ok, true);
  assert.equal(h.state.hookupSources.current["B:0"].source, "SILO 7");
  const uploaded = await expectOneUpload(h, "hookup-edit", false);
  assert.equal(uploaded.hookupSources.current["B:0"].source, "SILO 7");
});

test("move hopper: one immediate rearrange-hoppers notification, one history entry, one upload", async () => {
  const h = await boot();
  const result = h.commands.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "B", toIndex: 3 }));
  assert.equal(result.ok, true);
  assert.equal(h.state.layers[1].hoppers[3].resinName, "LIVE-B1");
  assert.equal(h.state.layers[1].hoppers[1].resinName, "");
  assert.equal(h.history.current.undo.length, 1, "one history entry, as the legacy Done records");
  const uploaded = await expectOneUpload(h, "rearrange-hoppers", true);
  assert.equal(uploaded.layers[1].hoppers[3].resinName, "LIVE-B1");
});

test("a no-op command produces no save, no publish, no notification and no upload", async () => {
  const h = await boot();
  const revision = h.stationBridge.getRevision();
  const saves = h.log.saves;
  for (const [command, args] of [
    ["setHopperResin", Object.assign({}, CUR, { index: 1, resin: "LIVE-B1" })],
    ["setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 40 })],
    ["setSource", Object.assign({}, CUR, { index: 1, source: "" })]
  ]) {
    const result = h.commands.dispatch(command, args);
    assert.equal(result.ok, true, command);
    assert.equal(result.changed, false, command);
  }
  assert.equal(h.stationBridge.getRevision(), revision);
  assert.equal(h.log.saves, saves);
  assert.deepEqual(h.log.notified, []);
  assert.equal(h.lineSync.getState().pendingCount, 0);
  await h.flush();
  assert.deepEqual(h.uploads(), []);
});

test("a change that the application's tail notifies but that equals the line's row is dropped by cloud-sync's own no-op guard", async () => {
  const h = await boot();
  // Change B2's resin, upload it, then change it back: the second edit is
  // a real edit (the value differs from the current one) but its payload
  // equals the row before the first edit only if nothing else moved - it
  // does not, so both upload. The guard that matters is the third: the
  // same payload as what was just accepted.
  h.commands.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "ONE" }));
  await h.flush();
  assert.equal(h.uploads().length, 1);
  h.lineSync.notifyActiveJobMutation({ immediate: true, kind: "edit" });
  await h.settle();
  assert.equal(h.uploads().length, 1, "an identical payload is never queued");
});

test("a write is refused while a remote job is being applied, so an inbound apply and a Station edit cannot race onto the line", async () => {
  const h = await boot();
  const state = h.lineSync.getState();
  // cloud-sync sets isApplyingRemote for the duration of an apply; the
  // executor reads it through the application's lineSync.getState().
  Object.defineProperty(state, "isApplyingRemote", { value: true });
  const original = h.lineSync.getState;
  h.lineSync.getState = () => Object.assign(original(), { isApplyingRemote: true });
  const result = h.commands.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "RACE" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "busy");
  assert.equal(h.state.layers[1].hoppers[2].resinName, "");
  h.lineSync.getState = original;
});

/* ----------------------------------------------------------------------
 *   No second path
 * -------------------------------------------------------------------- */

test("neither the executor nor any Station file publishes, queues or uploads on its own", () => {
  const executorSource = block("  function createStationCommandExecutor(){", "\n  }\n");
  for (const forbidden of [/notifyActiveJobMutation/, /lineSync\.(?!getState)/, /stationBridgeHandle/, /\.publish\s*\(/, /supabase/i, /\.rpc\s*\(/, /queueActiveJob/]) {
    assert.doesNotMatch(executorSource, forbidden, `the executor reaches past the application's own tail (${forbidden})`);
  }
  for (const file of fs.readdirSync(path.join(ROOT, "station")).filter(name => name.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(ROOT, "station", file), "utf8");
    for (const forbidden of [/notifyActiveJobMutation/, /saveSession/, /queueActiveJob/, /update_active_job/, /\.publish\s*\(/, /PolynCloudSync/, /supabase/i]) {
      assert.doesNotMatch(source, forbidden, `${file} has its own way onto the line (${forbidden})`);
    }
  }
});
