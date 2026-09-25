"use strict";

/* slate-recipe.js: the Recipe section - two tabs over two recipes, rows
 * patched in place, tracking, in-place editing, drag, compare,
 * the layer menu, the plan's moves and print - with every command it
 * causes pinned by name and args. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key, pointer, makeTimers, makeCommands } = require("./tools/slate-test/fake-dom.js");
const recipe = require("./slate/slate-recipe.js");
const source = require("./slate/slate-source.js");
const contract = require("./station-command-contract.js");
const demo = require("./slate/slate-demo.js");

const ALL = [...contract.COMMANDS];
const CATALOG = [{ resin_code: "HX204", density_g_cm3: 0.951 }, { resin_code: "LL318" }, { resin_code: "LD105" }];

function snapshotWith(mutate) {
  const snap = demo.snapshot(5000);
  snap.revision = 3;
  snap.line.linked = true;
  if (mutate) mutate(snap);
  return snap;
}

function resolvedFrom(mutate) {
  return source.resolveSource({ snapshot: snapshotWith(mutate) });
}

function withPlan(mutate) {
  return resolvedFrom(snap => {
    snap.nextRecipe = { layers: snap.layers.map(layer => ({ name: layer.name, layerPct: layer.layerPct, hoppers: layer.hoppers.map(h => ({ index: h.index, pct: h.pct, resinName: h.resinName })) })) };
    snap.history = { current: { canUndo: true, canRedo: false }, next: { canUndo: false, canRedo: true } };
    if (mutate) mutate(snap);
  });
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const timers = makeTimers();
  const commands = settings.commands === null ? null : (settings.commands || makeCommands({ capabilities: ALL }));
  const committed = [];
  const said = [];
  const printed = [];
  const printer = { print(which, resolved) { printed.push({ which, planned: !!(resolved && resolved.plan && resolved.plan.planned) }); return { ok: true, which, pages: [which] }; } };
  let readOnly = !!settings.readOnly;
  let trackingMode = settings.trackingMode || "assisted";
  const view = recipe.create(doc, {
    commands: () => commands,
    onCommitted: result => committed.push(result),
    say: message => said.push(message),
    readOnly: () => readOnly,
    trackingMode: () => trackingMode,
    resins: () => CATALOG,
    timers,
    print: printer,
    recipes: settings.recipes === undefined ? null : settings.recipes,
    desktop: settings.desktop === undefined ? undefined : (typeof settings.desktop === "function" ? settings.desktop : () => !!settings.desktop),
    tier: settings.tier || (settings.phone ? () => ({ input: "touch", width: "phone" }) : (settings.touch ? () => ({ input: "touch", width: "wide" }) : undefined)),
    scan: settings.scan
  });
  doc.body.appendChild(view.element);
  return { doc, timers, commands, committed, said, printed, view, setReadOnly: value => { readOnly = value; }, setTrackingMode: value => { trackingMode = value; } };
}

/* A fake recipes bridge for "Save as recipe": records requests, answers as told. */
function makeRecipes(options) {
  const settings = options || {};
  const requests = [];
  const listeners = new Set();
  let assigned = settings.assigned !== false;
  return {
    requests,
    isConnected: () => true,
    capabilities: () => ["saveCurrentRecipe", "saveNextRecipe", "replaceRecipe", "loadRecipe", "renameRecipe", "duplicateRecipe", "deleteRecipe", "refresh"],
    getBook: () => ({ assigned, workspace: assigned ? { id: "ws-1", displayName: "Line 5" } : null, cachedAt: 1, refreshing: false, recipes: assigned ? [{ id: "r1", name: "Blue film", favorite: false, layers: [] }] : [], count: assigned ? 1 : 0 }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    assign(on) { assigned = on; for (const listener of listeners) listener(); },
    async request(action, args) {
      requests.push({ action, args });
      const answer = settings.answers && settings.answers[action];
      return (typeof answer === "function" ? answer(args) : answer) || { ok: true };
    }
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
/* A body's own foot (the Book, Save, Reset or the plan's moves), not the bulk edit's. */
const plainFoot = (view, which) => view.element.querySelectorAll(`.slate-recipe__body[data-recipe='${which || "current"}'] .slate-recipe__foot`).find(node => !node.classList.contains("slate-recipe__bulk-foot"));
const saveButton = (view, which) => view.element.querySelector(`.slate-recipe__save[data-slate-save='${which}']`);
const saveEntry = (view, which) => view.element.querySelector(`.slate-recipe__body[data-recipe='${which}'] .slate-recipe__save-entry`);

const row = (view, id, which) => view.element.querySelector(`.slate-recipe__body[data-recipe='${which || "current"}'] .slate-hopper[data-hopper='${id}']`);
const head = (view, layer, which) => view.element.querySelector(`.slate-recipe__body[data-recipe='${which || "current"}'] .slate-layer[data-layer='${layer}'] .slate-layer__head`);

/* ----------------------------------------------------------------------
 *   Rendering
 * -------------------------------------------------------------------- */

test("a structural update lists every layer in recipe order with its role, share and hoppers; the Current rows carry weight and toggles", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const layers = view.element.querySelectorAll(".slate-recipe__body[data-recipe='current'] .slate-layer");
  assert.deepEqual(layers.map(layer => layer.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.deepEqual(layers.map(layer => layer.getAttribute("data-tone")), ["inside", "core", "outside"]);
  assert.equal(layers[0].querySelector(".slate-layer__name").textContent, "Layer A");
  assert.equal(layers[0].querySelector(".slate-layer__role").textContent, "Inside");
  assert.equal(layers[1].querySelector(".slate-layer__share").textContent, "50%");
  assert.equal(view.rowCount("current"), 16);
  assert.equal(view.element.querySelector(".slate-section__subtitle").textContent, "Line 5 (demo) · 3 layers · 16 hoppers · Live");

  const a1 = row(view, "A1");
  assert.equal(a1.querySelector(".slate-hopper__resin").textContent, "HX204");
  assert.equal(a1.querySelector(".slate-hopper__resin").tagName, "BUTTON");
  assert.equal(a1.querySelector(".slate-hopper__pct").textContent, "60%");
  assert.ok(a1.querySelector(".slate-hopper__pct").hasAttribute("data-derived"), "H1's blend is not marked derived");
  assert.equal(a1.querySelector(".slate-hopper__weight").textContent, "400 lb");
  assert.equal(a1.querySelector("[data-slate-control='tracking']").getAttribute("aria-pressed"), "true");
  assert.ok(a1.classList.contains("is-tracked"));
  // Pump-off is the timeline's: the row shows the state, carries no toggle.
  assert.equal(a1.querySelector("[data-slate-control='pump']"), null, "the recipe row still carries a pump toggle");
  assert.equal(view.element.querySelectorAll("[data-slate-control]").length, view.element.querySelectorAll("[data-slate-control='tracking']").length);
  assert.ok(a1.querySelector(".slate-hopper__id").hasAttribute("data-slate-handle"), "the badge is not the drag handle");
  assert.equal(a1.style.getPropertyValue("--slate-row-i"), "0");

  const empty = row(view, "A4");
  assert.ok(empty.classList.contains("is-empty"));
  assert.equal(empty.querySelector(".slate-hopper__resin").textContent, recipe.EMPTY);
  assert.ok(empty.querySelector("[data-slate-control='tracking']").hasAttribute("disabled"));
  assert.ok(row(view, "B2").classList.contains("is-pump-off"));
});

test("a values update rewrites only the cells that moved, keeps every row's element, and flashes unless the change was our own", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1");
  const resinCell = a1.querySelector(".slate-hopper__resin");
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].resinName = "LL318"; snap.layers[0].hoppers[0].track = false; }), { kind: "values", own: false });
  assert.ok(row(view, "A1") === a1, "the row was re-created on a values change");
  assert.ok(a1.querySelector(".slate-hopper__resin") === resinCell);
  assert.equal(resinCell.textContent, "LL318");
  assert.ok(!a1.classList.contains("is-tracked"));
  assert.ok(a1.classList.contains("is-updated"));
  assert.ok(!row(view, "A2").classList.contains("is-updated"));
  a1.dispatchEvent({ type: "animationend" });
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].pct = 55; }), { kind: "values", own: true });
  assert.equal(a1.querySelector(".slate-hopper__pct").textContent, "55%");
  assert.ok(!a1.classList.contains("is-updated"), "our own change flashed");
  view.update(resolvedFrom(snap => { snap.layers[1].layerPct = 45; }), { kind: "values" });
  assert.equal(head(view, "B").querySelector(".slate-layer__share").textContent, "45%");
});

test("a weight Smart Hoppers computed shows tinted with its source and the entered weight in the title; an entered weight carries neither", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1");
  const cell = a1.querySelector(".slate-hopper__weight");
  assert.ok(!cell.classList.contains("is-smart"));
  assert.equal(cell.getAttribute("title"), null);
  view.update(resolvedFrom(snap => {
    snap.smartHoppers = { enabled: true, geometryMode: "cylindrical", circumference: 30 };
    const hopper = snap.layers[0].hoppers[0];
    hopper.usableHeight = 48;
    hopper.smartWeight = { value: 412.4, bulkDensity: 44.9, resinCode: "HX204" };
    hopper.effectiveWeight = 412.4;
  }), { kind: "values", own: true });
  assert.ok(a1.querySelector(".slate-hopper__weight") === cell, "the row was rebuilt");
  assert.equal(cell.textContent, "412.4 lb");
  assert.ok(cell.classList.contains("is-smart"));
  assert.equal(cell.getAttribute("title"), "Computed by Smart Hoppers from the hopper's geometry and HX204's bulk density (44.9 lb/ft³). Entered weight: 400 lb.");
  assert.ok(!row(view, "A2").querySelector(".slate-hopper__weight").classList.contains("is-smart"), "a hopper nothing was computed for is tinted");
  // The switch off again: the entered weight, untinted.
  view.update(resolvedFrom(), { kind: "values", own: true });
  assert.equal(cell.textContent, "400 lb");
  assert.ok(!cell.classList.contains("is-smart"));
  assert.equal(cell.getAttribute("title"), null);
});

test("formatting reads as the floor does", () => {
  assert.equal(recipe.formatPct(60), "60%");
  assert.equal(recipe.formatPct(33.333), "33.3%");
  assert.equal(recipe.formatPct(0), recipe.EMPTY);
  assert.equal(recipe.formatWeight(1234.56), "1,234.6 lb");
  assert.deepEqual(recipe.cellsFor({ resinName: " ", pct: 50, effectiveWeight: 10, track: true }).resin, recipe.EMPTY);
  assert.equal(recipe.cellsFor({ resinName: "X", pct: 12.5 }).pctValue, 12.5);
});

/* ----------------------------------------------------------------------
 *   Tabs
 * -------------------------------------------------------------------- */

test("the bar offers Current | Next; Next's rows carry no weight or toggles, no reset, and an empty state without a plan", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const tabs = view.element.querySelectorAll("[role='tab']");
  assert.deepEqual(tabs.map(tab => [tab.textContent, tab.getAttribute("data-recipe") || tab.getAttribute("data-slate-view"), tab.getAttribute("aria-selected")]), [["Current", "current", "true"], ["Next", "next", "false"], ["Weights", "weights", "false"]]);
  assert.equal(view.getRecipe(), "current");
  assert.ok(view.body("next").hasAttribute("hidden"));

  click(tabs[1]);
  assert.equal(view.getRecipe(), "next");
  assert.equal(view.element.getAttribute("data-recipe"), "next");
  assert.ok(view.body("current").hasAttribute("hidden"));
  assert.ok(!view.body("next").hasAttribute("hidden"));
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  const empty = view.body("next").querySelector(".slate-recipe__empty");
  assert.ok(!empty.hasAttribute("hidden"), "no plan, no empty state");
  assert.equal(empty.querySelector("[data-slate-plan='copy']").getAttribute("data-able"), "true");
  assert.equal(view.rowCount("next"), 0);
  assert.equal(view.body("next").querySelector(".slate-recipe__reset"), null);

  view.update(withPlan(), { kind: "structural" });
  assert.ok(empty.hasAttribute("hidden"));
  assert.equal(view.rowCount("next"), 16);
  const b1 = row(view, "B1", "next");
  assert.equal(b1.querySelector(".slate-hopper__resin").textContent, "LL318");
  // No weight: only the empty line that keeps the cell as tall as Current's.
  const weightLine = b1.querySelector(".slate-hopper__weight");
  assert.ok(weightLine && weightLine.hasAttribute("data-spacer") && weightLine.textContent === "", "a Next row carries a weight");
  assert.equal(b1.querySelector("[data-slate-control]"), null);
  // No heading row over either tab's layers: the values say what they are.
  assert.equal(view.element.querySelectorAll(".slate-recipe__columns, .slate-recipe__column").length, 0);
  assert.equal(view.setRecipe("nonsense"), "next");
  assert.equal(view.setRecipe("current"), "current");
});

