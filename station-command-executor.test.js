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
const rearrangement = require("./hopper-rearrangement.js");

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
    window: { PolynHookupSources: hookups, PolynNextRecipe: nextRecipe, PolynHopperRearrangement: rearrangement },
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
  assert.deepEqual(h.executor.capabilities, ["setHopperResin", "setHopperBlend", "setLayerShare", "clearHopper", "setSource", "moveHopper", "setHopperTracking", "setPumpOff", "undo", "redo"]);
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
  // Station files connect nothing; the focused editor is the one that
  // dispatches, and only on the bridge it is handed (station-isolation).
  for (const file of fs.readdirSync(path.join(ROOT, "station")).filter(name => name.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(ROOT, "station", file), "utf8");
    assert.doesNotMatch(source, /PolynStationCommandBridge\s*\.\s*connect|commands\.connect\s*\(/, `${file} connects a producer`);
    if (!["station-focus-editor.js", "station-hopper-controls.js"].includes(file)) assert.doesNotMatch(source, /\.dispatch\s*\(/, `${file} dispatches a command`);
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
 *   Move: rearrange mode's one move, per command
 * -------------------------------------------------------------------- */

const assignmentsOf = layers => layers.map(L => L.hoppers.map(h => `${h.resinName}:${h.pct}`));
const physicalOf = layers => layers.map(L => L.hoppers.map(h => `${h.weight}:${h.track}:${h.pumpOff}`));

test("moveHopper carries the assignment to an empty position through PolynHopperRearrangement.move, and only the assignment", () => {
  const h = boot();
  const physical = physicalOf(h.state.layers);
  const result = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 3 }));
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(h.hopper("current", "A", 3).resinName, "LIVE-A1");
  assert.equal(h.hopper("current", "A", 3).pct, 40);
  assert.equal(h.hopper("current", "A", 1).resinName, "", "an empty destination clears the source");
  assert.equal(h.hopper("current", "A", 1).pct, 0);
  assert.equal(h.hopper("current", "A", 0).pct, 60, "H1 re-derived over the moved share");
  // Weight, tracking and pump-off stayed with the physical hoppers.
  assert.deepEqual(physicalOf(h.state.layers), physical);
  // The application's own module did the move: the same call on a copy of
  // the fixture agrees with the state byte for byte, and the result's
  // snapshot shows it.
  const copy = layersFor(["A", "B", "C"], "LIVE");
  rearrangement.move(copy, { layer: "A", index: 1 }, { layer: "A", index: 3 });
  assert.deepEqual(assignmentsOf(h.state.layers), assignmentsOf(copy));
  assert.equal(result.snapshot.layers[0].hoppers[3].resinName, "LIVE-A1");
});

test("moveHopper swaps with an occupied position, H1 included, and across layers", () => {
  const h = boot();
  // A1 (LIVE-A1, 40) onto A0 (LIVE-A0, 60): the two swap and H1 is re-derived.
  let result = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 0 }));
  assert.equal(result.changed, true);
  assert.deepEqual([h.hopper("current", "A", 0).resinName, h.hopper("current", "A", 1).resinName], ["LIVE-A1", "LIVE-A0"]);
  assert.deepEqual([h.hopper("current", "A", 0).pct, h.hopper("current", "A", 1).pct], [40, 60]);
  // A1 (now LIVE-A0, 60) onto B2 (empty): across layers, both H1s re-derived.
  result = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "B", toIndex: 2 }));
  assert.equal(result.changed, true);
  assert.equal(h.hopper("current", "B", 2).resinName, "LIVE-A0");
  assert.equal(h.hopper("current", "B", 2).pct, 60);
  assert.equal(h.hopper("current", "A", 1).resinName, "");
  assert.equal(h.hopper("current", "A", 0).pct, 100, "A's H1 is the remainder once A1 is empty");
  assert.equal(h.hopper("current", "B", 0).pct, 0, "B's H1 is the remainder: B1 40 + B2 60");
});

