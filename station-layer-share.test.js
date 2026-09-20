"use strict";

/* The layer's share, edited in its header (station/station-layer-share.js).
 *
 * Two levels:
 *
 *   the module     pure readers (what the bridge offers, what a drawn share's
 *                  element says) and the field's lifecycle over a small fake
 *                  DOM: open, commit, cancel, refusal;
 *   the boot file  station.js run for real, as station-blend-edit-exit.test.js
 *                  runs it - every module the production host loads, over the
 *                  fake DOM, the bridges connected the way app.js connects
 *                  them - so what is driven is the drawn stage: a click on
 *                  the header's share, the field it opens, the command it
 *                  issues, and the header the publish policy patches back.
 *
 * The executor here is a small model of the application's own
 * setLayerShare: it writes the layer's share into the snapshot the state
 * bridge reads and answers with the new revision, so the answer runs the
 * policy's value path exactly as the application's answer does.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const share = require("./station/station-layer-share.js");

/* ----------------------------------------------------------------------
 *   A fake DOM, as the Blend Edit exit tests have it
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
    attributes: {}, children: [], parent: null, listeners: {}, style: {}, dataset: {}, value: "", disabled: false,
    ownerDocument: doc,
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get parentNode() { return this.parent; },
    get parentElement() { return this.parent; },
    get textContent() { return this._text !== undefined && !this.children.length ? this._text : this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this.children = []; this._text = String(v); },
    get innerHTML() { return ""; },
    set innerHTML(v) { this.children = []; },
    get hidden() { return this.hasAttribute("hidden"); },
    set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); },
    get id() { return this.getAttribute("id") || ""; },
    set id(v) { this.setAttribute("id", v); },
    get className() { return this.getAttribute("class") || ""; },
    set className(v) { this.setAttribute("class", v); },
    get isConnected() { let n = this; while (n) { if (n === doc) return true; n = n.parent; } return false; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { if (child.parent) child.parent.removeChild(child); this.children.push(child); child.parent = this; this._text = undefined; return child; },
    append(...kids) { for (const k of kids) this.appendChild(typeof k === "string" ? doc.createTextNode(k) : k); },
    prepend(...kids) { for (const k of kids.reverse()) { const c = typeof k === "string" ? doc.createTextNode(k) : k; if (c.parent) c.parent.removeChild(c); this.children.unshift(c); c.parent = this; } },
    insertBefore(fresh, ref) { if (fresh.parent) fresh.parent.removeChild(fresh); const at = ref ? this.children.indexOf(ref) : -1; if (at < 0) this.children.push(fresh); else this.children.splice(at, 0, fresh); fresh.parent = this; return fresh; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    replaceChild(fresh, old) { const at = this.children.indexOf(old); if (at < 0) throw new Error("not a child"); if (fresh.parent) fresh.parent.removeChild(fresh); this.children[at] = fresh; fresh.parent = this; old.parent = null; return old; },
    replaceChildren(...kids) { for (const c of this.children) c.parent = null; this.children = []; this.append(...kids); },
    remove() { if (this.parent) this.parent.removeChild(this); },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (n.nodeType === 1 && matches(n, selector)) return n; n = n.parent; } return null; },
    matches(selector) { return matches(this, selector); },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && n.nodeType === 1 && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    getElementsByTagName(tag) { return this.querySelectorAll(tag); },
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
    select() { this.selected = true; },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    getBBox() { return { x: 0, y: 0, width: 10, height: 10 }; },
    scrollIntoView() {},
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
  doc.createDocumentFragment = () => makeNode(doc, "#fragment");
  doc.head = doc.appendChild(makeNode(doc, "head"));
  doc.body = doc.appendChild(makeNode(doc, "body"));
  doc.documentElement = doc;
  doc.readyState = "complete";
  Object.defineProperty(doc, "activeElement", { get: () => focused });
  return doc;
}

const key = (input, k) => input.dispatchEvent(makeEvent("keydown", { key: k, bubbles: true }));
const type = (input, value) => { input.value = String(value); input.dispatchEvent(makeEvent("input", { bubbles: true })); };

/* ----------------------------------------------------------------------
 *   The module
 * -------------------------------------------------------------------- */

function bridgeWith(capabilities, dispatch) {
  return {
    isAvailable: () => true,
    capabilities: () => capabilities,
    dispatch: dispatch || (() => ({ ok: true, changed: true, revision: 2, persisted: true, snapshot: null }))
  };
}