test("a plan appearing is structural (both bodies rebuild); a Next-only edit patches the Next row in place", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(source.classifyChange(resolvedFrom(), withPlan()), "structural");
  view.update(withPlan(), { kind: "structural" });
  const a1 = row(view, "A1", "next");
  view.update(withPlan(snap => { snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ1"; }), { kind: "values", own: false });
  assert.ok(row(view, "A1", "next") === a1);
  assert.equal(a1.querySelector(".slate-hopper__resin").textContent, "ZZ1");
  assert.ok(a1.classList.contains("is-updated"));
  assert.equal(row(view, "A1").querySelector(".slate-hopper__resin").textContent, "HX204", "a Next edit touched Current");
});

/* ----------------------------------------------------------------------
 *   Compare
 * -------------------------------------------------------------------- */

// A plan against the demo: A1 swapped, A3 at another blend, A4 newly
// filled, B3 emptied, layer B at another share; everything else agrees.
function planWithChanges(extra) {
  return withPlan(snap => {
    snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ1";
    snap.nextRecipe.layers[0].hoppers[2].pct = 15;
    snap.nextRecipe.layers[0].hoppers[3] = { index: 3, pct: 5, resinName: "NEW1" };
    snap.nextRecipe.layers[1].hoppers[2] = { index: 2, pct: 0, resinName: "" };
    snap.nextRecipe.layers[1].layerPct = 40;
    if (extra) extra(snap);
  });
}

test("with a plan, a row whose resin changes carries the band on either tab, Compare or not; a blend-only or agreeing row never does", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  assert.ok(!row(view, "A1").classList.contains("is-differs"), "no plan, yet a band");

  view.update(planWithChanges(), { kind: "structural" });
  assert.equal(view.getCompare(), false);
  for (const id of ["A1", "A4", "B3"]) assert.ok(row(view, id).classList.contains("is-differs"), `${id}: a resin change without its band`);
  for (const id of ["A2", "A3", "B1"]) assert.ok(!row(view, id).classList.contains("is-differs"), `${id}: banded without a resin change`);
  assert.ok(row(view, "A1", "next").classList.contains("is-differs"), "the Next body is not banded");
  assert.ok(!row(view, "A3", "next").classList.contains("is-differs"));
  assert.ok(row(view, "A1").querySelector(".slate-hopper__other").hasAttribute("hidden"), "a compare line without Compare");
  assert.ok(head(view, "B").querySelector(".slate-layer__share-other").hasAttribute("hidden"));

  // A values publish that reverts the swap takes the band away.
  view.update(planWithChanges(snap => { snap.nextRecipe.layers[0].hoppers[0].resinName = "HX204"; }), { kind: "values" });
  assert.ok(!row(view, "A1").classList.contains("is-differs"));
  assert.ok(row(view, "A4").classList.contains("is-differs"));

  // The plan going away clears every band.
  view.update(resolvedFrom(), { kind: "structural" });
  for (const id of ["A1", "A4", "B3"]) assert.ok(!row(view, id).classList.contains("is-differs"), `${id}: banded without a plan`);
});

test("Compare is unable without a plan; with one it writes what moves under each row - the resin where it changes, 'empty' where the other side has none, the blend alone where only that moves - on either tab", () => {
  const { view, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const compare = view.element.querySelector("[data-slate-compare]");
  assert.equal(compare.getAttribute("data-able"), "false");
  click(compare);
  assert.equal(view.getCompare(), false);
  assert.match(said[0], /Nothing is planned/);

  view.update(planWithChanges(), { kind: "structural" });
  assert.equal(compare.getAttribute("data-able"), "true");
  click(compare);
  assert.equal(view.getCompare(), true);
  assert.equal(compare.getAttribute("aria-checked"), "true");
  assert.ok(view.element.classList.contains("is-comparing"));
  const line = id => row(view, id).querySelector(".slate-hopper__other");
  assert.equal(line("A1").textContent, "Next: ZZ1 · 60%");
  assert.ok(!line("A1").hasAttribute("hidden"));
  assert.ok(line("A2").hasAttribute("hidden"), "an agreeing row got a line");
  assert.ok(!row(view, "A2").classList.contains("is-differs"));
  assert.equal(line("A3").textContent, "Next: 15%", "a blend-only change repeats the resin");
  assert.ok(!row(view, "A3").classList.contains("is-differs"), "a blend-only change is banded");
  assert.equal(line("A4").textContent, "Next: NEW1 · 5%");
  assert.equal(line("B3").textContent, "Next: empty");
  assert.ok(line("A5").hasAttribute("hidden"), "an empty pair got a line");
  assert.ok(!row(view, "A5").classList.contains("is-differs"), "an empty pair was banded");
  const headB = head(view, "B");
  assert.equal(headB.querySelector(".slate-layer__share-other").textContent, "> 40%");
  assert.equal(headB.querySelector(".slate-layer__share-other").getAttribute("aria-label"), "Next 40%", "the short mark lost its words");
  assert.ok(head(view, "A").querySelector(".slate-layer__share-other").hasAttribute("hidden"), "an agreeing share got a line");

  view.update(planWithChanges(snap => { snap.job.lineRate = 900; }), { kind: "values" });
  assert.equal(view.getCompare(), true);
  assert.equal(line("A1").textContent, "Next: ZZ1 · 60%");

  view.setRecipe("next");
  const nextB = head(view, "B", "next").querySelector(".slate-layer__share-other");
  assert.match(nextB.textContent, /^< \d+(\.\d)?%$/, "Next's head does not mark the running share with <");
  assert.match(nextB.getAttribute("aria-label"), /^Current \d/);
  const nextA1 = row(view, "A1", "next");
  assert.ok(nextA1.classList.contains("is-differs"));
  assert.equal(nextA1.querySelector(".slate-hopper__other").textContent, "Current: HX204 · 60%");
  assert.equal(row(view, "B3", "next").querySelector(".slate-hopper__other").textContent, "Current: SL710 · 10%");
  assert.equal(row(view, "A4", "next").querySelector(".slate-hopper__other").textContent, "Current: empty");

  click(compare);
  assert.equal(view.getCompare(), false);
  assert.ok(nextA1.classList.contains("is-differs"), "Compare off took the band with it");
  assert.ok(nextA1.querySelector(".slate-hopper__other").hasAttribute("hidden"));

  // The plan going away forces Compare off.
  view.setCompare(true);
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(view.getCompare(), false);
});

test("with a plan, Track is offered only where the resin goes away - swapped or emptied - and wherever it is already on; without one, on every assigned row", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const toggle = id => row(view, id).querySelector("[data-slate-control='tracking']");
  for (const id of ["A1", "A2", "A3", "B3"]) assert.ok(!toggle(id).hasAttribute("hidden"), `${id}: Track withheld without a plan`);

  view.update(planWithChanges(), { kind: "structural" });
  assert.ok(!toggle("A1").hasAttribute("hidden"), "a swapped resin lost Track");
  assert.ok(!toggle("B3").hasAttribute("hidden"), "an emptied hopper lost Track");
  assert.ok(!toggle("A2").hasAttribute("hidden"), "a tracked hopper that continues lost Track");
  assert.ok(!toggle("B2").hasAttribute("hidden"), "a pumped-off hopper that continues lost Track");
  assert.ok(toggle("A3").hasAttribute("hidden"), "a continuing resin at another blend kept Track");
  assert.ok(!toggle("B1").hasAttribute("hidden"), "a tracked hopper that continues lost Track");
  assert.ok(toggle("C1").hasAttribute("hidden"), "an untracked hopper that continues kept Track");
  assert.ok(toggle("A4").hasAttribute("hidden"), "an empty hopper that fills next kept Track");

  // Tracking turned off on a continuing hopper: the toggle goes with it.
  view.update(planWithChanges(snap => { snap.layers[0].hoppers[1].track = false; }), { kind: "values" });
  assert.ok(toggle("A2").hasAttribute("hidden"));
  // ...and comes back when the plan swaps its resin.
  view.update(planWithChanges(snap => { snap.layers[0].hoppers[1].track = false; snap.nextRecipe.layers[0].hoppers[1].resinName = "ZZ2"; }), { kind: "values" });
  assert.ok(!toggle("A2").hasAttribute("hidden"));

  view.update(resolvedFrom(), { kind: "structural" });
  for (const id of ["A3", "A4"]) assert.ok(!toggle(id).hasAttribute("hidden"), `${id}: Track still withheld without a plan`);
});

/* ----------------------------------------------------------------------
 *   The tracking mode: Manual offers Track everywhere, Automatic never
 *   and tracks for the operator
 * -------------------------------------------------------------------- */

const toggleOf = (view, id) => row(view, id).querySelector("[data-slate-control='tracking']");
const trackingCalls = commands => commands.calls.filter(call => call.command === "setHopperTracking").map(call => `${call.args.layer}:${call.args.index}:${call.args.track}:${call.args.recipe}`);
/* The plan with changes, with A1 untracked too, so two hoppers - A1
 * swapped and B3 emptied - want tracking and the tracked ones (A2, B1),
 * the continuing ones (A3, C1) and the one that fills (A4) do not. */
const planForAutomatic = extra => planWithChanges(snap => { snap.layers[0].hoppers[0].track = false; if (extra) extra(snap); });

test("Manual offers Track on every Current row whatever the plan says - still disabled where nothing is assigned - and never on Next", () => {
  const { view, commands, timers } = boot({ trackingMode: "manual" });
  view.update(planWithChanges(), { kind: "structural" });
  for (const id of ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "C1"]) assert.ok(!toggleOf(view, id).hasAttribute("hidden"), `${id}: Track withheld under Manual`);
  assert.ok(toggleOf(view, "A4").hasAttribute("disabled"), "an empty hopper offers a live Track");
  assert.ok(!toggleOf(view, "A1").hasAttribute("disabled"));
  assert.equal(row(view, "A1", "next").querySelector("[data-slate-control='tracking']"), null);
  view.update(resolvedFrom(), { kind: "structural" });
  for (const id of ["A3", "A4"]) assert.ok(!toggleOf(view, id).hasAttribute("hidden"));
  assert.equal(timers.pending(), 0, "Manual scheduled a batch");
  assert.equal(commands.calls.length, 0);
});

test("Automatic offers no Track at all, keeps Reset, and tracks the hoppers whose resin goes away one tick after the publish - once, never the tracked, the continuing or the filling", () => {
  const { view, commands, timers, committed, said } = boot({ trackingMode: "automatic" });
  view.update(planForAutomatic(), { kind: "structural" });
  for (const id of ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "C1"]) assert.ok(toggleOf(view, id).hasAttribute("hidden"), `${id}: Track offered under Automatic`);
  assert.equal(view.body("current").querySelector(".slate-recipe__reset").getAttribute("data-able"), "true", "Reset withheld under Automatic");
  assert.equal(commands.calls.length, 0, "a command ran inside the publish");
  assert.equal(timers.pending(), 1);
  // A second publish before the tick coalesces into the same batch.
  view.update(planForAutomatic(), { kind: "values" });
  assert.equal(timers.pending(), 1);

  timers.advance(0);
  assert.deepEqual(trackingCalls(commands), ["A:0:true:current", "B:2:true:current"]);
  assert.equal(committed.length, 1, "the boot was told per hopper, not once");
  assert.equal(said.length, 0);

  // The application's echo: both tracked now, and nothing more is asked.
  view.update(planForAutomatic(snap => { snap.layers[0].hoppers[0].track = true; snap.layers[1].hoppers[2].track = true; }), { kind: "values", own: true });
  assert.equal(timers.pending(), 1);
  timers.advance(0);
  assert.equal(commands.calls.length, 2, "a tracked hopper was tracked again");
  // A plan that swaps one more resin tracks that one alone.
  view.update(planForAutomatic(snap => { snap.layers[0].hoppers[0].track = true; snap.layers[1].hoppers[2].track = true; snap.nextRecipe.layers[2].hoppers[0].resinName = "ZZ9"; }), { kind: "values" });
  timers.advance(0);
  assert.deepEqual(trackingCalls(commands).slice(2), ["C:0:true:current"]);
});

test("Automatic tracks nothing without a plan, without a bridge, or while Slate is read-only - and tracks at once when read-only lifts", () => {
  const bare = boot({ trackingMode: "automatic" });
  bare.view.update(resolvedFrom(), { kind: "structural" });
  bare.timers.advance(0);
  assert.equal(bare.commands.calls.length, 0, "tracked without a plan");

  const unplugged = boot({ trackingMode: "automatic", commands: null });
  unplugged.view.update(planForAutomatic(), { kind: "structural" });
  unplugged.timers.advance(0);
  assert.equal(unplugged.said.length, 0, "a refusal was said with no bridge");
  assert.equal(unplugged.committed.length, 0);

  const guarded = boot({ trackingMode: "automatic", readOnly: true });
  guarded.view.update(planForAutomatic(), { kind: "structural" });
  guarded.timers.advance(0);
  assert.equal(guarded.commands.calls.length, 0, "tracked under read-only");
  guarded.setReadOnly(false);
  guarded.view.refresh();
  assert.equal(guarded.commands.calls.length, 0, "a command ran inside refresh");
  guarded.timers.advance(0);
  assert.deepEqual(trackingCalls(guarded.commands), ["A:0:true:current", "B:2:true:current"]);
});

test("a refusal under Automatic is said once, told to nobody, and not asked again for the same pair until the plan or a preference moves", () => {
  const commands = makeCommands({ capabilities: ALL, answer: (command, args) => (args.layer === "B" ? { ok: false, code: "unknown_hopper", message: "No such hopper." } : undefined) });
  const { view, timers, committed, said } = boot({ trackingMode: "automatic", commands });
  view.update(planForAutomatic(), { kind: "structural" });
  timers.advance(0);
  assert.deepEqual(trackingCalls(commands), ["A:0:true:current", "B:2:true:current"]);
  assert.equal(committed.length, 1, "the accepted hopper was not committed");
  assert.deepEqual(said, ["Automatic tracking: No such hopper."]);

  // The echo of the accepted one: B3 is still wanted, still refused, not asked.
  view.update(planForAutomatic(snap => { snap.layers[0].hoppers[0].track = true; }), { kind: "values", own: true });
  timers.advance(0);
  assert.equal(commands.calls.length, 2, "the refused pair was asked again on a values publish");
  assert.equal(said.length, 1);
  // A preference moved: asked once more, refused once more.
  view.refresh();
  timers.advance(0);
  assert.equal(commands.calls.length, 3);
  assert.equal(said.length, 2);
  // The plan puts another resin there: a new pair, asked.
  view.update(planForAutomatic(snap => { snap.layers[0].hoppers[0].track = true; snap.nextRecipe.layers[1].hoppers[2] = { index: 2, pct: 5, resinName: "ZZ7" }; }), { kind: "values" });
  timers.advance(0);
  assert.equal(commands.calls.length, 4);
  // A structural publish forgets the refusal too.
  view.update(planForAutomatic(snap => { snap.layers[0].hoppers[0].track = true; }), { kind: "structural" });
  timers.advance(0);
  assert.equal(commands.calls.length, 5);
});

test("the mode moving under a plan: Assisted to Automatic hides Track and tracks on refresh; to Manual shows every Track and asks nothing", () => {
  const { view, commands, timers, setTrackingMode } = boot();
  view.update(planForAutomatic(), { kind: "structural" });
  assert.ok(!toggleOf(view, "A1").hasAttribute("hidden"));
  assert.ok(toggleOf(view, "A3").hasAttribute("hidden"));
  assert.equal(timers.pending(), 0, "Assisted scheduled a batch");

  setTrackingMode("automatic");
  view.refresh();
  assert.ok(toggleOf(view, "A1").hasAttribute("hidden"));
  assert.equal(timers.pending(), 1);
  timers.advance(0);
  assert.deepEqual(trackingCalls(commands), ["A:0:true:current", "B:2:true:current"]);

  setTrackingMode("manual");
  view.refresh();
  for (const id of ["A1", "A3", "A4", "C1"]) assert.ok(!toggleOf(view, id).hasAttribute("hidden"), `${id}: Track withheld under Manual`);
  assert.equal(timers.pending(), 0);
  timers.advance(0);
  assert.equal(commands.calls.length, 2);

  // An unknown word is the default, Automatic: Track withdrawn, the batch asked for again.
  setTrackingMode("whatever");
  view.refresh();
  assert.ok(toggleOf(view, "A1").hasAttribute("hidden"));
  assert.ok(toggleOf(view, "A3").hasAttribute("hidden"));
  assert.equal(timers.pending(), 1);
});

/* ----------------------------------------------------------------------
 *   Editing: blend and share
 * -------------------------------------------------------------------- */

