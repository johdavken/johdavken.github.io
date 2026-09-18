"use strict";

/* The recipe print sheet (station/station-print-sheet.js): the floor UI's
 * Print Recipe, from the rail's Print row.
 *
 * Three layers. The sheet builder alone: the floor UI's sheet, page for
 * page, from recipe layers in Station's own shape. The rail's Print
 * switch and its row of choices. Then Station booted for real, with the
 * print frame faked, to drive the row from a live snapshot with and
 * without a plan and read the sheet the frame is handed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sheetModule = require("./station/station-print-sheet.js");
const railModule = require("./station/station-machine-rail.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake DOM (the boot tests' one, as station-changeover.test.js has it)
 * -------------------------------------------------------------------- */

let focused = null;

function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }

function matchesOne(node, selector) {
  const parts = selector.match(/(\.[a-zA-Z0-9_-]+|\[[a-zA-Z-]+(?:=(?:'[^']*'|"[^"]*"))?\]|:[a-z-]+|[a-zA-Z]+)/g) || [];
  return parts.every(part => {
    if (part.startsWith(".")) return classSet(node).has(part.slice(1));
    if (part.startsWith(":")) return true;
    const attr = part.match(/^\[([a-zA-Z-]+)(?:=(?:'([^']*)'|"([^"]*)"))?\]$/);
    if (attr) {
      const want = attr[2] !== undefined ? attr[2] : attr[3];
      return want === undefined ? node.hasAttribute(attr[1]) : node.getAttribute(attr[1]) === want;
    }
    return node.nodeName.toLowerCase() === part.toLowerCase();
  });
}

function matchesCompound(node, selector) {
  const steps = selector.trim().split(/\s+/);
  if (!matchesOne(node, steps[steps.length - 1])) return false;
  let n = node;
  for (let i = steps.length - 2; i >= 0; i--) {
    n = n.parent;
    while (n && !matchesOne(n, steps[i])) n = n.parent;
    if (!n) return false;
  }
  return true;
}

function matches(node, selector) { return selector.split(",").some(one => matchesCompound(node, one.trim())); }
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }

function makeEvent(type, init) {
  return Object.assign({
    type, bubbles: false, stopped: false, defaultPrevented: false, target: null, relatedTarget: null,
    stopPropagation() { this.stopped = true; },
    preventDefault() { this.defaultPrevented = true; }
  }, init || {});
}

function makeNode(doc, name, ns) {
  const node = {
    nodeName: name, tagName: name.toUpperCase(), namespaceURI: ns || null, nodeType: 1,
    attributes: {}, children: [], parent: null, listeners: {}, style: {}, dataset: {}, value: "", disabled: false, rect: null,
    ownerDocument: doc,
    get firstChild() { return this.children[0] || null; },
    get parentNode() { return this.parent; },
    get parentElement() { return this.parent; },
    get textContent() { return this._text !== undefined && !this.children.length ? this._text : this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this.children = []; this._text = String(v); },
    get innerHTML() { return ""; },
    set innerHTML(v) { this.children = []; },
    get hidden() { return this.hasAttribute("hidden"); },
    set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); },
    get id() { return this.getAttribute("id") || ""; },
    get className() { return this.getAttribute("class") || ""; },
    set className(v) { this.setAttribute("class", v); },
    get isConnected() { let n = this; while (n) { if (n === doc) return true; n = n.parent; } return false; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { if (child.parent) child.parent.removeChild(child); this.children.push(child); child.parent = this; this._text = undefined; return child; },
    append(...kids) { for (const k of kids) this.appendChild(typeof k === "string" ? doc.createTextNode(k) : k); },
    insertBefore(fresh, ref) { if (fresh.parent) fresh.parent.removeChild(fresh); const at = ref ? this.children.indexOf(ref) : -1; if (at < 0) this.children.push(fresh); else this.children.splice(at, 0, fresh); fresh.parent = this; return fresh; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    replaceChild(fresh, old) { const at = this.children.indexOf(old); if (at < 0) throw new Error("not a child"); if (fresh.parent) fresh.parent.removeChild(fresh); this.children[at] = fresh; fresh.parent = this; old.parent = null; return old; },
    remove() { if (this.parent) this.parent.removeChild(this); },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (n.nodeType === 1 && matches(n, selector)) return n; n = n.parent; } return null; },
    matches(selector) { return matches(this, selector); },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && n.nodeType === 1 && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
    dispatchEvent(event) {
      event.target = event.target || this;
      let n = this;
      while (n && !event.stopped) {
        event.currentTarget = n;
        for (const fn of (n.listeners[event.type] || []).slice()) fn(event);
        if (!event.bubbles) break;
        n = n.parent;
      }
      return true;
    },
    click() { this.dispatchEvent(makeEvent("click", { bubbles: true })); },
    focus() {
      const old = focused;
      focused = this;
      if (old && old !== this) { old.dispatchEvent(makeEvent("blur")); old.dispatchEvent(makeEvent("focusout", { bubbles: true, relatedTarget: this })); }
      this.dispatchEvent(makeEvent("focus"));
      this.dispatchEvent(makeEvent("focusin", { bubbles: true }));
    },
    blur() {
      if (focused !== this) return;
      focused = null;
      this.dispatchEvent(makeEvent("blur"));
      this.dispatchEvent(makeEvent("focusout", { bubbles: true, relatedTarget: null }));
    },
    select() {},
    getBoundingClientRect() { return this.rect || { x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    getBBox() { return { x: 0, y: 0, width: 10, height: 10 }; },
    animate() { return null; },
    classList: null
  };
  node.classList = {
    add(...names) { const set = classSet(node); for (const nm of names) set.add(nm); node.attributes.class = [...set].join(" "); },
    remove(...names) { const set = classSet(node); for (const nm of names) set.delete(nm); node.attributes.class = [...set].join(" "); },
    contains(nm) { return classSet(node).has(nm); },
    toggle(nm, force) { const on = force === undefined ? !classSet(node).has(nm) : !!force; (on ? this.add : this.remove).call(this, nm); return on; }
  };
  return node;
}

function fakeDocument() {
  const doc = makeNode(null, "#document");
  doc.ownerDocument = doc;
  doc.nodeType = 9;
  doc.createElement = name => makeNode(doc, name);
  doc.createElementNS = (ns, name) => makeNode(doc, name, ns);
  doc.createTextNode = value => { const t = makeNode(doc, "#text"); t.nodeType = 3; t._text = String(value); return t; };
  doc.head = doc.appendChild(makeNode(doc, "head"));
  doc.body = doc.appendChild(makeNode(doc, "body"));
  doc.documentElement = doc;
  doc.readyState = "complete";
  Object.defineProperty(doc, "activeElement", { get: () => focused });
  return doc;
}

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); }
  };
}

function fakeAnimation(element, keyframes, options) {
  const animation = { element, keyframes, options, reversed: 0, cancelled: false, finish: null };
  animation.finished = new Promise(resolve => { animation.finish = resolve; });
  animation.reverse = () => { animation.reversed += 1; };
  animation.cancel = () => { animation.cancelled = true; animation.finish(); };
  return animation;
}

const hidden = node => node.hasAttribute("hidden");
const input = (node, value) => { node.value = String(value); node.dispatchEvent(makeEvent("input", { bubbles: true })); };
const tick = () => new Promise(resolve => setImmediate(resolve));

/* An iframe in the fake DOM: a document of its own behind it, and a
 * window whose print() is counted - what the printer reads and calls. */
function frameCapable(doc) {
  const plain = doc.createElement;
  doc.createElement = name => {
    const node = plain(name);
    if (name === "iframe") {
      const inner = fakeDocument();
      node.contentDocument = inner;
      node.contentWindow = { document: inner, print: () => { node.printed = (node.printed || 0) + 1; } };
    }
    return node;
  };
  return doc;
}

const LINE = { displayName: "Line 9", layerCount: 3, hopperNamingMode: "standard" };
const CURRENT = [
  { name: "A", layerPct: 30, hoppers: [{ resinName: "HX0", pct: 60 }, { resinName: "LD0", pct: 40 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }] },
  { name: "B", layerPct: 40, hoppers: [{ resinName: "HX1", pct: 100 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }] },
  { name: "C", layerPct: 30, hoppers: [{ resinName: "HX2", pct: 50 }, { resinName: "LD2", pct: 50 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }, { resinName: "", pct: 0 }] }
];
const NEXT = CURRENT.map(layer => ({ name: layer.name, layerPct: layer.layerPct, hoppers: layer.hoppers.map((h, i) => (i === 0 ? { resinName: "NEW" + layer.name, pct: h.pct } : h)) }));

const cells = (section, layer) => section.querySelectorAll(`tr[data-layer='${layer}'] td`).map(td => td.children.map(c => c.textContent));

/* ----------------------------------------------------------------------
 *   The sheet
 * -------------------------------------------------------------------- */

test("the sheet is the floor UI's, page for page: the recipe's name, the line / layers / naming / printed line, one overview table with the layer's letter and share heading each row and the resin over its share in each cell, NOT USED where none is", () => {
  focused = null;
  const doc = fakeDocument();
  const { sheet, pages } = sheetModule.buildSheet(doc, { which: "current", current: CURRENT, next: null, line: LINE, printedAt: "9/17/2026, 10:00:00 PM" });
  assert.deepEqual(pages, ["current"]);
  assert.equal(sheet.getAttribute("data-role"), "print-sheet");
  const sections = sheet.querySelectorAll(".station-sheet__section");
  assert.equal(sections.length, 1);
  const section = sections[0];
  assert.equal(section.getAttribute("data-page"), "current");
  assert.equal(section.querySelector(".station-sheet__title").textContent, "Current Recipe");
  assert.equal(section.querySelector(".station-sheet__meta").textContent, "Line 9 · 3 layers · Hopper naming: 1–6 · Printed 9/17/2026, 10:00:00 PM");
  assert.deepEqual(section.querySelectorAll("thead th").map(th => th.textContent), ["", "H1", "H2", "H3", "H4", "H5", "H6"]);
  assert.deepEqual(section.querySelectorAll("tbody tr").map(tr => tr.getAttribute("data-layer")), ["A", "B", "C"]);
  const headA = section.querySelector("tr[data-layer='A'] th");
  assert.equal(headA.getAttribute("scope"), "row");
  assert.deepEqual(headA.children.map(c => [c.getAttribute("class"), c.textContent]), [[null, "A"], ["station-sheet__layer-pct", "30.00%"]]);
  assert.deepEqual(cells(section, "A"), [["HX0", "60.00%"], ["LD0", "40.00%"], ["NOT USED", "0.00%"], ["NOT USED", "0.00%"], ["NOT USED", "0.00%"], ["NOT USED", "0.00%"]]);
  assert.deepEqual(cells(section, "B")[0], ["HX1", "100.00%"]);
  assert.ok(!section.classList.contains("station-sheet__section--divided"));
  // Main + 1-5 naming heads the columns as the floor UI does, and says so in the meta.
  const main = sheetModule.buildSheet(doc, { which: "current", current: CURRENT, line: { displayName: "Line 11", layerCount: 3, hopperNamingMode: "main" }, printedAt: "t" }).sheet;
  assert.deepEqual(main.querySelectorAll("thead th").map(th => th.textContent), ["", "Main", "1", "2", "3", "4", "5"]);
  assert.match(main.querySelector(".station-sheet__meta").textContent, /Hopper naming: Main \+ 1–5/);
  // One layer reads "1 layer"; no line reads "No line".
  const one = sheetModule.buildSheet(doc, { which: "current", current: [CURRENT[0]], line: { layerCount: 1 }, printedAt: "t" }).sheet;
  assert.match(one.querySelector(".station-sheet__meta").textContent, /^No line · 1 layer · /);
  assert.deepEqual([sheetModule.pct(12.5), sheetModule.pct("7"), sheetModule.pct(null), sheetModule.pct("x")], ["12.50%", "7.00%", "0.00%", "0.00%"]);
});

test("Next reads the plan under its own name; Both puts the two on one sheet, Current first, a rule between them, never a second page", () => {
  focused = null;
  const doc = fakeDocument();
  const next = sheetModule.buildSheet(doc, { which: "next", current: CURRENT, next: NEXT, line: LINE, printedAt: "t" });
  assert.deepEqual(next.pages, ["next"]);
  assert.equal(next.sheet.querySelector(".station-sheet__title").textContent, "Next Recipe");
  assert.deepEqual(cells(next.sheet, "A")[0], ["NEWA", "60.00%"]);
  const both = sheetModule.buildSheet(doc, { which: "both", current: CURRENT, next: NEXT, line: LINE, printedAt: "t" });
  assert.deepEqual(both.pages, ["current", "next"]);
  const sections = both.sheet.querySelectorAll(".station-sheet__section");
  assert.deepEqual(sections.map(s => [s.getAttribute("data-page"), s.querySelector(".station-sheet__title").textContent, s.classList.contains("station-sheet__section--divided")]),
    [["current", "Current Recipe", false], ["next", "Next Recipe", true]]);
  assert.deepEqual(cells(sections[0], "A")[0], ["HX0", "60.00%"]);
  assert.deepEqual(cells(sections[1], "A")[0], ["NEWA", "60.00%"]);
  assert.equal(both.sheet.querySelectorAll(".station-sheet__title").length, 2);
});

test("the printer writes the sheet and its own stylesheet into a frame of its own and prints THAT; a page with nothing behind it is refused and named; the next print replaces the frame; nothing on the page is touched", () => {
  focused = null;
  const doc = frameCapable(fakeDocument());
  const mount = doc.createElement("div");
  doc.body.appendChild(mount);
  const printer = sheetModule.create(doc, { mount, now: () => new Date(2026, 8, 17, 22, 0, 0) });
  assert.equal(printer.frame(), null, "no frame until something is printed");
  const refused = printer.print({ which: "next", current: CURRENT, next: null, line: LINE });
  assert.deepEqual(refused, { ok: false, code: "nothing_planned", message: "Nothing is planned: there is no Next Recipe to print." });
  assert.equal(printer.frame(), null, "a refusal opens no frame");
  assert.deepEqual(printer.print({ which: "elsewhere" }), { ok: false, code: "invalid", message: "Choose Current, Next or Both." });
  const first = printer.print({ which: "current", current: CURRENT, next: null, line: LINE });
  assert.deepEqual(first, { ok: true, which: "current", pages: ["current"] });
  const frame = mount.querySelector("[data-role='print-frame']");
  assert.ok(frame, "the frame stands in the mount");
  assert.equal(frame.tagName, "IFRAME");
  assert.equal(frame.getAttribute("aria-hidden"), "true");
  assert.equal(frame.getAttribute("tabindex"), "-1");
  assert.ok(frame.classList.contains("station-print__frame"));
  assert.equal(frame.printed, 1, "the frame's window printed, not the page's");
  const inner = frame.contentDocument;
  assert.equal(inner.head.querySelector("style").textContent, sheetModule.SHEET_STYLE);
  const sheet = inner.body.querySelector("[data-role='print-sheet']");
  assert.ok(sheet, "the sheet is the frame's document's");
  assert.match(sheet.querySelector(".station-sheet__meta").textContent, /Printed 9\/17\/2026/);
  assert.equal(doc.body.querySelector("[data-role='print-sheet']"), null, "nothing of the sheet on the page itself");
  // Both, with a plan: a new frame; the old one is gone.
  const second = printer.print({ which: "both", current: CURRENT, next: NEXT, line: LINE });
  assert.deepEqual(second, { ok: true, which: "both", pages: ["current", "next"] });
  const frames = mount.querySelectorAll("[data-role='print-frame']");
  assert.equal(frames.length, 1, "one frame at a time");
  assert.notEqual(frames[0], frame, "replaced, not reused");
  assert.equal(frames[0].printed, 1);
  assert.equal(frames[0].contentDocument.body.querySelectorAll(".station-sheet__section").length, 2);
  printer.dispose();
  assert.equal(mount.querySelectorAll("[data-role='print-frame']").length, 0);
  // The sheet's stylesheet: the printer's own colours, no theme token, the floor UI's rules.
  assert.doesNotMatch(sheetModule.SHEET_STYLE, /var\(--station|#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(sheetModule.SHEET_STYLE, /@page \{ margin: 12mm; \}/);
  assert.match(sheetModule.SHEET_STYLE, /\.station-sheet__table th, \.station-sheet__table td \{ border: 1px solid currentColor;/);
  assert.match(sheetModule.SHEET_STYLE, /\.station-sheet__layer \{ font-size: 20px; font-weight: 700; text-align: center;/);
  assert.match(sheetModule.SHEET_STYLE, /\.station-sheet__section--divided \{ margin-top: 14px; padding-top: 14px; border-top: 2px solid currentColor; \}/);
  const source = read("station/station-print-sheet.js");
  for (const forbidden of [/\.dispatch\s*\(/, /PolynStationCommandBridge/, /localStorage|sessionStorage/, /fetch\s*\(/, /document\./, /window\.print/, /\.animate\s*\(/]) {
    assert.doesNotMatch(source, forbidden, `the printer reaches out through ${forbidden}`);
  }
});

/* ----------------------------------------------------------------------
 *   The rail's Print switch and its row
 * -------------------------------------------------------------------- */

test("Print is the rail's fifth switch, under Tools at the column's foot; its row is the dialog's three choices - Current, Next, Both - Next and Both held while nothing is planned, all held while there is nothing to print; each choice is handed back by name", () => {
  focused = null;
  const doc = fakeDocument();
  const clicks = [];
  const rail = railModule.create(doc, { onPrint: () => clicks.push("print"), onPrintRecipe: which => clicks.push(which) });
  assert.deepEqual(rail.element.children.map(node => node.getAttribute("data-role")), ["blend-group", "next-group", "weights-group", "tools-group", "print-group"]);
  assert.deepEqual(rail.printGroup.children.map(node => node.getAttribute("data-action") || node.getAttribute("class")), ["print", "station-rail__flyout"]);
  assert.deepEqual(rail.printFlyout.children.map(node => node.getAttribute("data-role")), ["print-row"]);
  assert.deepEqual(rail.printRow.children.map(node => node.getAttribute("data-action")), ["print-current", "print-next", "print-both"]);
  assert.equal(rail.printFlyout.getAttribute("aria-label"), "Print Recipe choices");
  for (const button of [rail.printButton, rail.printCurrentButton, rail.printNextButton, rail.printBothButton]) {
    assert.equal(button.textContent, "");
    const svg = button.children[0];
    assert.equal(svg.getAttribute("viewBox"), "0 0 64 64");
    assert.deepEqual(svg.children.map(node => node.getAttribute("class")), ["station-rail__glyph-plate", "station-rail__glyph-art"]);
    walk(svg, node => assert.match(node.getAttribute("class") || "", /^station-rail__glyph/));
  }
  // The choices in the recipe faces' vocabulary: the hopper, the sheet, both.
  const art = button => button.children[0].children[1].children.map(node => node.getAttribute("class").replaceAll("station-rail__glyph-", ""));
  assert.deepEqual(art(rail.printButton), ["stroke", "face", "face", "row"]);
  assert.deepEqual(art(rail.printCurrentButton), ["face"]);
  assert.equal(rail.printCurrentButton.children[0].children[1].children[0].getAttribute("d"), "M 4.75 3 L 15.25 3 L 12.25 12.5 L 11.25 16.5 L 8.75 16.5 L 7.75 12.5 Z", "Current: the hopper, as the Current switch draws it");
  assert.deepEqual(art(rail.printNextButton), ["face", "stroke"]);
  assert.deepEqual(art(rail.printBothButton), ["face", "face", "stroke"]);
  // Held until told.
  assert.equal(rail.printButton.disabled, true);
  assert.equal(rail.printFlyout.getAttribute("data-open"), "false");
  rail.update({ hidden: false, print: { open: false, available: true, planned: false } });
  assert.equal(rail.printButton.disabled, false);
  assert.equal(rail.printCurrentButton.disabled, false);
  assert.equal(rail.printNextButton.disabled, true);
  assert.equal(rail.printBothButton.disabled, true);
  assert.match(rail.printNextButton.getAttribute("title"), /nothing is planned/);
  rail.printButton.click();
  assert.deepEqual(clicks, ["print"]);
  assert.equal(rail.printFlyout.getAttribute("data-open"), "false", "the rail waits to be told");
  rail.update({ print: { open: true, available: true, planned: true } });
  assert.equal(rail.printFlyout.getAttribute("data-open"), "true");
  assert.equal(rail.printButton.getAttribute("aria-pressed"), "true");
  assert.ok(rail.element.classList.contains("is-print-open"));
  assert.equal(rail.printNextButton.disabled, false);
  assert.equal(rail.printBothButton.disabled, false);
  rail.printCurrentButton.click();
  rail.printNextButton.click();
  rail.printBothButton.click();
  assert.deepEqual(clicks, ["print", "current", "next", "both"]);
  rail.update({ print: { open: false, available: false, planned: false } });
  assert.equal(rail.printButton.disabled, true);
  assert.match(rail.printButton.getAttribute("title"), /nothing to print/);
  assert.equal(rail.printCurrentButton.disabled, true);
  assert.deepEqual(rail.getState().print, { open: false, available: false, planned: false });
  assert.equal(rail.element.getAttribute("data-face"), null, "not a face: nothing turns over");
});

/* ----------------------------------------------------------------------
 *   Station booted for real
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const files = [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(files.includes("station/station-print-sheet.js"), "the host loads the printer");
  return files.filter(file => file !== "station/station.js");
}

const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "changeover-estimate.js", "winding-tension.js", "workspace-configuration-payloads.js",
  "station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js",
  "station-connection-bridge.js", "station-recipes-bridge.js"
];

function snapshot(options) {
  const planned = !!(options && options.planned);
  const layers = ["A", "B", "C"].map((name, i) => ({
    name, layerPct: i === 1 ? 40 : 30,
    hoppers: Array.from({ length: 6 }, (_, index) => ({
      index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
      weight: index < 2 ? 300 : 0, usableHeight: 30, effectiveWeight: index < 2 ? 300 : 0, track: index === 0, pumpOff: false
    }))
  }));
  return {
    line: { lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers,
    nextRecipe: planned ? { layers: layers.map(layer => ({ name: layer.name, layerPct: layer.name === "A" ? 25 : layer.layerPct, hoppers: layer.hoppers.map(h => ({ index: h.index, pct: h.index === 0 ? 100 : 0, resinName: h.index === 0 ? "PLAN" + layer.name : "" })) })) } : null,
    revision: 1
  };
}

function boot(options) {
  focused = null;
  const doc = frameCapable(fakeDocument());
  const storage = fakeStorage();
  const window = {
    document: doc,
    location: { href: "https://resin.tools/?view=station", search: "?view=station" },
    matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),
    setTimeout: () => 1,
    clearTimeout() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    URL, Promise, console, Math, Date, Number, String, Object, Array, JSON, Error, Set, Map, WeakMap, Symbol, RegExp,
    parseInt, parseFloat, isFinite, isNaN, Intl,
    navigator: { userAgent: "node" },
    localStorage: storage
  };
  window.window = window;
  window.globalThis = window;
  window.self = window;
  doc.location = window.location;
  const context = vm.createContext(window);
  for (const file of SHARED.concat(hostScripts())) new vm.Script(read(file), { filename: file }).runInContext(context);

  const snap = snapshot(options);
  const stateBridge = window.PolynStationStateBridge;
  const contract = window.PolynStationCommandContract;
  const calls = [];
  const handle = stateBridge.connect({ read: () => snap });
  window.PolynStationCommandBridge.connect({
    execute(command, args) {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
      snap.revision += 1;
      handle.publish();
      return contract.success({ changed: true, revision: stateBridge.getRevision(), persisted: true, snapshot: stateBridge.getSnapshot() });
    },
    capabilities: [...contract.COMMANDS]
  });
  new vm.Script(read("station/station.js"), { filename: "station/station.js" }).runInContext(context);

  const q = selector => doc.querySelector(selector);
  const machine = q("[data-station-mount='machine']");
  const rail = q("[data-role='machine-rail']");
  const print = q("[data-action='print']");
  assert.ok(machine && rail && print, "Station booted with its stage, rail and Print");
  return {
    doc, window, calls, machine, rail, print, q, snap, handle,
    choice: which => q(`[data-action='print-${which}']`),
    rowOpen: () => q("[data-role='print-group'] .station-rail__flyout").getAttribute("data-open") === "true",
    frame: () => q("[data-station-mount='utility'] [data-role='print-frame']"),
    status: () => q("[data-station-mount='status']").textContent,
    stageKey: () => JSON.stringify(machine.querySelectorAll("[data-role='hopper']").map(h => [h.getAttribute("data-hopper"), h.getAttribute("data-state"), h.getAttribute("class")]))
  };
}

test("booted: Print stands under Tools; without a plan only Current is offered; Current prints the running recipe from the live snapshot into a frame in the utility slot, folds the row and says so; no command, no change to the stage", () => {
  const s = boot();
  assert.deepEqual(s.rail.children.map(node => node.getAttribute("data-role")), ["blend-group", "next-group", "weights-group", "tools-group", "print-group"]);
  assert.equal(s.print.disabled, false, "something to print: the hoppers carry resins");
  assert.equal(s.frame(), null);
  const stage = s.stageKey();
  s.print.click();
  assert.equal(s.rowOpen(), true);
  assert.equal(s.choice("current").disabled, false);
  assert.equal(s.choice("next").disabled, true);
  assert.equal(s.choice("both").disabled, true);
  s.choice("current").click();
  const frame = s.frame();
  assert.ok(frame, "the frame stands in the utility slot");
  assert.equal(frame.printed, 1);
  const sheet = frame.contentDocument.body.querySelector("[data-role='print-sheet']");
  const sections = sheet.querySelectorAll(".station-sheet__section");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].querySelector(".station-sheet__title").textContent, "Current Recipe");
  assert.match(sections[0].querySelector(".station-sheet__meta").textContent, /^Line 9 · 3 layers · Hopper naming: 1–6 · Printed /);
  assert.deepEqual(sections[0].querySelectorAll("tbody tr").map(tr => tr.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.deepEqual(cells(sections[0], "B").slice(0, 3), [["HX1", "60.00%"], ["LD1", "40.00%"], ["NOT USED", "0.00%"]]);
  assert.equal(sections[0].querySelector("tr[data-layer='B'] .station-sheet__layer-pct").textContent, "40.00%");
  assert.equal(s.rowOpen(), false, "the row folds on the choice, as the dialog closes");
  assert.equal(s.print.getAttribute("aria-pressed"), "false");
  assert.match(s.status(), /^Printing the Current Recipe sheet\./);
  assert.equal(s.calls.length, 0, "no command");
  assert.equal(s.stageKey(), stage, "the stage is untouched");
  assert.equal(s.doc.body.querySelector("[data-role='print-sheet']"), null, "nothing of the sheet on the page");
});

test("booted: with a plan, Next and Both are offered; Both prints the running recipe and the plan - the plan rebuilt slot for slot from the bridge's projection - on one sheet with a rule between; a plan that goes holds them again without a click", async () => {
  const s = boot({ planned: true });
  s.print.click();
  assert.equal(s.choice("next").disabled, false);
  assert.equal(s.choice("both").disabled, false);
  s.choice("both").click();
  const frame = s.frame();
  assert.equal(frame.printed, 1);
  const sections = frame.contentDocument.body.querySelectorAll(".station-sheet__section");
  assert.deepEqual(sections.map(x => [x.getAttribute("data-page"), x.classList.contains("station-sheet__section--divided")]), [["current", false], ["next", true]]);
  assert.deepEqual(cells(sections[0], "A").slice(0, 2), [["HX0", "60.00%"], ["LD0", "40.00%"]]);
  assert.deepEqual(cells(sections[1], "A").slice(0, 2), [["PLANA", "100.00%"], ["NOT USED", "0.00%"]]);
  assert.equal(sections[1].querySelector("tr[data-layer='A'] .station-sheet__layer-pct").textContent, "25.00%");
  assert.equal(sections[1].querySelector("tr[data-layer='B'] .station-sheet__layer-pct").textContent, "40.00%");
  assert.match(s.status(), /^Printing both recipes on one sheet\./);
  assert.equal(s.calls.length, 0);
  // Next alone: the plan under its own name.
  s.print.click();
  s.choice("next").click();
  const again = s.frame();
  assert.notEqual(again, frame, "a new frame for the new sheet");
  assert.equal(s.q("[data-station-mount='utility']").querySelectorAll("[data-role='print-frame']").length, 1);
  assert.equal(again.contentDocument.body.querySelector(".station-sheet__title").textContent, "Next Recipe");
  // A plan that goes away holds Next and Both again, through the same publish every reader follows.
  s.snap.nextRecipe = null;
  s.snap.revision += 1;
  s.handle.publish();
  await tick();
  assert.equal(s.choice("next").disabled, true);
  assert.equal(s.choice("both").disabled, true);
  assert.equal(s.choice("current").disabled, false);
});

test("booted: with nothing in any hopper and no plan, Print is held - exactly when the floor UI's button is", async () => {
  const s = boot();
  for (const layer of s.snap.layers) for (const hopper of layer.hoppers) { hopper.resinName = ""; hopper.pct = 0; }
  s.snap.revision += 1;
  s.handle.publish();
  await tick();
  assert.equal(s.print.disabled, true);
  assert.match(s.print.getAttribute("title"), /nothing to print/);
  s.snap.layers[0].hoppers[2].pct = 5;
  s.snap.revision += 1;
  s.handle.publish();
  await tick();
  assert.equal(s.print.disabled, false, "a share alone is something to print, as it is on the floor");
});

test("booted: one row at a time, as the faces are - Print folds Tools and the tool it holds, Tools folds Print, a face folds both, and either folds the face that is on", () => {
  const s = boot({ planned: true });
  const tools = s.q("[data-action='tools']");
  const tile = s.q("[data-action='winding-tension']");
  const weights = s.q("[data-action='weights-edit']");
  const toolsOpen = () => s.q("[data-role='tools-group'] .station-rail__flyout").getAttribute("data-open") === "true";
  const calcOpen = () => tile.getAttribute("aria-expanded") === "true";
  tools.click();
  tile.click();
  assert.ok(toolsOpen() && calcOpen());
  s.print.click();
  assert.equal(s.rowOpen(), true);
  assert.equal(toolsOpen(), false, "Print folds Tools");
  assert.equal(calcOpen(), false, "and the calculator with it");
  tools.click();
  assert.equal(toolsOpen(), true);
  assert.equal(s.rowOpen(), false, "Tools folds Print");
  weights.click();
  assert.equal(weights.getAttribute("aria-pressed"), "true");
  assert.equal(toolsOpen(), false, "a face folds Tools");
  s.print.click();
  assert.equal(s.rowOpen(), true);
  assert.equal(weights.getAttribute("aria-pressed"), "false", "Print leaves the face");
  assert.ok(!s.rail.classList.contains("is-weights-active"));
  weights.click();
  assert.equal(s.rowOpen(), false, "the face folds Print");
  tools.click();
  assert.equal(weights.getAttribute("aria-pressed"), "false", "Tools leaves the face");
  assert.equal(toolsOpen(), true);
  assert.equal(s.calls.length, 0);
});

test("the printer is loaded by the host and the harness after the Winding Tension calculator; the frame's stylesheet is linked with them; the floor UI's own dialog, sheet and print rule are untouched and nothing legacy styles the frame", () => {
  const host = read("station-host.js");
  const scripts = [...host.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(scripts.indexOf("station/station-print-sheet.js") > scripts.indexOf("station/station-winding-tension.js"));
  assert.ok(scripts.indexOf("station/station-print-sheet.js") < scripts.indexOf("station/station.js"));
  assert.match(host, /"station\/styles\/components\/winding-tension\.css",\s*"station\/styles\/components\/print-frame\.css"/);
  const harness = read("station/station.html");
  assert.match(harness, /station-print-sheet\.js\?v=/);
  assert.match(harness, /components\/print-frame\.css\?v=/);
  const indexHtml = read("index.html");
  assert.doesNotMatch(indexHtml, /station-print|print-frame\.css/);
  assert.match(indexHtml, /<dialog id="printRecipeDialog"/);
  const app = read("app.js");
  assert.match(app, /function printRecipeSheet\(which\)\{/);
  assert.match(app, /function openPrintRecipeDialog\(\)\{/);
  assert.doesNotMatch(app, /station-print|PolynStationPrintSheet/);
  assert.match(read("styles-surfaces.css"), /#recipePrintSheet\{ display:none; \}/);
  for (const sheet of fs.readdirSync(ROOT).filter(name => name.endsWith(".css"))) {
    assert.doesNotMatch(read(sheet), /station-print|station-sheet/, `${sheet} styles the printer`);
  }
  // The frame: a box of no size, invisible and inert; no print rule in any Station sheet.
  const css = read("station/styles/components/print-frame.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.station-print__frame \{[^}]*width: 0;[^}]*height: 0;[^}]*opacity: 0;[^}]*pointer-events: none;/);
  assert.doesNotMatch(css, /@media|display: none/);
  for (const name of fs.readdirSync(path.join(ROOT, "station/styles/components"))) {
    assert.doesNotMatch(read(path.join("station/styles/components", name)), /@media print/, `${name} carries a print rule`);
  }
});
