"use strict";

/* The Pressure converter (station/station-pressure.js): the rail's Tools
 * row's third tool, psi to bar and back, opened out of its tile into a
 * Station window.
 *
 * Two layers of test, as the Winding Tension calculator has. The
 * component alone, against the boot tests' fake DOM: what it shows before
 * an entry, how an entry on either face becomes the application's own
 * answer on both, the two scales and the two needles at one angle, what
 * a blank or refused entry does, the reference strip, the flight. Then
 * Station booted for real - every module the host loads, in the host's
 * order - to drive the rail's Tools switch, the tile, the window it
 * opens, and the surfaces it shares the stage with.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const surfaceModule = require("./station/station-pressure.js");
const railModule = require("./station/station-machine-rail.js");
const calc = require("./pressure-conversion.js");

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
  assert.ok(panel, "the converter built");
  panel.panel.rect = { left: 16, top: 12, width: 600, height: 372 };
  const q = selector => panel.element.querySelector(selector);
  const face = unit => panel.element.querySelectorAll(".station-pressure__face").find(n => n.getAttribute("data-unit") === unit);
  return {
    doc, animations, anchor, panel, q, opened, face,
    input: unit => face(unit).querySelector("input"),
    dial: unit => face(unit).querySelector(".station-pressure__dial"),
    needle: unit => face(unit).querySelector("[data-role='needle']"),
    figures: unit => face(unit).querySelectorAll(".station-pressure__figure").map(n => n.textContent),
    readout: () => q(".station-window__readout"),
    note: () => q(".station-pressure__note"),
    chips: () => panel.element.querySelectorAll("[data-role='reference']")
  };
}

test("closed by construction: the panel is hidden, a region on the glass, no dialog; PSI on the left, bar on the right, the link between; no entry, no reading, both needles on the zero stop, the application's own notice; the tile says it is closed", () => {
  const h = build();
  assert.ok(hidden(h.panel.panel));
  assert.equal(h.panel.panel.getAttribute("role"), "region");
  assert.equal(h.panel.panel.getAttribute("aria-label"), "Pressure");
  assert.ok(h.panel.panel.classList.contains("station-glass"));
  assert.ok(h.panel.panel.classList.contains("station-window__panel"));
  assert.ok(h.panel.panel.classList.contains("station-pressure__panel"));
  assert.equal(h.panel.element.getAttribute("data-window"), "pressure");
  assert.equal(h.panel.element.getAttribute("data-role"), "pressure");
  assert.equal(h.q(".station-window__title").textContent, "Pressure");
  assert.equal(h.q("[data-action='close-pressure']").getAttribute("aria-label"), "Close");
  // The faces, in order, the link between them.
  const faces = h.q("[data-role='faces']");
  assert.equal(faces.nodeName, "form");
  assert.deepEqual(faces.children.map(n => n.getAttribute("data-unit") || n.getAttribute("class")), ["psi", "station-pressure__link", "bar"]);
  assert.equal(h.face("psi").querySelector(".station-pressure__unit").textContent, "PSI");
  assert.equal(h.face("bar").querySelector(".station-pressure__unit").textContent, "bar");
  assert.equal(h.q("[data-role='factor-bar']").textContent, "× 0.0689");
  assert.equal(h.q("[data-role='factor-psi']").textContent, "× 14.50");
  // Each dial: the arc, minor and major ticks, five figures, the needle on its pivot.
  for (const unit of ["psi", "bar"]) {
    const dial = h.dial(unit);
    assert.equal(dial.getAttribute("viewBox"), "0 0 100 76");
    assert.equal(dial.getAttribute("role"), "img");
    assert.deepEqual(dial.children.map(n => n.getAttribute("class")), [
      "station-pressure__arc", "station-pressure__tick station-pressure__tick--minor", "station-pressure__tick station-pressure__tick--major",
      "station-pressure__figure", "station-pressure__figure", "station-pressure__figure", "station-pressure__figure", "station-pressure__figure",
      "station-pressure__needle", "station-pressure__pivot"
    ]);
    assert.equal(h.needle(unit).getAttribute("transform-origin"), "50 52", "the needle turns about the pivot");
    assert.equal(h.needle(unit).getAttribute("data-angle"), "-115", "on the zero stop");
    assert.equal(h.needle(unit).style.transform, "rotate(-115deg)");
    assert.deepEqual(h.figures(unit), ["", "", "", "", ""], "no figures before a reading");
    assert.equal(h.face(unit).getAttribute("data-live"), "false");
    assert.match(dial.getAttribute("aria-label"), /no reading/);
    const input = h.input(unit);
    assert.equal(input.getAttribute("inputmode"), "decimal");
    assert.equal(input.getAttribute("data-unit"), unit);
    assert.equal(input.value, "");
  }
  assert.equal(h.face("psi").getAttribute("data-source"), "true", "psi is the face the first entry is on");
  assert.equal(h.face("bar").getAttribute("data-source"), "false");
  assert.equal(h.readout().textContent, "Enter a pressure in psi or bar");
  assert.ok(h.readout().classList.contains("is-unset"));
  assert.equal(h.q("[data-role='notice']").textContent, calc.NOTICE);
  assert.ok(hidden(h.note()));
  assert.equal(h.anchor.getAttribute("aria-expanded"), "false");
  assert.equal(h.panel.isOpen(), false);
  assert.equal(h.panel.result(), null);
  assert.equal(h.panel.source(), "psi");
  // The geometry the dial is drawn from: a 230-degree sweep centred on twelve o'clock.
  assert.equal(surfaceModule.DIAL.sweep, 230);
  assert.equal(surfaceModule.angleFor(0), -115);
  assert.equal(surfaceModule.angleFor(0.5), 0);
  assert.equal(surfaceModule.angleFor(1), 115);
  assert.equal(surfaceModule.angleFor(2), 115, "held within the stops");
  assert.equal(surfaceModule.angleFor(NaN), -115);
  assert.match(surfaceModule.arcPath(), /^M [\d.]+ [\d.]+ A 36 36 0 1 1 [\d.]+ [\d.]+$/);
  assert.equal((surfaceModule.ticksPath(true).match(/M /g) || []).length, 5);
  assert.equal((surfaceModule.ticksPath(false).match(/M /g) || []).length, 12);
});

test("an entry on the PSI face gives the bar face its reading through the application's own arithmetic: the source scale round off the ladder, the other the same pressure converted, both needles at one angle; the readout says both", () => {
  const h = build();
  input(h.input("psi"), "100");
  const answer = h.panel.result();
  assert.equal(answer.from, "psi");
  assert.equal(answer.psi, 100);
  assert.ok(Math.abs(answer.bar - calc.psiToBar(100)) < 1e-12);
  assert.equal(h.input("bar").value, "6.89", "the other face's entry is the answer, as its face reads");
  assert.deepEqual(h.panel.entries(), { psi: "100", bar: "6.89" });
  assert.equal(h.face("psi").getAttribute("data-source"), "true");
  assert.equal(h.face("bar").getAttribute("data-source"), "false");
  assert.equal(h.face("psi").getAttribute("data-live"), "true");
  assert.equal(h.face("bar").getAttribute("data-live"), "true");
  // The source's scale is 100: its quarters are round.
  assert.deepEqual(h.figures("psi"), ["0", "25", "50", "75", "100"]);
  // The other's scale is 100 psi in bar: its quarters are the same pressures.
  assert.deepEqual(h.figures("bar"), ["0.00", "1.72", "3.45", "5.17", "6.89"]);
  // Full scale: both needles on the far stop.
  assert.equal(h.needle("psi").getAttribute("data-angle"), "115");
  assert.equal(h.needle("bar").getAttribute("data-angle"), "115");
  assert.equal(h.needle("bar").style.transform, "rotate(115deg)");
  assert.equal(h.readout().textContent, "100.0 psi · 6.89 bar");
  assert.ok(!h.readout().classList.contains("is-unset"));
  assert.match(h.dial("psi").getAttribute("aria-label"), /PSI gauge reading 100\.0 of 100\.0/);
  assert.match(h.dial("bar").getAttribute("aria-label"), /bar gauge reading 6\.89 of 6\.89/);
  // A step down the ladder: 50 reads on a 60 face, both needles at the same place.
  input(h.input("psi"), "50");
  assert.deepEqual(h.figures("psi"), ["0", "15", "30", "45", "60"]);
  assert.deepEqual(h.figures("bar"), ["0.00", "1.03", "2.07", "3.10", "4.14"]);
  const angle = String(Number(surfaceModule.angleFor(50 / 60).toFixed(2)));
  assert.equal(h.needle("psi").getAttribute("data-angle"), angle);
  assert.equal(h.needle("bar").getAttribute("data-angle"), angle);
  assert.equal(h.input("bar").value, "3.45");
  // Half scale: both needles at twelve o'clock.
  input(h.input("psi"), "45");
  assert.deepEqual(h.figures("psi"), ["0", "15", "30", "45", "60"]);
  assert.equal(h.needle("psi").getAttribute("data-angle"), String(Number(surfaceModule.angleFor(0.75).toFixed(2))));
  assert.equal(h.needle("bar").getAttribute("data-angle"), h.needle("psi").getAttribute("data-angle"));
  input(h.input("psi"), "7.5");
  assert.deepEqual(h.figures("psi"), ["0", "3.75", "7.5", "11.25", "15"]);
  assert.equal(h.needle("psi").getAttribute("data-angle"), "0");
  assert.equal(h.needle("bar").getAttribute("data-angle"), "0");
  // A step up the ladder.
  input(h.input("psi"), "101");
  assert.deepEqual(h.figures("psi"), ["0", "37.5", "75", "112.5", "150"]);
  assert.equal(h.input("bar").value, "6.96");
});

test("an entry on the bar face the other way: bar is the source with the round scale, psi follows; the face last typed on is the source; a reference chip sets a psi entry", () => {
  const h = build();
  input(h.input("bar"), "7");
  assert.equal(h.panel.source(), "bar");
  const answer = h.panel.result();
  assert.equal(answer.from, "bar");
  assert.equal(answer.bar, 7);
  assert.equal(h.input("psi").value, "101.5");
  assert.equal(h.face("bar").getAttribute("data-source"), "true");
  assert.equal(h.face("psi").getAttribute("data-source"), "false");
  assert.deepEqual(h.figures("bar"), ["0", "3.75", "7.5", "11.25", "15"]);
  assert.deepEqual(h.figures("psi"), ["0.0", "54.4", "108.8", "163.2", "217.6"]);
  // 7 of 15: both needles at the same place.
  const angle = surfaceModule.angleFor(7 / 15).toFixed(2);
  assert.equal(h.needle("bar").getAttribute("data-angle"), String(Number(angle)));
  assert.equal(h.needle("psi").getAttribute("data-angle"), String(Number(angle)));
  assert.equal(h.readout().textContent, "101.5 psi · 7.00 bar");
  // Typing on the psi face takes the source back.
  input(h.input("psi"), "30");
  assert.equal(h.panel.source(), "psi");
  assert.equal(h.input("bar").value, "2.07");
  assert.deepEqual(h.figures("psi"), ["0", "7.5", "15", "22.5", "30"]);
  // The reference strip: the eight common pressures, one click each.
  const chips = h.chips();
  assert.deepEqual(chips.map(c => c.getAttribute("data-psi")), ["15", "30", "60", "100", "250", "500", "1000", "3000"]);
  assert.deepEqual(chips.map(c => c.children.map(n => n.textContent)), [
    ["15", "1.03"], ["30", "2.07"], ["60", "4.14"], ["100", "6.89"], ["250", "17.24"], ["500", "34.47"], ["1000", "68.95"], ["3000", "206.84"]
  ]);
  for (const chip of chips) assert.ok(chip.classList.contains("station-handbook__chip"), "the Handbook's chip");
  chips[6].click();
  assert.equal(h.panel.source(), "psi");
  assert.equal(h.input("psi").value, "1000");
  assert.equal(h.input("bar").value, "68.95");
  assert.deepEqual(h.figures("psi"), ["0", "250", "500", "750", "1000"]);
  assert.equal(h.readout().textContent, "1000.0 psi · 68.95 bar");
});

test("a blank or refused entry leaves no stale reading: the other face's entry is cleared, the figures go, both needles rest on the zero stop, the refused field is marked and named, the readout says what is missing", () => {
  const h = build();
  input(h.input("psi"), "100");
  assert.equal(h.input("bar").value, "6.89");
  input(h.input("psi"), "");
  assert.equal(h.panel.result(), null);
  assert.equal(h.input("bar").value, "", "the answer went with the entry");
  assert.deepEqual(h.panel.entries(), { psi: "", bar: "" });
  assert.deepEqual(h.figures("psi"), ["", "", "", "", ""]);
  assert.deepEqual(h.figures("bar"), ["", "", "", "", ""]);
  assert.equal(h.needle("psi").getAttribute("data-angle"), "-115");
  assert.equal(h.needle("bar").getAttribute("data-angle"), "-115");
  assert.equal(h.face("psi").getAttribute("data-live"), "false");
  assert.equal(h.readout().textContent, "Enter a pressure in psi or bar");
  assert.ok(h.readout().classList.contains("is-unset"));
  assert.ok(hidden(h.note()));
  assert.equal(h.input("psi").getAttribute("aria-invalid"), null);
  // A refused entry on the bar face.
  input(h.input("bar"), "-2");
  assert.equal(h.panel.result(), null);
  assert.equal(h.input("bar").getAttribute("aria-invalid"), "true");
  assert.equal(h.input("bar").getAttribute("title"), "Pressure in bar cannot be negative.");
  assert.equal(h.input("psi").getAttribute("aria-invalid"), null);
  assert.equal(h.input("psi").value, "");
  assert.ok(!hidden(h.note()));
  assert.equal(h.note().textContent, "Pressure in bar cannot be negative.");
  assert.equal(h.note().getAttribute("data-kind"), "error");
  assert.equal(h.readout().textContent, "Check the entry");
  assert.equal(h.face("bar").getAttribute("data-source"), "true", "the refused face is still the source");
  // Corrected: the mark goes, the answer comes.
  input(h.input("bar"), "2");
  assert.equal(h.input("bar").getAttribute("aria-invalid"), null);
  assert.equal(h.input("bar").getAttribute("title"), null);
  assert.ok(hidden(h.note()));
  assert.equal(h.input("psi").value, "29.0");
  // Submitting the form recomputes and navigates nowhere.
  const submit = makeEvent("submit");
  h.q("[data-role='faces']").dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(h.input("psi").value, "29.0");
});

test("opening is a flight out of the tile on the transition's tokens, closing reverses it, reduced motion drops the travel; Close, Escape and close() all return to the tile; the source face's entry takes the focus; the entries survive", async () => {
  const h = build();
  input(h.input("bar"), "5");
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
  assert.equal(focused, h.input("bar"), "the face last typed on takes the focus");
  // Close before the flight lands: the same animations run backwards.
  assert.equal(h.panel.close(), true);
  assert.equal(travel.reversed, 1);
  assert.equal(h.anchor.getAttribute("aria-expanded"), "false");
  assert.equal(focused, h.anchor, "the focus returns to the tile");
  travel.finish(); fade.finish();
  await tick(); await tick();
  assert.ok(hidden(h.panel.panel));
  assert.deepEqual(h.opened, [true, false]);
  assert.deepEqual(h.panel.entries(), { psi: "72.5", bar: "5" }, "closing keeps the entries");
  assert.equal(h.input("psi").value, "72.5");
  // Open again: Escape on the window closes it and stops there.
  h.panel.open();
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  h.input("psi").dispatchEvent(escape);
  assert.ok(escape.stopped, "Escape is the window's, not the stage's");
  assert.equal(h.panel.isOpen(), false);
  h.panel.open();
  h.q("[data-action='close-pressure']").click();
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

test("the surface dispatches nothing, reaches for nothing, restates no factor and knows nothing of the Handbook", () => {
  const source = read("station/station-pressure.js");
  for (const forbidden of [/\.dispatch\s*\(/, /PolynStationCommandBridge/, /localStorage|sessionStorage/, /fetch\s*\(/, /document\./, /PolynStationHandbook/, /\.animate\s*\(/, /requestAnimationFrame|setInterval|setTimeout/]) {
    assert.doesNotMatch(source, forbidden, `the surface reaches out through ${forbidden}`);
  }
  // The factor lives in pressure-conversion.js alone.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /14\.50|0\.0689|6894/);
  assert.match(source, /calc\.convert\(\{ value, from \}\)/);
  assert.match(source, /calc\.scaleFor\(/);
  assert.match(source, /calc\.format\(/);
  assert.match(source, /calc\.reference\(\)/);
  assert.match(source, /calc\.BAR_PER_PSI/);
  assert.match(source, /calc\.PSI_PER_BAR/);
});

/* ----------------------------------------------------------------------
 *   The rail's Tools row
 * -------------------------------------------------------------------- */

