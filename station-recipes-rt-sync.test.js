"use strict";

/* The Recipe Book's actions against RT Sync: a Station request on the
 * recipes bridge reaches the cloud through the application's own paths
 * and no other.
 *
 *   Station request (the real recipes bridge)
 *     -> the real connectStationRecipes closures lifted from app.js
 *     -> applyWorkspaceConfiguration / mutateWorkspaceConfiguration
 *     -> the REAL workspace-configurations-service over the REAL
 *        cloud-sync's transport (a fake Supabase client that records
 *        every RPC and list read)
 *     -> and, for a load into Current, the REAL cloud-sync active-job
 *        path: one update_active_job upload
 *
 * What this file pins: a load into Current changes the running recipe once
 * and uploads once; a load into Next changes the plan and uploads nothing;
 * a load the application refuses changes nothing and sends nothing; rename,
 * duplicate, delete and replace are exactly one configuration RPC each and
 * one list re-read, with no active-job upload; a failed RPC leaves the
 * cache and the state as they were; another workspace's recipe is
 * not_found and nothing is sent.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

const recipesBridgeModule = require("./station-recipes-bridge.js");
const stateBridgeModule = require("./station-state-bridge.js");
const hookups = require("./hookup-sources.js");
const nextRecipe = require("./next-recipe.js");
const validation = require("./validation.js");
const activeJob = require("./active-job.js");
const cloudSync = require("./cloud-sync.js");
const syncStorage = require("./sync-storage.js");
const payloads = require("./workspace-configuration-payloads.js");
const configurationsService = require("./workspace-configurations-service.js");

function block(startAnchor, endAnchor) {
  const start = app.indexOf(startAnchor);
  assert.ok(start > -1, `anchor not found: ${startAnchor}`);
  const end = app.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `end anchor not found after ${startAnchor}: ${endAnchor}`);
  return app.slice(start, end + (endAnchor.startsWith("\n") ? endAnchor.length : 0));
}

/* The application's own code, lifted whole. */
const LIFTED = [
  block("    function recomputeAutoH1(layer){", "\n    }\n"),
  block("    function ensureNextRecipeWorking(){", "    function hasPlannedRecipe(){"),
  block("    const RECIPE_HISTORY_LIMIT = 40;", "    /* The plan's own percentage totals"),
  block("    function plannedRecipePayload(){", "\n    }\n"),
  block("    function rekeyLotMap(raw){", "\n    }\n"),
  block("    function hookupRecipePositions(){", "    function renderResultsFlat("),
  block("  function derivedRequiredLayerCount(syncState = lineSync?.getState?.()){", "\n  }\n"),
  block("  function derivedLineConfiguration(syncState = lineSync?.getState?.()){", "\n  }\n"),
  block("  async function refreshWorkspaceConfigurations(){", "\n  }\n"),
  block("  function applyWorkspaceConfiguration(item,destination=null){", "\n  }\n"),
  block("  function applyRecipeToActivePage(payload,{kind,lotByResin,destination}={}){", "\n  }\n"),
  block("  function recipePageLabel(destination=null){", "\n"),
  block("  async function mutateWorkspaceConfiguration(action,item,value){", "\n  }\n"),
  block("  function finishWorkspaceConfigurationMutation(result,message){", "\n"),
  block("  function stationRecipePayload(){", "\n"),
  block("  function connectStationRecipes(){", "\n  }\n")
].join("\n");

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

function recipeRow(id, name, lineType, overrides) {
  const names = { 1: ["A"], 3: ["A", "B", "C"], 5: ["A", "B", "C", "D", "E"] }[lineType];
  return Object.assign({
    id, workspace_id: "ws-9", configuration_type: "recipe", name, normalized_name: name.toLowerCase(), schema_version: 1,
    payload: {
      schema_version: 1, line_type: lineType, hopper_naming_mode: "standard",
      layers: names.map((layer, at) => ({
        name: layer, layer_pct: at === 0 ? 100 - 20 * (names.length - 1) : 20,
        hoppers: Array.from({ length: 6 }, (_, i) => ({ resin_name: i === 0 ? `${id}-${layer}0` : i === 1 ? `${id}-${layer}1` : null, pct: i === 0 ? 70 : i === 1 ? 30 : 0 }))
      }))
    },
    favorite: false, created_by: "user-a", updated_by: "user-a", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-10T00:00:00Z"
  }, overrides || {});
}

