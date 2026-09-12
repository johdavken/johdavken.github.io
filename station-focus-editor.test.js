"use strict";

/* The focused layer's recipe editor (station/station-focus-editor.js): the
 * rows, the blend total, the resin search, and the keyboard paths - built
 * against a small fake DOM with events, so what is tested is the structure
 * and the behaviour, not a browser.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const editor = require("./station/station-focus-editor.js");
const lineModel = require("./station/station-line-model.js");
const stationSource = require("./station/station-source.js");
const contract = require("./station-command-contract.js");
const commandBridge = require("./station-command-bridge.js");
const hookups = require("./hookup-sources.js");

const ROOT = __dirname;

/* ----------------------------------------------------------------------
 *   A fake DOM: attributes, classes, a few selectors, and bubbling events
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
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parent = null;
      return child;
    },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) {
      const out = [];
      walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); });
      return out;
    },
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
      return !event.defaultPrevented;
    },
    focus() { focused = this; },
    select() { this.selected = true; },
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attributes.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attributes.class = [...set].join(" "); },
      contains(name) { return classSet(node).has(name); },
      toggle(name, force) { const on = force === undefined ? !classSet(node).has(name) : !!force; (on ? this.add : this.remove)(name); return on; }
    }
  };
  return node;
}

function classSet(node) {
  return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean));
}

function matches(node, selector) {
  const attr = selector.match(/^\[([a-z-]+)='([^']+)'\]$/);
  if (attr) return node.getAttribute(attr[1]) === attr[2];
  const bare = selector.match(/^\[([a-z-]+)\]$/);
  if (bare) return node.hasAttribute(bare[1]);
  const cls = selector.match(/^\.([a-z0-9_-]+)$/i);
  if (cls) return classSet(node).has(cls[1]);
  throw new Error(`unsupported selector ${selector}`);
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

const fakeDocument = () => ({ createElement: name => makeNode(name) });

function event(type, extra) {
  return Object.assign({
    type, bubbles: true, stopped: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }
  }, extra || {});
}

const textOf = (root, className) => root.querySelectorAll(`.${className}`).map(n => n.textContent);

/* ----------------------------------------------------------------------
 *   Fixtures
 * -------------------------------------------------------------------- */

function layerOf(config, id) {
  const model = lineModel.buildLineModel(Object.assign({
    lineKey: "test", displayName: "Test line", layerCount: 5, layerAPosition: "outside",
    hopperNamingMode: "standard", hopperCount: 6
  }, config || {}));
  return model.layers.find(layer => layer.id === id);
}

const STATE = {
  "D:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" },
  "D:1": { assigned: true, resinName: "LD105", pct: 30, source: "" },
  "D:2": { assigned: true, resinName: "EVA340", pct: 10, source: "BOX 12" }
};

const CATALOG = [
  { resin_code: "1018", density_g_cm3: 0.918 },
  { resin_code: "HD7845", density_g_cm3: 0.958 },
  { resin_code: "HX204", density_g_cm3: 0.92 },
  { resin_code: "LD165", density_g_cm3: 0.922 },
  { resin_code: "LD317", density_g_cm3: 0.926 },
  { resin_code: "EXXON LD105.30", density_g_cm3: 0.923 },
  { resin_code: "9659HD", density_g_cm3: null }
];

/* ----------------------------------------------------------------------
 *   A stand-in for the application's side of the bridge
 * -------------------------------------------------------------------- */

/* The real contract and a real (isolated) command bridge, with the
 * application's executor replaced by the smallest thing that answers
 * in its shapes: a mutable copy of the fixture, the executor's own
 * no-op rule (an unchanged value changes nothing, saves nothing, records
 * nothing), H1 derived from the rest, sources resin-guarded and outside
 * history. The snapshot each answer carries is built the way the state
 * bridge builds its own - frozen, hoppers by index, sources by position -
 * and read back through station-source's hopperStateFrom, so the editor
 * is exercised over the same derivation the boot file uses. */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function fakeApp(options) {
  const settings = options || {};
  const hopperState = settings.hopperState || STATE;
  const hoppers = [0, 1, 2, 3, 4, 5].map(index => {
    const runtime = hopperState[`D:${index}`] || {};
    return { index, resinName: runtime.resinName || "", pct: Number.isFinite(runtime.pct) ? runtime.pct : 0 };
  });
  const sources = {};
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const runtime = hopperState[`D:${index}`];
    if (runtime && runtime.resinName && runtime.source) sources[`D:${index}`] = { resin: runtime.resinName, source: runtime.source };
  }
  const log = { calls: [], history: [], saves: 0, revision: 100 };

  function snapshot() {
    return deepFreeze({
      line: { lineNumber: "1", layerCount: 5 },
      layers: [{ name: "D", layerPct: 20, hoppers: hoppers.map(h => ({ index: h.index, pct: h.pct, resinName: h.resinName, track: false, pumpOff: false, usableHeight: 0 })) }],
      sources: { current: JSON.parse(JSON.stringify(sources)), next: {} },
      revision: log.revision
    });
  }
  function done(changed) {
    if (changed) { log.revision += 1; log.saves += 1; }
    return contract.success({ changed, revision: log.revision, persisted: changed, snapshot: snapshot() });
  }
  const executor = {
    setHopperResin(args) {
      const hopper = hoppers[args.index];
      if (hopper.resinName === args.resin) return done(false);
      log.history.push(`resin ${args.recipe}`);
      hopper.resinName = args.resin;
      return done(true);
    },
    setHopperBlend(args) {
      if (args.index === 0) return contract.failure("h1_derived");
      const others = hoppers.slice(1).map((h, i) => (i === args.index - 1 ? args.pct : h.pct));
      const total = others.reduce((sum, v) => sum + v, 0);
      if (total > 100) return contract.failure("blend_total", { total, message: "Hopper percentages 2–6 cannot total more than 100%." });
      const hopper = hoppers[args.index];
      if (hopper.pct === args.pct) return done(false);
      log.history.push(`blend ${args.recipe}`);
      hopper.pct = args.pct;
      hoppers[0].pct = 100 - total;
      return done(true);
    },
    setSource(args) {
      const hopper = hoppers[args.index];
      if (!hopper.resinName) return contract.failure("no_resin");
      const key = `D:${args.index}`;
      if (hookups.sourceForPosition(sources, key, hopper.resinName) === args.source) return done(false);
      if (args.source) sources[key] = { resin: hopper.resinName, source: args.source };
      else delete sources[key];
      return done(true);   // no history: sources are not recipe state
    }
  };
  const bridge = commandBridge.create();
  const declared = settings.capabilities || Object.keys(executor);
  bridge.connect({
    execute(command, args) {
      log.calls.push({ command, args });
      if (settings.refuse && settings.refuse[command]) return contract.failure(settings.refuse[command]);
      return executor[command](args);
    },
    capabilities: declared
  });
  return Object.assign(log, {
    bridge,
    hoppers,
    sources,
    hopperState: () => stationSource.hopperStateFrom(snapshot()),
    resinOf: index => hoppers[index].resinName,
    pctOf: index => hoppers[index].pct,
    sourceOf: index => hookups.sourceForPosition(sources, `D:${index}`, hoppers[index].resinName)
  });
}

/* An editor over the fake application: editing unless told otherwise.
 * `onCommitted` does what the boot file does - runs the publish policy's
 * editor half, update(), over the result's snapshot - so what the rows
 * show after a command is what the application answered with. */
function build(options) {
  focused = null;
  const doc = fakeDocument();
  const given = Object.assign({}, options || {});
  const app = given.app === null ? null : (given.app || fakeApp({ hopperState: given.hopperState, capabilities: given.capabilities, refuse: given.refuse }));
  delete given.app; delete given.capabilities; delete given.refuse;
  const committed = [];
  const holder = {};
  const settings = Object.assign({
    layer: layerOf(null, "D"),
    hopperState: STATE,
    resins: () => CATALOG,
    commands: app ? app.bridge : null,
    recipe: app ? "current" : null,
    onCommitted: result => {
      committed.push(result);
      if (holder.update) holder.update({ hopperState: stationSource.hopperStateFrom(result.snapshot) });
    }
  }, given);
  const built = editor.create(doc, settings);
  holder.update = built.update;
  return Object.assign({ doc, root: built.element, app, committed }, built);
}

/* A read-only editor: nothing connected to the bridge. */
const buildReadOnly = options => build(Object.assign({ app: null }, options || {}));

/* ----------------------------------------------------------------------
 *   The blend
 * -------------------------------------------------------------------- */

test("blendFor derives one row per hopper, in order, with the total over every row", () => {
  const blend = editor.blendFor(layerOf(null, "D"), STATE);
  assert.deepEqual(blend.rows.map(r => r.id), ["D1", "D2", "D3", "D4", "D5", "D6"]);
  assert.deepEqual(blend.rows.slice(0, 3).map(r => [r.resin, r.pct, r.source]),
    [["HX204", 60, "SILO 3"], ["LD105", 30, ""], ["EVA340", 10, "BOX 12"]]);
  assert.equal(blend.rows[3].assigned, false);
  assert.equal(blend.total, 100);
  assert.equal(blend.valid, true);
  assert.equal(blend.assigned.length, 3);
});

