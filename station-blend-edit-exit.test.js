"use strict";

/* Leaving Blend Edit by closing the Operator Handbook.
 *
 * Blend Edit's Done lives inside the Handbook. Closing the Handbook with
 * the mode still on used to leave the operator on a stage whose train
 * refused every click, with the one control that ends the mode hidden -
 * and every refused click stacked another copy of the refusal onto the
 * status line, until the next structural render. Two rules fix both:
 *
 *   - closing the Handbook, by any of its exits, is Done first: one exit
 *     path (station.js's exitBlendEdit), reached through the Handbook's
 *     beforeClose hook, so Done and Close cannot drift apart;
 *   - the status line carries ONE transient notice, replaced by the next
 *     and cleared by a valid interaction or the mode's exit - never
 *     appended to.
 *
 * The same exit leaves whatever field the operator is in along that
 * field's own path - a card's percentage (station-focus-editor.js), a
 * header's share (station-layer-share.js): Enter and leaving commit,
 * Escape drops the draft and is spent in the field - so a value that was
 * accepted is held, a value Escape dropped is not sent, and no field or
 * handle survives the exit. And the mode is the Handbook's whichever
 * section is showing: Close from another section is Done first too.
 *
 * station.js is a self-starting file over a browser document, so it is
 * run here for real: every module the production host loads, in the
 * host's own order, evaluated into one context over a small fake DOM,
 * with the state and command bridges connected the way app.js connects
 * them - the executor applies the commands the fields issue and answers
 * with the state bridge's own frozen snapshot, as app.js does, so an
 * accepted value is the value the rebuilt stage shows. What the tests
 * then drive is the drawn stage and the Handbook's own buttons - the
 * same elements an operator clicks.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake DOM: enough of one for the shell, the renderer, the editor,
 *   the Handbook and the boot file's delegated listeners.
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

/* Descendant combinators only: "a b c". */
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
    select() {},
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    getBBox() { return { x: 0, y: 0, width: 10, height: 10 }; },
    scrollIntoView() {},
    // No Web Animations here: the transition module's helper hands back
    // null for a node that cannot animate, and the controller skips it.
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

/* ----------------------------------------------------------------------
 *   Booting Station for real, in the host's order
 * -------------------------------------------------------------------- */

/* The production host's script list, read off station-host.js so this
 * boots what the host boots. The boot file itself is evaluated last, after
 * the bridges are connected, as app.js has done by the time it runs. */
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

