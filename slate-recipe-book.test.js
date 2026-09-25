"use strict";

/* slate-recipe-book.js: the Recipe Book section over the recipes bridge -
 * the list, the detail card, the confirms with their change preview, the
 * name entry, and every request each control makes. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("./tools/slate-test/fake-dom.js");
const book = require("./slate/slate-recipe-book.js");
const actions = require("./slate/slate-book-actions.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

const tick = () => new Promise(resolve => setImmediate(resolve));

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
    if (mutate) mutate(snap);
  });
}

/* The demo's running recipe as a saved recipe: identical to the line. */
function sameAsLine(id, name, extra) {
  const snap = snapshotWith();
  return Object.assign({
    id, name, favorite: false, updatedAt: "2026-09-21T10:00:00Z", lineType: 3, hopperNamingMode: "standard",
    layers: snap.layers.map(layer => ({ name: layer.name, layerPct: layer.layerPct, hoppers: layer.hoppers.filter(h => h.resinName).map(h => ({ index: h.index, pct: h.pct, resinName: h.resinName })) }))
  }, extra || {});
}

function recipeOf(id, name, extra) {
  return Object.assign({
    id, name, favorite: false, updatedAt: "2026-09-21T10:00:00Z", lineType: 3, hopperNamingMode: "standard",
    layers: [
      { name: "A", layerPct: 30, hoppers: [{ index: 0, pct: 100, resinName: "ZZ900" }] },
      { name: "B", layerPct: 40, hoppers: [{ index: 0, pct: 50, resinName: "LL318" }, { index: 1, pct: 50, resinName: "HD622" }] },
      { name: "C", layerPct: 30, hoppers: [{ index: 0, pct: 100, resinName: "EVA340" }] }
    ]
  }, extra || {});
}

function bookOf(overrides) {
  const recipes = [recipeOf("r2", "Clear 40", { favorite: true }), recipeOf("r1", "Blue film"), sameAsLine("r3", "Running twin")];
  return Object.assign({ assigned: true, workspace: { id: "ws-1", displayName: "Line 5" }, cachedAt: 1, refreshing: false, recipes, count: recipes.length }, overrides || {});
}

function makeRecipes(initial, options) {
  const settings = options || {};
  const requests = [];
  const listeners = new Set();
  let current = initial;
  return {
    requests,
    isConnected: () => settings.connected !== false,
    capabilities: () => settings.capabilities || [...actions.ACTIONS],
    getBook: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(action, args) {
      requests.push(args === undefined ? { action } : { action, args });
      if (typeof settings.answer === "function") {
        const answered = await settings.answer(action, args);
        if (answered !== undefined) return answered;
      }
      return { ok: true };
    },
    set(next) { current = next; for (const listener of listeners) listener(next); }
  };
}

function boot(initial, options) {
  const settings = options || {};
  const doc = makeDocument();
  const recipes = initial === null ? null : makeRecipes(initial, settings);
  const said = [];
  let readOnly = !!settings.readOnly;
  const view = book.create(doc, { recipes, readOnly: () => readOnly, say: message => said.push(message) });
  doc.body.appendChild(view.element);
  view.update(settings.resolved === undefined ? resolvedFrom() : settings.resolved, { kind: "structural" });
  return { doc, recipes, view, said, setReadOnly(on) { readOnly = on; view.refresh(); } };
}

const q = (view, selector) => view.element.querySelector(selector);
const qa = (view, selector) => view.element.querySelectorAll(selector);
const action = (view, name) => q(view, `[data-book-action='${name}']`);
const rows = view => qa(view, ".slate-book__row");
const noteOf = view => q(view, ".slate-book__note");

/* ----------------------------------------------------------------------
 *   Pure helpers
 * -------------------------------------------------------------------- */

test("emptyText and subtitle say which of the five states the book is in", () => {
  assert.match(book.emptyText(null, false), /No application is connected/);
  assert.match(book.emptyText({ assigned: false }, true), /not on a production line/);
  assert.match(book.emptyText({ assigned: true, refreshing: true, count: 0 }, true), /Reading the line/);
  assert.match(book.emptyText({ assigned: true, refreshing: false, count: 0 }, true), /No recipes are saved/);
  assert.equal(book.subtitleFor(null, false), "Not connected");
  assert.equal(book.subtitleFor({ assigned: false }, true), "No line");
  assert.equal(book.subtitleFor(bookOf(), true), "Line 5 · 3 saved");
  assert.equal(book.rowMeta(recipeOf("x", "X")), "3 layers · Sep 21");
  assert.equal(book.rowMeta({ layers: [{}], updatedAt: "nonsense" }), "1 layer");
});

