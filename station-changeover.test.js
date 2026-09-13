"use strict";

/* The Changeover Calculator (station/station-changeover.js): the header's
 * CHANGEOVER readout opened out into a utility surface.
 *
 * Two layers of test. The component alone, against a small fake DOM, a
 * fake storage and a recorded apply(): what it shows for a job, how the
 * answers become an estimate, what Use does and does not do, what a
 * refusal does, the deadline line, the running estimate, the flight and
 * reduced motion. Then Station booted for real - every module the host
 * loads, in the host's order, over the same fake DOM the other boot tests
 * use, with the bridges connected as app.js connects them - to drive the
 * header's readout, the surface it opens, the Handbook beside it and the
 * one command Use sends through the job controls.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const changeoverModule = require("./station/station-changeover.js");
const calc = require("./changeover-estimate.js");
const scheduling = require("./scheduling.js");
const rundown = require("./station/station-rundown.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const NOW = new Date(2026, 8, 12, 14, 3, 20).getTime();

/* ----------------------------------------------------------------------
 *   A fake DOM (the boot tests' one: enough for the shell, the renderer,
 *   the editor, the Handbook, the calculator and the delegated listeners)
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
  const storage = fakeStorage(options && options.stored);
  const applied = [];
  const animations = [];
  const anchor = doc.createElement("button");
  anchor.rect = { left: 300, top: 12, width: 160, height: 28 };
  const settings = Object.assign({
    apply: at => { applied.push(at); return options && options.refuse ? { ok: false, code: "out_of_range", message: options.refuse } : { ok: true, changed: true, revision: applied.length }; },
    canApply: () => !(options && options.readOnly),
    storage,
    now: () => (options && options.now) || NOW,
    anchor,
    animate: (element, keyframes, opts) => { const animation = fakeAnimation(element, keyframes, opts); animations.push(animation); return animation; },
    measure: element => element.rect,
    reducedMotion: () => !!(options && options.reducedMotion)
  }, (options && options.settings) || {});
  const panel = changeoverModule.create(doc, settings);
  assert.ok(panel, "the calculator built");
  panel.panel.rect = { left: 200, top: 64, width: 820, height: 292 };
  const q = selector => panel.element.querySelector(selector);
  return {
    doc, storage, applied, animations, anchor, panel, q,
    field: name => q(`.station-changeover__form input[data-field='${name}']`),
    chip: (field, value) => panel.element.querySelectorAll(`[data-field='${field}'][data-value='${value}']`)[0],
    deadline: () => q(".station-changeover__time"),
    use: () => q("[data-action='use-estimate']"),
    note: () => q(".station-changeover__note"),
    result: () => q(".station-changeover__result"),
    resultTime: () => q(".station-changeover__result-time"),
    resultDetail: () => q(".station-changeover__result-detail"),
    running: () => q("[data-role='production-estimate']"),
    readout: () => q(".station-changeover__readout")
  };
}

const ANSWERS = { lineSpeed: "100", footagePerRoll: "1000", numberUp: 4, bothWinders: false, hours: 2, minutes: 15, rollsLeft: "18" };

function fillAnswers(h, answers) {
  const a = Object.assign({}, ANSWERS, answers || {});
  input(h.field("lineSpeed"), a.lineSpeed);
  input(h.field("footagePerRoll"), a.footagePerRoll);
  input(h.field("rollsLeft"), a.rollsLeft);
  input(h.field("hours"), a.hours);
  input(h.field("minutes"), a.minutes);
  h.chip("numberUp", a.numberUp).click();
  h.chip("bothWinders", a.bothWinders).click();
}

test("closed by construction: the panel is hidden, a region, no dialog, in the glass; the readout states the job as the header does", () => {
  const h = build();
  assert.ok(hidden(h.panel.panel));
  assert.equal(h.panel.panel.getAttribute("role"), "region");
  assert.equal(h.panel.panel.getAttribute("aria-label"), "Changeover Calculator");
  assert.ok(h.panel.panel.classList.contains("station-glass"), "the surface wears the shared glass");
  walk(h.panel.element, node => {
    assert.notEqual(node.getAttribute("role"), "dialog");
    assert.doesNotMatch(String(node.getAttribute("class") || ""), /backdrop|overlay|modal|scrim/);
  });
  h.panel.update({ job: { lineRate: 850, changeoverTime: "16:30", changeoverSetAt: NOW } });
  h.panel.open();
  assert.equal(h.readout().textContent, `${rundown.formatClock(new Date(2026, 8, 12, 16, 30).getTime())} · in 2h 26m`);
  assert.equal(h.deadline().value, "16:30");
  h.panel.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  assert.equal(h.readout().textContent, "Not set");
  assert.ok(h.readout().classList.contains("is-unset"));
  assert.equal(h.deadline().value, "");
  h.panel.update({ job: { lineRate: 850, changeoverTime: "16:30", changeoverSetAt: NOW - 21 * rundown.HOUR } });
  assert.match(h.readout().textContent, /· confirm$/);
  assert.ok(h.readout().classList.contains("is-stale"));
});

test("the answers are the wizard's own record: restored from the device on build, saved as typed, as the wizard saves them", () => {
  const stored = { [calc.STORAGE_KEYS.answers]: JSON.stringify({ lineSpeed: "90", footagePerRoll: "1500", numberUp: 2, bothWinders: false, hours: 1, minutes: 5, rollsLeft: "40" }) };
  const h = build({ stored });
  h.panel.open();
  assert.equal(h.field("lineSpeed").value, "90");
  assert.equal(h.field("footagePerRoll").value, "1500");
  assert.equal(h.field("rollsLeft").value, "40");
  assert.equal(h.field("hours").value, "1");
  assert.equal(h.field("minutes").value, "5");
  assert.equal(h.chip("numberUp", 2).getAttribute("aria-checked"), "true");
  assert.equal(h.chip("numberUp", 1).getAttribute("aria-checked"), "false");
  assert.equal(h.chip("bothWinders", false).getAttribute("aria-checked"), "true");
  input(h.field("lineSpeed"), "120");
  h.chip("numberUp", 3).click();
  h.chip("bothWinders", true).click();
  assert.deepEqual(JSON.parse(h.storage.map.get(calc.STORAGE_KEYS.answers)),
    { lineSpeed: "120", footagePerRoll: "1500", numberUp: 3, bothWinders: true, hours: 1, minutes: 5, rollsLeft: "40" });
  assert.deepEqual(h.panel.answers(), calc.readAnswers(h.storage));
  // Ten chips for up, two for the winders, radio semantics.
  assert.equal(h.panel.element.querySelectorAll("[data-field='numberUp'][data-value]").length, 10);
  assert.equal(h.panel.element.querySelectorAll("[data-field='bothWinders'][data-value]").length, 2);
  assert.equal(h.chip("numberUp", 3).getAttribute("role"), "radio");
});

test("the estimate follows the answers live, through the application's own arithmetic; Use carries the estimated instant and starts the running estimate", () => {
  const h = build();
  h.panel.open();
  assert.equal(h.resultTime().textContent, "—");
  assert.match(h.resultDetail().textContent, /Enter the line speed/);
  assert.ok(h.use().hasAttribute("disabled"));
  fillAnswers(h);
  const expected = calc.estimate(ANSWERS, NOW);
  assert.equal(expected.remainingMinutes, 175);
  assert.equal(h.resultTime().textContent, rundown.formatClock(NOW + 175 * 60000));
  assert.equal(h.resultDetail().textContent, "2 hr 55 min remaining · 18 rolls · 4 rolls/set · 4 future sets");
  assert.ok(h.result().classList.contains("is-ready"));
  assert.ok(!h.use().hasAttribute("disabled"));
  assert.equal(h.use().textContent, `Use ${rundown.formatClock(NOW + 175 * 60000)}`);
  assert.deepEqual(h.panel.estimate(), expected);
  h.use().click();
  assert.deepEqual(h.applied, [expected.estimatedAt]);
  assert.equal(h.note().getAttribute("data-kind"), "ok");
  assert.match(h.note().textContent, /^Changeover set to /);
  // The running estimate the wizard's Use leaves: the record on the
  // device, and its words on the surface.
  const record = calc.readProductionEstimate(h.storage);
  assert.equal(record.startedAt, NOW);
  assert.equal(record.totalMinutesRemaining, 175);
  assert.ok(!hidden(h.running()));
  assert.equal(h.running().textContent, calc.formatProductionEstimate(calc.currentProductionEstimate(record, NOW)));
});

test("the wizard's validation stands: a refused answer is marked and named, Use is withheld, nothing is applied and nothing is recorded", () => {
  const h = build();
  h.panel.open();
  fillAnswers(h, { lineSpeed: "0" });
  assert.equal(h.field("lineSpeed").getAttribute("aria-invalid"), "true");
  assert.equal(h.field("footagePerRoll").getAttribute("aria-invalid"), null);
  assert.equal(h.resultDetail().textContent, "Enter a value greater than zero.");
  assert.ok(h.use().hasAttribute("disabled"));
  assert.equal(h.panel.use(), null);
  assert.equal(h.note().textContent, "Enter a value greater than zero.");
  assert.deepEqual(h.applied, []);
  assert.equal(h.storage.map.has(calc.STORAGE_KEYS.estimate), false);
  input(h.field("rollsLeft"), "-3");
  input(h.field("lineSpeed"), "100");
  assert.equal(h.field("lineSpeed").getAttribute("aria-invalid"), null);
  assert.equal(h.field("rollsLeft").getAttribute("aria-invalid"), "true");
  assert.equal(h.resultDetail().textContent, "Enter zero or more rolls.");
  input(h.field("minutes"), "75");
  input(h.field("rollsLeft"), "3");
  assert.equal(h.resultDetail().textContent, "Minutes must be 0 to 59.");
  input(h.field("minutes"), "15");
  assert.ok(h.result().classList.contains("is-ready"));
  // Blank fields are not wrong, only not yet answered.
  input(h.field("lineSpeed"), "");
  assert.equal(h.field("lineSpeed").getAttribute("aria-invalid"), null);
  assert.equal(h.resultDetail().textContent, "Enter a value greater than zero.");
});

test("a refusal from the application keeps the surface where it was, says why, and records no estimate", () => {
  const h = build({ refuse: "That changeover time has already passed." });
  h.panel.open();
  fillAnswers(h);
  h.use().click();
  assert.equal(h.applied.length, 1);
  assert.equal(h.note().getAttribute("data-kind"), "error");
  assert.equal(h.note().textContent, "That changeover time has already passed.");
  assert.equal(h.storage.map.has(calc.STORAGE_KEYS.estimate), false, "a refused Use starts no running estimate");
  assert.ok(hidden(h.running()));
  assert.ok(h.panel.isOpen());
  assert.equal(h.field("lineSpeed").value, "100", "the answers stand");
});

test("the deadline line sets and clears the job's changeover through apply, reading a clock time as the application would; garbage never leaves the field", () => {
  const h = build();
  h.panel.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  h.panel.open();
  h.deadline().focus();
  h.deadline().value = "03:28";
  h.deadline().dispatchEvent(makeEvent("input", { bubbles: true }));
  h.q("[data-action='set-deadline']").click();
  const expected = scheduling.parseChangeoverDate("03:28", new Date(NOW)).getTime();
  assert.deepEqual(h.applied, [expected]);
  assert.ok(expected > NOW, "03:28 has passed today, so it is tomorrow's");
  assert.match(h.note().textContent, /^Changeover set to /);
  h.q("[data-action='clear-deadline']").click();
  assert.deepEqual(h.applied, [expected, null]);
  assert.equal(h.note().textContent, "Changeover cleared.");
  h.deadline().value = "soon";
  h.deadline().dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(h.applied.length, 2);
  assert.equal(h.deadline().getAttribute("aria-invalid"), "true");
  assert.match(h.note().textContent, /hours and minutes/);
  // A job published while the operator is in the field does not overwrite
  // what they are typing - nor does leaving the field: the pointer moving
  // to Set blurs it first, and what was typed is what Set must read.
  h.deadline().value = "17:4";
  h.deadline().dispatchEvent(makeEvent("input", { bubbles: true }));
  h.panel.update({ job: { lineRate: 850, changeoverTime: "18:00", changeoverSetAt: NOW } });
  assert.equal(h.deadline().value, "17:4");
  h.deadline().blur();
  assert.equal(h.deadline().value, "17:4", "a typed time survives the blur");
  // Emptied and left, the field follows the job again.
  h.deadline().focus();
  h.deadline().value = "";
  h.deadline().dispatchEvent(makeEvent("input", { bubbles: true }));
  h.deadline().blur();
  assert.equal(h.deadline().value, "18:00");
  // Typed, blurred, then Set: the typed time is what is applied.
  h.deadline().focus();
  h.deadline().value = "19:15";
  h.deadline().dispatchEvent(makeEvent("input", { bubbles: true }));
  h.deadline().blur();
  h.q("[data-action='set-deadline']").click();
  assert.equal(h.applied[h.applied.length - 1], scheduling.parseChangeoverDate("19:15", new Date(NOW)).getTime());
  // Setting the deadline directly starts no running estimate: that is the
  // calculator's Use, as in the wizard.
  assert.equal(h.storage.map.has(calc.STORAGE_KEYS.estimate), false);
});

test("two routes to one deadline: a clock time typed at the top is Set with every calculator field blank; the answers and their record are not touched by it; typed answers apply nothing until Use; Clear clears the deadline whichever route set it", () => {
  const h = build();
  h.panel.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  h.panel.open();
  // Manual: the operator knows it is 11:00. No line speed, no footage, no
  // rolls - the answers are all blank - and Set applies the instant.
  assert.deepEqual(h.panel.answers(), calc.DEFAULT_ANSWERS);
  assert.equal(h.q("[data-action='use-estimate']").hasAttribute("disabled"), true, "nothing to Use yet");
  h.deadline().value = "11:00";
  h.deadline().dispatchEvent(makeEvent("input", { bubbles: true }));
  h.q("[data-action='set-deadline']").click();
  const eleven = scheduling.parseChangeoverDate("11:00", new Date(NOW)).getTime();
  assert.deepEqual(h.applied, [eleven]);
  assert.deepEqual(h.panel.answers(), calc.DEFAULT_ANSWERS, "the calculator's inputs are not touched");
  assert.equal(h.storage.map.has(calc.STORAGE_KEYS.estimate), false, "and no running estimate is invented");
  h.panel.update({ job: { lineRate: 850, changeoverTime: "11:00", changeoverSetAt: NOW } });
  // Calculated: the answers go in - the estimate reads live, the deadline
  // stands at 11:00 untouched until the operator chooses Use.
  fillAnswers(h, {});
  assert.ok(h.q(".station-changeover__result").classList.contains("is-ready"));
  assert.deepEqual(h.applied, [eleven], "typing answers applies nothing");
  assert.equal(h.deadline().value, "11:00");
  h.q("[data-action='use-estimate']").click();
  assert.equal(h.applied.length, 2);
  assert.equal(h.applied[1], h.panel.estimate().estimatedAt, "Use sets the same deadline the manual route does");
  assert.ok(h.storage.map.has(calc.STORAGE_KEYS.estimate));
  h.panel.update({ job: { lineRate: 850, changeoverTime: calc.clockValue(h.applied[1]), changeoverSetAt: NOW } });
  // Manual again, over a calculated deadline: the answers stay for next time.
  const before = JSON.stringify(h.panel.answers());
  h.deadline().value = "12:30";
  h.deadline().dispatchEvent(makeEvent("input", { bubbles: true }));
  h.q("[data-action='set-deadline']").click();
  assert.equal(h.applied[2], scheduling.parseChangeoverDate("12:30", new Date(NOW)).getTime());
  assert.equal(JSON.stringify(h.panel.answers()), before);
  // Clear: the one deadline, whichever route set it.
  h.q("[data-action='clear-deadline']").click();
  assert.equal(h.applied[3], null);
});

test("without the command on offer the surface is read-only: the estimate still reads, Use and the deadline are withheld and say why, nothing is applied", () => {
  const h = build({ readOnly: true });
  h.panel.open();
  assert.ok(h.panel.panel.classList.contains("is-readonly"));
  assert.ok(h.deadline().hasAttribute("disabled"));
  assert.ok(h.q("[data-action='set-deadline']").hasAttribute("disabled"));
  fillAnswers(h);
  assert.ok(h.result().classList.contains("is-ready"), "the arithmetic does not need the application");
  assert.ok(h.use().hasAttribute("disabled"));
  assert.match(h.use().getAttribute("title"), /Read-only here/);
  assert.equal(h.panel.use(), null);
  assert.match(h.note().textContent, /cannot be changed here: no application is connected/);
  assert.equal(h.panel.setDeadline(), null);
  assert.deepEqual(h.applied, []);
  // The answers are still the device's to keep.
  assert.equal(calc.readAnswers(h.storage).lineSpeed, "100");
});

test("the running estimate is re-derived from the clock on every refresh and goes, with its record, once the changeover point has passed", () => {
  const record = calc.buildProductionEstimate(ANSWERS, NOW - 60 * 60000);
  const stored = { [calc.STORAGE_KEYS.estimate]: JSON.stringify(record) };
  let now = NOW;
  const h = build({ stored, settings: { now: () => now } });
  h.panel.open();
  assert.ok(!hidden(h.running()));
  assert.equal(h.running().textContent, calc.formatProductionEstimate(calc.currentProductionEstimate(record, NOW)));
  now = NOW + 100 * 60000;
  h.panel.refresh();
  assert.equal(h.running().textContent, calc.formatProductionEstimate(calc.currentProductionEstimate(record, now)));
  now = NOW + 200 * 60000;
  h.panel.refresh();
  assert.ok(hidden(h.running()));
  assert.equal(h.running().textContent, "");
  assert.equal(h.storage.map.has(calc.STORAGE_KEYS.estimate), false, "the expired record is cleared, as the floor UI clears it");
});

test("opening is a flight out of the readout on the transition's tokens, closing reverses it, reduced motion drops the travel; Close, Escape and close() all return to the readout", async () => {
  const h = build();
  assert.equal(h.panel.open(), true);
  assert.ok(!hidden(h.panel.panel));
  assert.equal(h.anchor.getAttribute("aria-expanded"), "true");
  assert.ok(h.panel.element.classList.contains("is-open"));
  assert.ok(focused === h.field("lineSpeed"), "the first empty answer takes the focus");
  const flight = h.animations[0];
  assert.ok(flight.element === h.panel.panel);
  assert.match(flight.keyframes[0].transform, /^translate\(100px, -52px\) scale\(0\.\d+\)$/);
  assert.equal(flight.keyframes[1].transform, "none");
  assert.equal(flight.options.duration, changeoverModule.DEFAULT_TIMING.move);
  assert.equal(flight.options.easing, changeoverModule.DEFAULT_TIMING.ease);
  assert.equal(h.panel.open(), false, "already open");
  // Close mid-flight turns the same animations around.
  h.q("[data-action='close-changeover']").click();
  assert.equal(flight.reversed, 1);
  assert.equal(h.anchor.getAttribute("aria-expanded"), "false");
  assert.ok(focused === h.anchor, "focus returns to the readout");
  flight.finish(); h.animations[1].finish();
  await tick(); await tick();
  assert.ok(hidden(h.panel.panel));
  // Escape inside the panel closes it and is spent there.
  h.panel.open();
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  h.field("rollsLeft").dispatchEvent(escape);
  assert.ok(escape.stopped);
  assert.equal(h.panel.isOpen(), false);
  // Reduced motion: no animation, the state change at once.
  const r = build({ reducedMotion: true });
  r.panel.open();
  assert.equal(r.animations.length, 0);
  assert.ok(!hidden(r.panel.panel));
  r.panel.close();
  assert.equal(r.animations.length, 0);
  assert.ok(hidden(r.panel.panel));
  assert.equal(r.panel.toggle(), true);
  assert.equal(r.panel.toggle(), true);
  assert.equal(r.panel.isOpen(), false);
});

test("the surface dispatches nothing, reaches for nothing, and knows nothing of the Handbook's state", () => {
  const source = read("station/station-changeover.js").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pattern of [/\.dispatch\s*\(/, /localStorage/, /sessionStorage/, /\bfetch\s*\(/, /supabase/i, /PolynStationCommandBridge/, /PolynStationStateBridge/, /PolynStationHandbook/, /handbook__panel|handbook__launcher|isHandbookOpen/, /setInterval|requestAnimationFrame/]) {
    assert.doesNotMatch(source, pattern, `station-changeover.js matches ${pattern}`);
  }
  // The one write goes through the apply it is handed.
  assert.match(source, /const result = apply\(estimated\.estimatedAt\);/);
  assert.match(source, /const result = apply\(at\);/);
  // Storage is only ever the object it was handed, read and written by
  // the estimate module.
  assert.doesNotMatch(source, /storage\.(getItem|setItem|removeItem)/);
});

/* ----------------------------------------------------------------------
 *   Station booted for real
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const files = [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(files.includes("station/station-changeover.js"), "the host loads the calculator");
  return files.filter(file => file !== "station/station.js");
}

const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "changeover-estimate.js", "workspace-configuration-payloads.js",
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
  const settings = options || {};
  focused = null;
  const doc = fakeDocument();
  const storage = fakeStorage(settings.stored);
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
      const refused = typeof settings.refuse === "function" ? settings.refuse(command, args) : null;
      if (refused) return contract.failure("out_of_range", { message: refused });
      if (command === "setChangeover") {
        // As app.js's executor: the instant becomes the job's clock time.
        snap.job.changeoverTime = args.at === null ? "" : calc.clockValue(args.at);
        snap.job.changeoverSetAt = args.at === null ? null : Date.now();
      }
      snap.revision += 1;
      handle.publish();
      return contract.success({ changed: true, revision: stateBridge.getRevision(), persisted: true, snapshot: stateBridge.getSnapshot() });
    },
    capabilities: [...contract.COMMANDS]
  });
  new vm.Script(read("station/station.js"), { filename: "station/station.js" }).runInContext(context);

  const q = selector => doc.querySelector(selector);
  const machine = q("[data-station-mount='machine']");
  const readout = doc.querySelectorAll(".station-job__trigger").find(n => n.getAttribute("data-field") === "changeover");
  const panel = q(".station-changeover__panel");
  const launcher = q(".station-handbook__launcher");
  assert.ok(machine && readout && panel && launcher, "Station booted with its stage, readout, calculator and Handbook");
  return {
    doc, window, calls, machine, readout, panel, launcher, storage, q,
    state: () => snap,
    calcOpen: () => readout.getAttribute("aria-expanded") === "true" && !hidden(panel),
    handbookOpen: () => launcher.getAttribute("aria-expanded") === "true",
    stageKey: () => JSON.stringify(machine.querySelectorAll("[data-role='hopper']").map(h => [h.getAttribute("data-hopper"), h.getAttribute("data-state"), h.getAttribute("class")])),
    field: name => panel.querySelectorAll(".station-changeover__form input[data-field]").find(n => n.getAttribute("data-field") === name),
    chip: (field, value) => panel.querySelectorAll("[data-value]").find(n => n.getAttribute("data-field") === field && n.getAttribute("data-value") === String(value)),
    value: () => doc.querySelectorAll(".station-job__value")[1].textContent
  };
}

test("booted: clicking the header's CHANGEOVER readout opens the calculator in the utility slot - no field in the header, no command, no change to the stage or the job", () => {
  const s = boot();
  assert.ok(s.panel.closest("[data-station-mount='utility']"), "the surface is in the utility slot");
  assert.ok(!s.panel.closest("[data-station-mount='handbook']"));
  assert.ok(hidden(s.panel));
  assert.equal(s.readout.getAttribute("title"), "Changeover Calculator");
  assert.equal(s.readout.getAttribute("aria-disabled"), "false");
  const before = { stage: s.stageKey(), job: JSON.stringify(s.state().job), revision: s.state().revision, status: s.q("[data-station-mount='status']").textContent };
  s.readout.click();
  assert.ok(s.calcOpen(), "the calculator opened");
  assert.ok(hidden(s.q(".station-job__editor")) || !s.q(".station-job__item.is-editing"), "no in-place field opened in the header");
  assert.ok(!s.readout.closest(".station-job__item").classList.contains("is-editing"));
  assert.ok(s.readout.closest(".station-job__item").classList.contains("is-launched"));
  assert.deepEqual(s.calls, [], "opening dispatched nothing");
  assert.equal(s.stageKey(), before.stage, "the drawn hoppers are as they were");
  assert.equal(JSON.stringify(s.state().job), before.job);
  assert.equal(s.state().revision, before.revision);
  assert.equal(s.q("[data-station-mount='status']").textContent, before.status);
  assert.ok(s.panel.contains(s.doc.activeElement), "focus is in the surface");
  // Close returns to the readout; a second click reopens.
  s.panel.querySelector("[data-action='close-changeover']").click();
  assert.ok(!s.calcOpen());
  assert.ok(hidden(s.panel));
  assert.ok(focused === s.readout);
  assert.ok(!s.readout.closest(".station-job__item").classList.contains("is-launched"));
  s.readout.click();
  assert.ok(s.calcOpen());
  s.readout.click();
  assert.ok(!s.calcOpen(), "the readout toggles");
  assert.deepEqual(s.calls, []);
});

test("booted: Use sends one setChangeover through the job controls; the header readout then shows what the application holds, and the running estimate is on the device", () => {
  const s = boot();
  s.readout.click();
  input(s.field("lineSpeed"), "100");
  input(s.field("footagePerRoll"), "1000");
  input(s.field("rollsLeft"), "18");
  input(s.field("hours"), "2");
  input(s.field("minutes"), "15");
  s.chip("numberUp", 4).click();
  s.chip("bothWinders", false).click();
  const expected = s.panel.querySelector(".station-changeover__result-time").textContent;
  assert.notEqual(expected, "—");
  s.panel.querySelector("[data-action='use-estimate']").click();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].command, "setChangeover");
  const at = s.calls[0].args.at;
  assert.ok(Number.isFinite(at) && at > Date.now() + 170 * 60000 && at < Date.now() + 180 * 60000, "the estimated instant, about 175 minutes out");
  assert.equal(s.state().job.changeoverTime, calc.clockValue(at));
  assert.match(s.value(), /· in 2h 5\dm$/);
  assert.ok(s.calcOpen(), "the surface stays open after Use");
  assert.match(s.panel.querySelector(".station-changeover__note").textContent, /^Changeover set to /);
  const record = calc.readProductionEstimate(s.storage);
  assert.ok(record && record.totalMinutesRemaining === 175, "the running estimate is recorded on the device");
  assert.equal(calc.readAnswers(s.storage).rollsLeft, "18");
  assert.ok(!hidden(s.panel.querySelector("[data-role='production-estimate']")));
});

test("booted: the Handbook and the calculator stand open together; closing either leaves the other, and its state, exactly as it was", () => {
  const s = boot();
  s.readout.click();
  input(s.field("lineSpeed"), "77");
  s.launcher.click();
  assert.ok(s.calcOpen() && s.handbookOpen(), "both open");
  // Blend Edit on in the Handbook, with the calculator open.
  s.q(".station-handbook__panel [data-action='blend-edit']").click();
  assert.equal(s.machine.getAttribute("data-blend-edit"), "true");
  assert.ok(s.calcOpen(), "entering Blend Edit did not touch the calculator");
  assert.equal(s.field("lineSpeed").value, "77");
  s.panel.querySelector("[data-action='close-changeover']").click();
  assert.ok(!s.calcOpen() && s.handbookOpen(), "closing the calculator left the Handbook open");
  assert.equal(s.machine.getAttribute("data-blend-edit"), "true", "and Blend Edit on");
  s.readout.click();
  assert.equal(s.field("lineSpeed").value, "77", "the answers survived the close");
  s.q(".station-handbook__panel [data-action='close-handbook']").click();
  assert.ok(s.calcOpen() && !s.handbookOpen(), "closing the Handbook left the calculator open");
  assert.equal(s.machine.getAttribute("data-blend-edit"), null, "Blend Edit ended with the Handbook, as before");
  assert.equal(s.field("lineSpeed").value, "77");
  assert.deepEqual(s.calls, []);
});

/* ----------------------------------------------------------------------
 *   Where it lives, and where it does not
 * -------------------------------------------------------------------- */

