"use strict";

/* Entering and leaving Blend Edit from the machine utility rail.
 *
 * The mode's one switch stands on the rail beside the far-right hopper
 * cluster (station-machine-rail.js): one click turns every layer over to
 * its blend card, the next turns them all back. Escape on the stage,
 * with nothing open, is the same exit. The Operator Handbook has no part
 * in it any more: it opens, closes and turns its pages the same with the
 * mode on as off, so the Recipe Book can be read - and a saved recipe
 * previewed - while the cards are out. Two rules from before still hold:
 *
 *   - the mode has ONE exit path (station.js's exitBlendEdit), reached
 *     from the rail's switch and from Escape, so the two cannot drift;
 *   - the status line carries ONE transient notice, replaced by the next
 *     and cleared by a valid interaction or the mode's exit - never
 *     appended to.
 *
 * The same exit leaves whatever field the operator is in along that
 * field's own path - a card's percentage (station-focus-editor.js), a
 * header's share (station-layer-share.js): Enter and leaving commit,
 * Escape drops the draft and is spent in the field - so a value that was
 * accepted is held, a value Escape dropped is not sent, and no field or
 * handle survives the exit.
 *
 * station.js is a self-starting file over a browser document, so it is
 * run here for real: every module the production host loads, in the
 * host's own order, evaluated into one context over a small fake DOM,
 * with the state and command bridges connected the way app.js connects
 * them - the executor applies the commands the fields issue and answers
 * with the state bridge's own frozen snapshot, as app.js does, so an
 * accepted value is the value the rebuilt stage shows. What the tests
 * then drive is the drawn stage, the rail's own buttons and the
 * Handbook's - the same elements an operator clicks.
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
  "station-connection-bridge.js", "station-recipes-bridge.js", "station-weight-profiles-bridge.js"
];

function snapshot(overrides, smart) {
  const line = Object.assign({ lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", linked: true }, overrides || {});
  return {
    line,
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    /* Smart Hoppers as the bridge projects it: off, on a cylindrical line
     * with a circumference already entered, so the switch is on offer. */
    smartHoppers: Object.assign({ enabled: false, geometryMode: "cylindrical", circumference: 40 }, smart || {}),
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layerPct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
        weight: 0, usableHeight: 30, usableGallons: 0, effectiveWeight: 0, smartWeight: null, track: false, pumpOff: false
      }))
    })),
    revision: 1
  };
}

/* The fake application's Smart Hoppers: with the switch on, a hopper
 * with a resin, a usable height and the line's circumference gets a
 * computed weight (a made-up rule - the real one is app.js's, and
 * Station never sees it), which is then the effective weight; anything
 * else keeps its entered weight. Run after every command, as the
 * application's own validateAndCompute runs. */