test("compatibility is the layer-count rule, and only that", () => {
  const model = resolvedFrom().line;
  assert.equal(book.compatibility(recipeOf("x", "X"), model).ok, true);
  const five = book.compatibility(recipeOf("x", "X", { lineType: 5 }), model);
  assert.equal(five.ok, false);
  assert.equal(five.message, "This recipe is set up for 5 layers, but this line runs 3. It can be loaded into Next, not into Current.");
  assert.equal(book.compatibility(recipeOf("x", "X", { lineType: 5 }), null).ok, true, "no line model: the application decides");
  assert.equal(book.compatibility(recipeOf("x", "X", { lineType: 0 }), model).ok, true, "no line type: the application decides");
});

test("previewFor counts the hoppers and layer shares a load would move against the recipe shown", () => {
  const resolved = resolvedFrom();
  const twin = book.previewFor(sameAsLine("r3", "Twin"), resolved, "current");
  assert.equal(twin.same, true);
  assert.equal(twin.text, book.NOTHING_CHANGES);
  assert.deepEqual(twin.hoppers, { changed: 0, total: 16 });

  // Blue film: A0 changes (ZZ900 100 vs HX204 60), A1 and A2 clear, B0 and B1 change pct, B2 clears, C0 changes pct, C1 clears; shares A 25→30, B 50→40, C 25→30.
  const blue = book.previewFor(recipeOf("r1", "Blue film"), resolved, "current");
  assert.deepEqual(blue.hoppers, { changed: 8, total: 16 });
  assert.deepEqual(blue.layers, { changed: 3, total: 3 });
  assert.equal(blue.text, "8 of 16 hoppers change, 3 layer shares change");

  // A layer the recipe lacks empties on the line; a hopper the line lacks is ignored.
  const short = book.previewFor(recipeOf("s", "Short", { layers: [{ name: "A", layerPct: 25, hoppers: [{ index: 0, pct: 60, resinName: "hx204" }, { index: 1, pct: 30, resinName: "LD105" }, { index: 2, pct: 10, resinName: "AB120" }, { index: 9, pct: 1, resinName: "X" }] }] }), resolved, "current");
  assert.deepEqual(short.hoppers, { changed: 5, total: 16 }, "case-insensitive resin match; B and C's 5 assigned hoppers clear");
  assert.deepEqual(short.layers, { changed: 2, total: 3 });

  // Into Next with nothing planned: the recipe becomes the plan.
  const unplanned = book.previewFor(recipeOf("r1", "Blue film"), resolved, "next");
  assert.equal(unplanned.planned, false);
  assert.equal(unplanned.text, book.NOTHING_PLANNED);
  // Against a plan that is the running recipe: the same counts as Current.
  const planned = book.previewFor(recipeOf("r1", "Blue film"), withPlan(), "next");
  assert.equal(planned.planned, true);
  assert.equal(planned.text, blue.text);
  assert.equal(book.previewFor(recipeOf("r1", "Blue film"), null, "current"), null);
});

/* ----------------------------------------------------------------------
 *   The section
 * -------------------------------------------------------------------- */

test("the bar, the list (favourites first as given, with the star and the meta) and the hint when nothing is selected", () => {
  const { view } = boot(bookOf());
  assert.equal(q(view, ".slate-section__subtitle").textContent, "Line 5 · 3 saved");
  for (const name of ["save-current", "refresh"]) assert.equal(action(view, name).getAttribute("data-able"), "true", name);
  assert.equal(action(view, "save-next").getAttribute("data-able"), "false", "nothing is planned");
  assert.match(action(view, "save-next").getAttribute("title"), /nothing is planned/);
  const list = rows(view);
  assert.deepEqual(list.map(row => row.getAttribute("data-recipe")), ["r2", "r1", "r3"], "the section never sorts");
  assert.ok(list[0].classList.contains("is-favorite"));
  assert.equal(list[0].querySelector(".slate-book__star").textContent, "★");
  assert.equal(list[1].querySelector(".slate-book__star").textContent, "");
  assert.equal(list[0].querySelector(".slate-book__row-meta").textContent, "3 layers · Sep 21");
  assert.equal(list[0].getAttribute("aria-pressed"), "false");
  assert.equal(q(view, ".slate-book__hint").textContent, book.SELECT_HINT);
  assert.ok(q(view, ".slate-book__entry").hasAttribute("hidden"));
  assert.ok(noteOf(view).hasAttribute("hidden"));
});