test("the blend cell opens an inline field; Enter commits one setHopperBlend as typed and closes; unchanged or empty closes silently; H1 never opens", () => {
  const { view, commands, committed, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  const cell = a2.querySelector(".slate-hopper__pct");
  assert.equal(cell.getAttribute("data-able"), "true");
  click(cell);
  assert.deepEqual(view.editing(), { slot: "pct", recipe: "current", layer: "A", index: 1 });
  assert.ok(a2.classList.contains("is-editing"));
  assert.ok(cell.hasAttribute("hidden"));
  const input = a2.querySelector(".slate-hopper__input");
  assert.equal(input.value, "30");
  assert.equal(input.focused, true);
  input.value = " 45 ";
  key(input, "Enter");
  assert.deepEqual(commands.calls, [{ command: "setHopperBlend", args: { recipe: "current", layer: "A", index: 1, pct: "45" } }]);
  assert.equal(committed.length, 1);
  assert.equal(view.editing(), null);
  assert.ok(!cell.hasAttribute("hidden"));
  assert.equal(a2.querySelector(".slate-hopper__input"), null, "the field was left behind");
  assert.equal(cell.focused, true);

  click(cell);
  a2.querySelector(".slate-hopper__input").value = "30";
  key(a2.querySelector(".slate-hopper__input"), "Enter");
  assert.equal(commands.calls.length, 1, "an unchanged value dispatched");
  click(cell);
  a2.querySelector(".slate-hopper__input").value = "";
  a2.querySelector(".slate-hopper__input").dispatchEvent({ type: "blur" });
  assert.equal(commands.calls.length, 1, "an emptied field dispatched");
  assert.equal(view.editing(), null);

  click(cell);
  const escape = key(a2.querySelector(".slate-hopper__input"), "Escape");
  assert.equal(escape._stopped, true);
  assert.equal(view.editing(), null);

  click(row(view, "A1").querySelector(".slate-hopper__pct"));
  assert.equal(view.editing(), null);
  assert.match(said[said.length - 1], /calculated from hoppers 2/);
  assert.equal(row(view, "A1").querySelector(".slate-hopper__pct").getAttribute("data-able"), "false");
});

test("a refusal keeps the field open with the application's words; a later accepted value closes it", () => {
  const answers = [{ ok: false, code: "blend_total", total: 120, message: "Hoppers 2-6 would total 120%." }];
  const commands = makeCommands({ capabilities: ALL, answer: () => answers.shift() });
  const { view, committed } = boot({ commands });
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  click(a2.querySelector(".slate-hopper__pct"));
  const input = a2.querySelector(".slate-hopper__input");
  input.value = "90";
  key(input, "Enter");
  assert.deepEqual(view.editing(), { slot: "pct", recipe: "current", layer: "A", index: 1 });
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(a2.querySelector(".slate-hopper__note").textContent, "Hoppers 2-6 would total 120%.");
  assert.ok(!a2.querySelector(".slate-hopper__note").hasAttribute("hidden"));
  assert.equal(committed.length, 0);
  input.value = "40";
  key(input, "Enter");
  assert.equal(view.editing(), null);
  assert.equal(committed.length, 1);
  assert.ok(a2.querySelector(".slate-hopper__note").hasAttribute("hidden"));
});

test("the layer share edits in its head with setLayerShare, on either tab", () => {
  const { view, commands } = boot();
  view.update(withPlan(), { kind: "structural" });
  const shareButton = head(view, "B").querySelector(".slate-layer__share");
  click(shareButton);
  assert.deepEqual(view.editing(), { slot: "share", recipe: "current", layer: "B", index: null });
  const input = head(view, "B").querySelector(".slate-layer__input");
  assert.equal(input.value, "50");
  input.value = "40";
  input.dispatchEvent({ type: "blur" });
  assert.deepEqual(commands.calls, [{ command: "setLayerShare", args: { recipe: "current", layer: "B", pct: "40" } }]);
  view.setRecipe("next");
  click(head(view, "C", "next").querySelector(".slate-layer__share"));
  head(view, "C", "next").querySelector(".slate-layer__input").value = "35";
  key(head(view, "C", "next").querySelector(".slate-layer__input"), "Enter");
  assert.deepEqual(commands.calls[1], { command: "setLayerShare", args: { recipe: "next", layer: "C", pct: "35" } });
});

/* ----------------------------------------------------------------------
 *   Editing: resin
 * -------------------------------------------------------------------- */

test("the resin cell opens the catalog search; a match commits setHopperResin, a blank on an assigned hopper clears it, and an unknown code goes as typed", () => {
  const { view, commands, committed } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  click(a2.querySelector(".slate-hopper__resin"));
  assert.deepEqual(view.editing(), { slot: "resin", recipe: "current", layer: "A", index: 1 });
  const box = a2.querySelector(".slate-combobox__input");
  assert.equal(box.value, "LD105");
  box.value = "ll";
  box.dispatchEvent({ type: "input" });
  key(box, "Enter");
  assert.deepEqual(commands.calls, [{ command: "setHopperResin", args: { recipe: "current", layer: "A", index: 1, resin: "LL318" } }]);
  assert.equal(committed.length, 1);
  assert.equal(view.editing(), null);
  assert.equal(a2.querySelector(".slate-combobox"), null);

  click(a2.querySelector(".slate-hopper__resin"));
  a2.querySelector(".slate-combobox__input").value = "";
  a2.querySelector(".slate-combobox__input").dispatchEvent({ type: "input" });
  key(a2.querySelector(".slate-combobox__input"), "Enter");
  assert.deepEqual(commands.calls[1], { command: "clearHopper", args: { recipe: "current", layer: "A", index: 1 } });

  click(a2.querySelector(".slate-hopper__resin"));
  const typed = a2.querySelector(".slate-combobox__input");
  typed.value = "brand-new-1";
  typed.dispatchEvent({ type: "input" });
  key(typed, "Enter");
  assert.deepEqual(commands.calls[2], { command: "setHopperResin", args: { recipe: "current", layer: "A", index: 1, resin: "brand-new-1" } });

  // The same code again, a blank on an empty hopper, Escape: nothing sent.
  click(a2.querySelector(".slate-hopper__resin"));
  key(a2.querySelector(".slate-combobox__input"), "Enter");
  assert.equal(commands.calls.length, 3, "choosing the same code dispatched");
  assert.equal(view.editing(), null);
  const a4 = row(view, "A4");
  click(a4.querySelector(".slate-hopper__resin"));
  key(a4.querySelector(".slate-combobox__input"), "Enter");
  assert.equal(commands.calls.length, 3, "a blank on an empty hopper dispatched");
  click(a4.querySelector(".slate-hopper__resin"));
  key(a4.querySelector(".slate-combobox__input"), "Escape");
  assert.equal(view.editing(), null);
  assert.equal(commands.calls.length, 3);
});

test("a refused resin reopens the search on that code with the note; on the Next tab the command names the plan", () => {
  const answers = [{ ok: false, code: "busy", message: "Another device is applying a change." }];
  const commands = makeCommands({ capabilities: ALL, answer: () => answers.shift() });
  const { view } = boot({ commands });
  view.update(withPlan(), { kind: "structural" });
  view.setRecipe("next");
  const a2 = row(view, "A2", "next");
  click(a2.querySelector(".slate-hopper__resin"));
  const box = a2.querySelector(".slate-combobox__input");
  box.value = "hx";
  box.dispatchEvent({ type: "input" });
  key(box, "Enter");
  assert.deepEqual(commands.calls, [{ command: "setHopperResin", args: { recipe: "next", layer: "A", index: 1, resin: "HX204" } }]);
  assert.deepEqual(view.editing(), { slot: "resin", recipe: "next", layer: "A", index: 1 });
  const reopened = a2.querySelector(".slate-combobox__input");
  assert.ok(reopened && reopened !== box, "the search was not reopened");
  assert.equal(reopened.value, "HX204");
  assert.equal(reopened.getAttribute("aria-invalid"), "true");
  assert.equal(a2.querySelector(".slate-hopper__note").textContent, "Another device is applying a change.");
  key(reopened, "Enter");
  assert.equal(commands.calls.length, 2);
  assert.equal(view.editing(), null);
});

/* ----------------------------------------------------------------------
 *   Publishes under an open editor
 * -------------------------------------------------------------------- */

test("a values publish never touches the open field: our own echo is silent, another device's change marks the row and says what moved", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  click(a2.querySelector(".slate-hopper__pct"));
  const input = a2.querySelector(".slate-hopper__input");
  input.value = "44";
  // An unrelated own change elsewhere.
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].track = false; }), { kind: "values", own: true });
  assert.equal(input.value, "44");
  assert.ok(!a2.classList.contains("is-changed-underneath"));
  // Another device changed a sibling cell: patched, no mark.
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].track = false; snap.layers[0].hoppers[1].resinName = "LL318"; }), { kind: "values", own: false });
  assert.equal(a2.querySelector(".slate-hopper__resin").textContent, "LL318");
  assert.ok(!a2.classList.contains("is-changed-underneath"), "a sibling cell's change marked the editor");
  assert.equal(input.value, "44");
  // Another device changed the very value being edited.
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].track = false; snap.layers[0].hoppers[1].resinName = "LL318"; snap.layers[0].hoppers[1].pct = 35; }), { kind: "values", own: false });
  assert.ok(a2.classList.contains("is-changed-underneath"));
  assert.match(a2.querySelector(".slate-hopper__note").textContent, /^A2's blend changed in the application/);
  assert.equal(input.value, "44", "the draft was replaced");
  assert.equal(a2.querySelector(".slate-hopper__pct").textContent, "30%", "the hidden cell was rewritten under the editor");
  key(input, "Escape");
  assert.ok(!a2.classList.contains("is-changed-underneath"));
  assert.equal(a2.querySelector(".slate-hopper__pct").textContent, "35%", "the cell did not show the canonical value on close");
});

test("a structural publish abandons an open edit and a drag; another device's is said, our own is not", () => {
  const first = boot();
  first.view.update(resolvedFrom(), { kind: "structural" });
  click(row(first.view, "A2").querySelector(".slate-hopper__pct"));
  first.view.update(resolvedFrom(snap => { snap.line.hopperCounts = [2, 2, 2]; }), { kind: "structural", own: false });
  assert.equal(first.view.editing(), null);
  assert.deepEqual(first.said, [recipe.ABANDONED]);
  assert.equal(first.commands.calls.length, 0);

  const second = boot();
  second.view.update(resolvedFrom(), { kind: "structural" });
  click(row(second.view, "A2").querySelector(".slate-hopper__resin"));
  second.view.update(resolvedFrom(snap => { snap.line.hopperCounts = [2, 2, 2]; }), { kind: "structural", own: true });
  assert.equal(second.view.editing(), null);
  assert.deepEqual(second.said, []);
});

test("switching tab or hiding the section closes an open editor without dispatching", () => {
  const { view, commands } = boot();
  view.update(withPlan(), { kind: "structural" });
  click(row(view, "A2").querySelector(".slate-hopper__pct"));
  row(view, "A2").querySelector(".slate-hopper__input").value = "99";
  view.setRecipe("next");
  assert.equal(view.editing(), null);
  assert.equal(commands.calls.length, 0);
  click(row(view, "A2", "next").querySelector(".slate-hopper__pct"));
  view.onHide();
  assert.equal(view.editing(), null);
  assert.equal(commands.calls.length, 0);
});

/* ----------------------------------------------------------------------
 *   Drag
 * -------------------------------------------------------------------- */

function dragRows(view, which) {
  const rows = view.element.querySelectorAll(`.slate-recipe__body[data-recipe='${which}'] .slate-hopper`);
  rows.forEach((one, index) => { one._rect = { left: 0, top: index * 40, width: 400, height: 36 }; });
  return rows;
}

test("dropping one badge on another row sends exactly one moveHopper for the shown recipe; a refused drop is said; a structural publish cancels a drag", () => {
  const { doc, view, commands, said } = boot();
  view.update(withPlan(), { kind: "structural" });
  const rows = dragRows(view, "current");
  doc._elementAt = (x, y) => rows.find(one => y >= one._rect.top && y < one._rect.top + one._rect.height) || null;
  const a1 = row(view, "A1");
  const handle = a1.querySelector("[data-slate-handle]");
  assert.ok(a1.classList.contains("is-movable"));
  pointer("pointerdown", handle, { clientX: 5, clientY: 5 });
  pointer("pointermove", handle, { clientX: 5, clientY: 30 });
  assert.ok(a1.classList.contains("is-dragging"));
  const b1 = row(view, "B1");
  pointer("pointermove", handle, { clientX: 5, clientY: b1._rect.top + 10 });
  assert.ok(b1.classList.contains("is-drop-target"));
  pointer("pointerup", handle, { clientX: 5, clientY: b1._rect.top + 10 });
  assert.deepEqual(commands.calls, [{ command: "moveHopper", args: { recipe: "current", layer: "A", index: 0, toLayer: "B", toIndex: 0 } }]);
  // The click the release produced does not open the resin editor.
  click(a1.querySelector(".slate-hopper__resin"));
  assert.equal(view.editing(), null);
  click(a1.querySelector(".slate-hopper__resin"));
  assert.deepEqual(view.editing(), { slot: "resin", recipe: "current", layer: "A", index: 0 });
  key(a1.querySelector(".slate-combobox__input"), "Escape");

  view.setRecipe("next");
  const nextRows = dragRows(view, "next");
  doc._elementAt = (x, y) => nextRows.find(one => y >= one._rect.top && y < one._rect.top + one._rect.height) || null;
  const refusing = makeCommands({ capabilities: ALL, answer: () => ({ ok: false, code: "empty_hopper", message: "That hopper has nothing to move." }) });
  const other = boot({ commands: refusing });
  other.view.update(withPlan(), { kind: "structural" });
  other.view.setRecipe("next");
  const otherRows = dragRows(other.view, "next");
  other.doc._elementAt = (x, y) => otherRows.find(one => y >= one._rect.top && y < one._rect.top + one._rect.height) || null;
  const nextA2 = row(other.view, "A2", "next");
  const nextHandle = nextA2.querySelector("[data-slate-handle]");
  pointer("pointerdown", nextHandle, { clientX: 5, clientY: nextA2._rect.top + 5 });
  pointer("pointermove", nextHandle, { clientX: 5, clientY: nextA2._rect.top + 30 });
  const target = row(other.view, "A3", "next");
  pointer("pointermove", nextHandle, { clientX: 5, clientY: target._rect.top + 10 });
  pointer("pointerup", nextHandle, { clientX: 5, clientY: target._rect.top + 10 });
  assert.deepEqual(refusing.calls, [{ command: "moveHopper", args: { recipe: "next", layer: "A", index: 1, toLayer: "A", toIndex: 2 } }]);
  assert.deepEqual(other.said, ["That hopper has nothing to move."]);
  assert.equal(other.committed.length, 0);

  // A structural publish mid-drag cancels it.
  const a2 = row(view, "A2", "next");
  const h2 = a2.querySelector("[data-slate-handle]");
  pointer("pointerdown", h2, { clientX: 5, clientY: a2._rect.top + 5 });
  pointer("pointermove", h2, { clientX: 5, clientY: a2._rect.top + 30 });
  assert.ok(a2.classList.contains("is-dragging"));
  view.update(withPlan(snap => { snap.line.hopperCounts = [3, 3, 3]; }), { kind: "structural", own: false });
  assert.equal(view.element.querySelector(".slate-drag-proxy"), null);
  assert.equal(commands.calls.length, 1);
  void said;
});

/* ----------------------------------------------------------------------
 *   Layer menu, plan, print
 * -------------------------------------------------------------------- */

test("the layer menu copies to another layer and clears the layer, for the shown recipe", () => {
  const { view, commands, timers } = boot();
  view.update(withPlan(), { kind: "structural" });
  const menu = head(view, "A").querySelector(".slate-layer-menu");
  click(menu.querySelector(".slate-layer-menu__button"));
  assert.deepEqual(menu.querySelectorAll("[data-menu-copy]").map(item => item.getAttribute("data-menu-copy")), ["B", "C"]);
  click(menu.querySelector("[data-menu-copy='C']"));
  assert.deepEqual(commands.calls, [{ command: "copyLayer", args: { recipe: "current", layer: "A", toLayer: "C" } }]);
  view.setRecipe("next");
  const nextMenu = head(view, "B", "next").querySelector(".slate-layer-menu");
  click(nextMenu.querySelector(".slate-layer-menu__button"));
  const clear = nextMenu.querySelector("[data-menu-clear]");
  click(clear);
  assert.equal(commands.calls.length, 1);
  click(clear);
  assert.deepEqual(commands.calls[1], { command: "clearLayer", args: { recipe: "next", layer: "B" } });
  assert.equal(timers.pending(), 0);
});