function snapshot() {
  return {
    line: { lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layerPct: i === 1 ? 40 : 30,
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
    // Reduced motion, unless a test wants the flights: every state change
    // then lands synchronously, which is what the assertions read.
    matchMedia: () => ({ matches: settings.reducedMotion !== false, addEventListener() {}, addListener() {} }),
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
  // The document's location is the window's, as in a browser: the shell
  // derives the way back to the legacy interface from it.
  doc.location = window.location;
  const context = vm.createContext(window);
  for (const file of SHARED.concat(hostScripts())) new vm.Script(read(file), { filename: file }).runInContext(context);

  /* The bridges, connected as app.js connects them: a state to read, and
   * an executor that records every command, applies the two the fields
   * on the stage issue to that state, publishes, and answers with the
   * state bridge's own frozen snapshot at the new revision - the object
   * the command bridge insists on (an unfrozen one is refused as
   * `internal`, and a refused draft never leaves its field). So a value
   * a field hands over is the value the rebuilt stage then shows. */
  const snap = snapshot();
  const stateBridge = window.PolynStationStateBridge;
  const contract = window.PolynStationCommandContract;
  const calls = [];
  const handle = stateBridge.connect({ read: () => snap });
  const layerOf = id => snap.layers.find(layer => layer.name === id) || null;
  window.PolynStationCommandBridge.connect({
    execute(command, args) {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)), handbookOpen: isHandbookOpen() });
      // A test may have the application refuse: `refuse(command, args)`
      // returns the reason, and the answer is the contract's refusal.
      const refused = typeof settings.refuse === "function" ? settings.refuse(command, args) : null;
      if (refused) return contract.failure("out_of_range", { message: refused });
      if (command === "setHopperBlend" && layerOf(args.layer)) layerOf(args.layer).hoppers[args.index].pct = Number(args.pct);
      else if (command === "setLayerShare" && layerOf(args.layer)) layerOf(args.layer).layerPct = Number(args.pct);
      snap.revision += 1;
      handle.publish();
      return contract.success({ changed: true, revision: stateBridge.getRevision(), persisted: true, snapshot: stateBridge.getSnapshot() });
    },
    capabilities: [...contract.COMMANDS]
  });
  new vm.Script(read("station/station.js"), { filename: "station/station.js" }).runInContext(context);

  const q = selector => doc.querySelector(selector);
  const machine = q("[data-station-mount='machine']");
  const status = q("[data-station-mount='status']");
  const launcher = q(".station-handbook__launcher");
  const panel = q(".station-handbook__panel");
  function isHandbookOpen() { return launcher ? launcher.getAttribute("aria-expanded") === "true" : false; }
  assert.ok(machine && status && launcher && panel, "Station booted with its stage, status and Handbook");

  const api = {
    doc, window, calls, machine, status, launcher, panel, q,
    /* The application's state, as the executor holds it. */
    state: () => snap,
    isHandbookOpen,
    action: name => panel.querySelector(`[data-action='${name}']`),
    clickAction: name => { const button = api.action(name); assert.ok(button, `no action ${name}`); button.click(); return button; },
    target: (name, layer) => machine.querySelectorAll(`[data-station-target='${name}']`).find(n => n.getAttribute("data-layer") === layer) || null,
    clickTarget: (name, layer) => { const el = api.target(name, layer); assert.ok(el, `no ${name} on layer ${layer}`); el.click(); return el; },
    cards: () => machine.querySelectorAll("[data-role='blend-card']"),
    chips: () => machine.querySelectorAll("[data-station-target='flip']"),
    /* Turning a layer over is the Handbook's: its A-C selector for the
     * layer, the same button an operator clicks. */
    flipLayer: layer => {
      const chip = panel.querySelectorAll(".station-book__layer-chip").find(n => n.getAttribute("data-layer") === layer);
      assert.ok(chip, `no Handbook selector for layer ${layer}`);
      chip.click();
      return chip;
    },
    flipped: () => machine.querySelectorAll("[data-role='layer'].is-flipped").map(n => n.getAttribute("data-layer")),
    clusters: () => machine.querySelectorAll(".station-hopper-cluster").length,
    modeOn: () => machine.getAttribute("data-blend-edit") === "true",
    blendControls: () => panel.querySelector("[data-role='blend-controls']"),
    escapeInPanel: () => panel.dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true })),
    escapeOnStage: () => doc.dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true })),
    /* The Handbook's tab for a section, the same button an operator
     * clicks to show it. */
    showSection: id => {
      const tab = panel.querySelectorAll("[role='tab']").find(n => n.getAttribute("data-section") === id);
      assert.ok(tab, `no Handbook tab for ${id}`);
      tab.click();
      return tab;
    },
    /* The layer's share field in its header (station-layer-share.js),
     * as a click on the drawn value opens it; null when none is open. */
    shareEditor: () => machine.querySelector(".station-layer__share-editor"),
    shareInput: () => machine.querySelector(".station-layer__share-input"),
    /* A draft in a header's share field: opened by the click, focused,
     * with a new value typed and not yet committed. */
    draftOnShare(layer, value) {
      api.clickTarget("share", layer);
      const input = api.shareInput();
      assert.ok(input, `layer ${layer}'s share field opened`);
      assert.ok(api.doc.activeElement === input, "the field took the focus");
      input.value = String(value);
      input.dispatchEvent(makeEvent("input", { bubbles: true }));
      assert.ok(machine.contains(doc.activeElement), "the field is the active element, inside the stage");
      return input;
    },
    /* The mode as an operator reaches it: Handbook open, Blend Edit on. */
    enterBlendEdit() {
      if (!isHandbookOpen()) launcher.click();
      api.clickAction("blend-edit");
      assert.equal(api.modeOn(), true, "Blend Edit is on");
      return api;
    },
    /* A draft on a card: layer B's hopper 2 field, focused, with a new
     * value typed and not yet committed. */
    draftOnCard(layer, value) {
      api.flipLayer(layer);
      const card = api.cards().find(c => c.getAttribute("data-layer") === layer) || api.cards()[0];
      assert.ok(card, `layer ${layer} has a card`);
      const input = card.querySelectorAll("input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && !i.hasAttribute("readonly"));
      assert.ok(input, "an editable percentage field on the card");
      input.focus();
      input.value = String(value);
      input.dispatchEvent(makeEvent("input", { bubbles: true }));
      assert.ok(machine.contains(doc.activeElement), "the field is the active element, inside the stage");
      return input;
    }
  };
  return api;
}

const REFUSAL = "Finish Blend Edit (Done in the Handbook) to open a layer's detailed editor.";
const count = (text, needle) => text.split(needle).length - 1;

/* A stage back to normal: no mode attribute, no card, no chip, no turned
 * layer, every cluster present; the Handbook's Blend Edit controls gone. */
function assertModeCleared(s) {
  assert.equal(s.modeOn(), false, "the mount no longer says the mode is on");
  assert.equal(s.cards().length, 0, "no card is drawn");
  assert.equal(s.chips().length, 0, "no flip chip is drawn");
  assert.deepEqual(s.flipped(), [], "no layer is turned over");
  assert.equal(s.clusters(), 3, "every layer shows its hopper cluster");
  assert.ok(!s.blendControls() || s.blendControls().hidden, "the Handbook no longer shows Done");
  assert.doesNotMatch(s.status.textContent, /Blend Edit/, "no Blend Edit notice is left on the status line");
  assert.ok(s.shareEditor() === null, "no share field is left in a header");
  assert.ok(s.machine.querySelector(".is-editing") === null, "no header is still marked as being edited");
  assert.equal(s.machine.contains(s.doc.activeElement), false, "nothing on the stage keeps the focus");
}

/* ----------------------------------------------------------------------
 *   Closing the Handbook
 * -------------------------------------------------------------------- */