test("the Tools row's third tile is Pressure, after Resin Totals: a gauge glyph in the rail's own vocabulary; held until the boot file says the window stands; the click handed back; the tile shows the window's state", () => {
  focused = null;
  const doc = fakeDocument();
  const clicks = [];
  const rail = railModule.create(doc, { onTools: () => clicks.push("tools"), onPressure: () => clicks.push("pressure") });
  assert.deepEqual(rail.toolsRow.children.map(node => node.getAttribute("data-action")), ["winding-tension", "resin-totals", "pressure"]);
  assert.equal(rail.pressureButton.getAttribute("aria-label"), "Pressure");
  assert.equal(rail.pressureButton.textContent, "");
  assert.equal(railModule.LABEL.pressure, "Pressure");
  const svg = rail.pressureButton.children[0];
  assert.equal(svg.getAttribute("viewBox"), "0 0 64 64");
  assert.deepEqual(svg.children.map(node => node.getAttribute("class")), ["station-rail__glyph-plate", "station-rail__glyph-art"]);
  walk(svg, node => assert.match(node.getAttribute("class") || "", /^station-rail__glyph/));
  // The gauge: the case, the ticks over the top, the needle to the upper right, the pivot.
  const art = svg.children[1].children.map(node => [node.nodeName, node.getAttribute("class").replaceAll("station-rail__glyph-", "")]);
  assert.deepEqual(art, [["circle", "face"], ["path", "row"], ["path", "stroke stroke--bold"], ["circle", "stroke"]]);
  assert.equal(svg.children[1].children[2].getAttribute("d"), "M 10 10.5 L 13.6 6.6");
  assert.equal(rail.pressureButton.disabled, true);
  assert.equal(rail.getState().pressure.available, false);
  rail.update({ hidden: false, tools: { open: true, available: true }, pressure: { active: false, available: true } });
  assert.equal(rail.pressureButton.disabled, false);
  assert.equal(rail.pressureButton.getAttribute("aria-pressed"), "false");
  assert.match(rail.pressureButton.getAttribute("title"), /psi to bar, and bar to psi/);
  rail.pressureButton.click();
  assert.deepEqual(clicks, ["pressure"], "the click is handed back; the rail waits to be told");
  assert.equal(rail.pressureButton.getAttribute("aria-pressed"), "false");
  rail.update({ pressure: { active: true, available: true } });
  assert.equal(rail.pressureButton.getAttribute("aria-pressed"), "true");
  assert.ok(rail.pressureButton.classList.contains("is-active"));
  assert.match(rail.pressureButton.getAttribute("title"), /open — click to close the converter/);
  assert.deepEqual(rail.getState().pressure, { active: true, available: true });
  rail.update({ pressure: { active: false, available: false } });
  assert.equal(rail.pressureButton.disabled, true);
  assert.match(rail.pressureButton.getAttribute("title"), /not available on this page/);
});