/* A fake Supabase client: the active job as the outbound test fakes it,
 * plus the workspace_configurations table and its five RPCs, recorded. */
function fakeClient(rows, options) {
  const rpcCalls = [];
  const channels = [];
  const listReads = [];
  const failing = (options && options.failRpc) || null;
  function query(table) {
    const filters = {};
    if (table === "workspace_configurations") listReads.push(Object.assign({}, filters));
    const q = {
      select() { return q; }, eq(c, v) { filters[c] = v; return q; }, in(c, v) { filters[c] = v; return q; }, order() { return q; },
      rows() { let out = rows[table] || []; for (const [c, v] of Object.entries(filters)) out = out.filter(r => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)); return JSON.parse(JSON.stringify(out)); },
      async maybeSingle() { return { data: q.rows()[0] || null, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: q.rows(), error: null }).then(resolve, reject); }
    };
    return q;
  }
  return {
    rpcCalls, channels, listReads,
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
        if (failing === name) return { data: null, error: { code: "42501", message: "permission denied" } };
        const configs = rows.workspace_configurations;
        const find = id => configs.find(r => r.id === id && r.workspace_id === args.p_workspace_id);
        if (name === "create_workspace_configuration") {
          if (configs.some(r => r.workspace_id === args.p_workspace_id && r.normalized_name === String(args.p_name).toLowerCase())) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          configs.push({ id: args.p_configuration_id, workspace_id: args.p_workspace_id, configuration_type: args.p_configuration_type, name: args.p_name, normalized_name: String(args.p_name).toLowerCase(), schema_version: 1, payload: args.p_payload, favorite: !!args.p_favorite, created_by: "anon-desktop", updated_by: "anon-desktop", created_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z" });
          return { data: null, error: null };
        }
        if (name === "update_workspace_configuration") { const r = find(args.p_configuration_id); if (r) { r.payload = args.p_payload; r.updated_by = "anon-desktop"; r.updated_at = "2026-09-13T01:00:00Z"; } return { data: null, error: null }; }
        if (name === "rename_workspace_configuration") { const r = find(args.p_configuration_id); if (r) { r.name = args.p_name; r.normalized_name = String(args.p_name).toLowerCase(); } return { data: null, error: null }; }
        if (name === "duplicate_workspace_configuration") { const r = find(args.p_source_configuration_id); if (r) configs.push(Object.assign({}, r, { id: `${r.id}-copy`, name: args.p_name, normalized_name: String(args.p_name).toLowerCase() })); return { data: null, error: null }; }
        if (name === "delete_workspace_configuration") { const at = configs.findIndex(r => r.id === args.p_configuration_id); if (at > -1) configs.splice(at, 1); return { data: null, error: null }; }
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
    name, layerPct: name === "A" ? 100 - 20 * (names.length - 1) : 20,
    hoppers: Array.from({ length: 6 }, (_, index) => ({
      pct: index === 0 ? 60 : index === 1 ? 40 : 0, weight: index < 2 ? 400 : 0,
      resinName: index === 0 ? `LIVE-${name}0` : index === 1 ? `LIVE-${name}1` : "",
      track: index === 0, pumpOff: index === 1, usableHeight: 30, circumference: 0, usableGallons: 0
    }))
  }));
}

/* The application: the lifted closures over real state, the real
 * configurations service over the real cloud-sync transport, the real
 * recipes bridge connected the way app.js connects it. Line 9 (a
 * three-layer line, as line-identity.js defines it) over the fake client. */
