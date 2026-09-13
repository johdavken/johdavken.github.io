"use strict";

/* Copy / Paste / Reset on the Blend Edit cards and Bulk Edit on the
 * machine rail, booted for real: station.js run under a fake DOM with
 * every module the host loads, the state bridge connected to a fake
 * application and the command bridge to an executor that applies the
 * three layer commands to that state and answers as app.js answers. What
 * the tests drive is the drawn stage, the cards' menus and the rail's own
 * controls - the same elements an operator clicks. The harness is the
 * one station-blend-edit-exit.test.js boots with, its executor extended
 * for copyLayer, clearLayer and setHopperResins.
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
      else if (command === "copyLayer" && layerOf(args.layer) && layerOf(args.toLayer)) {
        // The application's own paste: resin and blend, resin only into a
        // 3-layer line's core; the same layer twice is a no-op.
        if (args.layer === args.toLayer) return contract.success({ changed: false, revision: stateBridge.getRevision(), persisted: false, snapshot: stateBridge.getSnapshot() });
        const resinOnly = snap.layers.length === 3 && args.toLayer === "B";
        layerOf(args.toLayer).hoppers.forEach((h, i) => {
          h.resinName = layerOf(args.layer).hoppers[i].resinName;
          if (!resinOnly) h.pct = layerOf(args.layer).hoppers[i].pct;
        });
      } else if (command === "clearLayer" && layerOf(args.layer)) {
        const empty = layerOf(args.layer).hoppers.every((h, i) => !h.resinName && (i === 0 || h.pct === 0) && !h.track && !h.pumpOff);
        if (empty) return contract.success({ changed: false, revision: stateBridge.getRevision(), persisted: false, snapshot: stateBridge.getSnapshot() });
        for (const h of layerOf(args.layer).hoppers) { h.resinName = ""; h.pct = 0; h.track = false; h.pumpOff = false; }
      } else if (command === "setHopperResins") {
        let changed = false;
        for (const entry of args.resins) {
          const h = layerOf(entry.layer) && layerOf(entry.layer).hoppers[entry.index];
          if (!h) return contract.failure("unknown_layer");
          if (h.resinName !== entry.resin) { h.resinName = entry.resin; changed = true; }
        }
        if (!changed) return contract.success({ changed: false, revision: stateBridge.getRevision(), persisted: false, snapshot: stateBridge.getSnapshot() });
      }
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
    capabilities: Array.isArray(settings.capabilities) ? settings.capabilities : [...contract.COMMANDS]
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
    /* The application's state, as the executor holds it, and a publish
     * of it from elsewhere - another device's change arriving. */
    state: () => snap,
    /* The bridge notifies on a microtask: the publish is awaited. */
    publish: async () => { snap.revision += 1; handle.publish(); await new Promise(resolve => setTimeout(resolve, 0)); },
    /* The layer menu on a card: its button, its items, opened by the
     * same click an operator makes. */
    menu: layer => machine.querySelectorAll("[data-role='layer-menu']").find(n => n.getAttribute("data-layer") === layer) || null,
    openMenu(layer) {
      const menu = api.menu(layer);
      assert.ok(menu, `layer ${layer} has a menu`);
      menu.querySelector("[data-action='layer-menu']").click();
      assert.equal(menu.getAttribute("data-open"), "true", `layer ${layer}'s menu opened`);
      return menu;
    },
    menuItem: (layer, action) => api.menu(layer).querySelector(`[data-action='${action}']`),
    choose(layer, action) { const item = api.openMenu(layer).querySelector(`[data-action='${action}']`); assert.ok(item, `no ${action} on layer ${layer}`); item.click(); return item; },
    /* The rail's Bulk Edit and what it becomes. */
    bulkControl: () => rail.querySelector("[data-action='bulk-edit']"),
    confirmControl: () => rail.querySelector("[data-action='bulk-confirm']"),
    cancelControl: () => rail.querySelector("[data-action='bulk-cancel']"),
    /* The bulk field, stood by the rail above its Blend row. */
    resinField: () => rail.querySelector("[data-role='bulk-resin']"),
    resinInput: () => rail.querySelector("[data-action='bulk-resin']"),
    fieldShown: () => { const f = rail.querySelector("[data-role='bulk-resin']"); return !!f && !f.hasAttribute("hidden") && !f.closest("[data-role='bulk-field-slot']").hasAttribute("hidden"); },
    /* The badge on a card's row, and its click. */
    badge: (layer, index) => {
      const card = api.cards().find(c => c.getAttribute("data-layer") === layer);
      assert.ok(card, `layer ${layer} has a card`);
      const row = card.querySelectorAll(".station-editor__item").find(r => r.getAttribute("data-hopper-index") === String(index));
      return row ? row.querySelector(".station-editor__badge") : null;
    },
    hopperOf: (layer, index) => layerOf(layer).hoppers[index],
    cardText: layer => (api.cards().find(c => c.getAttribute("data-layer") === layer) || { textContent: "" }).textContent,
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


