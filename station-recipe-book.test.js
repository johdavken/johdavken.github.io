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
    replaceRecipe: async ({ id }) => { env.calls.push(["replaceRecipe", id]); env.handle.publish(); return { ok: true, item: { id } }; },
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
function blendSurface(layers) {
  const state = { active: false, flipped: new Set(), calls: [] };
  return {
    state,
    surface: {
      available: () => true,
      canEnter: () => true,
      isActive: () => state.active,
      layers: () => layers.map(id => ({ id, roleLabel: "Layer", flipped: state.flipped.has(id) })),
      enter() { state.calls.push(["enter"]); state.active = true; state.flipped.clear(); return true; },
      exit() { state.calls.push(["exit"]); state.active = false; state.flipped.clear(); return true; },
      flip(id, on) { state.calls.push(["flip", id, on]); if (on) state.flipped.add(id); else state.flipped.delete(id); return true; },
      flipAll(on) { state.calls.push(["flipAll", on]); state.flipped = new Set(on ? layers : []); return true; }
    }
  };
}

function build(env, blend) {
  const doc = fakeDocument();
  const book = bookModule.create(doc, { recipes: env ? env.bridge : null, blend: blend ? blend.surface : null });
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
  click(byAction(root, "confirm-save"));
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
  click(byAction(root, "cancel-save"));
  assert.ok(hidden(entry));
  click(byAction(root, "save-current"));
  key(input, "Escape");
  assert.ok(hidden(entry));
  assert.equal(env.calls.length, 1);
});

test("a duplicate name is the application's answer: the book offers to replace the recipe it collides with, by id, or to rename", async () => {
  const env = producer();
  const { root, book } = build(env);
  click(byAction(root, "save-current"));
  const input = root.querySelector(".station-book__name");
  input.value = "clear FILM";
  click(byAction(root, "confirm-save"));
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
  click(byAction(root, "confirm-save"));
  await tick();
  input.value = "Clear film B";
  click(byAction(root, "confirm-save"));
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
  click(byAction(root, "confirm-save"));
  assert.equal(book.getState().pending, "saveCurrentRecipe");
  assert.equal(byAction(root, "confirm-save").disabled, true);
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
 *   Blend Edit's controls
 * -------------------------------------------------------------------- */

test("Blend Edit is entered by its own button and not by opening the book or selecting a recipe", () => {
  const env = producer();
  const blend = blendSurface(["A", "B", "C"]);
  const { root, book } = build(env, blend);
  book.update();
  click(rows(root)[0]);
  assert.deepEqual(blend.state.calls, [], "browsing entered Blend Edit");
  assert.ok(hidden(root.querySelector("[data-role='blend-controls']")));
  click(byAction(root, "blend-edit"));
  assert.deepEqual(blend.state.calls, [["enter"]]);
  assert.ok(!hidden(root.querySelector("[data-role='blend-controls']")));
  assert.ok(hidden(root.querySelector(".station-book__toolbar")), "the toolbar gives way to the mode's controls");
  assert.ok(hidden(root.querySelector(".station-book__columns")));
});

test("the mode's controls show which layers are turned over, turn one or all, and Done leaves - all through the surface, nothing kept here", () => {
  const env = producer();
  const blend = blendSurface(["A", "B", "C"]);
  const { root, book } = build(env, blend);
  click(byAction(root, "blend-edit"));
  const chips = () => root.querySelectorAll(".station-book__layer-chip");
  assert.deepEqual(chips().map(chip => [chip.getAttribute("data-layer"), chip.getAttribute("aria-pressed")]), [["A", "false"], ["B", "false"], ["C", "false"]]);
  assert.match(root.querySelector(".station-book__blend-hint").textContent, /Select layers to edit their blends in place/);
  // The longer explanation is behind the information mark, on the tab
  // order, not on the bench.
  const info = root.querySelector(".station-book__blend-info");
  assert.equal(info.getAttribute("tabindex"), "0");
  assert.match(info.getAttribute("title"), /Turn a layer over here to edit its blend in place; its share stays editable in its header/);
  assert.match(info.getAttribute("aria-label"), /Done turns them back/);
  assert.equal(byAction(root, "show-all").disabled, true);
  assert.equal(byAction(root, "edit-all").disabled, false);
  click(chips()[1]);
  assert.deepEqual(blend.state.calls.slice(1), [["flip", "B", true]]);
  assert.deepEqual(chips().map(chip => chip.getAttribute("aria-pressed")), ["false", "true", "false"]);
  assert.match(root.querySelector(".station-book__blend-hint").textContent, /1 of 3 layers turned over/);
  click(byAction(root, "edit-all"));
  assert.deepEqual(blend.state.calls.slice(2), [["flipAll", true]]);
  assert.deepEqual(chips().map(chip => chip.getAttribute("aria-pressed")), ["true", "true", "true"]);
  assert.equal(byAction(root, "edit-all").disabled, true);
  click(chips()[0]);
  assert.deepEqual(blend.state.calls.slice(3), [["flip", "A", false]]);
  click(byAction(root, "show-all"));
  assert.deepEqual(blend.state.calls.slice(4), [["flipAll", false]]);
  click(byAction(root, "done"));
  assert.deepEqual(blend.state.calls.slice(5), [["exit"]]);
  assert.ok(hidden(root.querySelector("[data-role='blend-controls']")));
  assert.ok(!hidden(root.querySelector(".station-book__toolbar")));
  // The surface is the only record: a section rebuilt from the same
  // surface shows the same chips, and the book's own state knows no layer.
  assert.deepEqual(Object.keys(book.getState()).sort(), ["duplicate", "entryOpen", "note", "noteKind", "pending", "selectedId"]);
  // The mode is the stage's: told from outside, the section follows.
  blend.surface.enter();
  book.update();
  assert.ok(!hidden(root.querySelector("[data-role='blend-controls']")));
});

test("without a Blend Edit surface, or a line to edit, the button is disabled and says so", () => {
  const env = producer();
  const none = build(env, null);
  assert.equal(byAction(none.root, "blend-edit").disabled, true);
  const blend = blendSurface([]);
  blend.surface.canEnter = () => false;
  const empty = build(env, blend);
  assert.equal(byAction(empty.root, "blend-edit").disabled, true);
  assert.match(byAction(empty.root, "blend-edit").getAttribute("title"), /needs a line with layers/);
  const readOnly = blendSurface(["A"]);
  readOnly.surface.available = () => false;
  const ro = build(env, readOnly);
  click(byAction(ro.root, "blend-edit"));
  assert.match(ro.root.querySelector(".station-book__blend-hint").textContent, /read-only here/);
});

test("the section is what the Handbook takes: an id, a title and a builder, with no state of its own outside create()", () => {
  assert.deepEqual(Object.keys(bookModule.section).sort(), ["create", "id", "title"]);
  assert.equal(bookModule.section.id, "recipe-book");
  assert.equal(bookModule.section.title, "Recipe Book");
  assert.ok(Object.isFrozen(bookModule.section));
  assert.equal(bookModule.normalizedName("  Clear   FILM "), "clear film");
  assert.match(bookModule.rowMeta({ layers: [{}], updatedAt: "" }), /^1 layer$/);
});