/* ----------------------------------------------------------------------
 *   Station booted for real
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const files = [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(files.includes("station/station-pressure.js"), "the host loads the converter");
  return files.filter(file => file !== "station/station.js");
}

const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "changeover-estimate.js", "winding-tension.js", "pressure-conversion.js", "resin-totals.js", "workspace-configuration-payloads.js",
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

function boot(options) {
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
  const skip = (options && options.skip) || [];
  for (const file of SHARED.concat(hostScripts())) {
    if (skip.includes(file)) continue;
    new vm.Script(read(file), { filename: file }).runInContext(context);
  }

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
  const tile = q("[data-action='pressure']");
  const panel = q(".station-pressure__panel");
  const winding = q(".station-winding__panel");
  const windingTile = q("[data-action='winding-tension']");
  const totals = q(".station-totals__panel");
  const totalsTile = q("[data-action='resin-totals']");
  const launcher = q(".station-handbook__launcher");
  assert.ok(machine && rail && tools && tile && launcher, "Station booted with its stage, rail, Tools, the tile and the Handbook");
  const face = unit => panel ? panel.querySelectorAll(".station-pressure__face").find(n => n.getAttribute("data-unit") === unit) : null;
  return {
    doc, window, calls, machine, rail, tools, tile, panel, winding, windingTile, totals, totalsTile, launcher, q,
    rowOpen: () => q("[data-role='tools-group'] .station-rail__flyout").getAttribute("data-open") === "true",
    open: () => tile.getAttribute("aria-expanded") === "true" && !hidden(panel),
    windingOpen: () => !hidden(winding),
    totalsOpen: () => !hidden(totals),
    handbookOpen: () => launcher.getAttribute("aria-expanded") === "true",
    stageKey: () => JSON.stringify(machine.querySelectorAll("[data-role='hopper']").map(h => [h.getAttribute("data-hopper"), h.getAttribute("data-state"), h.getAttribute("class")])),
    input: unit => face(unit).querySelector("input"),
    readout: () => panel.querySelector(".station-window__readout")
  };
}

test("booted: Pressure stands third on the Tools row; its tile opens the window in the utility slot out of itself and shows it; an entry converts; no command, no change to the stage; the tile again closes it; Tools folds the row and takes the window with it", () => {
  const s = boot();
  assert.deepEqual(s.rail.children.map(node => node.getAttribute("data-role")), ["blend-group", "next-group", "weights-group", "tools-group", "print-group"]);
  assert.deepEqual(s.q("[data-role='tools-row']").children.map(node => node.getAttribute("data-action")), ["winding-tension", "resin-totals", "pressure"]);
  assert.ok(s.panel, "the window was built");
  assert.ok(s.panel.closest("[data-station-mount='utility']"), "the window is in the utility slot");
  assert.ok(s.tile.closest("[data-station-mount='rail']"), "the tile is on the rail");
  assert.equal(s.tools.disabled, false);
  assert.equal(s.tile.disabled, false, "Pressure is offered: the page has the converter");
  assert.equal(s.rowOpen(), false);
  assert.equal(s.open(), false);
  const stage = s.stageKey();
  s.tools.click();
  assert.equal(s.rowOpen(), true);
  assert.equal(s.open(), false, "the row unfolds; nothing opens until a tool is clicked");
  s.tile.click();
  assert.equal(s.open(), true);
  assert.equal(s.tile.getAttribute("aria-pressed"), "true");
  assert.equal(focused, s.input("psi"));
  assert.equal(s.calls.length, 0, "no command");
  assert.equal(s.stageKey(), stage, "the stage is untouched");
  assert.ok(!s.rail.classList.contains("is-blend-active"), "no face turned over for it");
  input(s.input("psi"), "250");
  assert.equal(s.input("bar").value, "17.24");
  assert.equal(s.readout().textContent, "250.0 psi · 17.24 bar");
  input(s.input("bar"), "1");
  assert.equal(s.input("psi").value, "14.5");
  assert.equal(s.calls.length, 0, "an answer is not a command");
  // The tile again closes the window and keeps the row.
  s.tile.click();
  assert.equal(s.open(), false);
  assert.equal(s.tile.getAttribute("aria-pressed"), "false");
  assert.equal(s.rowOpen(), true);
  assert.equal(focused, s.tile, "the focus returns to the tile");
  // Open again, then fold the row: the window goes with it.
  s.tile.click();
  assert.equal(s.open(), true);
  s.tools.click();
  assert.equal(s.rowOpen(), false);
  assert.equal(s.open(), false);
  assert.equal(s.stageKey(), stage);
  assert.equal(s.calls.length, 0);
});

test("booted: the utility surfaces stand one at a time - Pressure closes Winding Tension and Resin Totals, and each closes it; the Changeover Calculator too; the Handbook stands open beside it and neither disturbs the other; the entry stands through all of it", () => {
  const s = boot();
  s.tools.click();
  s.windingTile.click();
  assert.equal(s.windingOpen(), true);
  s.tile.click();
  assert.equal(s.open(), true);
  assert.equal(s.windingOpen(), false, "Pressure took the band from Winding Tension");
  assert.equal(s.windingTile.getAttribute("aria-pressed"), "false");
  input(s.input("psi"), "60");
  assert.equal(s.input("bar").value, "4.14");
  s.totalsTile.click();
  assert.equal(s.totalsOpen(), true);
  assert.equal(s.open(), false, "and Resin Totals took it from Pressure");
  assert.equal(s.tile.getAttribute("aria-pressed"), "false");
  s.tile.click();
  assert.equal(s.open(), true);
  assert.equal(s.totalsOpen(), false);
  assert.equal(s.input("bar").value, "4.14", "the entry stood through the close");
  const changeover = s.doc.querySelectorAll(".station-job__trigger").find(n => n.getAttribute("data-field") === "changeover");
  changeover.click();
  assert.equal(hidden(s.q(".station-changeover__panel")), false);
  assert.equal(s.open(), false, "the Changeover Calculator took the band");
  assert.equal(s.rowOpen(), true, "the Tools row is still unfolded");
  s.tile.click();
  assert.equal(s.open(), true);
  assert.equal(hidden(s.q(".station-changeover__panel")), true, "and Pressure took it back");
  s.launcher.click();
  assert.equal(s.handbookOpen(), true);
  assert.equal(s.open(), true, "the Handbook and the converter stand open together");
  s.launcher.click();
  assert.equal(s.handbookOpen(), false);
  assert.equal(s.open(), true);
  assert.equal(s.input("bar").value, "4.14");
  s.q("[data-action='close-pressure']").click();
  assert.equal(s.open(), false);
  assert.equal(s.calls.length, 0);
});

test("booted without the arithmetic: no window is built, the tile is held and named unavailable, the Tools row still stands for the other tools", () => {
  const s = boot({ skip: ["pressure-conversion.js"] });
  assert.equal(s.panel, null, "no converter without its arithmetic");
  assert.equal(s.tile.disabled, true);
  assert.match(s.tile.getAttribute("title"), /not available on this page/);
  assert.equal(s.tools.disabled, false, "the row has Winding Tension and Resin Totals");
  s.tools.click();
  assert.equal(s.rowOpen(), true);
  assert.equal(s.calls.length, 0);
});

/* ----------------------------------------------------------------------
 *   Loading and the sheet
 * -------------------------------------------------------------------- */