test("the calculator is loaded by the host and the harness after the job controls; its logic module is a shared application module index.html loads, like scheduling.js; the floor UI's wizard is untouched", () => {
  const host = read("station-host.js");
  const scripts = [...host.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(scripts.indexOf("station/station-changeover.js") > scripts.indexOf("station/station-job-controls.js"));
  assert.ok(scripts.indexOf("station/station-changeover.js") < scripts.indexOf("station/station.js"));
  assert.match(host, /"station\/styles\/components\/glass\.css",\s*"station\/styles\/components\/handbook\.css",\s*"station\/styles\/components\/changeover\.css"/);
  const harness = read("station/station.html");
  assert.match(harness, /station-changeover\.js\?v=/);
  assert.match(harness, /\.\.\/changeover-estimate\.js\?v=/);
  assert.match(harness, /components\/glass\.css\?v=/);
  assert.match(harness, /components\/changeover\.css\?v=/);
  const indexHtml = read("index.html");
  assert.match(indexHtml, /<script src="changeover-estimate\.js\?v=[^"]+" defer><\/script>/);
  assert.doesNotMatch(indexHtml, /station-changeover|changeover\.css|glass\.css|station-utility/);
  // The mobile and desktop wizard, as it was.
  assert.match(indexHtml, /id="changeoverWizardTrigger"/);
  assert.match(indexHtml, /id="desktopChangeoverWizardTrigger"/);
  assert.match(indexHtml, /<dialog id="changeoverWizardDialog"/);
  const app = read("app.js");
  assert.match(app, /document\.querySelectorAll\("\[data-changeover-wizard-trigger\]"\)/);
  assert.doesNotMatch(app, /station-changeover|PolynStationChangeover|PolynChangeoverEstimate/);
  for (const sheet of fs.readdirSync(ROOT).filter(name => name.endsWith(".css"))) {
    assert.doesNotMatch(read(sheet), /station-changeover|station-glass/, `${sheet} styles the calculator`);
  }
});

test("the frame is the stage's: preferred size from tokens, bounded above the Handbook's share so the two never meet, centred under the header, no media query, no raw length", () => {
  const raw = read("station/styles/components/changeover.css");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = name => { const at = css.indexOf(`${name} {`); assert.ok(at >= 0, `${name} has no rule`); return css.slice(at, css.indexOf("}", at)); };
  const panel = rule(".station-changeover__panel");
  assert.match(panel, /\btop: var\(--station-space-3\);/);
  assert.match(panel, /margin: 0 auto;/);
  assert.match(panel, /width: min\(var\(--station-changeover-width\), calc\(100% - 2 \* var\(--station-space-5\)\)\);/);
  assert.match(panel, /height: min\(var\(--station-changeover-height\), calc\(100% - var\(--station-handbook-share\) - 2 \* var\(--station-space-3\)\)\);/);
  assert.doesNotMatch(panel, /\s(max-height|min-height):|fit-content|max-content|height: auto/);
  assert.doesNotMatch(panel, /\d+px|\d+vh|\d+vw/);
  assert.match(panel, /pointer-events: auto;/);
  assert.match(rule(".station-changeover"), /pointer-events: none;/);
  assert.match(rule(".station-changeover__body"), /overflow-y: auto;/, "the body scrolls within the frame when the stage is too short for it");
  assert.doesNotMatch(css, /@media/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(/i, "changeover.css names a colour");
  // The material is the shared glass, spelled once.
  assert.doesNotMatch(css, /backdrop-filter/);
  const glass = read("station/styles/components/glass.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(glass, /\.station-glass \{[^}]*background: var\(--station-handbook-glass\);[^}]*backdrop-filter: blur\(var\(--station-handbook-glass-blur\)\)/);
  assert.doesNotMatch(glass, /#[0-9a-f]{3,8}\b|\brgba?\(|\d+px/i);
  const tokens = read("station/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(tokens, /--station-changeover-width: \d+px;/);
  assert.match(tokens, /--station-changeover-height: \d+px;/);
  // The shell has the slot, over the stage's cell, inert to the pointer,
  // as the Handbook's is.
  const shell = read("station/styles/shell.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(shell, /\.station-utility-slot \{[^}]*grid-area: machine;[^}]*pointer-events: none;/);
  // The Handbook's readout of the same tokens is unchanged: the two boxes
  // add up to less than the stage, with the gaps between.
  assert.match(tokens, /--station-handbook-share: 40%;/);
});
