"use strict";

/* The Station command executor (app.js: createStationCommandExecutor), run
 * for real.
 *
 * app.js is a browser IIFE, so the pieces the executor is built from are
 * lifted out of its source by anchor and run together under stubs for the
 * DOM and the network: the real recomputeAutoH1, the real Next working-copy
 * logic, the real recipe history block, the real planned-recipe and
 * hookup reconciliation, and the executor itself - wired to the real state
 * bridge, the real command bridge and contract, the real hookup-sources,
 * next-recipe and validation modules. What is stubbed is rendering, the
 * session write and RT Sync notification, each of which records that it was
 * asked. So a test here dispatches through the bridge Station will use and
 * watches the application's own state, history and publications move.
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

/* ----------------------------------------------------------------------
 *   Lifting the application's own code
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

function layersFor(names, prefix) {
  return names.map(name => ({
    name, layerPct: Math.round(100 / names.length),
    hoppers: Array.from({ length: 6 }, (_, index) => ({
      pct: index === 0 ? 60 : index === 1 ? 40 : 0,
      weight: index < 2 ? 400 : 0,
      resinName: index === 0 ? `${prefix}-${name}0` : index === 1 ? `${prefix}-${name}1` : "",
      track: index === 0, pumpOff: false, usableHeight: 30, circumference: 0, usableGallons: 0
    }))
  }));
}

function boot(options) {
  const settings = options || {};
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
    const syncState = { isApplyingRemote: false };
    const lineSync = { getState: () => syncState };
    const flags = { autoFirst: false, saveOk: true };
    const log = { renders: 0, validates: [], saves: 0, notified: [], hookupRenders: 0 };
    const $ = () => null;
    const document = { querySelectorAll: () => [] };
    const clampNum = value => { const n = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
    const normName = s => String(s || "").trim().replace(/\\s+/g, " ");
    const LINE_LAYERS = { 1: ["A"], 3: ["A", "B", "C"], 5: ["A", "B", "C", "D", "E"] };
    function getLayerNamesForType(lineType){ return LINE_LAYERS[Number(lineType)] || []; }
    function isNextRecipePage(){ return uiPage === "next"; }
    function recipeLayers(){ return isNextRecipePage() ? ensureNextRecipeWorking() : state.layers; }
    function syncPlannedRecipeIndicator(){}
    function autoFirstLayerPctActive(){ return flags.autoFirst; }
    function renderSplitsArea(){ log.renders += 1; }
    function renderTimelineHookups(){ log.hookupRenders += 1; }
    function validateAndCompute({ sync = false, immediate = false, kind = "edit" } = {}){
      log.validates.push({ sync, immediate, kind });
      reconcileHookupSources();
      saveSession();
      if (sync) log.notified.push({ immediate, kind });
    }
    function saveSession(){
      commitNextRecipeWorking();
      log.saves += 1;
      stationBridgeHandle.publish();
      return flags.saveOk;
    }
    ${LIFTED}
    const stationBridgeHandle = stationBridge.connect({
      read: () => stationBridge.project(state, {
        plannedRecipe: plannedRecipePayload(),
        history: recipeHistoryAvailability()
      })
    });
    const commands = env.commandBridgeModule.create();
    const executor = createStationCommandExecutor();
    return {
      commands, executor, state, log, flags, stationBridge, stationBridgeHandle,
      recipeEditHistory, snapshotRecipeEdit, recordRecipeEdit, undoRecipeEdit, redoRecipeEdit,
      ensureNextRecipeWorking, plannedRecipePayload,
      working: () => nextRecipeWorking,
      setPage(page){ uiPage = page; },
      setRearranging(on){ hopperRearrangement = on ? { active: true } : null; },
      setApplyingRemote(on){ syncState.isApplyingRemote = !!on; }
    };
  `);
  const env = {
    window: { PolynHookupSources: hookups, PolynNextRecipe: nextRecipe },
    state: settings.state || {
      lineType: 3, hopperNamingLine9: "standard",
      layers: layersFor(["A", "B", "C"], "LIVE"),
      nextRecipe: settings.nextRecipe === undefined ? null : settings.nextRecipe,
      hookupSources: { current: { "A:0": { resin: "LIVE-A0", source: "SILO 1" } }, next: {} },
      resinLots: {}, nextRecipeLots: {}
    },
    validation, contract, stateBridgeModule, commandBridgeModule, lifted: LIFTED
  };
  const built = factory(env);
  if (settings.connect !== false) {
    built.handle = built.commands.connect({ execute: built.executor.execute, capabilities: built.executor.capabilities });
  }
  built.dispatch = (command, args) => built.commands.dispatch(command, args);
  built.hopper = (recipe, layer, index) => {
    const layers = recipe === "next" ? built.working() : built.state.layers;
    return layers.find(L => L.name === layer).hoppers[index];
  };
  built.stateJson = () => JSON.stringify({ state: built.state, working: built.working(), history: built.recipeEditHistory });
  return built;
}

const CUR = { recipe: "current", layer: "A" };
const NXT = { recipe: "next", layer: "A" };

/* ----------------------------------------------------------------------
 *   Connection
 * -------------------------------------------------------------------- */