async function boot(options) {
  const settings = options || {};
  const state = {
    lineType: 3, lineRate: 900, gauge: 0, changeoverTime: "", hopperNamingLine9: "standard",
    layers: layersFor(["A", "B", "C"]), nextRecipe: settings.nextRecipe || null,
    hookupSources: { current: { "A:0": { resin: "LIVE-A0", source: "SILO 1" } }, next: {} },
    resinLots: {}, nextRecipeLots: {}
  };
  const payloadOf = () => ({
    version: "0.17", lineRate: state.lineRate, lineType: state.lineType, gauge: 0, changeoverTime: state.changeoverTime, offsets: {},
    layers: JSON.parse(JSON.stringify(state.layers)), prodResinLb: 0, scrapResinLb: 0, hopperNamingLine9: "standard",
    hookupSources: JSON.parse(JSON.stringify(state.hookupSources)), nextRecipe: state.nextRecipe
  });

  const storage = memoryStorage();
  syncStorage.createStore(storage).saveSettings({ deviceId: "dev-desktop", deviceLabel: "Line 9 Desktop", selectedWorkspaceId: "ws-9", disconnectedWorkspaceIds: [], workspaceCache: [{ id: "ws-9", name: "Line 9", revision: 1 }] });
  const remote = fakeClient({
    line_workspace_members: [{ workspace_id: "ws-9", user_id: "anon-desktop", device_id: "dev-desktop", device_label: "Line 9 Desktop", role: "owner", joined_at: "2026-09-01T08:00:00Z", last_seen_at: "2026-09-01T08:00:00Z" }],
    line_workspaces: [{ id: "ws-9", name: "Line 9", revision: 1 }],
    active_jobs: [{ workspace_id: "ws-9", payload: payloadOf(), revision: 1, last_operation_id: "seed" }],
    saved_setups: [],
    workspace_configurations: [
      recipeRow("r-fit", "Clear film", 3),
      recipeRow("r-five", "Five layer", 5),
      recipeRow("r-other", "Elsewhere", 3, { workspace_id: "ws-other" })
    ]
  }, settings);
  const log = { saves: 0, notified: [], statuses: [], configRenders: 0 };
  let lineSync = null;
  let workspaceConfigurations = null;

  const factory = new Function("env", `
    const window = env.window;
    const state = env.state;
    const validation = env.validation;
    const HOPPERS_PER_LAYER = 6;
    const stationBridge = env.stateBridgeModule.create({ scheduler: run => run() });
    // The module app.js sees: an isolated bridge (as create() gives a
    // test) with the module's own projection beside it.
    const stationRecipes = Object.assign({}, env.recipesBridge, { project: env.project });
    let stationRecipesHandle = null;
    let stationWeightProfilesHandle = null;
    let uiPage = "current";
    let nextRecipeWorking = null;
    let workspaceConfigurationRefreshInFlight = false;
    let workspaceConfigurationWorkspaceId = "";
    let selectedWorkspaceConfigurationId = "";
    const lineSync = { getState: () => env.lineSync().getState() };
    let workspaceConfigurations = null;
    const log = env.log;
    const $ = () => null;
    const document = { querySelectorAll: () => [] };
    const clampNum = value => { const n = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
    const normName = s => String(s || "").trim().replace(/\\s+/g, " ");
    const keyName = s => normName(s).toLowerCase();
    const LINE_LAYERS = { 1: ["A"], 3: ["A", "B", "C"], 5: ["A", "B", "C", "D", "E"] };
    function getLayerNamesForType(lineType){ return LINE_LAYERS[Number(lineType)] || []; }
    function isNextRecipePage(){ return uiPage === "next"; }
    function recipeLayers(){ return isNextRecipePage() ? ensureNextRecipeWorking() : state.layers; }
    function syncPlannedRecipeIndicator(){}
    function autoFirstLayerPctActive(){ return false; }
    function renderSplitsArea(){}
    function renderWeightsArea(){}
    function syncLineTypeUI(){}
    function renderTimelineHookups(){}
    function workspaceConfigurationStatus(message){ log.statuses.push(message); }
    // The floor UI's render keeps the workspace id the mutation closure
    // reads (app.js renderWorkspaceConfigurations does exactly this).
    function renderWorkspaceConfigurations(syncState){ log.configRenders += 1; workspaceConfigurationWorkspaceId = syncState?.selectedWorkspaceId || ""; }
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
    return {
      stationBridge,
      setService: service => { workspaceConfigurations = service; },
      connect: () => { connectStationRecipes(); renderWorkspaceConfigurations(lineSync.getState()); return stationRecipesHandle; },
      publish: () => stationRecipesHandle?.publish(),
      refreshing: () => workspaceConfigurationRefreshInFlight
    };
  `);
  const recipesBridge = recipesBridgeModule.create({ scheduler: run => run() });
  const built = factory({
    window: { PolynHookupSources: hookups, PolynNextRecipe: nextRecipe, PolynWorkspaceConfigurationPayloads: payloads, PolynLineIdentity: require("./line-identity.js") },
    state, validation, stateBridgeModule, recipesBridge, project: recipesBridgeModule.project, log,
    lineSync: () => lineSync
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
      onStateChange: () => {}, onStorageError() {}
    }
  });
  await lineSync.initialize();
  remote.channels[0].cb?.("SUBSCRIBED");
  workspaceConfigurations = configurationsService.create({ storage, getTransport: () => lineSync.getWorkspaceConfigurationTransport() });
  built.setService(workspaceConfigurations);
  const published = [];
  recipesBridge.subscribe(() => published.push(recipesBridge.getRevision()));
  workspaceConfigurations.subscribe(() => built.publish());
  const handle = built.connect();
  assert.ok(handle && handle.isActive(), "app.js's connect installed the recipes producer");
  await workspaceConfigurations.refresh("ws-9");
  const uploadsBefore = remote.rpcCalls.filter(c => c.name === "update_active_job").length;
  const readsBefore = remote.listReads.length;
  const configRpcsBefore = remote.rpcCalls.filter(c => c.name !== "update_active_job").length;
  return {
    state, log, remote, lineSync, bridge: recipesBridge, stationBridge: built.stationBridge, service: workspaceConfigurations, published,
    uploads: () => remote.rpcCalls.filter(c => c.name === "update_active_job").slice(uploadsBefore),
    configRpcs: () => remote.rpcCalls.filter(c => c.name !== "update_active_job").slice(configRpcsBefore),
    listReads: () => remote.listReads.length - readsBefore,
    settle: async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); },
    flush: async () => { await new Promise(resolve => setTimeout(resolve, 750)); }
  };
}

