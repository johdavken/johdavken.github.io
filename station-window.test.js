"use strict";

/* The Station window (station/station-window.js): the frame every floating
 * utility surface stands in - the Winding Tension calculator, Resin
 * Totals, the tools to come.
 *
 * The module alone, against the boot tests' fake DOM (the slice the
 * Winding Tension tests use) and a recorded animate(): what a window is
 * built as, its bar and its round Close, the flight out of the tile and
 * back, Escape, the title bar as a handle - drag, keys, the cell's
 * bounds, the place kept - and the Close control the Handbook and the
 * Changeover Calculator borrow. Then the sheet: spawned at the centre,
 * moved by a translate under the flight's transform.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const windowModule = require("./station/station-window.js");
const transitionModule = require("./station/station-transition.js");

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
const tick = () => new Promise(resolve => setImmediate(resolve));

/* A window in a 1200×700 cell, its frame 560×380 standing at (16, 12)
   before it is moved; the frame's measured box follows its place, as a
   browser's would, and its style records the properties written. */
function build(options) {
  focused = null;
  const doc = fakeDocument();
  const animations = [];
  const anchor = doc.createElement("button");
  anchor.rect = { left: 16, top: 700, width: 64, height: 64 };
  const opened = [];
  const win = windowModule.create(doc, Object.assign({
    name: "probe",
    title: "Probe",
    className: "station-probe__panel",
    closeTitle: "Close the probe (Esc)",
    anchor,
    animate: (element, keyframes, opts) => { const animation = fakeAnimation(element, keyframes, opts); animations.push(animation); return animation; },
    measure: element => element.rect,
    reducedMotion: () => !!(options && options.reducedMotion),
    onOpenChange: open => opened.push(open)
  }, (options && options.settings) || {}));
  win.element.rect = { left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700 };
  Object.defineProperty(win.panel, "rect", {
    get() {
      const at = win.place();
      const left = 16 + at.x;
      const top = 12 + at.y;
      return { left, top, width: 560, height: 380, right: left + 560, bottom: top + 380 };
    }
  });
  const props = {};
  win.panel.style = { props, setProperty(key, value) { props[key] = value; }, removeProperty(key) { delete props[key]; } };
  const q = selector => win.element.querySelector(selector);
  const pointer = (type, init) => win.bar.dispatchEvent(makeEvent(type, Object.assign({ bubbles: true, pointerId: 7, button: 0 }, init)));
  const key = (name, target) => win.bar.dispatchEvent(makeEvent("keydown", { bubbles: true, key: name, target: target || win.bar }));
  return { doc, animations, anchor, win, opened, props, q, pointer, key };
}

test("a window is built closed: a region on the glass with the owner's class, hidden, under a root that names it; the bar carries the title, an empty readout and the round Close last - wordless, named, with the owner's tooltip; the body is empty; the tile says it is closed", () => {
  const h = build();
  const { win } = h;
  assert.equal(win.element.getAttribute("class"), "station-window");
  assert.equal(win.element.getAttribute("data-window"), "probe");
  assert.ok(win.panel.parent === win.element);
  assert.equal(win.panel.getAttribute("class"), "station-window__panel station-glass station-probe__panel");
  assert.equal(win.panel.getAttribute("role"), "region");
  assert.equal(win.panel.getAttribute("aria-label"), "Probe");
  assert.ok(hidden(win.panel));
  assert.equal(win.isOpen(), false);
  assert.deepEqual(win.panel.children.map(n => n.getAttribute("class")), ["station-window__bar", "station-window__body"]);
  assert.ok(win.bar === h.q(".station-window__bar"));
  assert.equal(win.bar.getAttribute("data-role"), "title-bar");
  assert.equal(win.bar.getAttribute("tabindex"), "0");
  assert.match(win.bar.getAttribute("aria-label"), /^Probe window\. Drag to move/);
  assert.deepEqual(win.bar.children.map(n => n.getAttribute("class")), ["station-window__title", "station-window__readout", "station-window__close"]);
  assert.equal(win.bar.children[0].textContent, "Probe");
  assert.ok(win.readout === win.bar.children[1]);
  assert.equal(win.readout.textContent, "");
  const close = win.closeButton;
  assert.ok(close === win.bar.children[2]);
  assert.equal(close.getAttribute("type"), "button");
  assert.equal(close.getAttribute("data-action"), "close-probe");
  assert.equal(close.getAttribute("aria-label"), "Close");
  assert.equal(close.getAttribute("title"), "Close the probe (Esc)");
  assert.equal(close.textContent, "");
  assert.equal(win.body.children.length, 0);
  assert.equal(h.anchor.getAttribute("aria-expanded"), "false");
  assert.deepEqual(win.place(), { x: 0, y: 0 });
  assert.deepEqual(h.opened, []);
  // Without a name or a title the window still stands.
  const bare = windowModule.create(fakeDocument(), {});
  assert.equal(bare.element.getAttribute("data-window"), "window");
  assert.equal(bare.closeButton.getAttribute("data-action"), "close-window");
});