test("unavailable until the application connects; available with exactly the implemented commands after", () => {
  const h = boot({ connect: false });
  assert.equal(h.commands.isAvailable(), false);
  assert.equal(h.dispatch("undo", { recipe: "current" }).code, "unavailable");
  const handle = h.commands.connect({ execute: h.executor.execute, capabilities: h.executor.capabilities });
  assert.equal(h.commands.isAvailable(), true);
  assert.deepEqual([...h.commands.capabilities()].sort(), [...contract.COMMANDS].sort());
  assert.deepEqual(h.executor.capabilities, ["setHopperResin", "setHopperBlend", "setLayerShare", "clearHopper", "setSource", "undo", "redo"]);
  assert.throws(() => h.commands.connect({ execute: () => {}, capabilities: [] }), /already connected/);
  assert.equal(handle.disconnect(), true);
  assert.equal(h.commands.isAvailable(), false);
  assert.equal(h.dispatch("undo", { recipe: "current" }).code, "unavailable");
});

test("app.js installs the executor once, beside the state bridge, and nothing else connects a producer", () => {
  assert.equal((app.match(/stationCommands\.connect\s*\(/g) || []).length, 1);
  assert.equal((app.match(/connectStationCommands\(\);/g) || []).length, 1);
  const init = app.slice(app.indexOf("connectStationBridge();\n"));
  assert.match(init.slice(0, 200), /connectStationBridge\(\);\n\s+connectStationCommands\(\);/);
  assert.match(app, /if \(!stationCommands \|\| !stationCommandContract \|\| stationCommandHandle\) return;/);
  assert.match(app, /catch\(error\)\{ stationCommandHandle = null; \}/);
  const executorSource = block("  function createStationCommandExecutor(){", "\n  }\n");
  for (const forbidden of [/localStorage/, /supabase/i, /notifyActiveJobMutation/, /stationBridgeHandle/, /\.publish\s*\(/, /fetch\s*\(/]) {
    assert.doesNotMatch(executorSource, forbidden, `the executor reaches past the application's own tail (${forbidden})`);
  }
  // Station files still connect nothing and dispatch nothing.
  for (const file of fs.readdirSync(path.join(ROOT, "station")).filter(name => name.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(ROOT, "station", file), "utf8");
    assert.doesNotMatch(source, /PolynStationCommandBridge\s*\.\s*connect|commands\.connect\s*\(/, `${file} connects a producer`);
    assert.doesNotMatch(source, /\.dispatch\s*\(/, `${file} dispatches a command`);
  }
});

/* ----------------------------------------------------------------------
 *   Resin
 * -------------------------------------------------------------------- */

test("setHopperResin on Current writes the normalized value into state.layers through the grid's own tail", () => {
  const h = boot();
  const before = h.stationBridge.getRevision();
  const result = h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "  hx  204 " }));
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.persisted, true);
  assert.equal(h.hopper("current", "A", 2).resinName, "hx 204", "normName: trimmed and whitespace-collapsed, case kept");
  assert.deepEqual(h.log.validates, [{ sync: true, immediate: false, kind: "edit" }]);
  assert.deepEqual(h.log.notified, [{ immediate: false, kind: "edit" }]);
  assert.equal(h.log.renders, 1);
  assert.equal(h.log.saves, 2, "validateAndCompute saves, and the tail saves again - as the grid's handlers do");
  assert.ok(result.revision > before);
  assert.equal(result.snapshot.layers[0].hoppers[2].resinName, "hx 204");
  assert.equal(h.recipeEditHistory.current.undo.length, 1);
  assert.equal(h.recipeEditHistory.next.undo.length, 0);
  assert.equal(h.working(), null, "a Current edit never touches Next's working copy");
});

test("setHopperResin on Next writes the working plan, commits it on save, and leaves Current alone", () => {
  const h = boot();
  const result = h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 1, resin: "PLAN-1" }));
  assert.equal(result.ok, true);
  assert.equal(h.working()[0].hoppers[1].resinName, "PLAN-1");
  assert.equal(h.state.layers[0].hoppers[1].resinName, "LIVE-A1");
  assert.equal(h.state.nextRecipe.layers[0].hoppers[1].resin_name, "PLAN-1", "saveSession commits the working plan");
  assert.equal(result.snapshot.nextRecipe.layers[0].hoppers[1].resinName, "PLAN-1");
  assert.equal(result.snapshot.layers[0].hoppers[1].resinName, "LIVE-A1");
  assert.equal(h.recipeEditHistory.next.undo.length, 1);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
});