test("Handbook Close with Blend Edit off is what it was: the panel closes, the stage and the status are untouched, nothing is dispatched", () => {
  const s = boot();
  const stageBefore = s.machine.querySelector("svg").attributes;
  const statusBefore = s.status.textContent;
  s.launcher.click();
  assert.equal(s.isHandbookOpen(), true);
  s.clickAction("close-handbook");
  assert.equal(s.isHandbookOpen(), false);
  assert.ok(s.panel.hidden);
  assert.deepEqual(s.machine.querySelector("svg").attributes, stageBefore, "the stage was not redrawn");
  assert.equal(s.status.textContent, statusBefore);
  assert.deepEqual(s.calls, []);
  assert.equal(s.modeOn(), false);
});

test("Handbook Close with Blend Edit on is Done first: the mode ends, every layer is back as hoppers, then the panel closes", () => {
  const s = boot().enterBlendEdit();
  s.clickAction("edit-all");
  assert.deepEqual(s.flipped(), ["A", "B", "C"]);
  assert.equal(s.cards().length, 3);
  s.clickAction("close-handbook");
  assert.equal(s.isHandbookOpen(), false);
  assert.ok(s.panel.hidden);
  assertModeCleared(s);
  assert.deepEqual(s.calls, [], "with nothing being entered, nothing was dispatched");
});

test("Escape inside the Handbook with Blend Edit on does the same, and is spent there", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("B");
  assert.deepEqual(s.flipped(), ["B"]);
  const event = makeEvent("keydown", { key: "Escape", bubbles: true });
  s.panel.dispatchEvent(event);
  assert.equal(event.stopped, true, "the key is the Handbook's");
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
});

test("the launcher closing the Handbook is a close too, and ends the mode the same way", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("C");
  s.launcher.click();
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
});

