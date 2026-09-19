"use strict";

/* The card rail (station/station-card-rail.js): the two switches riding
 * the right side of the far-right layer card while a face is on -
 * Compare, the other recipe's resin on every card at once, and Large,
 * the type on every card up by a quarter.
 *
 * Three layers of test. The component alone: what it draws, what a
 * click hands back, what it shows when told. The renderer: where the
 * rail stands in the drawing, what the size stamps, and that nothing
 * else moves. Then Station booted for real - every module the host
 * loads, in the host's order - to drive the switches over the cards:
 * Compare told to every card in place, held where there is nothing to
 * compare, kept across faces and the mode's end; Large stamped in place
 * and kept by a rebuilt stage; no command, no redraw, nothing stored.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const railModule = require("./station/station-card-rail.js");
const render = require("./station/station-render.js");
const parts = require("./station/station-machine-parts.js");
const layoutModule = require("./station/station-machine-layout.js");
const lineModel = require("./station/station-line-model.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake DOM (the boot tests' one, as station-pressure.test.js has it)
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


const tick = () => new Promise(resolve => setImmediate(resolve));

/* ----------------------------------------------------------------------
 *   The component alone
 * -------------------------------------------------------------------- */

function build() {
  const doc = fakeDocument();
  const clicks = [];
  const rail = railModule.create(doc, { onCompare: () => clicks.push("compare"), onSize: () => clicks.push("size") });
  return { doc, clicks, rail };
}

test("the rail is a group of two switches, Compare then Large, each a button with a glyph and no words; a click is handed back and changes nothing until the rail is told", () => {
  const { rail, clicks } = build();
  assert.equal(rail.element.getAttribute("data-role"), "card-rail");
  assert.equal(rail.element.getAttribute("role"), "group");
  assert.deepEqual(rail.element.children.map(n => n.getAttribute("data-action")), ["compare", "size"]);
  for (const button of rail.element.children) {
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(button.textContent, "", "words on the tile");
    assert.equal(button.children.length, 1);
    assert.equal(button.children[0].nodeName, "svg");
    assert.equal(button.children[0].getAttribute("aria-hidden"), "true");
    assert.ok(button.children[0].children.length >= 2, "a glyph with no marks");
    assert.ok(button.getAttribute("title"), "no title");
    assert.ok(button.getAttribute("aria-label"), "no label");
  }
  assert.ok(rail.compareButton === rail.element.children[0]);
  assert.ok(rail.sizeButton === rail.element.children[1]);
  assert.equal(rail.element.getAttribute("data-size"), "normal");
  rail.compareButton.click();
  rail.sizeButton.click();
  assert.deepEqual(clicks, ["compare", "size"]);
  assert.equal(rail.compareButton.getAttribute("aria-pressed"), "false", "the rail decided for itself");
  assert.equal(rail.sizeButton.getAttribute("aria-pressed"), "false");
  // A click does not reach the stage under the rail.
  const event = makeEvent("click", { bubbles: true });
  rail.compareButton.dispatchEvent(event);
  assert.equal(event.stopped, true);
});