test("the converter is loaded by the host and the harness after the window frame and the rail, before the boot file; its arithmetic is the application's own pressure-conversion.js, which index.html loads before the host; the floor UI is untouched and no legacy sheet styles the window", () => {
  const host = read("station-host.js");
  const scripts = [...host.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(scripts.indexOf("station/station-pressure.js") > scripts.indexOf("station/station-window.js"), "the window frame before the tool that stands in it");
  assert.ok(scripts.indexOf("station/station-pressure.js") > scripts.indexOf("station/station-machine-rail.js"));
  assert.ok(scripts.indexOf("station/station-pressure.js") > scripts.indexOf("station/station-winding-tension.js"), "third on the row, third in the list");
  assert.ok(scripts.indexOf("station/station-pressure.js") < scripts.indexOf("station/station.js"));
  assert.match(host, /"station\/styles\/components\/resin-totals\.css",\s*"station\/styles\/components\/pressure\.css"/);
  const harness = read("station/station.html");
  assert.match(harness, /station-pressure\.js\?v=/);
  assert.match(harness, /\.\.\/pressure-conversion\.js\?v=/);
  assert.match(harness, /components\/pressure\.css\?v=/);
  assert.ok(harness.indexOf("../pressure-conversion.js") < harness.indexOf("station-pressure.js"), "the arithmetic before the surface that reads it");
  assert.ok(harness.indexOf("station-window.js") < harness.indexOf("station-pressure.js"));
  const indexHtml = read("index.html");
  assert.match(indexHtml, /<script src="pressure-conversion\.js\?v=[^"]+" defer><\/script>/);
  assert.ok(indexHtml.indexOf('src="pressure-conversion.js') < indexHtml.indexOf('src="station-host.js'), "the host's modules read the global the application loaded");
  assert.doesNotMatch(indexHtml, /station-pressure|components\/pressure\.css/);
  const app = read("app.js");
  assert.doesNotMatch(app, /station-pressure|PolynStationPressure|PolynPressureConversion/);
  for (const sheet of fs.readdirSync(ROOT).filter(name => name.endsWith(".css"))) {
    assert.doesNotMatch(read(sheet), /station-pressure/, `${sheet} styles the converter`);
  }
  // The shared module is a UMD global like winding-tension.js, and pure.
  const shared = read("pressure-conversion.js");
  assert.match(shared, /root\.PolynPressureConversion = api/);
  for (const forbidden of [/\bdocument\b/, /\bwindow\b/, /localStorage/, /fetch\s*\(/]) assert.doesNotMatch(shared, forbidden);
});

test("the frame is a Station window's: the owner's sheet sets only its size from the pressure tokens, capped by the stage's cell; no media query but reduced motion, no raw colour, no keyframes; the needle's one motion is a transition on the move tokens, off under reduced motion; every rule is namespaced", () => {
  const raw = read("station/styles/components/pressure.css");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sheet, name) => { const at = sheet.indexOf(`${name} {`); assert.ok(at >= 0, `${name} has no rule`); return sheet.slice(at, sheet.indexOf("}", at)); };
  const panel = rule(css, ".station-pressure__panel");
  assert.match(panel, /width: min\(var\(--station-pressure-width\), calc\(100% - 2 \* var\(--station-space-4\)\)\);/);
  assert.match(panel, /height: min\(var\(--station-pressure-height\), calc\(100% - 2 \* var\(--station-space-3\)\)\);/);
  assert.doesNotMatch(panel, /\s(max-height|min-height):|fit-content|max-content|height: auto/);
  assert.doesNotMatch(panel, /position|top:|left:|translate|transform|z-index/, "the frame's place is the window's, not the tool's");
  assert.doesNotMatch(panel, /\d+px|\d+vh|\d+vw/, "a raw length in the frame's rule");
  assert.doesNotMatch(css, /station-pressure__(head|close|body|readout|title)/, "the bar, Close and the body are the window's vocabulary");
  const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map(m => m[1].trim());
  assert.deepEqual(queries, ["(prefers-reduced-motion: reduce)"]);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(/i, "pressure.css names a colour");
  assert.doesNotMatch(css, /backdrop-filter/, "the material is the shared glass");
  assert.doesNotMatch(css, /@keyframes|animation:/, "nothing loops on the converter");
  const needle = rule(css, ".station-pressure__needle");
  assert.match(needle, /transition: transform var\(--station-motion-move\) var\(--station-motion-ease\);/);
  assert.match(needle, /transform-box: view-box;/, "the pivot is in the dial's own units");
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(reduced && /\.station-pressure__needle[\s\S]*transition: none/.test(reduced[1]), "no reduced-motion switch-off for the needle");
  const tokens = read("station/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(tokens, /--station-pressure-width: \d+px;/);
  assert.match(tokens, /--station-pressure-height: \d+px;/);
  // The chips are the Handbook's; the sheet only stacks their two readings.
  assert.match(css, /\.station-pressure__chips \.station-handbook__chip \{[^}]*flex-direction: column;/);
  assert.doesNotMatch(css, /\.station-handbook__chip[^{]*\{[^}]*(background|border|color):/, "the chip's look is the Handbook's");
});