test("a field being entered on a card commits along the editor's own path before the mode ends and the panel closes - once, as one command", () => {
  const s = boot().enterBlendEdit();
  s.draftOnCard("B", 35);
  s.clickAction("close-handbook");
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setHopperBlend", { recipe: "current", layer: "B", index: 1, pct: 35 }]]);
  assert.equal(s.calls[0].handbookOpen, true, "the commit ran while the Handbook was still open - before the close, not after");
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
  assert.equal(s.state().layers[1].hoppers[1].pct, 35, "the application holds the value the field handed over");
  // The rebuilt stage shows it: the layer's full editor opens on 35.
  s.clickTarget("extruder", "B");
  const row = s.machine.querySelectorAll("[data-role='focus-editor'] input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && !i.hasAttribute("readonly"));
  assert.ok(row, "the focused editor has the editable percentage field");
  assert.equal(row.value, "35");
});

test("a draft the application refuses on the way out is not applied and strands nothing: the mode ends, the panel closes, the stage shows the application's value", () => {
  const s = boot({ refuse: (command, args) => (command === "setHopperBlend" && args.pct > 90 ? "Hoppers 2-6 would exceed 100%." : null) }).enterBlendEdit();
  s.draftOnCard("B", 95);
  s.clickAction("close-handbook");
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperBlend"], "the draft was offered to the application once");
  assert.equal(s.state().layers[1].hoppers[1].pct, 40, "and refused: the application's value stands");
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
  s.clickTarget("extruder", "B");
  const row = s.machine.querySelectorAll("[data-role='focus-editor'] input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && !i.hasAttribute("readonly"));
  assert.equal(row.value, "40");
});

test("with motion on, the close still ends the mode before the panel sets off", () => {
  const s = boot({ reducedMotion: false }).enterBlendEdit();
  s.flipLayer("A");
  s.clickAction("close-handbook");
  assert.equal(s.isHandbookOpen(), false);
  assert.equal(s.modeOn(), false);
  assert.equal(s.cards().length, 0);
  assert.deepEqual(s.flipped(), []);
});

/* ----------------------------------------------------------------------
 *   Afterwards: the stage is the stage
 * -------------------------------------------------------------------- */

test("normal interactions work at once after the close: the train opens a layer, a hopper control toggles", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("B");
  s.clickAction("close-handbook");
  // The train opens the layer's detailed editor - the full one, not a card.
  s.clickTarget("extruder", "A");
  const editor = s.machine.querySelector("[data-role='focus-editor']");
  assert.ok(editor, "the focused editor opened");
  assert.equal(editor.getAttribute("data-variant"), "full");
  assert.doesNotMatch(s.status.textContent, /Blend Edit/);
  s.escapeOnStage();
  assert.equal(s.machine.querySelector("[data-role='focus-editor']"), null, "Escape closed it again");
  // A hopper's tracking control goes to the application as it always did.
  s.clickTarget("tracking", "B");
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperTracking"]);
});

test("Blend Edit state is fully cleared: reopening the Handbook offers Blend Edit afresh, and entering it again turns no layer over", () => {
  const s = boot().enterBlendEdit();
  s.clickAction("edit-all");
  s.clickAction("close-handbook");
  s.launcher.click();
  assert.equal(s.isHandbookOpen(), true);
  const enter = s.action("blend-edit");
  assert.ok(enter && !enter.disabled, "Blend Edit is on offer");
  assert.ok(!s.blendControls() || s.blendControls().hidden, "the mode's controls are not showing");
  assert.equal(s.modeOn(), false);
  s.clickAction("blend-edit");
  assert.equal(s.modeOn(), true);
  assert.deepEqual(s.flipped(), [], "the layers turned over before the close did not come back turned");
  assert.equal(s.chips().length, 0, "no chip is drawn on the stage for the mode");
  const selectors = s.panel.querySelectorAll(".station-book__layer-chip");
  assert.equal(selectors.length, 3);
  assert.ok(selectors.every(chip => chip.getAttribute("aria-pressed") !== "true"));
});

/* ----------------------------------------------------------------------
 *   The status line: one notice, replaced, cleared
 * -------------------------------------------------------------------- */

test("repeated blocked train clicks leave one refusal on the status line, not one per click", () => {
  const s = boot().enterBlendEdit();
  for (const [target, layer] of [["extruder", "A"], ["extruder", "A"], ["mixer", "B"], ["extruder", "C"], ["mixer", "C"]]) s.clickTarget(target, layer);
  assert.equal(count(s.status.textContent, REFUSAL), 1);
  assert.ok(s.status.textContent.startsWith(REFUSAL), "the notice leads the line");
  assert.match(s.status.textContent, /Line 9 · 3 layers · 18 hoppers/, "ahead of what the line was saying, which is still there");
  assert.equal(s.machine.querySelector("[data-role='focus-editor']"), null, "and nothing opened");
});

test("a valid interaction clears the refusal: a flip, Edit All, and the mode's exit each leave no Blend Edit text behind", () => {
  const s = boot().enterBlendEdit();
  s.clickTarget("extruder", "A");
  assert.equal(count(s.status.textContent, REFUSAL), 1);
  s.flipLayer("A");
  assert.equal(count(s.status.textContent, REFUSAL), 0, "turning a layer over cleared it");
  s.clickTarget("mixer", "B");
  assert.equal(count(s.status.textContent, REFUSAL), 1);
  s.clickAction("edit-all");
  assert.equal(count(s.status.textContent, REFUSAL), 0, "Edit All cleared it");
  s.clickTarget("mixer", "B");
  assert.equal(count(s.status.textContent, REFUSAL), 1);
  s.clickAction("done");
  assert.equal(count(s.status.textContent, REFUSAL), 0, "Done cleared it");
  assert.doesNotMatch(s.status.textContent, /Blend Edit/);
});

test("Blend Edit's notice is cleared by the Handbook's close as by Done, and the next click opens the layer with a clean line", () => {
  const s = boot().enterBlendEdit();
  s.clickTarget("extruder", "A");
  s.clickTarget("extruder", "A");
  assert.equal(count(s.status.textContent, REFUSAL), 1);
  s.clickAction("close-handbook");
  assert.equal(count(s.status.textContent, REFUSAL), 0);
  s.clickTarget("extruder", "A");
  assert.ok(s.machine.querySelector("[data-role='focus-editor']"));
  assert.doesNotMatch(s.status.textContent, /Blend Edit/);
});

/* ----------------------------------------------------------------------
 *   The header's share field, open on the way out
 * -------------------------------------------------------------------- */

/* A layer's share is edited in its header in every mode, Blend Edit
 * included (station-layer-share.js). Its field has its own contract -
 * Enter commits, Escape drops the draft and is spent there, leaving the
 * field commits a changed value once - and the mode's exit leans on it
 * rather than adding a second: the field is left (leaveStageControl)
 * before the stage is rebuilt, so what it does with its draft is what it
 * always does. */

test("a share draft being entered in a header commits along the field's own path before the mode ends and the panel closes - once, as one command", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("A");
  s.draftOnShare("B", 45);
  assert.equal(s.modeOn(), true, "the field opened with the mode still on");
  s.clickAction("close-handbook");
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setLayerShare", { recipe: "current", layer: "B", pct: 45 }]]);
  assert.equal(s.calls[0].handbookOpen, true, "the commit ran while the Handbook was still open - before the close, not after");
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
});

test("a share draft cancelled with Escape stays cancelled: the key is the field's, the mode stays on, and the close afterwards hands nothing over", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("C");
  const input = s.draftOnShare("B", 45);
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  input.dispatchEvent(escape);
  assert.equal(escape.stopped, true, "Escape was spent in the field");
  assert.ok(s.shareEditor() === null, "the field closed");
  assert.equal(s.modeOn(), true, "the mode is still on: the key did not leave it");
  assert.equal(s.isHandbookOpen(), true, "nor close the Handbook");
  assert.deepEqual(s.flipped(), ["C"], "the turned layer is still turned");
  s.clickAction("close-handbook");
  assert.deepEqual(s.calls, [], "the cancelled draft was never sent");
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
});

test("a share value committed with Enter stays committed and is not sent again by the close", () => {
  const s = boot().enterBlendEdit();
  const input = s.draftOnShare("A", 25);
  input.dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(s.calls.map(c => c.command), ["setLayerShare"]);
  assert.ok(s.shareEditor() === null, "Enter closed the field");
  s.clickAction("close-handbook");
  assert.deepEqual(s.calls.map(c => c.command), ["setLayerShare"], "one command, not two");
  assertModeCleared(s);
});

test("a share field left unchanged by the close is closed without a command", () => {
  const s = boot().enterBlendEdit();
  s.clickTarget("share", "B");
  assert.ok(s.shareInput(), "the field is open");
  s.escapeInPanel();
  assert.deepEqual(s.calls, []);
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
});

