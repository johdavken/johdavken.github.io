"use strict";

/* The Winding Tension calculator (station/station-winding-tension.js):
 * the rail's Tools row's one tool, opened out of its tile into a utility
 * surface.
 *
 * Two layers of test, as the Changeover Calculator has. The component
 * alone, against the boot tests' fake DOM and a recorded animate(): what
 * it shows before an entry, how the entries become the application's own
 * answer, what a blank or refused entry does, the range's sweep, the
 * flight and reduced motion. Then Station booted for real - every module
 * the host loads, in the host's order - to drive the rail's Tools switch,
 * the tile, the surface it opens, the Changeover Calculator it shares a
 * band with and the Handbook beside them.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const surfaceModule = require("./station/station-winding-tension.js");
const railModule = require("./station/station-machine-rail.js");
const calc = require("./winding-tension.js");

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

/* ----------------------------------------------------------------------
 *   The component alone
 * -------------------------------------------------------------------- */

function build(options) {
  focused = null;
  const doc = fakeDocument();
  const animations = [];
  const anchor = doc.createElement("button");
  anchor.rect = { left: 16, top: 700, width: 64, height: 64 };
  const opened = [];
  const settings = Object.assign({
    anchor,
    animate: (element, keyframes, opts) => { const animation = fakeAnimation(element, keyframes, opts); animations.push(animation); return animation; },
    measure: element => element.rect,
    reducedMotion: () => !!(options && options.reducedMotion),
    onOpenChange: open => opened.push(open)
  }, (options && options.settings) || {});
  const panel = surfaceModule.create(doc, settings);
  assert.ok(panel, "the calculator built");
  panel.panel.rect = { left: 16, top: 12, width: 560, height: 380 };
  const q = selector => panel.element.querySelector(selector);
  return {
    doc, animations, anchor, panel, q, opened,
    field: name => q(`.station-winding__form input[data-field='${name}']`),
    chip: value => panel.element.querySelectorAll("[data-field='ups'][data-value]").find(n => n.getAttribute("data-value") === String(value)),
    readout: () => q(".station-window__readout"),
    result: () => q("[data-role='result']"),
    target: () => q("[data-role='target']"),
    pli: () => q("[data-role='pli']"),
    end: key => q(`[data-role='${key}'] .station-winding__end-value`),
    kind: key => q(`[data-kind='${key}']`),
    words: role => q(`[data-role='${role}']`),
    wedge: () => q(".station-winding__pict-wedge"),
    note: () => q(".station-winding__note"),
    sweeps: () => animations.filter(a => a.element !== panel.panel && a.element !== q(".station-window__body"))
  };
}

function enter(h, thickness, width, ups) {
  if (thickness !== undefined) input(h.field("thickness"), thickness);
  if (width !== undefined) input(h.field("width"), width);
  if (ups !== undefined) h.chip(ups).click();
}

test("closed by construction: the panel is hidden, a region on the glass, no dialog; no entry, one up, no answer, the application's own notice; the tile says it is closed", () => {
  const h = build();
  assert.ok(hidden(h.panel.panel));
  assert.equal(h.panel.panel.getAttribute("role"), "region");
  assert.equal(h.panel.panel.getAttribute("aria-label"), "Winding Tension");
  assert.ok(h.panel.panel.classList.contains("station-glass"));
  assert.equal(h.panel.element.querySelector("dialog"), null);
  assert.equal(h.panel.isOpen(), false);
  assert.deepEqual(h.panel.entries(), { thickness: "", width: "", ups: 1 });
  assert.equal(h.panel.result(), null);
  assert.equal(h.chip(1).getAttribute("aria-checked"), "true");
  assert.equal(h.chip(2).getAttribute("aria-checked"), "false");
  assert.equal(h.panel.element.querySelectorAll("[data-field='ups'][data-value]").length, surfaceModule.UPS_MAX);
  assert.equal(h.result().getAttribute("data-live"), "false");
  assert.equal(h.target().textContent, "—");
  assert.equal(h.readout().textContent, "Enter film thickness and roll width");
  assert.ok(h.readout().classList.contains("is-unset"));
  assert.equal(h.q("[data-role='notice']").textContent, calc.NOTICE);
  assert.equal(surfaceModule.NOTICE, calc.NOTICE);
  assert.equal(h.anchor.getAttribute("aria-expanded"), "false");
  // The frame is a Station window: the panel, bar, readout and body are
  // the window's classes; the controls inside are the Handbook's
  // vocabulary; Close is the window's round button at the title bar's
  // right, named for assistive tech and wordless on the glass.
  assert.ok(h.panel.panel.classList.contains("station-window__panel"));
  assert.ok(h.panel.panel.classList.contains("station-winding__panel"), "the owner's class, for its size");
  assert.equal(h.panel.element.getAttribute("data-window"), "winding");
  assert.equal(h.panel.element.getAttribute("data-role"), "winding-tension");
  assert.ok(h.panel.window && h.panel.window.body === h.q(".station-window__body"));
  const close = h.q("[data-action='close-winding']");
  assert.ok(!close.classList.contains("station-handbook__close"));
  assert.ok(close.classList.contains("station-window__close"));
  assert.equal(close.getAttribute("aria-label"), "Close");
  assert.equal(close.textContent, "");
  const bar = h.q("[data-role='title-bar']");
  assert.ok(bar.classList.contains("station-window__bar"));
  assert.ok(bar.children[bar.children.length - 1] === close, "Close stands last on the bar, at its right");
  assert.equal(bar.children[0].textContent, "Winding Tension");
  assert.equal(bar.getAttribute("tabindex"), "0");
  assert.match(bar.getAttribute("aria-label"), /arrow keys/);
  assert.ok(h.chip(1).classList.contains("station-handbook__chip"));
  assert.equal(h.chip(1).getAttribute("role"), "radio");
});