test("the empty states: no bridge, not connected, no line, refreshing, none saved", () => {
  const none = boot(null);
  assert.equal(q(none.view, ".slate-section__subtitle").textContent, "Not connected");
  assert.match(q(none.view, ".slate-book__empty").textContent, /No application is connected/);
  assert.ok(qa(none.view, "[data-book-action]").filter(b => b.hasAttribute("data-able")).every(b => b.getAttribute("data-able") === "false"));
  click(action(none.view, "save-current"));
  assert.match(none.said[0], /no application is connected/);

  const off = boot(bookOf(), { connected: false });
  assert.equal(q(off.view, ".slate-section__subtitle").textContent, "Not connected");
  assert.equal(rows(off.view).length, 0);

  const unassigned = boot(bookOf({ assigned: false, workspace: null, recipes: [], count: 0 }));
  assert.equal(q(unassigned.view, ".slate-section__subtitle").textContent, "No line");
  assert.match(q(unassigned.view, ".slate-book__empty").textContent, /not on a production line/);

  const refreshing = boot(bookOf({ refreshing: true, recipes: [], count: 0 }));
  assert.match(q(refreshing.view, ".slate-book__empty").textContent, /Reading/);
  assert.equal(action(refreshing.view, "refresh").textContent, "Refreshing…");
  assert.ok(action(refreshing.view, "refresh").hasAttribute("disabled"));
  assert.ok(action(refreshing.view, "refresh").classList.contains("is-busy"));

  const empty = boot(bookOf({ recipes: [], count: 0 }));
  assert.match(q(empty.view, ".slate-book__empty").textContent, /Save Current adds/);
});

test("selecting shows the blend with the line's tones; selecting again deselects; selecting changes nothing on the line", () => {
  const { view, recipes } = boot(bookOf());
  click(rows(view)[1]);
  assert.equal(rows(view)[1].getAttribute("aria-pressed"), "true");
  assert.equal(q(view, ".slate-book__detail-name").textContent, "Blue film");
  const layers = qa(view, ".slate-book__layer");
  assert.deepEqual(layers.map(l => l.getAttribute("data-layer")), ["A", "B", "C"]);
  // The demo line has A inside: A is the inside tone, C the outside.
  assert.deepEqual(layers.map(l => l.getAttribute("data-tone")), ["inside", "core", "outside"]);
  assert.equal(layers[0].querySelector(".slate-book__layer-share").textContent, "30%");
  const chips = layers[1].querySelectorAll(".slate-book__hopper");
  assert.equal(chips.length, 2);
  assert.equal(chips[0].querySelector(".slate-book__hopper-id").textContent, "B1");
  assert.equal(chips[0].querySelector(".slate-book__hopper-resin").textContent, "LL318");
  assert.equal(chips[0].querySelector(".slate-book__hopper-pct").textContent, "50%");
  assert.equal(q(view, ".slate-book__compat"), null);
  assert.equal(action(view, "load").getAttribute("data-able"), "true");
  assert.ok(q(view, ".slate-book__overflow").hasAttribute("hidden"));
  assert.equal(recipes.requests.length, 0);

  click(rows(view)[1]);
  assert.equal(rows(view)[1].getAttribute("aria-pressed"), "false");
  assert.ok(q(view, ".slate-book__hint"));
  assert.equal(view.getState().selectedId, null);
});