test("a resin edit that changes nothing is changed:false with no history, no save, no publish", () => {
  const h = boot();
  const before = h.stateJson();
  const revision = h.stationBridge.getRevision();
  const result = h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 0, resin: " LIVE-A0 " }));
  assert.deepEqual({ ok: result.ok, changed: result.changed, persisted: result.persisted }, { ok: true, changed: false, persisted: false });
  assert.equal(result.revision, revision);
  assert.equal(h.log.saves, 0);
  assert.equal(h.log.validates.length, 0);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
  assert.equal(h.stateJson(), before);
  assert.ok(Object.isFrozen(result.snapshot));
});

test("resin failures name the live fault and touch nothing", () => {
  const h = boot();
  const before = h.stateJson();
  assert.equal(h.dispatch("setHopperResin", { recipe: "current", layer: "Z", index: 0, resin: "X" }).code, "unknown_layer");
  // Contractually valid index 5, but this layer has only four hoppers.
  const spare = h.state.layers[1].hoppers.splice(4, 2);
  const short = h.dispatch("setHopperResin", { recipe: "current", layer: "B", index: 5, resin: "X" });
  assert.equal(short.code, "unknown_hopper");
  assert.equal(short.field, "index");
  h.state.layers[1].hoppers.push(...spare);
  assert.equal(h.stateJson(), before);
  assert.equal(h.log.saves, 0);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
});

/* ----------------------------------------------------------------------
 *   Blend
 * -------------------------------------------------------------------- */