test("the plan's moves: Copy current → Next from the bar or the empty state; Promote arms, then sends; both are unable without what they need", () => {
  const { view, commands, timers, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  view.setRecipe("next");
  const promote = view.element.querySelector("[data-slate-plan='promote']");
  assert.ok(view.body("next").contains(promote), "the plan's moves are not in the Next body");
  assert.ok(promote.closest(".slate-recipe__plan").hasAttribute("hidden"), "the plan's foot shows with nothing planned");
  assert.equal(promote.getAttribute("data-able"), "false");
  assert.match(promote.getAttribute("title"), /nothing is planned/);
  click(promote);
  assert.equal(commands.calls.length, 0);
  assert.match(said[0], /nothing is planned/);
  click(view.body("next").querySelector(".slate-recipe__empty [data-slate-plan='copy']"));
  assert.deepEqual(commands.calls, [{ command: "copyCurrentToNext", args: {} }]);

  view.update(withPlan(), { kind: "structural" });
  view.setRecipe("next");
  assert.ok(!promote.closest(".slate-recipe__plan").hasAttribute("hidden"));
  assert.equal(view.element.querySelector(".slate-section__bar [data-slate-plan]"), null, "the bar still carries the plan's moves");
  assert.equal(promote.getAttribute("data-able"), "true");
  click(promote);
  assert.ok(promote.hasAttribute("data-armed"));
  assert.equal(promote.textContent, recipe.PROMOTE_ARMED_LABEL);
  assert.equal(commands.calls.length, 1);
  timers.advance(recipe.RESET_ARM_MS);
  assert.ok(!promote.hasAttribute("data-armed"));
  click(promote);
  click(promote);
  assert.deepEqual(commands.calls[1], { command: "promoteNextRecipe", args: {} });
  assert.ok(!promote.hasAttribute("data-armed"));
  click(view.element.querySelector(".slate-recipe__plan [data-slate-plan='copy']"));
  assert.deepEqual(commands.calls[2], { command: "copyCurrentToNext", args: {} });
  assert.ok(view.element.querySelector(".slate-recipe__plan [data-slate-plan='copy']").classList.contains("slate-recipe__plan-action--quiet"), "Copy is not the quiet one");
});

test("Print drops a menu whose items follow what there is to print, and asks the printer for the page chosen", () => {
  const { view, printed, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const trigger = view.element.querySelector(".slate-print__trigger");
  const items = view.element.querySelectorAll("[data-print]");
  assert.deepEqual(items.map(item => [item.getAttribute("data-print"), item.getAttribute("aria-disabled")]), [["current", "false"], ["next", "true"], ["both", "false"]]);
  click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  click(items[1]);
  assert.deepEqual(printed, []);
  assert.match(said[0], /Nothing is planned to print/);
  click(items[0]);
  assert.deepEqual(printed, [{ which: "current", planned: false }]);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  view.update(withPlan(), { kind: "structural" });
  assert.equal(items[1].getAttribute("aria-disabled"), "false");
  click(trigger);
  click(items[2]);
  assert.deepEqual(printed[1], { which: "both", planned: true });
});

/* ----------------------------------------------------------------------
 *   Track (unchanged from phase 1)
 * -------------------------------------------------------------------- */

test("a toggle click dispatches one command with the state wanted; the reset arms and resets; marks land on Current rows", () => {
  const { view, commands, committed, timers } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1");
  click(a1.querySelector("[data-slate-control='tracking']"));
  assert.deepEqual(commands.calls, [{ command: "setHopperTracking", args: { recipe: "current", layer: "A", index: 0, track: false } }]);
  assert.equal(committed.length, 1);
  click(row(view, "A4").querySelector("[data-slate-control='tracking']"));
  assert.equal(commands.calls.length, 1);

  const reset = view.body("current").querySelector(".slate-recipe__reset");
  click(reset);
  assert.ok(reset.hasAttribute("data-armed"));
  key(reset, "Escape");
  assert.ok(!reset.hasAttribute("data-armed"));
  click(reset);
  timers.advance(recipe.RESET_ARM_MS);
  assert.ok(!reset.hasAttribute("data-armed"));
  click(reset);
  click(reset);
  assert.deepEqual(commands.calls[1], { command: "resetTracking", args: { recipe: "current" } });

  view.applyMarks({ "A:0": { tracked: true, pumpOff: false, late: true, overdue: true }, "A:1": { tracked: true, pumpOff: true, late: true, overdue: false } });
  assert.ok(a1.classList.contains("is-overdue"));
  assert.equal(a1.querySelector(".slate-hopper__mark").textContent, "Overdue");
  // Past its point but pumped off: done, not late - no mark at all.
  assert.equal(row(view, "A2").querySelector(".slate-hopper__mark").textContent, "");
  assert.ok(!row(view, "A2").classList.contains("is-overdue") && !row(view, "A2").classList.contains("is-late"));
  view.applyMarks({});
  assert.ok(!a1.classList.contains("is-overdue"));
});

/* ----------------------------------------------------------------------
 *   Read-only and no bridge
 * -------------------------------------------------------------------- */

test("read-only withholds every edit, drag, menu item, history and plan move - Compare and Print stay - and Off restores them in place", () => {
  const { doc, view, commands, said, printed, setReadOnly } = boot({ readOnly: true });
  view.update(withPlan(), { kind: "structural" });
  const a2 = row(view, "A2");
  assert.ok(view.element.classList.contains("is-readonly"));
  for (const selector of [".slate-hopper__resin", ".slate-hopper__pct"]) {
    const cell = a2.querySelector(selector);
    assert.equal(cell.getAttribute("data-able"), "false");
    assert.match(cell.getAttribute("title"), /read-only/);
    click(cell);
    assert.equal(view.editing(), null);
  }
  assert.match(said[said.length - 1], /read-only/);
  assert.equal(head(view, "A").querySelector(".slate-layer__share").getAttribute("data-able"), "false");
  assert.ok(!a2.classList.contains("is-movable"));
  const rows = dragRows(view, "current");
  doc._elementAt = (x, y) => rows.find(one => y >= one._rect.top && y < one._rect.top + one._rect.height) || null;
  const handle = a2.querySelector("[data-slate-handle]");
  pointer("pointerdown", handle, { clientX: 5, clientY: a2._rect.top + 5 });
  pointer("pointermove", handle, { clientX: 5, clientY: a2._rect.top + 30 });
  assert.equal(view.element.querySelector(".slate-drag-proxy"), null, "a drag started under read-only");
  pointer("pointerup", handle, { clientX: 5, clientY: a2._rect.top + 30 });
  assert.equal(view.element.querySelector("[data-slate-history]"), null, "the bar still carries history buttons");
  view.setRecipe("next");
  assert.equal(view.element.querySelector("[data-slate-plan='promote']").getAttribute("data-able"), "false");
  const menu = head(view, "A", "next").querySelector(".slate-layer-menu");
  click(menu.querySelector(".slate-layer-menu__button"));
  assert.ok(menu.querySelectorAll("[role='menuitem']").every(item => item.getAttribute("aria-disabled") === "true"));
  key(menu, "Escape");
  assert.equal(commands.calls.length, 0);

  click(view.element.querySelector("[data-slate-compare]"));
  assert.equal(view.getCompare(), true);
  click(view.element.querySelector(".slate-print__trigger"));
  click(view.element.querySelector("[data-print='both']"));
  assert.equal(printed.length, 1);

  setReadOnly(false);
  view.refresh();
  assert.equal(row(view, "A2", "next").querySelector(".slate-hopper__resin").getAttribute("data-able"), "true");
  assert.equal(view.element.querySelector("[data-slate-plan='promote']").getAttribute("data-able"), "true");
  click(row(view, "A2", "next").querySelector(".slate-hopper__pct"));
  assert.deepEqual(view.editing(), { slot: "pct", recipe: "next", layer: "A", index: 1 });
  // The mode flipping back on while a field is open stops the commit.
  setReadOnly(true);
  const input = row(view, "A2", "next").querySelector(".slate-hopper__input");
  input.value = "70";
  key(input, "Enter");
  assert.equal(commands.calls.length, 0, "a commit went through under read-only");
  assert.match(row(view, "A2", "next").querySelector(".slate-hopper__note").textContent, /read-only/);
});

test("with no bridge every control is unable and explains; nothing is dispatched", () => {
  const { view, said, committed } = boot({ commands: null });
  view.update(withPlan(), { kind: "structural" });
  click(row(view, "A2").querySelector(".slate-hopper__resin"));
  assert.equal(view.editing(), null);
  assert.match(said[0], /no application is connected/);
  click(view.element.querySelector("[data-slate-plan='copy']"));
  assert.equal(committed.length, 0);
  assert.equal(row(view, "A2").querySelector("[data-slate-control='tracking']").getAttribute("data-able"), "false");
});

/* ----------------------------------------------------------------------
 *   Save as recipe
 * -------------------------------------------------------------------- */

test("under a finger Save as recipe leads both foots (after the desktop's Recipe Book, which the sheet hides there); Current's saves the running recipe, Next's the plan, each as one request, and the section says so", async () => {
  const recipes = makeRecipes();
  const { view, said } = boot({ recipes, touch: true });
  view.update(withPlan(), { kind: "structural" });
  const currentFoot = plainFoot(view, "current");
  assert.equal(currentFoot.children[0].getAttribute("data-slate-book"), "current", "Recipe Book does not lead Current's foot");
  assert.equal(currentFoot.children[1].getAttribute("data-slate-save"), "current", "Save does not follow it");
  assert.equal(currentFoot.children[2].classList.contains("slate-recipe__reset"), true);
  const nextFoot = view.element.querySelector(".slate-recipe__body[data-recipe='next'] .slate-recipe__plan");
  assert.equal(nextFoot.children[0].getAttribute("data-slate-book"), "next", "Recipe Book does not lead Next's foot");
  assert.equal(nextFoot.children[1].getAttribute("data-slate-save"), "next", "Save does not follow it");
  assert.equal(nextFoot.children[2].getAttribute("data-slate-plan"), "copy");
  assert.equal(saveButton(view, "current").textContent, recipe.SAVE_LABEL);
  assert.equal(saveButton(view, "current").getAttribute("data-able"), "true");
  assert.equal(saveButton(view, "next").getAttribute("data-able"), "true");
  assert.ok(saveEntry(view, "current").hasAttribute("hidden"));

  click(saveButton(view, "current"));
  const entry = saveEntry(view, "current");
  assert.ok(!entry.hasAttribute("hidden"));
  assert.equal(entry.querySelector(".slate-recipe__save-label").textContent, recipe.SAVE_ENTRY_LABEL.current);
  const name = entry.querySelector(".slate-recipe__save-name");
  assert.equal(name.focused, true);
  assert.deepEqual(view.saving(), { recipe: "current", existing: null, busy: false });
  key(name, "Enter");
  await tick();
  assert.equal(recipes.requests.length, 0, "an empty name was sent");
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.match(entry.querySelector(".slate-recipe__save-note").textContent, /Give the recipe a name/);
  name.value = " Blue  film 2 ";
  key(name, "Enter");
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "saveCurrentRecipe", args: { name: "Blue film 2" } }]);
  assert.ok(entry.hasAttribute("hidden"));
  assert.equal(view.saving(), null);
  assert.match(said[said.length - 1], /Saved \u201cBlue film 2\u201d/);

  view.setRecipe("next");
  click(saveButton(view, "next"));
  const nextEntry = saveEntry(view, "next");
  assert.ok(!nextEntry.hasAttribute("hidden"));
  assert.equal(nextEntry.querySelector(".slate-recipe__save-label").textContent, recipe.SAVE_ENTRY_LABEL.next);
  nextEntry.querySelector(".slate-recipe__save-name").value = "Plan A";
  click(nextEntry.querySelector("[data-slate-save-do='save']"));
  await tick();
  assert.deepEqual(recipes.requests[1], { action: "saveNextRecipe", args: { name: "Plan A" } });
  assert.ok(nextEntry.hasAttribute("hidden"));
});

test("a colliding Save Current offers Replace, which asks replaceRecipe; a colliding Save Next only says so; a refusal shows its words", async () => {
  const collide = { ok: false, code: "duplicate_name", message: "A recipe with that name already exists.", field: "name" };
  const recipes = makeRecipes({ answers: { saveCurrentRecipe: collide, saveNextRecipe: collide } });
  const { view, said } = boot({ recipes });
  view.update(withPlan(), { kind: "structural" });
  click(saveButton(view, "current"));
  const entry = saveEntry(view, "current");
  const name = entry.querySelector(".slate-recipe__save-name");
  name.value = "BLUE film";
  click(entry.querySelector("[data-slate-save-do='save']"));
  await tick();
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.ok(!entry.querySelector("[data-slate-save-do='replace']").hasAttribute("hidden"));
  assert.match(entry.querySelector(".slate-recipe__save-note").textContent, /named \u201cBlue film\u201d already exists/);
  assert.deepEqual(view.saving().existing, { id: "r1", name: "Blue film" });
  click(entry.querySelector("[data-slate-save-do='replace']"));
  await tick();
  assert.deepEqual(recipes.requests[1], { action: "replaceRecipe", args: { id: "r1" } });
  assert.ok(entry.hasAttribute("hidden"));
  assert.match(said[said.length - 1], /Replaced \u201cBlue film\u201d/);

  view.setRecipe("next");
  click(saveButton(view, "next"));
  const nextEntry = saveEntry(view, "next");
  nextEntry.querySelector(".slate-recipe__save-name").value = "Blue film";
  click(nextEntry.querySelector("[data-slate-save-do='save']"));
  await tick();
  assert.ok(nextEntry.querySelector("[data-slate-save-do='replace']").hasAttribute("hidden"), "a plan's save offered Replace");
  assert.match(nextEntry.querySelector(".slate-recipe__save-note").textContent, /Choose another name/);
  assert.ok(!nextEntry.hasAttribute("hidden"));
  assert.equal(recipes.requests.length, 3);

  // A refusal with its own words.
  const refusing = makeRecipes({ answers: { saveCurrentRecipe: { ok: false, code: "network_error", message: "Offline." } } });
  const other = boot({ recipes: refusing });
  other.view.update(resolvedFrom(), { kind: "structural" });
  click(saveButton(other.view, "current"));
  saveEntry(other.view, "current").querySelector(".slate-recipe__save-name").value = "X";
  click(saveEntry(other.view, "current").querySelector("[data-slate-save-do='save']"));
  await tick();
  assert.equal(saveEntry(other.view, "current").querySelector(".slate-recipe__save-note").textContent, "Offline.");
  assert.ok(!saveEntry(other.view, "current").hasAttribute("hidden"));
});

test("the entry closes on Cancel, Escape, a tab switch, a hide and read-only; without a recipes bridge or a plan Save is withheld with the reason", () => {
  const recipes = makeRecipes();
  const { view, said, setReadOnly } = boot({ recipes, touch: true });
  view.update(withPlan(), { kind: "structural" });
  const entry = saveEntry(view, "current");
  click(saveButton(view, "current"));
  click(entry.querySelector("[data-slate-save-do='cancel']"));
  assert.ok(entry.hasAttribute("hidden"));
  click(saveButton(view, "current"));
  const escape = key(entry.querySelector(".slate-recipe__save-name"), "Escape");
  assert.ok(entry.hasAttribute("hidden"));
  assert.equal(escape._stopped, true);
  click(saveButton(view, "current"));
  view.setRecipe("next");
  assert.ok(entry.hasAttribute("hidden"), "a tab switch left the entry open");
  assert.equal(view.saving(), null);
  click(saveButton(view, "next"));
  view.onHide();
  assert.ok(saveEntry(view, "next").hasAttribute("hidden"));
  view.setRecipe("current");
  click(saveButton(view, "current"));
  setReadOnly(true);
  view.refresh();
  assert.ok(entry.hasAttribute("hidden"), "read-only left the entry open");
  assert.equal(saveButton(view, "current").getAttribute("data-able"), "false");
  assert.match(saveButton(view, "current").getAttribute("title"), /read-only/);
  click(saveButton(view, "current"));
  assert.match(said[said.length - 1], /read-only/);
  assert.ok(entry.hasAttribute("hidden"));
  setReadOnly(false);
  view.refresh();

  // Nothing planned: Next's Save is withheld.
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(saveButton(view, "next").getAttribute("data-able"), "false");
  assert.match(saveButton(view, "next").getAttribute("title"), /nothing is planned/);
  assert.equal(saveButton(view, "current").getAttribute("data-able"), "true");

  // A device off any line: withheld until the Book says a line is joined,
  // which arrives on the recipes bridge's own publish.
  const unassigned = makeRecipes({ assigned: false });
  const joined = boot({ recipes: unassigned, touch: true });
  joined.view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(saveButton(joined.view, "current").getAttribute("data-able"), "false");
  assert.match(saveButton(joined.view, "current").getAttribute("title"), /not on a production line/);
  unassigned.assign(true);
  assert.equal(saveButton(joined.view, "current").getAttribute("data-able"), "true", "a join did not reach the foot");

  // No recipes bridge at all.
  const none = boot({ touch: true });
  none.view.update(withPlan(), { kind: "structural" });
  for (const which of ["current", "next"]) {
    assert.equal(saveButton(none.view, which).getAttribute("data-able"), "false");
    assert.match(saveButton(none.view, which).getAttribute("title"), /no application is connected/);
  }
  click(saveButton(none.view, "current"));
  assert.match(none.said[none.said.length - 1], /no application is connected/);
  assert.ok(saveEntry(none.view, "current").hasAttribute("hidden"));
});

/* ----------------------------------------------------------------------
 *   The Recipe Book under the tabs (a desktop's)
 * -------------------------------------------------------------------- */