const count = (text, needle) => text.split(needle).length - 1;
const layerCalls = s => s.calls.filter(c => ["copyLayer", "clearLayer", "setHopperResins"].includes(c.command));

/* ----------------------------------------------------------------------
 *   Copy / Paste / Reset from a card's menu
 * -------------------------------------------------------------------- */

test("every blend card carries a layer menu at its foot, closed, with Copy and Reset offered and Paste held until a layer is copied; nothing is dispatched by opening one", () => {
  const s = boot();
  s.enterBlendEdit();
  assert.deepEqual(s.cards().map(c => !!c.querySelector("[data-role='layer-menu']")), [true, true, true]);
  for (const layer of ["A", "B", "C"]) {
    const menu = s.menu(layer);
    assert.equal(menu.getAttribute("data-open"), "false");
    assert.ok(menu.parent.classList.contains("station-editor__actions"), "in the card's actions slot");
  }
  s.openMenu("A");
  assert.equal(s.menuItem("A", "copy-layer").disabled, false);
  assert.equal(s.menuItem("A", "paste-layer").disabled, true);
  assert.match(s.menuItem("A", "paste-layer").getAttribute("title"), /copy a layer first/);
  assert.equal(s.menuItem("A", "reset-layer").disabled, false);
  assert.deepEqual(layerCalls(s), []);
  // The weights face has no menu: the weight cards are not blend cards.
  s.clickWeights();
  assert.equal(s.machine.querySelectorAll("[data-role='layer-menu']").length, 0);
});

test("Copy on A arms it - its card wears the source ring, its item reads Cancel copy, every other card offers Paste from Layer A - and Paste on C is one copyLayer through the executor; the paste disarms", () => {
  const s = boot();
  s.enterBlendEdit();
  s.choose("A", "copy-layer");
  assert.deepEqual(layerCalls(s), [], "arming dispatches nothing");
  assert.equal(s.menu("A").getAttribute("data-open"), "false", "the choice closed the menu");
  const cardA = s.cards().find(c => c.getAttribute("data-layer") === "A");
  assert.ok(cardA.querySelector(".station-editor").classList.contains("is-copy-source"));
  assert.equal(s.menuItem("A", "copy-layer").textContent, "Cancel copy");
  assert.equal(s.menuItem("C", "paste-layer").textContent, "Paste from Layer A");
  assert.equal(s.menuItem("C", "paste-layer").disabled, false);
  assert.equal(s.menuItem("B", "paste-layer").disabled, false);
  assert.match(s.menuItem("B", "paste-layer").getAttribute("title"), /core layer keeps its own percentages/);
  assert.match(s.status.textContent, /Layer A copied/);

  s.choose("C", "paste-layer");
  assert.deepEqual(layerCalls(s), [{ command: "copyLayer", args: { recipe: "current", layer: "A", toLayer: "C" }, handbookOpen: false }]);
  assert.equal(s.hopperOf("C", 0).resinName, "HX0");
  assert.equal(s.hopperOf("C", 1).resinName, "LD0");
  // The stage shows the application's answer on every card, and the
  // arming is spent: no ring, Copy again, Paste held.
  assert.match(s.cardText("C"), /HX0/);
  assert.ok(!cardA.querySelector(".station-editor").classList.contains("is-copy-source"));
  assert.equal(s.menuItem("A", "copy-layer").textContent, "Copy layer");
  assert.equal(s.menuItem("C", "paste-layer").disabled, true);
  assert.match(s.status.textContent, /Pasted Layer A onto Layer C/);
  assert.equal(s.modeOn(), true, "the mode stays on");
  assert.deepEqual(s.flipped(), ["A", "B", "C"]);
});