test("setHopperBlend sets the hopper's share and re-derives H1, on Current and on Next", () => {
  const h = boot();
  const result = h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 25 }));
  assert.equal(result.ok, true);
  assert.equal(h.hopper("current", "A", 1).pct, 25);
  assert.equal(h.hopper("current", "A", 0).pct, 75, "H1 is 100 minus the others");
  assert.equal(result.snapshot.layers[0].hoppers[0].pct, 75);

  // No plan is stored, so Next starts as an empty structure with H1 at 100.
  const next = h.dispatch("setHopperBlend", Object.assign({}, NXT, { index: 2, pct: 10 }));
  assert.equal(next.ok, true);
  assert.equal(h.working()[0].hoppers[2].pct, 10);
  assert.equal(h.working()[0].hoppers[0].pct, 90, "Next's H1 re-derived from its own hoppers, not Current's");
  assert.equal(h.state.layers[0].hoppers[2].pct, 0, "Current untouched by a Next blend");
  assert.equal(h.recipeEditHistory.current.undo.length, 1);
  assert.equal(h.recipeEditHistory.next.undo.length, 1);
});

test("setHopperBlend refuses H1, a blend that would exceed 100, and is a no-op at the same value", () => {
  const h = boot();
  const before = h.stateJson();
  assert.equal(h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 0, pct: 50 })).code, "h1_derived");
  const over = h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 2, pct: 70 }));
  assert.equal(over.code, "blend_total");
  assert.equal(over.total, 110, "40 already on A2 plus the 70 asked for");
  assert.match(over.message, /cannot total more than 100/);
  assert.equal(h.stateJson(), before, "a refused blend left state byte-identical");
  assert.equal(h.log.saves, 0);
  const same = h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 40 }));
  assert.deepEqual([same.ok, same.changed], [true, false]);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
  // Exactly 100 is allowed: 60 on A2 makes H1 zero.
  const edge = h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 100 }));
  assert.equal(edge.ok, true);
  assert.equal(h.hopper("current", "A", 0).pct, 0);
});

test("out-of-range and malformed percentages never reach the executor", () => {
  const h = boot();
  assert.equal(h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 101 })).code, "out_of_range");
  assert.equal(h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: -1 })).code, "out_of_range");
  assert.equal(h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: "abc" })).code, "bad_argument");
  assert.equal(h.log.saves, 0);
});

/* ----------------------------------------------------------------------
 *   Layer share
 * -------------------------------------------------------------------- */

test("setLayerShare sets a layer's share on the addressed recipe only, and is a no-op at the same value", () => {
  const h = boot();
  const result = h.dispatch("setLayerShare", { recipe: "current", layer: "B", pct: 45.5 });
  assert.equal(result.ok, true);
  assert.equal(h.state.layers[1].layerPct, 45.5);
  assert.equal(result.snapshot.layers[1].layerPct, 45.5);
  const next = h.dispatch("setLayerShare", { recipe: "next", layer: "B", pct: 20 });
  assert.equal(next.ok, true);
  assert.equal(h.working()[1].layerPct, 20);
  assert.equal(h.state.layers[1].layerPct, 45.5, "Current kept its own share");
  assert.equal(next.snapshot.nextRecipe.layers[1].layerPct, 20);
  const same = h.dispatch("setLayerShare", { recipe: "current", layer: "B", pct: 45.5 });
  assert.deepEqual([same.ok, same.changed], [true, false]);
  assert.equal(h.dispatch("setLayerShare", { recipe: "current", layer: "Q", pct: 1 }).code, "unknown_layer");
  // A share total other than 100 is an attention fact, not a block - as in the grid.
  assert.equal(h.dispatch("setLayerShare", { recipe: "current", layer: "A", pct: 100 }).ok, true);
});

test("on the phone layout the first layer's share is derived and refused, the others re-derive it", () => {
  const h = boot();
  h.flags.autoFirst = true;
  assert.equal(h.dispatch("setLayerShare", { recipe: "current", layer: "A", pct: 10 }).code, "h1_derived");
  assert.equal(h.dispatch("setLayerShare", { recipe: "current", layer: "B", pct: 50 }).ok, true);
  assert.equal(h.state.layers[0].layerPct, 100 - 50 - h.state.layers[2].layerPct);
});

/* ----------------------------------------------------------------------
 *   Clear: the grid's × button, exactly
 * -------------------------------------------------------------------- */