const bookToggle = (view, which) => view.element.querySelector(`.slate-recipe__book-toggle[data-slate-book='${which}']`);
const bookPanel = view => view.element.querySelector(".slate-recipe__book");
const bulkButton = view => view.element.querySelector(".slate-recipe__bulk");

test("with a mouse Recipe Book opens the line's Book under the tab - Save Current and Save Next first, then the list - one Book for both tabs, and closes on a second press", async () => {
  const recipes = makeRecipes();
  const { view, commands } = boot({ recipes });
  view.update(withPlan(), { kind: "structural" });
  const panel = bookPanel(view);
  assert.ok(panel.hasAttribute("hidden"));
  assert.equal(view.book(), null);
  for (const which of ["current", "next"]) {
    assert.equal(bookToggle(view, which).textContent, recipe.BOOK_LABEL);
    assert.equal(bookToggle(view, which).getAttribute("aria-expanded"), "false");
    assert.equal(bookToggle(view, which).getAttribute("data-able"), "true");
  }

  click(bookToggle(view, "current"));
  assert.ok(!panel.hasAttribute("hidden"));
  assert.ok(view.book(), "the section does not say the Book is open");
  assert.equal(bookToggle(view, "current").getAttribute("aria-expanded"), "true");
  assert.equal(bookToggle(view, "next").getAttribute("aria-expanded"), "true", "the other tab's toggle does not say the Book is open");
  const bar = panel.querySelector(".slate-section__bar");
  assert.ok(bar.querySelector("[data-book-action='save-current']") && bar.querySelector("[data-book-action='save-next']"), "the Book's saves are not in its bar");
  assert.equal(panel.querySelectorAll(".slate-book__row").length, 1, "the list is not there");

  // Save Current through the Book: its name entry, one request.
  click(bar.querySelector("[data-book-action='save-current']"));
  const name = panel.querySelector(".slate-book__name");
  name.value = "Blue film 3";
  key(name, "Enter");
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "saveCurrentRecipe", args: { name: "Blue film 3" } }]);

  // Selecting shows the blend and changes nothing; Load's preview reads the line shown.
  click(panel.querySelector(".slate-book__row[data-recipe='r1']"));
  assert.equal(panel.querySelector(".slate-book__detail-name").textContent, "Blue film");
  click(panel.querySelector("[data-book-action='load']"));
  assert.match(panel.querySelector(".slate-book__preview[data-destination='current']").textContent, /Into Current: \d+ of 16 hoppers change/);
  assert.equal(commands.calls.length, 0, "the Book dispatched a line command");
  assert.equal(recipes.requests.length, 1, "selecting or opening a preview sent a request");

  // One Book: a tab switch keeps it open, and either toggle closes it.
  view.setRecipe("next");
  assert.ok(!panel.hasAttribute("hidden"));
  click(bookToggle(view, "next"));
  assert.ok(panel.hasAttribute("hidden"));
  assert.equal(bookToggle(view, "current").getAttribute("aria-expanded"), "false");
  assert.equal(view.book(), null);
  // Closing put the confirm away.
  click(bookToggle(view, "next"));
  assert.equal(panel.querySelector(".slate-book__confirm"), null, "a closed Book kept its confirm");
});

test("the Book closes on a hide, on Escape inside it, on Bulk edit (which withholds it) and on a move to the touch tier", () => {
  let input = "pointer";
  const { view, said } = boot({ recipes: makeRecipes(), tier: () => ({ input, width: "wide" }) });
  view.update(withPlan(), { kind: "structural" });
  const panel = bookPanel(view);
  const toggle = bookToggle(view, "current");

  click(toggle);
  view.onHide();
  assert.ok(panel.hasAttribute("hidden"), "a hide left the Book open");

  click(toggle);
  const escape = key(panel.querySelector(".slate-book__row"), "Escape");
  assert.ok(panel.hasAttribute("hidden"), "Escape left the Book open");
  assert.equal(escape._stopped, true);
  assert.equal(toggle.focused, true, "focus did not go back to the toggle");

  click(toggle);
  click(bulkButton(view));
  assert.ok(view.bulk(), "Bulk edit did not open");
  assert.ok(panel.hasAttribute("hidden"), "Bulk edit left the Book open");
  assert.equal(toggle.getAttribute("data-able"), "false");
  assert.match(toggle.getAttribute("title"), /bulk edit/i);
  click(toggle);
  assert.ok(panel.hasAttribute("hidden"));
  assert.match(said[said.length - 1], /bulk edit/i);
  view.onHide();

  click(toggle);
  assert.ok(!panel.hasAttribute("hidden"));
  input = "touch";
  view.refresh();
  assert.ok(panel.hasAttribute("hidden"), "the touch tier kept the desktop's Book open");
});

test("the sheets give a mouse Recipe Book and a finger Save as recipe - each hidden where the other stands - with no rule of the pointer tier's own", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/recipe.css"), "utf8");
  assert.match(css, /\.slate-root \.slate-recipe__save \{\s*display: none;/);
  assert.match(css, /\.slate-root\[data-input="touch"\] \.slate-recipe__save \{\s*display: inline-block;/);
  assert.match(css, /\.slate-root\[data-input="touch"\] \.slate-recipe__book-toggle,\s*\.slate-root\[data-input="touch"\] \.slate-recipe__book \{\s*display: none;/);
});

/* ----------------------------------------------------------------------
 *   The Weights tab (a desktop's)
 * -------------------------------------------------------------------- */

const weightsTab = view => view.element.querySelector(".slate-recipe__weights-tab");
const weightsPanel = view => view.element.querySelector(".slate-recipe__weights");
// The page's own view while its tab shows (null otherwise).
const weightsView = view => view.weights();

test("with a mouse the third tab shows the Weights page in the bodies' place - the recipe's switches stand aside - and Current or Next brings the recipe back", () => {
  const { view, commands, committed } = boot({ recipes: makeRecipes() });
  view.update(withPlan(), { kind: "structural" });
  assert.equal(view.element.getAttribute("data-view"), "recipe");
  assert.ok(weightsPanel(view).hasAttribute("hidden"));
  assert.equal(view.weights(), null);
  // The recipe's own switches carry the class the sheet sets aside under Weights.
  for (const selector of ["[data-slate-compare]", ".slate-recipe__bulk", ".slate-print", ".slate-scan"]) {
    assert.ok(view.element.querySelector(selector).classList.contains("slate-recipe__only"), `${selector} would stay under the Weights tab`);
  }

  click(bookToggle(view, "current"));
  click(weightsTab(view));
  assert.ok(view.weights(), "the section does not say Weights is shown");
  assert.equal(view.element.getAttribute("data-view"), "weights");
  assert.equal(weightsTab(view).getAttribute("aria-selected"), "true");
  assert.deepEqual(view.element.querySelectorAll(".slate-tabs__tab[data-recipe]").map(tab => tab.getAttribute("aria-selected")), ["false", "false"]);
  assert.ok(!weightsPanel(view).hasAttribute("hidden"));
  assert.ok(view.body("current").hasAttribute("hidden") && view.body("next").hasAttribute("hidden"));
  assert.ok(bookPanel(view).hasAttribute("hidden"), "the Book stayed open over the Weights tab");
  // The page reads the same publishes: a row per hopper.
  assert.equal(weightsPanel(view).querySelectorAll(".slate-weights__row").length, 16);

  // Always a draft on a desktop: no Bulk edit button; typing sends nothing; Apply sends ONE setHopperWeights.
  assert.equal(weightsPanel(view).querySelector("[data-slate-weights-bulk]"), null, "the desktop's page still has a Bulk edit button");
  assert.ok(weightsView(view).bulk(), "the desktop's page is not a draft");
  const fill = weightsPanel(view).querySelector(".slate-recipe__fill");
  assert.ok(!fill.hasAttribute("hidden"), "the fill window is not always up");
  assert.ok(fill.querySelector("[data-slate-smart]") && fill.querySelector(".slate-weights__circumference"), "the switch and the circumference are not in the fill window");
  const field = weightsPanel(view).querySelector(".slate-weights__field[data-key='A:0'][data-kind='weight']");
  field.dispatchEvent({ type: "focus", target: field });
  field.value = "450";
  field.dispatchEvent({ type: "input", target: field });
  key(field, "Enter");
  field.dispatchEvent({ type: "blur", target: field });
  assert.equal(commands.calls.length, 0, "a draft reached the line without Apply");
  click(weightsPanel(view).querySelector("[data-slate-weights-bulk-do='apply']"));
  assert.deepEqual(commands.calls, [{ command: "setHopperWeights", args: { recipe: "current", weights: [{ layer: "A", index: 0, weight: 450 }] } }]);
  assert.equal(committed.length, 1);
  assert.ok(weightsView(view).bulk(), "after Apply the page is not a fresh draft");
  assert.equal(weightsView(view).bulk().changes, 0);

  // With no changes waiting, the tab turns back freely.
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  assert.equal(view.weights(), null);
  assert.equal(view.getRecipe(), "next");
  assert.ok(!view.body("next").hasAttribute("hidden") && view.body("current").hasAttribute("hidden"));
  assert.ok(weightsPanel(view).hasAttribute("hidden"));
  assert.equal(view.element.getAttribute("data-view"), "recipe");
  assert.equal(commands.calls.length, 1);

  // setRecipe from outside puts Weights away too.
  click(weightsTab(view));
  view.setRecipe("next");
  assert.equal(view.weights(), null);
  assert.ok(!view.body("next").hasAttribute("hidden"));
});

test("a bulk edit holding changes keeps the Weights tab from turning; one without changes closes; hiding the section and the touch tier put Weights away", () => {
  let input = "pointer";
  const { view, said } = boot({ tier: () => ({ input, width: "wide" }) });
  view.update(withPlan(), { kind: "structural" });
  click(bulkButton(view));
  typedInto(field(view, "A2", "pct"), "35");
  click(weightsTab(view));
  assert.equal(view.weights(), null, "the tab turned over a bulk edit's changes");
  assert.ok(view.bulk());
  assert.equal(said[said.length - 1], recipe.BULK_SWITCH);
  typedInto(field(view, "A2", "pct"), "30");
  click(weightsTab(view));
  assert.ok(view.weights());
  assert.equal(view.bulk(), null, "an unchanged bulk edit stayed open under Weights");

  view.onHide();
  assert.ok(view.weights(), "a hide turned the tab (the Weights tab is kept, as Current or Next is)");
  input = "touch";
  view.refresh();
  assert.equal(view.weights(), null, "the touch tier kept the desktop's Weights tab");
  assert.ok(!view.body("current").hasAttribute("hidden"));
});

test("the Weights page's changes hold the tab as the recipe's bulk edit does: with changes Current will not turn; without, it turns", () => {
  const { view, said, commands } = boot();
  view.update(withPlan(), { kind: "structural" });
  click(weightsTab(view));
  const panel = weightsPanel(view);
  const a1 = panel.querySelector(".slate-weights__field[data-key='A:0'][data-kind='weight']");
  a1.value = "450";
  a1.dispatchEvent({ type: "input", target: a1 });
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='current']"));
  assert.ok(view.weights(), "the tab turned over the Weights bulk edit's changes");
  assert.equal(said[said.length - 1], recipe.BULK_SWITCH);
  a1.value = "400";
  a1.dispatchEvent({ type: "input", target: a1 });
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='current']"));
  assert.equal(view.weights(), null);
  assert.equal(commands.calls.length, 0);
});