test("the Close control alone, for a surface that is not a window: the same class and name, the owner's action, tooltip and extra class", () => {
  const doc = fakeDocument();
  const close = windowModule.closeButton(doc, "close-handbook", "Close the Handbook (Esc)", "station-handbook__close");
  assert.equal(close.getAttribute("class"), "station-window__close station-handbook__close");
  assert.equal(close.getAttribute("data-action"), "close-handbook");
  assert.equal(close.getAttribute("aria-label"), "Close");
  assert.equal(close.getAttribute("title"), "Close the Handbook (Esc)");
  assert.equal(close.textContent, "");
  const plain = windowModule.closeButton(doc, "close-x");
  assert.equal(plain.getAttribute("class"), "station-window__close");
  assert.equal(plain.getAttribute("title"), "Close (Esc)");
  assert.deepEqual(Object.keys(windowModule.CLASS), ["root", "panel", "bar", "title", "readout", "close", "body"]);
  assert.equal(windowModule.NUDGE, 16);
});

test("opening is a flight out of the tile on the transition's tokens - the frame from the overlay transform, the body fading up - the owner's focus target taken; closing reverses it and returns focus to the tile; Close, Escape and close() all do; reduced motion drops the travel; onOpenChange is told each way", async () => {
  const h = build();
  const { win } = h;
  const field = h.doc.createElement("input");
  win.body.appendChild(field);
  const focusing = build({ settings: { focus: () => field } });
  assert.equal(focusing.win.open(), true);
  assert.ok(focused === field, "the owner's focus target");
  assert.equal(win.open(), true);
  assert.equal(win.open(), false, "already open");
  assert.ok(!hidden(win.panel));
  assert.ok(win.element.classList.contains("is-open"));
  assert.equal(h.anchor.getAttribute("aria-expanded"), "true");
  assert.deepEqual(h.opened, [true]);
  assert.equal(h.animations.length, 2);
  const [frame, body] = h.animations;
  assert.ok(frame.element === win.panel);
  assert.ok(body.element === win.body);
  const expected = transitionModule.overlayTransform(h.anchor.rect, win.panel.rect);
  assert.equal(frame.keyframes[0].transform, expected);
  assert.equal(frame.keyframes[1].transform, "none");
  assert.equal(frame.options.duration, win.getTiming().move);
  assert.equal(frame.options.easing, win.getTiming().ease);
  assert.deepEqual(body.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(body.options.duration, win.getTiming().settle);
  // Close before the flight lands: the same animations run backwards.
  assert.equal(win.close(), true);
  assert.equal(win.close(), false, "already closed");
  assert.equal(frame.reversed, 1);
  assert.equal(body.reversed, 1);
  assert.equal(win.isOpen(), false);
  assert.ok(focused === h.anchor, "focus returns to the tile");
  assert.deepEqual(h.opened, [true, false]);
  assert.ok(!hidden(win.panel), "still in flight");
  for (const a of h.animations) a.finish();
  await tick();
  assert.ok(hidden(win.panel), "hidden once the flight lands");
  // Open again, landed: a fresh closing flight on Close.
  h.animations.length = 0;
  win.open();
  for (const a of h.animations) a.finish();
  await tick();
  h.animations.length = 0;
  win.closeButton.click();
  assert.equal(win.isOpen(), false);
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].keyframes[1].transform, expected);
  for (const a of h.animations) a.finish();
  await tick();
  assert.ok(hidden(win.panel));
  // Escape on the surface closes it and stops there.
  win.open();
  const escape = makeEvent("keydown", { bubbles: true, key: "Escape" });
  win.body.dispatchEvent(escape);
  assert.equal(win.isOpen(), false);
  assert.ok(escape.stopped);
  assert.ok(escape.defaultPrevented);
  const other = makeEvent("keydown", { bubbles: true, key: "Enter" });
  win.open();
  win.body.dispatchEvent(other);
  assert.equal(win.isOpen(), true);
  assert.ok(!other.stopped);
  // Reduced motion: no travel either way.
  const still = build({ reducedMotion: true });
  still.win.open();
  assert.equal(still.animations.length, 0);
  assert.ok(!hidden(still.win.panel));
  still.win.close();
  assert.equal(still.animations.length, 0);
  assert.ok(hidden(still.win.panel));
  assert.equal(win.toggle(), true, "toggle closes");
  assert.equal(win.isOpen(), false);
  assert.equal(win.toggle(), true, "toggle opens");
  assert.equal(win.isOpen(), true);
});

