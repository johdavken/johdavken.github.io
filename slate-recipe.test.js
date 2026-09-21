"use strict";

/* slate-recipe.js with slate-tracking.js: the recipe down the page, the
 * mode switch, the rows patched in place, and Track's seam to the
 * application. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key, makeTimers, makeCommands } = require("./tools/slate-test/fake-dom.js");
const recipe = require("./slate/slate-recipe.js");
const tracking = require("./slate/slate-tracking.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

const ALL = ["setHopperTracking", "setPumpOff", "resetTracking", "setLineRate"];

function resolvedFrom(mutate) {
  const snap = demo.snapshot(5000);
  snap.revision = 3;
  if (mutate) mutate(snap);
  return source.resolveSource({ snapshot: snap });
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const timers = makeTimers();
  const commands = settings.commands === null ? null : (settings.commands || makeCommands({ capabilities: ALL }));
  const committed = [];
  const said = [];
  const view = recipe.create(doc, {
    commands: () => commands,
    onCommitted: result => committed.push(result),
    say: message => said.push(message),
    timers
  });
  doc.body.appendChild(view.element);
  return { doc, timers, commands, committed, said, view };
}

function row(view, id) {
  return view.element.querySelector(`.slate-hopper[data-hopper='${id}']`);
}

/* ----------------------------------------------------------------------
 *   Rendering
 * -------------------------------------------------------------------- */

test("a structural update lists every layer in recipe order with its role, share and hoppers", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const layers = view.element.querySelectorAll(".slate-layer");
  assert.deepEqual(layers.map(layer => layer.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.deepEqual(layers.map(layer => layer.getAttribute("data-tone")), ["inside", "core", "outside"]);
  assert.equal(layers[0].querySelector(".slate-layer__name").textContent, "Layer A");
  assert.equal(layers[0].querySelector(".slate-layer__role").textContent, "Inside");
  assert.equal(layers[1].querySelector(".slate-layer__share").textContent, "50%");
  assert.equal(view.rowCount(), 16);
  assert.equal(view.element.querySelector(".slate-section__subtitle").textContent, "Line 5 (demo) · 3 layers · 16 hoppers · Live");

  const a1 = row(view, "A1");
  assert.equal(a1.querySelector(".slate-hopper__resin").textContent, "HX204");
  assert.equal(a1.querySelector(".slate-hopper__pct").textContent, "60%");
  assert.equal(a1.querySelector(".slate-hopper__weight").textContent, "400 lb");
  assert.equal(a1.querySelector("[data-slate-control='tracking']").getAttribute("aria-pressed"), "true");
  assert.equal(a1.querySelector("[data-slate-control='pump']").getAttribute("aria-pressed"), "false");
  assert.ok(a1.classList.contains("is-tracked"));
  assert.ok(a1.classList.contains("slate-row-enter"));
  assert.equal(a1.style.getPropertyValue("--slate-row-i"), "0");
  assert.equal(row(view, "B2").style.getPropertyValue("--slate-row-i"), "7");

  const empty = row(view, "A4");
  assert.ok(empty.classList.contains("is-empty"));
  assert.equal(empty.querySelector(".slate-hopper__resin").textContent, recipe.EMPTY);
  assert.ok(empty.querySelector("[data-slate-control='tracking']").hasAttribute("disabled"), "an empty hopper's toggle is live");
  const pumped = row(view, "B2");
  assert.ok(pumped.classList.contains("is-pump-off"));
  assert.equal(pumped.querySelector("[data-slate-control='pump']").getAttribute("aria-pressed"), "true");
});

test("a values update rewrites only the cells that moved, keeps every row's element, and flashes unless the change was our own", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1");
  const a2 = row(view, "A2");
  const resinCell = a1.querySelector(".slate-hopper__resin");
  const before = a2.querySelector(".slate-hopper__resin").textContent;

  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].resinName = "LL318"; snap.layers[0].hoppers[0].track = false; }), { kind: "values", own: false });
  assert.ok(row(view, "A1") === a1, "the row was re-created on a values change");
  assert.ok(a1.querySelector(".slate-hopper__resin") === resinCell);
  assert.equal(resinCell.textContent, "LL318");
  assert.equal(a1.querySelector("[data-slate-control='tracking']").getAttribute("aria-pressed"), "false");
  assert.ok(!a1.classList.contains("is-tracked"));
  assert.ok(a1.classList.contains("is-updated"), "another device's change did not flash");
  assert.ok(!a2.classList.contains("is-updated"), "an unchanged row flashed");
  assert.equal(a2.querySelector(".slate-hopper__resin").textContent, before);

  a1.dispatchEvent({ type: "animationend" });
  assert.ok(!a1.classList.contains("is-updated"));
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].pct = 55; }), { kind: "values", own: true });
  assert.equal(a1.querySelector(".slate-hopper__pct").textContent, "55%");
  assert.ok(!a1.classList.contains("is-updated"), "our own change flashed");

  // A layer share moves in its head.
  view.update(resolvedFrom(snap => { snap.layers[1].layerPct = 45; }), { kind: "values" });
  assert.equal(view.element.querySelectorAll(".slate-layer")[1].querySelector(".slate-layer__share").textContent, "45%");
});

