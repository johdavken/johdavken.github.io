"use strict";

/* The Recipe Book (station/station-recipe-book.js), the Handbook's first
 * section, driven against a small fake DOM and a real recipes bridge with
 * a recording producer behind it. What is pinned: the list is the bridge's
 * book and nothing else; selecting a recipe shows it and asks the
 * application for nothing; Save Current is one request carrying the name;
 * a duplicate is resolved by replacing, by id, or by renaming; Blend
 * Edit's controls go through the surface the section was handed and hold
 * nothing of their own.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const bookModule = require("./station/station-recipe-book.js");
const bridgeModule = require("./station-recipes-bridge.js");

/* ----------------------------------------------------------------------
 *   A fake DOM
 * -------------------------------------------------------------------- */

let focused = null;

function makeNode(name) {
  const node = {
    tagName: name.toUpperCase(),
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    value: "",
    disabled: false,
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatchEvent(event) {
      event.target = event.target || this;
      let n = this;
      while (n && !event.stopped) {
        for (const fn of n.listeners[event.type] || []) fn(event);
        if (!event.bubbles) break;
        n = n.parent;
      }
      return true;
    },
    focus() { focused = this; },
    select() {},
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attributes.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attributes.class = [...set].join(" "); },
      contains(name) { return classSet(node).has(name); },
      toggle(name, force) { const on = force === undefined ? !classSet(node).has(name) : !!force; (on ? this.add : this.remove)(name); return on; }
    }
  };
  return node;
}
function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matchesOne(node, selector) {
  const parts = selector.match(/(\.[a-z0-9_-]+|\[[a-z-]+(?:='[^']*')?\]|[a-z]+)/gi) || [];
  return parts.every(part => {
    if (part.startsWith(".")) return classSet(node).has(part.slice(1));
    const attr = part.match(/^\[([a-z-]+)(?:='([^']*)')?\]$/);
    if (attr) return attr[2] === undefined ? node.hasAttribute(attr[1]) : node.getAttribute(attr[1]) === attr[2];
    return node.tagName === part.toUpperCase();
  });
}
function matches(node, selector) { return selector.split(",").some(one => matchesOne(node, one.trim())); }
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function fakeDocument() {
  const doc = makeNode("#document");
  doc.createElement = name => makeNode(name);
  return doc;
}
const click = node => node.dispatchEvent({ type: "click", bubbles: true });
const key = (node, k) => node.dispatchEvent({ type: "keydown", key: k, bubbles: true, stopPropagation() { this.stopped = true; }, preventDefault() {} });
const hidden = node => node.hasAttribute("hidden");
const byAction = (root, name) => root.querySelector(`[data-action='${name}']`);
const rows = root => root.querySelectorAll(".station-book__row");
const noteOf = root => root.querySelector(".station-book__note");
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

/* ----------------------------------------------------------------------
 *   A producer: Line 9's two recipes, and recorded actions
 * -------------------------------------------------------------------- */

function recipePayload(mode) {
  return {
    schema_version: 1, line_type: 3, hopper_naming_mode: mode || "standard",
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layer_pct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({ resin_name: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "", pct: index === 0 ? 60 : index === 1 ? 40 : 0 }))
    }))
  };
}

function envelope(recipes) {
  return { ok: true, workspaceId: "ws-9", cachedAt: 1, items: { receiver_weight_profile: [], recipe: recipes } };
}