test("Cancel copy disarms without dispatching; the mode's exit and a face change disarm too", () => {
  const s = boot();
  s.enterBlendEdit();
  s.choose("B", "copy-layer");
  s.choose("B", "copy-layer");
  assert.deepEqual(layerCalls(s), []);
  assert.equal(s.menuItem("B", "copy-layer").textContent, "Copy layer");
  assert.equal(s.menuItem("A", "paste-layer").disabled, true);
  assert.match(s.status.textContent, /Copying Layer B cancelled/);
  // Armed, then the mode left and entered again: nothing armed.
  s.choose("B", "copy-layer");
  s.clickBlend();
  assert.equal(s.modeOn(), false);
  s.enterBlendEdit();
  assert.equal(s.menuItem("A", "paste-layer").disabled, true);
  assert.equal(s.machine.querySelectorAll(".is-copy-source").length, 0);
  // Armed on the blend face; the Next face is a different recipe under
  // the same names, and inherits no arming.
  s.choose("B", "copy-layer");
  s.rail.querySelector("[data-action='next-edit']").click();
  assert.equal(s.face(), "next");
  assert.equal(s.menuItem("A", "paste-layer").disabled, true);
  assert.equal(s.menu("B").classList.contains("is-source"), false);
  assert.deepEqual(layerCalls(s), []);
});

test("on the Next face, Paste addresses the plan: one copyLayer naming next, the running recipe untouched", () => {
  const s = boot();
  s.rail.querySelector("[data-action='next-edit']").click();
  assert.equal(s.face(), "next");
  s.choose("A", "copy-layer");
  s.choose("C", "paste-layer");
  assert.deepEqual(layerCalls(s).map(c => c.args), [{ recipe: "next", layer: "A", toLayer: "C" }]);
  assert.match(s.status.textContent, /in the plan/);
});

test("Reset is armed by the first click and confirmed by the second: one clearLayer through the executor, the card emptied, the status line saying so", () => {
  const s = boot();
  s.enterBlendEdit();
  s.hopperOf("B", 0).track = true;
  s.openMenu("B");
  const item = s.menuItem("B", "reset-layer");
  item.click();
  assert.deepEqual(layerCalls(s), [], "the first click arms");
  assert.equal(item.textContent, "Confirm reset");
  assert.equal(item.getAttribute("data-armed"), "true");
  assert.equal(s.menu("B").getAttribute("data-open"), "true", "the menu stays open, waiting");
  item.click();
  assert.deepEqual(layerCalls(s), [{ command: "clearLayer", args: { recipe: "current", layer: "B" }, handbookOpen: false }]);
  assert.equal(s.menu("B").getAttribute("data-open"), "false");
  for (const h of s.state().layers[1].hoppers) assert.deepEqual([h.resinName, h.pct, h.track], ["", 0, false]);
  assert.equal(s.hopperOf("A", 0).resinName, "HX0", "other layers untouched");
  assert.doesNotMatch(s.cardText("B"), /HX1|LD1/);
  assert.match(s.cardText("B"), /—/, "an empty layer's total reads as empty");
  assert.match(s.status.textContent, /Layer B reset/);
  assert.equal(s.modeOn(), true);
});

