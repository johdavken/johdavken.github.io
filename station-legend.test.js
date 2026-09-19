"use strict";

/* The hopper legend (station/station-legend.js): the info mark in the
 * stage's corner and the card of hopper states it opens.
 *
 * Tested for its rows (every state the stage can draw, in the equipment's
 * order), its swatches (the parts module's own hopper, in the row's
 * state, with no click target left in it), its open/close (the mark, the
 * hidden attribute, aria-expanded, Escape in the boot file first), its
 * isolation (no state read, nothing dispatched, no storage) and its
 * registration in both hosts. Everything runs in node on a fake document. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const legend = require("./station/station-legend.js");
const parts = require("./station/station-machine-parts.js");
const render = require("./station/station-render.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake document, just big enough
 * -------------------------------------------------------------------- */

function makeNode(name) {
  const node = {
    nodeName: name, attributes: {}, children: [], parentNode: null, textContent: "", listeners: {},
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  };
  return node;
}

function fakeDocument() {
  const listeners = {};
  return {
    createElement: name => makeNode(name),
    createElementNS: (ns, name) => { const node = makeNode(name); node.namespaceURI = ns; return node; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    listeners
  };
}

function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function classesOf(node) { return String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
function byClass(node, cls) { const out = []; walk(node, n => { if (classesOf(n).includes(cls)) out.push(n); }); return out; }
function byAttr(node, key, value) { const out = []; walk(node, n => { const v = n.getAttribute(key); if (v !== null && (value === undefined || v === value)) out.push(n); }); return out; }
function fire(node, type, event) { for (const fn of node.listeners[type] || []) fn(event || {}); }

/* ----------------------------------------------------------------------
 *   The rows
 * -------------------------------------------------------------------- */

test("the entries cover every state the stage draws on a hopper, in the equipment's order, each with a swatch crop and words", () => {
  const ids = legend.ENTRIES.map(e => e.id);
  assert.deepEqual(ids, ["source", "pump-on", "pump-off", "next-changes", "tracking", "overdue", "selected", "unprofiled", "unassigned", "smart-weight"]);
  for (const entry of legend.ENTRIES) {
    assert.ok(entry.term && entry.note, `${entry.id} has no words`);
    assert.ok(legend.CROPS[entry.crop], `${entry.id} names a crop that does not exist`);
    assert.ok(Object.isFrozen(entry), `${entry.id} is not frozen`);
  }
  // The runtime states the parts module knows are all represented.
  const stateClasses = key => render.hopperStateClasses(legend.ENTRIES.find(e => e.id === key).runtime);
  assert.ok(stateClasses("tracking").includes("is-tracking"));
  assert.ok(stateClasses("pump-off").includes("is-pump-off"));
  assert.ok(stateClasses("unassigned").includes("is-unassigned"));
});

test("the words that name the operator's clicks match what the controls do: the receiver is the pump, the vessel is tracking", () => {
  const by = id => legend.ENTRIES.find(e => e.id === id).note;
  assert.match(by("pump-on"), /Click the receiver/);
  assert.match(by("pump-off"), /Click it to start the pump/);
  assert.match(by("tracking"), /Click the vessel/);
  // The legend says what a state means, never which hopper is in it.
  for (const entry of legend.ENTRIES) assert.doesNotMatch(entry.note, /\b[A-E][1-6]\b/, `${entry.id} names a hopper`);
});

/* ----------------------------------------------------------------------
 *   The swatches
 * -------------------------------------------------------------------- */

test("each swatch is the parts module's own hopper in the row's state, cropped to the row's part, with the interaction subtree stripped", () => {
  const doc = fakeDocument();
  const built = legend.create(doc);
  const rows = byClass(built.panel, "station-legend__row");
  assert.equal(rows.length, legend.ENTRIES.length);
  for (const [index, row] of rows.entries()) {
    const entry = legend.ENTRIES[index];
    assert.equal(row.getAttribute("data-state"), entry.id);
    const swatches = byClass(row, "station-legend__swatch");
    assert.equal(swatches.length, 1, `${entry.id}: one swatch`);
    const svg = swatches[0];
    assert.equal(svg.namespaceURI, parts.SVG_NS);
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    const crop = legend.CROPS[entry.crop];
    assert.equal(svg.getAttribute("viewBox"), `0 ${crop.y} ${legend.SWATCH_WIDTH} ${crop.height}`);
    const hoppers = byClass(svg, "station-hopper");
    assert.equal(hoppers.length, 1, `${entry.id}: one hopper drawn`);
    // The same classes the stage would put on a hopper in this state.
    const expected = render.hopperStateClasses(entry.runtime).concat(entry.classes || []);
    for (const cls of expected) assert.ok(classesOf(hoppers[0]).includes(cls), `${entry.id}: missing ${cls}`);
    // No hit area, no control, no click target of the machine's.
    assert.equal(byClass(svg, "station-hit").length, 0, `${entry.id}: a hit area survived`);
    assert.equal(byAttr(svg, "data-station-target").length, 0, `${entry.id}: a click target survived`);
    assert.equal(byAttr(svg, "data-role", "hopper-interaction").length, 0);
    // The drawing itself is whole.
    assert.equal(byAttr(svg, "data-role", "hopper-drawing").length, 1);
  }
});

test("the swatches carry the state each row describes: the source label, the chevrons, the dashed default, the selection, the computed weight", () => {
  const doc = fakeDocument();
  const built = legend.create(doc);
  const row = id => byClass(built.panel, "station-legend__row").find(r => r.getAttribute("data-state") === id);
  const swatch = id => byClass(row(id), "station-legend__swatch")[0];
  const hopper = id => byClass(swatch(id), "station-hopper")[0];
  assert.equal(byClass(swatch("source"), "station-hopper__source")[0].textContent, "26");
  assert.equal(byClass(swatch("tracking"), "station-hopper__rundown-chevrons").length, 1);
  assert.equal(byClass(swatch("pump-on"), "station-hopper__rundown-chevrons").length, 0, "an untracked hopper draws no flow");
  assert.ok(classesOf(hopper("overdue")).includes("is-overdue"));
  assert.ok(classesOf(hopper("overdue")).includes("is-tracking"), "overdue is a tracked state");
  assert.ok(classesOf(hopper("selected")).includes("is-selected"));
  assert.ok(classesOf(hopper("unprofiled")).includes("is-unprofiled"));
  assert.ok(!classesOf(hopper("tracking")).includes("is-unprofiled"), "the legend's hopper is profiled unless the row says otherwise");
  assert.ok(classesOf(hopper("next-changes")).includes("is-next-changes"));
  assert.ok(classesOf(hopper("smart-weight")).includes("is-smart"));
  assert.equal(byClass(swatch("smart-weight"), "station-hopper__weight")[0].textContent, "156");
});

/* ----------------------------------------------------------------------
 *   Open and close
 * -------------------------------------------------------------------- */

test("built closed: the mark says so, the card is hidden and labelled, and the mark controls it", () => {
  const doc = fakeDocument();
  const built = legend.create(doc);
  assert.equal(built.element.getAttribute("data-role"), "hopper-legend");
  assert.equal(built.visible(), false);
  assert.equal(built.panel.getAttribute("hidden"), "");
  assert.equal(built.panel.getAttribute("role"), "region");
  assert.equal(built.panel.getAttribute("aria-label"), "Hopper legend");
  assert.equal(built.mark.nodeName, "button");
  assert.equal(built.mark.getAttribute("type"), "button");
  assert.equal(built.mark.getAttribute("aria-expanded"), "false");
  assert.equal(built.mark.getAttribute("aria-controls"), built.panel.getAttribute("id"));
  assert.ok(classesOf(built.panel).includes("station-glass"), "the card wears the console's glass");
  assert.equal(byClass(built.panel, "station-legend__foot")[0].textContent, legend.FOOTNOTE);
});

test("the mark toggles the card; show and hide are idempotent and tell the caller", () => {
  const doc = fakeDocument();
  const changes = [];
  const built = legend.create(doc, { onOpenChange: open => changes.push(open) });
  fire(built.mark, "click", { preventDefault() {} });
  assert.equal(built.visible(), true);
  assert.equal(built.panel.getAttribute("hidden"), null);
  assert.equal(built.mark.getAttribute("aria-expanded"), "true");
  built.show();
  assert.deepEqual(changes, [true], "a second show is not announced");
  fire(built.mark, "click", { preventDefault() {} });
  assert.equal(built.visible(), false);
  built.hide();
  assert.deepEqual(changes, [true, false]);
  built.toggle();
  assert.equal(built.visible(), true);
});

test("a press outside the legend closes it; a press on the legend does not", () => {
  const doc = fakeDocument();
  const built = legend.create(doc);
  built.show();
  const inside = byClass(built.panel, "station-legend__row")[0];
  for (const fn of doc.listeners.pointerdown) fn({ target: inside });
  assert.equal(built.visible(), true, "a press on the card leaves it open");
  const elsewhere = makeNode("div");
  for (const fn of doc.listeners.pointerdown) fn({ target: elsewhere });
  assert.equal(built.visible(), false, "a press anywhere else closes it");
  for (const fn of doc.listeners.pointerdown) fn({ target: elsewhere });
  assert.equal(built.visible(), false);
});

test("without a document that listens, the legend still builds and still toggles by its handle", () => {
  const doc = { createElement: name => makeNode(name), createElementNS: (ns, name) => makeNode(name) };
  const built = legend.create(doc);
  built.toggle();
  assert.equal(built.visible(), true);
});

/* ----------------------------------------------------------------------
 *   Isolation and registration
 * -------------------------------------------------------------------- */

test("the legend reads no state, dispatches nothing, and touches no storage, bridge or timer", () => {
  const source = read("station/station-legend.js");
  for (const pattern of [/\.request\s*\(/, /PolynStation\w*Bridge/, /localStorage/, /sessionStorage/, /setTimeout/, /setInterval/, /fetch\s*\(/, /supabase/i, /hopperState/, /resolved/]) {
    assert.doesNotMatch(source, pattern, `the legend reaches outside itself (matched ${pattern})`);
  }
  // Its only dependency is the parts module the stage draws with.
  assert.match(source, /require\("\.\/station-machine-parts\.js"\)/);
  assert.doesNotMatch(source, /require\("\.\/station-(?!machine-parts\.js")/);
});

test("both hosts load the legend and its stylesheet: after the parts module it draws with, before the boot file, its sheet after the glass it wears", () => {
  const host = read("station-host.js");
  const harness = read("station/station.html");
  for (const [name, text, script, style, bootMark] of [
    ["station-host.js", host, '"station/station-legend.js"', '"station/styles/components/legend.css"', '"station/station.js"'],
    ["station.html", harness, "station-legend.js?v=", "legend.css?v=", "station.js?"]
  ]) {
    assert.ok(text.includes(script), `${name} does not load the legend`);
    assert.ok(text.includes(style), `${name} does not load its stylesheet`);
    assert.ok(text.indexOf("station-machine-parts.js") < text.indexOf("station-legend.js"), `${name}: the legend loads before the parts module`);
    assert.ok(text.indexOf("station-legend.js") < text.indexOf(bootMark), `${name}: the legend loads after the boot file`);
    assert.ok(text.indexOf("glass.css") < text.indexOf("legend.css"), `${name}: the sheet loads before the glass it wears`);
    assert.ok(text.indexOf("hopper.css") < text.indexOf("legend.css"), `${name}: the sheet loads before the hopper sheet that colours its swatches`);
  }
});

test("the boot file mounts the legend in the utility slot with no state handed to it, and gives Escape to its open card before anything else", () => {
  const boot = read("station/station.js");
  assert.match(boot, /const hopperLegend = root\.PolynStationLegend \|\| null;/);
  assert.match(boot, /if \(hopperLegend && mounts\.utility\) \{\n\s+legendPanel = hopperLegend\.create\(doc\);\n\s+if \(legendPanel\) mounts\.utility\.appendChild\(legendPanel\.element\);/);
  const escape = boot.slice(boot.indexOf('if (event.key !== "Escape") return;'));
  const legendAt = escape.indexOf("legendPanel.visible()");
  const focusAt = escape.indexOf("if (focus)");
  assert.ok(legendAt >= 0 && legendAt < focusAt, "Escape closes the legend before it leaves a focused layer");
  // Nothing of the resolved state or the bridge reaches the legend.
  assert.doesNotMatch(boot, /legendPanel\.(show|toggle)\(/, "the boot file never opens the legend itself");
  assert.doesNotMatch(boot, /hopperLegend\.create\(doc, \{/, "the legend is handed nothing");
});