test("blendFor flags a total other than 100, and counts a percentage with no resin", () => {
  const blend = editor.blendFor(layerOf(null, "D"), Object.assign({}, STATE, { "D:3": { pct: 15, resinName: "" } }));
  assert.equal(blend.total, 115);
  assert.equal(blend.valid, false);
  assert.equal(blend.rows[3].assigned, true, "a hopper with a share counts as assigned");
  assert.equal(editor.blendFor(null, STATE), null);
});

/* ----------------------------------------------------------------------
 *   The list
 * -------------------------------------------------------------------- */

test("the editor is a stacked list, not a table: one item per hopper, badge, percentage input, resin, source", () => {
  const { root } = build();
  assert.equal(root.getAttribute("data-layer"), "D");
  assert.equal(root.getAttribute("data-role"), "focus-editor");
  assert.ok(!root.querySelector(".station-blend"), "no table");
  walk(root, node => assert.notEqual(node.tagName, "TABLE"));

  const items = root.querySelectorAll(".station-editor__item");
  assert.equal(items.length, 6);
  assert.equal(items[0].tagName, "LI");
  assert.deepEqual(items.map(i => i.getAttribute("data-hopper")), ["D1", "D2", "D3", "D4", "D5", "D6"]);
  assert.ok(items.every(i => i.getAttribute("data-layer") === "D"));

  assert.deepEqual(textOf(root, "station-editor__badge"), ["D1", "D2", "D3", "D4", "D5", "D6"]);
  // The badge is static: no button, no input.
  for (const badge of root.querySelectorAll(".station-editor__badge")) assert.equal(badge.tagName, "SPAN");

  const pct = items[0].querySelector(".station-editor__pct-input");
  assert.equal(pct.tagName, "INPUT");
  assert.equal(pct.value, "60");
  assert.equal(pct.getAttribute("inputmode"), "decimal");
  assert.ok(pct.hasAttribute("readonly"), "H1's share is derived from the others: its field is read-only even while editing");
  assert.ok(!items[1].querySelector(".station-editor__pct-input").hasAttribute("readonly"), "D2's percentage is editable");
  assert.equal(pct.getAttribute("aria-label"), "D1 blend percentage");

  assert.equal(items[0].querySelector(".station-editor__resin-value").textContent, "HX204");
  assert.equal(items[0].querySelector(".station-editor__source-value").textContent, "SILO 3");
  // The header carries the layer's identity and its role, and the mode.
  assert.deepEqual(textOf(root, "station-editor__title"), ["Layer D"]);
  assert.deepEqual(textOf(root, "station-editor__role"), ["Inside subskin"]);
  assert.deepEqual(textOf(root, "station-editor__mode"), ["Editing"]);
  assert.equal(root.getAttribute("data-layer-role"), "subskin-inside");
});

test("a missing source is a quiet placeholder, not a warning", () => {
  const { root } = build();
  const d2 = root.querySelector("[data-hopper='D2']");
  const source = d2.querySelector(".station-editor__source-value");
  assert.equal(source.textContent, "Add source");
  assert.ok(source.classList.contains("is-placeholder"));
  assert.ok(!/NO SOURCE/i.test(d2.textContent));
});

test("an empty hopper is one placeholder, aligned with the rest: no fields, no source line", () => {
  const { root } = build();
  const d4 = root.querySelector("[data-hopper='D4']");
  assert.ok(d4.classList.contains("is-empty"));
  assert.equal(d4.querySelectorAll(".station-editor__pct-input").length, 0);
  assert.equal(d4.querySelectorAll(".station-editor__source-value").length, 0);
  const add = d4.querySelector(".station-editor__resin-value");
  assert.ok(add.classList.contains("is-placeholder"));
  assert.deepEqual(add.children.map(n => n.textContent), ["+", "Add resin"]);
  assert.equal(add.getAttribute("aria-label"), "Add resin to D4");
  // Still a full row: badge, and the percentage column kept for alignment.
  assert.equal(d4.querySelector(".station-editor__badge").textContent, "D4");
  assert.equal(d4.querySelectorAll(".station-editor__pct").length, 1);
});

test("the selected hopper's row is marked, and clicking a row reports its hopper", () => {
  const chosen = [];
  const { root } = build({ selected: "D2", onSelect: id => chosen.push(id) });
  assert.ok(root.querySelector("[data-hopper='D2']").classList.contains("is-selected"));
  assert.ok(!root.querySelector("[data-hopper='D1']").classList.contains("is-selected"));
  // A click anywhere in the row - here on the badge - selects the hopper.
  root.querySelector("[data-hopper='D3']").querySelector(".station-editor__badge").dispatchEvent(event("click"));
  assert.deepEqual(chosen, ["D3"]);
});

/* ----------------------------------------------------------------------
 *   The total
 * -------------------------------------------------------------------- */

test("the blend total is persistent and plain at 100%", () => {
  const { root } = build();
  const total = root.querySelector(".station-editor__total");
  assert.ok(!total.classList.contains("is-invalid"));
  assert.deepEqual(textOf(root, "station-editor__total-value"), ["100%"]);
  assert.equal(root.querySelectorAll(".station-editor__total-flag").length, 0);
});

test("a total other than 100% is flagged, in the editor, not in an alert", () => {
  const { root } = build({ hopperState: Object.assign({}, STATE, { "D:1": { resinName: "LD105", pct: 40 } }) });
  const total = root.querySelector(".station-editor__total");
  assert.ok(total.classList.contains("is-invalid"));
  assert.deepEqual(textOf(root, "station-editor__total-value"), ["110%"]);
  assert.deepEqual(textOf(root, "station-editor__total-flag"), ["≠ 100%"]);
});

test("a layer with nothing assigned shows no total rather than a bad one", () => {
  const { root } = build({ hopperState: {} });
  const total = root.querySelector(".station-editor__total");
  assert.ok(total.classList.contains("is-empty"));
  assert.ok(!total.classList.contains("is-invalid"));
  assert.deepEqual(textOf(root, "station-editor__total-value"), ["—"]);
  assert.equal(root.querySelectorAll(".station-editor__total-flag").length, 0);
  assert.equal(root.querySelectorAll(".is-empty").length, 7, "six empty rows and the total");
});

/* ----------------------------------------------------------------------
 *   Resin search
 * -------------------------------------------------------------------- */

test("filterResins ranks codes that start with the query before codes that contain it", () => {
  assert.deepEqual(editor.filterResins(CATALOG, "ld").map(r => r.resin_code), ["LD165", "LD317", "EXXON LD105.30"]);
  assert.deepEqual(editor.filterResins(CATALOG, "HD").map(r => r.resin_code), ["HD7845", "9659HD"]);
  assert.deepEqual(editor.filterResins(CATALOG, "zzz"), []);
  // An empty query is the start of the catalog, capped.
  assert.deepEqual(editor.filterResins(CATALOG, "", 2).map(r => r.resin_code), ["1018", "HD7845"]);
  assert.equal(editor.filterResins(CATALOG, "").length, 7);
  assert.equal(editor.filterResins(null, "x").length, 0);
});

test("activating the resin value opens a combobox over the shared catalog, filtered as the operator types", () => {
  const { root } = build();
  const d1 = root.querySelector("[data-hopper='D1']");
  const button = d1.querySelector(".station-editor__resin-value");
  assert.equal(button.getAttribute("aria-haspopup"), "listbox");
  button.dispatchEvent(event("click"));

  assert.ok(d1.classList.contains("is-searching"));
  assert.ok(button.hasAttribute("hidden"), "the resting value steps aside");
  const input = d1.querySelector(".station-editor__search");
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.value, "HX204", "the search starts from the current value");
  assert.equal(focused, input, "focus moves into the search");
  const list = d1.querySelector(".station-editor__results");
  assert.equal(list.getAttribute("role"), "listbox");
  assert.equal(input.getAttribute("aria-controls"), list.getAttribute("id"));

  input.value = "ld";
  input.dispatchEvent(event("input"));
  assert.deepEqual(textOf(list, "station-editor__option-code"), ["LD165", "LD317", "EXXON LD105.30"]);
  assert.deepEqual(textOf(list, "station-editor__option-note"), ["0.922 g/cm³", "0.926 g/cm³", "0.923 g/cm³"]);
  const options = list.querySelectorAll(".station-editor__option");
  assert.equal(options[0].getAttribute("aria-selected"), "true");
  assert.equal(input.getAttribute("aria-activedescendant"), options[0].getAttribute("id"));

  input.value = "nothing";
  input.dispatchEvent(event("input"));
  assert.deepEqual(textOf(list, "station-editor__no-match"), ["No matching resin"]);
});