test("told: Compare shows on, held with its reason, and off; Large shows on and off and stamps the rail; a held Compare click hands nothing back", () => {
  const { rail, clicks } = build();
  rail.update({ compare: { active: true, available: true } });
  assert.equal(rail.compareButton.getAttribute("aria-pressed"), "true");
  assert.ok(rail.compareButton.classList.contains("is-active"));
  assert.equal(rail.compareButton.disabled, false);
  assert.match(rail.compareButton.getAttribute("title"), /^Compare on · /);
  rail.update({ compare: { active: true, available: false, reason: "nothing is planned to compare with" } });
  assert.equal(rail.compareButton.disabled, true);
  assert.equal(rail.compareButton.hasAttribute("disabled"), true);
  assert.equal(rail.compareButton.getAttribute("aria-pressed"), "true", "the state outlives the offer");
  assert.equal(rail.compareButton.getAttribute("title"), "Compare · nothing is planned to compare with");
  rail.compareButton.click();
  assert.deepEqual(clicks, [], "a held switch handed a click back");
  rail.update({ compare: { active: false, available: true } });
  assert.equal(rail.compareButton.disabled, false);
  assert.equal(rail.compareButton.hasAttribute("disabled"), false);
  assert.equal(rail.compareButton.getAttribute("aria-pressed"), "false");
  assert.match(rail.compareButton.getAttribute("title"), /^Compare · show the other recipe/);
  rail.update({ size: "large" });
  assert.equal(rail.sizeButton.getAttribute("aria-pressed"), "true");
  assert.ok(rail.sizeButton.classList.contains("is-active"));
  assert.equal(rail.element.getAttribute("data-size"), "large");
  assert.match(rail.sizeButton.getAttribute("title"), /^Large cards on · /);
  assert.deepEqual(rail.getState(), { compare: { active: false, available: true, reason: "" }, size: "large" });
  rail.update({ size: "huge" });
  assert.equal(rail.element.getAttribute("data-size"), "large", "an unknown size was taken");
  rail.update({ size: "normal" });
  assert.equal(rail.sizeButton.getAttribute("aria-pressed"), "false");
  assert.equal(rail.element.getAttribute("data-size"), "normal");
  // Nothing of the stage: no job read, no command, no storage.
  const source = read("station/station-card-rail.js");
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /dispatch|PolynStationCommand|localStorage|sessionStorage|getBoundingClientRect|ResizeObserver/);
});

/* ----------------------------------------------------------------------
 *   The renderer: where the rail stands, what the size stamps
 * -------------------------------------------------------------------- */

const stationSource = require("./station/station-source.js");