test("clearHopper matches the × button: resin cleared, share zeroed and H1 re-derived, tracking off, synced as recipe-clear", () => {
  const h = boot();
  h.state.layers[0].hoppers[1].track = true;
  const result = h.dispatch("clearHopper", Object.assign({}, CUR, { index: 1 }));
  assert.equal(result.ok, true);
  const hopper = h.hopper("current", "A", 1);
  assert.equal(hopper.resinName, "");
  assert.equal(hopper.pct, 0);
  assert.equal(hopper.track, false, "the × unlinks a cleared hopper from the Timeline");
  assert.equal(hopper.weight, 400, "physical weight stays with the hopper");
  assert.equal(h.hopper("current", "A", 0).pct, 100, "H1 re-derived");
  assert.deepEqual(h.log.validates, [{ sync: true, immediate: true, kind: "recipe-clear" }]);
  assert.deepEqual(h.log.notified, [{ immediate: true, kind: "recipe-clear" }]);
  assert.equal(h.recipeEditHistory.current.undo.length, 1);
  // The grid records history AFTER the save; the snapshot it keeps is the
  // pre-clear state, so undo brings resin, share and tracking back.
  assert.equal(h.dispatch("undo", { recipe: "current" }).ok, true);
  assert.deepEqual([hopper.resinName, hopper.pct, hopper.track].concat([h.hopper("current", "A", 1).resinName]),
    ["", 0, false, "LIVE-A1"]);
  assert.equal(h.hopper("current", "A", 1).track, true);
});

test("clearing H1 clears its resin and tracking but leaves its derived share, as the × does", () => {
  const h = boot();
  const result = h.dispatch("clearHopper", Object.assign({}, CUR, { index: 0 }));
  assert.equal(result.ok, true);
  const h1 = h.hopper("current", "A", 0);
  assert.equal(h1.resinName, "");
  assert.equal(h1.track, false);
  assert.equal(h1.pct, 60, "H1's percentage is derived and is not zeroed by a clear");
});

test("clearHopper on Next clears the plan's hopper only, and an already-clear hopper is a no-op", () => {
  const h = boot();
  h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 1, resin: "PLAN-1" }));
  h.dispatch("setHopperBlend", Object.assign({}, NXT, { index: 1, pct: 30 }));
  const result = h.dispatch("clearHopper", Object.assign({}, NXT, { index: 1 }));
  assert.equal(result.ok, true);
  assert.equal(h.working()[0].hoppers[1].resinName, "");
  assert.equal(h.working()[0].hoppers[1].pct, 0);
  assert.equal(h.working()[0].hoppers[0].pct, 100);
  assert.equal(h.state.layers[0].hoppers[1].resinName, "LIVE-A1");
  assert.equal(h.recipeEditHistory.next.undo.length, 3);
  const again = h.dispatch("clearHopper", Object.assign({}, NXT, { index: 1 }));
  assert.deepEqual([again.ok, again.changed], [true, false]);
  assert.equal(h.recipeEditHistory.next.undo.length, 3);
  const legacy = block("          clearButton.addEventListener(\"click\",()=>{", "          refreshCellState();\n          return td;");
  assert.match(legacy, /hopper\.resinName = "";/);
  assert.match(legacy, /if \(hi > 0\) hopper\.pct = 0;/);
  assert.match(legacy, /hopper\.track = false;/);
  assert.match(legacy, /kind: "recipe-clear"/);
  assert.ok(legacy.indexOf("saveSession();") < legacy.indexOf("recordRecipeEdit(historyBefore);"));
});

/* ----------------------------------------------------------------------
 *   Source
 * -------------------------------------------------------------------- */