test("choosing a result hands the resin to the application as setHopperResin, and the row shows what it answered", () => {
  const { root, app, committed } = build();
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const input = d1.querySelector(".station-editor__search");
  input.value = "ld";
  input.dispatchEvent(event("input"));
  input.dispatchEvent(event("keydown", { key: "ArrowDown" }));
  assert.equal(input.getAttribute("aria-activedescendant"), d1.querySelectorAll(".station-editor__option")[1].getAttribute("id"));
  input.dispatchEvent(event("keydown", { key: "Enter" }));

  assert.ok(!d1.classList.contains("is-searching"));
  assert.equal(d1.querySelectorAll(".station-editor__search").length, 0, "the search is removed");
  // One command, fully addressed: the recipe the boot file named, this
  // layer, this hopper, the chosen code.
  assert.deepEqual(app.calls, [{ command: "setHopperResin", args: { recipe: "current", layer: "D", index: 0, resin: "LD317" } }]);
  assert.equal(app.resinOf(0), "LD317", "the application's hopper was changed");
  assert.deepEqual(app.history, ["resin current"], "one recipe history entry");
  assert.equal(app.saves, 1, "one save");
  // The row shows the application's answer, not the request: the resin is
  // the new code, and D1's source - SILO 3, a label for HX204 - is gone
  // with it, because the application resolves sources against the resin.
  const button = d1.querySelector(".station-editor__resin-value");
  assert.ok(!button.hasAttribute("hidden"));
  assert.equal(button.textContent, "LD317");
  assert.equal(d1.querySelector(".station-editor__source-value").textContent, "Add source", "the pruned source is still shown");
  assert.equal(focused, button, "focus returns to the value");
  assert.equal(root.querySelector(".station-editor__note").textContent, "", "a success has nothing to explain");
  assert.equal(committed.length, 1);
  assert.equal(committed[0].revision, 101);
  assert.ok(Object.isFrozen(committed[0].snapshot));
});

test("Escape cancels the search without reaching the document, and a click on an option chooses it", () => {
  const { root, app } = build();
  const d2 = root.querySelector("[data-hopper='D2']");
  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const escape = event("keydown", { key: "Escape" });
  d2.querySelector(".station-editor__search").dispatchEvent(escape);
  assert.ok(escape.stopped, "Escape must not also close the layer");
  assert.ok(!d2.classList.contains("is-searching"));
  assert.equal(root.querySelector(".station-editor__note").textContent, "");
  assert.equal(app.calls.length, 0, "cancelling hands nothing over");

  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const option = d2.querySelectorAll(".station-editor__option")[0];
  const down = event("mousedown");
  option.dispatchEvent(down);
  assert.ok(down.defaultPrevented, "mousedown on an option must not blur the input first");
  option.dispatchEvent(event("click"));
  assert.ok(!d2.classList.contains("is-searching"));
  // D2 holds LD105, so the search opened on that and the first match is the
  // catalog's LD105 variant - chosen and applied.
  assert.deepEqual(app.calls.map(c => c.args.resin), ["EXXON LD105.30"]);
  assert.equal(d2.querySelector(".station-editor__resin-value").textContent, "EXXON LD105.30");
});

test("an empty hopper's placeholder opens the same search, over the whole catalog", () => {
  const { root } = build();
  const d5 = root.querySelector("[data-hopper='D5']");
  d5.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const input = d5.querySelector(".station-editor__search");
  assert.equal(input.value, "");
  assert.equal(d5.querySelectorAll(".station-editor__option").length, 7);
});