test("a structural update rebuilds; a snapshot with no layers leaves the section honest", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1");
  view.update(resolvedFrom(snap => { snap.line.hopperCounts = [2, 2, 2]; }), { kind: "structural" });
  assert.ok(row(view, "A1") !== a1);
  assert.equal(view.rowCount(), 6);
  view.update(source.resolveSource({ snapshot: null, demo: null }), { kind: "structural" });
  assert.equal(view.rowCount(), 0);
  assert.equal(view.element.querySelector(".slate-section__subtitle").textContent, "No recipe to show.");
});

test("formatting: shares and weights read as the floor does, and an empty hopper reads as nothing", () => {
  assert.equal(recipe.formatPct(60), "60%");
  assert.equal(recipe.formatPct(33.333), "33.3%");
  assert.equal(recipe.formatPct(0), recipe.EMPTY);
  assert.equal(recipe.formatWeight(1234.56), "1,234.6 lb");
  assert.equal(recipe.formatWeight(0), recipe.EMPTY);
  assert.deepEqual(recipe.cellsFor({ resinName: " ", pct: 50, effectiveWeight: 10, track: true }), { assigned: false, resin: "—", pct: "—", weight: "—", track: true, pumpOff: false });
});

/* ----------------------------------------------------------------------
 *   Modes
 * -------------------------------------------------------------------- */

test("the mode switch is a tablist; Track is live, the other three say they are coming", () => {
  const { view } = boot();
  const tabs = view.element.querySelectorAll("[role='tab']");
  assert.deepEqual(tabs.map(tab => tab.getAttribute("data-mode")), recipe.MODES);
  assert.deepEqual(tabs.map(tab => tab.textContent), ["Track", "Edit", "Compare", "Print"]);
  assert.equal(view.getMode(), "track");
  assert.equal(view.element.getAttribute("data-mode"), "track");
  const stub = view.element.querySelector(".slate-stub");
  assert.ok(stub.hasAttribute("hidden"));

  click(tabs[1]);
  assert.equal(view.getMode(), "edit");
  assert.equal(view.element.getAttribute("data-mode"), "edit");
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[0].getAttribute("aria-selected"), "false");
  assert.ok(!stub.hasAttribute("hidden"));
  assert.equal(stub.textContent, recipe.STUB.edit);
  assert.match(recipe.STUB.compare, /phase 2/);
  assert.match(recipe.STUB.print, /phase 2/);

  assert.equal(view.setMode("nonsense"), "edit");
  view.setMode("track");
  assert.ok(stub.hasAttribute("hidden"));
});

/* ----------------------------------------------------------------------
 *   Track
 * -------------------------------------------------------------------- */