test("Escape on the stage with a share field open drops the draft only; the next Escape leaves the mode as Done does, with the Handbook still open", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("B");
  const input = s.draftOnShare("B", 45);
  // The key bubbles from the field to the document, where the boot file's
  // Escape lives: it must not get there.
  input.dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(s.modeOn(), true);
  assert.ok(s.shareEditor() === null);
  s.escapeOnStage();
  assertModeCleared(s);
  assert.equal(s.isHandbookOpen(), true, "Escape on the stage is Done, not Close");
  assert.deepEqual(s.calls, [], "the dropped draft was not sent");
  const enter = s.action("blend-edit");
  assert.ok(enter && !enter.disabled, "Blend Edit is on offer again");
});

test("a card field and a share field cannot both be open: opening the share commits the card's draft first, and the close then finds one field to leave", () => {
  const s = boot().enterBlendEdit();
  s.draftOnCard("B", 35);
  s.draftOnShare("A", 25);
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperBlend"], "moving to the share field left the card's field, which committed");
  s.clickAction("close-handbook");
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [
    ["setHopperBlend", { recipe: "current", layer: "B", index: 1, pct: 35 }],
    ["setLayerShare", { recipe: "current", layer: "A", pct: 25 }]
  ]);
  assertModeCleared(s);
});

test("after the exit the share is editable in its header at once, and a fresh field opens", () => {
  const s = boot().enterBlendEdit();
  s.draftOnShare("B", 45);
  s.clickAction("done");
  assertModeCleared(s);
  s.clickTarget("share", "B");
  const input = s.shareInput();
  assert.ok(input, "a new field opened in the header");
  assert.equal(input.value, "45", "it opens on what the application now holds - the value the close handed over");
  assert.ok(s.doc.activeElement === input);
});

/* ----------------------------------------------------------------------
 *   Another section showing
 * -------------------------------------------------------------------- */

test("switching the Handbook to another section leaves the mode on, its exits intact: Close from there is Done first, and the Recipe Book offers the mode afresh", () => {
  const s = boot().enterBlendEdit();
  s.clickAction("edit-all");
  s.showSection("appearance");
  assert.equal(s.modeOn(), true, "showing another section does not end the mode");
  assert.deepEqual(s.flipped(), ["A", "B", "C"]);
  assert.equal(s.panel.querySelectorAll("[role='tabpanel']").find(n => n.getAttribute("data-section") === "recipe-book").hidden, true);
  // The mode's Done is in the hidden section, but every Handbook exit is
  // still the one exit: Close from here ends the mode first.
  s.clickAction("close-handbook");
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
  s.launcher.click();
  s.showSection("recipe-book");
  const enter = s.action("blend-edit");
  assert.ok(enter && !enter.disabled, "Blend Edit is on offer again");
  assert.ok(!s.blendControls() || s.blendControls().hidden);
});

test("Escape inside the Handbook from another section is the same exit", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("B");
  s.showSection("appearance");
  s.escapeInPanel();
  assert.equal(s.isHandbookOpen(), false);
  assertModeCleared(s);
});

/* ----------------------------------------------------------------------
 *   Round after round, no refresh
 * -------------------------------------------------------------------- */

test("entering and leaving the mode by every exit in turn leaves nothing behind: each round's refusal reads once and is cleared, each edit is one command, the train opens a layer after each, and no handler doubles", () => {
  const s = boot();
  const exits = [
    { name: "Done", leave: () => s.clickAction("done"), closes: false },
    { name: "Close", leave: () => s.clickAction("close-handbook"), closes: true },
    { name: "Escape in the panel", leave: () => s.escapeInPanel(), closes: true },
    { name: "the launcher", leave: () => s.launcher.click(), closes: true },
    { name: "Escape on the stage", leave: () => s.escapeOnStage(), closes: false },
    { name: "Close", leave: () => s.clickAction("close-handbook"), closes: true }
  ];
  let commands = 0;
  exits.forEach((exit, round) => {
    s.enterBlendEdit();
    assert.deepEqual(s.flipped(), [], `round ${round + 1} (${exit.name}): no layer came back turned`);
    s.flipLayer("B");
    s.clickTarget("extruder", "A");
    s.clickTarget("extruder", "A");
    assert.equal(count(s.status.textContent, REFUSAL), 1, `round ${round + 1}: the refusal reads once`);
    s.draftOnCard("A", 55 + round);
    exit.leave();
    commands += 1;
    assert.equal(s.calls.length, commands, `round ${round + 1}: the draft went once - no handler dispatched it twice`);
    assert.deepEqual(s.calls[commands - 1].args, { recipe: "current", layer: "A", index: 1, pct: 55 + round });
    assert.equal(s.isHandbookOpen(), !exit.closes, `round ${round + 1}: ${exit.name} ${exit.closes ? "closes" : "keeps"} the Handbook`);
    assertModeCleared(s);
    // The stage is the stage: the train opens the layer's full editor.
    s.clickTarget("extruder", "C");
    const editor = s.machine.querySelector("[data-role='focus-editor']");
    assert.ok(editor && editor.getAttribute("data-variant") === "full", `round ${round + 1}: the focused editor opened`);
    assert.equal(count(s.status.textContent, REFUSAL), 0);
    s.escapeOnStage();
    assert.ok(s.machine.querySelector("[data-role='focus-editor']") === null);
    if (!s.isHandbookOpen()) s.launcher.click();
    assert.equal(s.isHandbookOpen(), true, `round ${round + 1}: the Handbook reopened`);
  });
  assert.equal(s.calls.length, exits.length);
  assert.ok(s.calls.every(c => c.command === "setHopperBlend"));
});