test("the share is on offer only from a connected bridge that declares setLayerShare, for a named recipe", () => {
  assert.deepEqual(share.abilities(null, "current"), { share: false });
  assert.deepEqual(share.abilities({ isAvailable: () => false, capabilities: () => ["setLayerShare"], dispatch() {} }, "current"), { share: false });
  assert.deepEqual(share.abilities(bridgeWith(["setHopperBlend"]), "current"), { share: false });
  assert.deepEqual(share.abilities(bridgeWith(["setLayerShare"]), "current"), { share: true });
  assert.deepEqual(share.abilities(bridgeWith(["setLayerShare"]), "next"), { share: true }, "the share is recipe state: any recipe may carry it");
  assert.deepEqual(share.abilities(bridgeWith(["setLayerShare"]), null), { share: false });
  assert.match(share.reason(null, "current"), /no application is connected/);
  assert.match(share.reason(bridgeWith([]), "current"), /does not offer layer shares/);
  assert.match(share.reason(bridgeWith(["setLayerShare"]), null), /no recipe/);
});

test("a drawn share's element says which layer and whether it may be changed; anything else is not a request", () => {
  const doc = fakeDocument();
  const g = doc.createElement("g");
  g.setAttribute("data-station-target", "share");
  g.setAttribute("data-layer", "C");
  g.setAttribute("data-able", "true");
  assert.deepEqual(share.requestFrom(g), { layer: "C", able: true });
  g.setAttribute("data-able", "false");
  assert.deepEqual(share.requestFrom(g), { layer: "C", able: false });
  g.setAttribute("data-station-target", "mixer");
  assert.equal(share.requestFrom(g), null);
  assert.equal(share.requestFrom(null), null);
  const bare = doc.createElement("g");
  bare.setAttribute("data-station-target", "share");
  assert.equal(share.requestFrom(bare), null, "a share with no layer is not a request");
});

test("the field opens with the value as the label shows it: rounded, and blank for an unknown share", () => {
  assert.equal(share.restingText(20), "20");
  assert.equal(share.restingText(33.333), "33.33");
  assert.equal(share.restingText(0), "");
  assert.equal(share.restingText(null), "");
  assert.equal(share.restingText(NaN), "");
});

/* A drawn share as the renderer builds it, on its own. */
function drawnShare(doc, layer, able) {
  const parts = require("./station/station-machine-parts.js");
  const bank = { id: layer, scale: 1, header: { x: 100, y: 22 } };
  const g = parts.layerShare(doc, bank, 20, able);
  doc.body.appendChild(g);
  return g;
}

test("open puts a field in the slot's own box, the label hidden under it, and hands the caret to it", () => {
  const doc = fakeDocument();
  const target = drawnShare(doc, "B", true);
  const face = target.querySelector(".station-layer__share-face");
  const records = [];
  const handle = share.open(doc, { target, layer: "B", value: 20, commands: bridgeWith(["setLayerShare"]), recipe: "current", onEditing: r => records.push(r) });
  assert.ok(handle && handle.isOpen());
  assert.equal(handle.layer, "B");
  const host = target.querySelector("foreignObject");
  assert.ok(host, "no <foreignObject> in the slot");
  assert.equal(host.getAttribute("class"), "station-layer__share-editor");
  for (const attr of ["x", "y", "width", "height"]) assert.equal(host.getAttribute(attr), face.getAttribute(attr), "the field's box is not the slot's");
  assert.ok(target.classList.contains("is-editing"));
  const input = host.querySelector("input");
  assert.equal(input.value, "20");
  assert.equal(input.getAttribute("inputmode"), "decimal");
  assert.equal(input.getAttribute("aria-label"), "Layer B percentage");
  assert.equal(input.getAttribute("data-slot"), "share");
  assert.ok(doc.activeElement === input, "the caret is not in the field");
  assert.equal(input.selected, true, "the value is not selected for overtyping");
  assert.equal(host.querySelector(".station-layer__share-unit").textContent, "%");
  assert.deepEqual(records, [{ layer: "B", index: null, hopper: null, slot: "share", mode: "typing", draft: "20", baseValue: "20" }]);
  // The value and the face are still there under it: the label the
  // publish policy patches is not replaced by the field.
  assert.ok(target.querySelector(".station-layer__share-value"));
  assert.equal(target.querySelector(".station-layer__share-value").textContent, "20%");
});

test("open refuses a slot it cannot measure, and touches nothing", () => {
  const doc = fakeDocument();
  const bare = doc.createElement("g");
  assert.equal(share.open(doc, { target: bare, layer: "A", value: 1, commands: null, recipe: "current" }), null);
  assert.equal(bare.children.length, 0);
  assert.equal(share.open(doc, { target: null, layer: "A" }), null);
});