test("an armed reset that is not confirmed resets nothing: Escape in the menu disarms and closes it, and so does the arm's own timeout", () => {
  const s = boot();
  s.enterBlendEdit();
  s.openMenu("A");
  s.menuItem("A", "reset-layer").click();
  assert.equal(s.menuItem("A", "reset-layer").textContent, "Confirm reset");
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  s.menuItem("A", "reset-layer").dispatchEvent(escape);
  assert.equal(escape.stopped, true, "spent on the menu");
  assert.equal(s.menu("A").getAttribute("data-open"), "false");
  assert.equal(s.menuItem("A", "reset-layer").textContent, "Reset layer");
  assert.equal(s.modeOn(), true, "the stage's Escape did not run: the mode stays on");
  s.openMenu("A");
  s.menuItem("A", "reset-layer").click();
  const arm = s.timers.filter(t => t.ms === 5000).pop();
  assert.ok(arm, "the arm timer is set");
  arm.fn();
  assert.equal(s.menuItem("A", "reset-layer").textContent, "Reset layer");
  assert.deepEqual(layerCalls(s), []);
  assert.equal(s.hopperOf("A", 0).resinName, "HX0");
});

test("a refusal from the application is said on the card's own note, and nothing changes on the stage", () => {
  const s = boot({ refuse: command => (command === "copyLayer" ? "Hoppers are being rearranged; finish or cancel that first." : null) });
  s.enterBlendEdit();
  s.choose("A", "copy-layer");
  s.choose("C", "paste-layer");
  assert.equal(layerCalls(s).length, 1);
  const cardC = s.cards().find(c => c.getAttribute("data-layer") === "C");
  assert.match(cardC.querySelector(".station-editor__note").textContent, /being rearranged/);
  assert.equal(s.hopperOf("C", 0).resinName, "HX2");
  assert.equal(s.menuItem("C", "paste-layer").disabled, true, "one paste per copy, whatever the answer");
});

test("with the commands not on offer the menu's items are held and say why, and nothing arms; without a producer every one is held", () => {
  const partial = boot({ capabilities: ["setHopperResin", "setHopperBlend", "clearLayer"] });
  partial.enterBlendEdit();
  partial.openMenu("A");
  assert.equal(partial.menuItem("A", "copy-layer").disabled, true);
  assert.match(partial.menuItem("A", "copy-layer").getAttribute("title"), /does not offer pasting a layer/);
  assert.equal(partial.menuItem("A", "reset-layer").disabled, false);
  partial.menuItem("A", "copy-layer").click();
  assert.equal(partial.machine.querySelectorAll(".is-copy-source").length, 0);
  const none = boot({ connectCommands: false });
  none.enterBlendEdit();
  none.openMenu("A");
  for (const action of ["copy-layer", "paste-layer", "reset-layer"]) assert.equal(none.menuItem("A", action).disabled, true, action);
  assert.match(none.menuItem("A", "reset-layer").getAttribute("title"), /no application is connected/);
});

/* ----------------------------------------------------------------------
 *   Bulk Edit from the rail
 * -------------------------------------------------------------------- */

