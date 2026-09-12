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

function build(options) {
  focused = null;
  const doc = fakeDocument();
  const settings = Object.assign({ layer: layerOf(null, "D"), hopperState: STATE, resins: () => CATALOG }, options || {});
  const built = editor.create(doc, settings);
  return Object.assign({ doc, root: built.element }, built);
}

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
  assert.ok(pct.hasAttribute("readonly"), "no write contract: the percentage is read-only");
  assert.equal(pct.getAttribute("aria-label"), "D1 blend percentage");

  assert.equal(items[0].querySelector(".station-editor__resin-value").textContent, "HX204");
  assert.equal(items[0].querySelector(".station-editor__source-value").textContent, "SILO 3");
  // The header carries the layer's identity and its role, and the mode.
  assert.deepEqual(textOf(root, "station-editor__title"), ["Layer D"]);
  assert.deepEqual(textOf(root, "station-editor__role"), ["Inside subskin"]);
  assert.deepEqual(textOf(root, "station-editor__mode"), ["Read-only"]);
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

test("choosing a result is answered, not applied: the row keeps the bridge's value and the note says why", () => {
  const { root } = build();
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
  const button = d1.querySelector(".station-editor__resin-value");
  assert.ok(!button.hasAttribute("hidden"));
  assert.equal(button.textContent, "HX204", "nothing pretends to have been saved");
  assert.equal(focused, button, "focus returns to the value");
  assert.match(root.querySelector(".station-editor__note").textContent, /LD317 for D1 was not applied/);
});

test("Escape cancels the search without reaching the document, and a click on an option chooses it", () => {
  const { root } = build();
  const d2 = root.querySelector("[data-hopper='D2']");
  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const escape = event("keydown", { key: "Escape" });
  d2.querySelector(".station-editor__search").dispatchEvent(escape);
  assert.ok(escape.stopped, "Escape must not also close the layer");
  assert.ok(!d2.classList.contains("is-searching"));
  assert.equal(root.querySelector(".station-editor__note").textContent, "");

  d2.querySelector(".station-editor__resin-value").dispatchEvent(event("click"));
  const option = d2.querySelectorAll(".station-editor__option")[0];
  const down = event("mousedown");
  option.dispatchEvent(down);
  assert.ok(down.defaultPrevented, "mousedown on an option must not blur the input first");
  option.dispatchEvent(event("click"));
  assert.ok(!d2.classList.contains("is-searching"));
  // D2 holds LD105, so the search opened on that and the first match is the
  // catalog's LD105 variant.
  assert.match(root.querySelector(".station-editor__note").textContent, /EXXON LD105\.30 for D2 was not applied/);
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

test("the header reports command discovery: read-only, with the reason", () => {
  const none = build();
  assert.deepEqual(textOf(none.root, "station-editor__mode"), ["Read-only"]);
  assert.match(none.root.querySelector(".station-editor__mode").getAttribute("title"), /No application is connected to Station commands/);
  const connected = build({ commands: { isAvailable: () => true, capabilities: () => ["setHopperResin"] } });
  assert.deepEqual(textOf(connected.root, "station-editor__mode"), ["Read-only"]);
  assert.match(connected.root.querySelector(".station-editor__mode").getAttribute("title"), /not wired up yet/);
  // Discovery is not a write: the editor never dispatches.
  const source = fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8");
  assert.doesNotMatch(source, /\.dispatch\s*\(/);
});

test("the changed-underneath mark is styled on the badge, from the warning token", () => {
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/focus-editor.css"), "utf8");
  const rule = css.match(/\.station-editor__item\.is-changed-underneath \.station-editor__badge\s*\{([^}]*)\}/);
  assert.ok(rule, "no rule for the changed-underneath mark");
  assert.match(rule[1], /var\(--station-warning\)/);
});