function recomputeSmart(snap) {
  const smart = snap.smartHoppers;
  for (const layer of snap.layers) {
    for (const h of layer.hoppers) {
      const computed = smart.enabled && h.resinName && h.usableHeight > 0 && smart.circumference > 0;
      h.smartWeight = computed ? { value: Math.round(h.usableHeight * smart.circumference / 10), bulkDensity: 44.9, resinCode: h.resinName } : null;
      h.effectiveWeight = h.smartWeight ? h.smartWeight.value : h.weight;
    }
  }
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
  const snap = snapshot(settings.line, settings.smart);
  recomputeSmart(snap);
  const stateBridge = window.PolynStationStateBridge;
  const contract = window.PolynStationCommandContract;
  const calls = [];
  const handle = stateBridge.connect({ read: () => snap });
  const layerOf = id => snap.layers.find(layer => layer.name === id) || null;
  if (settings.connectCommands !== false) window.PolynStationCommandBridge.connect({
    execute(command, args) {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)), handbookOpen: isHandbookOpen() });
      // A test may have the application refuse: `refuse(command, args)`
      // returns the reason, and the answer is the contract's refusal.
      const refused = typeof settings.refuse === "function" ? settings.refuse(command, args) : null;
      if (refused) return contract.failure("out_of_range", { message: refused });
      if (command === "setHopperBlend" && layerOf(args.layer)) layerOf(args.layer).hoppers[args.index].pct = Number(args.pct);
      else if (command === "setLayerShare" && layerOf(args.layer)) layerOf(args.layer).layerPct = Number(args.pct);
      else if (command === "setHopperTracking" && layerOf(args.layer)) layerOf(args.layer).hoppers[args.index].track = !!args.track;
      else if (command === "setHopperWeight" && layerOf(args.layer)) {
        const h = layerOf(args.layer).hoppers[args.index];
        h.weight = Number(args.weight); h.effectiveWeight = h.weight;
      } else if (command === "setHopperWeights") {
        for (const entry of args.weights) {
          const h = layerOf(entry.layer) && layerOf(entry.layer).hoppers[entry.index];
          if (h) { h.weight = Number(entry.weight); h.effectiveWeight = h.weight; }
        }
      }
      else if (command === "setHopperGeometry" && layerOf(args.layer)) {
        const h = layerOf(args.layer).hoppers[args.index];
        if (args.dimension === "height") h.usableHeight = Number(args.value);
        else h.usableGallons = Number(args.value);
      } else if (command === "setHopperCircumference") snap.smartHoppers.circumference = Number(args.circumference);
      else if (command === "setSmartHoppers") snap.smartHoppers.enabled = !!args.enabled;
      else if (command === "resetTracking") {
        // The application's own reset: a job with nothing tracked answers
        // unchanged, as the executor does.
        const any = snap.layers.some(layer => layer.hoppers.some(h => h.track || h.pumpOff));
        if (!any) return contract.success({ changed: false, revision: stateBridge.getRevision(), persisted: false, snapshot: stateBridge.getSnapshot() });
        for (const layer of snap.layers) for (const h of layer.hoppers) { h.track = false; h.pumpOff = false; }
      }
      recomputeSmart(snap);
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
  const rail = q("[data-role='machine-rail']");
  function isHandbookOpen() { return launcher ? launcher.getAttribute("aria-expanded") === "true" : false; }
  assert.ok(machine && status && launcher && panel && rail, "Station booted with its stage, status, Handbook and machine rail");

  const api = {
    doc, window, calls, machine, status, launcher, panel, rail, q, timers,
    /* The rail's four controls, the same buttons an operator clicks. */
    blendSwitch: () => rail.querySelector("[data-action='blend-edit']"),
    weightsSwitch: () => rail.querySelector("[data-action='weights-edit']"),
    smartSwitch: () => rail.querySelector("[data-action='smart-hoppers']"),
    resetControl: () => rail.querySelector("[data-action='reset-tracking']"),
    clickBlend: () => { api.blendSwitch().click(); return api.blendSwitch(); },
    clickWeights: () => { api.weightsSwitch().click(); return api.weightsSwitch(); },
    clickSmart: () => { api.smartSwitch().click(); return api.smartSwitch(); },
    /* The Weights face: its cards, and which face the mount says is showing. */
    weightCards: () => machine.querySelectorAll("[data-role='weights-card']"),
    face: () => machine.getAttribute("data-edit-face"),
    /* The drawn caption's weight line for a hopper, and its mark. */
    caption: (layer, index) => {
      const hopper = machine.querySelectorAll(".station-hopper").find(n => n.getAttribute("data-layer") === layer && n.getAttribute("data-hopper-index") === String(index));
      assert.ok(hopper, `hopper ${layer}:${index} is drawn`);
      return { text: hopper.querySelector(".station-hopper__weight").textContent, smart: hopper.classList.contains("is-smart") };
    },
    /* A field on a weight card: the weight, the geometry or the circumference. */
    cardField: (layer, kind, index) => {
      const card = api.weightCards().find(c => c.getAttribute("data-layer") === layer);
      assert.ok(card, `layer ${layer} has a weight card`);
      if (kind === "circumference") return card.querySelector(".station-weight-card__circumference-field");
      const className = kind === "geometry" ? "station-weight-card__geometry-field" : "station-weight-card__field";
      return card.querySelectorAll(`.${className}`).find(i => i.getAttribute("data-index") === String(index)) || null;
    },
    /* Enter a value in a card's field and commit it with Enter. */
    enterOnCard(layer, kind, index, value) {
      const input = api.cardField(layer, kind, index);
      assert.ok(input, `a ${kind} field for ${layer}:${index}`);
      input.focus();
      input.value = String(value);
      input.dispatchEvent(makeEvent("input", { bubbles: true }));
      input.dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
      return input;
    },
    /* The application's state, as the executor holds it. */
    state: () => snap,
    isHandbookOpen,
    action: name => panel.querySelector(`[data-action='${name}']`),
    clickAction: name => { const button = api.action(name); assert.ok(button, `no action ${name}`); button.click(); return button; },
    target: (name, layer) => machine.querySelectorAll(`[data-station-target='${name}']`).find(n => n.getAttribute("data-layer") === layer) || null,
    clickTarget: (name, layer) => { const el = api.target(name, layer); assert.ok(el, `no ${name} on layer ${layer}`); el.click(); return el; },
    cards: () => machine.querySelectorAll("[data-role='blend-card']"),
    chips: () => machine.querySelectorAll("[data-station-target='flip']"),
    /* Turning a layer over or back is its own train's click while the
     * mode is on: the layer's extruder, the same target an operator
     * clicks to open it outside the mode. */
    flipLayer: layer => api.clickTarget("extruder", layer),
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
    /* The mode as an operator reaches it: one click on the rail. Every
     * layer is turned over on entry. */
    enterBlendEdit() {
      api.clickBlend();
      assert.equal(api.modeOn(), true, "Blend Edit is on");
      assert.deepEqual(api.flipped(), ["A", "B", "C"], "every layer turned over on entry");
      return api;
    },
    /* A draft on a card: the layer's hopper 2 field, focused, with a new
     * value typed and not yet committed. */
    draftOnCard(layer, value) {
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

const HINT = "Blend Edit: every layer is turned over to its blend card. Click a layer's mixer or extruder to show its hoppers; click Blend Edit again when done.";
const count = (text, needle) => text.split(needle).length - 1;

/* A stage back to normal: no mode attribute, no card, no chip, no turned
 * layer, every cluster present; the rail's switch off; the Handbook with
 * no Blend Edit control of its own. */
function assertModeCleared(s) {
  assert.equal(s.modeOn(), false, "the mount no longer says the mode is on");
  assert.equal(s.cards().length, 0, "no card is drawn");
  assert.equal(s.chips().length, 0, "no flip chip is drawn");
  assert.deepEqual(s.flipped(), [], "no layer is turned over");
  assert.equal(s.clusters(), 3, "every layer shows its hopper cluster");
  assert.equal(s.blendSwitch().getAttribute("aria-pressed"), "false", "the rail's switch reads off");
  assert.ok(!s.blendSwitch().classList.contains("is-active"));
  assert.equal(s.weightsSwitch().getAttribute("aria-pressed"), "false", "and the Weights switch");
  assert.equal(s.weightCards().length, 0, "no weight card is drawn");
  assert.equal(s.face(), null, "the mount names no face");
  assert.equal(s.blendControls(), null, "the Handbook has no Blend Edit controls");
  assert.equal(s.action("blend-edit"), null, "nor a Blend Edit action");
  assert.doesNotMatch(s.status.textContent, /Blend Edit/, "no Blend Edit notice is left on the status line");
  assert.ok(s.shareEditor() === null, "no share field is left in a header");
  assert.ok(s.machine.querySelector(".is-editing") === null, "no header is still marked as being edited");
  assert.equal(s.machine.contains(s.doc.activeElement), false, "nothing on the stage keeps the focus");
}

/* ----------------------------------------------------------------------
 *   The rail's switch: in, and out
 * -------------------------------------------------------------------- */

test("one click on the rail enters the mode with every layer turned over; the switch shows it; nothing is dispatched", () => {
  const s = boot();
  const stageBefore = s.machine.querySelector("svg").attributes;
  assert.equal(s.blendSwitch().getAttribute("aria-pressed"), "false");
  assert.equal(s.blendSwitch().getAttribute("title"), "Blend Edit");
  assert.equal(s.blendSwitch().disabled, false);
  s.clickBlend();
  assert.equal(s.modeOn(), true);
  assert.deepEqual(s.flipped(), ["A", "B", "C"]);
  assert.equal(s.cards().length, 3);
  assert.equal(s.blendSwitch().getAttribute("aria-pressed"), "true");
  assert.ok(s.blendSwitch().classList.contains("is-active"));
  assert.match(s.blendSwitch().getAttribute("title"), /^Blend Edit · on/);
  assert.ok(s.status.textContent.startsWith(HINT), "the mode says how to leave it");
  assert.equal(s.isHandbookOpen(), false, "the Handbook was not opened to get here");
  assert.deepEqual(s.calls, []);
  // Turned-over clusters keep their place: the viewBox is what it was.
  assert.equal(s.machine.querySelector("svg").attributes.viewBox, stageBefore.viewBox);
});

test("the second click on the rail is Done: the mode ends, every layer is back as hoppers, the switch reads off", () => {
  const s = boot().enterBlendEdit();
  s.clickBlend();
  assertModeCleared(s);
  assert.deepEqual(s.calls, [], "with nothing being entered, nothing was dispatched");
});

test("Escape on the stage with nothing open is the same exit", () => {
  const s = boot().enterBlendEdit();
  s.escapeOnStage();
  assertModeCleared(s);
});

test("a field being entered on a card commits along the editor's own path before the mode ends - once, as one command", () => {
  const s = boot().enterBlendEdit();
  s.draftOnCard("B", 35);
  s.clickBlend();
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setHopperBlend", { recipe: "current", layer: "B", index: 1, pct: 35 }]]);
  assertModeCleared(s);
  assert.equal(s.state().layers[1].hoppers[1].pct, 35, "the application holds the value the field handed over");
  // The rebuilt stage shows it: the layer's full editor opens on 35.
  s.clickTarget("extruder", "B");
  const row = s.machine.querySelectorAll("[data-role='focus-editor'] input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && !i.hasAttribute("readonly"));
  assert.ok(row, "the focused editor has the editable percentage field");
  assert.equal(row.value, "35");
});

test("a draft the application refuses on the way out is not applied and strands nothing: the mode ends, the stage shows the application's value", () => {
  const s = boot({ refuse: (command, args) => (command === "setHopperBlend" && args.pct > 90 ? "Hoppers 2-6 would exceed 100%." : null) }).enterBlendEdit();
  s.draftOnCard("B", 95);
  s.clickBlend();
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperBlend"], "the draft was offered to the application once");
  assert.equal(s.state().layers[1].hoppers[1].pct, 40, "and refused: the application's value stands");
  assertModeCleared(s);
  s.clickTarget("extruder", "B");
  const row = s.machine.querySelectorAll("[data-role='focus-editor'] input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && !i.hasAttribute("readonly"));
  assert.equal(row.value, "40");
});

test("with motion on, the switch still ends the mode at once", () => {
  const s = boot({ reducedMotion: false }).enterBlendEdit();
  s.clickBlend();
  assert.equal(s.modeOn(), false);
  assert.equal(s.cards().length, 0);
  assert.deepEqual(s.flipped(), []);
});

/* ----------------------------------------------------------------------
 *   The Handbook has no part in it
 * -------------------------------------------------------------------- */

test("the Handbook opens, turns its pages and closes with the mode on, and the mode is exactly as it was after each", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("B");
  assert.deepEqual(s.flipped(), ["A", "C"]);
  s.launcher.click();
  assert.equal(s.isHandbookOpen(), true);
  assert.equal(s.modeOn(), true, "opening the Handbook left the mode on");
  assert.deepEqual(s.flipped(), ["A", "C"]);
  assert.equal(s.cards().length, 2);
  s.showSection("appearance");
  s.showSection("recipe-book");
  assert.equal(s.modeOn(), true, "turning pages left the mode on");
  s.clickAction("close-handbook");
  assert.equal(s.isHandbookOpen(), false);
  assert.equal(s.modeOn(), true, "Close left the mode on");
  assert.deepEqual(s.flipped(), ["A", "C"]);
  s.launcher.click();
  s.escapeInPanel();
  assert.equal(s.isHandbookOpen(), false);
  assert.equal(s.modeOn(), true, "Escape inside the Handbook is the Handbook's close, not the mode's exit");
  s.launcher.click();
  s.launcher.click();
  assert.equal(s.isHandbookOpen(), false);
  assert.equal(s.modeOn(), true, "the launcher's close too");
  assert.deepEqual(s.calls, [], "nothing was dispatched by any of it");
  assert.equal(s.blendSwitch().getAttribute("aria-pressed"), "true");
});

test("the Recipe Book is usable during Blend Edit: it lists the line's recipes, a preview shows a saved blend, and selecting changes nothing on the line or the stage", () => {
  const s = boot().enterBlendEdit();
  const book = s.window.PolynStationRecipesBridge;
  assert.ok(book, "the recipes bridge is loaded");
  // The application publishes a book of two saved recipes, as app.js does.
  const handle = book.connect({
    read: () => ({
      assigned: true, workspace: { id: "w1", displayName: "Line 9" },
      recipes: [
        { id: "r1", name: "Clear film", favorite: true, updatedAt: "2026-09-01T10:00:00Z", hopperNamingMode: "standard", layers: [{ name: "A", layerPct: 30, hoppers: [{ index: 0, resinName: "HX-CLEAR", pct: 70 }, { index: 1, resinName: "LD-SLIP", pct: 30 }] }] },
        { id: "r2", name: "Heavy gauge", favorite: false, updatedAt: "2026-09-02T10:00:00Z", hopperNamingMode: "standard", layers: [] }
      ]
    }),
    request: () => ({ ok: true })
  });
  handle.publish();
  s.launcher.click();
  s.showSection("recipe-book");
  const rows = s.panel.querySelectorAll(".station-book__row");
  assert.deepEqual(rows.map(r => r.querySelector(".station-book__row-name").textContent), ["Clear film", "Heavy gauge"]);
  const before = JSON.stringify(s.state());
  rows[0].click();
  assert.equal(s.panel.querySelector(".station-book__detail-name").textContent, "Clear film");
  assert.match(s.panel.querySelector(".station-book__detail").textContent, /HX-CLEAR/);
  assert.equal(s.modeOn(), true, "previewing left the mode on");
  assert.deepEqual(s.flipped(), ["A", "B", "C"], "and every card out");
  assert.equal(JSON.stringify(s.state()), before, "the line's recipe is untouched");
  assert.deepEqual(s.calls, [], "no command was issued");
  // The cards still edit while the book is open: a value committed on one
  // goes to the application as it would with the Handbook closed.
  s.draftOnCard("B", 35);
  s.clickAction("close-handbook");
  assert.equal(s.modeOn(), true, "Close left the mode on");
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperBlend"], "leaving the card's field committed it, as it always does");
  s.clickBlend();
  assertModeCleared(s);
});

test("the Handbook carries nothing of the mode: no Blend Edit action, no controls page, whether the mode is on or off", () => {
  const s = boot();
  s.launcher.click();
  assert.equal(s.action("blend-edit"), null);
  assert.equal(s.blendControls(), null);
  assert.equal(s.panel.querySelectorAll(".station-book__layer-chip").length, 0);
  for (const name of ["edit-all", "show-all", "done"]) assert.equal(s.action(name), null, `the Handbook still has ${name}`);
  s.clickBlend();
  assert.equal(s.modeOn(), true);
  assert.equal(s.action("blend-edit"), null);
  assert.equal(s.blendControls(), null);
  assert.ok(!s.panel.querySelector(".station-book__toolbar").hidden, "the book's toolbar is showing, not given way");
  assert.ok(!s.panel.querySelector(".station-book__columns").hidden);
  assert.doesNotMatch(s.panel.textContent, /Blend Edit|Edit all|Show all hoppers/);
});

/* ----------------------------------------------------------------------
 *   Afterwards: the stage is the stage
 * -------------------------------------------------------------------- */

test("normal interactions work at once after the exit: the train opens a layer, a hopper control toggles", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("B");
  s.clickBlend();
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

test("Blend Edit state is fully cleared: entering again turns every layer over afresh, whatever was turned back before the exit", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("B");
  s.flipLayer("C");
  assert.deepEqual(s.flipped(), ["A"]);
  s.clickBlend();
  assertModeCleared(s);
  s.clickBlend();
  assert.equal(s.modeOn(), true);
  assert.deepEqual(s.flipped(), ["A", "B", "C"], "every layer is turned over again, not the set left from before");
  assert.equal(s.chips().length, 0, "no chip is drawn on the stage for the mode");
});

/* ----------------------------------------------------------------------
 *   Turning one layer: the train's click
 * -------------------------------------------------------------------- */

test("with the mode on, a layer's train turns that layer back to its hoppers and over again, opens nothing, and clears the hint", () => {
  const s = boot().enterBlendEdit();
  assert.ok(s.status.textContent.startsWith(HINT));
  s.clickTarget("extruder", "B");
  assert.deepEqual(s.flipped(), ["A", "C"], "B is back as hoppers");
  assert.equal(s.cards().length, 2);
  assert.equal(s.machine.querySelector("[data-role='focus-editor']"), null, "nothing opened");
  assert.equal(s.modeOn(), true);
  assert.equal(count(s.status.textContent, HINT), 0, "a valid interaction cleared the hint");
  s.clickTarget("mixer", "B");
  assert.deepEqual(s.flipped(), ["A", "B", "C"], "the mixer turns it over again");
  assert.equal(s.cards().length, 3);
  assert.equal(s.machine.querySelector("[data-role='focus-editor']"), null);
  assert.deepEqual(s.calls, []);
  // Every layer turned back by hand leaves the mode ON: only the switch
  // and Escape end it.
  for (const layer of ["A", "B", "C"]) s.clickTarget("extruder", layer);
  assert.deepEqual(s.flipped(), []);
  assert.equal(s.modeOn(), true, "the mode is still on with every layer showing hoppers");
  assert.equal(s.blendSwitch().getAttribute("aria-pressed"), "true");
  assert.equal(s.clusters(), 3);
});

test("a field being entered on a card commits when the layer is turned back by its train", () => {
  const s = boot().enterBlendEdit();
  s.draftOnCard("B", 35);
  s.clickTarget("extruder", "B");
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setHopperBlend", { recipe: "current", layer: "B", index: 1, pct: 35 }]]);
  assert.deepEqual(s.flipped(), ["A", "C"]);
  assert.equal(s.state().layers[1].hoppers[1].pct, 35);
});

/* ----------------------------------------------------------------------
 *   The status line: one notice, replaced, cleared
 * -------------------------------------------------------------------- */

test("the hint reads once ahead of the line's own parts, and is not repeated by entering again", () => {
  const s = boot().enterBlendEdit();
  assert.equal(count(s.status.textContent, HINT), 1);
  assert.ok(s.status.textContent.startsWith(HINT), "the notice leads the line");
  assert.match(s.status.textContent, /Line 9 · 3 layers · 18 hoppers/, "ahead of what the line was saying, which is still there");
  s.clickBlend();
  assert.equal(count(s.status.textContent, HINT), 0, "the exit cleared it");
  s.clickBlend();
  assert.equal(count(s.status.textContent, HINT), 1);
});

test("a valid interaction clears the hint: a flip, a share edit, and the mode's exit each leave no Blend Edit text behind", () => {
  const s = boot().enterBlendEdit();
  assert.equal(count(s.status.textContent, HINT), 1);
  s.flipLayer("A");
  assert.equal(count(s.status.textContent, HINT), 0, "turning a layer back cleared it");
  s.clickBlend(); s.clickBlend();
  assert.equal(count(s.status.textContent, HINT), 1);
  s.clickTarget("share", "B");
  assert.equal(count(s.status.textContent, HINT), 0, "opening a share field cleared it");
  s.escapeOnStage();
  s.escapeOnStage();
  assertModeCleared(s);
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

test("a share draft being entered in a header commits along the field's own path before the mode ends - once, as one command", () => {
  const s = boot().enterBlendEdit();
  s.draftOnShare("B", 45);
  assert.equal(s.modeOn(), true, "the field opened with the mode still on");
  s.clickBlend();
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setLayerShare", { recipe: "current", layer: "B", pct: 45 }]]);
  assertModeCleared(s);
});

test("a share draft cancelled with Escape stays cancelled: the key is the field's, the mode stays on, and the exit afterwards hands nothing over", () => {
  const s = boot().enterBlendEdit();
  s.flipLayer("C");
  const input = s.draftOnShare("B", 45);
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  input.dispatchEvent(escape);
  assert.equal(escape.stopped, true, "Escape was spent in the field");
  assert.ok(s.shareEditor() === null, "the field closed");
  assert.equal(s.modeOn(), true, "the mode is still on: the key did not leave it");
  assert.deepEqual(s.flipped(), ["A", "B"], "the turned layers are still turned");
  s.clickBlend();
  assert.deepEqual(s.calls, [], "the cancelled draft was never sent");
  assertModeCleared(s);
});

test("a share value committed with Enter stays committed and is not sent again by the exit", () => {
  const s = boot().enterBlendEdit();
  const input = s.draftOnShare("A", 25);
  input.dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(s.calls.map(c => c.command), ["setLayerShare"]);
  assert.ok(s.shareEditor() === null, "Enter closed the field");
  s.clickBlend();
  assert.deepEqual(s.calls.map(c => c.command), ["setLayerShare"], "one command, not two");
  assertModeCleared(s);
});

test("a share field left unchanged by the exit is closed without a command", () => {
  const s = boot().enterBlendEdit();
  s.clickTarget("share", "B");
  assert.ok(s.shareInput(), "the field is open");
  s.clickBlend();
  assert.deepEqual(s.calls, []);
  assertModeCleared(s);
});

test("Escape on the stage with a share field open drops the draft only; the next Escape leaves the mode as the switch does", () => {
  const s = boot().enterBlendEdit();
  const input = s.draftOnShare("B", 45);
  // The key bubbles from the field to the document, where the boot file's
  // Escape lives: it must not get there.
  input.dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(s.modeOn(), true);
  assert.ok(s.shareEditor() === null);
  s.escapeOnStage();
  assertModeCleared(s);
  assert.deepEqual(s.calls, [], "the dropped draft was not sent");
  assert.equal(s.blendSwitch().disabled, false, "Blend Edit is on offer again");
});

test("a card field and a share field cannot both be open: opening the share commits the card's draft first, and the exit then finds one field to leave", () => {
  const s = boot().enterBlendEdit();
  s.draftOnCard("B", 35);
  s.draftOnShare("A", 25);
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperBlend"], "moving to the share field left the card's field, which committed");
  s.clickBlend();
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [
    ["setHopperBlend", { recipe: "current", layer: "B", index: 1, pct: 35 }],
    ["setLayerShare", { recipe: "current", layer: "A", pct: 25 }]
  ]);
  assertModeCleared(s);
});

test("after the exit the share is editable in its header at once, and a fresh field opens", () => {
  const s = boot().enterBlendEdit();
  s.draftOnShare("B", 45);
  s.clickBlend();
  assertModeCleared(s);
  s.clickTarget("share", "B");
  const input = s.shareInput();
  assert.ok(input, "a new field opened in the header");
  assert.equal(input.value, "45", "it opens on what the application now holds - the value the exit handed over");
  assert.ok(s.doc.activeElement === input);
});

/* ----------------------------------------------------------------------
 *   Round after round, no refresh
 * -------------------------------------------------------------------- */

test("entering and leaving the mode by each exit in turn leaves nothing behind: each round's hint reads once and is cleared, each edit is one command, the train opens a layer after each, and no handler doubles", () => {
  const s = boot();
  const exits = [
    { name: "the rail's switch", leave: () => s.clickBlend() },
    { name: "Escape on the stage", leave: () => s.escapeOnStage() },
    { name: "the rail's switch, Handbook open", leave: () => { s.launcher.click(); s.clickBlend(); s.clickAction("close-handbook"); } },
    { name: "Escape on the stage, Handbook open", leave: () => { s.launcher.click(); s.escapeOnStage(); s.clickAction("close-handbook"); } }
  ];
  let commands = 0;
  exits.forEach((exit, round) => {
    s.enterBlendEdit();
    assert.equal(count(s.status.textContent, HINT), 1, `round ${round + 1} (${exit.name}): the hint reads once`);
    s.flipLayer("B");
    assert.deepEqual(s.flipped(), ["A", "C"], `round ${round + 1}: B turned back`);
    s.draftOnCard("A", 55 + round);
    exit.leave();
    commands += 1;
    assert.equal(s.calls.length, commands, `round ${round + 1}: the draft went once - no handler dispatched it twice`);
    assert.deepEqual(s.calls[commands - 1].args, { recipe: "current", layer: "A", index: 1, pct: 55 + round });
    assert.equal(s.isHandbookOpen(), false, `round ${round + 1}: the Handbook is closed again`);
    assertModeCleared(s);
    // The stage is the stage: the train opens the layer's full editor.
    s.clickTarget("extruder", "C");
    const editor = s.machine.querySelector("[data-role='focus-editor']");
    assert.ok(editor && editor.getAttribute("data-variant") === "full", `round ${round + 1}: the focused editor opened`);
    assert.equal(count(s.status.textContent, HINT), 0);
    s.escapeOnStage();
    assert.ok(s.machine.querySelector("[data-role='focus-editor']") === null);
  });
  assert.equal(s.calls.length, exits.length);
  assert.ok(s.calls.every(c => c.command === "setHopperBlend"));
});

/* ----------------------------------------------------------------------
 *   One exit path
 * -------------------------------------------------------------------- */

test("the rail's switch and Escape share the one exit path: the boot file routes both to exitBlendEdit, hands the Handbook no beforeClose, and defines no second", () => {
  const bootSource = read("station/station.js");
  assert.match(bootSource, /onBlendEdit: toggleBlendEdit,/);
  assert.match(bootSource, /function toggleBlendEdit\(\) \{\n\s+return modeIs\("blend"\) \? exitBlendEdit\(\) : enterBlendEdit\("blend"\);/);
  // The Weights face is the same mode with its other face: the same exit.
  assert.match(bootSource, /onWeightsEdit: toggleWeightsEdit,/);
  assert.match(bootSource, /function toggleWeightsEdit\(\) \{\n\s+return modeIs\("weights"\) \? exitBlendEdit\(\) : enterBlendEdit\("weights"\);/);
  // The Next face is the same mode with its third face: the same exit.
  assert.match(bootSource, /onNextEdit: toggleNextEdit,/);
  assert.match(bootSource, /function toggleNextEdit\(\) \{\n\s+return modeIs\("next"\) \? exitBlendEdit\(\) : enterBlendEdit\("next"\);/);
  assert.doesNotMatch(bootSource, /beforeClose/, "the Handbook's close is not routed to the mode");
  assert.doesNotMatch(bootSource, /blendSurface|blend: blendSurface|context: \{\s+recipes,\s+blend/, "no surface over the mode is handed to the Handbook");
  assert.equal((bootSource.match(/blendEdit\.active = false;/g) || []).length, 2, "the mode is turned off in exitBlendEdit and by a line that lost its layers, nowhere else");
  assert.equal((bootSource.match(/exitBlendEdit\(\)/g) || []).length, 5, "called from the three toggles, from Escape, and defined - nowhere else");
  // The Handbook module still offers beforeClose to whoever needs it; the
  // boot file simply does not.
  const handbookSource = read("station/station-handbook.js");
  const close = handbookSource.slice(handbookSource.indexOf("function close() {"), handbookSource.indexOf("function toggle() {"));
  assert.match(close, /if \(!state\.open\) return false;\n\s+beforeClose\(\);\n\s+state\.open = false;/);
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
 *   The rail, booted: Reset Tracking, and where the rail stands
 * -------------------------------------------------------------------- */

test("Reset Tracking is armed by one click and confirmed by the next: one resetTracking through the executor, every hopper untracked, the stage patched, the status line saying so", () => {
  const s = boot();
  const reset = s.resetControl();
  assert.equal(reset.disabled, true, "nothing tracked: nothing to reset");
  assert.match(reset.getAttribute("title"), /nothing is tracked/);
  // Two hoppers tracked, through the drawn controls as an operator does it.
  s.clickTarget("tracking", "A");
  s.clickTarget("tracking", "B");
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperTracking", "setHopperTracking"]);
  assert.equal(reset.disabled, false, "the count followed the publish");
  assert.equal(reset.getAttribute("title"), "Reset Tracking · 2 hoppers");
  assert.equal(s.machine.querySelectorAll(".station-hopper.is-tracking").length, 2);
  reset.click();
  assert.equal(reset.getAttribute("data-armed"), "true");
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperTracking", "setHopperTracking"], "arming asks the application nothing");
  assert.ok(s.state().layers[0].hoppers[0].track, "and changes nothing");
  reset.click();
  assert.deepEqual(s.calls.map(c => [c.command, c.args]).slice(2), [["resetTracking", { recipe: "current" }]]);
  assert.ok(s.state().layers.every(layer => layer.hoppers.every(h => !h.track && !h.pumpOff)), "the application cleared every hopper");
  assert.equal(s.machine.querySelectorAll(".station-hopper.is-tracking").length, 0, "the stage shows it");
  assert.equal(reset.disabled, true, "nothing left to reset");
  assert.equal(reset.getAttribute("data-armed"), null);
  assert.match(s.status.textContent, /^Tracking reset: every hopper is untracked/);
  // The reset touched nothing else: resins, shares, the mode.
  assert.equal(s.state().layers[1].hoppers[1].pct, 40);
  assert.equal(s.modeOn(), false);
});

test("an armed reset that is not confirmed resets nothing: a click elsewhere on the stage disarms it, and so does the arm's own timeout", () => {
  const s = boot();
  s.clickTarget("tracking", "C");
  const reset = s.resetControl();
  reset.click();
  assert.equal(reset.getAttribute("data-armed"), "true");
  // A click on a hopper elsewhere: the pointer down that precedes it lands
  // on the document first.
  const hopper = s.target("tracking", "A");
  hopper.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(reset.getAttribute("data-armed"), null, "disarmed by the click away");
  hopper.click();
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperTracking", "setHopperTracking"], "the hopper's own toggle went through; no reset did");
  assert.ok(s.state().layers[2].hoppers[0].track, "C is still tracked");
  reset.click();
  assert.equal(reset.getAttribute("data-armed"), "true");
  const armTimer = s.timers.find(t => t.ms === s.window.PolynStationMachineRail.ARM_DURATION);
  assert.ok(armTimer, "the arm started its timer on the host's clock");
  armTimer.fn();
  assert.equal(reset.getAttribute("data-armed"), null, "the timeout disarmed it");
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperTracking", "setHopperTracking"]);
});

test("the reset is read-only where the commands are: with no producer it is disabled and says why, and never arms", () => {
  // A boot with the command bridge left unconnected, as the harness is.
  const s = boot({ connectCommands: false });
  const reset = s.resetControl();
  assert.equal(reset.disabled, true);
  assert.match(reset.getAttribute("title"), /not available: no application is connected to Station commands/);
  reset.click();
  assert.equal(reset.getAttribute("data-armed"), null);
  // Blend Edit still enters here: the cards are read-only, as they always were.
  assert.equal(s.blendSwitch().disabled, false);
  s.clickBlend();
  assert.equal(s.modeOn(), true);
  assert.equal(s.cards().length, 3);
});

test("the rail steps back while a layer is open and returns when it closes; entering Blend Edit closes the layer and the rail stands again", () => {
  const s = boot();
  const rail = s.rail;
  assert.ok(!rail.classList.contains("is-withdrawn"));
  assert.ok(!rail.hidden);
  s.clickTarget("extruder", "B");
  assert.ok(s.machine.querySelector("[data-role='focus-editor']"), "the layer opened");
  assert.ok(rail.classList.contains("is-withdrawn"), "the rail stepped back for the focused layout");
  s.escapeOnStage();
  assert.ok(!rail.classList.contains("is-withdrawn"), "and returned");
  s.clickTarget("extruder", "B");
  assert.ok(rail.classList.contains("is-withdrawn"));
  // The switch is out of the pointer's way, but the mode's entry closes
  // the layer as it always did: driven here the way a keyboard would.
  s.clickBlend();
  assert.equal(s.modeOn(), true);
  assert.equal(s.machine.querySelector("[data-role='focus-editor']"), null, "the open layer closed");
  assert.ok(!rail.classList.contains("is-withdrawn"), "the rail stands with the mode on");
  s.clickBlend();
  assertModeCleared(s);
});

test("the rail is placed against the drawn stage on every render of the normal layout, from the far-right cluster the SVG declares, in its own slot over the stage", () => {
  const s = boot();
  const rail = s.rail;
  assert.equal(rail.parent.getAttribute("data-station-mount"), "rail");
  assert.ok(rail.classList.contains("is-placed"), "placed after the first draw");
  const svg = s.machine.querySelector("svg");
  const railModule = s.window.PolynStationMachineRail;
  const read = railModule.readStage(svg);
  assert.equal(read.clusters.length, 3, "three normal clusters declared");
  const expected = railModule.anchor({ viewBox: read.viewBox, clusters: read.clusters, stage: svg.getBoundingClientRect(), host: rail.parent.getBoundingClientRect(), rail: rail.getBoundingClientRect() });
  assert.equal(rail.style.left, `${expected.left}px`);
  assert.equal(rail.style.top, `${expected.top}px`);
  assert.equal(rail.style.height, `${expected.height}px`);
  // Blend Edit redraws the stage in the same geometry: the same place.
  s.clickBlend();
  assert.equal(rail.style.left, `${expected.left}px`);
  assert.equal(rail.style.top, `${expected.top}px`);
  assert.equal(rail.style.height, `${expected.height}px`);
  s.clickBlend();
  // The rail never enters the stage's SVG and the stage never grows for it.
  assert.equal(s.machine.querySelector("[data-role='machine-rail']"), null);
  assert.equal(s.machine.querySelector("svg").getAttribute("viewBox"), svg.getAttribute("viewBox"));
});

/* ----------------------------------------------------------------------
 *   Layer columns read A, B, C whichever side A is on
 * -------------------------------------------------------------------- */

/* The x each bank is drawn at, in letter order as listed left to right. */
function bankOrder(s) {
  return s.machine.querySelectorAll("[data-role='layer']")
    .map(node => ({ id: node.getAttribute("data-layer"), x: Number(node.getAttribute("data-object-cluster").split(" ")[0]), role: node.querySelector(".station-layer__role").textContent }))
    .sort((a, b) => a.x - b.x);
}

test("Line 8 (A inside): the banks read A B C left to right, labelled INSIDE / CORE / OUTSIDE; Blend Edit's cards stand in the same columns; nothing in the job is touched", () => {
  const s = boot({ line: { lineNumber: 8, displayName: "Line 8", layerAPosition: "inside" } });
  const before = JSON.stringify(s.state());
  assert.deepEqual(bankOrder(s).map(b => [b.id, b.role]), [["A", "INSIDE"], ["B", "CORE"], ["C", "OUTSIDE"]]);
  // Each letter's hoppers stand under its own header.
  for (const bank of s.machine.querySelectorAll("[data-role='layer']")) {
    const id = bank.getAttribute("data-layer");
    assert.ok(bank.querySelectorAll("[data-role='hopper']").every(h => h.getAttribute("data-hopper").startsWith(id)), `layer ${id} draws another letter's hoppers`);
  }
  const columns = bankOrder(s).map(b => b.x);
  s.clickBlend();
  const cards = s.cards().map(card => ({ id: card.getAttribute("data-layer"), x: Number(card.querySelector("foreignObject").getAttribute("x")) })).sort((a, b) => a.x - b.x);
  assert.deepEqual(cards.map(c => c.id), ["A", "B", "C"], "the cards read A B C too");
  assert.deepEqual(bankOrder(s).map(b => b.x), columns, "the mode moved no column");
  for (const card of s.cards()) {
    const id = card.getAttribute("data-layer");
    assert.ok(card.querySelectorAll(".station-editor__item").every(row => row.getAttribute("data-hopper").startsWith(id)), `layer ${id}'s card lists another letter's hoppers`);
  }
  s.clickBlend();
  assert.equal(JSON.stringify(s.state()), before, "presentation order changed nothing in the application's state");
  assert.deepEqual(s.calls, []);
});

test("Line 12 (A outside) is what it was: A B C left to right, OUTSIDE / CORE / INSIDE", () => {
  const s = boot({ line: { lineNumber: 12, displayName: "Line 12", layerAPosition: "outside" } });
  assert.deepEqual(bankOrder(s).map(b => [b.id, b.role]), [["A", "OUTSIDE"], ["B", "CORE"], ["C", "INSIDE"]]);
  s.clickBlend();
  assert.deepEqual(s.cards().map(card => card.getAttribute("data-layer")), ["A", "B", "C"]);
});

test("the Recipe Book's preview lists a saved recipe's layers A, B, C whatever order they were saved in, accented by the side each sits on for THIS line", () => {
  const s = boot({ line: { lineNumber: 8, displayName: "Line 8", layerAPosition: "inside" } });
  const book = s.window.PolynStationRecipesBridge;
  const handle = book.connect({
    read: () => ({
      assigned: true, workspace: { id: "w8", displayName: "Line 8" },
      recipes: [{ id: "r1", name: "Shuffled", favorite: false, updatedAt: "2026-09-01T10:00:00Z", hopperNamingMode: "standard",
        layers: [
          { name: "C", layerPct: 30, hoppers: [{ index: 0, resinName: "OUT-C", pct: 100 }] },
          { name: "A", layerPct: 30, hoppers: [{ index: 0, resinName: "IN-A", pct: 100 }] },
          { name: "B", layerPct: 40, hoppers: [{ index: 0, resinName: "CORE-B", pct: 100 }] }
        ] }]
    }),
    request: () => ({ ok: true })
  });
  handle.publish();
  s.launcher.click();
  s.panel.querySelector(".station-book__row").click();
  const rows = s.panel.querySelectorAll(".station-book__layer");
  assert.deepEqual(rows.map(r => [r.getAttribute("data-layer"), r.getAttribute("data-layer-role")]), [["A", "inside"], ["B", "core"], ["C", "outside"]]);
  assert.deepEqual(rows.map(r => r.querySelector(".station-book__hopper-resin").textContent), ["IN-A", "CORE-B", "OUT-C"], "each row keeps its own letter's hoppers");
  // The same recipe on a line where A is the outside: the same order,
  // the other accents.
  const t = boot({ line: { lineNumber: 12, displayName: "Line 12", layerAPosition: "outside" } });
  t.window.PolynStationRecipesBridge.connect({ read: () => ({ assigned: true, workspace: { id: "w12", displayName: "Line 12" }, recipes: [{ id: "r1", name: "Shuffled", favorite: false, updatedAt: "", hopperNamingMode: "standard", layers: [{ name: "C", layerPct: 30, hoppers: [] }, { name: "A", layerPct: 30, hoppers: [] }, { name: "B", layerPct: 40, hoppers: [] }] }] }), request: () => ({ ok: true }) }).publish();
  t.launcher.click();
  t.panel.querySelector(".station-book__row").click();
  assert.deepEqual(t.panel.querySelectorAll(".station-book__layer").map(r => [r.getAttribute("data-layer"), r.getAttribute("data-layer-role")]), [["A", "outside"], ["B", "core"], ["C", "inside"]]);
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

test("the Handbook's frame and its Recipe Book page are byte-identical across entering and leaving the mode: nothing in it changes for Blend Edit", () => {
  const s = boot();
  s.launcher.click();
  const book = frameOf(s);
  const page = () => JSON.stringify(Object.entries(s.panel.querySelector(".station-book").attributes).sort()) + s.panel.querySelectorAll(".station-book [hidden]").length;
  const bookPage = page();
  assert.equal(s.panel.hidden, false);
  s.clickBlend();
  assert.equal(s.modeOn(), true);
  assert.deepEqual(frameOf(s), book, "entering Blend Edit changed the frame");
  assert.equal(page(), bookPage, "entering Blend Edit changed the page");
  s.flipLayer("B");
  assert.deepEqual(frameOf(s), book, "turning a layer changed the frame");
  assert.equal(page(), bookPage);
  s.clickBlend();
  assert.deepEqual(frameOf(s), book, "the exit changed the frame");
  assert.equal(page(), bookPage);
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
  s.clickBlend();
  // Turned-over clusters keep their place (they are hidden, not moved), so
  // the geometry the cards are laid over is the geometry the hoppers had.
  assert.equal(stageGeometry(s), closed.stage, "Blend Edit moved the machine under its cards");
  assert.equal(serialize(timeline), closed.timeline, "Blend Edit touched the timeline");
  s.clickAction("close-handbook");
  s.clickBlend();
  assert.equal(stageGeometry(s), closed.stage);
  assert.equal(serialize(timeline), closed.timeline);
  // The rail's slot is the stage's cell too, laid over it under the
  // Handbook's, never a track: the rail can move nothing either.
  assert.ok(s.rail.closest("[data-station-mount='rail']"), "the rail is in its own slot");
  assert.match(read("station/styles/shell.css").replace(/\/\*[\s\S]*?\*\//g, ""), /\.station-rail-slot \{[^}]*grid-area: machine;[^}]*z-index: 4;/);
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
  assert.deepEqual(header.children.map(n => n.getAttribute("class")), ["station-header__avatar", "station-header__title", "station-header__legacy", "station-header__job", "station-header__connection"]);
  assert.equal(header.children[1].querySelector(".station-logo").getAttribute("aria-label"), "Station", "the heading is the logo, named Station");
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
  s.clickBlend();
  assert.equal(serialize(timeline), before.timeline);
  assert.equal(serialize(timeline.querySelector(".station-rundown__now")), before.now);
  assert.equal(serialize(range), before.range);
  assert.equal(rundown.getAttribute("data-window"), "12", "the scale chosen before the Handbook opened is still the scale");
  // And it is still the operator's to change with the Handbook open.
  options[0].click();
  assert.equal(rundown.getAttribute("data-window"), "6");
  s.clickAction("close-handbook");
  s.clickBlend();
  assert.equal(rundown.getAttribute("data-window"), "6");
  assert.deepEqual(s.calls, [], "no command: the scale is this screen's");
});

/* ----------------------------------------------------------------------
 *   Rearranging on a card
 * -------------------------------------------------------------------- */

test("a row dragged on a Blend Edit card and dropped on another row is one moveHopper through the executor, within that layer, with the mode and every card left standing", () => {
  const s = boot().enterBlendEdit();
  s.launcher.click();
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
  // The exit afterwards is what it was.
  s.clickAction("close-handbook");
  s.clickBlend();
  assertModeCleared(s);
});

/* ----------------------------------------------------------------------
 *   The Weights page
 * -------------------------------------------------------------------- */

test("the Weights page lists the line's hoppers with their weights; a value entered on it is one setHopperWeight through the executor, and the stage's caption shows it at once", () => {
  const s = boot();
  s.launcher.click();
  s.showSection("weights");
  const page = s.panel.querySelector("[data-role='weights']");
  assert.ok(page, "the Handbook turned to the Weights page");
  const fields = page.querySelectorAll(".station-weights__field");
  assert.equal(fields.length, 18, "three layers of six hoppers");
  assert.deepEqual(fields.slice(0, 3).map(f => f.getAttribute("data-key")), ["A:0", "A:1", "A:2"]);
  assert.ok(!fields[0].hasAttribute("readonly") && !fields[0].readOnly, "the executor is connected, so the field is live");
  // The caption under A1 reads no weight yet.
  const captionOf = id => s.machine.querySelectorAll(".station-hopper__weight")[["A1", "A2", "A3", "A4", "A5", "A6"].indexOf(id)];
  assert.equal(captionOf("A1").textContent, "—");
  fields[0].focus();
  fields[0].value = "1250";
  fields[0].dispatchEvent(makeEvent("input", { bubbles: true }));
  fields[0].dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(s.calls.map(c => [c.command, c.args, c.handbookOpen]),
    [["setHopperWeight", { recipe: "current", layer: "A", index: 0, weight: 1250 }, true]]);
  assert.equal(s.state().layers[0].hoppers[0].weight, 1250, "the application applied it");
  assert.equal(captionOf("A1").textContent, "1250", "the operator's own publish redrew the hopper");
  assert.equal(fields[0].value, "1250");
  assert.ok(s.doc.activeElement === fields[0], "the field kept the focus");
  // The same value again is nothing; Escape with no draft leaves the field
  // and does not close the Handbook.
  fields[0].dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(s.calls.length, 1);
  fields[0].dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(s.isHandbookOpen(), true, "the field's Escape is not the Handbook's");
  // The bulk apply: two hoppers picked, one command, one publish.
  page.querySelector("[data-pick='B:0']").click();
  page.querySelector("[data-pick='B:1']").click();
  const bulk = page.querySelector(".station-weights__bulk-field");
  bulk.value = "900";
  bulk.dispatchEvent(makeEvent("input", { bubbles: true }));
  page.querySelector("[data-action='apply-bulk']").click();
  assert.deepEqual(s.calls[1].command, "setHopperWeights");
  assert.deepEqual(s.calls[1].args, { recipe: "current", weights: [{ layer: "B", index: 0, weight: 900 }, { layer: "B", index: 1, weight: 900 }] });
  assert.deepEqual(s.state().layers[1].hoppers.slice(0, 3).map(h => h.weight), [900, 900, 0]);
  const b = s.machine.querySelectorAll(".station-hopper__weight").slice(6, 9).map(n => n.textContent);
  assert.deepEqual(b, ["900", "900", "—"]);
  // Nothing of the recipe moved.
  assert.equal(s.state().layers[0].hoppers[0].pct, 60);
  assert.equal(s.state().layers[0].hoppers[0].resinName, "HX0");
  s.clickAction("close-handbook");
  assert.equal(s.isHandbookOpen(), false);
});

test("with no producer the Weights page is read-only, and the profiles say no application is connected", () => {
  const s = boot({ connectCommands: false });
  s.launcher.click();
  s.showSection("weights");
  const page = s.panel.querySelector("[data-role='weights']");
  const field = page.querySelector(".station-weights__field");
  assert.equal(field.readOnly, true);
  assert.match(field.getAttribute("title"), /read-only here/);
  assert.match(page.querySelector(".station-weights__list").textContent, /No application is connected to Station: weight profiles are not available/);
  assert.equal(page.querySelector("[data-action='save-current']").disabled, true);
  assert.deepEqual(s.calls, []);
});

/* ----------------------------------------------------------------------
 *   The Weights face, and the Smart Hoppers switch
 * -------------------------------------------------------------------- */

const WEIGHTS_HINT = "Weights: every layer is turned over to its weight card. Enter receiver weights - and, with Smart Hoppers on, each hopper's geometry; click Weights again when done.";

test("one click on Weights turns every layer over to its weight card: the Weights switch reads on, Blend Edit off, the mount names the face, the hint reads once, and nothing is dispatched", () => {
  const s = boot();
  s.clickWeights();
  assert.equal(s.modeOn(), true, "the same mode, its other face");
  assert.equal(s.face(), "weights");
  assert.deepEqual(s.flipped(), ["A", "B", "C"]);
  assert.equal(s.weightCards().length, 3);
  assert.deepEqual(s.weightCards().map(c => c.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.equal(s.machine.querySelectorAll("[data-role='blend-editor']").length, 0, "no blend card");
  assert.equal(s.weightsSwitch().getAttribute("aria-pressed"), "true");
  assert.equal(s.blendSwitch().getAttribute("aria-pressed"), "false");
  assert.equal(count(s.status.textContent, WEIGHTS_HINT), 1);
  assert.deepEqual(s.calls, []);
  // Every card lists the layer's six hoppers with their resin and a weight field.
  const card = s.weightCards()[0];
  assert.equal(card.querySelectorAll(".station-weight-card__item").length, 6);
  assert.deepEqual(card.querySelectorAll(".station-weight-card__resin").slice(0, 3).map(n => n.textContent), ["HX0", "LD0", "—"]);
  assert.equal(card.querySelectorAll(".station-weight-card__field").length, 6);
  assert.equal(card.querySelectorAll(".station-weight-card__geometry-field").length, 0, "the switch is off: no geometry");
  // The second click is Done.
  s.clickWeights();
  assertModeCleared(s);
});

test("a weight entered on a weight card is one setHopperWeight through the executor; the drawn caption shows it at once and the card the applied value; the mode stays on", () => {
  const s = boot();
  s.clickWeights();
  assert.equal(s.caption("B", 1).text, "—");
  const input = s.enterOnCard("B", "weight", 1, "1250");
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setHopperWeight", { recipe: "current", layer: "B", index: 1, weight: 1250 }]]);
  assert.equal(s.state().layers[1].hoppers[1].weight, 1250);
  assert.equal(s.caption("B", 1).text, "1250");
  assert.equal(s.caption("B", 1).smart, false);
  assert.equal(s.face(), "weights", "the mode is still on");
  assert.equal(s.cardField("B", "weight", 1).value, "1250");
  assert.ok(s.cardField("B", "weight", 1) === input, "a value publish patched the card in place; the field is the same field");
  // A draft the application refuses stays in the field and is said on the card.
  const refusing = boot({ refuse: (command, args) => (command === "setHopperWeight" && Number(args.weight) > 5000 ? "Too heavy." : null) });
  refusing.clickWeights();
  const field = refusing.enterOnCard("A", "weight", 0, "9000");
  assert.equal(field.value, "9000");
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.equal(refusing.weightCards()[0].querySelector(".station-weight-card__note").textContent, "Too heavy.");
  assert.equal(refusing.state().layers[0].hoppers[0].weight, 0);
});

test("the rail's Smart Hoppers switch is one setSmartHoppers: the captions turn to the computed weights, marked; the cards gain the geometry fields and the shared circumference; the switch reads what the application holds; off again reverts everything", () => {
  const s = boot();
  assert.equal(s.smartSwitch().disabled, false, "on an identified line, with the command offered, the switch is live");
  assert.equal(s.smartSwitch().getAttribute("aria-checked"), "false");
  s.clickWeights();
  s.clickSmart();
  assert.deepEqual(s.calls.map(c => [c.command, c.args]), [["setSmartHoppers", { enabled: true }]]);
  assert.equal(s.state().smartHoppers.enabled, true);
  assert.equal(s.smartSwitch().getAttribute("aria-checked"), "true");
  assert.match(s.status.textContent, /^Smart Hoppers on: /);
  // The captions: A1 has a resin and a height -> computed (30 * 40 / 10 = 120); A3 has no resin -> entered (none).
  assert.deepEqual(s.caption("A", 0), { text: "120", smart: true });
  assert.deepEqual(s.caption("A", 2), { text: "—", smart: false });
  // The cards were patched, not rebuilt, and rebuilt their own rows for the new shape.
  assert.equal(s.face(), "weights");
  const card = s.weightCards()[0];
  assert.equal(card.getAttribute("data-shape"), "smart:cylindrical");
  assert.equal(card.querySelectorAll(".station-weight-card__geometry-field").length, 6);
  assert.equal(s.cardField("A", "geometry", 0).value, "30");
  assert.equal(s.cardField("A", "circumference").value, "40");
  assert.equal(card.querySelectorAll(".station-weight-card__computed")[0].textContent, "✓ 120 lb");
  assert.equal(card.querySelectorAll(".station-weight-card__computed")[2].textContent, "no resin");
  // Off again.
  s.clickSmart();
  assert.deepEqual(s.calls[1], { command: "setSmartHoppers", args: { enabled: false }, handbookOpen: false });
  assert.equal(s.smartSwitch().getAttribute("aria-checked"), "false");
  assert.deepEqual(s.caption("A", 0), { text: "—", smart: false });
  assert.equal(s.weightCards()[0].getAttribute("data-shape"), "off");
  assert.equal(s.weightCards()[0].querySelectorAll(".station-weight-card__geometry-field").length, 0);
  assert.match(s.status.textContent, /^Smart Hoppers off: /);
  // The switch works with no face out as well: it is the machine's, not the mode's.
  s.clickWeights();
  assertModeCleared(s);
  s.clickSmart();
  assert.equal(s.state().smartHoppers.enabled, true);
  assert.deepEqual(s.caption("A", 0), { text: "120", smart: true });
  assert.equal(s.modeOn(), false, "the switch enters no mode");
});

test("a height entered on a card is one setHopperGeometry naming the height; the circumference one setHopperCircumference from any card; each moves the computed captions at once", () => {
  const s = boot({ smart: { enabled: true } });
  assert.deepEqual(s.caption("A", 0), { text: "120", smart: true });
  s.clickWeights();
  s.enterOnCard("A", "geometry", 0, "40");
  assert.deepEqual(s.calls[0], { command: "setHopperGeometry", args: { recipe: "current", layer: "A", index: 0, dimension: "height", value: 40 }, handbookOpen: false });
  assert.equal(s.state().layers[0].hoppers[0].usableHeight, 40);
  assert.deepEqual(s.caption("A", 0), { text: "160", smart: true });
  assert.equal(s.face(), "weights", "a height is structural for the stage - the render kept the mode and its cards");
  assert.equal(s.cardField("A", "geometry", 0).value, "40");
  // The circumference, from layer C's card: every layer's computed weight moves.
  s.enterOnCard("C", "circumference", null, "50");
  assert.deepEqual(s.calls[1], { command: "setHopperCircumference", args: { circumference: 50 }, handbookOpen: false });
  assert.deepEqual(s.caption("A", 0), { text: "200", smart: true });
  assert.deepEqual(s.caption("C", 1), { text: "150", smart: true });
  assert.equal(s.cardField("A", "circumference").value, "50", "every card shows the one circumference");
  assert.equal(s.cardField("C", "circumference").value, "50");
});

test("Blend Edit and Weights are one mode with two faces: switching turns every layer over to the other face at once, and Escape leaves whichever is out", () => {
  const s = boot();
  s.enterBlendEdit();
  assert.equal(s.face(), "blend");
  s.clickWeights();
  assert.equal(s.face(), "weights");
  assert.equal(s.weightCards().length, 3);
  assert.equal(s.machine.querySelectorAll("[data-role='blend-editor']").length, 0);
  assert.equal(s.blendSwitch().getAttribute("aria-pressed"), "false");
  assert.equal(s.weightsSwitch().getAttribute("aria-pressed"), "true");
  assert.equal(count(s.status.textContent, WEIGHTS_HINT), 1);
  assert.equal(count(s.status.textContent, HINT), 0, "the other face's hint is gone");
  // A layer turned back by its train, then the other switch: every layer over afresh.
  s.flipLayer("B");
  assert.deepEqual(s.flipped(), ["A", "C"]);
  s.clickBlend();
  assert.equal(s.face(), "blend");
  assert.deepEqual(s.flipped(), ["A", "B", "C"]);
  assert.equal(s.weightCards().length, 0);
  assert.equal(s.cards().length, 3);
  // Escape leaves the Weights face as it leaves Blend Edit.
  s.clickWeights();
  s.escapeOnStage();
  assertModeCleared(s);
  // A draft on a weight card commits along the field's own path when the face is switched.
  s.clickWeights();
  const input = s.cardField("A", "weight", 2);
  input.focus();
  input.value = "700";
  input.dispatchEvent(makeEvent("input", { bubbles: true }));
  s.clickBlend();
  assert.deepEqual(s.calls.map(c => c.command), ["setHopperWeight"]);
  assert.equal(s.state().layers[0].hoppers[2].weight, 700);
  assert.equal(s.face(), "blend");
});

test("off an identified line the Smart Hoppers switch is held and says why; the Weights face still edits the entered weights and carries no geometry", () => {
  const s = boot({ smart: { geometryMode: null, circumference: 0 } });
  assert.equal(s.smartSwitch().disabled, true);
  assert.equal(s.smartSwitch().getAttribute("title"), "Smart Hoppers is not available: Connect this desktop to an identified line to use Smart Hoppers.");
  s.clickSmart();
  assert.deepEqual(s.calls, [], "a held switch dispatches nothing");
  s.clickWeights();
  assert.equal(s.weightCards().length, 3);
  assert.equal(s.weightCards()[0].querySelectorAll(".station-weight-card__geometry-field").length, 0);
  s.enterOnCard("A", "weight", 0, "800");
  assert.equal(s.state().layers[0].hoppers[0].weight, 800);
  assert.deepEqual(s.caption("A", 0), { text: "800", smart: false });
});

test("with no producer the rail's Weights face is read-only and the Smart Hoppers switch held, as every write is", () => {
  const s = boot({ connectCommands: false });
  assert.equal(s.smartSwitch().disabled, true);
  assert.equal(s.smartSwitch().getAttribute("title"), "Smart Hoppers is not available: no application is connected to Station commands.");
  s.clickWeights();
  assert.equal(s.weightCards().length, 3, "the face still shows the weights");
  assert.equal(s.weightCards()[0].getAttribute("data-mode"), "read-only");
  for (const input of s.weightCards()[0].querySelectorAll("input")) assert.equal(input.readOnly, true);
});

test("the Handbook's Weights page is what it was: it lists the hoppers and their weights, and carries no Smart Hoppers switch of its own - the switch is the rail's", () => {
  const s = boot();
  s.launcher.click();
  s.showSection("weights");
  const page = s.panel.querySelector("[data-section='weights'][role='tabpanel']") || s.panel;
  assert.ok(page.querySelectorAll(".station-weights__field").length >= 18, "the page lists every hopper's weight");
  assert.equal(page.querySelectorAll(".station-weights__switch").length, 0);
  assert.equal(page.querySelectorAll("[data-action='smart-toggle']").length, 0);
  assert.equal(page.querySelectorAll(".station-weights__geometry-field").length, 0);
  // And the rail's switch still works with the Handbook open.
  s.clickSmart();
  assert.equal(s.state().smartHoppers.enabled, true);
  assert.equal(s.calls[0].handbookOpen, true);
});