test("the title bar is a handle: a pointer drag moves the frame within the cell and never off it, the frame says so while held, a press on Close is Close's, a secondary button nothing; the arrow keys move it a space-4 with the bar focused and Home puts it back at the centre; the place is kept across close and open and brought back within a smaller cell; the flight is measured from where it stands; a close mid-drag releases the bar", async () => {
  const h = build();
  const { win } = h;
  // Closed, the bar takes nothing.
  h.pointer("pointerdown", { clientX: 100, clientY: 20 });
  assert.equal(win.panel.hasAttribute("data-moving"), false);
  win.open();
  assert.deepEqual(h.props, {}, "at the centre nothing is written on the frame");

  h.pointer("pointerdown", { clientX: 100, clientY: 20 });
  assert.ok(win.panel.hasAttribute("data-moving"));
  h.pointer("pointermove", { clientX: 140.4, clientY: 60 });
  assert.ok(Math.abs(win.place().x - 40.4) < 1e-9);
  assert.equal(win.place().y, 40);
  assert.equal(h.props["--station-window-x"], "40px", "whole pixels");
  assert.equal(h.props["--station-window-y"], "40px");
  // Another pointer's move is not this drag.
  h.pointer("pointermove", { clientX: 900, clientY: 600, pointerId: 9 });
  assert.equal(win.place().y, 40);
  // Off the cell: clamped to its edges. 560×380 in 1200×700 standing at
  // (16, 12): x may go -16 … 624, y -12 … 308.
  h.pointer("pointermove", { clientX: 5000, clientY: 5000 });
  assert.deepEqual(win.place(), { x: 624, y: 308 });
  h.pointer("pointermove", { clientX: -5000, clientY: -5000 });
  assert.deepEqual(win.place(), { x: -16, y: -12 });
  h.pointer("pointermove", { clientX: 160, clientY: 50 });
  assert.deepEqual(win.place(), { x: 60, y: 30 });
  h.pointer("pointerup", { clientX: 160, clientY: 50 });
  assert.equal(win.panel.hasAttribute("data-moving"), false);
  h.pointer("pointermove", { clientX: 400, clientY: 400 });
  assert.deepEqual(win.place(), { x: 60, y: 30 }, "released, the pointer's travel moves nothing");
  h.pointer("pointerdown", { clientX: 20, clientY: 20, target: win.closeButton });
  assert.equal(win.panel.hasAttribute("data-moving"), false, "a press on Close is Close's");
  h.pointer("pointerdown", { clientX: 100, clientY: 20, button: 2 });
  assert.equal(win.panel.hasAttribute("data-moving"), false);

  // The keys, with the bar itself focused.
  h.key("ArrowRight");
  assert.deepEqual(win.place(), { x: 76, y: 30 });
  h.key("ArrowDown");
  assert.deepEqual(win.place(), { x: 76, y: 46 });
  h.key("ArrowLeft"); h.key("ArrowUp");
  assert.deepEqual(win.place(), { x: 60, y: 30 });
  for (let i = 0; i < 40; i += 1) h.key("ArrowUp");
  assert.deepEqual(win.place(), { x: 60, y: -12 }, "clamped too");
  h.key("ArrowRight", win.closeButton);
  assert.deepEqual(win.place(), { x: 60, y: -12 }, "the keys from Close are Close's");
  const escape = makeEvent("keydown", { bubbles: true, key: "Escape", target: win.bar });
  win.bar.dispatchEvent(escape);
  assert.equal(win.isOpen(), false, "Escape on the bar still closes");
  assert.ok(escape.stopped);
  assert.deepEqual(win.place(), { x: 60, y: -12 }, "closed where it was put");
  for (const a of h.animations) a.finish();
  await tick();
  h.animations.length = 0;
  win.open();
  assert.deepEqual(win.place(), { x: 60, y: -12 }, "opened there again");
  const flight = h.animations.find(a => a.element === win.panel);
  assert.match(flight.keyframes[0].transform, /translate\(-60px, 700px\)/, "measured from where the frame stands");
  h.key("Home");
  assert.deepEqual(win.place(), { x: 0, y: 0 });
  assert.deepEqual(h.props, {}, "back at the centre, nothing is written");
  // moveTo() is the same clamp, for an owner.
  assert.deepEqual(win.moveTo(9999, -9999), { x: 624, y: -12 });

  // Put far out, then opened into a smaller cell: brought back within it.
  win.moveTo(600, 300);
  win.close();
  for (const a of h.animations) a.finish();
  await tick();
  win.element.rect = { left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 };
  win.open();
  assert.deepEqual(win.place(), { x: 224, y: 108 });
  h.pointer("pointerdown", { clientX: 100, clientY: 20 });
  assert.ok(win.panel.hasAttribute("data-moving"));
  win.close();
  assert.equal(win.panel.hasAttribute("data-moving"), false, "a close mid-drag releases the bar");
  // Nothing to measure (no rects): the bar takes no drag, and a move is unclamped.
  const blind = build({ settings: { measure: () => null } });
  blind.win.open();
  blind.pointer("pointerdown", { clientX: 1, clientY: 1 });
  assert.equal(blind.win.panel.hasAttribute("data-moving"), false);
  assert.deepEqual(blind.win.moveTo(5, 6), { x: 5, y: 6 });
});