/* ----------------------------------------------------------------------
 *   Done is what it was
 * -------------------------------------------------------------------- */

test("Done ends the mode exactly as before - commit, every layer back, controls gone - and leaves the Handbook open", () => {
  const s = boot().enterBlendEdit();
  s.draftOnCard("B", 35);
  s.clickAction("done");
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setHopperBlend", { recipe: "current", layer: "B", index: 1, pct: 35 }]]);
  assertModeCleared(s);
  assert.equal(s.isHandbookOpen(), true, "Done does not close the Handbook");
  assert.ok(!s.panel.hidden);
  const enter = s.action("blend-edit");
  assert.ok(enter && !enter.disabled, "Blend Edit is on offer again");
});

test("Done and every Handbook exit share the one exit path: the boot file routes the Handbook's beforeClose to exitBlendEdit and defines no second", () => {
  const bootSource = read("station/station.js");
  const handbookSource = read("station/station-handbook.js");
  assert.match(bootSource, /beforeClose: \(\) => \{ if \(blendEdit\.active\) exitBlendEdit\(\); \}/);
  assert.equal((bootSource.match(/blendEdit\.active = false;/g) || []).length, 2, "the mode is turned off in exitBlendEdit and by a line that lost its layers, nowhere else");
  // Inside the Handbook, beforeClose is the first thing close() does, and
  // close() is the one function every exit calls.
  const close = handbookSource.slice(handbookSource.indexOf("function close() {"), handbookSource.indexOf("function toggle() {"));
  assert.match(close, /if \(!state\.open\) return false;\n\s+beforeClose\(\);\n\s+state\.open = false;/);
  assert.match(handbookSource, /closeButton\.addEventListener\("click", \(\) => \{ close\(\); \}\);/);
  assert.match(handbookSource, /launcher\.addEventListener\("click", toggle\);/);
  assert.match(handbookSource, /return state\.open \? close\(\) : open\(\);/);
  const escape = handbookSource.slice(handbookSource.indexOf('panel.addEventListener("keydown"'), handbookSource.indexOf("/* Tell every section something changed"));
  assert.match(escape, /close\(\);/);
  assert.doesNotMatch(escape, /hideNow|state\.open = false/, "Escape does not close around the one path");
});

test("the status line is one notice ahead of the line's own parts: said again it is not repeated, said empty it is gone, and a structural render starts clean", () => {
  const bootSource = read("station/station.js");
  const say = bootSource.slice(bootSource.indexOf("function say(message) {"), bootSource.indexOf("\n  }\n", bootSource.indexOf("function say(message) {")) + 4);
  assert.match(say, /if \(editorHandle\) \{ editorHandle\.note\(message\); return; \}/, "an open editor's note is still where a message goes");
  assert.match(say, /if \(next === notice\) return;/);
  assert.match(say, /notice = next;/);
  assert.match(say, /renderStatus\(current\.model, current\.resolved\);/);
  assert.doesNotMatch(say, /textContent = `\$\{message\} · /, "nothing is prepended to what the status bar already says");
  assert.doesNotMatch(bootSource, /mounts\.status\.textContent = `\$\{message\}/, "no other line prepends to the status bar either");
  assert.match(bootSource, /host\.textContent = \(notice \? \[notice\] : \[\]\)\.concat\(parts\)\.join\(" · "\);/);
  const exit = bootSource.slice(bootSource.indexOf("function exitBlendEdit() {"), bootSource.indexOf("\n  }\n", bootSource.indexOf("function exitBlendEdit() {")) + 4);
  assert.match(exit, /redrawForBlend\(were\);\n[^\n]*\n\s+say\(""\);/, "the exit clears the notice after the stage is back");
});

/* ----------------------------------------------------------------------
 *   One frame for every section
 * -------------------------------------------------------------------- */

/* The Handbook is one work surface of fixed capacity (handbook.css): the
 * frame's box is the stage's, and switching what it shows - the Recipe
 * Book, Blend Edit's controls, whatever comes next - changes nothing of
 * the frame. Its size is the stylesheet's (station-handbook.test.js pins
 * the contract; the browser pass measured it); what is checked here, on
 * the booted stage, is that nothing in script tells the frame apart by
 * section, and that the frame's arrival changes nothing above it. */

/* Everything the shell is, apart from what a section draws into it. */
function frameOf(s) {
  const attrs = node => JSON.stringify(Object.entries(node.attributes || {}).sort());
  const head = s.panel.querySelector(".station-handbook__head");
  return {
    root: attrs(s.q(".station-handbook")),
    launcher: attrs(s.launcher),
    panel: attrs(s.panel),
    head: attrs(head),
    headParts: head.children.map(child => [child.tagName, attrs(child)]),
    body: attrs(s.panel.querySelector(".station-handbook__body")),
    sections: s.panel.querySelectorAll(".station-handbook__section").map(attrs)
  };
}

