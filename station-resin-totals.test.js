"use strict";

/* Resin Totals (station/station-resin-totals.js): the application's Resin
 * Totals drawn as a page for a Station window out of the rail's Tools
 * row (once the Operator Handbook's bench). These tests hold the page to
 * the one calculation it is a view of, to the layout it promised (a
 * three-figure strip, two columns of materials that scroll inside the
 * frame), to a quiet empty lot, and to writing nothing but its two
 * fields - production and scrap pounds - through the bridge it is
 * handed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sectionModule = require("./station/station-resin-totals.js");
const resinTotals = require("./resin-totals.js");
const source = require("./station/station-source.js");
const bridgeModule = require("./station-state-bridge.js");
const windowModule = require("./station/station-window.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake DOM, the shape the other Station tests use
 * -------------------------------------------------------------------- */

function makeNode(name) {
  return {
    tagName: name.toUpperCase(),
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    focused: 0,
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    focus() { this.focused += 1; },
    get classList() {
      const node = this;
      const list = () => (node.getAttribute("class") || "").split(/\s+/).filter(Boolean);
      const write = names => node.setAttribute("class", names.join(" "));
      return {
        contains: name => list().includes(name),
        add(name) { if (!list().includes(name)) write(list().concat(name)); },
        remove(name) { write(list().filter(n => n !== name)); },
        toggle(name, force) {
          const on = force === undefined ? !list().includes(name) : !!force;
          if (on) this.add(name); else this.remove(name);
          return on;
        }
      };
    },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function classes(node) {
  return (node.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

/* Enough of a selector engine for these tests: one compound selector of a
 * tag, classes and [attr] / [attr="value"] parts. */
function matches(node, selector) {
  const parts = selector.match(/^([a-z0-9]+)?((?:\.[a-zA-Z0-9_-]+)*)((?:\[[^\]]+\])*)$/);
  if (!parts) throw new Error(`unsupported selector: ${selector}`);
  if (parts[1] && node.tagName !== parts[1].toUpperCase()) return false;
  for (const cls of (parts[2].match(/\.[a-zA-Z0-9_-]+/g) || [])) if (!classes(node).includes(cls.slice(1))) return false;
  for (const attr of (parts[3].match(/\[[^\]]+\]/g) || [])) {
    const m = attr.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (!node.hasAttribute(m[1])) return false;
    if (m[2] !== undefined && node.getAttribute(m[2] === undefined ? "" : m[1]) !== m[2]) return false;
  }
  return true;
}

const doc = () => ({ createElement: name => makeNode(name) });

function textOf(node) {
  if (!node) return "";
  if (node.children.length === 0) return node.textContent;
  return node.children.map(textOf).join("");
}

/* ----------------------------------------------------------------------
 *   Fixtures: an application state, through the real bridge and source
 * -------------------------------------------------------------------- */

const LIVE_CONFIG = { lineNumber: 20, displayName: "Line 20", layerAPosition: "outside", hopperNamingMode: "standard", hopperGeometry: "cylindrical" };

function jobState(overrides) {
  return Object.assign({
    lineType: 3,
    lineRate: 850,
    prodResinLb: 10926,
    scrapResinLb: 0,
    resinLots: {},
    layers: [
      { name: "A", layerPct: 25, hoppers: [
        { pct: 70, resinName: "MS1201", weight: 400 }, { pct: 20, resinName: "CCWhite04", weight: 400 }, { pct: 10, resinName: "A0450", weight: 400 },
        { pct: 0, resinName: "", weight: 0 }, { pct: 0, resinName: "", weight: 0 }, { pct: 0, resinName: "", weight: 0 }
      ] },
      { name: "B", layerPct: 50, hoppers: [
        { pct: 60, resinName: "MS1201", weight: 400 }, { pct: 25, resinName: "MS0120", weight: 400 }, { pct: 10, resinName: "LL3003", weight: 400 },
        { pct: 5, resinName: "AB1000", weight: 400 }, { pct: 0, resinName: "", weight: 0 }, { pct: 0, resinName: "", weight: 0 }
      ] },
      { name: "C", layerPct: 25, hoppers: [
        { pct: 55, resinName: "MS1201", weight: 400 }, { pct: 30, resinName: "ccwhite04", weight: 400 }, { pct: 10, resinName: "A0450", weight: 400 },
        { pct: 5, resinName: "PP4170", weight: 400 }, { pct: 0, resinName: "", weight: 0 }, { pct: 0, resinName: "", weight: 0 }
      ] }
    ]
  }, overrides);
}

/* The real path: application state -> bridge projection -> resolved source. */
function resolvedFor(state) {
  const snapshot = JSON.parse(JSON.stringify(bridgeModule.project(state, { lineConfiguration: LIVE_CONFIG })));
  return source.resolveSource({ snapshot, demoLines: null, mode: "auto" });
}

function mount(state, options) {
  let current = resolvedFor(state);
  const instance = sectionModule.section.create(doc(), Object.assign({
    resolved: () => current,
    resinTotals
  }, options || {}));
  return {
    instance,
    root: instance.element,
    set(nextState) { current = resolvedFor(nextState); instance.update(); },
    setResolved(resolved) { current = resolved; instance.update(); }
  };
}

const stripValue = (root, id) => textOf(root.querySelector(`[data-value="${id}"]`));
const rows = root => root.querySelectorAll(".station-totals__row");
const rowText = row => ({
  code: textOf(row.querySelector(".station-totals__code")),
  pounds: textOf(row.querySelector(".station-totals__pounds-value")),
  lot: textOf(row.querySelector(".station-totals__lot")),
  hasLot: classes(row.querySelector(".station-totals__lot")).includes("has-lot"),
  column: row.getAttribute("data-column"),
  firstLine: classes(row).includes("is-first-line")
});

/* ----------------------------------------------------------------------
 *   The section
 * -------------------------------------------------------------------- */

test("it is a page on the Handbook section contract: id, title, and create/update/focus; update answers with what it drew", () => {
  assert.equal(sectionModule.section.id, "resin-totals");
  assert.equal(sectionModule.section.title, "Resin Totals");
  const { instance } = mount(jobState({ prodResinLb: 1000, scrapResinLb: 200 }));
  assert.equal(typeof instance.update, "function");
  assert.equal(typeof instance.focus, "function");
  assert.ok(instance.element);
  assert.equal(instance.element.getAttribute("data-role"), "resin-totals");
  const answer = instance.update();
  assert.equal(answer.total, 1200);
  assert.equal(answer.prod, 1000);
  assert.equal(answer.scrap, 200);
  assert.ok(Array.isArray(answer.rows));
  // One line per hopper, scrolling past three layers: a bench holding the
  // page may be raised for it.
  assert.equal(instance.grows(), true);
});

test("the strip carries Production, Scrap and Total, in that order, as whole pounds with a thousands separator", () => {
  const { root } = mount(jobState({ scrapResinLb: 1200.7 }));
  const stats = root.querySelectorAll(".station-totals__stat");
  assert.deepEqual(stats.map(s => s.getAttribute("data-stat")), ["production", "scrap", "total"]);
  assert.deepEqual(stats.map(s => textOf(s.querySelector(".station-totals__stat-label"))), ["Production", "Scrap", "Total"]);
  assert.equal(stripValue(root, "production"), "10,926");
  assert.equal(stripValue(root, "scrap"), "1,200", "truncated, never rounded - the application's fmtLb");
  assert.equal(stripValue(root, "total"), "12,126");
  assert.equal(root.querySelector(".station-totals__strip").getAttribute("data-empty"), "false");
  // The unit is a word beside each figure (and beside each field's input, for when it is open).
  assert.equal(root.querySelectorAll(".station-totals__stat-reading").length, 3);
  assert.equal(root.querySelectorAll(".station-totals__stat-unit").length, 5);
});

test("the materials are exactly the application's rows - same grouping, order and pounds - laid in two columns", () => {
  const state = jobState();
  const { root } = mount(state);
  const expected = resinTotals.compute({ prodResinLb: state.prodResinLb, scrapResinLb: state.scrapResinLb, layers: state.layers, lots: state.resinLots });
  const drawn = rows(root).map(rowText);
  assert.equal(drawn.length, expected.rows.length);
  assert.equal(drawn.length, 7);
  assert.deepEqual(drawn.map(r => r.code), expected.rows.map(r => r.displayName));
  assert.deepEqual(drawn.map(r => r.pounds), expected.rows.map(r => resinTotals.wholePounds(r.lbs).toLocaleString("en-US")));
  assert.equal(drawn[0].code, "MS1201");
  assert.equal(drawn[0].pounds, "6,692", "10926 * 0.6125 = 6692.175, truncated");
  assert.equal(drawn.find(r => /ccwhite04/i.test(r.code)).code, "CCWhite04", "one row, first-seen spelling");
  // Two columns, filled across: left, right, left, right...; the first
  // two rows share the first line.
  assert.deepEqual(drawn.map(r => r.column), ["left", "right", "left", "right", "left", "right", "left"]);
  assert.deepEqual(drawn.map(r => r.firstLine), [true, true, false, false, false, false, false]);
  assert.equal(root.getAttribute("data-count"), "7");
  assert.equal(root.querySelector(".station-totals__list").getAttribute("role"), "list");
  assert.ok(root.querySelector(".station-totals__empty").hasAttribute("hidden"));
});

test("an empty lot is one quiet 'Lot —'; a scanned lot is shown with its value", () => {
  const { root } = mount(jobState({ resinLots: { "A0450": "LOT-77A", "MS1201": "H-2201-B" } }));
  const drawn = rows(root).map(rowText);
  const ms = drawn.find(r => r.code === "MS1201");
  assert.equal(ms.lot, "LotH-2201-B");
  assert.ok(ms.hasLot);
  const a = drawn.find(r => r.code === "A0450");
  assert.equal(a.lot, "LotLOT-77A");
  const none = drawn.find(r => r.code === "MS0120");
  assert.equal(none.lot, "Lot—");
  assert.ok(!none.hasLot);
  assert.equal(textOf(root).includes("No scanned lot"), false, "the floor UI's per-row sentence is not repeated here");
  // The value is what the application stored, attached by the application's key.
  assert.equal(root.querySelector('[data-resin="MS1201"]').querySelector(".station-totals__lot").getAttribute("data-lot"), "H-2201-B");
});

test("it redraws from the current resolved state on update - an accepted recipe change or a new figure is on the page", () => {
  const handle = mount(jobState());
  assert.equal(stripValue(handle.root, "total"), "10,926");
  handle.set(jobState({ prodResinLb: 20000, scrapResinLb: 500 }));
  assert.equal(stripValue(handle.root, "production"), "20,000");
  assert.equal(stripValue(handle.root, "scrap"), "500");
  assert.equal(stripValue(handle.root, "total"), "20,500");
  assert.equal(rows(handle.root).map(rowText)[0].pounds, "12,556", "20500 * 0.6125 = 12556.25");
  // A recipe change: A's third hopper becomes a new resin.
  const changed = jobState({ prodResinLb: 20000, scrapResinLb: 500 });
  changed.layers[0].hoppers[2].resinName = "NEW-9";
  handle.set(changed);
  assert.ok(rows(handle.root).map(rowText).some(r => r.code === "NEW-9"));
  assert.equal(rows(handle.root).length, 8);
});

test("nothing entered, no materials, no application: each is a plain sentence, never fake numbers", () => {
  const zero = mount(jobState({ prodResinLb: 0, scrapResinLb: 0 }));
  assert.equal(rows(zero.root).length, 0);
  assert.equal(stripValue(zero.root, "total"), "0");
  assert.equal(zero.root.querySelector(".station-totals__strip").getAttribute("data-empty"), "true");
  assert.match(textOf(zero.root.querySelector(".station-totals__empty")), /Enter production or scrap pounds/);
  assert.ok(zero.root.querySelector(".station-totals__list").hasAttribute("hidden"));

  const unnamed = jobState({ prodResinLb: 500 });
  for (const layer of unnamed.layers) for (const hopper of layer.hoppers) hopper.resinName = "";
  const blank = mount(unnamed);
  assert.equal(rows(blank.root).length, 0);
  assert.equal(stripValue(blank.root, "total"), "500");
  assert.match(textOf(blank.root.querySelector(".station-totals__empty")), /Add resin names and recipe percentages/, "the application's own words");

  const demo = mount(jobState());
  demo.setResolved({ kind: "demo", live: false, job: { prodResinLb: 0, scrapResinLb: 0, lots: {} }, recipe: { layers: [] } });
  assert.match(textOf(demo.root.querySelector(".station-totals__empty")), /Demo data/);
  demo.setResolved(null);
  assert.match(textOf(demo.root.querySelector(".station-totals__empty")), /No application is connected/);
  assert.equal(stripValue(demo.root, "total"), "0");

  const noModule = sectionModule.section.create(doc(), { resolved: () => resolvedFor(jobState()), resinTotals: null });
  assert.match(textOf(noModule.element.querySelector(".station-totals__empty")), /unavailable/);
  assert.equal(noModule.element.querySelectorAll(".station-totals__row").length, 0);
});

/* A command bridge as the boot file hands one over: what it offers, and a
 * recorder of what it is asked. */
function fakeCommands(options) {
  const settings = options || {};
  const capabilities = settings.capabilities || ["setProductionPounds", "setScrapPounds"];
  const calls = [];
  let answer = settings.answer || (() => ({ ok: true, changed: true, revision: 7 }));
  return {
    calls,
    isAvailable: () => settings.available !== false,
    capabilities: () => capabilities,
    dispatch(command, args) { calls.push({ command, args }); return answer(command, args); },
    answerWith(fn) { answer = fn; }
  };
}

function key(node, name) {
  const event = { key: name, prevented: 0, stopped: 0, preventDefault() { this.prevented += 1; }, stopPropagation() { this.stopped += 1; } };
  for (const fn of node.listeners.keydown || []) fn(event);
  return event;
}
const click = node => { for (const fn of node.listeners.click || []) fn({}); };
const blur = node => { for (const fn of node.listeners.blur || []) fn({}); };

test("only production and scrap are controls - the total, the materials and the lots are read-only; nothing else listens", () => {
  const { root } = mount(jobState({ resinLots: { "MS1201": "H-1" } }), { commands: () => fakeCommands() });
  const buttons = root.querySelectorAll("button");
  assert.deepEqual(buttons.map(b => b.getAttribute("data-field")), ["production", "scrap"], "the two fields, as buttons that open in place");
  assert.equal(root.querySelectorAll("input").length, 2, "one input per field, hidden until opened");
  for (const tag of ["select", "textarea", "a", "form"]) assert.equal(root.querySelectorAll(tag).length, 0, `a <${tag}> on the page`);
  assert.equal(root.querySelector('[data-stat="total"]').querySelectorAll("button").length, 0, "the total is a figure");
  const list = root.querySelector(".station-totals__list");
  walk(list, node => assert.equal(Object.keys(node.listeners).length, 0, `${node.tagName} in the material list listens for something`));
  const src = read("station/station-resin-totals.js");
  assert.doesNotMatch(src, /PolynStationCommandBridge|localStorage|fetch\(/, "it dispatches only on the bridge it is handed");
  assert.doesNotMatch(src, /layerFrac|hopperFrac|totals\.set\(/, "no arithmetic of its own - it calls resin-totals.js");
  assert.match(src, /totals\.compute\(\{ prodResinLb: job\.prodResinLb, scrapResinLb: job\.scrapResinLb, layers: recipe\.layers, lots: job\.lots \}\)/);
  assert.equal((src.match(/commands\.dispatch\(/g) || []).length, 1, "one dispatch site, for both fields");
  assert.doesNotMatch(src, /setHopperResin|setHopperBlend|setLayerShare|setLineRate|setChangeover/, "it writes nothing but the two pounds figures");
});

test("editing production: the figure opens as a field holding the current pounds, Enter issues setProductionPounds, the page redraws and the boot file is told", () => {
  const commands = fakeCommands();
  const committed = [];
  const handle = mount(jobState(), { commands: () => commands, onCommitted: r => committed.push(r) });
  const { root } = handle;
  const field = root.querySelector('[data-field="production"]');
  const box = root.querySelector('[data-stat="production"]');
  const input = box.querySelector("input");
  assert.ok(!classes(box).includes("is-readonly"), "offered: the bridge lists the command");
  assert.equal(field.getAttribute("aria-disabled"), "false");
  click(field);
  assert.equal(handle.instance.isEditing(), "production");
  assert.equal(input.value, "10926", "the field opens on the stored pounds");
  assert.equal(input.focused, 1);
  assert.ok(field.hasAttribute("hidden") && !box.querySelector(".station-totals__editor").hasAttribute("hidden"), "the input takes the figure's place");
  input.value = "12,500";
  commands.answerWith(() => { handle.set(jobState({ prodResinLb: 12500 })); return { ok: true, changed: true, revision: 8 }; });
  const event = key(input, "Enter");
  assert.equal(event.prevented, 1);
  assert.deepEqual(commands.calls, [{ command: "setProductionPounds", args: { pounds: "12,500" } }], "the text as typed; the contract reads the separator");
  assert.deepEqual(committed.map(r => r.revision), [8]);
  assert.equal(handle.instance.isEditing(), null);
  assert.equal(stripValue(root, "production"), "12,500");
  assert.equal(stripValue(root, "total"), "12,500");
  assert.equal(field.focused, 1, "focus returns to the figure");
});

test("scrap: an emptied field clears (0), Escape cancels without a command, blur commits like Enter", () => {
  const commands = fakeCommands();
  const handle = mount(jobState({ scrapResinLb: 1200 }), { commands: () => commands });
  const { root } = handle;
  const field = root.querySelector('[data-field="scrap"]');
  const input = root.querySelector('[data-stat="scrap"]').querySelector("input");
  click(field);
  assert.equal(input.value, "1200");
  input.value = "999";
  const escape = key(input, "Escape");
  assert.equal(escape.stopped, 1, "Escape is spent on the field, not the Handbook");
  assert.equal(handle.instance.isEditing(), null);
  assert.deepEqual(commands.calls, [], "cancel issues nothing");
  assert.equal(stripValue(root, "scrap"), "1,200");
  click(field);
  input.value = "";
  blur(input);
  assert.deepEqual(commands.calls, [{ command: "setScrapPounds", args: { pounds: 0 } }], "empty clears, as the floor UI's field reads an emptied value");
  assert.equal(handle.instance.isEditing(), null);
});

test("a refused value keeps the field open, marked, with the application's reason; a no-op answer closes quietly", () => {
  const commands = fakeCommands({ answer: () => ({ ok: false, code: "out_of_range", field: "pounds", message: "Pounds cannot be less than 0." }) });
  const committed = [];
  const handle = mount(jobState(), { commands: () => commands, onCommitted: r => committed.push(r) });
  const { root } = handle;
  const input = root.querySelector('[data-stat="production"]').querySelector("input");
  click(root.querySelector('[data-field="production"]'));
  input.value = "-5";
  key(input, "Enter");
  assert.equal(handle.instance.isEditing(), "production", "still open: what was typed is not lost");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  const note = root.querySelector(".station-totals__note");
  assert.equal(note.textContent, "Pounds cannot be less than 0.");
  assert.equal(note.getAttribute("data-kind"), "error");
  assert.ok(!note.hasAttribute("hidden"));
  assert.deepEqual(committed, [], "nothing changed, nothing announced");
  // The same value again: ok, changed:false - closes, tells nobody.
  commands.answerWith(() => ({ ok: true, changed: false }));
  input.value = "10926";
  key(input, "Enter");
  assert.equal(handle.instance.isEditing(), null);
  assert.deepEqual(committed, []);
  assert.ok(note.hasAttribute("hidden"));
});

test("without an offer - demo data, no producer, or a producer without the command - the figures are read-only and say why", () => {
  const none = mount(jobState(), { commands: () => null });
  for (const id of ["production", "scrap"]) {
    const box = none.root.querySelector(`[data-stat="${id}"]`);
    assert.ok(classes(box).includes("is-readonly"));
    assert.equal(box.querySelector("button").getAttribute("aria-disabled"), "true");
    assert.match(box.querySelector("button").getAttribute("title"), /read-only here: no application is connected/);
  }
  click(none.root.querySelector('[data-field="production"]'));
  assert.equal(none.instance.isEditing(), null, "a click does not open a field it cannot commit");
  assert.match(none.root.querySelector(".station-totals__note").textContent, /cannot be changed here/);

  const partial = mount(jobState(), { commands: () => fakeCommands({ capabilities: ["setLineRate"] }) });
  assert.match(partial.root.querySelector('[data-field="scrap"]').getAttribute("title"), /does not support setScrapPounds/);

  // The offer is re-read on every update: a bridge that comes to offer the
  // command turns the figures into fields without a rebuild.
  let offer = null;
  const late = mount(jobState(), { commands: () => offer });
  assert.ok(classes(late.root.querySelector('[data-stat="production"]')).includes("is-readonly"));
  offer = fakeCommands();
  late.instance.update();
  assert.ok(!classes(late.root.querySelector('[data-stat="production"]')).includes("is-readonly"));
});

test("focus lands on the production figure - the first thing to enter on this page", () => {
  const { root, instance } = mount(jobState());
  instance.focus();
  assert.equal(root.querySelector('[data-field="production"]').focused, 1);
  assert.equal(root.querySelector(".station-totals__list").focused, 0);
});

/* ----------------------------------------------------------------------
 *   In the Handbook, between the Recipe Book and Appearance
 * -------------------------------------------------------------------- */

test("station.js builds the page into a Station window out of the Tools row's second tile - handed the resolved state, the shared module, and the job controls' offer and publish policy - and redraws it, with the total on the window's bar, wherever the Handbook is told of a value change; the Handbook no longer carries the page", () => {
  const boot = read("station/station.js");
  assert.match(boot, /const resinTotalsSection = root\.PolynStationResinTotals \|\| null;/);
  assert.match(boot, /const resinTotals = root\.PolynResinTotals \|\| null;/);
  assert.match(boot, /const stationWindow = root\.PolynStationWindow \|\| null;/);
  assert.match(boot, /if \(recipeBook\) handbookSections\.push\(recipeBook\.section\);\s*if \(weightsSection\) handbookSections\.push\(weightsSection\.section\);\s*if \(appearance\) handbookSections\.push\(appearance\.section\);/,
    "Recipe Book, Weights, Appearance - no Resin Totals page");
  assert.doesNotMatch(boot, /handbookSections\.push\(resinTotalsSection/);
  const window = boot.slice(boot.indexOf("if (stationWindow && resinTotalsSection && resinTotals && mounts.utility && railPanel) {"), boot.indexOf("feedJob(current.model, current.resolved);"));
  assert.match(window, /totalsPage = resinTotalsSection\.section\.create\(doc, \{\s*resolved: \(\) => current\.resolved,\s*resinTotals,/);
  // Its fields write through the same offer and publish policy as the
  // header's job controls.
  assert.match(window, /commands: \(\) => commandsFor\(current\.resolved\),/);
  assert.match(window, /onCommitted: result => \{\s*lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;\s*onPublish\(\{ own: true \}\);/);
  assert.match(window, /totalsWindow = stationWindow\.create\(doc, \{\s*name: "totals",\s*title: resinTotalsSection\.section\.title,\s*className: "station-totals__panel",/);
  assert.match(window, /anchor: railPanel\.totalsButton,/);
  assert.match(window, /totalsWindow\.body\.appendChild\(totalsPage\.element\);\s*mounts\.utility\.appendChild\(totalsWindow\.element\);\s*surfaces\.push\(totalsWindow\);/);
  // Opening redraws the page and closes the other utility surfaces.
  assert.match(window, /if \(open\) \{ closeOtherSurfaces\(totalsWindow\); refreshTotals\(\); \}/);
  // The Handbook's context no longer carries the commands the page used.
  const handbook = boot.slice(boot.indexOf("handbookPanel = handbook.create(doc, {"), boot.indexOf("mount: mounts.handbook,"));
  assert.doesNotMatch(handbook, /resinTotals|commands:|onCommitted/);
  // The values path of onPublish tells the pages - the Handbook's and the
  // window's - so production, scrap, lots and blend edits reach the page
  // without a structural render; the same helper from every site.
  const values = boot.slice(boot.indexOf('if (kind === "values"'), boot.indexOf("/* Structural (or a value change"));
  assert.match(values, /refreshPages\(\);/);
  assert.doesNotMatch(boot, /if \(handbookPanel\) handbookPanel\.update\(\);\n\s+syncRail/, "a site tells the Handbook alone");
  const refresh = boot.slice(boot.indexOf("function refreshTotals()"), boot.indexOf("function refreshPages()"));
  assert.match(refresh, /const result = totalsPage\.update\(\);/);
  assert.match(refresh, /resinTotalsSection\.formatPounds\(resinTotals, total\)\}? lb total/);
  assert.match(refresh, /"No pounds entered"/);
  assert.match(refresh, /classList\.toggle\("is-unset", !\(total > 0\)\)/);
  // The rail's tile: state and callback.
  assert.match(boot, /totals: \{ active: !!\(totalsWindow && totalsWindow\.isOpen\(\)\), available: !!totalsWindow \},/);
  assert.match(boot, /onResinTotals: toggleResinTotals,/);
  // No permanent Resin Totals control anywhere else on Station: the words
  // appear in the boot file's comments only, never in a label it draws.
  const codeOnly = boot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(codeOnly, /Resin Totals/);
  for (const file of ["station/station-shell.js", "station/station-job-controls.js", "station/station-sync-console.js", "station/station-handbook.js"]) {
    assert.doesNotMatch(read(file), /Resin Totals|resin-totals/, `${file} grew a Resin Totals control`);
  }
});

test("in a Station window the page opens redrawn from the current state, takes focus on the production figure, and the window's update reaches it while closed", () => {
  const d = doc();
  let current = resolvedFor(jobState());
  const page = sectionModule.section.create(d, { resolved: () => current, resinTotals });
  const win = windowModule.create(d, { name: "totals", title: sectionModule.section.title, className: "station-totals__panel", reducedMotion: () => true, focus: () => page });
  win.body.appendChild(page.element);
  assert.equal(win.panel.getAttribute("aria-label"), "Resin Totals");
  assert.ok(win.panel.classList.contains("station-totals__panel"));
  assert.ok(win.panel.classList.contains("station-window__panel"));
  assert.equal(win.element.getAttribute("data-window"), "totals");
  assert.ok(win.panel.hasAttribute("hidden"));
  current = resolvedFor(jobState({ prodResinLb: 4242 }));
  page.update();
  assert.equal(win.open(), true);
  assert.ok(!win.panel.hasAttribute("hidden"));
  assert.equal(stripValue(page.element, "production"), "4,242");
  assert.equal(page.element.querySelector('[data-field="production"]').focused, 1, "focus lands on the production figure");
  assert.equal(win.close(), true);
  assert.ok(win.panel.hasAttribute("hidden"));
  current = resolvedFor(jobState({ prodResinLb: 777 }));
  page.update();
  assert.equal(stripValue(page.element, "production"), "777");
});

test("the page is loaded by both hosts after the window frame, in the same place, and styled in its own sheet inside the frame - not in handbook.css", () => {
  const host = read("station-host.js");
  const harness = read("station/station.html");
  const hostOrder = [...host.matchAll(/"station\/(station-[^"]+\.js)"/g)].map(m => m[1]);
  const harnessOrder = [...harness.matchAll(/src="(station-[^"?]+\.js)/g)].map(m => m[1]);
  for (const order of [hostOrder, harnessOrder]) {
    assert.ok(order.indexOf("station-resin-totals.js") > order.indexOf("station-window.js"));
    assert.ok(order.indexOf("station-resin-totals.js") > order.indexOf("station-recipe-book.js"));
    assert.ok(order.indexOf("station-resin-totals.js") < order.indexOf("station-handbook.js"));
  }
  assert.ok(host.indexOf('"station/station-resin-totals.js"') < host.indexOf('"station/station.js"'));
  assert.match(host, /"station\/styles\/components\/winding-tension\.css",\s*"station\/styles\/components\/resin-totals\.css"/);
  assert.match(harness, /components\/resin-totals\.css\?v=/);
  const css = read("station/styles/components/resin-totals.css");
  assert.match(css, /\.station-totals__panel \{[^}]*width: min\(var\(--station-totals-width\), calc\(100% - 2 \* var\(--station-space-4\)\)\);/);
  assert.match(css, /\.station-totals__panel \{[^}]*height: min\(var\(--station-totals-height\), calc\(100% - 2 \* var\(--station-space-3\)\)\);/);
  assert.match(css, /\.station-totals__list \{[^}]*overflow-y: auto;/, "the list scrolls inside the frame");
  assert.match(css, /\.station-totals__list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, "two columns");
  assert.match(css, /\.station-totals__strip \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, "a three-part strip");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "no colour of its own - tokens only");
  assert.doesNotMatch(read("station/styles/components/handbook.css"), /station-totals/, "handbook.css still styles the page");
  const tokens = read("station/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(tokens, /--station-totals-width: \d+px;/);
  assert.match(tokens, /--station-totals-height: \d+px;/);
});