test("the sheets keep the Weights tab off the touch tier, set the recipe's switches aside under it keeping their room, and draw no bar of the page's own", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/recipe.css"), "utf8");
  assert.match(css, /\.slate-root\[data-input="touch"\] \.slate-recipe__weights-tab,\s*\.slate-root\[data-input="touch"\] \.slate-recipe__weights \{\s*display: none;/);
  // Unseen but keeping their room: the tabs must not shift along the bar when Weights is chosen.
  assert.match(css, /\.slate-recipe\[data-view="weights"\] \.slate-recipe__only \{\s*visibility: hidden;/);
  assert.doesNotMatch(css, /\.slate-recipe\[data-view="weights"\] \.slate-recipe__only \{\s*display: none;/);
  // Nothing between the tabs and the layers that the recipe does not have: no bar, no Smart Hoppers words.
  assert.match(css, /\.slate-recipe__weights \.slate-weights__bar,\s*\.slate-recipe__weights \.slate-weights__smart-text \{\s*display: none;/);
});

/* ----------------------------------------------------------------------
 *   Bulk edit
 * -------------------------------------------------------------------- */


const bulkFoot = (view, which) => view.element.querySelector(`.slate-recipe__body[data-recipe='${which || "current"}'] .slate-recipe__bulk-foot`);
const field = (view, id, kind, which) => row(view, id, which).querySelector(`.slate-hopper__draft-${kind}`);
const typedInto = (input, value) => { input.value = value; input.dispatchEvent({ type: "input" }); };

test("Bulk edit opens the shown tab as a form: it closes the inline editor and the save entry, swaps the foot, presses the bar button, and withholds every other recipe edit - Track stays", () => {
  const { view, commands, said } = boot({ recipes: makeRecipes() });
  view.update(withPlan(), { kind: "structural" });
  const button = bulkButton(view);
  assert.equal(button.getAttribute("data-able"), "true");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  click(row(view, "A2").querySelector(".slate-hopper__pct"));
  assert.ok(view.editing());
  click(saveButton(view, "current"));
  assert.ok(view.saving());
  click(button);
  assert.deepEqual(view.bulk(), { recipe: "current", changes: 0, armed: false, picked: [], auto: false });
  assert.equal(view.editing(), null, "the inline editor stayed open under the form");
  assert.equal(view.saving(), null, "the save entry stayed open under the form");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.ok(!bulkFoot(view).hasAttribute("hidden"));
  assert.ok(plainFoot(view, "current").hasAttribute("hidden"), "the normal foot stayed");
  assert.equal(bulkFoot(view).querySelector(".slate-recipe__bulk-summary").textContent, "Nothing changes");
  assert.equal(bulkFoot(view).querySelector("[data-slate-bulk-do='apply']").getAttribute("data-able"), "false");
  assert.equal(field(view, "A2", "resin").value, "LD105");
  assert.equal(field(view, "A2", "pct").value, "30");
  assert.equal(field(view, "A1", "h1").textContent, "60%");
  // Withheld, each with the reason.
  const a2 = row(view, "A2");
  assert.ok(a2.querySelector(".slate-hopper__resin").hasAttribute("hidden"));
  assert.equal(a2.querySelector(".slate-hopper__resin").getAttribute("data-able"), "false");
  assert.ok(!a2.classList.contains("is-movable"));
  const share = head(view, "A").querySelector(".slate-layer__share");
  assert.equal(share.getAttribute("data-able"), "false");
  assert.match(share.getAttribute("title"), /Apply or cancel the bulk edit first/);
  click(share);
  assert.equal(view.editing(), null);
  assert.match(said[said.length - 1], /Apply or cancel the bulk edit first/);
  const menu = head(view, "A").querySelector(".slate-layer-menu");
  click(menu.querySelector(".slate-layer-menu__button"));
  assert.ok(menu.querySelectorAll(".slate-layer-menu__item").every(item => item.getAttribute("aria-disabled") === "true"), "a layer menu item stayed able");
  for (const selector of [".slate-recipe__reset", ".slate-recipe__save[data-slate-save='current']"]) {
    const control = view.element.querySelector(selector);
    assert.equal(control.getAttribute("data-able"), "false", selector);
    assert.match(control.getAttribute("title"), /bulk edit/, selector);
  }
  assert.equal(commands.calls.length, 0, "opening the form dispatched");
  // The job's tracking is not the recipe's: the toggle still works.
  click(row(view, "A2").querySelector(".slate-toggle--tracking"));
  assert.equal(commands.calls.length, 1);
  assert.equal(commands.calls[0].command, "setHopperTracking");
  assert.deepEqual([commands.calls[0].args.recipe, commands.calls[0].args.layer, commands.calls[0].args.index], ["current", "A", 1]);
  assert.ok(view.bulk(), "a toggle closed the form");
});

test("Apply sends exactly one setHopperAssignments naming only what changed, for the shown recipe; the form closes, the cells show the line again, and the section says how many", () => {
  const { view, commands, committed, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  typedInto(field(view, "A2", "resin"), "LL318");
  typedInto(field(view, "A3", "pct"), "15");
  typedInto(field(view, "B2", "resin"), "");
  typedInto(field(view, "C3", "resin"), "brand-new");
  typedInto(field(view, "C3", "pct"), "5");
  typedInto(field(view, "C1", "resin"), "eva340");     // the same code, as the application compares it
  const foot = bulkFoot(view);
  assert.equal(foot.querySelector(".slate-recipe__bulk-summary").textContent, "4 hoppers change on Apply");
  assert.equal(view.bulk().changes, 4);
  assert.equal(field(view, "A1", "h1").textContent, "55%");
  assert.equal(field(view, "B2", "pct").value, "", "blanking the resin left the blend");
  const apply = foot.querySelector("[data-slate-bulk-do='apply']");
  assert.equal(apply.getAttribute("data-able"), "true");
  click(apply);
  assert.deepEqual(commands.calls, [{ command: "setHopperAssignments", args: { recipe: "current", hoppers: [
    { layer: "A", index: 1, resin: "LL318" },
    { layer: "A", index: 2, pct: 15 },
    { layer: "B", index: 1, resin: "", pct: 0 },
    { layer: "C", index: 2, resin: "brand-new", pct: 5 }
  ] } }]);
  assert.equal(committed.length, 1);
  assert.equal(said[said.length - 1], "4 hoppers changed.");
  assert.equal(view.bulk(), null);
  assert.equal(bulkButton(view).getAttribute("aria-pressed"), "false");
  assert.ok(foot.hasAttribute("hidden"));
  assert.ok(!plainFoot(view, "current").hasAttribute("hidden"));
  const a2 = row(view, "A2");
  assert.equal(a2.querySelector(".slate-hopper__draft-resin"), null);
  assert.ok(!a2.querySelector(".slate-hopper__resin").hasAttribute("hidden"));
  assert.equal(a2.querySelector(".slate-hopper__resin").textContent, "LD105", "the cell shows the draft, not the line, before the echo");
  assert.equal(a2.querySelector(".slate-hopper__resin").getAttribute("data-able"), "true");
});

test("with nothing changed Apply is withheld and says so, and Cancel closes at once; a refusal keeps every field as typed with the application's words in the foot", () => {
  const answers = [{ ok: false, code: "busy", message: "Another device is applying a change." }];
  const commands = makeCommands({ capabilities: ALL, answer: () => answers.shift() });
  const { view, said, committed } = boot({ commands });
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  const foot = bulkFoot(view);
  click(foot.querySelector("[data-slate-bulk-do='apply']"));
  assert.equal(commands.calls.length, 0);
  assert.equal(said[said.length - 1], "Nothing changes yet");
  click(foot.querySelector("[data-slate-bulk-do='cancel']"));
  assert.equal(view.bulk(), null);
  assert.equal(said.length, 1, "closing an unchanged form said something");

  click(bulkButton(view));
  typedInto(field(view, "A2", "pct"), "35");
  typedInto(field(view, "A3", "resin"), "HX204");
  click(foot.querySelector("[data-slate-bulk-do='apply']"));
  assert.equal(commands.calls.length, 1);
  assert.ok(view.bulk(), "a refusal closed the form");
  assert.equal(field(view, "A2", "pct").value, "35");
  assert.equal(field(view, "A3", "resin").value, "HX204");
  assert.equal(foot.querySelector(".slate-recipe__bulk-note").textContent, "Another device is applying a change.");
  assert.ok(!foot.querySelector(".slate-recipe__bulk-note").hasAttribute("hidden"));
  assert.equal(committed.length, 0);
  click(foot.querySelector("[data-slate-bulk-do='apply']"));
  assert.equal(commands.calls.length, 2);
  assert.equal(view.bulk(), null);
  assert.equal(committed.length, 1);
});

test("Cancel arms while there are changes and disarms after a moment; a second press or a second Escape discards and says what was lost; Escape closes an open list first", () => {
  const { view, commands, timers, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  typedInto(field(view, "A2", "pct"), "35");
  typedInto(field(view, "A3", "pct"), "20");
  const cancel = bulkFoot(view).querySelector("[data-slate-bulk-do='cancel']");
  click(cancel);
  assert.ok(view.bulk().armed);
  assert.equal(cancel.textContent, "Discard 2 changes");
  timers.advance(recipe.RESET_ARM_MS);
  assert.ok(!view.bulk().armed);
  assert.equal(cancel.textContent, "Cancel");
  assert.ok(view.bulk());
  // Escape arms it too, and the bar button does the same as Cancel.
  key(field(view, "A2", "pct"), "Escape");
  assert.ok(view.bulk().armed);
  click(bulkButton(view));
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], "The bulk edit was closed; 2 changes were not applied.");
  assert.equal(commands.calls.length, 0);
  assert.equal(timers.pending(), 0);
  // With a list open, Escape closes the list and nothing arms.
  click(bulkButton(view));
  const resin = field(view, "A4", "resin");
  typedInto(resin, "ll");
  key(resin, "Escape");
  assert.ok(!view.bulk().armed, "Escape on an open list armed Cancel");
  key(resin, "Escape");
  assert.ok(view.bulk().armed);
  key(resin, "Escape");
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], "The bulk edit was closed; 1 change was not applied.");
});

test("a layer whose hoppers 2-6 would exceed 100 is said on its head and withholds Apply until it is put right", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  typedInto(field(view, "B3", "pct"), "90");
  const note = head(view, "B").querySelector(".slate-layer__note");
  assert.equal(note.textContent, "Hopper percentages 2–6 cannot total more than 100%.");
  assert.ok(!note.hasAttribute("hidden"));
  assert.ok(head(view, "B").classList.contains("is-over"));
  assert.equal(field(view, "B1", "h1").textContent, "—");
  const apply = bulkFoot(view).querySelector("[data-slate-bulk-do='apply']");
  assert.equal(apply.getAttribute("data-able"), "false");
  assert.match(apply.getAttribute("title"), /cannot total more than 100/);
  click(apply);
  assert.equal(commands.calls.length, 0);
  typedInto(field(view, "B3", "pct"), "70");
  assert.ok(note.hasAttribute("hidden"));
  assert.ok(!head(view, "B").classList.contains("is-over"));
  assert.equal(field(view, "B1", "h1").textContent, "10%");
  assert.equal(apply.getAttribute("data-able"), "true");
});

test("a values publish under the form: our own echo is silent; another device's change marks the row, keeps the field, and rebases its diff; a structural publish abandons the form", () => {
  const { view, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  typedInto(field(view, "A2", "resin"), "LL318");
  typedInto(field(view, "B2", "pct"), "25");
  // Our own: nothing marked.
  view.update(resolvedFrom(snap => { snap.layers[2].hoppers[1].pct = 25; }), { kind: "values", own: true });
  assert.ok(!row(view, "A2").classList.contains("is-changed-underneath"));
  assert.ok(!row(view, "C2").classList.contains("is-changed-underneath"));
  assert.equal(said.length, 0);
  // Another device set A2 to what was typed: marked, and no longer a change.
  view.update(resolvedFrom(snap => { snap.layers[2].hoppers[1].pct = 25; snap.layers[0].hoppers[1].resinName = "LL318"; }), { kind: "values" });
  assert.ok(row(view, "A2").classList.contains("is-changed-underneath"));
  assert.match(row(view, "A2").querySelector(".slate-hopper__note").textContent, /^A2 changed in the application/);
  assert.equal(field(view, "A2", "resin").value, "LL318");
  assert.equal(view.bulk().changes, 1);
  assert.ok(!row(view, "A2").classList.contains("is-updated"), "a drafted row flashed");
  assert.equal(row(view, "A2").querySelector(".slate-hopper__resin").textContent, "LD105", "a hidden cell was rewritten under the form");
  // Structural: gone, and said.
  view.update(resolvedFrom(snap => { snap.layers.pop(); }), { kind: "structural" });
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], recipe.BULK_ABANDONED);
  click(bulkButton(view));
  typedInto(field(view, "A2", "pct"), "35");
  const heard = said.length;
  view.update(resolvedFrom(), { kind: "structural", own: true });
  assert.equal(view.bulk(), null);
  assert.equal(said.length, heard, "our own structural publish was said");
});

test("read-only turning on, or the bridge going away, closes the form and says so; without the command Bulk edit is unable with the reason", () => {
  const { view, said, setReadOnly } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  typedInto(field(view, "A2", "pct"), "35");
  setReadOnly(true);
  view.refresh();
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], recipe.BULK_READ_ONLY);
  assert.equal(bulkButton(view).getAttribute("data-able"), "false");
  assert.match(bulkButton(view).getAttribute("title"), /read-only/);
  setReadOnly(false);
  view.refresh();
  assert.equal(bulkButton(view).getAttribute("data-able"), "true");

  const settings = { capabilities: ALL, available: true };
  const commands = makeCommands(settings);
  const lost = boot({ commands });
  lost.view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(lost.view));
  settings.available = false;
  lost.view.refresh();
  assert.equal(lost.view.bulk(), null);
  assert.equal(lost.said[lost.said.length - 1], recipe.BULK_NO_BRIDGE);

  const partial = boot({ commands: makeCommands({ capabilities: ALL.filter(name => name !== "setHopperAssignments") }) });
  partial.view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(bulkButton(partial.view).getAttribute("data-able"), "false");
  click(bulkButton(partial.view));
  assert.equal(partial.view.bulk(), null);
  assert.match(partial.said[partial.said.length - 1], /does not offer setHopperAssignments/);
});

test("a tab switch is refused while the form holds changes and closes it otherwise; hiding the section discards and says; the Next tab's form names the plan and needs one", () => {
  const { view, commands, said } = boot();
  view.update(withPlan(), { kind: "structural" });
  click(bulkButton(view));
  typedInto(field(view, "A2", "pct"), "35");
  assert.equal(view.setRecipe("next"), "current");
  assert.equal(said[said.length - 1], recipe.BULK_SWITCH);
  assert.ok(view.bulk());
  typedInto(field(view, "A2", "pct"), "30");
  assert.equal(view.bulk().changes, 0);
  assert.equal(view.setRecipe("next"), "next");
  assert.equal(view.bulk(), null);
  // Next: the plan's rows, the plan named.
  click(bulkButton(view));
  assert.deepEqual(view.bulk(), { recipe: "next", changes: 0, armed: false, picked: [], auto: false });
  assert.equal(row(view, "A2", "next").querySelector(".slate-hopper__draft-pct").value, "30");
  typedInto(row(view, "A3", "next").querySelector(".slate-hopper__draft-resin"), "HX204");
  assert.ok(view.element.querySelector(".slate-recipe__plan").hasAttribute("hidden"), "the plan strip stayed under the form");
  click(bulkFoot(view, "next").querySelector("[data-slate-bulk-do='apply']"));
  assert.deepEqual(commands.calls, [{ command: "setHopperAssignments", args: { recipe: "next", hoppers: [{ layer: "A", index: 2, resin: "HX204" }] } }]);
  assert.ok(!view.element.querySelector(".slate-recipe__plan").hasAttribute("hidden"));
  // Hide: discarded, said.
  click(bulkButton(view));
  typedInto(row(view, "A2", "next").querySelector(".slate-hopper__draft-pct"), "35");
  view.onHide();
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], "The bulk edit was closed; 1 change was not applied.");
  // Without a plan there is nothing to edit on Next.
  view.update(resolvedFrom(), { kind: "structural" });
  view.setRecipe("next");
  assert.equal(bulkButton(view).getAttribute("data-able"), "false");
  assert.match(bulkButton(view).getAttribute("title"), /Nothing is planned/);
  click(bulkButton(view));
  assert.equal(view.bulk(), null);
});

test("under the form a hopper id picks its row, Shift picks a run within the layer, the layer's name picks the layer; the fill strip shows for a selection and Clear selection empties it", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  const foot = bulkFoot(view);
  const strip = foot.querySelector(".slate-recipe__fill");
  assert.ok(strip.hasAttribute("hidden"));
  assert.ok(!foot.querySelector(".slate-recipe__bulk-hint").hasAttribute("hidden"));
  click(row(view, "A2").querySelector(".slate-hopper__id"));
  assert.deepEqual(view.bulk().picked, ["A:1"]);
  assert.ok(row(view, "A2").classList.contains("is-picked"));
  assert.ok(!strip.hasAttribute("hidden"));
  assert.ok(foot.querySelector(".slate-recipe__bulk-hint").hasAttribute("hidden"));
  assert.equal(strip.querySelector(".slate-recipe__fill-count").textContent, "1 selected");
  click(row(view, "A5").querySelector(".slate-hopper__id"), { shiftKey: true });
  assert.deepEqual(view.bulk().picked.sort(), ["A:1", "A:2", "A:3", "A:4"]);
  assert.equal(strip.querySelector(".slate-recipe__fill-count").textContent, "4 selected");
  click(row(view, "A2").querySelector(".slate-hopper__id"));
  assert.deepEqual(view.bulk().picked.sort(), ["A:2", "A:3", "A:4"]);
  // A Shift run into another layer is a plain pick there.
  click(row(view, "B3").querySelector(".slate-hopper__id"), { shiftKey: true });
  assert.ok(view.bulk().picked.includes("B:2"));
  assert.equal(view.bulk().picked.length, 4);
  click(head(view, "C").querySelector(".slate-layer__name"));
  assert.deepEqual(view.bulk().picked.filter(key => key.startsWith("C")).sort(), ["C:0", "C:1", "C:2", "C:3", "C:4", "C:5"]);
  click(head(view, "C").querySelector(".slate-layer__name"));
  assert.equal(view.bulk().picked.filter(key => key.startsWith("C")).length, 0);
  click(strip.querySelector("[data-slate-fill='clear']"));
  assert.deepEqual(view.bulk().picked, []);
  assert.ok(strip.hasAttribute("hidden"));
  assert.equal(commands.calls.length, 0, "picking dispatched");
  // Ids do nothing outside the form.
  click(bulkFoot(view).querySelector("[data-slate-bulk-do='cancel']"));
  assert.equal(view.bulk(), null);
  click(row(view, "A2").querySelector(".slate-hopper__id"));
  assert.ok(!row(view, "A2").classList.contains("is-picked"));
});