test("moveHopper on Next moves the plan's hoppers and leaves Current alone", () => {
  const h = boot();
  // With no plan stored, Next's working copy is empty: nothing to move.
  const empty = h.dispatch("moveHopper", Object.assign({}, NXT, { index: 1, toLayer: "A", toIndex: 4 }));
  assert.equal(empty.code, "empty_hopper");
  assert.equal(h.working(), null, "the refusal did not leave a working copy behind");
  h.dispatch("setHopperResin", Object.assign({}, NXT, { index: 1, resin: "PLAN-1" }));
  h.dispatch("setHopperBlend", Object.assign({}, NXT, { index: 1, pct: 35 }));
  const current = JSON.stringify(h.state.layers);
  const result = h.dispatch("moveHopper", Object.assign({}, NXT, { index: 1, toLayer: "A", toIndex: 4 }));
  assert.equal(result.changed, true);
  assert.equal(h.hopper("next", "A", 4).resinName, "PLAN-1");
  assert.equal(h.hopper("next", "A", 4).pct, 35);
  assert.equal(h.hopper("next", "A", 1).resinName, "");
  assert.equal(h.state.nextRecipe.layers[0].hoppers[4].resin_name, "PLAN-1", "saveSession commits the working plan");
  assert.equal(result.snapshot.nextRecipe.layers[0].hoppers[4].resinName, "PLAN-1");
  assert.equal(JSON.stringify(h.state.layers), current);
  assert.equal(h.recipeEditHistory.next.undo.length, 3);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
});

test("moveHopper no-ops: the same position, and two positions holding the same assignment", () => {
  const h = boot();
  h.log.saves = 0; h.log.notified.length = 0;
  const before = h.stateJson();
  const same = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 1 }));
  assert.deepEqual([same.ok, same.changed, same.persisted], [true, false, false]);
  assert.equal(h.stateJson(), before);
  // Two hoppers with the same resin and share swap into the same recipe.
  h.state.layers[0].hoppers[2] = Object.assign({}, h.state.layers[0].hoppers[2], { resinName: "LIVE-A1", pct: 40 });
  h.state.layers[0].hoppers[0].pct = 20;
  const twin = h.stateJson();
  const swap = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 2 }));
  assert.deepEqual([swap.ok, swap.changed], [true, false]);
  assert.equal(h.stateJson(), twin);
  assert.equal(h.log.saves, 0);
  assert.equal(h.log.notified.length, 0);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
});

test("moveHopper refuses an empty source, an unknown destination, and a blend that would not total - touching nothing", () => {
  const h = boot();
  const before = h.stateJson();
  assert.equal(h.dispatch("moveHopper", Object.assign({}, CUR, { index: 4, toLayer: "A", toIndex: 1 })).code, "empty_hopper");
  assert.equal(h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "Q", toIndex: 1 })).code, "unknown_layer");
  const hopper = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "B", toIndex: 6 }));
  assert.equal(hopper.code, "unknown_hopper");
  assert.equal(hopper.field, "toIndex");
  assert.equal(h.dispatch("moveHopper", { recipe: "current", layer: "A", index: 1, toLayer: "B" }).code, "bad_argument");
  assert.equal(h.stateJson(), before);
  // B3 given 70 beside B1's 40: A1's 40 arriving at B2 would put B's
  // hoppers 2-6 at 150.
  h.state.layers[1].hoppers[3] = Object.assign({}, h.state.layers[1].hoppers[3], { resinName: "LIVE-B3", pct: 70 });
  const stacked = h.stateJson();
  const invalid = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "B", toIndex: 2 }));
  assert.equal(invalid.code, "blend_total");
  assert.match(invalid.message, /percentages would be invalid/);
  assert.equal(h.stateJson(), stacked);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
  assert.equal(h.log.saves, 0);
});