test("a toggle click dispatches exactly one command with the state wanted, and the boot hears of the commit", () => {
  const { view, commands, committed } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1");
  const trackButton = a1.querySelector("[data-slate-control='tracking']");
  assert.equal(trackButton.getAttribute("data-able"), "true");
  click(trackButton);
  assert.deepEqual(commands.calls, [{ command: "setHopperTracking", args: { recipe: "current", layer: "A", index: 0, track: false } }]);
  assert.equal(committed.length, 1);

  click(a1.querySelector("[data-slate-control='pump']"));
  assert.deepEqual(commands.calls[1], { command: "setPumpOff", args: { recipe: "current", layer: "A", index: 0, pumpOff: true } });
  assert.equal(committed.length, 2);

  // A disabled (empty) toggle dispatches nothing.
  click(row(view, "A4").querySelector("[data-slate-control='tracking']"));
  assert.equal(commands.calls.length, 2);
});

test("a refusal is said to the operator and commits nothing; an unchanged answer is silent", () => {
  const answers = [{ ok: false, code: "busy", message: "Another device is applying a change." }, { ok: true, changed: false, revision: 3, persisted: false, snapshot: null }];
  const commands = makeCommands({ capabilities: ALL, answer: () => answers.shift() });
  const { view, committed, said } = boot({ commands });
  view.update(resolvedFrom(), { kind: "structural" });
  click(row(view, "A1").querySelector("[data-slate-control='tracking']"));
  assert.deepEqual(said, ["Another device is applying a change."]);
  assert.equal(committed.length, 0);
  click(row(view, "A1").querySelector("[data-slate-control='tracking']"));
  assert.equal(said.length, 1);
  assert.equal(committed.length, 0);
});

test("with no command bridge every toggle is marked unable, a click only explains, and nothing is dispatched", () => {
  const { view, said, committed } = boot({ commands: null });
  view.update(resolvedFrom(), { kind: "structural" });
  const button = row(view, "A1").querySelector("[data-slate-control='tracking']");
  assert.equal(button.getAttribute("data-able"), "false");
  assert.match(button.getAttribute("title"), /no application is connected/);
  click(button);
  assert.equal(said.length, 1);
  assert.match(said[0], /no application is connected to Slate commands/);
  assert.equal(committed.length, 0);
  assert.equal(view.element.querySelector(".slate-recipe__reset").getAttribute("data-able"), "false");
});

test("a bridge that offers only some commands leaves the others unable", () => {
  const commands = makeCommands({ capabilities: ["setHopperTracking"] });
  const { view } = boot({ commands });
  view.update(resolvedFrom(), { kind: "structural" });
  const a1 = row(view, "A1");
  assert.equal(a1.querySelector("[data-slate-control='tracking']").getAttribute("data-able"), "true");
  assert.equal(a1.querySelector("[data-slate-control='pump']").getAttribute("data-able"), "false");
  assert.equal(view.element.querySelector(".slate-recipe__reset").getAttribute("data-able"), "false");
  click(a1.querySelector("[data-slate-control='pump']"));
  assert.equal(commands.calls.length, 0);
});

test("the reset arms on the first click, disarms on Escape or after four seconds, and resets on the second", () => {
  const { view, commands, timers, committed } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const reset = view.element.querySelector(".slate-recipe__reset");
  assert.equal(reset.textContent, recipe.RESET_LABEL);
  click(reset);
  assert.ok(reset.hasAttribute("data-armed"));
  assert.equal(reset.textContent, recipe.RESET_ARMED_LABEL);
  assert.equal(commands.calls.length, 0);

  key(reset, "Escape");
  assert.ok(!reset.hasAttribute("data-armed"));
  assert.equal(reset.textContent, recipe.RESET_LABEL);

  click(reset);
  timers.advance(recipe.RESET_ARM_MS);
  assert.ok(!reset.hasAttribute("data-armed"), "the arm did not time out");

  click(reset);
  click(reset);
  assert.deepEqual(commands.calls, [{ command: "resetTracking", args: { recipe: "current" } }]);
  assert.equal(committed.length, 1);
  assert.ok(!reset.hasAttribute("data-armed"));
  assert.equal(timers.pending(), 0, "a disarm timer was left running");
});