/* ----------------------------------------------------------------------
 *   The book
 * -------------------------------------------------------------------- */

test("the book Station reads is the service's cache for the selected workspace: this line's recipes, named as the line, and never another workspace's", async () => {
  const h = await boot();
  const book = h.bridge.getBook();
  assert.equal(book.assigned, true);
  assert.equal(book.workspace.id, "ws-9");
  assert.equal(book.workspace.displayName, "Line 9");
  assert.deepEqual(book.recipes.map(r => r.id).sort(), ["r-fit", "r-five"]);
  assert.deepEqual([...h.bridge.capabilities()].sort(), ["deleteRecipe", "duplicateRecipe", "loadRecipe", "refresh", "renameRecipe", "replaceRecipe", "saveCurrentRecipe"]);
});

/* ----------------------------------------------------------------------
 *   Load
 * -------------------------------------------------------------------- */

test("load into Current: the running recipe is replaced once - weights, tracking and pump state kept by position, H1 derived - the bridge publishes, one immediate load-workspace-configuration notification, one upload carrying the recipe", async () => {
  const h = await boot();
  const revision = h.stationBridge.getRevision();
  const result = await h.bridge.request("loadRecipe", { id: "r-fit", destination: "current" });
  assert.deepEqual(result, { ok: true });
  const a = h.state.layers[0];
  assert.deepEqual(a.hoppers.slice(0, 3).map(x => x.resinName), ["r-fit-A0", "r-fit-A1", ""]);
  assert.deepEqual(a.hoppers.slice(0, 2).map(x => x.pct), [70, 30]);
  assert.deepEqual(a.hoppers.slice(0, 2).map(x => x.weight), [400, 400], "receiver weights stayed with their hoppers");
  assert.deepEqual(a.hoppers.slice(0, 2).map(x => [x.track, x.pumpOff]), [[true, false], [false, true]], "runtime state stayed with their hoppers");
  assert.equal(h.state.nextRecipe, null, "the plan is untouched by a load into Current");
  assert.ok(h.stationBridge.getRevision() > revision, "the state bridge published");
  assert.deepEqual(h.log.notified, [{ immediate: true, kind: "load-workspace-configuration" }]);
  assert.equal(h.log.statuses.at(-1), "Recipe loaded into Current Recipe.");
  await h.settle();
  const uploads = h.uploads();
  assert.equal(uploads.length, 1, "exactly one update_active_job");
  assert.equal(uploads[0].args.p_payload.layers[0].hoppers[0].resinName, "r-fit-A0");
  assert.equal(uploads[0].args.p_payload.layers[0].hoppers[0].track, true);
  assert.equal(h.lineSync.getState().status, "Synced");
  assert.deepEqual(h.configRpcs(), [], "a load writes nothing to the configurations");
});