test("the answer follows the entries live, through the application's own arithmetic: the figure, the PLI, the three readings, the wind kinds lit by the band, the taper drawn from its words; the ups scale it", () => {
  const h = build();
  enter(h, "2.3", "106");
  const expected = calc.calculate({ filmThicknessMil: "2.3", rollWidthIn: "106", ups: 1 });
  assert.deepEqual(h.panel.result(), expected);
  assert.equal(h.result().getAttribute("data-live"), "true");
  assert.equal(h.target().textContent, "35.0");
  assert.equal(h.pli().textContent, "0.33 PLI of web width");
  assert.deepEqual(["min", "target", "max"].map(k => h.end(k).textContent), ["21.2", "35.0", "42.4"]);
  assert.equal(h.readout().textContent, "35.0 lb · 0.33 PLI");
  assert.ok(!h.readout().classList.contains("is-unset"));
  assert.equal(h.q("[data-role='range']").getAttribute("aria-label"), "Tension range 21.2 to 42.4 lb, target 35.0 lb");
  assert.equal(h.words("wind-words").textContent, "Surface Wind or Center/Surface");
  assert.equal(h.kind("surface").getAttribute("data-allowed"), "true");
  assert.equal(h.kind("center").getAttribute("data-allowed"), "true");
  assert.equal(h.words("taper-words").textContent, "30 – 50%");
  assert.equal(h.wedge().getAttribute("d"), surfaceModule.taperWedge(0.4));
  // Two ups: twice the tension, the same PLI, the same band.
  enter(h, undefined, undefined, 2);
  assert.equal(h.chip(2).getAttribute("aria-checked"), "true");
  assert.equal(h.chip(1).getAttribute("aria-checked"), "false");
  assert.equal(h.target().textContent, "70.0");
  assert.equal(h.pli().textContent, "0.33 PLI of web width");
  assert.deepEqual(h.panel.entries(), { thickness: "2.3", width: "106", ups: 2 });
  // The thin band: surface wind only, a 50% taper, the wedge at half.
  enter(h, "0.5");
  assert.equal(h.words("wind-words").textContent, "Surface Wind Only");
  assert.equal(h.kind("surface").getAttribute("data-allowed"), "true");
  assert.equal(h.kind("center").getAttribute("data-allowed"), "false");
  assert.equal(h.words("taper-words").textContent, "50%");
  assert.equal(h.wedge().getAttribute("d"), surfaceModule.taperWedge(0.5));
  assert.deepEqual([surfaceModule.taperFraction("30 – 50%"), surfaceModule.taperFraction("20%"), surfaceModule.taperFraction("")], [0.4, 0.2, 0]);
});

test("a blank or refused entry leaves no stale answer: the scale empties, every reading goes, the refused field is marked and named, the readout says what is missing", () => {
  const h = build();
  enter(h, "2.3", "106");
  assert.equal(h.result().getAttribute("data-live"), "true");
  enter(h, undefined, "");
  assert.equal(h.result().getAttribute("data-live"), "false");
  assert.equal(h.panel.result(), null);
  assert.equal(h.target().textContent, "—");
  assert.equal(h.pli().textContent, "");
  assert.deepEqual(["min", "target", "max"].map(k => h.end(k).textContent), ["—", "—", "—"]);
  assert.equal(h.kind("surface").getAttribute("data-allowed"), "false");
  assert.equal(h.words("wind-words").textContent, "—");
  assert.equal(h.wedge().getAttribute("d"), surfaceModule.taperWedge(0));
  assert.equal(h.readout().textContent, "Enter film thickness and roll width");
  assert.ok(hidden(h.note()));
  enter(h, "abc", "106");
  assert.equal(h.result().getAttribute("data-live"), "false");
  assert.equal(h.field("thickness").getAttribute("aria-invalid"), "true");
  assert.equal(h.field("thickness").getAttribute("title"), "Film thickness must be a number greater than 0.");
  assert.equal(h.field("width").getAttribute("aria-invalid"), null);
  assert.equal(h.note().textContent, "Film thickness must be a number greater than 0.");
  assert.equal(h.note().getAttribute("data-kind"), "error");
  assert.equal(h.readout().textContent, "Check the entries");
  enter(h, "3");
  assert.equal(h.field("thickness").getAttribute("aria-invalid"), null);
  assert.ok(hidden(h.note()));
  assert.equal(h.target().textContent, "42.4");
});