test("one move is one history entry - as Done records one for a rearrangement - and undo/redo restore the layouts", () => {
  const h = boot();
  const before = assignmentsOf(h.state.layers);
  const move = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 2 }));
  assert.equal(move.changed, true);
  const after = assignmentsOf(h.state.layers);
  assert.notDeepEqual(after, before);
  assert.equal(h.recipeEditHistory.current.undo.length, 1, "exactly one entry for one move");
  assert.equal(h.recipeEditHistory.current.redo.length, 0);
  assert.deepEqual(move.snapshot.history.current, { canUndo: true, canRedo: false });

  const undone = h.dispatch("undo", { recipe: "current" });
  assert.equal(undone.ok, true);
  assert.deepEqual(assignmentsOf(h.state.layers), before, "undo restores the prior layout");
  assert.deepEqual(undone.snapshot.history.current, { canUndo: false, canRedo: true });
  const redone = h.dispatch("redo", { recipe: "current" });
  assert.deepEqual(assignmentsOf(h.state.layers), after, "redo reapplies the move");
  assert.deepEqual(redone.snapshot.history.current, { canUndo: true, canRedo: false });
});

test("one move is synced at once as rearrange-hoppers with Done's save count; no-ops and refusals sync nothing", () => {
  const h = boot();
  h.log.notified.length = 0; h.log.saves = 0; h.log.renders = 0;
  h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 5 }));
  // finishRearrangement: renderSplitsArea, validateAndCompute (which
  // saves), saveSession, notifyActiveJobMutation({ immediate: true,
  // kind: "rearrange-hoppers" }) - reproduced, not reinvented.
  assert.deepEqual(h.log.notified, [{ immediate: true, kind: "rearrange-hoppers" }]);
  assert.equal(h.log.saves, 2);
  assert.equal(h.log.renders, 1);
  h.log.notified.length = 0; h.log.saves = 0;
  h.dispatch("moveHopper", Object.assign({}, CUR, { index: 5, toLayer: "A", toIndex: 5 }));
  h.dispatch("moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 5 }));
  assert.equal(h.log.notified.length, 0);
  assert.equal(h.log.saves, 0);
});

test("a move does not carry a source label: the tail prunes the label whose resin left, as a grid rearrangement does", () => {
  const stationSource = require("./station/station-source.js");
  const h = boot();
  assert.equal(stationSource.hopperStateFrom(h.stationBridge.getSnapshot())["A:0"].source, "SILO 1");
  const result = h.dispatch("moveHopper", Object.assign({}, CUR, { index: 0, toLayer: "A", toIndex: 2 }));
  const after = stationSource.hopperStateFrom(result.snapshot);
  assert.equal(after["A:2"].resinName, "LIVE-A0");
  assert.equal(after["A:2"].source, "", "the label stays with the position, and the position has a new resin");
  assert.equal(h.state.hookupSources.current["A:0"], undefined, "pruned from the store, not hidden");
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

/* The Station Focus editor's blend field rides on setHopperBlend; what it
 * promises the operator - one history entry per real edit, undo back to
 * the prior blend with H1 following, redo forward again - is the
 * executor's to keep. */
test("one blend edit from Station is one history entry: undo restores the prior blend and H1, redo reapplies it", () => {
  const h = boot();
  assert.deepEqual([h.hopper("current", "A", 1).pct, h.hopper("current", "A", 0).pct], [40, 60]);
  const edit = h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 25 }));
  assert.equal(edit.changed, true);
  assert.equal(h.recipeEditHistory.current.undo.length, 1, "exactly one entry for one edit");
  assert.equal(h.recipeEditHistory.current.redo.length, 0);
  // A repeat of the same value adds nothing to the stack.
  assert.equal(h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 1, pct: 25 })).changed, false);
  assert.equal(h.recipeEditHistory.current.undo.length, 1);

  const undone = h.dispatch("undo", { recipe: "current" });
  assert.equal(undone.ok, true);
  assert.deepEqual([h.hopper("current", "A", 1).pct, h.hopper("current", "A", 0).pct], [40, 60], "the prior blend, H1 included");
  assert.deepEqual(undone.snapshot.history.current, { canUndo: false, canRedo: true });
  const redone = h.dispatch("redo", { recipe: "current" });
  assert.deepEqual([h.hopper("current", "A", 1).pct, h.hopper("current", "A", 0).pct], [25, 75]);
  assert.deepEqual(redone.snapshot.history.current, { canUndo: true, canRedo: false });
});