function item(id, name, favorite, mode) {
  return { id, workspaceId: "ws-9", type: "recipe", name, normalizedName: name.toLowerCase(), schemaVersion: 1, payload: recipePayload(mode), favorite: !!favorite, createdBy: "u", updatedBy: "u", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z" };
}

function producer(overrides) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = {
    calls: [],
    recipes: [item("r-fav", "Clear film", true), item("r-2", "Heavy gauge", false, "main")],
    workspaceId: "ws-9", refreshing: false
  };
  const actions = Object.assign({
    saveCurrentRecipe: async ({ name }) => {
      env.calls.push(["saveCurrentRecipe", name]);
      if (env.recipes.some(recipe => recipe.normalizedName === name.toLowerCase())) return { ok: false, code: "duplicate_name", message: "A configuration with that name already exists." };
      env.recipes.push(item("r-new", name));
      env.handle.publish();
      return { ok: true, item: { id: "r-new" } };
    },
    saveNextRecipe: async ({ name }) => {
      env.calls.push(["saveNextRecipe", name]);
      if (env.recipes.some(recipe => recipe.normalizedName === name.toLowerCase())) return { ok: false, code: "duplicate_name", message: "A configuration with that name already exists." };
      env.recipes.push(item("r-plan", name));
      env.handle.publish();
      return { ok: true, item: { id: "r-plan" } };
    },
    replaceRecipe: async ({ id }) => { env.calls.push(["replaceRecipe", id]); env.handle.publish(); return { ok: true, item: { id } }; },
    loadRecipe: async ({ id, destination }) => { env.calls.push(["loadRecipe", id, destination]); return { ok: true }; },
    renameRecipe: async ({ id, name }) => {
      env.calls.push(["renameRecipe", id, name]);
      if (env.recipes.some(recipe => recipe.normalizedName === name.toLowerCase())) return { ok: false, code: "duplicate_name", message: "A configuration with that name already exists." };
      const existing = env.recipes.find(recipe => recipe.id === id); existing.name = name; existing.normalizedName = name.toLowerCase();
      env.handle.publish();
      return { ok: true, item: { id } };
    },
    duplicateRecipe: async ({ id, name }) => { env.calls.push(["duplicateRecipe", id, name]); env.recipes.push(item("r-copy", name)); env.handle.publish(); return { ok: true, item: { id: "r-copy" } }; },
    deleteRecipe: async ({ id }) => { env.calls.push(["deleteRecipe", id]); env.recipes = env.recipes.filter(recipe => recipe.id !== id); env.handle.publish(); return { ok: true }; },
    refresh: async () => { env.calls.push(["refresh"]); return { ok: true }; }
  }, overrides || {});
  env.handle = bridge.connect({
    read: () => bridgeModule.project(envelope(env.recipes), { workspaceId: env.workspaceId, displayName: "Line 9", refreshing: env.refreshing }),
    actions
  });
  env.bridge = bridge;
  return env;
}

/* A Blend Edit surface that records what it was asked. */
function build(env, extra) {
  const doc = fakeDocument();
  const book = bookModule.create(doc, Object.assign({ recipes: env ? env.bridge : null }, extra || {}));
  return { doc, book, root: book.element };
}

/* ----------------------------------------------------------------------
 *   Reading the book
 * -------------------------------------------------------------------- */

test("the list is the bridge's book: every saved recipe, favourites first as the service orders them, with a one-line meta", () => {
  const env = producer();
  const { root } = build(env);
  const listed = rows(root);
  assert.deepEqual(listed.map(row => row.getAttribute("data-recipe")), ["r-fav", "r-2"]);
  assert.deepEqual(listed.map(row => row.querySelector(".station-book__row-name").textContent), ["Clear film", "Heavy gauge"]);
  assert.ok(listed[0].classList.contains("is-favorite"));
  assert.ok(!listed[1].classList.contains("is-favorite"));
  assert.match(listed[0].querySelector(".station-book__row-meta").textContent, /^3 layers · /);
  assert.equal(root.querySelector(".station-book__context").textContent, "Line 9 · 2 saved");
  assert.equal(byAction(root, "save-current").disabled, false);
  // Nothing selected: the detail invites, and no request has been made.
  assert.match(root.querySelector(".station-book__detail").querySelector(".station-book__empty").textContent, /Select a saved recipe/);
  assert.deepEqual(env.calls, []);
});

test("a publish redraws the list from the new book; a selection that vanished is dropped", () => {
  const env = producer();
  const { root, book } = build(env);
  book.update();
  click(rows(root)[1]);
  assert.equal(book.getState().selectedId, "r-2");
  env.recipes = [env.recipes[0]];
  env.handle.publish();
  book.update();
  assert.deepEqual(rows(root).map(row => row.getAttribute("data-recipe")), ["r-fav"]);
  assert.equal(book.getState().selectedId, null);
});

test("with no application, or no line, the book says so and offers no save", () => {
  const none = build(null);
  assert.equal(rows(none.root).length, 0);
  assert.match(none.root.querySelector(".station-book__empty").textContent, /No application is connected/);
  assert.equal(byAction(none.root, "save-current").disabled, true);
  assert.equal(byAction(none.root, "refresh").disabled, true);
  assert.equal(none.root.querySelector(".station-book__context").textContent, "Not connected");
  const env = producer();
  env.workspaceId = "";
  env.handle.publish();
  const unassigned = build(env);
  assert.match(unassigned.root.querySelector(".station-book__empty").textContent, /not on a production line/);
  assert.equal(byAction(unassigned.root, "save-current").disabled, true);
  assert.equal(unassigned.root.querySelector(".station-book__context").textContent, "No line");
  assert.equal(bookModule.emptyText({ assigned: true, refreshing: true, count: 0 }, true), "Reading the line's saved recipes…");
});

/* ----------------------------------------------------------------------
 *   Selecting: safe browsing
 * -------------------------------------------------------------------- */