test("setSource labels one position on the addressed recipe through applyGroup, normalized, synced as hookup-edit, no history", () => {
  const h = boot();
  const result = h.dispatch("setSource", Object.assign({}, CUR, { index: 1, source: " box 12 " }));
  assert.equal(result.ok, true);
  assert.deepEqual(h.state.hookupSources.current["A:1"], { resin: "LIVE-A1", source: "BOX 12" });
  assert.deepEqual(h.state.hookupSources.current["A:0"], { resin: "LIVE-A0", source: "SILO 1" }, "the other label is untouched");
  assert.deepEqual(result.snapshot.sources.current["A:1"], { resin: "LIVE-A1", source: "BOX 12" });
  assert.deepEqual(result.snapshot.sources.next, {});
  assert.deepEqual(h.log.validates, [{ sync: true, immediate: false, kind: "hookup-edit" }]);
  assert.equal(h.log.renders, 0, "the Hookups board does not rebuild the recipe grid");
  assert.equal(h.log.hookupRenders, 1);
  assert.equal(h.recipeEditHistory.current.undo.length, 0, "sources are job state, not recipe history");
});

test("setSource on Next labels the plan's position under sources.next, never the current map", () => {
  const h = boot();
  h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 2, resin: "PLAN-2" }));
  const result = h.dispatch("setSource", Object.assign({}, NXT, { index: 2, source: "silo 9" }));
  assert.equal(result.ok, true);
  assert.deepEqual(h.state.hookupSources.next["A:2"], { resin: "PLAN-2", source: "SILO 9" });
  assert.equal(h.state.hookupSources.current["A:2"], undefined);
  assert.deepEqual(result.snapshot.sources.next["A:2"], { resin: "PLAN-2", source: "SILO 9" });
});

test("setSource removes a label with an empty source, refuses a hopper with no resin, and is a no-op when equal", () => {
  const h = boot();
  const same = h.dispatch("setSource", Object.assign({}, CUR, { index: 0, source: "silo 1" }));
  assert.deepEqual([same.ok, same.changed], [true, false]);
  assert.equal(h.log.saves, 0);
  assert.equal(h.dispatch("setSource", Object.assign({}, CUR, { index: 3, source: "X" })).code, "no_resin");
  const removed = h.dispatch("setSource", Object.assign({}, CUR, { index: 0, source: "" }));
  assert.equal(removed.ok, true);
  assert.equal(h.state.hookupSources.current["A:0"], undefined);
  assert.deepEqual(removed.snapshot.sources.current, {});
  const gone = h.dispatch("setSource", Object.assign({}, CUR, { index: 0, source: "" }));
  assert.equal(gone.changed, false);
});

/* ----------------------------------------------------------------------
 *   History: one stack per recipe, shared with the grid
 * -------------------------------------------------------------------- */

test("a Station edit is undone by the grid's own undo, and a grid edit is undone through Station", () => {
  const h = boot();
  h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "FROM-STATION" }));
  h.undoRecipeEdit();                       // the toolbar, grid on Current
  assert.equal(h.hopper("current", "A", 2).resinName, "");
  // A grid edit: snapshot, mutate, record - as the handlers do.
  const before = h.snapshotRecipeEdit();
  h.state.layers[0].hoppers[3].resinName = "FROM-GRID";
  h.recordRecipeEdit(before);
  const result = h.dispatch("undo", { recipe: "current" });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(h.hopper("current", "A", 3).resinName, "");
  assert.equal(result.snapshot.history.current.canRedo, true);
  assert.equal(h.dispatch("redo", { recipe: "current" }).ok, true);
  assert.equal(h.hopper("current", "A", 3).resinName, "FROM-GRID");
});