test("a recipe for another layer count says so, Load into Current is disabled with the reason, and a line that fits clears it", () => {
  const recipes = bookOf();
  recipes.recipes[1].lineType = 5;
  const { view } = boot(recipes);
  click(rows(view)[1]);
  assert.match(q(view, ".slate-book__compat").textContent, /set up for 5 layers, but this line runs 3/);
  click(action(view, "load"));
  const confirm = q(view, ".slate-book__confirm");
  assert.equal(confirm.getAttribute("data-kind"), "load");
  assert.match(q(view, ".slate-book__confirm-text").textContent, /changes the line type from 3 to 5\.$/);
  assert.ok(q(view, ".slate-book__confirm-text").textContent.includes(book.LOAD_CURRENT_TEXT));
  assert.ok(q(view, ".slate-book__confirm-text").textContent.includes(book.LOAD_NEXT_TEXT));
  const intoCurrent = qa(view, "[data-book-action='confirm-load']")[0];
  assert.equal(intoCurrent.getAttribute("data-destination"), "current");
  assert.ok(intoCurrent.hasAttribute("disabled"));
  assert.match(intoCurrent.getAttribute("title"), /loaded into Next/);
  assert.match(q(view, ".slate-book__preview[data-destination='current']").textContent, /Into Current: This recipe is set up/);
  assert.equal(q(view, ".slate-book__preview[data-destination='next']").textContent, `Into Next: ${book.NOTHING_PLANNED}`);
  assert.ok(!qa(view, "[data-book-action='confirm-load']")[1].hasAttribute("disabled"));

  // A five-layer line fits.
  view.update(resolvedFrom(snap => { snap.layers = snap.layers.concat([{ name: "D", layerPct: 0, hoppers: [] }, { name: "E", layerPct: 0, hoppers: [] }]); snap.line.hopperCounts = [6, 4, 6, 1, 1]; }), { kind: "structural" });
  assert.equal(q(view, ".slate-book__compat"), null);
  assert.ok(!qa(view, "[data-book-action='confirm-load']")[0].hasAttribute("disabled"));
  assert.doesNotMatch(q(view, ".slate-book__confirm-text").textContent, /changes the line type from/);
});

test("Load confirms with the two previews; Load into Next asks once and says so; Load into Current likewise", async () => {
  const { view, recipes } = boot(bookOf(), { resolved: withPlan() });
  click(rows(view)[1]);
  click(action(view, "load"));
  assert.match(q(view, ".slate-book__preview[data-destination='current']").textContent, /^Into Current: 8 of 16 hoppers change, 3 layer shares change$/);
  assert.match(q(view, ".slate-book__preview[data-destination='next']").textContent, /^Into Next: replaces the plan — 8 of 16 hoppers change/);
  click(qa(view, "[data-book-action='confirm-load']")[1]);
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "loadRecipe", args: { id: "r1", destination: "next" } }]);
  assert.equal(noteOf(view).textContent, actions.WORDING.loadedNext("Blue film"));
  assert.ok(noteOf(view).classList.contains("is-ok"));
  assert.equal(q(view, ".slate-book__confirm"), null);
  assert.equal(view.getState().selectedId, "r1", "the selection stays");

  click(action(view, "load"));
  click(qa(view, "[data-book-action='confirm-load']")[0]);
  await tick();
  assert.deepEqual(recipes.requests[1], { action: "loadRecipe", args: { id: "r1", destination: "current" } });
  assert.equal(noteOf(view).textContent, actions.WORDING.loadedCurrent("Blue film"));

  // The twin: nothing would change, and Cancel asks nothing.
  click(rows(view)[2]);
  click(action(view, "load"));
  assert.equal(q(view, ".slate-book__preview[data-destination='current']").textContent, `Into Current: ${book.NOTHING_CHANGES}`);
  click(action(view, "cancel-confirm"));
  assert.equal(q(view, ".slate-book__confirm"), null);
  assert.equal(recipes.requests.length, 2);
});

test("a refused load shows the application's words and keeps the selection; not_found drops it", async () => {
  const answers = { loadRecipe: { ok: false, code: "incompatible", message: "Layer B's total is 110%." } };
  const { view, recipes } = boot(bookOf(), { answer: name => answers[name] });
  click(rows(view)[1]);
  click(action(view, "load"));
  click(qa(view, "[data-book-action='confirm-load']")[0]);
  await tick();
  assert.equal(noteOf(view).textContent, "Layer B's total is 110%.");
  assert.ok(noteOf(view).classList.contains("is-error"));
  assert.equal(view.getState().selectedId, "r1");
  assert.equal(rows(view)[1].getAttribute("aria-pressed"), "true");

  answers.loadRecipe = { ok: false, code: "not_found", message: "That recipe is gone." };
  click(action(view, "load"));
  click(qa(view, "[data-book-action='confirm-load']")[0]);
  await tick();
  assert.equal(view.getState().selectedId, null);
  assert.ok(q(view, ".slate-book__hint"));
  assert.equal(recipes.requests.length, 2);
});