test("one real command is one RT Sync notification, and its save count is the grid handler's own", () => {
  const h = boot();
  h.log.notified.length = 0; h.log.saves = 0;
  h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "ONE" }));
  assert.equal(h.log.notified.length, 1, "one sync notification for one resin edit");
  // validateAndCompute saves on its own and the tail saves once more - the
  // shape every grid field handler has (validateAndCompute({sync:true});
  // saveSession();), reproduced rather than reinvented. RT Sync sees one
  // mutation; the state bridge coalesces the publishes into one
  // notification per tick (station-state-bridge.test.js).
  assert.equal(h.log.saves, 2);
  h.log.notified.length = 0; h.log.saves = 0;
  h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 2, pct: 5 }));
  assert.equal(h.log.notified.length, 1);
  assert.equal(h.log.saves, 2);
  h.log.notified.length = 0; h.log.saves = 0;
  h.dispatch("setSource", Object.assign({}, CUR, { index: 2, source: "silo 4" }));
  assert.deepEqual(h.log.notified, [{ immediate: false, kind: "hookup-edit" }]);
  assert.equal(h.log.saves, 2);
  // And a no-op is none of it.
  h.log.notified.length = 0; h.log.saves = 0;
  h.dispatch("setSource", Object.assign({}, CUR, { index: 2, source: "SILO 4" }));
  h.dispatch("setHopperBlend", Object.assign({}, CUR, { index: 2, pct: 5 }));
  h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 2, resin: "ONE" }));
  assert.equal(h.log.notified.length, 0);
  assert.equal(h.log.saves, 0);
});

test("a resin change prunes the position's source, in the store and in the snapshot Station reads", () => {
  const stationSource = require("./station/station-source.js");
  const h = boot();
  const before = stationSource.hopperStateFrom(h.stationBridge.getSnapshot());
  assert.equal(before["A:0"].source, "SILO 1");
  const result = h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 0, resin: "OTHER" }));
  const after = stationSource.hopperStateFrom(result.snapshot);
  assert.equal(after["A:0"].resinName, "OTHER");
  assert.equal(after["A:0"].source, "", "the label was for LIVE-A0; it does not follow the new resin");
  // The tail's own reconciliation (validateAndCompute -> reconcileHookupSources)
  // dropped the stale label from the store, as it does for a grid edit; the
  // result's snapshot already shows that. Putting the resin back does not
  // bring the label back - it is gone, not hidden.
  assert.equal(h.state.hookupSources.current["A:0"], undefined);
  assert.equal(result.snapshot.sources.current["A:0"], undefined);
  const restored = h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 0, resin: "LIVE-A0" }));
  assert.equal(stationSource.hopperStateFrom(restored.snapshot)["A:0"].source, "");
  // A source set against the new resin is stored under it.
  h.dispatch("setHopperResin", Object.assign({}, CUR, { index: 0, resin: "OTHER" }));
  h.dispatch("setSource", Object.assign({}, CUR, { index: 0, source: "box 2" }));
  assert.deepEqual(h.state.hookupSources.current["A:0"], { resin: "OTHER", source: "BOX 2" });
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
    ["clearHopper", { recipe: "current", layer: "A", index: 9 }],
    ["moveHopper", Object.assign({}, CUR, { index: 3, toLayer: "A", toIndex: 0 })],
    ["moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "Z", toIndex: 0 })],
    ["moveHopper", Object.assign({}, CUR, { index: 1, toLayer: "A", toIndex: 9 })]
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
    const result = h.dispatch(command, { recipe: "current", layer: "A", index: 1, pct: 10, resin: "X", source: "Y", toLayer: "B", toIndex: 2, track: true, pumpOff: true });
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

/* ----------------------------------------------------------------------
 *   Step 10: tracking and pump-off - runtime state through the grid's and
 *   the Timeline's own paths
 * -------------------------------------------------------------------- */

test("setHopperTracking sets the Current hopper's flag as the grid's clock button does: synced at once as tracking, the grid rebuilt, saved, no history", () => {
  const h = boot();
  assert.equal(h.hopper("current", "A", 2).track, false);
  const revision = h.stationBridge.getRevision();
  const result = h.dispatch("setHopperTracking", Object.assign({}, CUR, { index: 2, track: true }));
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.persisted, true);
  assert.equal(h.hopper("current", "A", 2).track, true);
  assert.deepEqual(h.log.validates, [{ sync: true, immediate: true, kind: "tracking" }]);
  assert.deepEqual(h.log.notified, [{ immediate: true, kind: "tracking" }]);
  assert.equal(h.log.renders, 1, "the grid is rebuilt: its tracked-cell state and tracked count live there");
  assert.equal(h.log.hookupRenders, 0);
  assert.equal(h.log.saves, 2, "validateAndCompute's save and the tail's, as every other command");
  assert.ok(h.stationBridge.getRevision() > revision, "the bridge published");
  assert.equal(result.snapshot.layers[0].hoppers[2].track, true, "the answer carries the application's own snapshot");
  assert.equal(result.snapshot, h.stationBridge.getSnapshot());
  // Runtime state, not a recipe edit: nothing to undo.
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
  assert.equal(h.stationBridge.getSnapshot().history.current.canUndo, false);
  assert.equal(h.dispatch("undo", { recipe: "current" }).code, "nothing_to_undo");

  // Off again, by stating the state wanted - not by toggling.
  const off = h.dispatch("setHopperTracking", Object.assign({}, CUR, { index: 2, track: false }));
  assert.equal(off.changed, true);
  assert.equal(h.hopper("current", "A", 2).track, false);
});