test("Current and Next stacks stay separate whatever the hidden grid shows", () => {
  const h = boot();
  h.setPage("next");                        // the hidden grid is on Next
  h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "C-1" }));
  h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 2, resin: "N-1" }));
  assert.deepEqual(h.stationBridge.getSnapshot().history, {
    current: { canUndo: true, canRedo: false }, next: { canUndo: true, canRedo: false }
  });
  assert.equal(h.dispatch("undo", { recipe: "current" }).ok, true);
  assert.equal(h.hopper("current", "A", 2).resinName, "");
  assert.equal(h.working()[0].hoppers[2].resinName, "N-1", "Next was not undone by a Current undo");
  assert.equal(h.dispatch("undo", { recipe: "next" }).ok, true);
  assert.equal(h.working()[0].hoppers[2].resinName, "");
  assert.deepEqual(h.stationBridge.getSnapshot().history, {
    current: { canUndo: false, canRedo: true }, next: { canUndo: false, canRedo: true }
  });
  assert.equal(h.dispatch("redo", { recipe: "next" }).ok, true);
  assert.equal(h.working()[0].hoppers[2].resinName, "N-1");
  assert.equal(h.hopper("current", "A", 2).resinName, "");
});

test("an empty stack is nothing_to_undo, and an unsuccessful undo on Next does not materialize an empty plan", () => {
  const h = boot();
  assert.equal(h.state.nextRecipe, null);
  const result = h.dispatch("undo", { recipe: "next" });
  assert.equal(result.code, "nothing_to_undo");
  assert.equal(h.working(), null, "the working copy was created by a failed undo");
  assert.equal(h.log.saves, 0);
  assert.equal(h.dispatch("redo", { recipe: "next" }).code, "nothing_to_undo");
  assert.match(h.dispatch("redo", { recipe: "next" }).message, /redo/);
  // A later, unrelated save still has no plan to commit.
  h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "X" }));
  assert.equal(h.state.nextRecipe, null);
});

test("a Next no-op or failure does not leave a working copy behind either", () => {
  const h = boot();
  assert.equal(h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 3, resin: "" })).changed, false);
  assert.equal(h.working(), null);
  assert.equal(h.dispatch("setHopperBlend", Object.assign({}, NXT, { index: 0, pct: 5 })).code, "h1_derived");
  assert.equal(h.dispatch("setHopperResin", { recipe: "next", layer: "Z", index: 0, resin: "X" }).code, "unknown_layer");
  assert.equal(h.dispatch("clearHopper", Object.assign({}, NXT, { index: 4 })).changed, false);
  assert.equal(h.dispatch("setSource", Object.assign({}, NXT, { index: 4, source: "X" })).code, "no_resin");
  assert.equal(h.working(), null);
  h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "X" }));
  assert.equal(h.state.nextRecipe, null, "no empty plan was committed by the unrelated save");
  // A real Next edit does materialize it - that is what editing Next means.
  h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 3, resin: "REAL" }));
  assert.ok(h.working());
  assert.equal(h.state.nextRecipe.layers[0].hoppers[3].resin_name, "REAL");
});

test("a Next edit over a stored plan starts from that plan, not from Current", () => {
  const stored = nextRecipe.normalize({
    schema_version: 1, line_type: 3, hopper_naming_mode: "standard",
    layers: ["A", "B", "C"].map(name => ({ name, layer_pct: 33, hoppers: Array.from({ length: 6 }, (_, i) => ({ resin_name: i === 0 ? `STORED-${name}` : null, pct: i === 0 ? 100 : 0 })) }))
  });
  const h = boot({ nextRecipe: stored });
  const result = h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 1, resin: "ADDED" }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.nextRecipe.layers[0].hoppers.slice(0, 2).map(x => x.resinName), ["STORED-A", "ADDED"]);
  assert.equal(result.snapshot.layers[0].hoppers[0].resinName, "LIVE-A0");
});

/* ----------------------------------------------------------------------
 *   Results and the publish flow
 * -------------------------------------------------------------------- */