test("Update and Delete confirm in place; More… drops Rename, Duplicate, Delete; Escape closes a confirm", async () => {
  const { view, recipes } = boot(bookOf());
  click(rows(view)[0]);
  click(action(view, "update"));
  assert.equal(q(view, ".slate-book__confirm").getAttribute("data-kind"), "update");
  assert.match(q(view, ".slate-book__confirm-text").textContent, /Replace “Clear 40” with the running recipe\?.*will not save receiver weights/);
  click(action(view, "confirm"));
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "replaceRecipe", args: { id: "r2" } }]);
  assert.equal(noteOf(view).textContent, actions.WORDING.updated("Clear 40"));

  assert.equal(action(view, "more").getAttribute("aria-expanded"), "false");
  click(action(view, "more"));
  assert.equal(action(view, "more").getAttribute("aria-expanded"), "true");
  assert.ok(!q(view, ".slate-book__overflow").hasAttribute("hidden"));
  assert.deepEqual(qa(view, ".slate-book__overflow button").map(b => b.textContent), ["Rename", "Duplicate", "Delete"]);
  click(action(view, "delete"));
  assert.equal(q(view, ".slate-book__confirm").getAttribute("data-kind"), "delete");
  assert.ok(q(view, ".slate-book__overflow").hasAttribute("hidden"), "the overflow closes with the confirm");
  key(q(view, ".slate-book__confirm"), "Escape");
  assert.equal(q(view, ".slate-book__confirm"), null);

  click(action(view, "more"));
  click(action(view, "delete"));
  click(action(view, "confirm"));
  await tick();
  assert.deepEqual(recipes.requests[1], { action: "deleteRecipe", args: { id: "r2" } });
  assert.equal(noteOf(view).textContent, actions.WORDING.deleted("Clear 40"));
  assert.equal(view.getState().selectedId, null);
});

test("Save Current opens the entry; a name is needed; Enter saves; the new recipe is selected", async () => {
  const { view, recipes } = boot(bookOf(), { answer: name => (name === "saveCurrentRecipe" ? { ok: true, id: "r9" } : undefined) });
  click(action(view, "save-current"));
  const entry = q(view, ".slate-book__entry");
  assert.ok(!entry.hasAttribute("hidden"));
  assert.equal(q(view, ".slate-book__entry-label").textContent, "Save the running recipe as");
  const input = q(view, ".slate-book__name");
  assert.equal(input.focused, true);
  key(input, "Enter");
  await tick();
  assert.equal(recipes.requests.length, 0);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(noteOf(view).textContent, actions.WORDING.nameNeeded);

  input.value = "  New   film ";
  key(input, "Enter");
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "saveCurrentRecipe", args: { name: "New film" } }]);
  assert.ok(entry.hasAttribute("hidden"));
  assert.equal(noteOf(view).textContent, actions.WORDING.saved("New film"));
  assert.equal(view.getState().selectedId, "r9");
  assert.equal(input.value, "");
});