test("each new answer sweeps the range out from the centre - finite transform and opacity keyframes on the two halves, the mark and the figure, on the transition's tokens, through the animate it was handed; the same answer again plays nothing; reduced motion plays nothing; a blank cancels a sweep in flight", () => {
  const h = build();
  enter(h, "2.3", "106");
  const first = h.sweeps();
  assert.equal(first.length, 4);
  const timing = h.panel.getTiming();
  const byRole = role => first.find(a => a.element.getAttribute("data-role") === role);
  assert.deepEqual(byRole("fill-low").keyframes, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }]);
  assert.deepEqual(byRole("fill-high").keyframes, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }]);
  assert.deepEqual(byRole("fill-low").options, { duration: timing.move, easing: timing.ease, fill: "both" });
  assert.deepEqual(byRole("mark").keyframes, [{ transform: "scaleY(0)", opacity: 0 }, { transform: "none", opacity: 1 }]);
  assert.equal(byRole("mark").options.delay, timing.lead);
  const figure = first.find(a => a.element.classList.contains("station-winding__figure"));
  assert.deepEqual(figure.keyframes, [{ opacity: 0.35 }, { opacity: 1 }]);
  for (const animation of first) {
    for (const frame of animation.keyframes) {
      for (const property of Object.keys(frame)) assert.ok(["transform", "opacity"].includes(property), `animates ${property}`);
    }
  }
  // Retyping the same width is the same answer: nothing moves.
  enter(h, undefined, "106");
  assert.equal(h.sweeps().length, 4);
  // A new width is a new answer: the last sweep is cancelled, a fresh one plays.
  enter(h, undefined, "60");
  assert.equal(h.sweeps().length, 8);
  assert.ok(first.every(a => a.cancelled), "the earlier sweep was cancelled");
  // A blank cancels the sweep in flight and plays none.
  enter(h, "");
  assert.ok(h.sweeps().slice(4).every(a => a.cancelled));
  assert.equal(h.sweeps().length, 8);
  const still = build({ reducedMotion: true });
  enter(still, "2.3", "106");
  assert.equal(still.sweeps().length, 0, "reduced motion: the answer lands without a sweep");
  assert.equal(still.target().textContent, "35.0");
});