test("Bulk Edit unfolds beside Blend Edit while the blend face is on; its click turns every badge into a selection toggle and swaps the control for Confirm / Cancel; nothing is dispatched", () => {
  const s = boot();
  const group = s.rail.querySelector("[data-role='blend-group']");
  assert.equal(group.getAttribute("data-open"), "false");
  s.enterBlendEdit();
  assert.equal(group.getAttribute("data-open"), "true");
  assert.equal(s.bulkControl().disabled, false);
  assert.ok(s.confirmControl().hasAttribute("hidden") && s.cancelControl().hasAttribute("hidden"));
  assert.equal(s.fieldShown(), false, "no field before the selection starts");
  assert.ok(s.resinField() && s.resinField().closest("[data-role='blend-group']"), "the field stands in the rail's Blend group, above the row");
  assert.equal(s.machine.querySelectorAll("[data-role='bulk-resin']").length, 0, "and not on the cards");
  assert.equal(s.badge("A", 1).tagName, "SPAN");
  s.bulkControl().click();
  assert.equal(group.getAttribute("data-bulk"), "true");
  assert.ok(s.bulkControl().hasAttribute("hidden"));
  assert.equal(s.confirmControl().hasAttribute("hidden"), false);
  assert.equal(s.cancelControl().hasAttribute("hidden"), false);
  assert.equal(s.fieldShown(), true, "the field shows with the selection, above the row");
  assert.equal(s.resinInput().getAttribute("aria-label"), "Resin for selected hoppers");
  assert.ok(s.doc.activeElement !== s.resinInput(), "nothing selected yet: the field waits, the badges are next");
  assert.equal(s.confirmControl().disabled, true);
  assert.equal(s.badge("A", 1).tagName, "BUTTON");
  assert.equal(s.badge("C", 5).getAttribute("aria-pressed"), "false");
  assert.match(s.status.textContent, /Bulk Edit: click hopper badges/);
  assert.deepEqual(layerCalls(s), []);
  assert.equal(s.modeOn(), true);
  assert.deepEqual(s.flipped(), ["A", "B", "C"]);
});

test("selecting badges on two layers shows the resin field with the count; Confirm with a resin is ONE setHopperResins over the selection, the cards show the applied value, the selection ends", () => {
  const s = boot();
  s.enterBlendEdit();
  s.bulkControl().click();
  s.badge("A", 2).click();
  assert.equal(s.badge("A", 2).getAttribute("aria-pressed"), "true");
  assert.equal(s.fieldShown(), true);
  assert.ok(s.doc.activeElement === s.resinInput(), "the first hopper selected: the field takes the focus, the next thing is to type");
  assert.equal(s.resinInput().getAttribute("aria-label"), "Resin for 1 hopper");
  s.resinInput().value = "EVA";
  s.resinInput().dispatchEvent(makeEvent("input", { bubbles: true }));
  s.badge("C", 3).click();
  assert.equal(s.resinInput().value, "EVA", "the draft stays as the selection grows");
  s.badge("C", 4).click();
  s.badge("C", 4).click();
  assert.equal(s.badge("C", 4).getAttribute("aria-pressed"), "false", "a second click deselects");
  assert.equal(s.resinInput().getAttribute("aria-label"), "Resin for 2 hoppers");
  assert.equal(s.rail.querySelectorAll("input").length, 1, "one field, on the rail");
  s.resinInput().value = "";
  s.resinInput().dispatchEvent(makeEvent("input", { bubbles: true }));
  assert.equal(s.confirmControl().disabled, true, "no resin yet");
  s.resinInput().value = "EVA340";
  s.resinInput().dispatchEvent(makeEvent("input", { bubbles: true }));
  assert.equal(s.confirmControl().disabled, false);
  s.confirmControl().click();
  assert.deepEqual(layerCalls(s), [{ command: "setHopperResins", args: { recipe: "current", resins: [
    { layer: "A", index: 2, resin: "EVA340" }, { layer: "C", index: 3, resin: "EVA340" }
  ] }, handbookOpen: false }]);
  assert.equal(s.hopperOf("A", 2).resinName, "EVA340");
  assert.equal(s.hopperOf("C", 3).resinName, "EVA340");
  assert.equal(s.hopperOf("A", 1).resinName, "LD0", "unselected hoppers untouched");
  assert.match(s.cardText("A"), /EVA340/);
  assert.match(s.cardText("C"), /EVA340/);
  assert.match(s.status.textContent, /Applied EVA340 to 2 hoppers/);
  // The selection ended: Bulk Edit is back, the badges are spans, the
  // field is empty for the next time.
  assert.equal(s.rail.querySelector("[data-role='blend-group']").getAttribute("data-bulk"), "false");
  assert.equal(s.bulkControl().hasAttribute("hidden"), false);
  assert.equal(s.badge("A", 2).tagName, "SPAN");
  assert.equal(s.fieldShown(), false, "the field hides with the selection");
  assert.equal(s.modeOn(), true);
  // The next selection starts with an empty draft.
  s.bulkControl().click();
  assert.equal(s.resinInput().value, "");
  s.badge("B", 1).click();
  assert.equal(s.resinInput().value, "");
});