/* The drawn machine, as its geometry: every placed coordinate of every
 * node under the canvas - and nothing of its state (class, hidden), so a
 * turned-over cluster, which is hidden and not moved, reads the same. The
 * cards Blend Edit lays over the clusters are the mode's own and are left
 * out; what is compared is the machine under them - the layer headers
 * and their share slots included, which the mode does not touch. */
const GEOMETRY_ATTRIBUTES = ["viewBox", "x", "y", "width", "height", "transform", "d", "points", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2"];
function stageGeometry(s) {
  const nodes = [];
  const walk = node => {
    if (node.getAttribute && node.getAttribute("data-role") === "blend-card") return;
    const placed = {};
    for (const key of GEOMETRY_ATTRIBUTES) if (node.getAttribute && node.getAttribute(key) !== null) placed[key] = node.getAttribute(key);
    if (Object.keys(placed).length) nodes.push([node.tagName, placed]);
    for (const child of node.children || []) walk(child);
  };
  walk(s.machine.querySelector("svg"));
  return JSON.stringify(nodes);
}

test("Recipe Book and Blend Edit stand in one and the same frame: the shell's root, launcher, panel, head and body are byte-identical across entering and leaving the mode", () => {
  const s = boot();
  s.launcher.click();
  const book = frameOf(s);
  assert.equal(s.panel.hidden, false);
  s.clickAction("blend-edit");
  assert.equal(s.modeOn(), true);
  const blend = frameOf(s);
  assert.deepEqual(blend, book, "entering Blend Edit changed the frame");
  s.flipLayer("B");
  s.clickAction("edit-all");
  assert.deepEqual(frameOf(s), book, "turning layers over changed the frame");
  s.clickAction("done");
  assert.deepEqual(frameOf(s), book, "Done changed the frame");
  // What differs is inside the section, and only by what is hidden.
  s.clickAction("blend-edit");
  const controls = s.blendControls();
  const columns = s.panel.querySelector(".station-book__columns");
  assert.equal(controls.hidden, false);
  assert.equal(columns.hidden, true);
  s.clickAction("done");
  assert.equal(controls.hidden, true);
  assert.equal(columns.hidden, false);
  // The panel is never marked, sized or measured by the boot file either.
  const bootSource = read("station/station.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(bootSource, /handbookPanel\.(panel|element)\.(style|classList|setAttribute)/, "station.js dresses the Handbook's frame");
  assert.doesNotMatch(bootSource, /handbook__panel/, "station.js reaches into the Handbook's panel");
});

test("the Handbook's arrival, and Blend Edit inside it, move nothing above the frame: the drawn machine's geometry and the timeline's mount are what they were", () => {
  const s = boot();
  const timeline = s.q("[data-station-mount='timeline']");
  assert.ok(timeline, "the shell has its timeline mount");
  const serialize = node => JSON.stringify([Object.entries(node.attributes || {}).sort(), node.children.map(child => [child.tagName, Object.entries(child.attributes || {}).sort()])]);
  const geometry = JSON.parse(stageGeometry(s));
  assert.ok(geometry.length > 200, `the machine is drawn: ${geometry.length} placed nodes`);
  assert.equal(s.clusters(), 3, "three clusters are placed");
  const closed = { stage: stageGeometry(s), timeline: serialize(timeline), shell: JSON.stringify(s.q(".station-shell").children.map(child => [child.tagName, Object.entries(child.attributes || {}).sort()])) };
  s.launcher.click();
  assert.equal(s.isHandbookOpen(), true);
  assert.equal(stageGeometry(s), closed.stage, "opening the Handbook moved the machine");
  assert.equal(serialize(timeline), closed.timeline, "opening the Handbook touched the timeline");
  assert.equal(JSON.stringify(s.q(".station-shell").children.map(child => [child.tagName, Object.entries(child.attributes || {}).sort()])), closed.shell, "opening the Handbook changed the shell's tracks");
  s.clickAction("blend-edit");
  s.clickAction("edit-all");
  // Turned-over clusters keep their place (they are hidden, not moved), so
  // the geometry the cards are laid over is the geometry the hoppers had.
  assert.equal(stageGeometry(s), closed.stage, "Blend Edit moved the machine under its cards");
  assert.equal(serialize(timeline), closed.timeline, "Blend Edit touched the timeline");
  s.clickAction("close-handbook");
  assert.equal(stageGeometry(s), closed.stage);
  assert.equal(serialize(timeline), closed.timeline);
  // The frame's slot is the stage's own cell, laid over it, never a track
  // of the shell: enlarging the frame cannot displace the timeline.
  const shellCss = read("station/styles/shell.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(shellCss, /grid-template-rows: var\(--station-header-height\) minmax\(0, 1fr\) auto var\(--station-status-height\);/);
  assert.match(shellCss, /grid-template-areas:\n\s+"header"\n\s+"machine"\n\s+"timeline"\n\s+"status";/);
  assert.match(shellCss, /\.station-handbook-slot \{[^}]*grid-area: machine;/);
  assert.doesNotMatch(shellCss, /grid-area: timeline;[^}]*handbook|handbook[^}]*grid-area: timeline/);
});

test("the header around the stage is identity, the way back and the two readouts; the timeline's scale is the timeline's own, under Now, and the Handbook's arrival neither covers nor moves it", () => {
  const s = boot();
  const header = s.q(".station-header");
  assert.deepEqual(header.children.map(n => n.getAttribute("class")), ["station-header__title", "station-header__legacy", "station-header__job", "station-header__connection"]);
  assert.equal(header.children[0].textContent, "Station");
  assert.doesNotMatch(header.textContent, /experimental|6H|12H/i, "no badge and no scale in the header");
  assert.equal(header.querySelector("[data-window]"), null);
  // The way back is the host's own URL without the Station flag - the route
  // the application already has - as a link, not a script.
  const legacy = header.querySelector(".station-header__legacy");
  assert.equal(legacy.tagName, "A");
  assert.equal(legacy.textContent, "Legacy");
  assert.equal(legacy.getAttribute("href"), "/");
  assert.deepEqual(Object.keys(legacy.listeners), []);
  // The readouts are what they were: Output and Changeover, editable.
  assert.deepEqual(header.querySelectorAll(".station-job__key").map(n => n.textContent), ["Output", "Changeover"]);
  assert.match(header.querySelectorAll(".station-job__value")[0].textContent, /900 lb\/hr/);
  // The scale lives in the timeline's Now column, and pressing it is the
  // timeline's own setWindow: the row redraws at the new window.
  const timeline = s.q("[data-station-mount='timeline']");
  const range = timeline.querySelector(".station-rundown__now .station-rundown__range");
  assert.ok(range, "6H | 12H is under Now");
  const options = range.querySelectorAll("[data-window]");
  assert.deepEqual(options.map(n => [n.textContent, n.getAttribute("aria-pressed")]), [["6H", "true"], ["12H", "false"]]);
  const rundown = timeline.querySelector(".station-rundown");
  options[1].click();
  assert.equal(rundown.getAttribute("data-window"), "12");
  assert.deepEqual(options.map(n => n.getAttribute("aria-pressed")), ["false", "true"]);
  // Opening the Handbook, and Blend Edit in it, is laid over the stage's
  // cell only: the timeline row, its scale and its state are untouched.
  const serialize = node => JSON.stringify([Object.entries(node.attributes || {}).sort(), node.children.map(child => [child.tagName, Object.entries(child.attributes || {}).sort()])]);
  const before = { timeline: serialize(timeline), now: serialize(timeline.querySelector(".station-rundown__now")), range: serialize(range) };
  s.launcher.click();
  s.clickAction("blend-edit");
  s.clickAction("edit-all");
  assert.equal(serialize(timeline), before.timeline);
  assert.equal(serialize(timeline.querySelector(".station-rundown__now")), before.now);
  assert.equal(serialize(range), before.range);
  assert.equal(rundown.getAttribute("data-window"), "12", "the scale chosen before the Handbook opened is still the scale");
  // And it is still the operator's to change with the Handbook open.
  options[0].click();
  assert.equal(rundown.getAttribute("data-window"), "6");
  s.clickAction("close-handbook");
  assert.equal(rundown.getAttribute("data-window"), "6");
  assert.deepEqual(s.calls, [], "no command: the scale is this screen's");
});

/* ----------------------------------------------------------------------
 *   Rearranging on a card
 * -------------------------------------------------------------------- */

test("a row dragged on a Blend Edit card and dropped on another row is one moveHopper through the executor, within that layer, with the mode and every card left standing", () => {
  const s = boot().enterBlendEdit();
  s.clickAction("edit-all");
  const card = s.cards().find(c => c.getAttribute("data-layer") === "B");
  assert.ok(card, "layer B has a card");
  const rows = card.querySelectorAll(".station-editor__item");
  assert.ok(rows[1].classList.contains("is-movable"), "an assigned row on the card offers the drag");
  const badge = id => rows.find(r => r.getAttribute("data-hopper") === id).querySelector(".station-editor__badge");
  const list = card.querySelector(".station-editor__list");
  s.doc.elementFromPoint = () => badge("B4");
  const pointer = (type, target, extra) => makeEvent(type, Object.assign({ bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0 }, extra || {}));
  badge("B2").dispatchEvent(pointer("pointerdown", badge("B2"), { clientX: 10, clientY: 10 }));
  list.dispatchEvent(pointer("pointermove", list, { clientX: 10, clientY: 60 }));
  assert.ok(list.classList.contains("is-moving"), "the card's list is carrying a row");
  list.dispatchEvent(pointer("pointerup", list, { clientX: 10, clientY: 60, buttons: 0 }));
  assert.deepEqual(s.calls.map(c => [c.command, c.args, c.handbookOpen]),
    [["moveHopper", { recipe: "current", layer: "B", index: 1, toLayer: "B", toIndex: 3 }, true]]);
  assert.equal(s.modeOn(), true, "the mode is still on");
  assert.equal(s.cards().length, 3, "every card is still drawn");
  assert.equal(s.isHandbookOpen(), true);
  assert.ok(!list.classList.contains("is-moving"), "the drag is over");
  assert.doesNotMatch(s.status.textContent, /Blend Edit/, "nothing was refused");
  // Done afterwards is what it was.
  s.clickAction("done");
  assertModeCleared(s);
});