test("opening is a flight out of the tile on the transition's tokens, closing reverses it, reduced motion drops the travel; Close, Escape and close() all return to the tile; the entries survive", async () => {
  const h = build();
  enter(h, "2.3", "106");
  h.animations.length = 0;
  assert.equal(h.panel.open(), true);
  assert.equal(h.panel.isOpen(), true);
  assert.ok(!hidden(h.panel.panel));
  assert.equal(h.anchor.getAttribute("aria-expanded"), "true");
  assert.deepEqual(h.opened, [true]);
  assert.equal(h.animations.length, 2, "the panel's travel and the body's fade");
  const [travel, fade] = h.animations;
  assert.equal(travel.element, h.panel.panel);
  assert.match(travel.keyframes[0].transform, /^translate(.*) scale(.*)$|^matrix/);
  assert.equal(travel.keyframes[1].transform, "none");
  assert.equal(travel.options.duration, h.panel.getTiming().move);
  assert.deepEqual(fade.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(focused, h.field("thickness"), "the first field takes the focus - the entries already stand");
  // Close before the flight lands: the same animations run backwards.
  assert.equal(h.panel.close(), true);
  assert.equal(travel.reversed, 1);
  assert.equal(h.anchor.getAttribute("aria-expanded"), "false");
  assert.equal(focused, h.anchor, "the focus returns to the tile");
  travel.finish(); fade.finish();
  await tick(); await tick();
  assert.ok(hidden(h.panel.panel));
  assert.deepEqual(h.opened, [true, false]);
  assert.deepEqual(h.panel.entries(), { thickness: "2.3", width: "106", ups: 1 }, "closing keeps the entries");
  // Open again: Escape on the surface closes it and stops there.
  h.panel.open();
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  h.field("width").dispatchEvent(escape);
  assert.ok(escape.stopped, "Escape is the surface's, not the stage's");
  assert.equal(h.panel.isOpen(), false);
  h.panel.open();
  h.q("[data-action='close-winding']").click();
  assert.equal(h.panel.isOpen(), false);
  assert.equal(h.panel.toggle(), true);
  assert.equal(h.panel.toggle(), true);
  assert.equal(h.panel.isOpen(), false);
  const still = build({ reducedMotion: true });
  still.panel.open();
  assert.equal(still.animations.length, 0, "reduced motion: no travel");
  still.panel.close();
  assert.ok(hidden(still.panel.panel), "and hidden at once");
});

/* A window whose measured box follows where it was put, as a browser's
   would: the panel's rect reads the surface's own place. */
function movable(h) {
  const slot = h.panel.element;
  slot.rect = { left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700 };
  Object.defineProperty(h.panel.panel, "rect", {
    get() {
      const at = h.panel.place();
      const left = 16 + at.x;
      const top = 12 + at.y;
      return { left, top, width: 560, height: 380, right: left + 560, bottom: top + 380 };
    }
  });
  const props = {};
  h.panel.panel.style = {
    props,
    setProperty(key, value) { props[key] = value; },
    removeProperty(key) { delete props[key]; }
  };
  const bar = h.q("[data-role='title-bar']");
  const pointer = (type, init) => bar.dispatchEvent(makeEvent(type, Object.assign({ bubbles: true, pointerId: 7, button: 0 }, init)));
  const key = (name, target) => bar.dispatchEvent(makeEvent("keydown", { bubbles: true, key: name, target: target || bar }));
  return { bar, props, pointer, key };
}

test("the title bar is a handle: a pointer drag moves the frame within the stage's cell and never off it, the frame says so while it is held, Close on the bar is not a handle; the arrow keys move it with the bar focused and Home puts it back; where it was put is where it opens next, brought back within a smaller cell; the flight is measured from where it stands", async () => {
  const h = build();
  const m = movable(h);
  // Closed, the bar takes nothing.
  m.pointer("pointerdown", { clientX: 100, clientY: 20 });
  assert.equal(h.panel.panel.hasAttribute("data-moving"), false);
  h.panel.open();
  assert.deepEqual(h.panel.place(), { x: 0, y: 0 });
  assert.deepEqual(m.props, {}, "at the tokens' place nothing is written on the frame");

  // A drag: the delta is the move; the frame says it is held; the properties
  // the sheet lays on as a translate are written in whole pixels.
  const down = m.pointer("pointerdown", { clientX: 100, clientY: 20 });
  assert.ok(down);
  assert.ok(h.panel.panel.hasAttribute("data-moving"));
  m.pointer("pointermove", { clientX: 140.4, clientY: 60 });
  assert.ok(Math.abs(h.panel.place().x - 40.4) < 1e-9);
  assert.equal(h.panel.place().y, 40);
  assert.equal(m.props["--station-window-x"], "40px");
  assert.equal(m.props["--station-window-y"], "40px");
  // Another pointer's move is not this drag.
  m.pointer("pointermove", { clientX: 900, clientY: 600, pointerId: 9 });
  assert.equal(h.panel.place().y, 40);
  // Off the cell: clamped to its edges. The frame is 560×380 in a 1200×700
  // cell standing at (16, 12): x may go -16 … 624, y -12 … 308.
  m.pointer("pointermove", { clientX: 5000, clientY: 5000 });
  assert.deepEqual(h.panel.place(), { x: 624, y: 308 });
  m.pointer("pointermove", { clientX: -5000, clientY: -5000 });
  assert.deepEqual(h.panel.place(), { x: -16, y: -12 });
  m.pointer("pointermove", { clientX: 160, clientY: 50 });
  assert.deepEqual(h.panel.place(), { x: 60, y: 30 });
  m.pointer("pointerup", { clientX: 160, clientY: 50 });
  assert.equal(h.panel.panel.hasAttribute("data-moving"), false);
  // Released, the pointer's travel moves nothing.
  m.pointer("pointermove", { clientX: 400, clientY: 400 });
  assert.deepEqual(h.panel.place(), { x: 60, y: 30 });
  // A press on Close is Close's, not a drag; a secondary button is nothing.
  m.pointer("pointerdown", { clientX: 20, clientY: 20, target: h.q("[data-action='close-winding']") });
  assert.equal(h.panel.panel.hasAttribute("data-moving"), false);
  m.pointer("pointerdown", { clientX: 100, clientY: 20, button: 2 });
  assert.equal(h.panel.panel.hasAttribute("data-moving"), false);

  // The keys, with the bar itself focused: a space-4 a press, clamped too.
  m.key("ArrowRight");
  assert.deepEqual(h.panel.place(), { x: 76, y: 30 });
  m.key("ArrowDown");
  assert.deepEqual(h.panel.place(), { x: 76, y: 46 });
  m.key("ArrowLeft"); m.key("ArrowUp");
  assert.deepEqual(h.panel.place(), { x: 60, y: 30 });
  for (let i = 0; i < 40; i += 1) m.key("ArrowUp");
  assert.deepEqual(h.panel.place(), { x: 60, y: -12 });
  // The same keys from Close on the bar are Close's, not the window's.
  m.key("ArrowRight", h.q("[data-action='close-winding']"));
  assert.deepEqual(h.panel.place(), { x: 60, y: -12 });
  // Escape on the bar still closes: the bar's handler lets it through.
  const escape = makeEvent("keydown", { bubbles: true, key: "Escape", target: m.bar });
  m.bar.dispatchEvent(escape);
  assert.equal(h.panel.isOpen(), false);
  assert.ok(escape.stopped);
  // Closed where it was put; opened there again, and the flight out of the
  // tile is measured from there.
  assert.deepEqual(h.panel.place(), { x: 60, y: -12 });
  for (const a of h.animations) a.finish();
  await tick();
  h.animations.length = 0;
  h.panel.open();
  assert.deepEqual(h.panel.place(), { x: 60, y: -12 });
  const flight = h.animations.find(a => a.element === h.panel.panel);
  assert.ok(flight, "a flight");
  assert.match(flight.keyframes[0].transform, /translate\(-60px, 700px\)/, "from where the frame stands to the tile");
  m.key("Home");
  assert.deepEqual(h.panel.place(), { x: 0, y: 0 });
  assert.deepEqual(m.props, {}, "back at the tokens' place, nothing is written");

  // Put far out, then opened into a smaller cell: brought back within it.
  m.pointer("pointerdown", { clientX: 100, clientY: 20 });
  m.pointer("pointermove", { clientX: 700, clientY: 320 });
  m.pointer("pointerup", { clientX: 700, clientY: 320 });
  assert.deepEqual(h.panel.place(), { x: 600, y: 300 });
  h.panel.close();
  await tick();
  h.panel.element.rect = { left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 };
  h.panel.open();
  assert.deepEqual(h.panel.place(), { x: 224, y: 108 });
  // A close mid-drag releases the bar.
  m.pointer("pointerdown", { clientX: 100, clientY: 20 });
  assert.ok(h.panel.panel.hasAttribute("data-moving"));
  h.panel.close();
  assert.equal(h.panel.panel.hasAttribute("data-moving"), false);
});

test("the surface dispatches nothing, reaches for nothing, restates no band and knows nothing of the Handbook", () => {
  const source = read("station/station-winding-tension.js");
  for (const forbidden of [/\.dispatch\s*\(/, /PolynStationCommandBridge/, /localStorage|sessionStorage/, /fetch\s*\(/, /document\./, /PolynStationHandbook/, /\.animate\s*\(/, /requestAnimationFrame|setInterval/]) {
    assert.doesNotMatch(source, forbidden, `the surface reaches out through ${forbidden}`);
  }
  // The band table lives in winding-tension.js alone (a comment may quote
  // the band's words as an example; the code may not carry them).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /0\.15|0\.20|0\.40|0\.80|Surface Wind Only|30 – 50%/);
  assert.match(source, /calc\.calculate\(\{ filmThicknessMil: entries\.thickness, rollWidthIn: entries\.width, ups: entries\.ups \}\)/);
  assert.match(source, /calc\.formatTension\(/);
  assert.match(source, /calc\.formatPli\(/);
});

/* ----------------------------------------------------------------------
 *   The rail's Tools switch and its row
 * -------------------------------------------------------------------- */

test("the rail's fourth switch is Tools, at the column's foot over the Handbook, with Winding Tension in its flyout; both are glyph tiles in the rail's own vocabulary; the switch unfolds the row and the tile shows the surface's state, each click handed back", () => {
  focused = null;
  const doc = fakeDocument();
  const clicks = [];
  const rail = railModule.create(doc, { onTools: () => clicks.push("tools"), onWindingTension: () => clicks.push("winding"), onResinTotals: () => clicks.push("totals") });
  assert.deepEqual(rail.element.children.map(node => node.getAttribute("data-role")), ["blend-group", "next-group", "weights-group", "tools-group", "print-group"]);
  assert.deepEqual(rail.toolsGroup.children.map(node => node.getAttribute("data-action") || node.getAttribute("class")), ["tools", "station-rail__flyout"]);
  assert.deepEqual(rail.toolsFlyout.children.map(node => node.getAttribute("data-role")), ["tools-row"]);
  assert.deepEqual(rail.toolsRow.children.map(node => node.getAttribute("data-action")), ["winding-tension", "resin-totals", "pressure"]);
  assert.equal(rail.toolsFlyout.getAttribute("aria-label"), "Tools");
  assert.equal(rail.toolsButton.getAttribute("aria-label"), "Tools");
  assert.equal(rail.windingButton.getAttribute("aria-label"), "Winding Tension");
  assert.equal(rail.toolsButton.textContent, "");
  assert.equal(rail.windingButton.textContent, "");
  for (const button of [rail.toolsButton, rail.windingButton]) {
    const svg = button.children[0];
    assert.equal(svg.getAttribute("viewBox"), "0 0 64 64");
    assert.deepEqual(svg.children.map(node => node.getAttribute("class")), ["station-rail__glyph-plate", "station-rail__glyph-art"]);
    walk(svg, node => assert.match(node.getAttribute("class") || "", /^station-rail__glyph/));
  }
  // The spanner: an open arc for the jaw, its two faces, one bold handle.
  const art = button => button.children[0].children[1].children.map(node => [node.getAttribute("class").replaceAll("station-rail__glyph-", ""), node.getAttribute("d")]);
  assert.deepEqual(art(rail.toolsButton), [
    ["stroke stroke--bold", "M 13.5 3.4 A 3.4 3.4 0 1 0 16.6 6.5"],
    ["stroke", "M 13.5 3.4 L 13.4 4.9 M 16.6 6.5 L 15.1 6.6"],
    ["stroke stroke--bold", "M 10.8 9.2 L 4 16"]
  ]);
  // The web pinched under tension: a face bowed in, an arrow out of each end, ticks above and below.
  assert.deepEqual(art(rail.windingButton).map(([cls]) => cls), ["face", "stroke", "stroke", "row", "row"]);
  assert.match(art(rail.windingButton)[0][1], /^M 5\.5 6\.5 Q 10 8\.2 14\.5 6\.5 L 14\.5 13\.5 Q 10 11\.8 5\.5 13\.5 Z$/);
  // Folded and held until the boot file says a tool stands there.
  assert.equal(rail.toolsFlyout.getAttribute("data-open"), "false");
  assert.ok(rail.toolsFlyout.hasAttribute("inert"));
  assert.equal(rail.toolsButton.disabled, true);
  assert.equal(rail.windingButton.disabled, true);
  rail.update({ hidden: false, tools: { open: false, available: true }, winding: { active: false, available: true } });
  assert.equal(rail.toolsButton.disabled, false);
  assert.equal(rail.toolsButton.getAttribute("aria-pressed"), "false");
  rail.toolsButton.click();
  assert.deepEqual(clicks, ["tools"], "the click is handed back; the rail waits to be told");
  assert.equal(rail.toolsFlyout.getAttribute("data-open"), "false");
  rail.update({ tools: { open: true, available: true } });
  assert.equal(rail.toolsFlyout.getAttribute("data-open"), "true");
  assert.ok(!rail.toolsFlyout.hasAttribute("inert"));
  assert.equal(rail.toolsButton.getAttribute("aria-pressed"), "true");
  assert.ok(rail.toolsButton.classList.contains("is-active"));
  assert.ok(rail.element.classList.contains("is-tools-open"));
  rail.windingButton.click();
  assert.deepEqual(clicks, ["tools", "winding"]);
  assert.equal(rail.windingButton.getAttribute("aria-pressed"), "false");
  rail.update({ winding: { active: true, available: true } });
  assert.equal(rail.windingButton.getAttribute("aria-pressed"), "true");
  assert.ok(rail.windingButton.classList.contains("is-active"));
  assert.match(rail.windingButton.getAttribute("title"), /open — click to close/);
  assert.deepEqual(rail.getState().tools, { open: true, available: true });
  assert.deepEqual(rail.getState().winding, { active: true, available: true });
  // Nothing on the stage turns over for Tools: no face is active.
  assert.equal(rail.element.getAttribute("data-face"), null);
  assert.ok(!rail.element.classList.contains("is-blend-active"));
});

/* ----------------------------------------------------------------------
 *   Station booted for real
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const files = [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(files.includes("station/station-winding-tension.js"), "the host loads the calculator");
  return files.filter(file => file !== "station/station.js");
}

const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "changeover-estimate.js", "winding-tension.js", "workspace-configuration-payloads.js",
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
        weight: index < 2 ? 300 : 0, usableHeight: 30, effectiveWeight: index < 2 ? 300 : 0, track: index === 0, pumpOff: false
      }))
    })),
    revision: 1
  };
}

function boot() {
  focused = null;
  const doc = fakeDocument();
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

  const snap = snapshot();
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
  const tools = q("[data-action='tools']");
  const tile = q("[data-action='winding-tension']");
  const panel = q(".station-winding__panel");
  const changeover = q(".station-changeover__panel");
  const launcher = q(".station-handbook__launcher");
  assert.ok(machine && rail && tools && tile && panel && changeover && launcher, "Station booted with its stage, rail, Tools, the tile, both calculators and the Handbook");
  return {
    doc, window, calls, machine, rail, tools, tile, panel, changeover, launcher, q,
    rowOpen: () => q("[data-role='tools-group'] .station-rail__flyout").getAttribute("data-open") === "true",
    calcOpen: () => tile.getAttribute("aria-expanded") === "true" && !hidden(panel),
    changeoverOpen: () => !hidden(changeover),
    handbookOpen: () => launcher.getAttribute("aria-expanded") === "true",
    stageKey: () => JSON.stringify(machine.querySelectorAll("[data-role='hopper']").map(h => [h.getAttribute("data-hopper"), h.getAttribute("data-state"), h.getAttribute("class")])),
    field: name => panel.querySelectorAll(".station-winding__form input[data-field]").find(n => n.getAttribute("data-field") === name)
  };
}

test("booted: Tools stands at the rail's foot, over the Handbook; its click unfolds Winding Tension; the tile opens the surface in the utility slot out of itself and shows it; no command, no change to the stage; Tools again folds the row and takes the surface with it", () => {
  const s = boot();
  assert.deepEqual(s.rail.children.map(node => node.getAttribute("data-role")), ["blend-group", "next-group", "weights-group", "tools-group", "print-group"]);
  assert.ok(s.panel.closest("[data-station-mount='utility']"), "the surface is in the utility slot");
  assert.ok(s.tile.closest("[data-station-mount='rail']"), "the tile is on the rail");
  assert.equal(s.tools.disabled, false, "Tools is offered: the page has the calculator");
  assert.equal(s.tile.disabled, false);
  assert.equal(s.rowOpen(), false);
  assert.equal(s.calcOpen(), false);
  const stage = s.stageKey();
  s.tools.click();
  assert.equal(s.rowOpen(), true);
  assert.equal(s.tools.getAttribute("aria-pressed"), "true");
  assert.equal(s.calcOpen(), false, "the row unfolds; nothing opens until a tool is clicked");
  s.tile.click();
  assert.equal(s.calcOpen(), true);
  assert.equal(s.tile.getAttribute("aria-pressed"), "true");
  assert.equal(focused, s.field("thickness"));
  assert.equal(s.calls.length, 0, "no command");
  assert.equal(s.stageKey(), stage, "the stage is untouched");
  assert.ok(!s.rail.classList.contains("is-blend-active"), "no face turned over for it");
  input(s.field("thickness"), "2.3");
  input(s.field("width"), "106");
  assert.equal(s.q("[data-role='target']").textContent, "35.0");
  assert.equal(s.calls.length, 0, "an answer is not a command");
  // The tile again closes the surface and keeps the row.
  s.tile.click();
  assert.equal(s.calcOpen(), false);
  assert.equal(s.tile.getAttribute("aria-pressed"), "false");
  assert.equal(s.rowOpen(), true);
  assert.equal(focused, s.tile, "the focus returns to the tile");
  // Open again, then fold the row: the surface goes with it.
  s.tile.click();
  assert.equal(s.calcOpen(), true);
  s.tools.click();
  assert.equal(s.rowOpen(), false);
  assert.equal(s.calcOpen(), false);
  assert.equal(s.tools.getAttribute("aria-pressed"), "false");
  assert.equal(s.stageKey(), stage);
  assert.equal(s.calls.length, 0);
});

test("booted: the two calculators share the upper band, so opening either closes the other; the Handbook stands open beside the surface and neither disturbs the other's state", () => {
  const s = boot();
  s.tools.click();
  s.tile.click();
  assert.equal(s.calcOpen(), true);
  const readout = s.doc.querySelectorAll(".station-job__trigger").find(n => n.getAttribute("data-field") === "changeover");
  readout.click();
  assert.equal(s.changeoverOpen(), true);
  assert.equal(s.calcOpen(), false, "the Changeover Calculator took the band");
  assert.equal(s.tile.getAttribute("aria-pressed"), "false");
  assert.equal(s.rowOpen(), true, "the Tools row is still unfolded");
  s.tile.click();
  assert.equal(s.calcOpen(), true);
  assert.equal(s.changeoverOpen(), false, "and Winding Tension took it back");
  input(s.field("thickness"), "4");
  input(s.field("width"), "50");
  s.launcher.click();
  assert.equal(s.handbookOpen(), true);
  assert.equal(s.calcOpen(), true, "the Handbook and the calculator stand open together");
  assert.equal(s.q("[data-role='target']").textContent, "30.0");
  s.launcher.click();
  assert.equal(s.handbookOpen(), false);
  assert.equal(s.calcOpen(), true);
  assert.equal(s.q("[data-role='target']").textContent, "30.0", "the answer stood through the Handbook's opening and closing");
  s.q("[data-action='close-winding']").click();
  assert.equal(s.calcOpen(), false);
  assert.equal(s.calls.length, 0);
});

test("the calculator is loaded by the host and the harness after the Changeover Calculator; its arithmetic is the application's own winding-tension.js, which index.html loads before the host; the floor UI's tool is untouched and no legacy sheet styles the surface", () => {
  const host = read("station-host.js");
  const scripts = [...host.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(scripts.indexOf("station/station-winding-tension.js") > scripts.indexOf("station/station-changeover.js"));
  assert.ok(scripts.indexOf("station/station-winding-tension.js") > scripts.indexOf("station/station-window.js"), "the window frame before the tool that stands in it");
  assert.ok(scripts.indexOf("station/station-winding-tension.js") > scripts.indexOf("station/station-machine-rail.js"));
  assert.ok(scripts.indexOf("station/station-winding-tension.js") < scripts.indexOf("station/station.js"));
  assert.match(host, /"station\/styles\/components\/window\.css",\s*"station\/styles\/components\/winding-tension\.css"/);
  const harness = read("station/station.html");
  assert.match(harness, /station-winding-tension\.js\?v=/);
  assert.match(harness, /\.\.\/winding-tension\.js\?v=/);
  assert.match(harness, /components\/winding-tension\.css\?v=/);
  assert.ok(harness.indexOf("../winding-tension.js") < harness.indexOf("station-winding-tension.js"), "the arithmetic before the surface that reads it");
  const indexHtml = read("index.html");
  assert.match(indexHtml, /<script src="winding-tension\.js\?v=[^"]+" defer><\/script>/);
  assert.ok(indexHtml.indexOf('src="winding-tension.js') < indexHtml.indexOf('src="station-host.js'), "the host's modules read the global the application loaded");
  assert.doesNotMatch(indexHtml, /station-winding|winding-tension\.css/);
  assert.match(indexHtml, /id="windingTensionTool"/, "the floor UI's own panel, as it was");
  const app = read("app.js");
  assert.doesNotMatch(app, /station-winding|PolynStationWindingTension/);
  for (const sheet of fs.readdirSync(ROOT).filter(name => name.endsWith(".css"))) {
    assert.doesNotMatch(read(sheet), /station-winding/, `${sheet} styles the calculator`);
  }
});

test("the frame is a Station window's: the owner's sheet sets only its size from the winding tokens, capped by the stage's cell; the window's sheet spawns it at the centre and lays its place on as a translate under the flight's transform; no media query but reduced motion, no raw length, no raw colour; the one continuing motion is the ideal zone's breathing, off under reduced motion", () => {
  const raw = read("station/styles/components/winding-tension.css");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sheet, name) => { const at = sheet.indexOf(`${name} {`); assert.ok(at >= 0, `${name} has no rule`); return sheet.slice(at, sheet.indexOf("}", at)); };
  const panel = rule(css, ".station-winding__panel");
  assert.match(panel, /width: min\(var\(--station-winding-width\), calc\(100% - 2 \* var\(--station-space-4\)\)\);/);
  assert.match(panel, /height: min\(var\(--station-winding-height\), calc\(100% - 2 \* var\(--station-space-3\)\)\);/);
  assert.doesNotMatch(panel, /\s(max-height|min-height):|fit-content|max-content|height: auto/);
  assert.doesNotMatch(panel, /position|top:|left:|translate|transform|z-index/, "the frame's place is the window's, not the tool's");
  assert.doesNotMatch(css, /station-winding__(head|close|body|readout|title)/, "the bar, Close and the body are the window's vocabulary");
  const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map(m => m[1].trim());
  assert.deepEqual(queries, ["(prefers-reduced-motion: reduce)"]);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(/i, "winding-tension.css names a colour");
  assert.doesNotMatch(panel, /\d+px|\d+vh|\d+vw/, "a raw length in the frame's rule");
  assert.doesNotMatch(css, /backdrop-filter/, "the material is the shared glass");
  assert.equal((css.match(/@keyframes/g) || []).length, 1);
  assert.match(css, /@keyframes station-winding-breathe/);
  const applied = (css.match(/animation:\s*[^;]+;/g) || []).filter(one => !/animation:\s*none/.test(one));
  assert.equal(applied.length, 1, "one thing breathes");
  assert.match(applied[0], /station-winding-breathe/);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(reduced && /animation:\s*none/.test(reduced[1]), "no reduced-motion switch-off");
  const tokens = read("station/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(tokens, /--station-winding-width: \d+px;/);
  assert.match(tokens, /--station-winding-height: \d+px;/);

  // The window's sheet: spawned at the centre, moved by a translate the
  // module writes, over the slot, inert until the frame itself.
  const win = read("station/styles/components/window.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const frame = rule(win, ".station-window__panel");
  assert.match(frame, /\btop: 50%;/);
  assert.match(frame, /\bleft: 50%;/);
  // (A unitless 0 is not addable to a percentage inside calc(): the
  // fallback has to be 0px, or the whole declaration is dropped.)
  assert.match(frame, /translate: calc\(-50% \+ var\(--station-window-x, 0px\)\) calc\(-50% \+ var\(--station-window-y, 0px\)\);/);
  assert.match(frame, /transform-origin: 0 0;/, "the flight's arithmetic assumes the corner");
  assert.match(frame, /pointer-events: auto;/);
  assert.doesNotMatch(frame, /\b(width|height):/, "the frame's size is each window's own");
  assert.match(rule(win, ".station-window"), /pointer-events: none;/);
  assert.match(rule(win, ".station-window__bar"), /cursor: grab;/);
  assert.match(rule(win, ".station-window__bar"), /touch-action: none;/);
  assert.match(rule(win, ".station-window__panel[data-moving]"), /cursor: grabbing;/);
  assert.match(rule(win, ".station-window__body"), /overflow-y: auto;/);
  // Close: the round button, its cross drawn by pseudo-elements and shown
  // with the pointer on the bar - on a window, the Handbook, the calculator.
  const close = rule(win, ".station-root .station-window__close");
  assert.match(close, /border-radius: 50%;/);
  assert.match(close, /background: var\(--station-danger\);/);
  assert.match(close, /width: var\(--station-space-3\);/);
  assert.match(win, /\.station-window__close::before,\s*\.station-window__close::after \{[^}]*opacity: 0;/);
  assert.match(win, /\.station-window__bar:hover \.station-window__close::before,[\s\S]*?\.station-handbook__head:hover \.station-window__close::before,[\s\S]*?\.station-changeover__head:hover \.station-window__close::before,[\s\S]*?opacity: 1;/);
  assert.doesNotMatch(win, /#[0-9a-f]{3,8}\b|\brgba?\(/i, "window.css names a colour");
  assert.deepEqual([...win.matchAll(/@media ([^{]+)\{/g)].map(m => m[1].trim()), ["(prefers-reduced-motion: reduce)"]);
  // Nothing else on Station draws a Close of its own any more.
  for (const sheet of ["handbook", "changeover"]) {
    const other = read(`station/styles/components/${sheet}.css`).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(other, new RegExp(`\\.station-${sheet}__close`), `${sheet}.css styles a Close of its own`);
  }
  for (const file of ["station/station-handbook.js", "station/station-changeover.js"]) {
    const source = read(file);
    assert.match(source, /"aria-label": "Close"/, `${file}'s Close is not named`);
    assert.doesNotMatch(source, /"button", [^\n]*close[^\n]*, "Close"/i, `${file}'s Close still carries the word`);
  }
  assert.match(read("station/station-changeover.js"), /const CLOSE = "station-window__close";/);
  assert.match(read("station/station-handbook.js"), /"station-window__close station-handbook__close"/);
});