test("Enter in the field confirms; Cancel, Escape in the field, and Escape on the stage end the selection without writing - and only the next Escape leaves the mode", () => {
  const s = boot();
  s.enterBlendEdit();
  s.bulkControl().click();
  s.badge("B", 1).click();
  s.resinInput().value = "HX9";
  s.resinInput().dispatchEvent(makeEvent("input", { bubbles: true }));
  s.resinInput().dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(layerCalls(s).length, 1);
  assert.equal(s.hopperOf("B", 1).resinName, "HX9");

  s.bulkControl().click();
  s.badge("B", 2).click();
  s.badge("B", 2).click();
  assert.equal(s.fieldShown(), true, "deselecting the last hopper keeps the field: the selection is still on");
  assert.equal(s.resinInput().getAttribute("aria-label"), "Resin for selected hoppers");
  s.badge("B", 2).click();
  s.cancelControl().click();
  assert.equal(layerCalls(s).length, 1, "Cancel writes nothing");
  assert.equal(s.badge("B", 2).tagName, "SPAN");
  assert.equal(s.fieldShown(), false);
  assert.match(s.status.textContent, /Bulk Edit cancelled/);

  s.bulkControl().click();
  s.badge("B", 2).click();
  s.resinInput().dispatchEvent(makeEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(s.badge("B", 2).tagName, "SPAN", "Escape in the field cancels");
  assert.equal(s.modeOn(), true, "and leaves the mode on: the key was spent on the field");

  s.bulkControl().click();
  s.badge("A", 2).click();
  s.escapeOnStage();
  assert.equal(s.badge("A", 2).tagName, "SPAN", "Escape on the stage cancels the selection first");
  assert.equal(s.modeOn(), true);
  s.escapeOnStage();
  assert.equal(s.modeOn(), false, "the next Escape leaves the mode");
  assert.equal(layerCalls(s).length, 1);
});

test("the mode's exit and a face change end a selection in progress; Bulk Edit is the two recipe faces' - absent under Weights, and under Next it is the same row moved to the Next bracket", () => {
  const s = boot();
  s.enterBlendEdit();
  s.bulkControl().click();
  s.badge("A", 1).click();
  s.clickBlend();
  assert.equal(s.modeOn(), false);
  assert.equal(s.rail.querySelector("[data-role='blend-group']").getAttribute("data-bulk"), "false");
  s.enterBlendEdit();
  assert.equal(s.badge("A", 1).tagName, "SPAN", "nothing selected carries across");
  s.bulkControl().click();
  s.badge("A", 1).click();
  s.clickWeights();
  assert.equal(s.face(), "weights");
  assert.equal(s.rail.querySelector("[data-role='blend-group']").getAttribute("data-open"), "false");
  assert.equal(s.rail.querySelector("[data-role='blend-group']").getAttribute("data-bulk"), "false");
  s.rail.querySelector("[data-action='next-edit']").click();
  assert.equal(s.face(), "next");
  assert.equal(s.rail.querySelector("[data-role='blend-group']").getAttribute("data-open"), "false");
  assert.equal(s.badge("A", 1).tagName, "SPAN", "the Next face's badges are not toggles until Bulk Edit is asked");
  assert.ok(s.bulkControl().closest("[data-role='next-group']"), "the bulk row stands in the Next group");
  assert.equal(s.rail.querySelector("[data-role='next-group']").getAttribute("data-bulk"), "false");
  assert.deepEqual(layerCalls(s), []);
});

test("on the Next face Bulk Edit is the same row on the Next bracket: the selection is on the plan's cards, Confirm is ONE setHopperResins naming next, the running recipe untouched", () => {
  const s = boot();
  s.rail.querySelector("[data-action='next-edit']").click();
  assert.equal(s.face(), "next");
  const nextGroup = s.rail.querySelector("[data-role='next-group']");
  const flyout = nextGroup.querySelector(".station-rail__flyout");
  assert.deepEqual(flyout.children.map(n => n.getAttribute("data-role")), ["bulk-row", "moves-row"], "the bulk row above the two moves");
  assert.equal(s.bulkControl().disabled, false);
  assert.match(s.bulkControl().getAttribute("title"), /in the plan$/);
  s.bulkControl().click();
  assert.equal(nextGroup.getAttribute("data-bulk"), "true");
  assert.match(s.status.textContent, /the plan is what changes/);
  assert.equal(s.badge("A", 1).tagName, "BUTTON", "the plan's badges are toggles");
  s.badge("A", 2).click();
  s.badge("B", 1).click();
  assert.equal(s.fieldShown(), true);
  assert.ok(s.resinField().closest("[data-role='next-group']"), "the field stands over the Next group's bulk row");
  s.resinInput().value = "PP77";
  s.resinInput().dispatchEvent(makeEvent("input", { bubbles: true }));
  s.confirmControl().click();
  assert.deepEqual(layerCalls(s), [{ command: "setHopperResins", args: { recipe: "next", resins: [
    { layer: "A", index: 2, resin: "PP77" }, { layer: "B", index: 1, resin: "PP77" }
  ] }, handbookOpen: false }]);
  // (The harness's executor writes wherever it is told; what the
  // application does with `recipe: "next"` is its own - the boot file's
  // part is to name the plan, which the call above pins.)
  assert.match(s.status.textContent, /Applied PP77 to 2 hoppers in the plan/);
  assert.equal(nextGroup.getAttribute("data-bulk"), "false");
  assert.equal(s.badge("A", 2).tagName, "SPAN");
  // Back to the Blend face: the row goes with it, and the write is to the
  // running recipe again.
  s.enterBlendEdit();
  assert.ok(s.bulkControl().closest("[data-role='blend-group']"));
  assert.deepEqual(flyout.children.map(n => n.getAttribute("data-role")), ["moves-row"]);
});

test("a selection survives a structural publish from elsewhere: the rebuilt cards keep the selected badges pressed, and a value publish rebuilds nothing", async () => {
  const s = boot();
  s.enterBlendEdit();
  s.bulkControl().click();
  s.badge("A", 1).click();
  s.badge("C", 0).click();
  s.resinInput().value = "HX";
  s.resinInput().dispatchEvent(makeEvent("input", { bubbles: true }));
  const badgeA = s.badge("A", 1);
  // A value change from another device: the cards are patched in place.
  s.state().layers[1].hoppers[1].pct = 35;
  await s.publish();
  const cardB = s.cards().find(c => c.getAttribute("data-layer") === "B");
  const pctB2 = cardB.querySelectorAll("input").find(i => /blend percentage/.test(i.getAttribute("aria-label") || "") && i.closest("[data-hopper-index]").getAttribute("data-hopper-index") === "1");
  assert.equal(pctB2.value, "35", "the value landed on the card");
  assert.ok(badgeA === s.badge("A", 1), "a value publish rebuilds no card");
  assert.equal(s.badge("A", 1).getAttribute("aria-pressed"), "true");
  assert.equal(s.resinInput().value, "HX");
  // A structural change - a hopper's usable height, which the drawing
  // is sized from - rebuilds the stage.
  s.state().layers[0].hoppers[0].usableHeight = 36;
  await s.publish();
  assert.ok(badgeA !== s.badge("A", 1), "a structural publish rebuilt the cards");
  assert.equal(s.badge("A", 1).tagName, "BUTTON");
  assert.equal(s.badge("A", 1).getAttribute("aria-pressed"), "true");
  assert.equal(s.badge("C", 0).getAttribute("aria-pressed"), "true");
  assert.equal(s.badge("B", 2).getAttribute("aria-pressed"), "false");
  assert.equal(s.resinInput().getAttribute("aria-label"), "Resin for 2 hoppers");
  assert.equal(s.fieldShown(), true);
  assert.equal(s.resinInput().value, "HX", "the draft survives the rebuild");
  assert.equal(s.rail.querySelector("[data-role='blend-group']").getAttribute("data-bulk"), "true");
  // And the toggles still answer on the rebuilt cards.
  s.badge("B", 3).click();
  assert.equal(s.resinInput().getAttribute("aria-label"), "Resin for 3 hoppers");
  // A menu open through a structural render is closed with the card it
  // stood in: its click-away listener does not outlive it.
  s.openMenu("B");
  const listeners = () => (s.doc.listeners.pointerdown || []).length;
  const before = listeners();
  s.state().layers[1].hoppers[0].usableHeight = 28;
  await s.publish();
  assert.ok(listeners() < before, "the discarded menu's document listener was taken down");
  assert.equal(s.menu("B").getAttribute("data-open"), "false", "the rebuilt menu starts closed");
  // An armed copy source survives the same way.
  s.cancelControl().click();
  s.choose("A", "copy-layer");
  s.state().layers[2].hoppers[0].usableHeight = 24;
  await s.publish();
  assert.equal(s.menuItem("C", "paste-layer").textContent, "Paste from Layer A");
  assert.equal(s.machine.querySelectorAll(".is-copy-source").length, 1);
});

test("with the command not on offer Bulk Edit is held and says why; with no producer it is held with the rest of the rail", () => {
  const partial = boot({ capabilities: ["setHopperResin", "copyLayer", "clearLayer"] });
  partial.enterBlendEdit();
  assert.equal(partial.bulkControl().disabled, true);
  assert.match(partial.bulkControl().getAttribute("title"), /does not offer bulk resin editing/);
  partial.bulkControl().click();
  assert.equal(partial.badge("A", 1).tagName, "SPAN");
  const none = boot({ connectCommands: false });
  none.enterBlendEdit();
  assert.equal(none.bulkControl().disabled, true);
  assert.match(none.bulkControl().getAttribute("title"), /no application is connected/);
});

test("the boot file routes every layer action through the blend actions' seam, disarms after a paste whatever the answer, and clears both the arming and the selection on every exit", () => {
  const boot = read("station/station.js");
  const between = (from, to) => boot.slice(boot.indexOf(from), boot.indexOf(to, boot.indexOf(from)));
  const paste = between("function pasteLayer(id) {", "\n  }\n");
  assert.ok(paste.indexOf("clearLayerCopy();") < paste.indexOf("if (!result || !result.ok)"), "the paste disarms before it reads the answer");
  assert.match(paste, /if \(layerCopy\.recipe !== recipe \|\| from === id\) return null;/, "a source armed on another face never crosses recipes");
  for (const name of ["enterBlendEdit", "exitBlendEdit"]) {
    const fn = between(`function ${name}(`, "\n  }\n");
    assert.match(fn, /clearLayerCopy\(\);\s+endBulk\(\);/, `${name} clears the arming and the selection`);
  }
  const confirm = between("function confirmBulk() {", "\n  }\n");
  assert.match(confirm, /const recipe = bulkRecipe\(\);\s+const result = blendActions\.applyResins\(commandsFor\(current\.resolved\), recipe, keys, value\)/, "Bulk Edit addresses the face's recipe");
  assert.match(boot, /function bulkRecipe\(\) \{\s+return modeIs\("next"\) \? "next" : "current";/);
  assert.doesNotMatch(boot, /commands\.dispatch\(\s*"(copyLayer|clearLayer|setHopperResins)"/, "no direct dispatch of a layer command");
});
