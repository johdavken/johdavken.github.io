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
  const view = recipe.create(doc, {
    commands: () => commands,
    onCommitted: result => committed.push(result),
    say: message => said.push(message),
    readOnly: () => readOnly,
    resins: () => CATALOG,
    timers,
    print: printer
  });
  doc.body.appendChild(view.element);
  return { doc, timers, commands, committed, said, printed, view, setReadOnly: value => { readOnly = value; } };
}

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
  assert.ok(!a1.querySelector("[data-slate-control='pump']").hasAttribute("hidden"));
  assert.ok(row(view, "A3").querySelector("[data-slate-control='pump']").hasAttribute("hidden"));
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
  assert.deepEqual(tabs.map(tab => [tab.textContent, tab.getAttribute("data-recipe"), tab.getAttribute("aria-selected")]), [["Current", "current", "true"], ["Next", "next", "false"]]);
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
  assert.equal(b1.querySelector(".slate-hopper__weight"), null);
  assert.equal(b1.querySelector("[data-slate-control]"), null);
  assert.equal(view.body("next").querySelectorAll(".slate-recipe__column").length, 4);
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

test("Compare is unable without a plan; with one it writes the other recipe under differing rows on either tab and survives a values publish", () => {
  const { view, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const compare = view.element.querySelector("[data-slate-compare]");
  assert.equal(compare.getAttribute("data-able"), "false");
  click(compare);
  assert.equal(view.getCompare(), false);
  assert.match(said[0], /Nothing is planned/);

  view.update(withPlan(snap => { snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ1"; snap.nextRecipe.layers[1].layerPct = 40; }), { kind: "structural" });
  assert.equal(compare.getAttribute("data-able"), "true");
  click(compare);
  assert.equal(view.getCompare(), true);
  assert.equal(compare.getAttribute("aria-checked"), "true");
  assert.ok(view.element.classList.contains("is-comparing"));
  const a1 = row(view, "A1");
  assert.ok(a1.classList.contains("is-differs"), "a differing row is not red");
  assert.ok(!a1.classList.contains("is-same"));
  assert.equal(a1.querySelector(".slate-hopper__other").textContent, "Next: ZZ1 · 60%");
  assert.ok(!a1.querySelector(".slate-hopper__other").hasAttribute("hidden"));
  const a2 = row(view, "A2");
  assert.ok(a2.classList.contains("is-same"), "an agreeing row is not green");
  assert.ok(!a2.classList.contains("is-differs"));
  assert.equal(a2.querySelector(".slate-hopper__other").textContent, "Next: LD105 · 30%");
  const a4 = row(view, "A4");
  assert.ok(a4.querySelector(".slate-hopper__other").hasAttribute("hidden"), "an empty pair got a compare line");
  assert.ok(!a4.classList.contains("is-same") && !a4.classList.contains("is-differs"), "an empty pair was coloured");
  const headB = head(view, "B");
  assert.equal(headB.querySelector(".slate-layer__share-other").textContent, "Next 40%");
  assert.ok(headB.classList.contains("is-differs"));
  assert.ok(head(view, "A").classList.contains("is-same"));

  view.update(withPlan(snap => { snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ1"; snap.nextRecipe.layers[1].layerPct = 40; snap.job.lineRate = 900; }), { kind: "values" });
  assert.equal(view.getCompare(), true);
  assert.ok(row(view, "A1").classList.contains("is-differs"));

  view.setRecipe("next");
  const nextA1 = row(view, "A1", "next");
  assert.ok(nextA1.classList.contains("is-differs"));
  assert.equal(nextA1.querySelector(".slate-hopper__other").textContent, "Current: HX204 · 60%");
  assert.ok(!row(view, "A1").classList.contains("is-differs"), "the hidden body kept its compare marks");

  click(compare);
  assert.equal(view.getCompare(), false);
  assert.ok(!nextA1.classList.contains("is-differs"));
  assert.ok(!row(view, "A2", "next").classList.contains("is-same"));
  assert.ok(nextA1.querySelector(".slate-hopper__other").hasAttribute("hidden"));

  // The plan going away forces Compare off.
  view.setCompare(true);
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(view.getCompare(), false);
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
  assert.equal(promote.getAttribute("data-able"), "false");
  assert.match(promote.getAttribute("title"), /nothing is planned/);
  click(promote);
  assert.equal(commands.calls.length, 0);
  assert.match(said[0], /nothing is planned/);
  click(view.body("next").querySelector(".slate-recipe__empty [data-slate-plan='copy']"));
  assert.deepEqual(commands.calls, [{ command: "copyCurrentToNext", args: {} }]);

  view.update(withPlan(), { kind: "structural" });
  view.setRecipe("next");
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
  click(a1.querySelector("[data-slate-control='pump']"));
  assert.deepEqual(commands.calls[1], { command: "setPumpOff", args: { recipe: "current", layer: "A", index: 0, pumpOff: true } });
  assert.equal(committed.length, 2);
  click(row(view, "A4").querySelector("[data-slate-control='tracking']"));
  assert.equal(commands.calls.length, 2);

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
  assert.deepEqual(commands.calls[2], { command: "resetTracking", args: { recipe: "current" } });

  view.applyMarks({ "A:0": { tracked: true, pumpOff: false, late: true, overdue: true }, "A:1": { tracked: true, pumpOff: false, late: true, overdue: false } });
  assert.ok(a1.classList.contains("is-overdue"));
  assert.equal(a1.querySelector(".slate-hopper__mark").textContent, "Overdue");
  assert.equal(row(view, "A2").querySelector(".slate-hopper__mark").textContent, "Late");
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