test("a Save Current that collides offers Replace, which asks replaceRecipe for that recipe; a Save Next collision does not", async () => {
  const collide = { ok: false, code: "duplicate_name", message: "A recipe with that name already exists.", field: "name" };
  const { view, recipes } = boot(bookOf(), { resolved: withPlan(), answer: name => (name.startsWith("save") ? collide : undefined) });
  click(action(view, "save-current"));
  const input = q(view, ".slate-book__name");
  input.value = "blue film";
  click(action(view, "confirm-entry"));
  await tick();
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(noteOf(view).textContent, actions.WORDING.duplicateOffer("Blue film"));
  assert.ok(!action(view, "replace").hasAttribute("hidden"));
  assert.equal(view.getState().selectedId, "r1", "the colliding recipe is shown");
  click(action(view, "replace"));
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "saveCurrentRecipe", args: { name: "blue film" } }, { action: "replaceRecipe", args: { id: "r1" } }]);
  assert.equal(noteOf(view).textContent, actions.WORDING.replaced("Blue film"));
  assert.ok(q(view, ".slate-book__entry").hasAttribute("hidden"));

  click(action(view, "save-next"));
  assert.equal(q(view, ".slate-book__entry-label").textContent, "Save the planned recipe as");
  input.value = "Blue film";
  click(action(view, "confirm-entry"));
  await tick();
  assert.deepEqual(recipes.requests[2], { action: "saveNextRecipe", args: { name: "Blue film" } });
  assert.equal(noteOf(view).textContent, actions.WORDING.duplicateOther);
  assert.ok(action(view, "replace").hasAttribute("hidden"));
  assert.ok(!q(view, ".slate-book__entry").hasAttribute("hidden"), "the entry stays for another name");
  key(input, "Escape");
  assert.ok(q(view, ".slate-book__entry").hasAttribute("hidden"));
});

test("Rename and Duplicate use the entry with the recipe's name; Duplicate selects the copy", async () => {
  const { view, recipes } = boot(bookOf(), { answer: name => (name === "duplicateRecipe" ? { ok: true, id: "r7" } : undefined) });
  click(rows(view)[0]);
  click(action(view, "more"));
  click(action(view, "rename"));
  const input = q(view, ".slate-book__name");
  assert.equal(q(view, ".slate-book__entry-label").textContent, "Rename “Clear 40” to");
  assert.equal(input.value, "Clear 40");
  assert.equal(action(view, "confirm-entry").textContent, "Rename");
  input.value = "Clear 45";
  key(input, "Enter");
  await tick();
  assert.deepEqual(recipes.requests[0], { action: "renameRecipe", args: { id: "r2", name: "Clear 45" } });
  assert.equal(noteOf(view).textContent, actions.WORDING.renamed("Clear 45"));

  click(action(view, "more"));
  click(action(view, "duplicate"));
  assert.equal(input.value, "Clear 40 copy");
  click(action(view, "confirm-entry"));
  await tick();
  assert.deepEqual(recipes.requests[1], { action: "duplicateRecipe", args: { id: "r2", name: "Clear 40 copy" } });
  assert.equal(view.getState().selectedId, "r7");
  assert.equal(noteOf(view).textContent, actions.WORDING.duplicated("Clear 40 copy"));
});

test("Refresh asks refresh; a failure is said", async () => {
  const { view, recipes } = boot(bookOf(), { answer: name => (name === "refresh" ? { ok: false, code: "network_error", message: "Offline." } : undefined) });
  click(action(view, "refresh"));
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "refresh" }]);
  assert.equal(noteOf(view).textContent, "Offline.");
  assert.ok(noteOf(view).classList.contains("is-error"));
});

test("while a request is pending every action is disabled but the rows stay clickable, and a second click asks nothing", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { view, recipes } = boot(bookOf(), { answer: name => (name === "loadRecipe" ? held : undefined) });
  click(rows(view)[1]);
  click(action(view, "load"));
  click(qa(view, "[data-book-action='confirm-load']")[0]);
  await tick();
  assert.equal(view.getState().pending, "load");
  assert.ok(qa(view, "[data-book-action]").every(b => b.hasAttribute("disabled")));
  click(action(view, "save-current"));
  click(rows(view)[0]);
  assert.equal(view.getState().selectedId, "r2", "rows still select");
  assert.equal(recipes.requests.length, 1);
  release({ ok: true });
  await tick();
  assert.equal(view.getState().pending, null);
  assert.ok(!action(view, "save-current").hasAttribute("disabled"));
});