test("the search reads the catalog it is given and never a list of its own", () => {
  let asked = 0;
  const { root } = build({ resins: () => { asked++; return [{ resin_code: "ONLY" }]; } });
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  assert.equal(asked, 1);
  assert.deepEqual(textOf(d1, "station-editor__option-code"), []);
  const input = d1.querySelector(".station-editor__search");
  input.value = "on";
  input.dispatchEvent(event("input"));
  assert.deepEqual(textOf(d1, "station-editor__option-code"), ["ONLY"]);
  const source = fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8");
  assert.doesNotMatch(source, /resin_code:\s*"/, "the editor module hard-codes resin records");
});

/* ----------------------------------------------------------------------
 *   Keyboard
 * -------------------------------------------------------------------- */

test("every value is in the Tab order, in reading order: resin, source, percentage, next hopper", () => {
  const { root } = build();
  const slots = root.querySelectorAll("[data-slot]").map(n => `${n.closest("[data-hopper]").getAttribute("data-hopper")}:${n.getAttribute("data-slot")}`);
  assert.deepEqual(slots.slice(0, 7), ["D1:resin", "D1:source", "D1:pct", "D2:resin", "D2:source", "D2:pct", "D3:resin"]);
  assert.deepEqual(slots.slice(9), ["D4:resin", "D5:resin", "D6:resin"]);
  // Nothing is a tabindex trick: they are inputs and buttons.
  for (const node of root.querySelectorAll("[data-slot]")) assert.ok(["INPUT", "BUTTON"].includes(node.tagName));
});

test("the arrow keys move between hoppers in the same slot, falling back to what the next row has", () => {
  const { root } = build();
  const pct = id => root.querySelector(`[data-hopper='${id}']`).querySelector("[data-slot='pct']");
  const down = event("keydown", { key: "ArrowDown", target: pct("D1") });
  pct("D1").dispatchEvent(down);
  assert.ok(down.defaultPrevented);
  assert.equal(focused, pct("D2"));
  // D3 -> D4 has no percentage field; land on what it has.
  pct("D3").dispatchEvent(event("keydown", { key: "ArrowDown", target: pct("D3") }));
  assert.equal(focused, root.querySelector("[data-hopper='D4']").querySelector("[data-slot='resin']"));
  // And back up from the first row goes nowhere.
  const up = event("keydown", { key: "ArrowUp", target: pct("D1") });
  pct("D1").dispatchEvent(up);
  assert.ok(!up.defaultPrevented);
});

test("a key pressed on the read-only percentage says why nothing changed", () => {
  const { root } = build();
  const input = root.querySelector("[data-hopper='D1']").querySelector("[data-slot='pct']");
  input.dispatchEvent(event("keydown", { key: "Tab" }));
  assert.equal(root.querySelector(".station-editor__note").textContent, "");
  input.dispatchEvent(event("keydown", { key: "7" }));
  assert.match(root.querySelector(".station-editor__note").textContent, /D1's percentage was not changed/);
  assert.equal(input.value, "60");
});

/* ----------------------------------------------------------------------
 *   Discipline
 * -------------------------------------------------------------------- */

test("the editor holds no state of its own and writes nowhere", () => {
  const source = fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8");
  for (const pattern of [/localStorage/, /sessionStorage/, /\bfetch\s*\(/, /setTimeout/, /setInterval/, /requestAnimationFrame/, /\.publish\s*\(/, /\.connect\s*\(/]) {
    assert.doesNotMatch(source, pattern);
  }
  assert.match(source, /WRITE CONTRACT/, "the seams for the future write contract are marked");
});

test("both hosts load the editor module and its stylesheet, after the renderer and before the boot file", () => {
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  for (const [name, text] of [["station.html", harness], ["station-host.js", host]]) {
    assert.match(text, /station-focus-editor\.js/, `${name} does not load the editor`);
    assert.match(text, /focus-editor\.css/, `${name} does not load the editor's stylesheet`);
    assert.ok(text.indexOf("station-render.js") < text.indexOf("station-focus-editor.js"), name);
    assert.ok(text.indexOf("station-focus-editor.js") < text.indexOf("station.js?") || text.indexOf("station-focus-editor.js") < text.indexOf('"station/station.js"'), name);
  }
  // The harness reuses the application's resin catalog, so the search is
  // the same search Recipe Setup has - not a Station list.
  assert.match(harness, /resin-catalog-service\.js/);
  assert.match(harness, /resin-data\.js/);
});

/* ----------------------------------------------------------------------
 *   Result list placement
 * -------------------------------------------------------------------- */

/* Found in the cross-browser hardening pass: the stage <svg> clips at its
 * own edge (as every non-root <svg> does), so on the lower rows the list
 * ran off the bottom of the drawing and lost its last options - in both
 * Chromium and Firefox. The list is now measured and placed. */

test("placeResults keeps the list below when it fits, and flips it above when only that side has room", () => {
  const bounds = { top: 100, bottom: 700 };
  const fitsBelow = editor.placeResults({ anchor: { top: 200, bottom: 220 }, list: { height: 300 }, bounds, gap: 8 });
  assert.deepEqual(fitsBelow, { placement: "below", maxHeight: null });
  const lowRow = editor.placeResults({ anchor: { top: 560, bottom: 580 }, list: { height: 300 }, bounds, gap: 8 });
  assert.deepEqual(lowRow, { placement: "above", maxHeight: null });
});

test("placeResults clamps the list to the roomier side when it fits neither", () => {
  const bounds = { top: 100, bottom: 700 };
  const tall = editor.placeResults({ anchor: { top: 300, bottom: 320 }, list: { height: 500 }, bounds, gap: 8 });
  // 372 below (700 - 328), 192 above (292 - 100): below wins, at its room.
  assert.deepEqual(tall, { placement: "below", maxHeight: 372 });
  const tallLow = editor.placeResults({ anchor: { top: 600, bottom: 620 }, list: { height: 500 }, bounds, gap: 8 });
  assert.deepEqual(tallLow, { placement: "above", maxHeight: 492 });
});

test("placeResults with nothing to measure against is the stylesheet's default: below, unclamped", () => {
  assert.deepEqual(editor.placeResults(null), { placement: "below", maxHeight: null });
  assert.deepEqual(editor.placeResults({ anchor: { top: 0, bottom: 10 }, list: { height: 50 } }), { placement: "below", maxHeight: null });
});

test("the open list carries its placement as data, re-measured as the matches change", () => {
  // A stage 600px tall; the value sits 40px from its bottom edge.
  const rects = new Map();
  const measure = el => rects.get(el) || null;
  const { root } = build({ measure, bounds: () => ({ top: 0, bottom: 600 }) });
  const d1 = root.querySelector("[data-hopper='D1']");
  const button = d1.querySelector(".station-editor__resin-value");
  // The input is created on click; register its rect the moment it exists by
  // measuring lazily: anything not registered measures as the row's value.
  const value = { top: 540, bottom: 560 };
  const listBelow = { top: 568, bottom: 848, height: 280 };
  const measureAny = el => (el.getAttribute("role") === "listbox" ? listBelow : value);
  const { root: root2 } = build({ measure: measureAny, bounds: () => ({ top: 0, bottom: 600 }) });
  const row = root2.querySelector("[data-hopper='D1']");
  row.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const list = row.querySelector(".station-editor__results");
  assert.equal(list.getAttribute("data-placement"), "above", "280px of list under a value 40px from the edge must go above");
  assert.equal(list.getAttribute("style"), null, "540px of room above needs no clamp");

  // Typing changes the matches; the list is measured again, and a list
  // that now fits below goes back below.
  listBelow.height = 30;
  const input = row.querySelector(".station-editor__search");
  input.value = "zzz";
  input.dispatchEvent(event("input"));
  assert.equal(list.getAttribute("data-placement"), "below");

  // A stage too short for the list on either side: clamped to the roomier
  // side, as a length the stylesheet spends.
  listBelow.height = 1000;
  input.value = "";
  input.dispatchEvent(event("input"));
  assert.equal(list.getAttribute("data-placement"), "above");
  assert.equal(list.getAttribute("style"), "--station-results-max: 532px;");
  assert.ok(root && button, "the first build is exercised too");
});

test("with no measurement at all the list is simply below, so nothing here depends on a browser", () => {
  const { root } = build();
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const list = d1.querySelector(".station-editor__results");
  assert.equal(list.getAttribute("data-placement"), "below");
  assert.equal(list.getAttribute("style"), null);
});

test("pressing on the list's own surface does not blur the input, so a scrollbar can be used", () => {
  const { root } = build();
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const down = event("mousedown");
  d1.querySelector(".station-editor__results").dispatchEvent(down);
  assert.ok(down.defaultPrevented);
  assert.ok(d1.classList.contains("is-searching"));
});

test("the stylesheet spends the placement: an above list hangs from the value's top, a clamped list scrolls", () => {
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/focus-editor.css"), "utf8");
  const above = css.match(/\.station-editor__results\[data-placement="above"\]\s*\{([^}]*)\}/);
  assert.ok(above, "no rule for the above placement");
  assert.match(above[1], /top:\s*auto/);
  assert.match(above[1], /bottom:\s*calc\(100% \+ var\(--station-space-2\)\)/);
  const list = css.match(/\.station-editor__results\s*\{([^}]*)\}/);
  assert.match(list[1], /max-height:\s*var\(--station-results-max, none\)/);
  assert.match(list[1], /overflow-y:\s*auto/);
});

/* ----------------------------------------------------------------------
 *   The percentage field's width
 * -------------------------------------------------------------------- */

/* Also from the hardening pass. `3ch` clipped "100" in both engines and
 * was 20% narrower in Chromium than in Firefox: Chromium resolves `ch`
 * from the first family in the stack when that family is not installed,
 * Firefox from the font in use. The field is now sized to its value. */
test("the percentage field is sized to its value, never to a character count", () => {
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/focus-editor.css"), "utf8");
  const rule = css.match(/\.station-editor__pct-input\s*\{([^}]*)\}/);
  assert.ok(rule);
  assert.doesNotMatch(rule[1], /\dch\b/, "ch is not the same length in every engine");
  assert.match(rule[1], /--station-field-sizing:\s*content/);
  assert.match(rule[1], /--station-field-width:\s*auto/);
  assert.match(rule[1], /min-width:/, "a one-digit value must not collapse the field");
  // And the base layer's input reset is what spends the property, with the
  // browser's own sizing as the default for every other field.
  const base = fs.readFileSync(path.join(ROOT, "station/styles/base.css"), "utf8");
  const reset = base.match(/\.station-root input\s*\{([^}]*)\}/);
  assert.match(reset[1], /field-sizing:\s*var\(--station-field-sizing, fixed\)/);
});

test("the list is kept inside the foreignObject that carries the editor, not merely inside the stage", () => {
  /* Firefox paints foreignObject content past the box only as the box's
   * overflow stood at the last SVG layout; a list that grows past the edge
   * after typing is not painted or hit-tested there until the <svg> relays
   * out. Chromium keeps up. Bounding the list by the box is one rule for
   * both engines, and this pins that the box - not the <svg> - is what the
   * editor measures against. */
  const source = fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8");
  assert.match(source, /closest\("foreignObject"\)/);
  assert.doesNotMatch(source, /closest\("svg"\)/);
});

/* ----------------------------------------------------------------------
 *   Updating in place: what a publish does to an open editor
 * -------------------------------------------------------------------- */

/* Every bridge publish used to rebuild the editor, destroying an open
 * search, the caret and keyboard focus - for a weight typed on a phone.
 * The editor now takes new canonical values through update(), keeps its
 * rows, and protects whichever control the operator is in. */

function serialize(node) {
  return {
    tag: node.tagName,
    attributes: Object.assign({}, node.attributes),
    value: node.value,
    text: node.children.length ? "" : node.textContent,
    children: node.children.map(serialize)
  };
}

function withEditing(options) {
  const records = [];
  const built = build(Object.assign({ activeElement: () => focused, onEditing: record => records.push(record) }, options || {}));
  return Object.assign(built, { records });
}

const CHANGED = Object.assign({}, STATE, {
  "D:0": { assigned: true, resinName: "HX999", pct: 65, source: "SILO 3" },
  "D:1": { assigned: true, resinName: "LD105", pct: 30, source: "BOX 1" }
});

test("update patches new values into the existing rows: same items, values follow, total follows", () => {
  const { root, update } = withEditing();
  const items = root.querySelectorAll(".station-editor__item");
  update({ hopperState: CHANGED });
  assert.deepEqual(root.querySelectorAll(".station-editor__item"), items, "the row items were rebuilt");
  const d1 = items[0];
  assert.equal(d1.querySelector(".station-editor__resin-value").textContent, "HX999");
  assert.equal(d1.querySelector(".station-editor__resin-value").getAttribute("aria-label"), "D1 resin, HX999");
  assert.equal(d1.querySelector("[data-slot='pct']").value, "65");
  assert.equal(items[1].querySelector(".station-editor__source-value").textContent, "BOX 1");
  assert.ok(!items[1].querySelector(".station-editor__source-value").classList.contains("is-placeholder"));
  assert.deepEqual(textOf(root, "station-editor__total-value"), ["105%"]);
  assert.ok(root.querySelector(".station-editor__total").classList.contains("is-invalid"));
});

test("an open resin search survives a value-only update: the input, its draft, its focus and its list stay", () => {
  const { root, update } = withEditing();
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const input = d1.querySelector(".station-editor__search");
  input.value = "ld";
  input.dispatchEvent(event("input"));
  const list = d1.querySelector(".station-editor__results");

  update({ hopperState: Object.assign({}, STATE, {
    "D:0": { assigned: true, resinName: "HX204", pct: 50, source: "SILO 3" },
    "D:1": { assigned: true, resinName: "LD999", pct: 40, source: "" }
  }) });

  assert.ok(d1.classList.contains("is-searching"));
  assert.equal(d1.querySelector(".station-editor__search"), input, "the search input was replaced");
  assert.equal(focused, input, "focus left the search");
  assert.equal(input.value, "ld", "the draft was overwritten");
  assert.equal(d1.querySelector(".station-editor__results"), list);
  assert.deepEqual(textOf(list, "station-editor__option-code"), ["LD165", "LD317", "EXXON LD105.30"]);
  // The rest of the row, and the other rows, follow the publish.
  assert.equal(d1.querySelector("[data-slot='pct']").value, "50");
  assert.equal(root.querySelector("[data-hopper='D2']").querySelector(".station-editor__resin-value").textContent, "LD999");
  assert.ok(!d1.classList.contains("is-changed-underneath"), "D1's resin did not move, so nothing is marked");
  assert.equal(root.querySelector(".station-editor__note").textContent, "");
});

test("a focused input is never overwritten by a publish; a canonical move under it is marked and noted, and applied once it is left", () => {
  const { root, update, records } = withEditing();
  const d1 = root.querySelector("[data-hopper='D1']");
  const pct = d1.querySelector("[data-slot='pct']");
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  assert.deepEqual(records[records.length - 1], { layer: "D", index: 0, hopper: "D1", slot: "pct", mode: "typing", draft: "60", baseValue: 60 });

  update({ hopperState: Object.assign({}, STATE, { "D:0": { assigned: true, resinName: "HX204", pct: 75, source: "SILO 3" } }) });
  assert.equal(pct.value, "60", "the focused field's value was overwritten by the publish");
  assert.equal(d1.querySelector("[data-slot='pct']"), pct, "the focused field was replaced");
  assert.equal(focused, pct);
  assert.ok(d1.classList.contains("is-changed-underneath"));
  assert.match(root.querySelector(".station-editor__note").textContent, /D1's percentage is now 75% in the application/);
  assert.match(root.querySelector(".station-editor__note").textContent, /has not been changed/);

  // A second publish that moves it back to where the operator started
  // clears the mark: nothing is different underneath any more.
  update({ hopperState: STATE });
  assert.ok(!d1.classList.contains("is-changed-underneath"));

  update({ hopperState: Object.assign({}, STATE, { "D:0": { assigned: true, resinName: "HX204", pct: 80, source: "SILO 3" } }) });
  focused = null;
  pct.dispatchEvent(event("blur", { bubbles: false }));
  assert.equal(pct.value, "80", "once the field is left it shows the canonical value");
  assert.ok(!d1.classList.contains("is-changed-underneath"));
  assert.equal(records[records.length - 1], null, "leaving the field reports that nothing is being edited");
});

test("the editor reports the control the operator is in - search or field - and null once it is left", () => {
  const { root, records } = withEditing();
  const d2 = root.querySelector("[data-hopper='D2']");
  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  assert.deepEqual(records, [{ layer: "D", index: 1, hopper: "D2", slot: "resin", mode: "search", draft: "LD105", baseValue: "LD105" }]);
  const input = d2.querySelector(".station-editor__search");
  input.value = "hd";
  input.dispatchEvent(event("input"));
  assert.deepEqual(records[1], { layer: "D", index: 1, hopper: "D2", slot: "resin", mode: "search", draft: "hd", baseValue: "LD105" });
  input.dispatchEvent(event("keydown", { key: "Escape" }));
  assert.equal(records[2], null);
  assert.equal(records.length, 3);
  // Choosing reports the same: the search closes, so nothing is being edited.
  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  d2.querySelector(".station-editor__search").dispatchEvent(event("keydown", { key: "Enter" }));
  assert.equal(records[records.length - 1], null);
});

test("a canonical resin change under an open search marks the row and leaves the draft alone; closing shows the new value", () => {
  const { root, update } = withEditing();
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const input = d1.querySelector(".station-editor__search");
  input.value = "ld";
  input.dispatchEvent(event("input"));
  update({ hopperState: Object.assign({}, STATE, { "D:0": { assigned: true, resinName: "REMOTE-1", pct: 60, source: "SILO 3" } }) });
  assert.ok(d1.classList.contains("is-searching"));
  assert.ok(d1.classList.contains("is-changed-underneath"));
  assert.equal(input.value, "ld");
  assert.equal(focused, input);
  assert.match(root.querySelector(".station-editor__note").textContent, /D1's resin is now REMOTE-1 in the application/);
  input.dispatchEvent(event("keydown", { key: "Escape" }));
  assert.ok(!d1.classList.contains("is-searching"));
  assert.ok(!d1.classList.contains("is-changed-underneath"));
  assert.equal(d1.querySelector(".station-editor__resin-value").textContent, "REMOTE-1", "the resting value is the canonical one");
});

test("a row whose shape changes under an active control is rebuilt only once the control is left", () => {
  const { root, update } = withEditing();
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const input = d1.querySelector(".station-editor__search");
  // D1 is emptied in the application while its search is open.
  update({ hopperState: Object.assign({}, STATE, { "D:0": { assigned: false, resinName: "", pct: 0, source: "" } }) });
  assert.ok(d1.classList.contains("is-searching"), "the search was closed by the publish");
  assert.equal(d1.querySelector(".station-editor__search"), input);
  assert.equal(d1.querySelectorAll("[data-slot='pct']").length, 1, "the row was reshaped under an open control");
  assert.ok(d1.classList.contains("is-changed-underneath"));
  input.dispatchEvent(event("keydown", { key: "Escape" }));
  assert.ok(d1.classList.contains("is-empty"));
  assert.equal(d1.querySelectorAll("[data-slot='pct']").length, 0, "the emptied row still has a percentage field");
  assert.equal(d1.querySelectorAll(".station-editor__source-value").length, 0);
  assert.ok(d1.querySelector(".station-editor__resin-value").classList.contains("is-placeholder"));
  assert.equal(d1.querySelector(".station-editor__resin-value").getAttribute("aria-label"), "Add resin to D1");
});

test("a row whose shape changes with no control active is rebuilt at once, in the same item", () => {
  const { root, update } = withEditing({ selected: "D4" });
  const d4 = root.querySelector("[data-hopper='D4']");
  assert.ok(d4.classList.contains("is-empty"));
  update({ hopperState: Object.assign({}, STATE, { "D:3": { assigned: true, resinName: "NEW-D4", pct: 5, source: "" } }) });
  assert.equal(root.querySelector("[data-hopper='D4']"), d4);
  assert.ok(!d4.classList.contains("is-empty"));
  assert.ok(d4.classList.contains("is-selected"), "the item's own selection class was lost in the rebuild");
  assert.equal(d4.querySelector("[data-slot='pct']").value, "5");
  assert.equal(d4.querySelector(".station-editor__source-value").textContent, "Add source");
  assert.equal(d4.querySelector(".station-editor__resin-value").textContent, "NEW-D4");
});

test("a fresh editor and a patched editor over the same canonical state are the same DOM", () => {
  const before = STATE;
  const after = Object.assign({}, STATE, {
    "D:0": { assigned: true, resinName: "HX999", pct: 55, source: "" },
    "D:1": { assigned: false, resinName: "", pct: 0, source: "" },
    "D:3": { assigned: true, resinName: "NEW", pct: 45, source: "BOX 2" }
  });
  const patched = withEditing({ hopperState: before, selected: "D3" });
  patched.update({ hopperState: after });
  const fresh = withEditing({ hopperState: after, selected: "D3" });
  assert.deepEqual(serialize(patched.root), serialize(fresh.root));
});

/* ----------------------------------------------------------------------
 *   Capabilities: what the bridge offers decides what is editable
 * -------------------------------------------------------------------- */

test("with nothing connected the editor is read-only throughout, says so, and hands nothing over", () => {
  const { root } = buildReadOnly();
  assert.deepEqual(textOf(root, "station-editor__mode"), ["Read-only"]);
  assert.equal(root.querySelector(".station-editor__mode").getAttribute("data-mode"), "read-only");
  assert.match(root.querySelector(".station-editor__mode").getAttribute("title"), /No application is connected to Station commands/);
  const d1 = root.querySelector("[data-hopper='D1']");
  const resin = d1.querySelector(".station-editor__resin-value");
  const source = d1.querySelector(".station-editor__source-value");
  const pct = root.querySelector("[data-hopper='D2']").querySelector(".station-editor__pct-input");
  // Readable values, in the Tab order, announced and styled as read-only.
  assert.equal(resin.textContent, "HX204");
  assert.equal(source.textContent, "SILO 3");
  assert.equal(pct.value, "30");
  for (const value of [resin, source]) {
    assert.ok(value.classList.contains("is-readonly"));
    assert.equal(value.getAttribute("aria-disabled"), "true");
    assert.equal(value.tagName, "BUTTON", "still reachable with Tab");
  }
  assert.equal(resin.getAttribute("aria-haspopup"), null, "a read-only value announces no list");
  assert.ok(pct.hasAttribute("readonly"));
  // Activating a read-only value opens nothing and says why.
  resin.dispatchEvent(event("click"));
  assert.equal(d1.querySelectorAll(".station-editor__search").length, 0);
  assert.match(root.querySelector(".station-editor__note").textContent, /D1's resin cannot be changed here: no application is connected/);
  source.dispatchEvent(event("click"));
  assert.equal(d1.querySelectorAll(".station-editor__source-input").length, 0);
  assert.match(root.querySelector(".station-editor__note").textContent, /source for D1 cannot be changed here/);
  pct.dispatchEvent(event("keydown", { key: "7" }));
  assert.match(root.querySelector(".station-editor__note").textContent, /D2's percentage was not changed: no application is connected/);
  assert.equal(pct.value, "30");
  // And an empty hopper offers nothing: the fact, not an invitation.
  const add = root.querySelector("[data-hopper='D4']").querySelector(".station-editor__resin-value");
  assert.deepEqual(add.children.map(n => n.textContent), ["No resin"]);
  assert.equal(add.getAttribute("aria-label"), "D4 resin, none");
});

test("a connected application that offers nothing the editor uses is read-only too, with that reason", () => {
  const { root } = build({ capabilities: [] });
  assert.deepEqual(textOf(root, "station-editor__mode"), ["Read-only"]);
  assert.match(root.querySelector(".station-editor__mode").getAttribute("title"), /offers none of the editing commands/);
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  assert.equal(d1.querySelectorAll(".station-editor__search").length, 0);
  assert.match(root.querySelector(".station-editor__note").textContent, /does not offer resin editing from Station/);
});

test("capabilities are granular: one command missing makes its control read-only and no other", () => {
  const { root, app } = build({ capabilities: ["setHopperResin", "setSource"] });
  assert.deepEqual(textOf(root, "station-editor__mode"), ["Partly read-only"]);
  assert.equal(root.querySelector(".station-editor__mode").getAttribute("data-mode"), "partial");
  assert.match(root.querySelector(".station-editor__mode").getAttribute("title"), /Changes to resin and source are applied to the current recipe; the rest is read-only here/);
  const d2 = root.querySelector("[data-hopper='D2']");
  const pct = d2.querySelector(".station-editor__pct-input");
  assert.ok(pct.hasAttribute("readonly"));
  pct.dispatchEvent(event("keydown", { key: "4" }));
  assert.match(root.querySelector(".station-editor__note").textContent, /D2's percentage was not changed: the application does not offer percentage editing/);
  // Resin and source are as editable as ever.
  assert.ok(!d2.querySelector(".station-editor__resin-value").classList.contains("is-readonly"));
  assert.ok(!d2.querySelector(".station-editor__source-value").classList.contains("is-readonly"));
  d2.querySelector(".station-editor__source-value").dispatchEvent(event("click"));
  const input = d2.querySelector(".station-editor__source-input");
  assert.ok(input, "source editing was disabled along with the percentage");
  input.value = "silo 9";
  input.dispatchEvent(event("keydown", { key: "Enter" }));
  assert.deepEqual(app.calls.map(c => c.command), ["setSource"]);

  const only = build({ capabilities: ["setHopperBlend"] });
  assert.ok(!only.root.querySelector("[data-hopper='D2']").querySelector(".station-editor__pct-input").hasAttribute("readonly"));
  assert.ok(only.root.querySelector("[data-hopper='D2']").querySelector(".station-editor__resin-value").classList.contains("is-readonly"));
  assert.ok(only.root.querySelector("[data-hopper='D2']").querySelector(".station-editor__source-value").classList.contains("is-readonly"));
});

test("with no recipe named, nothing is editable: the editor never assumes which recipe it addresses", () => {
  const { root, app } = build({ recipe: undefined });
  assert.deepEqual(textOf(root, "station-editor__mode"), ["Read-only"]);
  root.querySelector("[data-hopper='D1']").querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  assert.equal(root.querySelectorAll(".station-editor__search").length, 0);
  assert.match(root.querySelector(".station-editor__note").textContent, /this view does not address a recipe/);
  assert.equal(app.calls.length, 0);
});

test("the editor consults the bridge and keeps no permission table of its own", () => {
  const source = fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8");
  assert.match(source, /commands\.capabilities\(\)/);
  assert.match(source, /commands\.isAvailable\(\)/);
  // One mapping from slot to command, and every capability check goes
  // through it - no command name is compared anywhere else.
  assert.match(source, /const SLOT_COMMAND = Object\.freeze\(\{ resin: "setHopperResin", pct: "setHopperBlend", source: "setSource" \}\);/);
  const body = source.replace(/const SLOT_COMMAND = [^\n]*\n/, "");
  for (const name of ["setHopperResin", "setHopperBlend", "setSource"]) {
    assert.doesNotMatch(body, new RegExp(`"${name}"`), `${name} is named outside SLOT_COMMAND`);
  }
  // Every command goes out through the one addressed helper: the bridge
  // is called in exactly one place, and that place is called from issue().
  assert.equal((source.match(/commands\.dispatch\s*\(/g) || []).length, 1, "a second call on the bridge");
  assert.equal((source.match(/deps\.dispatch\s*\(/g) || []).length, 1, "a second call site around issue()");
  assert.equal((source.match(/\.dispatch\s*\(/g) || []).length, 2);
  assert.match(source, /commands\.dispatch\(command, Object\.assign\(\{ recipe, layer: blend\.layer\.id \}, args\)\)/);
  // Nothing here is a write path of its own.
  for (const pattern of [/saveSession/, /notifyActiveJobMutation/, /\.publish\s*\(/, /\.connect\s*\(/, /PolynStationCommandBridge/, /PolynStationStateBridge/, /localStorage/]) {
    assert.doesNotMatch(source, pattern);
  }
});

test("the changed-underneath mark is styled on the badge, from the warning token", () => {
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/focus-editor.css"), "utf8");
  const rule = css.match(/\.station-editor__item\.is-changed-underneath \.station-editor__badge\s*\{([^}]*)\}/);
  assert.ok(rule, "no rule for the changed-underneath mark");
  assert.match(rule[1], /var\(--station-warning\)/);
});

/* ----------------------------------------------------------------------
 *   Writing through the bridge
 * -------------------------------------------------------------------- */

/* Every edit is a command on the bridge, addressed explicitly; the row
 * shows the application's answer, never the request. The fake
 * application (fakeApp above) answers in the executor's shapes over a
 * real bridge and the real contract, so what these prove is the editor's
 * half of the write path: what it sends, when it sends nothing, and what
 * it shows afterwards. */

const pctOf = (root, id) => root.querySelector(`[data-hopper='${id}']`).querySelector("[data-slot='pct']");
const noteOf = root => root.querySelector(".station-editor__note").textContent;

function typeAndEnter(input, value) {
  input.value = value;
  input.dispatchEvent(event("input"));
  const enter = event("keydown", { key: "Enter" });
  input.dispatchEvent(enter);
  return enter;
}

/* ---- Resin ---- */

test("resin: the command carries the recipe the editor was built for - Current here, Next there - and nothing is assumed", () => {
  const current = build({ recipe: "current" });
  current.root.querySelector("[data-hopper='D2']").querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  typeAndEnter(current.root.querySelector(".station-editor__search"), "9659");
  assert.deepEqual(current.app.calls, [{ command: "setHopperResin", args: { recipe: "current", layer: "D", index: 1, resin: "9659HD" } }]);

  const next = build({ recipe: "next" });
  next.root.querySelector("[data-hopper='D2']").querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  typeAndEnter(next.root.querySelector(".station-editor__search"), "9659");
  assert.deepEqual(next.app.calls, [{ command: "setHopperResin", args: { recipe: "next", layer: "D", index: 1, resin: "9659HD" } }]);
  assert.match(next.root.querySelector(".station-editor__mode").getAttribute("title"), /applied to the next recipe/);
});

test("resin: choosing the resin the hopper already holds hands nothing over; an equivalent one is the application's no-op", () => {
  const { root, app, committed } = build();
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  // The search opens on HX204 with HX204 first; Enter chooses it again.
  typeAndEnter(d1.querySelector(".station-editor__search"), "HX204");
  assert.equal(app.calls.length, 0, "the same resin again is not a command");
  assert.equal(committed.length, 0);
  assert.equal(d1.querySelector(".station-editor__resin-value").textContent, "HX204");
  assert.equal(noteOf(root), "");

  // A code the catalog spells the same way but the fixture holds with
  // other spacing reaches the application, which answers changed:false:
  // no history, no save, no publish, nothing told to the boot file.
  const spaced = build({ hopperState: Object.assign({}, STATE, { "D:0": { assigned: true, resinName: " HX204", pct: 60, source: "" } }) });
  spaced.app.hoppers[0].resinName = "HX204";   // the application's own normalized value
  const row = spaced.root.querySelector("[data-hopper='D1']");
  row.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  typeAndEnter(row.querySelector(".station-editor__search"), "HX204");
  assert.equal(spaced.app.calls.length, 1);
  assert.deepEqual([spaced.app.history.length, spaced.app.saves, spaced.committed.length], [0, 0, 0]);
});

test("resin: a blank search committed with Enter clears the resin; on an empty hopper it chooses nothing", () => {
  const { root, app } = build();
  const d2 = root.querySelector("[data-hopper='D2']");
  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const input = d2.querySelector(".station-editor__search");
  input.value = "";
  input.dispatchEvent(event("input"));
  // A blank query browses the catalog but pre-selects nothing in it.
  assert.equal(d2.querySelectorAll(".station-editor__option").length, 7);
  assert.equal(d2.querySelectorAll(".is-active").length, 0);
  assert.equal(input.getAttribute("aria-activedescendant"), "");
  input.dispatchEvent(event("keydown", { key: "Enter" }));
  assert.deepEqual(app.calls, [{ command: "setHopperResin", args: { recipe: "current", layer: "D", index: 1, resin: "" } }]);
  assert.equal(app.resinOf(1), "");
  // D2 keeps its 30% share, so the row is a share with no resin: the
  // percentage stays, the source line is gone, the resin invites.
  assert.ok(!d2.classList.contains("is-empty"));
  assert.equal(d2.querySelector("[data-slot='pct']").value, "30");
  assert.equal(d2.querySelectorAll(".station-editor__source-value").length, 0, "a hopper with no resin has no source line");
  assert.deepEqual(d2.querySelector(".station-editor__resin-value").children.map(n => n.textContent), ["+", "Add resin"]);

  // Arrow keys still reach the browsed list from a blank query.
  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const again = d2.querySelector(".station-editor__search");
  again.dispatchEvent(event("keydown", { key: "ArrowDown" }));
  assert.equal(d2.querySelectorAll(".station-editor__option")[0].classList.contains("is-active"), true);
  again.dispatchEvent(event("keydown", { key: "Escape" }));

  const d5 = root.querySelector("[data-hopper='D5']");
  d5.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  d5.querySelector(".station-editor__search").dispatchEvent(event("keydown", { key: "Enter" }));
  assert.equal(app.calls.length, 1, "Enter on a blank search over an empty hopper is not a command");
  assert.ok(d5.classList.contains("is-searching"), "and the search stays open");
});

test("resin: a refused command leaves the row on the bridge's value and says why", () => {
  const { root, app } = build({ refuse: { setHopperResin: "busy" } });
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  typeAndEnter(d1.querySelector(".station-editor__search"), "LD165");
  assert.equal(app.calls.length, 1);
  assert.equal(app.resinOf(0), "HX204");
  assert.equal(d1.querySelector(".station-editor__resin-value").textContent, "HX204");
  assert.match(noteOf(root), /A change from another device is being applied/);
});

/* ---- Percentage ---- */

test("percentage: Enter commits as setHopperBlend and the field shows what the application holds, with focus kept", () => {
  const records = [];
  const { root, app, committed } = build({ activeElement: () => focused, onEditing: record => records.push(record) });
  const d2 = root.querySelector("[data-hopper='D2']");
  const pct = pctOf(root, "D2");
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  const enter = typeAndEnter(pct, "25");
  assert.ok(enter.defaultPrevented);
  assert.deepEqual(app.calls, [{ command: "setHopperBlend", args: { recipe: "current", layer: "D", index: 1, pct: 25 } }]);
  assert.equal(app.pctOf(1), 25);
  assert.equal(app.pctOf(0), 65, "H1 re-derived by the application");
  assert.deepEqual(app.history, ["blend current"], "exactly one history entry");
  assert.equal(app.saves, 1);
  assert.equal(committed.length, 1);
  // The row shows the answer - and so does H1's row, from the same update.
  assert.equal(pct.value, "25");
  assert.equal(pctOf(root, "D1").value, "65");
  assert.deepEqual(textOf(root, "station-editor__total-value"), ["100%"]);
  assert.equal(focused, pct, "focus stays in the field after Enter");
  assert.equal(pctOf(root, "D2"), pct, "the field was not rebuilt");
  assert.ok(!d2.classList.contains("is-changed-underneath"), "the application's echo is not a change underneath");
  assert.equal(noteOf(root), "");
  // Still editing, from the new baseline.
  assert.deepEqual(records[records.length - 1], { layer: "D", index: 1, hopper: "D2", slot: "pct", mode: "typing", draft: "25", baseValue: 25 });
});

test("percentage: leaving the field commits a change once, and a value Enter already committed is not sent again", () => {
  const { root, app } = build({ activeElement: () => focused });
  const pct = pctOf(root, "D2");
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  pct.value = "20";
  pct.dispatchEvent(event("input"));
  focused = null;
  pct.dispatchEvent(event("blur", { bubbles: false }));
  assert.deepEqual(app.calls.map(c => c.args.pct), [20], "blur committed the draft");
  assert.equal(pct.value, "20");
  assert.equal(app.pctOf(1), 20);

  // Enter, then blur: one command.
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  typeAndEnter(pct, "35");
  focused = null;
  pct.dispatchEvent(event("blur", { bubbles: false }));
  assert.deepEqual(app.calls.map(c => c.args.pct), [20, 35], "Enter followed by blur sent the value twice");
  assert.deepEqual(app.history, ["blend current", "blend current"]);
});

test("percentage: Escape drops the draft, shows the application's value, and stays in the field - with no command", () => {
  const { root, app } = build({ activeElement: () => focused });
  const pct = pctOf(root, "D2");
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  pct.value = "99";
  pct.dispatchEvent(event("input"));
  const escape = event("keydown", { key: "Escape" });
  pct.dispatchEvent(escape);
  assert.ok(escape.stopped, "a draft's Escape must not also close the layer");
  assert.equal(pct.value, "30");
  assert.equal(app.calls.length, 0);
  assert.equal(focused, pct);
  // With no draft, Escape is not the field's to spend: it reaches the
  // boot file, which closes the layer.
  const plain = event("keydown", { key: "Escape" });
  pct.dispatchEvent(plain);
  assert.ok(!plain.stopped);
  // Blur after a cancelled draft sends nothing either.
  focused = null;
  pct.dispatchEvent(event("blur", { bubbles: false }));
  assert.equal(app.calls.length, 0);
});

test("percentage: a value the application refuses is not written; the draft stays, marked, for the operator to correct", () => {
  const { root, app } = build({ activeElement: () => focused });
  const pct = pctOf(root, "D3");   // D3 holds 10; D2 holds 30
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  typeAndEnter(pct, "80");
  assert.equal(app.calls.length, 1, "the application judges the total, not the editor");
  assert.equal(app.pctOf(2), 10);
  assert.equal(pct.value, "80", "the draft is kept for correction");
  assert.equal(pct.getAttribute("aria-invalid"), "true");
  assert.match(noteOf(root), /cannot total more than 100/);
  assert.deepEqual([app.history.length, app.saves], [0, 0]);
  // A non-number and an out-of-range value are refused by the contract
  // before the application sees them.
  typeAndEnter(pct, "abc");
  typeAndEnter(pct, "120");
  assert.equal(app.calls.length, 1);
  assert.match(noteOf(root), /between 0 and 100/);
  assert.equal(pct.getAttribute("aria-invalid"), "true");
  // Corrected and committed: the mark clears.
  typeAndEnter(pct, "15");
  assert.equal(app.pctOf(2), 15);
  assert.equal(pct.getAttribute("aria-invalid"), null);
  assert.equal(noteOf(root), "");
  // Leaving the field with a refused draft shows the application's value again.
  typeAndEnter(pct, "90");
  focused = null;
  pct.dispatchEvent(event("blur", { bubbles: false }));
  assert.equal(pct.value, "15");
  assert.equal(pct.getAttribute("aria-invalid"), null);
});

test("percentage: an unchanged value is not a command, a blank one is the grid's zero, and H1 cannot be typed into", () => {
  const { root, app } = build({ activeElement: () => focused });
  const pct = pctOf(root, "D2");
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  typeAndEnter(pct, "30");
  typeAndEnter(pct, " 30 ");
  focused = null;
  pct.dispatchEvent(event("blur", { bubbles: false }));
  assert.equal(app.calls.length, 0, "the resting value, retyped, is not a change");
  // "30.0" is the same number: the application says so, and the field
  // shows the row's own spelling again.
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  typeAndEnter(pct, "30.0");
  assert.equal(app.calls.length, 1);
  assert.deepEqual([app.history.length, app.saves], [0, 0]);
  assert.equal(pct.value, "30");
  // Blank means 0, as clearing the grid's field does.
  typeAndEnter(pct, "");
  assert.equal(app.calls[1].args.pct, 0);
  assert.equal(app.pctOf(1), 0);
  assert.equal(pct.value, "0");
  // H1 is derived: its field is read-only whatever the bridge offers.
  const h1 = pctOf(root, "D1");
  assert.ok(h1.hasAttribute("readonly"));
  h1.dispatchEvent(event("keydown", { key: "5" }));
  assert.match(noteOf(root), /D1's percentage was not changed: hopper 1's share is calculated from hoppers 2-6/);
  assert.equal(app.calls.length, 2);
});

test("percentage: a draft survives an unrelated value-only publish, and a change underneath is still reported", () => {
  const { root, app, update } = build({ activeElement: () => focused });
  const d2 = root.querySelector("[data-hopper='D2']");
  const pct = pctOf(root, "D2");
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  pct.value = "2";
  pct.dispatchEvent(event("input"));
  // Another device changes D3's resin: a publish arrives.
  update({ hopperState: Object.assign({}, STATE, { "D:2": { assigned: true, resinName: "REMOTE", pct: 10, source: "" } }) });
  assert.equal(pctOf(root, "D2"), pct, "the field was rebuilt");
  assert.equal(pct.value, "2", "the draft was overwritten");
  assert.equal(focused, pct, "focus was lost");
  assert.ok(!d2.classList.contains("is-changed-underneath"));
  assert.equal(root.querySelector("[data-hopper='D3']").querySelector(".station-editor__resin-value").textContent, "REMOTE");
  // The draft is then committed as typed.
  typeAndEnter(pct, "25");
  assert.deepEqual(app.calls.map(c => c.args.pct), [25]);
  // A publish that moves D2's own percentage under a fresh draft is marked.
  pct.value = "26";
  pct.dispatchEvent(event("input"));
  update({ hopperState: Object.assign({}, app.hopperState(), { "D:1": { assigned: true, resinName: "LD105", pct: 40, source: "" } }) });
  assert.equal(pct.value, "26");
  assert.ok(d2.classList.contains("is-changed-underneath"));
  assert.match(noteOf(root), /D2's percentage is now 40% in the application/);
});

/* ---- Source ---- */

test("source: the value becomes a field; Enter commits as setSource, the row shows the application's label, no recipe history", () => {
  const { root, app, committed } = build({ activeElement: () => focused });
  const d2 = root.querySelector("[data-hopper='D2']");
  const button = d2.querySelector(".station-editor__source-value");
  assert.equal(button.textContent, "Add source");
  button.dispatchEvent(event("click"));
  assert.ok(d2.classList.contains("is-entering-source"));
  assert.ok(button.hasAttribute("hidden"));
  const input = d2.querySelector(".station-editor__source-input");
  assert.equal(input.getAttribute("data-slot"), "source");
  assert.equal(input.getAttribute("autocapitalize"), "characters");
  assert.equal(input.value, "");
  assert.equal(focused, input);
  typeAndEnter(input, "silo 7");
  assert.deepEqual(app.calls, [{ command: "setSource", args: { recipe: "current", layer: "D", index: 1, source: "SILO 7" } }],
    "the contract normalized the label before the application saw it");
  assert.equal(app.sourceOf(1), "SILO 7");
  assert.deepEqual(app.history, [], "a source is not recipe state");
  assert.equal(app.saves, 1);
  assert.equal(committed.length, 1);
  assert.equal(d2.querySelectorAll(".station-editor__source-input").length, 0, "the field closes");
  assert.equal(button.textContent, "SILO 7");
  assert.ok(!button.classList.contains("is-placeholder"));
  assert.equal(focused, button, "focus returns to the value");
  assert.equal(noteOf(root), "");
});

test("source: an empty value committed removes the label; the same value again, Escape, and blur behave as the search does", () => {
  const { root, app } = build({ activeElement: () => focused });
  const d1 = root.querySelector("[data-hopper='D1']");
  const button = d1.querySelector(".station-editor__source-value");
  assert.equal(button.textContent, "SILO 3");
  button.dispatchEvent(event("click"));
  let input = d1.querySelector(".station-editor__source-input");
  assert.equal(input.value, "SILO 3", "the field starts from the current label");
  typeAndEnter(input, "");
  assert.deepEqual(app.calls.map(c => c.args.source), [""]);
  assert.equal(app.sourceOf(0), "");
  assert.equal(button.textContent, "Add source");
  assert.ok(button.classList.contains("is-placeholder"));

  // The same again: nothing sent.
  button.dispatchEvent(event("click"));
  typeAndEnter(d1.querySelector(".station-editor__source-input"), "");
  assert.equal(app.calls.length, 1);

  // Escape: the draft is dropped, the key is spent here.
  button.dispatchEvent(event("click"));
  input = d1.querySelector(".station-editor__source-input");
  input.value = "BOX 1";
  input.dispatchEvent(event("input"));
  const escape = event("keydown", { key: "Escape" });
  input.dispatchEvent(escape);
  assert.ok(escape.stopped);
  assert.equal(app.calls.length, 1);
  assert.equal(d1.querySelectorAll(".station-editor__source-input").length, 0);
  assert.equal(focused, button);

  // Blur: a changed draft is committed once, and focus is left where it went.
  button.dispatchEvent(event("click"));
  input = d1.querySelector(".station-editor__source-input");
  input.value = "box 9";
  input.dispatchEvent(event("input"));
  focused = null;
  input.dispatchEvent(event("blur", { bubbles: false }));
  assert.deepEqual(app.calls.map(c => c.args.source), ["", "BOX 9"]);
  assert.equal(button.textContent, "BOX 9");
  assert.equal(focused, null, "leaving by Tab or click does not pull focus back");
  // Enter then blur: one command.
  button.dispatchEvent(event("click"));
  input = d1.querySelector(".station-editor__source-input");
  typeAndEnter(input, "box 10");
  input.dispatchEvent(event("blur", { bubbles: false }));
  assert.deepEqual(app.calls.map(c => c.args.source), ["", "BOX 9", "BOX 10"]);
});

test("source: where the business rules disallow it there is no field - a hopper with no resin has no source line", () => {
  const { root, app } = build({ hopperState: Object.assign({}, STATE, { "D:1": { assigned: true, resinName: "", pct: 30, source: "STALE" } }) });
  const d2 = root.querySelector("[data-hopper='D2']");
  assert.equal(d2.querySelectorAll(".station-editor__source-value").length, 0);
  assert.equal(d2.querySelector("[data-slot='pct']").value, "30", "the share is still shown");
  // And the application's own refusal is reported if it ever comes back.
  const refused = build({ refuse: { setSource: "no_resin" } });
  const row = refused.root.querySelector("[data-hopper='D1']");
  row.querySelector(".station-editor__source-value").dispatchEvent(event("click"));
  typeAndEnter(row.querySelector(".station-editor__source-input"), "silo 1");
  assert.equal(refused.app.sourceOf(0), "SILO 3");
  assert.equal(row.querySelector(".station-editor__source-value").textContent, "SILO 3");
  assert.match(noteOf(refused.root), /Assign a resin to the hopper before naming its source/);
  assert.equal(app.calls.length, 0);
});

test("source: a resin change removes the source line's label from the same update, and a source set after it is stored under the new resin", () => {
  const { root, app } = build();
  const d1 = root.querySelector("[data-hopper='D1']");
  assert.equal(d1.querySelector(".station-editor__source-value").textContent, "SILO 3");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  typeAndEnter(d1.querySelector(".station-editor__search"), "HD7845");
  assert.equal(d1.querySelector(".station-editor__resin-value").textContent, "HD7845");
  assert.equal(d1.querySelector(".station-editor__source-value").textContent, "Add source", "SILO 3 was HX204's label");
  d1.querySelector(".station-editor__source-value").dispatchEvent(event("click"));
  typeAndEnter(d1.querySelector(".station-editor__source-input"), "silo 8");
  assert.deepEqual(app.sources["D:0"], { resin: "HD7845", source: "SILO 8" });
  assert.equal(d1.querySelector(".station-editor__source-value").textContent, "SILO 8");
});

/* ---- The answer, not the request ---- */

test("what the row shows after a command is the application's snapshot, even where it differs from what was asked", () => {
  // An application that trims a label to eight characters, say: the row
  // must show the eight, not the twelve that were typed.
  const { root, app } = build();
  const original = app.bridge.dispatch;
  const d2 = root.querySelector("[data-hopper='D2']");
  d2.querySelector(".station-editor__source-value").dispatchEvent(event("click"));
  const input = d2.querySelector(".station-editor__source-input");
  input.value = "silo 7 north west";
  input.dispatchEvent(event("keydown", { key: "Enter" }));
  // The contract itself caps the label at the hookup module's limit, so
  // what came back is already shorter than what was typed.
  assert.equal(app.sourceOf(1).length, 17);
  assert.equal(d2.querySelector(".station-editor__source-value").textContent, app.sourceOf(1));
  assert.equal(original, app.bridge.dispatch);
});

test("without onCommitted the editor still sends the command and still shows only the bridge's value until the next update", () => {
  const { root, app, update } = build({ onCommitted: undefined });
  const d1 = root.querySelector("[data-hopper='D1']");
  d1.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  typeAndEnter(d1.querySelector(".station-editor__search"), "LD165");
  assert.equal(app.resinOf(0), "LD165");
  assert.equal(d1.querySelector(".station-editor__resin-value").textContent, "HX204", "nothing pretends to be saved before the publish says so");
  update({ hopperState: app.hopperState() });
  assert.equal(d1.querySelector(".station-editor__resin-value").textContent, "LD165");
});

test("percentage: zeroing the share of a hopper with no resin empties the row from its own edit, keeping focus in it", () => {
  const records = [];
  const { root, app } = build({
    hopperState: Object.assign({}, STATE, { "D:1": { assigned: true, resinName: "", pct: 30, source: "" } }),
    activeElement: () => focused, onEditing: record => records.push(record)
  });
  const d2 = root.querySelector("[data-hopper='D2']");
  const pct = pctOf(root, "D2");
  pct.focus();
  pct.dispatchEvent(event("focus", { bubbles: false }));
  typeAndEnter(pct, "0");
  assert.equal(app.pctOf(1), 0);
  assert.ok(d2.classList.contains("is-empty"), "a share of 0 with no resin is an empty hopper");
  assert.equal(d2.querySelectorAll("[data-slot='pct']").length, 0);
  assert.equal(focused, d2.querySelector("[data-slot='resin']"), "focus stays in the row, on what it still has");
  assert.equal(records[records.length - 1], null, "the field that was being edited is gone, so nothing is");
});
