"use strict";

/* Inbound RT Sync, end to end in node: a change made on another device
 * reaches Station only through the application.
 *
 *   RT Sync push (the real cloud-sync.js, over a fake client)
 *     -> adapter.applyRemoteActiveJob      (the application's state moves)
 *     -> saveSession -> state bridge publish
 *     -> Station: source classification, stage patch, editor update
 *
 * and, beside it, the connection descriptor that the same cloud-sync state
 * changes produce for the line console. Nothing in the Station half of
 * this file is handed the client, the channel, or cloud-sync itself: it
 * sees the two bridges, as it does in production.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const cloudSync = require("./cloud-sync.js");
const syncStorage = require("./sync-storage.js");
const lineIdentity = require("./line-identity.js");
const stateBridgeModule = require("./station-state-bridge.js");
const connectionBridgeModule = require("./station-connection-bridge.js");
const source = require("./station/station-source.js");
const lineModel = require("./station/station-line-model.js");
const editorModule = require("./station/station-focus-editor.js");
const commandBridgeModule = require("./station-command-bridge.js");
const consoleModule = require("./station/station-sync-console.js");

/* ----------------------------------------------------------------------
 *   A fake RT Sync client: enough of the shape cloud-sync.js drives
 * -------------------------------------------------------------------- */

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

function fakeClient(rows) {
  const channels = [];
  const rpcCalls = [];
  function query(table) {
    const filters = {};
    const q = {
      select() { return q; }, eq(col, val) { filters[col] = val; return q; }, in(col, vals) { filters[col] = vals; return q; }, order() { return q; },
      rows() { let out = rows[table] || []; for (const [c, v] of Object.entries(filters)) out = out.filter(r => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)); return out; },
      async maybeSingle() { return { data: q.rows()[0] || null, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: q.rows(), error: null }).then(resolve, reject); }
    };
    return q;
  }
  return {
    channels, rpcCalls,
    client: {
      auth: {
        async getSession() { return { data: { session: { user: { id: "anon-desktop" }, access_token: "t" } } }; },
        async signInAnonymously() { return { data: { session: { user: { id: "anon-desktop" }, access_token: "t" } } }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
      },
      realtime: { setAuth() {} },
      channel(name) {
        const handlers = [];
        const chan = {
          name, on(event, filter, handler) { handlers.push({ filter, handler }); return chan; },
          subscribe(cb) { chan.cb = cb; return chan; }, emit(status) { chan.cb?.(status); },
          fireActiveJobUpdate(row) { return handlers.find(h => h.filter?.table === "active_jobs").handler({ new: row }); }
        };
        channels.push(chan);
        return chan;
      },
      async removeChannel() {},
      from(table) { return query(table); },
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        if (name === "generate_link_code") return { data: [{ link_code: "QR77", expires_at: "2026-09-11T15:00:00Z" }], error: null };
        return { data: null, error: null };
      }
    }
  };
}

const LAYERS = ["A", "B", "C"];
function layers(prefix) {
  return LAYERS.map((name, li) => ({
    name, layerPct: li === 1 ? 40 : 30,
    hoppers: Array.from({ length: 6 }, (_, i) => ({
      pct: i === 0 ? 50 : i === 1 ? 40 : i === 2 ? 10 : 0, weight: i < 3 ? 400 : 0,
      resinName: i < 3 ? `${prefix}-${name}${i}` : "",
      track: i === 0, pumpOff: false, usableHeight: 30
    }))
  }));
}

function payloadWith(state) {
  return {
    version: "0.17", lineRate: state.lineRate, lineType: state.lineType, gauge: 0, changeoverTime: "", offsets: {},
    layers: JSON.parse(JSON.stringify(state.layers)), prodResinLb: 0, scrapResinLb: 0, hopperNamingLine9: "standard",
    hookupSources: JSON.parse(JSON.stringify(state.hookupSources))
  };
}