test("the success snapshot is the state bridge's own frozen snapshot at the published revision", () => {
  const h = boot();
  const seen = [];
  h.stationBridge.subscribe(snapshot => seen.push(snapshot));
  const result = h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "PUBLISHED" }));
  assert.ok(Object.isFrozen(result.snapshot));
  assert.ok(Object.isFrozen(result.snapshot.layers[0].hoppers[2]));
  assert.equal(result.revision, h.stationBridge.getRevision());
  assert.equal(result.snapshot.revision, result.revision);
  assert.equal(result.snapshot, h.stationBridge.getSnapshot(), "identical object: what Station is told next is what it was handed");
  assert.equal(seen[seen.length - 1], result.snapshot, "the subscriber received the very same snapshot");
  assert.equal(seen[seen.length - 1].layers[0].hoppers[2].resinName, "PUBLISHED");
  assert.notEqual(result.snapshot.layers, h.state.layers, "never live state");
});

test("persisted reports the save's own result", () => {
  const h = boot();
  h.flags.saveOk = false;
  const result = h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "UNSAVED" }));
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.persisted, false);
  assert.equal(h.hopper("current", "A", 2).resinName, "UNSAVED", "state moved whether or not the save landed, as in the grid");
  assert.ok(result.snapshot, "and the snapshot still describes the moved state");
  h.flags.saveOk = true;
  assert.equal(h.dispatch("undo", { recipe: "current" }).persisted, true);
});

test("every failure leaves state, history and the save log untouched", () => {
  const h = boot();
  const before = h.stateJson();
  const saves = h.log.saves;
  const attempts = [
    ["setHopperResin", { recipe: "current", layer: "Z", index: 0, resin: "X" }],
    ["setHopperBlend", Object.assign({}, CUR, { index: 0, pct: 1 })],
    ["setHopperBlend", Object.assign({}, CUR, { index: 2, pct: 99 })],
    ["setSource", Object.assign({}, CUR, { index: 5, source: "X" })],
    ["undo", { recipe: "current" }],
    ["redo", { recipe: "next" }],
    ["setLayerShare", { recipe: "next", layer: "Q", pct: 1 }],
    ["clearHopper", { recipe: "current", layer: "A", index: 9 }]
  ];
  for (const [command, args] of attempts) {
    const result = h.dispatch(command, args);
    assert.equal(result.ok, false, `${command} succeeded`);
    assert.ok(contract.ERROR_CODES.includes(result.code));
  }
  assert.equal(h.stateJson(), before);
  assert.equal(h.log.saves, saves);
  assert.equal(h.stationBridge.getSnapshot().history.current.canUndo, false);
});

/* ----------------------------------------------------------------------
 *   Protected states
 * -------------------------------------------------------------------- */

test("rearrangement mode and a remote apply in progress refuse every command without touching state", () => {
  const h = boot();
  const before = h.stateJson();
  h.setRearranging(true);
  for (const command of contract.COMMANDS) {
    const result = h.dispatch(command, { recipe: "current", layer: "A", index: 1, pct: 10, resin: "X", source: "Y" });
    assert.equal(result.code, "rearranging", `${command} ran during rearrangement`);
  }
  h.setRearranging(false);
  h.setApplyingRemote(true);
  assert.equal(h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "X" })).code, "busy");
  assert.equal(h.dispatch("undo", { recipe: "current" }).code, "busy");
  h.setApplyingRemote(false);
  assert.equal(h.stateJson(), before);
  assert.equal(h.log.saves, 0);
  assert.equal(h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "X" })).ok, true, "and the executor works again once the state clears");
});

test("a handler that throws becomes internal and nothing escapes", () => {
  const h = boot();
  // Break the hookup module underneath setSource only.
  const original = hookups.applyGroup;
  h.state.hookupSources = { current: {}, next: {} };
  Object.defineProperty(h.state, "hookupSources", { get() { throw new Error("boom"); }, set() {}, configurable: true });
  let result;
  assert.doesNotThrow(() => { result = h.dispatch("setSource", Object.assign({}, CUR, { index: 0, source: "X" })); });
  assert.equal(result.code, "internal");
  assert.equal(hookups.applyGroup, original);
});