test("load into Next: the plan is replaced and saved, the bridge publishes, the running recipe is untouched, and NOTHING is uploaded - a plan is not the running job", async () => {
  const h = await boot();
  const layers = JSON.stringify(h.state.layers);
  const result = await h.bridge.request("loadRecipe", { id: "r-fit", destination: "next" });
  assert.deepEqual(result, { ok: true });
  assert.equal(JSON.stringify(h.state.layers), layers);
  assert.equal(h.state.nextRecipe.layers[0].hoppers[0].resin_name, "r-fit-A0");
  assert.equal(h.stationBridge.getSnapshot().nextRecipe.layers[0].hoppers[0].resinName, "r-fit-A0", "Station's Next face reads the plan at once");
  assert.ok(h.log.saves > 0);
  assert.deepEqual(h.log.notified, []);
  assert.equal(h.log.statuses.at(-1), "Recipe loaded into Next Recipe.");
  await h.flush();
  assert.deepEqual(h.uploads(), []);
  assert.equal(h.lineSync.getState().pendingCount, 0);
  // A five-layer recipe may be planned on a three-layer line: the plan
  // follows the line's structure and the rest is not carried.
  const wide = await h.bridge.request("loadRecipe", { id: "r-five", destination: "next" });
  assert.deepEqual(wide, { ok: true });
  assert.equal(h.state.nextRecipe.layers.length, 3);
});