function fixtures(payload) {
  return {
    line_workspace_members: [
      { workspace_id: "ws-9", user_id: "anon-desktop", device_id: "dev-desktop", device_label: "Line 9 Desktop", role: "owner", joined_at: "2026-09-01T08:00:00Z", last_seen_at: "2026-09-01T08:00:00Z" },
      { workspace_id: "ws-9", user_id: "anon-phone", device_id: "dev-phone", device_label: "Operator Phone", role: "member", joined_at: "2026-09-02T09:30:00Z", last_seen_at: "2026-09-02T09:30:00Z" },
      { workspace_id: "ws-9", user_id: "anon-tablet", device_id: "dev-tablet", device_label: "Floor Tablet", role: "member", joined_at: "2026-09-03T10:00:00Z", last_seen_at: "2026-09-03T10:00:00Z" }
    ],
    line_workspaces: [{ id: "ws-9", name: "Line 9", revision: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    active_jobs: [{ workspace_id: "ws-9", payload, revision: 1, last_operation_id: "seed", updated_at: "2026-01-01T00:00:00Z", updated_by: "anon-phone" }],
    saved_setups: []
  };
}

/* ----------------------------------------------------------------------
 *   The application, reduced to what the two bridges see
 * -------------------------------------------------------------------- */

/* A desktop that remembers Line 9 (settings seeded exactly as cloud-sync
 * writes them), running the real cloud-sync over the fake client. The
 * adapter is the application's seam: applyRemoteActiveJob moves `state`
 * and saves - which is where the state bridge publishes - and
 * onStateChange is where the connection bridge publishes, as in app.js. */
async function bootDesktop({ remotePayload } = {}) {
  const storage = memoryStorage();
  const store = syncStorage.createStore(storage);
  store.saveSettings({ deviceId: "dev-desktop", deviceLabel: "Line 9 Desktop", selectedWorkspaceId: "ws-9", disconnectedWorkspaceIds: [], workspaceCache: [{ id: "ws-9", name: "Line 9", revision: 1 }] });

  const state = { lineType: 3, lineRate: 900, layers: layers("LOCAL"), hookupSources: { current: {}, next: {} }, nextRecipe: null };
  const log = { applied: [], saves: 0, syncRenders: 0 };

  const stateBridge = stateBridgeModule.create({ scheduler: run => run() });
  const connection = connectionBridgeModule.create({ scheduler: run => run() });
  let lineSync = null;
  let busy = false;

  function saveSession() { log.saves += 1; stateHandle.publish(); }
  const stateHandle = stateBridge.connect({
    read: () => stateBridge.project(state, {
      lineConfiguration: lineIdentity.getLineConfigurationForSync(lineSync ? lineSync.getState() : null),
      plannedRecipe: null
    })
  });
  const connectionHandle = connection.connect({
    read: () => {
      const syncState = lineSync ? lineSync.getState() : null;
      const workspace = syncState && syncState.selectedWorkspace && syncState.selectedWorkspace.id === syncState.selectedWorkspaceId ? syncState.selectedWorkspace : null;
      return connectionBridgeModule.project(syncState, { lineNumber: lineIdentity.workspaceLineNumber(workspace), busy });
    },
    actions: {
      refresh: async () => { busy = true; connectionHandle.publish(); try { await lineSync.refreshSelected(); } finally { busy = false; connectionHandle.publish(); } return { ok: true }; },
      generateJoinCode: async () => { await lineSync.generateLinkCode(); return { ok: true }; },
      renderJoinQr: async () => ({ ok: true, code: lineSync.getState().generatedCode, svg: "<svg/>" })
    }
  });

  const remote = fakeClient(fixtures(remotePayload || payloadWith({ ...state, layers: layers("REMOTE") })));
  lineSync = cloudSync.create({
    config: { enabled: true, url: "https://example.invalid", publishableKey: "pk" },
    syncStorage, storage, supabaseLibrary: { createClient: () => remote.client },
    adapter: {
      getActiveJob: () => payloadWith(state),
      validateActiveJob: () => ({ valid: true }),
      // applySharedActiveJob, reduced: the shared payload replaces the
      // job's shared fields, then the session is saved (and published).
      applyRemoteActiveJob: (payload, meta) => {
        log.applied.push(meta.reason);
        state.lineType = payload.lineType; state.lineRate = payload.lineRate;
        state.layers = JSON.parse(JSON.stringify(payload.layers));
        state.hookupSources = JSON.parse(JSON.stringify(payload.hookupSources || { current: {}, next: {} }));
        saveSession();
      },
      applyLocalReplacement() {},
      getSavedConfigs: () => ({}), replaceSavedConfigs() {},
      resolveActiveConflict: async () => "remote",
      onStateChange: () => { log.syncRenders += 1; connectionHandle.publish(); },
      onStorageError() {}
    }
  });
  await lineSync.initialize();
  remote.channels[0].emit("SUBSCRIBED");
  return { state, log, stateBridge, connection, lineSync, remote, stateHandle };
}

/* Station's side: the resolved source and, when a layer is open, its
 * editor - built from the bridge exactly as station.js builds them. */
function stationOver(stateBridge, openLayer, doc) {
  const resolved = source.resolveSource({ snapshot: stateBridge.getSnapshot(), demoLines: require("./station/station-demo-lines.js"), demoId: "", mode: "auto" });
  const model = lineModel.buildLineModel(resolved.modelInput);
  let editor = null;
  if (openLayer && doc) {
    /* An executor that accepts every command and changes nothing: what
     * matters here is that the rows are EDITABLE, so a draft and a search
     * can exist to be protected. The commands themselves are covered by
     * the executor and outbound tests. */
    const commands = commandBridgeModule.create();
    const contract = require("./station-command-contract.js");
    commands.connect({ execute: () => contract.success({ changed: false }), capabilities: ["setHopperResin", "setHopperBlend", "setSource"] });
    editor = editorModule.create(doc, {
      layer: model.layers.find(layer => layer.id === openLayer), hopperState: resolved.hopperState,
      resins: () => [{ code: "REMOTE-B1" }, { code: "LOCAL-C1" }, { code: "NEW-C1" }],
      selected: null, commands, recipe: "current",
      onSelect() {}, onEditing() {}, onCommitted() {}
    });
  }
  return { resolved, model, editor };
}

/* The same fake DOM the console test uses, trimmed to what the editor
 * needs here. */
function fakeDocument() {
  let focusedNode = null;
  function makeNode(name) {
    const node = {
      tagName: name.toUpperCase(), attributes: {}, children: [], parent: null, listeners: {}, textContent: "", value: "",
      get firstChild() { return this.children[0] || null; },
      setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
      hasAttribute(k) { return k in this.attributes; }, removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { this.children.push(c); c.parent = this; return c; },
      removeChild(c) { const at = this.children.indexOf(c); if (at >= 0) this.children.splice(at, 1); c.parent = null; return c; },
      contains(o) { let n = o; while (n) { if (n === this) return true; n = n.parent; } return false; },
      closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parent; } return null; },
      querySelectorAll(sel) { const out = []; walk(this, n => { if (n !== this && matches(n, sel)) out.push(n); }); return out; },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      dispatchEvent(e) { e.target = e.target || this; let n = this; while (n && !e.stopped) { for (const fn of n.listeners[e.type] || []) fn(e); if (!e.bubbles) break; n = n.parent; } return true; },
      focus() { focusedNode = this; }, select() {}, setPointerCapture() {}, releasePointerCapture() {},
      classList: {
        add(x) { const s = cls(node); s.add(x); node.attributes.class = [...s].join(" "); },
        remove(x) { const s = cls(node); s.delete(x); node.attributes.class = [...s].join(" "); },
        contains(x) { return cls(node).has(x); },
        toggle(x, force) { const on = force === undefined ? !cls(node).has(x) : !!force; (on ? this.add : this.remove)(x); return on; }
      }
    };
    return node;
  }
  function cls(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
  function matches(node, sel) {
    const attr = sel.match(/^\[([a-z-]+)='([^']+)'\]$/); if (attr) return node.getAttribute(attr[1]) === attr[2];
    const bare = sel.match(/^\[([a-z-]+)\]$/); if (bare) return node.hasAttribute(bare[1]);
    const c = sel.match(/^\.([a-z0-9_-]+)$/i); if (c) return cls(node).has(c[1]);
    throw new Error(`unsupported selector ${sel}`);
  }
  function walk(n, visit) { visit(n); for (const c of n.children) walk(c, visit); }
  const doc = makeNode("#document");
  doc.createElement = name => makeNode(name);
  doc.captureListeners = {};
  doc.addEventListener = (t, fn, capture) => { const b = capture ? doc.captureListeners : doc.listeners; (b[t] = b[t] || []).push(fn); };
  doc.removeEventListener = (t, fn, capture) => { const b = capture ? doc.captureListeners : doc.listeners; b[t] = (b[t] || []).filter(x => x !== fn); };
  Object.defineProperty(doc, "activeElement", { get: () => focusedNode });
  return doc;
}

const row = (editor, id) => editor.element.querySelector(`[data-hopper='${id}']`);
const resinValue = (editor, id) => row(editor, id).querySelector(".station-editor__resin-value").textContent;

/* ----------------------------------------------------------------------
 *   Startup: the remembered line is Line 9, and its state is the line's
 * -------------------------------------------------------------------- */

test("a desktop that remembers Line 9 comes up as Line 9 on both bridges, showing the line's active job rather than its own local one", async () => {
  const desktop = await bootDesktop();
  // The application reconciled with the line at startup; the line's job
  // replaced the local one through the same adapter a live push uses.
  assert.deepEqual(desktop.log.applied, ["reconcile"]);
  assert.equal(desktop.state.layers[1].hoppers[1].resinName, "REMOTE-B1");

  const status = desktop.connection.getStatus();
  assert.equal(status.line.displayName, "Line 9");
  assert.equal(status.line.lineNumber, 9);
  assert.equal(status.linked, true);
  assert.equal(status.status.key, "synced");
  assert.equal(status.deviceCount, 3);
  assert.equal(status.devices.find(device => device.thisDevice).label, "Line 9 Desktop");

  const snapshot = desktop.stateBridge.getSnapshot();
  assert.equal(snapshot.line.lineNumber, 9, "the state bridge names the same line");
  assert.equal(snapshot.line.linked, true);
  assert.equal(snapshot.line.hopperNamingMode, "main-plus-five", "Line 9's own naming, from the same line identity module");

  const station = stationOver(desktop.stateBridge);
  assert.equal(station.resolved.kind, "live");
  assert.equal(station.resolved.label, "Live");
  assert.equal(station.model.line.displayName, "Line 9");
  assert.equal(station.resolved.hopperState["B:1"].resinName, "REMOTE-B1", "Station reads the line's job, not a seeded one");

  // One authoritative source for which line this is: both descriptors
  // derive from cloud-sync's selected workspace through PolynLineIdentity.
  assert.equal(desktop.lineSync.getState().selectedWorkspaceId, status.line.workspaceId);
  assert.equal(lineIdentity.workspaceLineNumber(desktop.lineSync.getState().selectedWorkspace), snapshot.line.lineNumber);
});

test("Current and Next stay separately addressable over the live line: Next is the plan, or null when there is none", async () => {
  const desktop = await bootDesktop();
  assert.equal(desktop.stateBridge.getSnapshot().nextRecipe, null);
  desktop.state.nextRecipe = { layers: [{ name: "A", layer_pct: 100, hoppers: [{ pct: 100, resin_name: "PLANNED-A0" }] }] };
  // As app.js does: the working plan is projected beside the current job.
  const withPlan = desktop.stateBridge.project(desktop.state, { plannedRecipe: desktop.state.nextRecipe });
  assert.equal(withPlan.nextRecipe.layers[0].hoppers[0].resinName, "PLANNED-A0");
  assert.equal(withPlan.layers[0].hoppers[0].resinName, "REMOTE-A0", "Current is untouched by the plan");
});

/* ----------------------------------------------------------------------
 *   Inbound: a phone changes B2 while the operator is in C2
 * -------------------------------------------------------------------- */

/* Line 9 names its hoppers Main, 1..5 - so on layer B the second physical
 * hopper (index 1) is B1, the third is B2 (assigned, so it has a percentage
 * field), the fourth B3 (empty, so its placeholder opens the resin search). */

async function pushFromPhone(desktop, change) {
  const remotePayload = payloadWith(desktop.state);
  change(remotePayload);
  const savesBefore = desktop.log.saves;
  const revision = desktop.lineSync.getState().activeRevision + 1;
  await desktop.remote.channels[0].fireActiveJobUpdate({ workspace_id: "ws-9", payload: remotePayload, revision, last_operation_id: `phone-op-${revision}` });
  assert.equal(desktop.log.saves, savesBefore + 1, "the application applied it once and saved once");
  return source.resolveSource({ snapshot: desktop.stateBridge.getSnapshot(), demoLines: require("./station/station-demo-lines.js"), demoId: "", mode: "auto" });
}

test("a phone changes B1 while the operator is typing B2's percentage: B1 updates in Station through the application, the B2 draft is intact", async () => {
  const desktop = await bootDesktop();
  const doc = fakeDocument();
  const station = stationOver(desktop.stateBridge, "B", doc);
  const before = station.resolved;
  assert.equal(resinValue(station.editor, "B1"), "REMOTE-B1");

  const pct = row(station.editor, "B2").querySelector(".station-editor__pct-input");
  pct.focus();
  pct.dispatchEvent({ type: "focus" });
  pct.value = "12";
  pct.dispatchEvent({ type: "input" });

  const after = await pushFromPhone(desktop, payload => {
    payload.layers[1].hoppers[1].resinName = "PHONE-B1";
    payload.layers[1].hoppers[1].pct = 35;
  });
  assert.deepEqual(desktop.log.applied, ["reconcile", "realtime"]);
  assert.equal(desktop.state.layers[1].hoppers[1].resinName, "PHONE-B1");

  // Station: a value change, patched into the rows - not a rebuild.
  assert.equal(source.classifyChange(before, after), "values");
  station.editor.update({ hopperState: after.hopperState });
  assert.equal(resinValue(station.editor, "B1"), "PHONE-B1");
  assert.equal(row(station.editor, "B1").querySelector(".station-editor__pct-input").value, "35");
  assert.equal(pct.value, "12", "the draft is intact");
  assert.equal(row(station.editor, "B2").querySelector(".station-editor__pct-input"), pct, "the same field, not a rebuilt one");
  assert.ok(!row(station.editor, "B2").classList.contains("is-changed-underneath"), "B2 itself did not move");
});

test("a phone changes an unrelated source while a resin search is open on B3: the search stays open with its draft, the source shows", async () => {
  const desktop = await bootDesktop();
  const doc = fakeDocument();
  const station = stationOver(desktop.stateBridge, "B", doc);
  const before = station.resolved;

  const searchRow = row(station.editor, "B3");
  searchRow.querySelector(".station-editor__resin-value").dispatchEvent({ type: "click", bubbles: true, preventDefault() {}, stopPropagation() {} });
  const search = searchRow.querySelector(".station-editor__search");
  assert.ok(search, "the search is open");
  search.value = "NEW";
  search.dispatchEvent({ type: "input" });

  const after = await pushFromPhone(desktop, payload => {
    payload.hookupSources.current["B:1"] = { resin: "REMOTE-B1", source: "SILO 4" };
  });
  assert.equal(source.classifyChange(before, after), "values");
  station.editor.update({ hopperState: after.hopperState });
  assert.equal(searchRow.querySelector(".station-editor__search"), search, "the search is still open");
  assert.equal(search.value, "NEW");
  assert.ok(searchRow.classList.contains("is-searching"));
  assert.equal(row(station.editor, "B1").querySelector(".station-editor__source-value").textContent, "SILO 4");
});

test("a phone changes the very hopper being edited: the field keeps the draft and is marked changed-underneath, as Station already does", async () => {
  const desktop = await bootDesktop();
  const doc = fakeDocument();
  const station = stationOver(desktop.stateBridge, "B", doc);
  const pct = row(station.editor, "B1").querySelector(".station-editor__pct-input");
  pct.focus();
  pct.dispatchEvent({ type: "focus" });
  pct.value = "42";
  pct.dispatchEvent({ type: "input" });
  const after = await pushFromPhone(desktop, payload => { payload.layers[1].hoppers[1].pct = 35; });
  station.editor.update({ hopperState: after.hopperState });
  assert.equal(pct.value, "42", "the operator's draft is not overwritten");
  assert.ok(row(station.editor, "B1").classList.contains("is-changed-underneath"));
  assert.match(station.editor.element.querySelector(".station-editor__note").textContent, /B1's percentage is now 35%/);
});

test("a push that changes the line's structure is classified structural; one that changes nothing the drawing reads is none", async () => {
  const desktop = await bootDesktop();
  const before = stationOver(desktop.stateBridge).resolved;
  const resolve = () => source.resolveSource({ snapshot: desktop.stateBridge.getSnapshot(), demoLines: require("./station/station-demo-lines.js"), demoId: "", mode: "auto" });

  // Only the line rate moved: nothing the machine draws.
  const rateOnly = payloadWith(desktop.state); rateOnly.lineRate = 1200;
  await desktop.remote.channels[0].fireActiveJobUpdate({ workspace_id: "ws-9", payload: rateOnly, revision: 2, last_operation_id: "op-rate" });
  assert.equal(source.classifyChange(before, resolve()), "none");

  // A hopper's profile height changed: the drawing's geometry, structural.
  const height = payloadWith(desktop.state); height.layers[0].hoppers[0].usableHeight = 48;
  await desktop.remote.channels[0].fireActiveJobUpdate({ workspace_id: "ws-9", payload: height, revision: 3, last_operation_id: "op-height" });
  assert.equal(source.classifyChange(before, resolve()), "structural");
});

test("a stale or foreign push is ignored by the application, so Station is never told", async () => {
  const desktop = await bootDesktop();
  const revision = desktop.stateBridge.getRevision();
  const stale = payloadWith(desktop.state); stale.layers[1].hoppers[1].resinName = "STALE";
  await desktop.remote.channels[0].fireActiveJobUpdate({ workspace_id: "ws-9", payload: stale, revision: 1, last_operation_id: "old" });
  await desktop.remote.channels[0].fireActiveJobUpdate({ workspace_id: "ws-other", payload: stale, revision: 9, last_operation_id: "other" });
  assert.equal(desktop.stateBridge.getRevision(), revision, "no publish");
  assert.equal(desktop.state.layers[1].hoppers[1].resinName, "REMOTE-B1");
});

/* ----------------------------------------------------------------------
 *   The connection descriptor over real cloud-sync state
 * -------------------------------------------------------------------- */

test("the console's Refresh runs the application's own refreshSelected once: a full reconcile with the line, and the busy flag shows while it runs", async () => {
  const desktop = await bootDesktop();
  const doc = fakeDocument();
  const built = consoleModule.create(doc, { connection: desktop.connection });
  built.open();
  const rpcBefore = desktop.remote.rpcCalls.length;
  const appliedBefore = desktop.log.applied.length;
  const pending = desktop.connection.request("refresh");
  assert.equal(desktop.connection.getStatus().busy.active, true);
  assert.equal(built.element.querySelector("[data-action='refresh']").disabled, true);
  await pending;
  assert.equal(desktop.connection.getStatus().busy.active, false);
  // refreshSelected forces the remote row back in: one more apply, from
  // "reconcile", and no page reload anywhere in the chain.
  assert.equal(desktop.log.applied.length, appliedBefore + 1);
  assert.equal(desktop.log.applied[desktop.log.applied.length - 1], "reconcile");
  assert.equal(desktop.remote.rpcCalls.length, rpcBefore, "a refresh writes nothing");
  assert.equal(desktop.connection.getStatus().status.key, "synced");
});

test("Add device goes through the application's generate_link_code, and the code on the descriptor is the one the console shows", async () => {
  const desktop = await bootDesktop();
  const doc = fakeDocument();
  const built = consoleModule.create(doc, { connection: desktop.connection });
  built.open();
  built.element.querySelector("[data-action='add-device']").dispatchEvent({ type: "click", bubbles: true });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const minted = desktop.remote.rpcCalls.filter(call => call.name === "generate_link_code");
  assert.equal(minted.length, 1);
  assert.deepEqual(minted[0].args, { p_workspace_id: "ws-9" });
  assert.equal(desktop.lineSync.getState().generatedCode, "QR77");
  assert.equal(desktop.connection.getStatus().joinCode.code, "QR77");
  assert.equal(built.showingQr(), true);
  assert.equal(built.element.querySelector(".station-sync__code").textContent, "QR77");
});

test("a locally disconnected desktop reads LINE 9 · LOCAL ONLY with Reconnect on offer, and keeps its job on screen", async () => {
  const desktop = await bootDesktop();
  await desktop.lineSync.disconnectLocal();
  const status = desktop.connection.getStatus();
  assert.equal(status.line.displayName, "Line 9");
  assert.equal(status.linked, false);
  assert.equal(status.status.key, "local-only");
  assert.deepEqual(status.can, { refresh: false, reconnect: true, addDevice: false });
  assert.equal(consoleModule.summarize(status).text, "Line 9 · Local only · 3 devices");
  // The job is still there to look at; only the link is down.
  const station = stationOver(desktop.stateBridge);
  assert.equal(station.resolved.kind, "live");
  assert.equal(station.resolved.hopperState["B:1"].resinName, "REMOTE-B1");
  assert.equal(desktop.stateBridge.getSnapshot().line.linked, false, "the state bridge stops vouching for the line's identity");
});

test("an offline upload failure is reported as Offline, not Synced", async () => {
  const desktop = await bootDesktop();
  desktop.remote.client.rpc = async () => { throw new Error("Failed to fetch"); };
  const hadNavigator = "navigator" in globalThis;
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true, writable: true });
  try {
    desktop.state.lineRate = 1500;
    desktop.lineSync.notifyActiveJobMutation({ immediate: true });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const status = desktop.connection.getStatus();
    assert.equal(status.status.key, "offline");
    assert.equal(status.status.pendingCount, 1);
    assert.equal(consoleModule.summarize(status).text, "Line 9 · Offline (1) · 3 devices");
  } finally {
    if (hadNavigator) Object.defineProperty(globalThis, "navigator", { value: previous, configurable: true, writable: true });
    else delete globalThis.navigator;
  }
});