test("Fill writes one resin and/or one blend into every picked row's fields - blank means no change there, H1 takes the resin only - and it is still the draft: one Apply, one command", () => {
  const { view, commands, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  const strip = bulkFoot(view).querySelector(".slate-recipe__fill");
  for (const id of ["A1", "A3", "A4", "A5"]) click(row(view, id).querySelector(".slate-hopper__id"));
  // Nothing entered: said, nothing moved.
  click(strip.querySelector("[data-slate-fill='fill']"));
  assert.equal(said[said.length - 1], recipe.FILL_NOTHING);
  assert.equal(view.bulk().changes, 0);
  // A resin alone: the blends stay as they were.
  typedInto(strip.querySelector(".slate-recipe__fill-resin"), "ll");
  key(strip.querySelector(".slate-recipe__fill-resin"), "Enter");     // takes the suggestion
  assert.equal(strip.querySelector(".slate-recipe__fill-resin").value, "LL318");
  assert.equal(view.bulk().changes, 0, "taking a suggestion filled");
  key(strip.querySelector(".slate-recipe__fill-resin"), "Enter");     // fills
  assert.equal(field(view, "A1", "resin").value, "LL318");
  assert.equal(field(view, "A3", "resin").value, "LL318");
  assert.equal(field(view, "A3", "pct").value, "10", "a resin fill moved a blend");
  assert.equal(field(view, "A2", "resin").value, "LD105", "an unpicked row was filled");
  assert.equal(view.bulk().changes, 4);
  assert.deepEqual(view.bulk().picked.length, 4, "the fill emptied the selection");
  // A blend alone, with a bad number first.
  typedInto(strip.querySelector(".slate-recipe__fill-resin"), "");
  typedInto(strip.querySelector(".slate-recipe__fill-pct"), "ten");
  click(strip.querySelector("[data-slate-fill='fill']"));
  assert.equal(strip.querySelector(".slate-recipe__fill-pct").getAttribute("aria-invalid"), "true");
  assert.equal(field(view, "A3", "pct").value, "10");
  typedInto(strip.querySelector(".slate-recipe__fill-pct"), "20");
  click(strip.querySelector("[data-slate-fill='fill']"));
  assert.equal(strip.querySelector(".slate-recipe__fill-pct").getAttribute("aria-invalid"), null);
  assert.equal(field(view, "A3", "pct").value, "20");
  assert.equal(field(view, "A4", "pct").value, "20");
  assert.equal(field(view, "A5", "pct").value, "20");
  assert.equal(field(view, "A1", "h1").textContent, "10%", "H1's preview did not follow the fill");
  // Only H1 picked for a blend: nothing to fill, said.
  click(strip.querySelector("[data-slate-fill='clear']"));
  click(row(view, "B1").querySelector(".slate-hopper__id"));
  click(strip.querySelector("[data-slate-fill='fill']"));
  assert.equal(said[said.length - 1], recipe.FILL_NONE);
  // Apply: one command carrying the filled rows.
  click(bulkFoot(view).querySelector("[data-slate-bulk-do='apply']"));
  assert.equal(commands.calls.length, 1);
  assert.equal(commands.calls[0].command, "setHopperAssignments");
  assert.deepEqual(commands.calls[0].args.hoppers, [
    { layer: "A", index: 0, resin: "LL318" },
    { layer: "A", index: 2, resin: "LL318", pct: 20 },
    { layer: "A", index: 3, resin: "LL318", pct: 20 },
    { layer: "A", index: 4, resin: "LL318", pct: 20 }
  ]);
  assert.equal(view.bulk(), null);
});

/* ----------------------------------------------------------------------
 *   Under a finger (the touch tier)
 * -------------------------------------------------------------------- */

test("under a finger the blend field carries a Cancel that wins over the blur: pressed, then blurred, then clicked - nothing is sent", () => {
  const { view, commands } = boot({ touch: true });
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  click(a2.querySelector(".slate-hopper__pct"));
  const input = a2.querySelector(".slate-hopper__input");
  const wrap = a2.querySelector(".slate-editor-field");
  assert.ok(wrap && input.parentNode === wrap, "the field and its Cancel do not stand together");
  const cancel = wrap.querySelector("[data-slate-cancel]");
  assert.ok(cancel);
  input.value = "45";
  const press = { type: "pointerdown", pointerType: "touch", _defaultPrevented: false, preventDefault() { this._defaultPrevented = true; } };
  for (const handler of cancel.listeners.pointerdown) handler(press);
  assert.equal(press._defaultPrevented, true);
  input.dispatchEvent({ type: "blur" });
  click(cancel);
  assert.deepEqual(commands.calls, [], "Cancel under a finger dispatched the draft");
  assert.equal(view.editing(), null);
  assert.equal(a2.querySelector(".slate-editor-field"), null, "the field's wrapper was left behind");

  // A blur without Cancel still commits, as with a mouse.
  click(a2.querySelector(".slate-hopper__pct"));
  a2.querySelector(".slate-hopper__input").value = "45";
  a2.querySelector(".slate-hopper__input").dispatchEvent({ type: "blur" });
  assert.equal(commands.calls.length, 1);
  assert.equal(commands.calls[0].command, "setHopperBlend");
});

test("with a mouse the blend field stands alone, as before: no wrapper, no Cancel", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  click(a2.querySelector(".slate-hopper__pct"));
  assert.equal(a2.querySelector(".slate-editor-field"), null);
  assert.equal(a2.querySelector("[data-slate-cancel]"), null);
  assert.ok(a2.querySelector(".slate-hopper__input").parentNode === a2);
});

test("under a finger the resin search opens with the touch rules, and a blur leaves the edit open", () => {
  const { view, commands } = boot({ touch: true });
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  click(a2.querySelector(".slate-hopper__resin"));
  const input = a2.querySelector(".slate-combobox__input");
  assert.ok(input);
  assert.ok(a2.querySelector(".slate-combobox [data-slate-cancel]"), "the touch search has no Cancel");
  input.dispatchEvent({ type: "blur", relatedTarget: null });
  assert.ok(view.editing(), "the keyboard's hide key ended the edit");
  click(a2.querySelector(".slate-combobox [data-slate-cancel]"));
  assert.equal(view.editing(), null);
  assert.deepEqual(commands.calls, []);
});

test("Bulk edit focuses its first field with a mouse, and none under a finger - the keyboard would cover the form's foot", () => {
  const mouse = boot();
  mouse.view.update(withPlan(), { kind: "structural" });
  click(bulkButton(mouse.view));
  const firstMouse = mouse.view.element.querySelector(".slate-recipe__body[data-recipe='current'] [data-slate-draft='resin']");
  assert.equal(firstMouse.focused, true, "the mouse form lost its first-field focus");

  const finger = boot({ touch: true });
  finger.view.update(withPlan(), { kind: "structural" });
  click(bulkButton(finger.view));
  assert.ok(finger.view.bulk(), "the form did not open under a finger");
  const drafts = finger.view.element.querySelectorAll("[data-slate-draft]");
  assert.ok(drafts.length > 0);
  assert.ok(drafts.every(one => !one.focused), "a touch form focused a field on open");
  assert.equal(drafts.find(one => one.getAttribute("data-slate-draft") === "resin").getAttribute("enterkeyhint"), "next");
});

test("an abandoned Cancel press under a finger is forgotten once the blend field is taken again", () => {
  const { view, commands } = boot({ touch: true });
  view.update(resolvedFrom(), { kind: "structural" });
  const a2 = row(view, "A2");
  click(a2.querySelector(".slate-hopper__pct"));
  const input = a2.querySelector(".slate-hopper__input");
  const cancel = a2.querySelector("[data-slate-cancel]");
  input.value = "45";
  for (const handler of cancel.listeners.pointerdown) handler({ type: "pointerdown", pointerType: "touch", preventDefault() {} });
  input.dispatchEvent({ type: "blur" });
  assert.deepEqual(commands.calls, []);
  input.dispatchEvent({ type: "focus" });
  input.dispatchEvent({ type: "blur" });
  assert.equal(commands.calls.length, 1);
});

test("a badge carries data-movable exactly while its row may be dragged, so only those hold the page still under a finger", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1").querySelector(".slate-hopper__id");
  assert.equal(row(view, "A1").classList.contains("is-movable"), a1.hasAttribute("data-movable"));
  assert.ok(a1.hasAttribute("data-movable"), "an assigned row's badge is not movable");
  const readOnly = boot({ readOnly: true });
  readOnly.view.update(resolvedFrom(), { kind: "structural" });
  assert.ok(!row(readOnly.view, "A1").querySelector(".slate-hopper__id").hasAttribute("data-movable"), "a read-only badge would still hold the page");
});

/* ----------------------------------------------------------------------
 *   Scan (Print's place under a finger)
 * -------------------------------------------------------------------- */

function makeScanner(ready) {
  const started = [];
  return { started, able: () => (ready === false ? { ok: false, reason: "connect this device to a line (RT Sync) to scan" } : { ok: true }), start: (kind, recipe) => started.push([kind, recipe]) };
}
const scanItem = (view, kind) => view.element.querySelector(`.slate-scan__menu [data-scan='${kind}']`);

test("Scan offers the job traveler and the dosing screen, and starts the application's scan for the tab on screen", () => {
  const scanner = makeScanner(true);
  const { view } = boot({ scan: scanner });
  view.update(withPlan(), { kind: "structural" });
  const kinds = view.element.querySelectorAll(".slate-scan__menu [data-scan]").map(one => [one.getAttribute("data-scan"), one.textContent]);
  assert.deepEqual(kinds, [["job_traveler", "Job traveler"], ["dosing_screen", "Dosing screen"]]);
  click(view.element.querySelector(".slate-scan__trigger"));
  assert.ok(!view.element.querySelector(".slate-scan__menu").hasAttribute("hidden"));
  click(scanItem(view, "dosing_screen"));
  assert.deepEqual(scanner.started, [["dosing_screen", "current"]]);
  assert.ok(view.element.querySelector(".slate-scan__menu").hasAttribute("hidden"), "the menu stayed open over the scan");
  click(view.element.querySelectorAll(".slate-tabs__tab")[1]);
  click(view.element.querySelector(".slate-scan__trigger"));
  assert.match(scanItem(view, "job_traveler").getAttribute("title"), /Next/);
  click(scanItem(view, "job_traveler"));
  assert.deepEqual(scanner.started[1], ["job_traveler", "next"]);
});

test("Scan is unavailable - and says why on a tap - without a connected line, while read-only, or with no scanner on the page", () => {
  const offline = makeScanner(false);
  const one = boot({ scan: offline });
  one.view.update(resolvedFrom(), { kind: "structural" });
  const item = scanItem(one.view, "job_traveler");
  assert.equal(item.getAttribute("aria-disabled"), "true");
  click(item);
  assert.deepEqual(offline.started, []);
  assert.match(one.said[one.said.length - 1], /RT Sync/);

  const locked = makeScanner(true);
  const two = boot({ scan: locked, readOnly: true });
  two.view.update(resolvedFrom(), { kind: "structural" });
  click(scanItem(two.view, "dosing_screen"));
  assert.deepEqual(locked.started, [], "a read-only Slate started a scan that writes the recipe");
  assert.equal(scanItem(two.view, "dosing_screen").getAttribute("aria-disabled"), "true");

  const none = boot();
  none.view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(scanItem(none.view, "job_traveler").getAttribute("aria-disabled"), "true");
  assert.match(scanItem(none.view, "job_traveler").getAttribute("title"), /not on this page/);
});

test("the sheets give a finger Scan and a mouse Print: each hidden where the other stands", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/recipe-edit.css"), "utf8");
  assert.match(css, /\n\.slate-scan \{\s*display: none;/);
  assert.match(css, /\.slate-root\[data-input="touch"\] \.slate-print \{\s*display: none;/);
  assert.match(css, /\.slate-root\[data-input="touch"\] \.slate-scan \{[^}]*display: block;/);
});

/* ----------------------------------------------------------------------
 *   A phone: the recipe as a grid of cells
 * -------------------------------------------------------------------- */

test("on a phone a tap anywhere on a Current cell is its Track - one command, as its toggle's - and a cell whose Track is withheld, or on Next, sends nothing; no cell opens an editor", () => {
  const { view, commands } = boot({ phone: true });
  view.update(withPlan(), { kind: "structural" });
  // The resin and the blend are the cell, not editors.
  click(row(view, "A1").querySelector(".slate-hopper__resin"));
  assert.deepEqual(commands.calls, [{ command: "setHopperTracking", args: { recipe: "current", layer: "A", index: 0, track: false } }]);
  assert.equal(view.element.querySelectorAll(".slate-hopper__input, .slate-combobox__input").length, 0, "a cell opened an editor");
  click(row(view, "B2").querySelector(".slate-hopper__pct"));
  click(row(view, "B2"));
  assert.equal(commands.calls.length, 3);
  assert.ok(commands.calls.every(call => call.command === "setHopperTracking"));
  // Track not offered there (Assisted, a plan that keeps the resin): the tap is nothing.
  const kept = row(view, "C1");
  assert.ok(kept.querySelector("[data-slate-control='tracking']").hasAttribute("hidden"));
  click(kept);
  assert.equal(commands.calls.length, 3);
  // The plan's cells track nothing.
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  click(row(view, "A1", "next"));
  click(row(view, "A1", "next").querySelector(".slate-hopper__resin"));
  assert.equal(commands.calls.length, 3);
  // The layer's share keeps its editor.
  click(head(view, "B", "next").querySelector(".slate-layer__share"));
  assert.ok(head(view, "B", "next").querySelector(".slate-layer__input"), "the share's editor did not open");
});

test("on a phone the layer's name keeps its letter apart from the word, and the section says how many layers stand side by side", () => {
  const { view } = boot({ phone: true });
  view.update(resolvedFrom(), { kind: "structural" });
  const name = head(view, "A").querySelector(".slate-layer__name");
  assert.equal(name.textContent, "Layer A");
  assert.equal(name.querySelector(".slate-layer__word").textContent, "Layer ");
  assert.equal(view.body("current").querySelector(".slate-recipe__layers").style.getPropertyValue("--slate-layers"), "3");
});

test("on a phone Bulk edit picks a whole cell - its drafts are values there, not fields to tap - and says so in its hint; the layer's name still picks the layer", () => {
  const { view, commands } = boot({ phone: true });
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(view));
  assert.match(bulkFoot(view).querySelector(".slate-recipe__bulk-hint").textContent, /^Tap hoppers/);
  click(row(view, "A2"));
  click(row(view, "B3").querySelector(".slate-hopper__weight"));
  assert.deepEqual(view.bulk().picked.sort(), ["A:1", "B:2"]);
  click(row(view, "A2"));
  assert.deepEqual(view.bulk().picked, ["B:2"]);
  click(head(view, "C").querySelector(".slate-layer__name"));
  assert.equal(view.bulk().picked.filter(key => key.startsWith("C")).length, 6);
  assert.equal(commands.calls.length, 0, "a pick tracked or dispatched");
  // With a mouse the hint is the id's, as before.
  const mouse = boot();
  mouse.view.update(resolvedFrom(), { kind: "structural" });
  click(bulkButton(mouse.view));
  assert.match(bulkFoot(mouse.view).querySelector(".slate-recipe__bulk-hint").textContent, /^Click a hopper id/);
});

test("on a phone turning to the other tab lets its cells rise again; with a mouse nothing replays", () => {
  const { view } = boot({ phone: true });
  view.update(withPlan(), { kind: "structural" });
  for (const one of view.body("next").querySelectorAll(".slate-hopper")) one.classList.remove("slate-row-enter");
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  assert.ok(view.body("next").querySelectorAll(".slate-hopper").every(one => one.classList.contains("slate-row-enter")));
  const mouse = boot();
  mouse.view.update(withPlan(), { kind: "structural" });
  for (const one of mouse.view.body("next").querySelectorAll(".slate-hopper")) one.classList.remove("slate-row-enter");
  click(mouse.view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  assert.ok(mouse.view.body("next").querySelectorAll(".slate-hopper").every(one => !one.classList.contains("slate-row-enter")));
});

test("the section says how many rows the layers share - the deepest layer's - for the Grid layout's columns, with a mouse too", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const layers = view.body("current").querySelector(".slate-recipe__layers");
  assert.equal(layers.style.getPropertyValue("--slate-layers"), "3");
  assert.equal(layers.style.getPropertyValue("--slate-hopper-rows"), "6", "layer B has four hoppers; the rows are the deepest layer's");
  assert.equal(row(view, "A3").style.getPropertyValue("--slate-hopper-slot"), "2");
});