test("an armed reset survives a values change but not a structural one or a mode change", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const reset = view.element.querySelector(".slate-recipe__reset");
  click(reset);
  view.update(resolvedFrom(snap => { snap.job.lineRate = 900; }), { kind: "values" });
  assert.ok(reset.hasAttribute("data-armed"));
  view.setMode("edit");
  assert.ok(!reset.hasAttribute("data-armed"));
  view.setMode("track");
  click(reset);
  view.update(resolvedFrom(snap => { snap.line.hopperCounts = [1, 1, 1]; }), { kind: "structural" });
  assert.ok(!reset.hasAttribute("data-armed"));
});

test("run-down marks land on the rows as overdue or late", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  view.applyMarks({ "A:0": { tracked: true, pumpOff: false, late: true, overdue: true }, "A:1": { tracked: true, pumpOff: false, late: true, overdue: false } });
  assert.ok(row(view, "A1").classList.contains("is-overdue"));
  assert.equal(row(view, "A1").querySelector(".slate-hopper__mark").textContent, "Overdue");
  assert.ok(row(view, "A2").classList.contains("is-late"));
  assert.ok(!row(view, "A2").classList.contains("is-overdue"));
  assert.equal(row(view, "A2").querySelector(".slate-hopper__mark").textContent, "Late");
  // Marks survive a values update and clear when withdrawn.
  view.update(resolvedFrom(snap => { snap.job.lineRate = 1; }), { kind: "values" });
  assert.ok(row(view, "A1").classList.contains("is-overdue"));
  view.applyMarks({});
  assert.ok(!row(view, "A1").classList.contains("is-overdue"));
  assert.equal(row(view, "A1").querySelector(".slate-hopper__mark").textContent, "");
});

/* ----------------------------------------------------------------------
 *   The seam itself
 * -------------------------------------------------------------------- */

test("slate-tracking maps each control to its command and flag, and refuses what it does not know", () => {
  const commands = makeCommands({ capabilities: ALL });
  assert.deepEqual(tracking.abilities(commands), { tracking: true, pump: true, reset: true });
  assert.deepEqual(tracking.abilities(null), { tracking: false, pump: false, reset: false });
  assert.deepEqual(tracking.abilities(makeCommands({ capabilities: ALL, available: false })), { tracking: false, pump: false, reset: false });
  tracking.toggle(commands, { control: "tracking", layer: "B", index: 2, next: true });
  tracking.toggle(commands, { control: "pump", layer: "B", index: 2, next: false });
  tracking.resetTracking(commands);
  assert.deepEqual(commands.calls, [
    { command: "setHopperTracking", args: { recipe: "current", layer: "B", index: 2, track: true } },
    { command: "setPumpOff", args: { recipe: "current", layer: "B", index: 2, pumpOff: false } },
    { command: "resetTracking", args: { recipe: "current" } }
  ]);
  assert.equal(tracking.toggle(commands, { control: "blend", layer: "A", index: 0 }).code, "unavailable");
  assert.equal(tracking.toggle(null, { control: "tracking", layer: "A", index: 0 }).code, "unavailable");
  assert.equal(tracking.resetTracking(null).code, "unavailable");
  assert.match(tracking.reason(null, "tracking"), /no application/);
  assert.match(tracking.reason(makeCommands({ capabilities: [] }), "pump"), /does not offer pump-off/);
  assert.match(tracking.reason(makeCommands({ capabilities: [] }), "reset"), /tracking reset/);
  assert.equal(tracking.stateLabel("pump", true), "Pump off");
  assert.equal(tracking.actionLabel("tracking", false), "track in the timeline");
});

test("requestFrom reads a toggle's address and state back off its element", () => {
  const doc = makeDocument();
  const button = doc.createElement("button");
  button.setAttribute("data-slate-control", "pump");
  button.setAttribute("data-layer", "C");
  button.setAttribute("data-index", "4");
  button.setAttribute("aria-pressed", "true");
  button.setAttribute("data-able", "true");
  assert.deepEqual(tracking.requestFrom(button), { control: "pump", layer: "C", index: 4, on: true, able: true });
  button.setAttribute("data-index", "");
  assert.equal(tracking.requestFrom(button), null);
  button.setAttribute("data-index", "1");
  button.setAttribute("data-slate-control", "other");
  assert.equal(tracking.requestFrom(button), null);
  assert.equal(tracking.requestFrom(null), null);
});