test("Enter commits the draft as setLayerShare on the recipe and layer named, closes the field, and reports the change", () => {
  const doc = fakeDocument();
  const target = drawnShare(doc, "C", true);
  const calls = [];
  const committed = [];
  const notes = [];
  const records = [];
  const bridge = bridgeWith(["setLayerShare"], (command, args) => { calls.push([command, args]); return { ok: true, changed: true, revision: 7, persisted: true, snapshot: null }; });
  const handle = share.open(doc, { target, layer: "C", value: 20, commands: bridge, recipe: "current", note: m => notes.push(m), onEditing: r => records.push(r), onCommitted: r => committed.push(r) });
  const input = target.querySelector("input");
  type(input, "25");
  assert.deepEqual(records[records.length - 1].draft, "25");
  key(input, "Enter");
  assert.deepEqual(calls, [["setLayerShare", { recipe: "current", layer: "C", pct: "25" }]]);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].revision, 7);
  assert.equal(handle.isOpen(), false);
  assert.ok(!target.querySelector("foreignObject"), "the field is still in the slot");
  assert.ok(!target.classList.contains("is-editing"));
  assert.ok(records[records.length - 1] === null, "the boot file was not told the control is gone");
  assert.equal(notes[notes.length - 1], "");
});

test("a value the field can see is unchanged is not handed over: the field closes and nothing is dispatched", () => {
  const doc = fakeDocument();
  const target = drawnShare(doc, "A", true);
  const calls = [];
  const bridge = bridgeWith(["setLayerShare"], (command, args) => { calls.push([command, args]); return { ok: true, changed: false, revision: 1, persisted: false, snapshot: null }; });
  const handle = share.open(doc, { target, layer: "A", value: 20, commands: bridge, recipe: "current" });
  key(target.querySelector("input"), "Enter");
  assert.deepEqual(calls, []);
  assert.equal(handle.isOpen(), false);
  // And an unknown share left blank is the same non-event.
  const unknown = drawnShare(doc, "B", true);
  const h2 = share.open(doc, { target: unknown, layer: "B", value: null, commands: bridge, recipe: "current" });
  assert.equal(unknown.querySelector("input").value, "");
  unknown.querySelector("input").blur();
  assert.deepEqual(calls, []);
  assert.equal(h2.isOpen(), false);
});

test("leaving the field commits a changed value once; blank means 0, as the grid's field reads it", () => {
  const doc = fakeDocument();
  const target = drawnShare(doc, "A", true);
  const calls = [];
  const bridge = bridgeWith(["setLayerShare"], (command, args) => { calls.push([command, args]); return { ok: true, changed: true, revision: 3, persisted: true, snapshot: null }; });
  share.open(doc, { target, layer: "A", value: 20, commands: bridge, recipe: "current" });
  const input = target.querySelector("input");
  type(input, "");
  input.blur();
  assert.deepEqual(calls, [["setLayerShare", { recipe: "current", layer: "A", pct: "0" }]]);
  // Enter, then the blur a browser fires as the field leaves: one command.
  const again = drawnShare(doc, "B", true);
  share.open(doc, { target: again, layer: "B", value: 20, commands: bridge, recipe: "current" });
  type(again.querySelector("input"), "30");
  const field = again.querySelector("input");
  key(field, "Enter");
  field.blur();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ["setLayerShare", { recipe: "current", layer: "B", pct: "30" }]);
});

test("Escape drops the draft, closes the field, dispatches nothing, and spends the key", () => {
  const doc = fakeDocument();
  const target = drawnShare(doc, "A", true);
  const calls = [];
  const notes = [];
  const bridge = bridgeWith(["setLayerShare"], (command, args) => { calls.push([command, args]); return { ok: true, changed: true, revision: 3, persisted: true, snapshot: null }; });
  const handle = share.open(doc, { target, layer: "A", value: 20, commands: bridge, recipe: "current", note: m => notes.push(m) });
  const input = target.querySelector("input");
  type(input, "45");
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  input.dispatchEvent(escape);
  assert.equal(escape.stopped, true, "the key reached the document, where it closes layers");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(handle.isOpen(), false);
  assert.deepEqual(calls, []);
  assert.ok(!target.querySelector("foreignObject"));
  assert.equal(target.querySelector(".station-layer__share-value").textContent, "20%", "the label under the field was touched");
  // Blur after the close is nothing: the field is gone.
  input.blur();
  assert.deepEqual(calls, []);
});