test("on a phone a cell holds the hopper, its blend and its resin; Compare adds the resin it becomes where the resin changes (on Next, the one it replaces); a position empty in every layer and both recipes is left out, except under Bulk edit", () => {
  const { view } = boot({ phone: true });
  view.update(planWithChanges(), { kind: "structural" });
  const next = (id, which) => row(view, id, which).querySelector(".slate-hopper__next");
  assert.equal(view.element.querySelectorAll(".slate-hopper__pct-to, .slate-hopper__delta").length, 0);
  // Without Compare, nothing but the recipe.
  assert.ok(next("A1").hasAttribute("hidden"));
  click(view.element.querySelector("[data-slate-compare]"));
  // The resin it becomes, and its blend (the Grid layout shows it; a phone's sheet leaves it out).
  assert.equal(next("A1").querySelector(".slate-hopper__next-resin").textContent, "ZZ1");
  assert.equal(next("A1").querySelector(".slate-hopper__next-pct").textContent, "60%");
  assert.equal(next("A1").getAttribute("data-way"), "to");
  assert.ok(next("A2").hasAttribute("hidden"), "an agreeing hopper got a band");
  assert.ok(next("A3").hasAttribute("hidden"), "a blend-only change got a band");
  assert.equal(next("B3").textContent, "—", "a hopper the plan empties");
  assert.equal(next("B3").querySelector(".slate-hopper__next-pct"), null, "an emptied hopper has no blend to show");
  // The line under a row says a resin change too; the Grid layout leaves that to the band.
  assert.equal(row(view, "A1").querySelector(".slate-hopper__other").getAttribute("data-change"), "resin");
  assert.equal(row(view, "A3").querySelector(".slate-hopper__other").getAttribute("data-change"), null, "a blend-only line was marked a resin change");
  // The line's word apart from its value, and which way it runs, for the Left layout's column to show an arrow.
  const line = row(view, "A1").querySelector(".slate-hopper__other");
  assert.equal(line.querySelector(".slate-hopper__other-tag").textContent, "Next: ");
  assert.equal(line.getAttribute("data-way"), "to");
  // A cell that says what moves is marked, for the Grid layout to put it in the weight's place.
  assert.ok(row(view, "A1").classList.contains("is-comparing") && row(view, "A3").classList.contains("is-comparing"));
  assert.ok(!row(view, "A2").classList.contains("is-comparing"), "an agreeing hopper was marked");
  // Track is named on the button itself, so the Grid can fold its word away.
  assert.equal(row(view, "A1").querySelector("[data-slate-control='tracking']").getAttribute("aria-label"), "Track A1");
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  assert.equal(next("A1", "next").getAttribute("data-way"), "from");
  click(view.element.querySelector("[data-slate-compare]"));
  assert.ok(next("A1", "next").hasAttribute("hidden"));
  // Vacant: a position empty in every layer, in both recipes (the demo line's fifth and sixth; layer B has four).
  const vacant = which => view.body(which).querySelectorAll(".slate-hopper.is-vacant").map(one => one.getAttribute("data-hopper")).sort();
  assert.deepEqual(vacant("current"), ["A5", "A6", "C5", "C6"]);
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='current']"));
  click(bulkButton(view));
  assert.deepEqual(vacant("current"), []);
  click(bulkFoot(view).querySelector("[data-slate-bulk-do='cancel']"));
  assert.deepEqual(vacant("current"), ["A5", "A6", "C5", "C6"]);
});

/* ----------------------------------------------------------------------
 *   A desktop's Recipe: always a draft, always comparing
 * -------------------------------------------------------------------- */

const draftResin = (view, id, which) => row(view, id, which).querySelector(".slate-hopper__draft-resin");
const grip = (view, id, which) => row(view, id, which).querySelector(".slate-hopper__grip");
const bulkFootOf = (view, which) => view.element.querySelector(`.slate-recipe__body[data-recipe='${which || "current"}'] .slate-recipe__bulk-foot`);
const planWithA2 = code => withPlan(snap => { snap.nextRecipe.layers[0].hoppers[1].resinName = code; });

test("a desktop: the shown tab is always a draft - no focus taken - with the fill bar up under the layers, the foot still below, Cancel only with changes, and Compare on with no switch", () => {
  const { view, commands } = boot({ desktop: true, recipes: makeRecipes() });
  view.update(planWithA2("ZZ999"), { kind: "structural" });
  const bulk = view.bulk();
  assert.ok(bulk && bulk.auto && bulk.recipe === "current", "the desktop's tab is not a draft");
  assert.notEqual(draftResin(view, "A1").focused, true, "the draft took the focus on a publish");
  assert.ok(view.element.classList.contains("is-desk"));
  const foot = bulkFootOf(view);
  assert.ok(!foot.hasAttribute("hidden"));
  assert.ok(!plainFoot(view).hasAttribute("hidden"), "the Book / Reset foot went with the draft");
  const children = view.body("current").children;
  assert.ok(children.indexOf(foot) < children.indexOf(plainFoot(view)), "the fill bar is not under the layers, ahead of the foot");
  const fill = foot.querySelector(".slate-recipe__fill");
  assert.ok(!fill.hasAttribute("hidden"), "the fill bar waits for a pick");
  assert.equal(fill.querySelector(".slate-recipe__fill-count").textContent, recipe.NONE_PICKED);
  assert.equal(foot.querySelector(".slate-recipe__bulk-summary").textContent, recipe.DRAFT_IDLE);
  assert.ok(foot.querySelector("[data-slate-bulk-do='cancel']").hasAttribute("hidden"));
  // Compare: on with a plan, the band over the draft where the resin changes.
  assert.equal(view.getCompare(), false, "the switch's own state moved");
  assert.ok(view.element.classList.contains("is-comparing"));
  assert.ok(!row(view, "A2").querySelector(".slate-hopper__next").hasAttribute("hidden"), "Compare's band stepped aside for the draft");
  assert.ok(row(view, "A1").querySelector(".slate-hopper__next").hasAttribute("hidden"));
  typedInto(draftResin(view, "A1"), "HX999");
  assert.equal(view.bulk().changes, 1);
  assert.ok(!foot.querySelector("[data-slate-bulk-do='cancel']").hasAttribute("hidden"));
  assert.equal(commands.calls.length, 0);
});

test("a desktop: the badge picks for the fill and the grab strip lifts; with changes waiting a drag, a share, the plan's moves and a tab switch wait, and they free again when the change is put back", () => {
  const { view, said } = boot({ desktop: true, recipes: makeRecipes() });
  view.update(planWithA2("ZZ999"), { kind: "structural" });
  assert.equal(row(view, "A1").querySelector(".slate-hopper__id").hasAttribute("data-slate-handle"), false, "the badge still lifts");
  assert.equal(grip(view, "A1").hasAttribute("data-slate-handle"), true);
  click(row(view, "A1").querySelector(".slate-hopper__id"));
  click(row(view, "A3").querySelector(".slate-hopper__id"), { shiftKey: true });
  assert.deepEqual(view.bulk().picked, ["A:0", "A:1", "A:2"]);
  assert.ok(row(view, "A1").classList.contains("is-movable"), "an idle draft holds the drag");
  const share = head(view, "A").querySelector("[data-slate-edit='share']");
  assert.equal(share.getAttribute("data-able"), "true", "an idle draft holds the share");

  typedInto(draftResin(view, "A1"), "HX999");
  assert.ok(!row(view, "A1").classList.contains("is-movable"), "a drag is offered over waiting changes");
  assert.equal(share.getAttribute("data-able"), "false");
  assert.match(share.getAttribute("title"), /Apply or discard the recipe changes first/);
  const promote = view.element.querySelector(".slate-recipe__plan [data-slate-plan='promote']");
  assert.equal(promote.getAttribute("data-able"), "false");
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  assert.equal(view.getRecipe(), "current", "the tab turned over waiting changes");
  assert.equal(said[said.length - 1], recipe.BULK_SWITCH);

  typedInto(draftResin(view, "A1"), "HX204");
  assert.equal(view.bulk().changes, 0);
  assert.ok(row(view, "A1").classList.contains("is-movable"));
  assert.equal(share.getAttribute("data-able"), "true");
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  assert.equal(view.getRecipe(), "next");
  assert.ok(view.bulk() && view.bulk().auto && view.bulk().recipe === "next", "Next is not a draft");
});

test("a desktop: Apply sends ONE setHopperAssignments and the tab is a fresh draft; Cancel arms and discards into a fresh draft", () => {
  const { view, commands, said, timers } = boot({ desktop: true });
  view.update(withPlan(), { kind: "structural" });
  typedInto(draftResin(view, "A2"), "LD999");
  click(bulkFootOf(view).querySelector("[data-slate-bulk-do='apply']"));
  assert.equal(commands.calls.length, 1);
  assert.equal(commands.calls[0].command, "setHopperAssignments");
  assert.deepEqual(commands.calls[0].args, { recipe: "current", hoppers: [{ layer: "A", index: 1, resin: "LD999" }] });
  assert.ok(view.bulk() && view.bulk().auto && view.bulk().changes === 0, "Apply left no draft behind");
  typedInto(draftResin(view, "A3"), "AB999");
  click(bulkFootOf(view).querySelector("[data-slate-bulk-do='cancel']"));
  assert.ok(view.bulk().armed);
  click(bulkFootOf(view).querySelector("[data-slate-bulk-do='cancel']"));
  assert.equal(said[said.length - 1], "The bulk edit was closed; 1 change was not applied.");
  assert.ok(view.bulk() && view.bulk().changes === 0);
  assert.equal(draftResin(view, "A3").value, "AB120");
  assert.equal(commands.calls.length, 1);
  timers.advance(10000);
});

test("a desktop: a publish reaches every field not typed in and marks one that is; a structural publish leaves a fresh draft; a finger closes it and gives the badge back", () => {
  let input = "pointer";
  const { view, said } = boot({ desktop: () => input === "pointer", tier: () => ({ input, width: "wide" }) });
  view.update(withPlan(), { kind: "structural" });
  typedInto(draftResin(view, "A1"), "HX999");
  view.update(withPlan(snap => { snap.layers[0].hoppers[1].resinName = "LD777"; snap.layers[0].hoppers[0].resinName = "HX777"; }), { kind: "values" });
  assert.equal(draftResin(view, "A2").value, "LD777", "an untouched field did not follow the line");
  assert.equal(draftResin(view, "A1").value, "HX999", "a typed field was overwritten");
  assert.ok(row(view, "A1").classList.contains("is-changed-underneath"));
  assert.equal(view.bulk().changes, 1);
  view.update(withPlan(), { kind: "structural" });
  assert.equal(said[said.length - 1], recipe.BULK_ABANDONED);
  assert.ok(view.bulk() && view.bulk().auto && view.bulk().changes === 0);
  input = "touch";
  view.refresh();
  assert.equal(view.bulk(), null, "the desktop's draft stayed under a finger");
  assert.ok(!view.element.classList.contains("is-desk"));
  assert.equal(row(view, "A1").querySelector(".slate-hopper__id").hasAttribute("data-slate-handle"), true);
  input = "pointer";
  view.refresh();
  assert.ok(view.bulk() && view.bulk().auto);
});

test("a desktop without the command or read-only is no draft; the sheets set the switches and the weight aside and draw the grab strip only there", () => {
  const { view, setReadOnly } = boot({ desktop: true, readOnly: true });
  view.update(withPlan(), { kind: "structural" });
  assert.equal(view.bulk(), null, "a read-only desktop opened a draft");
  setReadOnly(false);
  view.refresh();
  assert.ok(view.bulk() && view.bulk().auto);
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/recipe.css"), "utf8");
  assert.match(css, /\.slate-recipe\.is-desk \.slate-recipe__bulk,\s*\.slate-recipe\.is-desk \.slate-recipe__compare \{\s*display: none;/);
  assert.match(css, /\.slate-recipe\.is-desk \.slate-hopper__weight \{\s*visibility: hidden;/);
  assert.match(css, /\n\.slate-hopper__grip \{\s*display: none;/);
  assert.match(css, /\.slate-recipe\.is-desk \.slate-hopper__grip \{[^}]*grid-area: grip;/);
  assert.match(css, /"note note"\s*"grip grip";/);
});

test("a desktop's layer menu waits only while the draft has changes; a Next cell keeps an empty weight line so it stands as tall as a Current one", () => {
  const { view } = boot({ desktop: true });
  view.update(withPlan(), { kind: "structural" });
  const clearItem = head(view, "A").querySelector("[data-menu-clear]");
  assert.ok(clearItem, "no layer menu");
  assert.equal(clearItem.getAttribute("aria-disabled"), "false", "an idle draft withholds the layer menu");
  typedInto(draftResin(view, "A1"), "HX999");
  assert.equal(clearItem.getAttribute("aria-disabled"), "true", "the layer menu is offered over waiting changes");
  assert.match(clearItem.getAttribute("title"), /Apply or discard the recipe changes first/);
  typedInto(draftResin(view, "A1"), "HX204");
  assert.equal(clearItem.getAttribute("aria-disabled"), "false");
  const spacer = row(view, "A1", "next").querySelector(".slate-hopper__weight[data-spacer]");
  assert.ok(spacer, "a Next cell has no weight line");
  assert.equal(spacer.getAttribute("aria-hidden"), "true");
  assert.equal(row(view, "A1").querySelector(".slate-hopper__weight[data-spacer]"), null, "a Current cell has a spacer as well as its weight");
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/recipe.css"), "utf8");
  assert.match(css, /\n\.slate-hopper__weight\[data-spacer\] \{\s*display: none;/);
  assert.match(css, /\.slate-root\[data-layers="grid"\] \.slate-hopper__weight\[data-spacer\] \{\s*min-height: calc\(var\(--slate-text-sm\) \* var\(--slate-line-normal\)\);/);
});

test("the Grid head keeps Compare's other share beside the share, never under it, and the role on one line in a tile wide enough for a subskin", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/recipe.css"), "utf8");
  const tokens = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/tokens.css"), "utf8");
  const rule = selector => { const at = css.indexOf(`${selector} {`); assert.ok(at > -1, `no rule for ${selector}`); return css.slice(at, css.indexOf("}", at)); };
  assert.match(tokens, /--slate-grid-head-width: 136px;/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer__head'), /display: grid;[^}]*grid-template-rows: auto auto 1fr;/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer__share'), /grid-row: 3;\s*grid-column: 1;/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer__share-other'), /grid-row: 3;\s*grid-column: 2;[^}]*white-space: nowrap;/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer__role'), /white-space: nowrap;/);
});

test("Clear recipe blanks every hopper of the shown tab into the draft - nothing sent - Apply sends it as ONE setHopperAssignments, and Cancel puts it all back; on Next it clears the plan", () => {
  const { view, commands } = boot({ desktop: true });
  view.update(withPlan(), { kind: "structural" });
  const clear = bulkFootOf(view).querySelector("[data-slate-bulk-do='clear']");
  assert.equal(clear.textContent, recipe.CLEAR_LABEL);
  click(clear);
  assert.equal(commands.calls.length, 0, "Clear recipe reached the line without Apply");
  assert.equal(draftResin(view, "A1").value, "");
  assert.equal(draftResin(view, "B2").value, "");
  const assigned = view.bulk().changes;
  assert.ok(assigned > 0);
  // Cancel (armed, then again) puts every field back.
  click(bulkFootOf(view).querySelector("[data-slate-bulk-do='cancel']"));
  click(bulkFootOf(view).querySelector("[data-slate-bulk-do='cancel']"));
  assert.equal(draftResin(view, "A1").value, "HX204");
  assert.equal(view.bulk().changes, 0);
  // Cleared and applied: one request naming every assigned hopper, blank.
  click(bulkFootOf(view).querySelector("[data-slate-bulk-do='clear']"));
  click(bulkFootOf(view).querySelector("[data-slate-bulk-do='apply']"));
  assert.equal(commands.calls.length, 1);
  assert.equal(commands.calls[0].command, "setHopperAssignments");
  assert.equal(commands.calls[0].args.recipe, "current");
  assert.equal(commands.calls[0].args.hoppers.length, assigned);
  assert.ok(commands.calls[0].args.hoppers.every(one => one.resin === "" || one.resin === undefined));

  // Next: the plan's hoppers, on its own tab.
  click(view.element.querySelector(".slate-tabs__tab[data-recipe='next']"));
  click(bulkFootOf(view, "next").querySelector("[data-slate-bulk-do='clear']"));
  assert.equal(draftResin(view, "A1", "next").value, "");
  click(bulkFootOf(view, "next").querySelector("[data-slate-bulk-do='apply']"));
  assert.equal(commands.calls[1].args.recipe, "next");

  // An empty tab says so and changes nothing.
  const empty = boot({ desktop: true });
  empty.view.update(withPlan(snap => { for (const layer of snap.layers) for (const hopper of layer.hoppers) { hopper.resinName = ""; hopper.pct = 0; } }), { kind: "structural" });
  click(bulkFootOf(empty.view).querySelector("[data-slate-bulk-do='clear']"));
  assert.equal(empty.said[empty.said.length - 1], recipe.CLEAR_EMPTY);
  assert.equal(empty.view.bulk().changes, 0);
});