test("setPumpOff sets the Current hopper's flag as the Timeline's I/O toggle does: synced at once as pump-off, saved, no grid rebuild, no history", () => {
  const h = boot();
  const result = h.dispatch("setPumpOff", Object.assign({}, CUR, { index: 0, pumpOff: true }));
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(h.hopper("current", "A", 0).pumpOff, true);
  assert.deepEqual(h.log.validates, [{ sync: true, immediate: true, kind: "pump-off" }]);
  assert.deepEqual(h.log.notified, [{ immediate: true, kind: "pump-off" }]);
  assert.equal(h.log.renders, 0, "the grid does not show pump state; the Timeline rows validateAndCompute redraws do");
  assert.equal(h.log.hookupRenders, 0, "a pump-off is not a source edit: the Hookups board is not redrawn");
  assert.equal(h.log.saves, 2);
  assert.equal(result.snapshot.layers[0].hoppers[0].pumpOff, true);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
  // Tracking is untouched by a pump change, and vice versa.
  assert.equal(h.hopper("current", "A", 0).track, true);
  h.dispatch("setHopperTracking", Object.assign({}, CUR, { index: 0, track: false }));
  assert.equal(h.hopper("current", "A", 0).pumpOff, true, "untracking leaves pump-off standing, as the grid's button does (only Reset tracking clears both)");
});

test("stating the flag a hopper already has is a no-op: no mutation, no save, no publish, no notification", () => {
  const h = boot();
  const before = h.stateJson();
  const revision = h.stationBridge.getRevision();
  for (const [command, args] of [
    ["setHopperTracking", Object.assign({}, CUR, { index: 0, track: true })],
    ["setHopperTracking", Object.assign({}, CUR, { index: 3, track: false })],
    ["setPumpOff", Object.assign({}, CUR, { index: 0, pumpOff: false })]
  ]) {
    const result = h.dispatch(command, args);
    assert.equal(result.ok, true, command);
    assert.equal(result.changed, false, command);
    assert.equal(result.persisted, false, command);
  }
  assert.equal(h.stateJson(), before);
  assert.equal(h.log.saves, 0);
  assert.deepEqual(h.log.validates, []);
  assert.deepEqual(h.log.notified, []);
  assert.equal(h.stationBridge.getRevision(), revision);
});