test("a publish redraws the list and keeps the entry and its typing; a vanished selection is dropped, and its rename entry with it", () => {
  const { view, recipes } = boot(bookOf());
  click(action(view, "save-current"));
  const entry = q(view, ".slate-book__entry");
  const input = q(view, ".slate-book__name");
  input.value = "Half typ";
  click(rows(view)[1]);
  recipes.set(bookOf({ recipes: [recipeOf("r1", "Blue film"), recipeOf("r4", "Fresh")], count: 2 }));
  assert.deepEqual(rows(view).map(r => r.getAttribute("data-recipe")), ["r1", "r4"]);
  assert.ok(q(view, ".slate-book__entry") === entry, "the entry row was rebuilt");
  assert.equal(input.value, "Half typ");
  assert.ok(!entry.hasAttribute("hidden"));
  assert.equal(view.getState().selectedId, "r1");
  assert.equal(rows(view)[0].getAttribute("aria-pressed"), "true");

  click(action(view, "cancel-entry"));
  click(action(view, "more"));
  click(action(view, "rename"));
  assert.ok(!entry.hasAttribute("hidden"));
  recipes.set(bookOf({ recipes: [recipeOf("r4", "Fresh")], count: 1 }));
  assert.equal(view.getState().selectedId, null);
  assert.ok(entry.hasAttribute("hidden"), "a rename of a vanished recipe stays open");
  assert.ok(q(view, ".slate-book__hint"));
});

test("read-only withholds every write with the reason, keeps Refresh, and closes an open entry or confirm when it turns on", () => {
  const { view, said, setReadOnly } = boot(bookOf(), { resolved: withPlan() });
  click(rows(view)[1]);
  click(action(view, "load"));
  click(action(view, "cancel-confirm"));
  click(action(view, "save-current"));
  assert.ok(!q(view, ".slate-book__entry").hasAttribute("hidden"));
  setReadOnly(true);
  assert.ok(q(view, ".slate-book__entry").hasAttribute("hidden"));
  for (const name of ["save-current", "save-next", "load", "update"]) {
    assert.equal(action(view, name).getAttribute("data-able"), "false", name);
    assert.equal(action(view, name).getAttribute("title"), `Unavailable: ${actions.READ_ONLY_REASON}`);
  }
  assert.equal(action(view, "refresh").getAttribute("data-able"), "true");
  click(action(view, "load"));
  assert.equal(q(view, ".slate-book__confirm"), null);
  assert.match(said[0], /Load is unavailable: Slate is read-only/);
  click(action(view, "more"));
  for (const name of ["rename", "duplicate", "delete"]) assert.equal(action(view, name).getAttribute("data-able"), "false", name);

  setReadOnly(false);
  assert.equal(action(view, "load").getAttribute("data-able"), "true");
  click(action(view, "load"));
  assert.ok(q(view, ".slate-book__confirm"));
  setReadOnly(true);
  assert.equal(q(view, ".slate-book__confirm"), null, "a confirm survived read-only");
});

test("Save Next follows the plan through update(); onHide closes everything", () => {
  const { view } = boot(bookOf());
  assert.equal(action(view, "save-next").getAttribute("data-able"), "false");
  view.update(withPlan(), { kind: "structural" });
  assert.equal(action(view, "save-next").getAttribute("data-able"), "true");
  click(action(view, "save-next"));
  click(rows(view)[0]);
  click(action(view, "update"));
  assert.ok(q(view, ".slate-book__confirm"));
  view.onHide();
  assert.ok(q(view, ".slate-book__entry").hasAttribute("hidden"));
  assert.equal(q(view, ".slate-book__confirm"), null);
  assert.equal(view.getState().selectedId, "r2", "the selection is kept across a hide");
});

test("a delete answered after the operator selected another recipe leaves that selection alone", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { view, recipes } = boot(bookOf(), { answer: name => (name === "deleteRecipe" ? held : undefined) });
  click(rows(view)[1]);
  click(action(view, "more"));
  click(action(view, "delete"));
  click(action(view, "confirm"));
  await tick();
  assert.equal(view.getState().pending, "remove");
  click(rows(view)[0]);
  assert.equal(view.getState().selectedId, "r2");
  release({ ok: true });
  await tick();
  assert.deepEqual(recipes.requests, [{ action: "deleteRecipe", args: { id: "r1" } }]);
  assert.equal(view.getState().selectedId, "r2", "the stale delete took the new selection");
  assert.equal(noteOf(view).textContent, actions.WORDING.deleted("Blue film"));
  assert.equal(q(view, ".slate-book__confirm"), null);
});