test("a refused draft stays in the field, marked, with the reason on the note; a corrected one commits", () => {
  const doc = fakeDocument();
  const target = drawnShare(doc, "A", true);
  const notes = [];
  const calls = [];
  const bridge = bridgeWith(["setLayerShare"], (command, args) => {
    calls.push(args.pct);
    if (Number(args.pct) > 100) return { ok: false, code: "out_of_range", message: "The percentage must be between 0 and 100." };
    return { ok: true, changed: true, revision: 4, persisted: true, snapshot: null };
  });
  const handle = share.open(doc, { target, layer: "A", value: 20, commands: bridge, recipe: "current", note: m => notes.push(m) });
  const input = target.querySelector("input");
  type(input, "140");
  key(input, "Enter");
  assert.equal(handle.isOpen(), true, "the field closed on a refusal");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.ok(target.classList.contains("is-invalid"));
  assert.equal(input.value, "140", "the draft was thrown away");
  assert.equal(notes[notes.length - 1], "The percentage must be between 0 and 100.");
  // Typing clears the mark; a good value then goes through.
  type(input, "40");
  assert.equal(input.getAttribute("aria-invalid"), null);
  assert.ok(!target.classList.contains("is-invalid"));
  key(input, "Enter");
  assert.deepEqual(calls, ["140", "40"]);
  assert.equal(handle.isOpen(), false);
  assert.equal(notes[notes.length - 1], "");
});

test("with no bridge the field refuses on its own, as the bridge would, and hands nothing anywhere", () => {
  const doc = fakeDocument();
  const target = drawnShare(doc, "A", true);
  const notes = [];
  const committed = [];
  const handle = share.open(doc, { target, layer: "A", value: 20, commands: null, recipe: "current", note: m => notes.push(m), onCommitted: r => committed.push(r) });
  const input = target.querySelector("input");
  type(input, "30");
  const result = handle.commit();
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
  assert.match(notes[notes.length - 1], /no application is connected/i);
  assert.deepEqual(committed, []);
  assert.equal(handle.isOpen(), true);
});

