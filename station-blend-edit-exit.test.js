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
 * station.js is a self-starting file over a browser document, so it is
 * run here for real: every module the production host loads, in the
 * host's own order, evaluated into one context over a small fake DOM,
 * with the state and command bridges connected the way app.js connects
 * them. What the tests then drive is the drawn stage and the Handbook's
 * own buttons - the same elements an operator clicks.
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
  const context = vm.createContext(window);
  for (const file of SHARED.concat(hostScripts())) new vm.Script(read(file), { filename: file }).runInContext(context);

  // The bridges, connected as app.js connects them: a snapshot to read,
  // an executor that answers every command and records it.
  const snap = snapshot();
  const contract = window.PolynStationCommandContract;
  const calls = [];
  window.PolynStationStateBridge.connect({ read: () => snap });
  window.PolynStationCommandBridge.connect({
    execute(command, args) {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)), handbookOpen: isHandbookOpen() });
      return contract.success({ changed: true, revision: 2, snapshot: snap });
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
  assert.equal(s.machine.contains(s.doc.activeElement), false, "nothing on the stage keeps the focus");
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