function model(layerCount) {
  const count = layerCount || 3;
  const names = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
  const snap = {
    line: { lineNumber: 11, displayName: "Line 11", layerCount: count, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers: names.map(name => ({
      name, layerPct: Math.round(100 / count),
      hoppers: Array.from({ length: 6 }, (_, index) => ({ index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index < 2 ? "HX" : "", weight: 400, usableHeight: 30, effectiveWeight: 400, track: false, pumpOff: false }))
    })),
    revision: 1
  };
  const r = stationSource.resolveSource({ snapshot: snap, mode: "auto" });
  const m = lineModel.buildLineModel(r.modelInput);
  assert.ok(m, "no model");
  return { model: m, hopperState: r.hopperState };
}

function allWith(node, attr, value) { return node.querySelectorAll(`[${attr}='${value}']`); }
function layerGroup(svg, id) { return allWith(svg, "data-role", "layer").find(n => n.getAttribute("data-layer") === id); }
const boxOf = node => ["x", "y", "width", "height"].map(k => Number(node.getAttribute(k)));

test("the rail stands against the far-right bank's card: a foreignObject a gap off its right edge, top-aligned, as tall as the card, inside the canvas; none without cards, none in the focus layout", () => {
  const doc = fakeDocument();
  const { model: m, hopperState } = model(5);
  const content = doc.createElement("div");
  content.setAttribute("data-role", "card-rail");
  const cards = {};
  for (const layer of m.layers) cards[layer.id] = doc.createElement("div");
  const svg = render.renderStage(m, { document: doc, hopperState, blendEdit: true, blendCards: cards, cardRail: content });
  const hosts = allWith(svg, "data-role", "card-rail").filter(n => n.nodeName === "foreignObject");
  assert.equal(hosts.length, 1, "one rail");
  const host = hosts[0];
  assert.ok(host.parent === svg, "the rail is not the stage's own child");
  assert.ok(svg.children.indexOf(host) > svg.children.findIndex(n => n.getAttribute("data-role") === "layer-row"), "the rail is under the row");
  assert.ok(host.children[0] === content, "the rail is not the element handed in");
  // The far-right bank in canvas order: the last placed, whatever its id.
  const layout = layoutModule.computeLayout(m, { hopperState });
  const far = layout.banks.reduce((a, b) => (b.x + b.width > a.x + a.width ? b : a));
  assert.equal(host.getAttribute("data-layer"), far.id);
  const card = parts.blendCardBox(far);
  const [x, y, w, h] = boxOf(host);
  assert.equal(x, card.x + card.width + parts.CARD_RAIL.gap);
  assert.equal(y, card.y);
  assert.equal(w, parts.CARD_RAIL.width);
  assert.equal(h, card.height);
  assert.deepEqual(parts.cardRailBox(far), { x, y, width: w, height: h });
  // It fits inside the canvas the five-layer line fills.
  const [, , canvasWidth] = svg.getAttribute("viewBox").split(" ").map(Number);
  assert.ok(x + w <= canvasWidth, `the rail runs off the canvas: ${x + w} > ${canvasWidth}`);
  assert.ok(x + w <= canvasWidth - 2, "the rail touches the canvas edge");
  // The rail rides the card whether the far-right layer is turned over or not.
  const back = render.renderStage(m, { document: doc, hopperState, blendEdit: true, blendCards: cards, cardRail: content, flipped: ["A"] });
  assert.deepEqual(boxOf(allWith(back, "data-role", "card-rail")[0]), [x, y, w, h]);
  // No cards: no rail, even with the element handed in.
  const plain = render.renderStage(m, { document: doc, hopperState, cardRail: content });
  assert.equal(allWith(plain, "data-role", "card-rail").length, 0);
  const empty = render.renderStage(m, { document: doc, hopperState, blendEdit: true, blendCards: {}, cardRail: content });
  assert.equal(allWith(empty, "data-role", "card-rail").length, 0);
  // No element: no rail.
  const none = render.renderStage(m, { document: doc, hopperState, blendEdit: true, blendCards: cards });
  assert.equal(allWith(none, "data-role", "card-rail").length, 0);
  // The focus layout has no cards and no rail.
  const focused = render.renderStage(m, { document: doc, hopperState, focusLayer: "B", blendEdit: true, blendCards: cards, cardRail: content, stageAspect: 1.6 });
  assert.equal(allWith(focused, "data-role", "card-rail").length, 0);
  // A one-layer line: the rail rides its one card.
  const one = model(1);
  const oneSvg = render.renderStage(one.model, { document: doc, hopperState: one.hopperState, blendEdit: true, blendCards: { A: doc.createElement("div") }, cardRail: content });
  assert.equal(allWith(oneSvg, "data-role", "card-rail")[0].getAttribute("data-layer"), "A");
  // The mount forwards it.
  const mount = doc.createElement("section");
  render.mountStage(mount, m, { document: doc, hopperState, blendEdit: true, blendCards: cards, cardRail: content, stageAspect: 1.6 });
  assert.equal(allWith(mount, "data-role", "card-rail").filter(n => n.nodeName === "foreignObject").length, 1);
});

test("the size is stamped on every card's group and changes no box: the card's frame, its editor, its declared boxes and the viewBox are the same at both sizes; setCardSize stamps a mounted stage in place", () => {
  const doc = fakeDocument();
  const { model: m, hopperState } = model(3);
  const cards = {};
  for (const layer of m.layers) cards[layer.id] = doc.createElement("div");
  const normal = render.renderStage(m, { document: doc, hopperState, blendEdit: true, blendCards: cards });
  const large = render.renderStage(m, { document: doc, hopperState, blendEdit: true, blendCards: cards, cardSize: "large" });
  const odd = render.renderStage(m, { document: doc, hopperState, blendEdit: true, blendCards: cards, cardSize: "enormous" });
  assert.deepEqual(allWith(normal, "data-role", "blend-card").map(c => c.getAttribute("data-size")), ["normal", "normal", "normal"]);
  assert.deepEqual(allWith(large, "data-role", "blend-card").map(c => c.getAttribute("data-size")), ["large", "large", "large"]);
  assert.deepEqual(allWith(odd, "data-role", "blend-card").map(c => c.getAttribute("data-size")), ["normal", "normal", "normal"], "an unknown size was stamped");
  assert.equal(large.getAttribute("viewBox"), normal.getAttribute("viewBox"));
  for (const id of ["A", "B", "C"]) {
    for (const attr of ["data-object-cluster", "data-object-train", "data-object-card"]) {
      assert.equal(layerGroup(large, id).getAttribute(attr), layerGroup(normal, id).getAttribute(attr), `${id}'s ${attr} moved with the size`);
    }
    const a = allWith(layerGroup(normal, id), "data-role", "blend-card")[0];
    const b = allWith(layerGroup(large, id), "data-role", "blend-card")[0];
    assert.deepEqual(boxOf(b.querySelector("rect")), boxOf(a.querySelector("rect")), `${id}'s frame grew`);
    assert.deepEqual(boxOf(b.querySelector("foreignObject")), boxOf(a.querySelector("foreignObject")), `${id}'s editor box grew`);
  }
  const layout = layoutModule.computeLayout(m, { hopperState });
  for (const bank of layout.banks) assert.deepEqual(parts.blendCardBox(bank, "large"), parts.blendCardBox(bank), "the box reads a size");
  // In place: the same groups, stamped; the count says how many.
  const mount = doc.createElement("section");
  render.mountStage(mount, m, { document: doc, hopperState, blendEdit: true, blendCards: cards, stageAspect: 1.6 });
  const before = allWith(mount, "data-role", "blend-card");
  assert.equal(render.setCardSize(mount, "large"), 3);
  const after = allWith(mount, "data-role", "blend-card");
  for (let i = 0; i < 3; i++) assert.ok(before[i] === after[i], "a card was rebuilt");
  assert.deepEqual(after.map(c => c.getAttribute("data-size")), ["large", "large", "large"]);
  assert.equal(render.setCardSize(mount, "normal"), 3);
  assert.deepEqual(after.map(c => c.getAttribute("data-size")), ["normal", "normal", "normal"]);
  assert.equal(render.setCardSize(mount, "whatever"), 3);
  assert.deepEqual(after.map(c => c.getAttribute("data-size")), ["normal", "normal", "normal"]);
  assert.equal(render.setCardSize(null, "large"), 0);
  const bare = doc.createElement("section");
  render.mountStage(bare, m, { document: doc, hopperState, stageAspect: 1.6 });
  assert.equal(render.setCardSize(bare, "large"), 0, "a stage without cards has something to stamp");
});

/* ----------------------------------------------------------------------
 *   Station booted for real
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const files = [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(files.includes("station/station-card-rail.js"), "the host loads the card rail");
  assert.ok(files.indexOf("station/station-card-rail.js") < files.indexOf("station/station.js"));
  return files.filter(file => file !== "station/station.js");
}

const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "changeover-estimate.js", "winding-tension.js", "pressure-conversion.js", "resin-totals.js", "workspace-configuration-payloads.js",
  "station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js",
  "station-connection-bridge.js", "station-recipes-bridge.js", "station-weight-profiles-bridge.js"
];

function snapshot(options) {
  const settings = options || {};
  const layers = ["A", "B", "C"].map((name, i) => ({
    name, layerPct: i === 1 ? 40 : 30,
    hoppers: Array.from({ length: 6 }, (_, index) => ({
      index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
      weight: 400, usableHeight: 30, usableGallons: 0, effectiveWeight: 400, smartWeight: null, track: false, pumpOff: false
    }))
  }));
  const snap = {
    line: { lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    smartHoppers: { enabled: false, geometryMode: "cylindrical", circumference: 40 },
    layers,
    revision: 1
  };
  if (settings.planned) {
    // The plan: the running recipe with one hopper changed on every layer.
    snap.nextRecipe = { layers: layers.map(layer => ({
      name: layer.name, layerPct: layer.layerPct,
      hoppers: layer.hoppers.map(h => ({ index: h.index, pct: h.pct, resinName: h.index === 0 ? "PLAN" : h.resinName }))
    })) };
  }
  return snap;
}

function boot(options) {
  const settings = options || {};
  focused = null;
  const doc = fakeDocument();
  const storage = fakeStorage();
  const window = {
    document: doc,
    location: { href: "https://resin.tools/?view=station", search: "?view=station" },
    matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
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
  const skip = settings.skip || [];
  for (const file of SHARED.concat(hostScripts())) {
    if (skip.includes(file)) continue;
    new vm.Script(read(file), { filename: file }).runInContext(context);
  }
  const snap = snapshot(settings);
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
  const blend = q("[data-action='blend-edit']");
  const next = q("[data-action='next-edit']");
  const weights = q("[data-action='weights-edit']");
  assert.ok(machine && blend && next && weights, "Station booted with its stage and rail");
  const rail = () => machine.querySelector("[data-role='card-rail'].station-card-rail");
  return {
    doc, window, snap, handle, calls, storage, machine, blend, next, weights, q, rail,
    host: () => machine.querySelectorAll("[data-role='card-rail']").find(n => n.nodeName === "foreignObject") || null,
    compare: () => rail() && rail().querySelector("[data-action='compare']"),
    size: () => rail() && rail().querySelector("[data-action='size']"),
    cards: () => machine.querySelectorAll("[data-role='blend-card']"),
    editors: () => machine.querySelectorAll("[data-role='blend-card'] .station-editor"),
    shown: () => machine.querySelectorAll("[data-role='blend-card'] .station-editor").map(e => e.getAttribute("data-show-other")),
    sizes: () => machine.querySelectorAll("[data-role='blend-card']").map(c => c.getAttribute("data-size")),
    stageKey: () => JSON.stringify(machine.querySelectorAll("[data-role='hopper']").map(h => [h.getAttribute("data-hopper"), h.getAttribute("data-state")]))
  };
}

test("booted: no rail until a face is on; on, one rail in the stage against the far-right card; Compare is held with its reason while nothing is planned, and Large is offered; the mode ending takes the rail with the cards", () => {
  const s = boot();
  assert.equal(s.host(), null, "a rail before any card");
  assert.equal(s.rail(), null);
  s.blend.click();
  assert.equal(s.cards().length, 3);
  const host = s.host();
  assert.ok(host, "no rail with the cards");
  assert.equal(host.getAttribute("data-layer"), "C", "the rail does not ride the far-right card");
  assert.ok(host.parent === s.machine.querySelector(".station-machine__stage"), "the rail is not in the stage's svg");
  assert.equal(s.machine.querySelectorAll("[data-role='card-rail']").filter(n => n.nodeName === "foreignObject").length, 1);
  assert.equal(s.compare().disabled, true, "Compare is offered with nothing planned");
  assert.equal(s.compare().getAttribute("title"), "Compare · nothing is planned to compare with");
  assert.equal(s.compare().getAttribute("aria-pressed"), "false");
  assert.equal(s.size().disabled, false);
  assert.equal(s.size().getAttribute("aria-pressed"), "false");
  assert.deepEqual(s.sizes(), ["normal", "normal", "normal"]);
  // Held: a click changes nothing.
  s.compare().click();
  assert.deepEqual(s.shown(), [null, null, null], "cards without the plan carry the attribute");
  assert.equal(s.calls.length, 0);
  s.blend.click();
  assert.equal(s.cards().length, 0);
  assert.equal(s.host(), null, "the rail outlived the cards");
});

test("booted, with a plan: Compare is offered; on, every card shows its entries at once, in place - the same cards, no redraw, no command; off again hides them; the state is kept across a face switch, the mode's end and a rebuilt stage; the Weights face holds it", async () => {
  const s = boot({ planned: true });
  s.blend.click();
  assert.equal(s.compare().disabled, false, "Compare is held with a plan");
  assert.match(s.compare().getAttribute("title"), /^Compare · show the other recipe/);
  assert.deepEqual(s.shown(), ["false", "false", "false"], "a card starts with its entries shown");
  const before = s.editors();
  const stage = s.stageKey();
  s.compare().click();
  assert.deepEqual(s.shown(), ["true", "true", "true"]);
  const after = s.editors();
  for (let i = 0; i < 3; i++) assert.ok(before[i] === after[i], "Compare redrew the cards");
  assert.equal(s.compare().getAttribute("aria-pressed"), "true");
  assert.match(s.compare().getAttribute("title"), /^Compare on · /);
  assert.equal(s.calls.length, 0, "Compare issued a command");
  assert.equal(s.stageKey(), stage, "Compare changed the stage");
  // The entries themselves: the plan's resin where it differs, and only there.
  for (const editor of after) {
    const entries = editor.querySelectorAll(".station-editor__other");
    assert.equal(entries.length, 6);
    assert.deepEqual(entries.map(e => e.getAttribute("data-differs")), ["true", "false", "false", "false", "false", "false"]);
    assert.equal(entries[0].textContent, "nextPLAN");
  }
  // A publish keeps it: the value path updates the cards in place.
  s.snap.revision += 1;
  s.handle.publish();
  await tick();
  assert.deepEqual(s.shown(), ["true", "true", "true"]);
  assert.equal(s.compare().getAttribute("aria-pressed"), "true");
  // Off again.
  s.compare().click();
  assert.deepEqual(s.shown(), ["false", "false", "false"]);
  assert.equal(s.compare().getAttribute("aria-pressed"), "false");
  // On, then the Next face: the same switch, on, the entries now the running job's.
  s.compare().click();
  s.next.click();
  assert.equal(s.machine.getAttribute("data-edit-face"), "next");
  assert.deepEqual(s.shown(), ["true", "true", "true"], "a face switch dropped Compare");
  assert.equal(s.compare().getAttribute("aria-pressed"), "true");
  assert.equal(s.compare().disabled, false);
  assert.equal(s.editors()[0].querySelector(".station-editor__other-tag").textContent, "current");
  assert.equal(s.editors()[0].querySelector(".station-editor__other-code").textContent, "HX0");
  // The Weights face: no other recipe; the switch is held, the state kept.
  s.weights.click();
  assert.equal(s.machine.getAttribute("data-edit-face"), "weights");
  assert.ok(s.host(), "the Weights face has no rail");
  assert.equal(s.compare().disabled, true);
  assert.equal(s.compare().getAttribute("title"), "Compare · the weight cards have no other recipe to show");
  assert.equal(s.compare().getAttribute("aria-pressed"), "true");
  assert.equal(s.size().disabled, false, "Large is held on the Weights face");
  // The mode ends and begins again: Compare as it was left.
  s.weights.click();
  assert.equal(s.host(), null);
  s.blend.click();
  assert.deepEqual(s.shown(), ["true", "true", "true"], "the mode's end dropped Compare");
  assert.equal(s.compare().getAttribute("aria-pressed"), "true");
  // Nothing stored.
  assert.equal(s.storage.map.size, 0, "something was stored");
});

test("booted: a plan arriving under the cards offers Compare, and one going holds it - without losing the switch's state", async () => {
  const s = boot();
  s.blend.click();
  assert.equal(s.compare().disabled, true);
  s.snap.nextRecipe = snapshot({ planned: true }).nextRecipe;
  s.snap.revision += 1;
  s.handle.publish();
  await tick();
  assert.equal(s.compare().disabled, false, "a plan arriving left Compare held");
  assert.deepEqual(s.shown(), ["false", "false", "false"]);
  s.compare().click();
  assert.deepEqual(s.shown(), ["true", "true", "true"]);
  delete s.snap.nextRecipe;
  s.snap.revision += 1;
  s.handle.publish();
  await tick();
  assert.equal(s.compare().disabled, true, "a plan going left Compare offered");
  assert.equal(s.compare().getAttribute("aria-pressed"), "true", "the state went with the plan");
  assert.deepEqual(s.shown(), [null, null, null], "cards rebuilt without the plan carry the attribute");
});

test("booted: Large stamps every card in place - the same cards, no redraw, no command - and a rebuilt stage, another face and the mode begun again are built with it; off again the same way", async () => {
  const s = boot({ planned: true });
  s.blend.click();
  const before = s.cards();
  const stage = s.stageKey();
  s.size().click();
  assert.deepEqual(s.sizes(), ["large", "large", "large"]);
  const after = s.cards();
  for (let i = 0; i < 3; i++) assert.ok(before[i] === after[i], "Large redrew the cards");
  assert.equal(s.size().getAttribute("aria-pressed"), "true");
  assert.equal(s.rail().getAttribute("data-size"), "large");
  assert.equal(s.calls.length, 0);
  assert.equal(s.stageKey(), stage);
  for (const card of after) {
    assert.deepEqual(boxOf(card.querySelector("rect")), boxOf(card.querySelector("foreignObject")));
  }
  // A rebuilt stage (a plan turning under the cards) is built large.
  delete s.snap.nextRecipe;
  s.snap.revision += 1;
  s.handle.publish();
  await tick();
  assert.deepEqual(s.sizes(), ["large", "large", "large"], "a rebuilt stage lost the size");
  assert.equal(s.size().getAttribute("aria-pressed"), "true");
  // Every face: the weight cards are stamped too.
  s.weights.click();
  assert.deepEqual(s.sizes(), ["large", "large", "large"]);
  s.weights.click();
  s.next.click();
  assert.deepEqual(s.sizes(), ["large", "large", "large"]);
  s.next.click();
  s.blend.click();
  assert.deepEqual(s.sizes(), ["large", "large", "large"], "the mode begun again lost the size");
  s.size().click();
  assert.deepEqual(s.sizes(), ["normal", "normal", "normal"]);
  assert.equal(s.size().getAttribute("aria-pressed"), "false");
  assert.equal(s.storage.map.size, 0);
  // Without the module, Station boots and the cards stand without a rail.
  const bare = boot({ skip: ["station/station-card-rail.js"] });
  bare.blend.click();
  assert.equal(bare.cards().length, 3);
  assert.equal(bare.host(), null);
  assert.deepEqual(bare.sizes(), ["normal", "normal", "normal"]);
});

/* ----------------------------------------------------------------------
 *   The contract on the files
 * -------------------------------------------------------------------- */

test("the harness and the host load the module and its sheet; the boot file keeps the two states as session presentation, tells the cards in place and never stores them; the card's own eye is gone", () => {
  const harness = read("station/station.html");
  assert.match(harness, /<script src="station-card-rail\.js\?v=[^"]+" defer><\/script>/);
  assert.match(harness, /<link rel="stylesheet" href="styles\/components\/card-rail\.css\?v=[^"]+">/);
  assert.ok(harness.indexOf("station-card-rail.js") < harness.indexOf('src="station.js'), "the boot file runs before the rail");
  const host = read("station-host.js");
  assert.ok(host.includes('"station/styles/components/card-rail.css"'));
  const boot = read("station/station.js");
  assert.match(boot, /const cardRailModule = root\.PolynStationCardRail \|\| null;/);
  assert.match(boot, /const cardView = \{ compare: false, size: "normal" \};/);
  assert.match(boot, /function toggleCompare\(\) \{\n\s+cardView\.compare = !cardView\.compare;\n\s+for \(const id of Object\.keys\(cardHandles\)\) \{\n\s+if \(typeof cardHandles\[id\]\.setShowOther === "function"\) cardHandles\[id\]\.setShowOther\(cardView\.compare\);\n\s+\}\n\s+syncCardRail\(\);/);
  assert.match(boot, /function toggleCardSize\(\) \{\n\s+cardView\.size = cardView\.size === "large" \? "normal" : "large";\n\s+if \(mounts\.machine && typeof render\.setCardSize === "function"\) render\.setCardSize\(mounts\.machine, cardView\.size\);\n\s+syncCardRail\(\);/);
  assert.match(boot, /cardSize: cardView\.size,\n\s+cardRail: cardRail \? cardRail\.element : null,/);
  assert.doesNotMatch(boot, /cardView[^\n]*(localStorage|sessionStorage|setItem)/);
  assert.doesNotMatch(read("station/station-focus-editor.js"), /station-editor__eye|onShowOther|buildEye/);
  const css = read("station/styles/components/card-rail.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|!important/i, "the sheet names a colour");
  assert.match(css, /\.station-root \.station-card-rail__control \{/, "the control is not scoped past the root's button reset");
  assert.match(css, /\.station-root \.station-card-rail__control\[aria-pressed="true"\]/);
  assert.match(css, /\.station-root \.station-card-rail__control:disabled \{/);
  assert.doesNotMatch(css, /position: (absolute|fixed)|left:|top:|transform/, "the sheet places the rail");
});