test("selecting a recipe shows its blend, hopper by hopper in the line's naming, and asks the application for nothing", () => {
  const env = producer();
  const { root, book } = build(env);
  click(rows(root)[1]);
  assert.equal(rows(root)[1].getAttribute("aria-pressed"), "true");
  assert.equal(rows(root)[0].getAttribute("aria-pressed"), "false");
  const detail = root.querySelector(".station-book__detail");
  assert.equal(detail.querySelector(".station-book__detail-name").textContent, "Heavy gauge");
  const layers = detail.querySelectorAll(".station-book__layer");
  assert.deepEqual(layers.map(layer => layer.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.deepEqual(layers.map(layer => layer.getAttribute("data-layer-role")), ["outside", "core", "inside"]);
  assert.deepEqual(layers.map(layer => layer.querySelector(".station-book__layer-share").textContent), ["30%", "40%", "30%"]);
  // "main" naming: AM, A1 - the same helper the drawn hoppers are named by.
  const hoppers = layers[0].querySelectorAll(".station-book__hopper");
  assert.deepEqual(hoppers.map(h => h.querySelector(".station-book__hopper-id").textContent.trim()), ["AM", "A1"]);
  assert.deepEqual(hoppers.map(h => h.querySelector(".station-book__hopper-resin").textContent), ["HX0", "LD0"]);
  assert.deepEqual(hoppers.map(h => h.querySelector(".station-book__hopper-pct").textContent.trim()), ["60%", "40%"]);
  click(rows(root)[0]);
  assert.deepEqual(layers.length, 3);
  assert.deepEqual(root.querySelectorAll(".station-book__layer")[0].querySelectorAll(".station-book__hopper").map(h => h.querySelector(".station-book__hopper-id").textContent.trim()), ["A1", "A2"]);
  // A second click on the selected recipe deselects it.
  click(rows(root)[0]);
  assert.equal(book.getState().selectedId, null);
  assert.deepEqual(env.calls, [], "browsing made a request");
  // No load, no apply: the section has no such control and no such word.
  assert.equal(root.querySelector("[data-action='load'], [data-action='apply'], [data-action='load-current'], [data-action='load-next']"), null);
});

/* ----------------------------------------------------------------------
 *   Save Current
 * -------------------------------------------------------------------- */

test("Save Current asks for a name in place and hands the application one saveCurrentRecipe with it; the new recipe is then selected", async () => {
  const env = producer();
  const { root, book } = build(env);
  const entry = root.querySelector(".station-book__entry");
  assert.ok(hidden(entry));
  click(byAction(root, "save-current"));
  assert.ok(!hidden(entry));
  const input = root.querySelector(".station-book__name");
  assert.equal(focused, input);
  // A blank name goes nowhere.
  click(byAction(root, "confirm-entry"));
  await tick();
  assert.deepEqual(env.calls, []);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.match(noteOf(root).textContent, /Give the recipe a name/);
  input.value = "  Barrier   run ";
  key(input, "Enter");
  await tick();
  assert.deepEqual(env.calls, [["saveCurrentRecipe", "Barrier run"]]);
  assert.ok(hidden(entry));
  assert.equal(noteOf(root).getAttribute("data-kind"), "ok");
  assert.match(noteOf(root).textContent, /Saved “Barrier run”/);
  assert.equal(book.getState().selectedId, "r-new");
  assert.deepEqual(rows(root).map(row => row.getAttribute("data-recipe")), ["r-fav", "r-2", "r-new"]);
  assert.equal(root.querySelector(".station-book__detail-name").textContent, "Barrier run");
  // Cancel closes the entry and asks nothing.
  click(byAction(root, "save-current"));
  click(byAction(root, "cancel-entry"));
  assert.ok(hidden(entry));
  click(byAction(root, "save-current"));
  key(input, "Escape");
  assert.ok(hidden(entry));
  assert.equal(env.calls.length, 1);
});

test("Save Next stands beside Save Current: held with the reason until the boot file says a plan exists, then the same entry asks for a name for the planned recipe and hands one saveNextRecipe; a taken name offers no Replace", async () => {
  const env = producer();
  const plan = { on: false };
  const { root, book } = build(env, { planned: () => plan.on });
  const saveNext = byAction(root, "save-next");
  const saveCurrent = byAction(root, "save-current");
  assert.ok(saveNext.parent === saveCurrent.parent, "on the toolbar");
  assert.ok(saveNext.parent.children.indexOf(saveNext) === saveCurrent.parent.children.indexOf(saveCurrent) + 1, "next to Save Current");
  assert.equal(saveNext.textContent, "Save Next");
  assert.equal(saveNext.classList.contains("is-primary"), false, "Save Current leads");
  assert.equal(saveNext.disabled, true);
  assert.equal(saveNext.getAttribute("title"), "Plan a Next Recipe on the stage before saving it.");
  click(saveNext);
  assert.ok(hidden(root.querySelector(".station-book__entry")), "held: nothing opens");
  plan.on = true;
  book.update();
  assert.equal(saveNext.disabled, false);
  assert.equal(saveNext.getAttribute("title"), "Save the planned recipe to this line's shared recipes.");
  click(saveNext);
  const entry = root.querySelector(".station-book__entry");
  assert.ok(!hidden(entry));
  assert.equal(root.querySelector(".station-book__entry-label").textContent, "Save the planned recipe as");
  assert.equal(root.querySelector("[data-action='confirm-entry']").textContent, "Save");
  assert.deepEqual(book.getState().entry, { mode: "save", id: null, recipe: "next" });
  const input = root.querySelector(".station-book__name");
  assert.equal(focused, input);
  input.value = " Tomorrow  film ";
  key(input, "Enter");
  await tick();
  assert.deepEqual(env.calls, [["saveNextRecipe", "Tomorrow film"]]);
  assert.ok(hidden(entry));
  assert.match(noteOf(root).textContent, /Saved “Tomorrow film”/);
  assert.equal(book.getState().selectedId, "r-plan");
  assert.equal(root.querySelector(".station-book__detail-name").textContent, "Tomorrow film");
  // A taken name: the message, no Replace (Update writes the running recipe).
  click(saveNext);
  input.value = "Clear film";
  click(byAction(root, "confirm-entry"));
  await tick();
  assert.deepEqual(env.calls.at(-1), ["saveNextRecipe", "Clear film"]);
  assert.match(noteOf(root).textContent, /already exists\. Choose another name\./);
  assert.doesNotMatch(noteOf(root).textContent, /Replace it/);
  assert.ok(hidden(byAction(root, "replace")), "no Replace for a plan's save");
  assert.equal(book.getState().duplicate, null);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.ok(!hidden(entry), "the entry stays for another name");
  // Save Current after it is its own entry again.
  click(byAction(root, "cancel-entry"));
  click(saveCurrent);
  assert.equal(root.querySelector(".station-book__entry-label").textContent, "Save the running recipe as");
  assert.deepEqual(book.getState().entry, { mode: "save", id: null, recipe: "current" });
  // Without a reader in the context, Save Next is never offered.
  const bare = build(env);
  assert.equal(byAction(bare.root, "save-next").disabled, true);
  assert.equal(byAction(bare.root, "save-current").disabled, false);
});

test("a duplicate name is the application's answer: the book offers to replace the recipe it collides with, by id, or to rename", async () => {
  const env = producer();
  const { root, book } = build(env);
  click(byAction(root, "save-current"));
  const input = root.querySelector(".station-book__name");
  input.value = "clear FILM";
  click(byAction(root, "confirm-entry"));
  await tick();
  assert.deepEqual(env.calls, [["saveCurrentRecipe", "clear FILM"]]);
  assert.equal(noteOf(root).getAttribute("data-kind"), "error");
  assert.match(noteOf(root).textContent, /“Clear film” already exists\. Replace it/);
  assert.ok(!hidden(root.querySelector(".station-book__entry")), "the entry stays open to rename");
  assert.deepEqual(book.getState().duplicate, { name: "clear FILM", id: "r-fav" });
  assert.equal(book.getState().selectedId, "r-fav", "the colliding recipe is shown");
  const replace = byAction(root, "replace");
  assert.ok(!hidden(replace));
  click(replace);
  await tick();
  assert.deepEqual(env.calls[1], ["replaceRecipe", "r-fav"]);
  assert.match(noteOf(root).textContent, /Replaced “clear FILM”/);
  assert.ok(hidden(root.querySelector(".station-book__entry")));
  assert.ok(hidden(replace));
  assert.equal(book.getState().duplicate, null);
  // Renaming instead: a new name goes as a new save.
  click(byAction(root, "save-current"));
  input.value = "Clear film";
  click(byAction(root, "confirm-entry"));
  await tick();
  input.value = "Clear film B";
  click(byAction(root, "confirm-entry"));
  await tick();
  assert.deepEqual(env.calls.slice(2), [["saveCurrentRecipe", "Clear film"], ["saveCurrentRecipe", "Clear film B"]]);
  assert.equal(book.getState().selectedId, "r-new");
});

test("a failed save says why and leaves the entry and the list as they were; while a request runs the actions are held", async () => {
  let release;
  const env = producer({
    saveCurrentRecipe: () => new Promise(resolve => { release = () => resolve({ ok: false, code: "network_error", message: "Workspace configurations could not reach Supabase." }); })
  });
  const { root, book } = build(env);
  click(byAction(root, "save-current"));
  root.querySelector(".station-book__name").value = "New one";
  click(byAction(root, "confirm-entry"));
  assert.equal(book.getState().pending, "saveCurrentRecipe");
  assert.equal(byAction(root, "confirm-entry").disabled, true);
  assert.equal(byAction(root, "save-current").disabled, true);
  release();
  await tick();
  assert.equal(book.getState().pending, null);
  assert.equal(noteOf(root).getAttribute("data-kind"), "error");
  assert.match(noteOf(root).textContent, /could not reach Supabase/);
  assert.ok(!hidden(root.querySelector(".station-book__entry")), "the name is kept for a retry");
  assert.equal(root.querySelector(".station-book__name").value, "New one");
  assert.deepEqual(rows(root).map(row => row.getAttribute("data-recipe")), ["r-fav", "r-2"]);
});

test("Refresh is one request, and its failure is said", async () => {
  const env = producer({ refresh: async () => ({ ok: false, code: "network_error", message: "Offline." }) });
  const { root } = build(env);
  click(byAction(root, "refresh"));
  await tick();
  assert.match(noteOf(root).textContent, /Offline/);
  const ok = producer();
  const good = build(ok);
  click(byAction(good.root, "refresh"));
  await tick();
  assert.deepEqual(ok.calls, [["refresh"]]);
  assert.ok(hidden(noteOf(good.root)));
});

/* ----------------------------------------------------------------------
 *   Blend Edit is not the book's
 * -------------------------------------------------------------------- */

test("the book carries no Blend Edit control and no page for the mode: the toolbar is Save Current, Save Next, Refresh and the line, whatever a context hands it", () => {
  const env = producer();
  // A context that still names a blend surface (an older boot file) changes
  // nothing: the book neither reads it nor draws for it.
  const calls = [];
  const stale = { isActive() { calls.push("isActive"); return true; }, enter() { calls.push("enter"); }, layers() { calls.push("layers"); return []; } };
  const { root, book } = build(env, { blend: stale });
  book.update();
  assert.deepEqual(root.querySelectorAll("[data-action]").map(node => node.getAttribute("data-action")),
    ["save-current", "save-next", "refresh", "confirm-entry", "replace", "cancel-entry"]);
  assert.equal(root.querySelector("[data-role='blend-controls']"), null);
  assert.equal(root.querySelectorAll(".station-book__layer-chip").length, 0);
  assert.equal(root.querySelector(".station-book__blend"), null);
  assert.deepEqual(calls, [], "the book asked the surface nothing");
  assert.doesNotMatch(root.textContent, /Blend Edit|Edit all|Show all hoppers|Done/);
  // The list and the toolbar are showing, the way they always are.
  assert.ok(!hidden(root.querySelector(".station-book__toolbar")));
  assert.ok(!hidden(root.querySelector(".station-book__columns")));
  click(rows(root)[0]);
  assert.equal(root.querySelector(".station-book__detail-name").textContent, "Clear film");
  // Nor does the source know the mode: no surface, no flip, no exit.
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "station/station-recipe-book.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(source, /\bblend\.\w|flipAll|flipLayer|exitBlendEdit|enterBlendEdit|blend-controls|blend-edit|isActive/);
});

test("the name entry opens and closes on its own, with nothing else on the bench giving way", () => {
  const env = producer();
  const { root } = build(env);
  const entry = root.querySelector(".station-book__entry");
  assert.ok(hidden(entry));
  click(byAction(root, "save-current"));
  assert.ok(!hidden(entry));
  assert.ok(!hidden(root.querySelector(".station-book__columns")), "the list stays");
  assert.ok(!hidden(root.querySelector(".station-book__toolbar")), "the toolbar stays");
  click(byAction(root, "cancel-entry"));
  assert.ok(hidden(entry));
});

test("the section is what the Handbook takes: an id, a title and a builder, with no state of its own outside create()", () => {
  assert.deepEqual(Object.keys(bookModule.section).sort(), ["create", "id", "title"]);
  assert.equal(bookModule.section.id, "recipe-book");
  assert.equal(bookModule.section.title, "Recipe Book");
  assert.ok(Object.isFrozen(bookModule.section));
  // A page of lists: it tells the Handbook it can use more bench, so the
  // frame's grip is offered on it (station-handbook.js).
  assert.equal(build(producer()).book.grows(), true);
  assert.equal(build(null).book.grows(), true, "the answer is the page's kind, not its connection");
  assert.equal(bookModule.normalizedName("  Clear   FILM "), "clear film");
  assert.match(bookModule.rowMeta({ layers: [{}], updatedAt: "" }), /^1 layer$/);
});

/* ----------------------------------------------------------------------
 *   The selected recipe's controls: Load, Update, and More
 * -------------------------------------------------------------------- */

const threeLayers = () => ({ layers: [{ id: "A" }, { id: "B" }, { id: "C" }] });
const detailOf = root => root.querySelector(".station-book__detail");
const confirmOf = root => root.querySelector(".station-book__confirm");
const isPrimary = node => node.classList.contains("is-primary");

test("a selected recipe offers Load first, Update second, and the rest behind More - one primary at a time, nothing sent by any of it", () => {
  const env = producer();
  const { root } = build(env, { model: threeLayers });
  assert.equal(byAction(root, "load"), null, "nothing selected: no actions");
  assert.ok(isPrimary(byAction(root, "save-current")));
  click(rows(root)[1]);
  const load = byAction(root, "load"), update = byAction(root, "update"), more = byAction(root, "more");
  assert.ok(load && update && more);
  assert.ok(isPrimary(load), "Load leads");
  assert.ok(!isPrimary(update) && !isPrimary(more));
  assert.ok(!isPrimary(byAction(root, "save-current")), "Save Current steps back behind the selection's Load");
  assert.ok(hidden(root.querySelector(".station-book__overflow")));
  assert.equal(more.getAttribute("aria-expanded"), "false");
  click(more);
  assert.ok(!hidden(root.querySelector(".station-book__overflow")));
  assert.equal(byAction(root, "more").getAttribute("aria-expanded"), "true");
  assert.deepEqual(root.querySelector(".station-book__overflow").children.map(b => b.getAttribute("data-action")), ["rename", "duplicate", "delete"]);
  assert.ok(byAction(root, "delete").classList.contains("is-danger"));
  // Selecting another recipe closes the overflow.
  click(rows(root)[0]);
  assert.ok(hidden(root.querySelector(".station-book__overflow")));
  assert.equal(confirmOf(root), null);
  assert.deepEqual(env.calls, []);
});

test("Load asks where, with what changes and what does not: Current (the running recipe, the line told at once) or Next (the plan only); each is one loadRecipe with that destination", async () => {
  const env = producer();
  const { root } = build(env, { model: threeLayers });
  click(rows(root)[0]);
  click(byAction(root, "load"));
  const confirm = confirmOf(root);
  assert.ok(confirm);
  assert.equal(confirm.getAttribute("data-kind"), "load");
  const words = confirm.querySelector(".station-book__confirm-text").textContent;
  assert.match(words, /^Clear film\. Load into Current changes the line type, hopper naming mode, layer percentages and resin assignments of the RUNNING recipe, and the line is told at once\./);
  assert.match(words, /Receiver weights, tracking, pump-off state, timeline and runtime state, workspace, RT Sync identity and appearance are not changed\./);
  assert.match(words, /Load into Next replaces only the planned Next Recipe/);
  const buttons = confirm.querySelectorAll("[data-action='confirm-load']");
  assert.deepEqual(buttons.map(b => [b.textContent, b.getAttribute("data-destination"), isPrimary(b), b.disabled]), [["Load into Current", "current", true, false], ["Load into Next", "next", false, false]]);
  assert.ok(!isPrimary(byAction(root, "load")), "the question's own action is the primary while it is open");
  assert.deepEqual(env.calls, [], "asking sends nothing");
  // Cancel sends nothing and closes the question.
  click(byAction(root, "cancel-confirm"));
  assert.equal(confirmOf(root), null);
  assert.deepEqual(env.calls, []);
  // Current.
  click(byAction(root, "load"));
  click(confirmOf(root).querySelector("[data-destination='current']"));
  await tick();
  assert.deepEqual(env.calls, [["loadRecipe", "r-fav", "current"]]);
  assert.equal(confirmOf(root), null);
  assert.equal(noteOf(root).getAttribute("data-kind"), "ok");
  assert.match(noteOf(root).textContent, /Loaded “Clear film” into Current: it is the running recipe now\./);
  // Next.
  click(byAction(root, "load"));
  click(confirmOf(root).querySelector("[data-destination='next']"));
  await tick();
  assert.deepEqual(env.calls[1], ["loadRecipe", "r-fav", "next"]);
  assert.match(noteOf(root).textContent, /into Next: it is the planned recipe now\. The running recipe is untouched\./);
  assert.equal(rows(root)[0].getAttribute("aria-pressed"), "true", "the selection stands after a load");
});

test("a recipe saved for another layer count says so, and its Load into Current is held with the reason while Load into Next stays offered; with no line model the question is the application's", async () => {
  const env = producer();
  env.recipes[1].payload.line_type = 5;
  const { root } = build(env, { model: threeLayers });
  click(rows(root)[1]);
  const compat = root.querySelector(".station-book__compat");
  assert.ok(compat);
  assert.equal(compat.getAttribute("data-kind"), "incompatible");
  assert.equal(compat.textContent, "This recipe is set up for 5 layers, but this line runs 3. It can be loaded into Next, not into Current.");
  assert.equal(byAction(root, "load").disabled, false, "the question can still be asked: Next is open");
  click(byAction(root, "load"));
  const buttons = confirmOf(root).querySelectorAll("[data-action='confirm-load']");
  assert.equal(buttons[0].disabled, true);
  assert.match(buttons[0].getAttribute("title"), /set up for 5 layers/);
  assert.equal(buttons[1].disabled, false);
  click(buttons[0]);
  await tick();
  assert.deepEqual(env.calls, [], "a held control takes no click");
  click(buttons[1]);
  await tick();
  assert.deepEqual(env.calls, [["loadRecipe", "r-2", "next"]]);
  // No model handed in: nothing is held here; the application decides.
  const { root: bare } = build(producer());
  click(rows(bare)[1]);
  assert.equal(bare.querySelector(".station-book__compat"), null);
  // Selecting the matching recipe: no note.
  click(rows(root)[0]);
  assert.equal(root.querySelector(".station-book__compat"), null);
});

test("a load the application refuses is said, with its reason, and changes nothing here", async () => {
  const env = producer({ loadRecipe: async () => ({ ok: false, code: "incompatible", message: "This recipe is set up for 5 layers, but this line runs 3. Nothing was changed." }) });
  const { root } = build(env, { model: threeLayers });
  click(rows(root)[0]);
  click(byAction(root, "load"));
  click(confirmOf(root).querySelector("[data-destination='current']"));
  await tick();
  assert.equal(noteOf(root).getAttribute("data-kind"), "error");
  assert.equal(noteOf(root).textContent, "This recipe is set up for 5 layers, but this line runs 3. Nothing was changed.");
  assert.equal(confirmOf(root), null);
  assert.equal(rows(root)[0].getAttribute("aria-pressed"), "true");
});

test("Update asks, then is one replaceRecipe by id; Delete asks in the danger colour, then is one deleteRecipe, and the selection is dropped with the recipe", async () => {
  const env = producer();
  const { root } = build(env, { model: threeLayers });
  click(rows(root)[1]);
  click(byAction(root, "update"));
  assert.equal(confirmOf(root).getAttribute("data-kind"), "update");
  assert.match(confirmOf(root).querySelector(".station-book__confirm-text").textContent, /^Replace “Heavy gauge” with the running recipe\? This will save line type, layer percentages, resin assignments and hopper percentages\. It will not save receiver weights, tracking, pump-off, timeline or runtime state\.$/);
  const go = byAction(root, "confirm");
  assert.equal(go.textContent, "Update");
  assert.ok(isPrimary(go));
  click(go);
  await tick();
  assert.deepEqual(env.calls, [["replaceRecipe", "r-2"]]);
  assert.match(noteOf(root).textContent, /Updated “Heavy gauge” with the running recipe\./);
  assert.equal(rows(root)[1].getAttribute("aria-pressed"), "true");
  // Delete.
  click(byAction(root, "more"));
  click(byAction(root, "delete"));
  assert.ok(hidden(root.querySelector(".station-book__overflow")), "the overflow closes when a question opens");
  assert.equal(confirmOf(root).getAttribute("data-kind"), "delete");
  assert.equal(confirmOf(root).querySelector(".station-book__confirm-text").textContent, "Delete “Heavy gauge” from this line's shared recipes?");
  const del = byAction(root, "confirm");
  assert.equal(del.textContent, "Delete");
  assert.ok(del.classList.contains("is-danger"));
  click(del);
  await tick();
  assert.deepEqual(env.calls[1], ["deleteRecipe", "r-2"]);
  assert.equal(rows(root).length, 1);
  assert.equal(book(root), null);
  assert.match(noteOf(root).textContent, /Deleted “Heavy gauge”\./);
  assert.equal(byAction(root, "load"), null, "nothing is selected any more");
  function book(node) { return node.querySelector("[data-recipe='r-2']"); }
});

test("Rename and Duplicate ask for a name in the same entry, prefilled, and are one request each with the id and the name; a taken name is the application's answer, said and marked", async () => {
  const env = producer();
  const { root } = build(env, { model: threeLayers });
  const input = root.querySelector(".station-book__name");
  click(rows(root)[0]);
  click(byAction(root, "more"));
  click(byAction(root, "rename"));
  assert.ok(!hidden(root.querySelector(".station-book__entry")));
  assert.equal(root.querySelector(".station-book__entry-label").textContent, "Rename “Clear film” to");
  assert.equal(byAction(root, "confirm-entry").textContent, "Rename");
  assert.equal(input.value, "Clear film");
  assert.deepEqual(root.querySelectorAll("[data-action='replace']").map(hidden), [true], "no Replace offer outside a save");
  input.value = "Heavy gauge";
  key(input, "Enter");
  await tick();
  assert.deepEqual(env.calls, [["renameRecipe", "r-fav", "Heavy gauge"]]);
  assert.equal(noteOf(root).getAttribute("data-kind"), "error");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.ok(!hidden(root.querySelector(".station-book__entry")), "the entry stays for another name");
  input.value = "Clear film v2";
  click(byAction(root, "confirm-entry"));
  await tick();
  assert.deepEqual(env.calls[1], ["renameRecipe", "r-fav", "Clear film v2"]);
  assert.ok(hidden(root.querySelector(".station-book__entry")));
  assert.equal(rows(root)[0].querySelector(".station-book__row-name").textContent, "Clear film v2", "the book redrew from the publish");
  assert.match(noteOf(root).textContent, /Renamed to “Clear film v2”\./);
  // Duplicate: prefilled as a copy, the copy selected after.
  click(byAction(root, "more"));
  click(byAction(root, "duplicate"));
  assert.equal(root.querySelector(".station-book__entry-label").textContent, "Duplicate “Clear film v2” as");
  assert.equal(input.value, "Clear film v2 copy");
  assert.equal(byAction(root, "confirm-entry").textContent, "Duplicate");
  key(input, "Enter");
  await tick();
  assert.deepEqual(env.calls[2], ["duplicateRecipe", "r-fav", "Clear film v2 copy"]);
  assert.equal(root.querySelector("[data-recipe='r-copy']").getAttribute("aria-pressed"), "true");
  assert.match(noteOf(root).textContent, /Duplicated as “Clear film v2 copy”\./);
  // Escape closes a rename entry with nothing sent; a blank name is refused here.
  click(byAction(root, "more"));
  click(byAction(root, "rename"));
  input.value = "  ";
  key(input, "Enter");
  await tick();
  assert.equal(env.calls.length, 3);
  assert.equal(noteOf(root).textContent, "Give the recipe a name.");
  key(input, "Escape");
  assert.ok(hidden(root.querySelector(".station-book__entry")));
  assert.equal(env.calls.length, 3);
});

test("while a request runs every control is held; a publish that drops the selected recipe clears its question and overflow; selecting another recipe closes an open rename", async () => {
  let release;
  const env = producer({ deleteRecipe: () => new Promise(resolve => { release = resolve; }) });
  const { root, book } = build(env, { model: threeLayers });
  click(rows(root)[1]);
  click(byAction(root, "more"));
  click(byAction(root, "delete"));
  click(byAction(root, "confirm"));
  assert.equal(book.getState().pending, "deleteRecipe");
  assert.ok(byAction(root, "load").disabled && byAction(root, "update").disabled && byAction(root, "more").disabled);
  assert.ok(byAction(root, "save-current").disabled && byAction(root, "refresh").disabled);
  assert.ok(byAction(root, "confirm").disabled);
  release({ ok: true });
  await tick();
  assert.equal(book.getState().pending, null);
  // The recipe vanishing from the book, from elsewhere.
  click(rows(root)[0]);
  click(byAction(root, "update"));
  click(byAction(root, "more"));
  assert.ok(confirmOf(root));
  env.recipes = env.recipes.filter(recipe => recipe.id !== "r-fav");
  env.handle.publish();
  book.update();
  assert.equal(book.getState().selectedId, null);
  assert.equal(book.getState().confirm, null);
  assert.equal(book.getState().moreOpen, false);
  assert.equal(confirmOf(root), null);
  // A rename entry closes when the selection moves; a save entry does not.
  const fresh = producer();
  const { root: r2, book: b2 } = build(fresh, { model: threeLayers });
  click(rows(r2)[0]);
  click(byAction(r2, "more"));
  click(byAction(r2, "rename"));
  click(rows(r2)[1]);
  assert.equal(b2.getState().entry, null);
  click(byAction(r2, "save-current"));
  click(rows(r2)[0]);
  assert.deepEqual(b2.getState().entry, { mode: "save", id: null, recipe: "current" });
  assert.deepEqual(fresh.calls, []);
});