test("the module never reaches for the global bridge, holds no recipe state, and is one of the named dispatching files", () => {
  const source = read("station/station-layer-share.js");
  assert.doesNotMatch(source, /PolynStationCommandBridge|PolynStationStateBridge/);
  assert.doesNotMatch(source, /\.connect\s*\(|\.publish\s*\(|localStorage|fetch\s*\(/);
  assert.match(source, /commands\.dispatch\s*\(COMMAND, \{ recipe: settings\.recipe, layer, pct:/);
  assert.equal((source.match(/commands\.dispatch\s*\(/g) || []).length, 1, "one dispatch, one command");
  assert.match(read("station-isolation.test.js"), /"station-layer-share\.js"[,\]]/, "the isolation test does not name the module");
  // Loaded by both hosts, after the hopper controls and before the boot file.
  const host = read("station-host.js");
  const html = read("station/station.html");
  for (const [text, quote] of [[host, n => `"station/${n}"`], [html, n => `src="${n}?v=`]]) {
    const at = ["station-hopper-controls.js", "station-layer-share.js", "station.js"].map(n => text.indexOf(quote(n)));
    assert.ok(at.every(i => i > -1), "a host does not load the module");
    assert.ok(at[0] < at[1] && at[1] < at[2], "the module must be evaluated before station.js reads its global");
  }
  assert.doesNotMatch(read("index.html"), /station-layer-share/, "index.html loads Station modules through the host only");
});

/* ----------------------------------------------------------------------
 *   Booting Station for real, on a five-layer line
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const files = [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(files.includes("station/station.js"));
  return files.filter(file => file !== "station/station.js");
}

const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "workspace-configuration-payloads.js",
  "station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js",
  "station-connection-bridge.js", "station-recipes-bridge.js"
];

const LAYERS = ["A", "B", "C", "D", "E"];

function snapshot() {
  return {
    line: { lineNumber: 11, displayName: "Line 11", layerCount: 5, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers: LAYERS.map((name, i) => ({
      name, layerPct: 20,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
        weight: 0, usableHeight: 30, effectiveWeight: 0, track: false, pumpOff: false
      }))
    })),
    revision: 1
  };
}

function boot(options) {
  const settings = options || {};
  focused = null;
  const doc = fakeDocument();
  const timers = [];
  const window = {
    document: doc,
    location: { href: "https://resin.tools/?view=station", search: "?view=station" },
    matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame: fn => { timers.push({ fn, ms: 0 }); return timers.length; },
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    URL, Promise, console, Math, Date, Number, String, Object, Array, JSON, Error, Set, Map, WeakMap, Symbol, RegExp,
    parseInt, parseFloat, isFinite, isNaN, Intl,
    navigator: { userAgent: "node" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  window.window = window;
  window.globalThis = window;
  window.self = window;
  const context = vm.createContext(window);
  for (const file of SHARED.concat(hostScripts())) new vm.Script(read(file), { filename: file }).runInContext(context);

  /* The bridges, connected as app.js connects them. The executor is a
   * model of the application's setLayerShare: the share is written into
   * the snapshot the state bridge reads, the revision moves, and the
   * answer carries the new snapshot - so Station's own answer runs the
   * policy's value path as the real one does. Every other command is
   * recorded and answered as applied without a change to the snapshot. */
  const snap = snapshot();
  const contract = window.PolynStationCommandContract;
  const stateBridge = window.PolynStationStateBridge;
  const calls = [];
  const handle = stateBridge.connect({ read: () => snap });
  /* The answer app.js's done() gives: the bridge's revision after the
   * tail published, and the frozen snapshot at it. */
  const done = changed => contract.success({ changed, revision: stateBridge.getRevision(), persisted: changed, snapshot: stateBridge.getSnapshot() });
  if (settings.commands !== false) {
    window.PolynStationCommandBridge.connect({
      execute(command, args) {
        calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
        if (command === "setLayerShare") {
          const layer = snap.layers.find(l => l.name === args.layer);
          if (!layer) return contract.failure("unknown_layer");
          if (layer.layerPct === args.pct) return done(false);
          layer.layerPct = args.pct;
        }
        handle.publish();
        return done(true);
      },
      capabilities: [...contract.COMMANDS]
    });
  }
  new vm.Script(read("station/station.js"), { filename: "station/station.js" }).runInContext(context);

  const q = selector => doc.querySelector(selector);
  const machine = q("[data-station-mount='machine']");
  const status = q("[data-station-mount='status']");
  const launcher = q(".station-handbook__launcher");
  const panel = q(".station-handbook__panel");
  assert.ok(machine && status && launcher && panel, "Station booted with its stage, status and Handbook");

  const api = {
    doc, window, calls, snap, machine, status, launcher, panel, q, timers,
    shareOf: layer => machine.querySelectorAll("[data-station-target='share']").find(n => n.getAttribute("data-layer") === layer) || null,
    labelOf: layer => api.shareOf(layer).querySelector(".station-layer__share-value").textContent,
    labels: () => LAYERS.map(api.labelOf),
    fieldOf: layer => { const s = api.shareOf(layer); return s ? s.querySelector("input") : null; },
    openShare: layer => { const s = api.shareOf(layer); assert.ok(s, `no share on layer ${layer}`); s.click(); return api.fieldOf(layer); },
    target: (name, layer) => machine.querySelectorAll(`[data-station-target='${name}']`).find(n => n.getAttribute("data-layer") === layer) || null,
    clickTarget: (name, layer) => { const el = api.target(name, layer); assert.ok(el, `no ${name} on layer ${layer}`); el.click(); return el; },
    action: name => panel.querySelector(`[data-action='${name}']`),
    clickAction: name => { const button = api.action(name); assert.ok(button, `no action ${name}`); button.click(); return button; },
    isHandbookOpen: () => launcher.getAttribute("aria-expanded") === "true",
    modeOn: () => machine.getAttribute("data-blend-edit") === "true",
    // The cards shown: one per turned-over layer (every layer carries one
    // while the mode is on, hidden under its hoppers when turned back).
    cards: () => machine.querySelectorAll("[data-role='blend-card']").filter(c => {
      const layer = machine.querySelectorAll("[data-role='layer']").find(n => n.getAttribute("data-layer") === c.getAttribute("data-layer"));
      return !!layer && layer.classList.contains("is-flipped");
    }),
    /* The mode's switch is the machine rail's; a layer is turned back or
     * over by its own train while the mode is on. */
    blendSwitch: () => doc.querySelector("[data-role='machine-rail'] [data-action='blend-edit']"),
    flipLayer: layer => api.clickTarget("mixer", layer),
    enterBlendEdit() {
      api.blendSwitch().click();
      assert.equal(api.modeOn(), true, "Blend Edit is on");
      return api;
    },
    exitBlendEdit() {
      api.blendSwitch().click();
      assert.equal(api.modeOn(), false, "Blend Edit is off");
      return api;
    },
    escapeOnStage: () => doc.dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true })),
    /* A change from elsewhere: the snapshot moved and the application
     * published, as its save does; the bridge notifies on a microtask. */
    publish: async () => { handle.publish(); await api.settle(); },
    /* Let a queued notification through. */
    settle: () => new Promise(resolve => setImmediate(resolve))
  };
  return api;
}

const hopperPcts = s => s.snap.layers.map(l => l.hoppers.map(h => h.pct));

test("every layer's share is drawn in its header on a five-layer line, offered for editing, and nowhere under the extruders", () => {
  const s = boot();
  assert.deepEqual(s.labels(), ["20%", "20%", "20%", "20%", "20%"]);
  for (const layer of LAYERS) {
    const share = s.shareOf(layer);
    assert.equal(share.getAttribute("data-able"), "true");
    const header = share.closest("[data-role='layer-header']");
    assert.ok(header, `${layer}'s share is not in its header`);
    assert.equal(header.getAttribute("data-layer"), layer);
  }
  assert.equal(s.machine.querySelectorAll(".station-extruder__pct").length, 0, "the old readout is still drawn");
  assert.equal(s.machine.querySelectorAll("[data-station-target='flip']").length, 0);
});

test("clicking a share opens its field in the slot; a valid entry commits through the bridge as setLayerShare and the header shows what the application holds", async () => {
  const s = boot();
  const input = s.openShare("C");
  assert.ok(input, "no field opened");
  assert.ok(s.doc.activeElement === input, "the caret is not in the field");
  assert.ok(s.shareOf("C").classList.contains("is-editing"));
  assert.equal(input.value, "20");
  type(input, "30");
  key(input, "Enter");
  assert.deepEqual(s.calls, [{ command: "setLayerShare", args: { recipe: "current", layer: "C", pct: 30 } }]);
  assert.equal(s.snap.layers[2].layerPct, 30, "the application's state moved");
  // The answer ran the publish policy: the label is patched from the
  // snapshot, in place, and the field is gone.
  assert.ok(!s.fieldOf("C"), "the field is still in the slot");
  assert.deepEqual(s.labels(), ["20%", "20%", "30%", "20%", "20%"]);
  assert.match(s.shareOf("C").querySelector("title").textContent, /30% of the film/);
  // And the bridge's own notification afterwards reads as nothing new.
  const svg = s.machine.querySelector("svg");
  await s.settle();
  assert.ok(s.machine.querySelector("svg") === svg, "the stage was rebuilt for Station's own echo");
  assert.deepEqual(s.labels(), ["20%", "20%", "30%", "20%", "20%"]);
});

test("each layer is edited independently: one share moves, the others and every hopper blend stay as they were", () => {
  const s = boot();
  const blendsBefore = JSON.stringify(hopperPcts(s));
  type(s.openShare("A"), "25");
  key(s.fieldOf("A"), "Enter");
  type(s.openShare("E"), "15");
  key(s.fieldOf("E"), "Enter");
  assert.deepEqual(s.snap.layers.map(l => l.layerPct), [25, 20, 20, 20, 15]);
  assert.deepEqual(s.labels(), ["25%", "20%", "20%", "20%", "15%"]);
  assert.equal(JSON.stringify(hopperPcts(s)), blendsBefore, "a layer share edit moved a hopper blend");
  assert.deepEqual(s.calls.map(c => [c.args.layer, c.args.pct]), [["A", 25], ["E", 15]]);
});

test("a decimal share is carried as typed and shown rounded as the drawing rounds", () => {
  const s = boot();
  type(s.openShare("B"), "12.5");
  key(s.fieldOf("B"), "Enter");
  assert.equal(s.snap.layers[1].layerPct, 12.5);
  assert.equal(s.labelOf("B"), "12.5%");
});

test("Escape cancels the draft: nothing is dispatched, the header shows the value it had, and the layer stays closed", () => {
  const s = boot();
  const input = s.openShare("D");
  type(input, "99");
  input.dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(s.calls, []);
  assert.ok(!s.fieldOf("D"), "the field is still in the slot");
  assert.equal(s.labelOf("D"), "20%");
  assert.equal(s.snap.layers[3].layerPct, 20);
  assert.ok(s.machine.getAttribute("data-focus-layer") === null, "Escape in the field opened or closed a layer");
});

test("invalid input is refused safely: out of range and not a number stay in the field, marked, with the reason on the status line, and the application is untouched", () => {
  const s = boot();
  const input = s.openShare("B");
  type(input, "150");
  key(input, "Enter");
  assert.deepEqual(s.calls, [], "an out-of-range value reached the executor: the contract should refuse it first");
  assert.ok(s.fieldOf("B") === input, "the field closed on a refusal");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.match(s.status.textContent, /between 0 and 100/);
  type(input, "abc");
  key(input, "Enter");
  assert.deepEqual(s.calls, []);
  assert.match(s.status.textContent, /must be a number/);
  assert.equal(s.snap.layers[1].layerPct, 20);
  assert.equal(s.labelOf("B"), "20%");
  // A corrected entry goes through and clears the line.
  type(input, "35");
  key(input, "Enter");
  assert.equal(s.snap.layers[1].layerPct, 35);
  assert.doesNotMatch(s.status.textContent, /must be/);
});

test("leaving the field by clicking another layer's share commits the first and opens the second; the same share clicked again keeps the one field", () => {
  const s = boot();
  const a = s.openShare("A");
  type(a, "22");
  // A click elsewhere blurs the field first, as a pointer does.
  s.shareOf("B").querySelector(".station-hit").dispatchEvent(makeEvent("mousedown", { bubbles: true }));
  a.blur();
  s.shareOf("B").click();
  assert.deepEqual(s.calls.map(c => [c.args.layer, c.args.pct]), [["A", 22]]);
  assert.ok(!s.fieldOf("A"), "A's field is still open");
  const b = s.fieldOf("B");
  assert.ok(b, "B's field did not open");
  assert.ok(s.doc.activeElement === b);
  s.shareOf("B").click();
  assert.equal(s.shareOf("B").querySelectorAll("input").length, 1, "a second click opened a second field");
  assert.ok(s.doc.activeElement === b);
});

test("the updated share survives a rerender: a structural change draws the header from the application's state", () => {
  const s = boot();
  type(s.openShare("C"), "40");
  key(s.fieldOf("C"), "Enter");
  const svg = s.machine.querySelector("svg");
  s.clickTarget("mixer", "B");   // opens B: a full render
  assert.ok(s.machine.querySelector("svg") !== svg, "opening a layer did not rebuild the stage");
  assert.equal(s.labelOf("C"), "40%");
  assert.equal(s.machine.getAttribute("data-focus-layer"), "B");
  s.escapeOnStage();
  assert.equal(s.labelOf("C"), "40%");
});

test("a value arriving from elsewhere while the field is open is patched onto the label under it; the draft is left alone", async () => {
  const s = boot();
  const input = s.openShare("A");
  type(input, "33");
  s.snap.layers[0].layerPct = 50;
  await s.publish();
  assert.ok(s.fieldOf("A") === input, "the field was rebuilt");
  assert.equal(input.value, "33");
  assert.equal(s.labelOf("A"), "50%");
  // A structural change underneath cannot keep the field: it is closed on
  // purpose and the status line says what was not applied.
  s.snap.layers[0].hoppers[2].usableHeight = 45;
  await s.publish();
  assert.ok(!s.fieldOf("A"), "the field survived a structural rebuild");
  assert.match(s.status.textContent, /Layer A changed underneath you; what you were entering for layer A's share was not applied/);
  assert.deepEqual(s.calls, []);
});

test("with commands not on offer the share reads as a label: a click opens nothing and says why", () => {
  const s = boot({ commands: false });
  assert.deepEqual(s.labels(), ["20%", "20%", "20%", "20%", "20%"]);
  for (const layer of LAYERS) assert.equal(s.shareOf(layer).getAttribute("data-able"), "false");
  s.shareOf("A").click();
  assert.ok(!s.fieldOf("A"), "a field opened without the command on offer");
  assert.match(s.status.textContent, /Layer A's share cannot be changed here: no application is connected/);
});

/* ---- Blend Edit ---- */

test("entering Blend Edit keeps every share in its slot, editable, in the same box; a share is edited on a turned-over layer; Done leaves it as it was", () => {
  const s = boot();
  const boxes = () => LAYERS.map(l => ["x", "y", "width", "height"].map(k => s.shareOf(l).querySelector(".station-layer__share-face").getAttribute(k)).join(" "));
  const before = boxes();
  s.enterBlendEdit();
  assert.equal(s.machine.querySelectorAll("[data-station-target='flip']").length, 0, "a chip took the slot");
  assert.deepEqual(s.labels(), ["20%", "20%", "20%", "20%", "20%"]);
  assert.deepEqual(boxes(), before, "the slot moved with the mode");
  for (const layer of LAYERS) assert.equal(s.shareOf(layer).getAttribute("data-able"), "true");
  // Every layer is turned over on entry; all but C are turned back by
  // their trains, so one card stands.
  assert.equal(s.cards().length, 5);
  for (const layer of LAYERS) if (layer !== "C") s.flipLayer(layer);
  assert.equal(s.cards().length, 1);
  type(s.openShare("C"), "30");
  key(s.fieldOf("C"), "Enter");
  assert.equal(s.snap.layers[2].layerPct, 30);
  assert.equal(s.labelOf("C"), "30%");
  assert.equal(s.cards().length, 1, "the share edit turned the layer back");
  assert.equal(s.modeOn(), true);
  // The card's own blend field still works beside it.
  const card = s.cards()[0];
  const blend = card.querySelectorAll("input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && !i.hasAttribute("readonly"));
  assert.ok(blend, "the card lost its editable blend field");
  blend.focus();
  type(blend, 35);
  key(blend, "Enter");
  assert.deepEqual(s.calls.map(c => c.command), ["setLayerShare", "setHopperBlend"]);
  s.exitBlendEdit();
  assert.deepEqual(s.labels(), ["20%", "20%", "30%", "20%", "20%"]);
  assert.deepEqual(boxes(), before);
});

test("a share field open when Blend Edit starts is committed along its own path before the stage is rebuilt - and again when the mode ends", () => {
  const s = boot();
  const input = s.openShare("B");
  type(input, "24");
  s.enterBlendEdit();
  assert.deepEqual(s.calls.map(c => [c.command, c.args.layer, c.args.pct]), [["setLayerShare", "B", 24]]);
  assert.ok(!s.fieldOf("B"), "the field survived the rebuild");
  assert.equal(s.labelOf("B"), "24%");
  const again = s.openShare("D");
  type(again, "18");
  s.exitBlendEdit();
  assert.deepEqual(s.calls.map(c => [c.args.layer, c.args.pct]), [["B", 24], ["D", 18]]);
  assert.equal(s.labelOf("D"), "18%");
});

/* ---- The focused editor ---- */

test("the focused layer's share is edited in its header as well, and the open editor's rows and blends are untouched by it", () => {
  const s = boot();
  s.clickTarget("mixer", "B");
  assert.equal(s.machine.getAttribute("data-focus-layer"), "B");
  const editor = s.machine.querySelector("[data-role='focus-editor']");
  assert.ok(editor);
  const rowsBefore = editor.querySelectorAll("[data-hopper]").map(r => r.getAttribute("data-hopper")).join(",");
  const blendsBefore = JSON.stringify(hopperPcts(s));
  type(s.openShare("B"), "45");
  key(s.fieldOf("B"), "Enter");
  assert.equal(s.snap.layers[1].layerPct, 45);
  assert.equal(s.labelOf("B"), "45%");
  assert.ok(s.machine.querySelector("[data-role='focus-editor']") === editor, "the editor was rebuilt");
  assert.equal(editor.querySelectorAll("[data-hopper]").map(r => r.getAttribute("data-hopper")).join(","), rowsBefore);
  assert.equal(JSON.stringify(hopperPcts(s)), blendsBefore);
  assert.equal(s.machine.getAttribute("data-focus-layer"), "B", "the share edit closed the layer");
  // The editor's own blend field still commits as before.
  const blend = editor.querySelectorAll("input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && !i.hasAttribute("readonly"));
  assert.ok(blend);
  blend.focus();
  type(blend, 35);
  key(blend, "Enter");
  assert.deepEqual(s.calls.map(c => c.command), ["setLayerShare", "setHopperBlend"]);
  assert.deepEqual(s.calls[1].args, { recipe: "current", layer: "B", index: 1, pct: 35 });
  // Ghost layers' shares are inert while a layer is open: the click
  // handler refuses a target on any layer but the shown one.
  s.shareOf("D").click();
  assert.ok(!s.fieldOf("D"), "a ghost layer's share opened");
});

/* ---- The desktop/touch boundary ---- */

test("nothing in the application's mobile or tablet recipe workflow loads or reads the Station share module", () => {
  const app = read("app.js");
  assert.doesNotMatch(app, /PolynStationLayerShare|station-layer-share|station-layer__share/);
  assert.doesNotMatch(read("index.html"), /station-layer-share/);
  // The legacy layer percentage field is what it was: its own input,
  // its own handler, on the grid's own tail.
  assert.match(app, /pctInput\.setAttribute\("aria-label", `Layer \$\{L\.name\} percentage`\);/);
  assert.match(app, /pctInput\.addEventListener\("input",\(e\)=>\{/);
  // And the stylesheet the share editor lives in is Station's, loaded by
  // the host only in Station mode.
  const css = read("station/styles/components/layer-bank.css");
  assert.match(css, /\.station-layer__share-input \{/);
  for (const file of fs.readdirSync(ROOT).filter(name => name.endsWith(".css"))) {
    assert.doesNotMatch(read(file), /station-layer__share/, `${file} styles the Station share`);
  }
});