test("the module is presentation only: no dispatch, no bridge, no storage, no reach for the document, no animate of its own; loaded by both hosts before the tools that stand in it, with its sheet after the Changeover Calculator's", () => {
  const source = read("station/station-window.js");
  for (const forbidden of [/\.dispatch\s*\(/, /PolynStationCommandBridge/, /localStorage|sessionStorage/, /fetch\s*\(/, /document\./, /\.animate\s*\(/, /requestAnimationFrame|setInterval|setTimeout/]) {
    assert.doesNotMatch(source, forbidden, `station-window.js matches ${forbidden}`);
  }
  assert.match(source, /require\("\.\/station-transition\.js"\)/);
  const host = read("station-host.js");
  const scripts = [...host.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(scripts.indexOf("station/station-window.js") > scripts.indexOf("station/station-transition.js"));
  assert.ok(scripts.indexOf("station/station-window.js") < scripts.indexOf("station/station-winding-tension.js"));
  assert.ok(scripts.indexOf("station/station-window.js") < scripts.indexOf("station/station-resin-totals.js"));
  assert.match(host, /"station\/styles\/components\/changeover\.css",[\s\S]*?"station\/styles\/components\/window\.css",\s*"station\/styles\/components\/winding-tension\.css"/);
  const harness = read("station/station.html");
  assert.match(harness, /station-window\.js\?v=/);
  assert.match(harness, /components\/window\.css\?v=/);
  assert.ok(harness.indexOf("station-window.js") < harness.indexOf("station-winding-tension.js"));
  assert.doesNotMatch(read("index.html"), /station-window|window\.css/);
});