test("load into Current of a recipe for another layer count is refused by the application's own guard: incompatible, nothing changed, nothing sent", async () => {
  const h = await boot();
  const before = JSON.stringify(h.state);
  const result = await h.bridge.request("loadRecipe", { id: "r-five", destination: "current" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "incompatible");
  assert.equal(result.message, "This recipe is set up for 5 layers, but this line runs 3. Nothing was changed.");
  assert.equal(JSON.stringify(h.state), before);
  assert.deepEqual(h.log.notified, []);
  await h.flush();
  assert.deepEqual(h.uploads(), []);
});

test("another workspace's recipe, or an unknown id, is not_found: nothing changed, nothing sent", async () => {
  const h = await boot();
  for (const id of ["r-other", "r-nowhere"]) {
    for (const action of ["loadRecipe", "replaceRecipe", "renameRecipe", "duplicateRecipe", "deleteRecipe"]) {
      const result = await h.bridge.request(action, { id, destination: "current", name: "X" });
      assert.equal(result.ok, false, `${action} ${id}`);
      assert.equal(result.code, "not_found", `${action} ${id}`);
      assert.equal(result.message, "That saved recipe is no longer in this workspace.");
    }
  }
  assert.deepEqual(h.configRpcs(), []);
  assert.equal(h.listReads(), 0);
  await h.flush();
  assert.deepEqual(h.uploads(), []);
  assert.deepEqual(h.log.notified, []);
});

/* ----------------------------------------------------------------------
 *   Rename, duplicate, delete, replace
 * -------------------------------------------------------------------- */

test("rename, duplicate, delete and replace are exactly one configuration RPC each plus the service's own re-read; the cache moves, the book is republished, and no active job is uploaded", async () => {
  const h = await boot();
  const publishedBefore = h.published.length;

  const renamed = await h.bridge.request("renameRecipe", { id: "r-fit", name: "  Clear   film v2 " });
  assert.deepEqual(renamed, { ok: true });
  assert.deepEqual(h.configRpcs().map(c => [c.name, c.args]), [["rename_workspace_configuration", { p_workspace_id: "ws-9", p_configuration_id: "r-fit", p_name: "Clear film v2" }]]);
  assert.equal(h.listReads(), 1, "the service re-read the list once");
  assert.equal(h.bridge.getBook().recipes.find(r => r.id === "r-fit").name, "Clear film v2");
  assert.ok(h.published.length > publishedBefore, "the book was republished from the cache's own subscription");
  assert.equal(h.log.statuses.at(-1), "Configuration renamed.");

  const duplicated = await h.bridge.request("duplicateRecipe", { id: "r-fit", name: "Clear film copy" });
  assert.deepEqual(duplicated, { ok: true });
  assert.deepEqual(h.configRpcs().at(-1), { name: "duplicate_workspace_configuration", args: { p_workspace_id: "ws-9", p_source_configuration_id: "r-fit", p_name: "Clear film copy" } });
  assert.equal(h.listReads(), 2);
  assert.ok(h.bridge.getBook().recipes.some(r => r.id === "r-fit-copy" && r.name === "Clear film copy"));

  const replaced = await h.bridge.request("replaceRecipe", { id: "r-fit-copy" });
  assert.deepEqual(replaced, { ok: true });
  const update = h.configRpcs().at(-1);
  assert.equal(update.name, "update_workspace_configuration");
  assert.equal(update.args.p_configuration_id, "r-fit-copy");
  assert.equal(update.args.p_payload.layers[0].hoppers[0].resin_name, "LIVE-A0", "the running recipe's own payload, by the application's builder");
  assert.equal(update.args.p_payload.layers[0].hoppers[0].receiver_weight_lb, undefined, "a recipe carries no weight");
  assert.equal(h.listReads(), 3);
  assert.equal(h.bridge.getBook().recipes.find(r => r.id === "r-fit-copy").layers[0].hoppers[0].resinName, "LIVE-A0");

  const deleted = await h.bridge.request("deleteRecipe", { id: "r-fit-copy" });
  assert.deepEqual(deleted, { ok: true });
  assert.deepEqual(h.configRpcs().at(-1), { name: "delete_workspace_configuration", args: { p_workspace_id: "ws-9", p_configuration_id: "r-fit-copy" } });
  assert.equal(h.listReads(), 4);
  assert.ok(!h.bridge.getBook().recipes.some(r => r.id === "r-fit-copy"));
  assert.equal(h.log.statuses.at(-1), "Configuration deleted.");

  assert.equal(h.configRpcs().length, 4, "one RPC per action, and no other");
  assert.deepEqual(h.log.notified, [], "no configuration action touches the running job");
  await h.flush();
  assert.deepEqual(h.uploads(), []);
  assert.equal(h.state.layers[0].hoppers[0].resinName, "LIVE-A0");
});

test("a failed RPC comes back as the service's own failure; the cache, the book and the state are as they were", async () => {
  const h = await boot({ failRpc: "rename_workspace_configuration" });
  const before = JSON.stringify(h.bridge.getBook());
  const result = await h.bridge.request("renameRecipe", { id: "r-fit", name: "Nope" });
  assert.equal(result.ok, false);
  assert.ok(["access_denied", "failed", "network_error"].includes(result.code), result.code);
  assert.equal(h.configRpcs().length, 1);
  assert.equal(h.listReads(), 0, "a failed write is not followed by a re-read");
  assert.equal(JSON.stringify(h.bridge.getBook()), before);
  assert.equal(h.service.listRecipes("ws-9").items.find(r => r.id === "r-fit").name, "Clear film");
  assert.equal(h.log.statuses.at(-1), result.message, "the floor UI's status carries the service's own message");
  await h.flush();
  assert.deepEqual(h.uploads(), []);
});

test("refresh from Station is the floor UI's own refresh: one list read, the book announced going in and coming out", async () => {
  const h = await boot();
  const publishedBefore = h.published.length;
  const result = await h.bridge.request("refresh");
  assert.deepEqual(result, { ok: true });
  assert.equal(h.listReads(), 1);
  assert.ok(h.published.length >= publishedBefore + 2, "announced at the start and the end of the refresh");
  assert.deepEqual(h.configRpcs(), []);
});