test("the runtime commands refuse the Next recipe at the contract and at the executor, and never materialize a plan", () => {
  const h = boot();
  const before = h.stateJson();
  for (const [command, flag] of [["setHopperTracking", "track"], ["setPumpOff", "pumpOff"]]) {
    const viaBridge = h.dispatch(command, Object.assign({}, NXT, { index: 1, [flag]: true }));
    assert.equal(viaBridge.code, "bad_argument");
    assert.equal(viaBridge.field, "recipe");
    // Straight at the executor, past the contract: the same refusal.
    const direct = h.executor.execute(command, { recipe: "next", layer: "A", index: 1, [flag]: true });
    assert.equal(direct.code, "bad_argument");
    assert.equal(direct.field, "recipe");
  }
  assert.equal(h.working(), null, "no Next working copy was created");
  assert.equal(h.stateJson(), before);
  assert.equal(h.log.saves, 0);
});

test("the runtime commands refuse an unknown layer or hopper with nothing touched", () => {
  const h = boot();
  const before = h.stateJson();
  assert.equal(h.dispatch("setHopperTracking", { recipe: "current", layer: "Z", index: 0, track: true }).code, "unknown_layer");
  assert.equal(h.dispatch("setPumpOff", { recipe: "current", layer: "A", index: 7, pumpOff: true }).code, "unknown_hopper");
  assert.equal(h.dispatch("setPumpOff", { recipe: "current", layer: "A", index: 1, pumpOff: "yes" }).code, "bad_argument");
  assert.equal(h.stateJson(), before);
  assert.equal(h.log.saves, 0);
  assert.deepEqual(h.log.notified, []);
});

test("the executor's runtime cases mirror the floor UI's own toggles: the same kinds, immediate, and no history recorded", () => {
  const executor = block("  function createStationCommandExecutor(){", "\n  }\n");
  const tracking = executor.slice(executor.indexOf("setHopperTracking(args){"), executor.indexOf("setPumpOff(args){"));
  const pump = executor.slice(executor.indexOf("setPumpOff(args){"), executor.indexOf("undo(args){"));
  assert.match(tracking, /at\.hopper\.track = args\.track;/);
  assert.match(tracking, /commit\(\{ sync: true, immediate: true, kind: "tracking" \}\)/);
  assert.match(pump, /at\.hopper\.pumpOff = args\.pumpOff;/);
  assert.match(pump, /commit\(\{ sync: true, immediate: true, kind: "pump-off", grid: false, hookups: false \}\)/);
  for (const source of [tracking, pump]) {
    assert.doesNotMatch(source, /snapshotRecipeEdit|recordRecipeEdit/, "runtime state was forced into recipe history");
    assert.match(source, /args\.recipe !== "current"/);
  }
  // The legacy paths these adapt: the grid's toggleTracking and the
  // Timeline's pump toggle, with the same kinds and no history.
  const legacyTracking = block("          function toggleTracking(){", "\n          }\n");
  assert.match(legacyTracking, /hopper\.track = !hopper\.track;/);
  assert.match(legacyTracking, /validateAndCompute\(\{ sync: true, immediate: true, kind: "tracking" \}\);/);
  assert.doesNotMatch(legacyTracking, /snapshotRecipeEdit|beginRecipeEditInput|recordRecipeEdit/);
  const legacyPump = block('        row.querySelector("[data-pump-toggle]").addEventListener("click",()=>{', "\n        });\n");
  assert.match(legacyPump, /h\._ref\.h\.pumpOff = !h\._ref\.h\.pumpOff;/);
  assert.match(legacyPump, /validateAndCompute\(\{ sync: true, immediate: true, kind: "pump-off" \}\);/);
  assert.doesNotMatch(legacyPump, /snapshotRecipeEdit|recordRecipeEdit/);
});