test("the name entry wraps rather than squeezing its field: a long label (the Workspaces entry) takes its own line", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "slate/styles/components/recipe-book.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const entry = css.match(/\n\.slate-book__entry \{([^}]*)\}/)[1];
  assert.match(entry, /flex-wrap: wrap;/);
  const label = css.match(/\n\.slate-book__entry-label \{([^}]*)\}/)[1];
  assert.doesNotMatch(label, /white-space:\s*nowrap/);
  const name = css.match(/\n\.slate-book__name \{([^}]*)\}/)[1];
  assert.match(name, /flex: 1 1 12em;/, "the field needs a basis so it wraps to its own line instead of collapsing");
});

/* ----------------------------------------------------------------------
 *   The list: at most eight, and a search
 * -------------------------------------------------------------------- */

const manyRecipes = count => bookOf({ recipes: Array.from({ length: count }, (_, i) => recipeOf(`m${i + 1}`, i % 3 === 0 ? `Blue film ${i + 1}` : `Clear ${i + 1}`)), count });
const typeSearch = (view, value) => { const field = q(view, "[data-book-search]"); field.value = value; field.dispatchEvent({ type: "input", target: field }); return field; };

test("visibleRecipes narrows by name - case and spacing aside - keeps the order, and shows at most the limit; moreText says when more exist", () => {
  assert.equal(book.LIST_LIMIT, 8);
  const list = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: i < 4 ? `Blue  Film ${i}` : `Clear ${i}` }));
  const all = book.visibleRecipes(list, "", 8);
  assert.deepEqual(all.shown.map(one => one.id), ["x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7"]);
  assert.equal(all.matched, 12);
  assert.equal(book.moreText(all, ""), "Showing 8 of 12. Search to find the others.");
  const blue = book.visibleRecipes(list, "  blue FILM ", 8);
  assert.deepEqual(blue.shown.map(one => one.id), ["x0", "x1", "x2", "x3"]);
  assert.equal(book.moreText(blue, "blue"), "");
  assert.equal(book.visibleRecipes(list, "nothing", 8).shown.length, 0);
  // "l" is in every name: more matches than the list shows.
  assert.equal(book.moreText(book.visibleRecipes(list, "l", 8), "l"), "Showing 8 of 12 matches. Search more precisely to narrow them.");
  // "c" matches exactly eight: all shown, nothing more to say.
  assert.equal(book.moreText(book.visibleRecipes(list, "c", 8), "c"), "");
});

test("the list shows no more than eight recipes with a line saying how many more; the search above it narrows them as it is typed, Escape empties it, and none matching is said", () => {
  const { view, recipes } = boot(manyRecipes(12));
  assert.equal(rows(view).length, 8);
  const more = q(view, ".slate-book__more");
  assert.ok(!more.hasAttribute("hidden"));
  assert.equal(more.textContent, "Showing 8 of 12. Search to find the others.");
  const field = typeSearch(view, "blue");
  assert.deepEqual(rows(view).map(row => row.querySelector(".slate-book__row-name").textContent), ["Blue film 1", "Blue film 4", "Blue film 7", "Blue film 10"]);
  assert.ok(more.hasAttribute("hidden"));
  // Selecting from the narrowed list works and sends nothing.
  click(rows(view)[1]);
  assert.equal(view.getState().selectedId, "m4");
  assert.equal(recipes.requests.length, 0);
  // A publish keeps the typing and the narrowing.
  recipes.set(manyRecipes(12));
  assert.equal(q(view, "[data-book-search]").value, "blue");
  assert.equal(rows(view).length, 4);
  typeSearch(view, "zzz");
  assert.equal(rows(view).length, 0);
  assert.match(q(view, ".slate-book__list .slate-book__empty").textContent, /No saved recipe matches “zzz”/);
  const escape = key(field, "Escape");
  assert.equal(field.value, "");
  assert.equal(escape._stopped, true);
  assert.equal(rows(view).length, 8);
});

test("the search stands only over a list with recipes in it", () => {
  const empty = boot(bookOf({ recipes: [], count: 0 }));
  assert.ok(q(empty.view, "[data-book-search]").hasAttribute("hidden"));
  const few = boot(bookOf());
  assert.ok(!q(few.view, "[data-book-search]").hasAttribute("hidden"));
  assert.ok(q(few.view, ".slate-book__more").hasAttribute("hidden"), "a short list says there are more");
});
