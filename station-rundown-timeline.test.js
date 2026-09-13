"use strict";

/* The run-down timeline (station/station-rundown-timeline.js), driven
 * against a small fake DOM with a fake clock: what it draws for a given
 * job, how it moves with time, how it wakes, and that it writes nothing
 * back.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const timelineModule = require("./station/station-rundown-timeline.js");
const rundown = require("./station/station-rundown.js");
const lineModel = require("./station/station-line-model.js");
const source = require("./station/station-source.js");

const { MINUTE, HOUR } = rundown;
const NOW = new Date(2026, 8, 12, 14, 3, 20).getTime();

/* ----------------------------------------------------------------------
 *   A fake DOM
 * -------------------------------------------------------------------- */

function makeNode(doc, name) {
  const node = {
    ownerDocument: doc,
    tagName: name.toUpperCase(),
    nodeName: name.toUpperCase(),
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    clientWidth: 0,
    get firstChild() { return this.children[0] || null; },
    get parentNode() { return this.parent; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    append(...nodes) { for (const child of nodes) this.appendChild(child); },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n && n.tagName) { if (matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
    dispatchEvent(event) {
      event.target = event.target || this;
      let n = this;
      while (n && !event.stopped) {
        for (const fn of n.listeners[event.type] || []) fn(event);
        if (!event.bubbles) break;
        n = n.parent;
      }
      return true;
    },
    focus() { doc.activeElement = this; },
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attributes.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attributes.class = [...set].join(" "); },
      toggle(name, on) { if (on) this.add(name); else this.remove(name); },
      contains(name) { return classSet(node).has(name); }
    }
  };
  return node;
}
function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matches(node, selector) {
  const attrEq = selector.match(/^\[([a-z-]+)='([^']+)'\]$/);
  if (attrEq) return node.getAttribute(attrEq[1]) === attrEq[2];
  const attr = selector.match(/^\[([a-z-]+)\]$/);
  if (attr) return node.hasAttribute(attr[1]);
  const cls = selector.match(/^\.([a-z0-9_-]+)$/i);
  if (cls) return classSet(node).has(cls[1]);
  throw new Error(`unsupported selector ${selector}`);
}
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function fakeDocument() {
  const doc = makeNode(null, "#document");
  doc.ownerDocument = doc;
  doc.activeElement = null;
  doc.createElement = name => makeNode(doc, name);
  return doc;
}

/* A fake window: event listeners, and no ResizeObserver. */
function fakeView(doc) {
  return { document: doc, listeners: {}, addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }, removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }, fire(type) { for (const fn of this.listeners[type] || []) fn({ type }); } };
}

/* A fake clock and timers. */
function fakeClock(start) {
  const clock = { now: start, queue: [], nextId: 1 };
  clock.timers = {
    setTimeout(fn, ms) { const id = clock.nextId++; clock.queue.push({ id, at: clock.now + ms, fn }); return id; },
    clearTimeout(id) { clock.queue = clock.queue.filter(t => t.id !== id); }
  };
  clock.advance = ms => {
    const until = clock.now + ms;
    for (;;) {
      clock.queue.sort((a, b) => a.at - b.at);
      const next = clock.queue[0];
      if (!next || next.at > until) break;
      clock.queue.shift();
      clock.now = next.at;
      next.fn();
    }
    clock.now = until;
  };
  return clock;
}

const byClass = (root, name) => root.querySelector(`.${name}`);
const allByClass = (root, name) => root.querySelectorAll(`.${name}`);
const hidden = node => node.hasAttribute("hidden");
const xOf = node => Number(String(node.getAttribute("style") || "").match(/--station-rundown-x: ([\d.]+)%/)[1]);
const click = node => node.dispatchEvent({ type: "click", bubbles: true });

/* ----------------------------------------------------------------------
 *   A line
 * -------------------------------------------------------------------- */

const CONFIG = { lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard" };

function snapshot(overrides) {
  const base = {
    line: Object.assign({ linked: true }, CONFIG),
    job: { lineRate: 1200, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layerPct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        index,
        pct: index === 0 ? 60 : index === 1 ? 30 : index === 2 ? 10 : 0,
        resinName: index < 3 ? `R-${name}${index}` : "",
        weight: index < 2 ? 400 : 0, effectiveWeight: index < 2 ? 400 : 0,
        usableHeight: 30,
        track: name === "B" && index < 2,
        pumpOff: false
      }))
    }))
  };
  if (typeof overrides === "function") overrides(base);
  return base;
}

function inputsFor(snap) {
  const resolved = source.resolveSource({ snapshot: snap, demoLines: null, demoId: "", mode: "auto" });
  return { model: lineModel.buildLineModel(resolved.modelInput), hopperState: resolved.hopperState, layerState: resolved.layerState, job: resolved.job, live: true };
}

function mount(options) {
  const doc = fakeDocument();
  const view = fakeView(doc);
  const clock = fakeClock(NOW);
  const timeline = timelineModule.create(doc, Object.assign({
    now: () => clock.now, timers: clock.timers, view, tickMs: 20000
  }, options || {}));
  // The track is laid out 1200px wide.
  byClass(timeline.element, "station-rundown__track").clientWidth = 1200;
  return { doc, view, clock, timeline, root: timeline.element };
}

/* ----------------------------------------------------------------------
 *   Structure
 * -------------------------------------------------------------------- */

test("the timeline begins with the Now anchor and the axis - there is no heading and no title", () => {
  const { root } = mount();
  assert.equal(root.getAttribute("class"), "station-rundown");
  assert.deepEqual(root.children.map(n => n.getAttribute("class")), ["station-rundown__now", "station-rundown__track", "station-rundown__side"]);
  assert.equal(byClass(root, "station-rundown__now-label").textContent, "Now");
  walk(root, node => {
    assert.ok(!["H1", "H2", "H3", "H4"].includes(node.tagName), `a heading (${node.tagName}) in the timeline`);
    assert.doesNotMatch(String(node.textContent), /Upcoming|Rundown|Run-down timeline$|Timeline/);
  });
  // The row mount's own label is the accessible name; the words are not on screen.
  const src = fs.readFileSync(path.join(__dirname, "station/station-rundown-timeline.js"), "utf8");
  assert.doesNotMatch(src, /"Upcoming|"Rundown"|"Timeline"|"Upcoming Rundown"/);
});

test("with a line but nothing tracked, the axis still draws and one muted hint says how to track", () => {
  const { root, timeline } = mount();
  timeline.update(inputsFor(snapshot(s => { s.layers.forEach(L => L.hoppers.forEach(h => { h.track = false; })); })));
  assert.equal(allByClass(root, "station-rundown__marker").length, 0);
  const hint = byClass(root, "station-rundown__hint");
  assert.equal(hidden(hint), false);
  assert.match(hint.textContent, /No tracked hoppers/);
  assert.ok(allByClass(root, "station-rundown__tick").length > 60, "the axis is drawn regardless");
  assert.match(byClass(root, "station-rundown__now-clock").textContent, /2:03|14:03/);
});

/* ----------------------------------------------------------------------
 *   Markers
 * -------------------------------------------------------------------- */

test("each tracked hopper with an estimate is a marker at its fraction of the window, in its layer's colour, with id and time remaining", () => {
  const { root, timeline } = mount();
  timeline.update(inputsFor(snapshot()));
  const markers = allByClass(root, "station-rundown__marker");
  assert.deepEqual(markers.map(m => m.getAttribute("data-hopper")), ["B1", "B2"]);
  const b1 = markers[0];
  // 1200 x 0.4 x 0.6 = 288 lb/hr; 400/288 h = 1.389 h -> 23.15% of 6h.
  assert.ok(Math.abs(xOf(b1) - (400 / 288) / 6 * 100) < 0.01);
  assert.equal(b1.getAttribute("data-layer-role"), "core");
  assert.equal(b1.getAttribute("data-layer"), "B");
  assert.equal(b1.tagName, "BUTTON");
  assert.equal(b1.getAttribute("type"), "button");
  assert.equal(byClass(b1, "station-rundown__id").textContent, "B1");
  assert.equal(allByClass(b1, "station-rundown__time").length, 0, "the label is the id alone; the time is in the detail");
  assert.match(b1.getAttribute("aria-label"), /^B1: empty in 1h 23m, at /);
  // No marker was placed anywhere it cannot be.
  for (const m of markers) assert.ok(xOf(m) >= 0 && xOf(m) <= 100);
});

test("tracking a hopper puts its marker up at once; untracking takes it down; both through the inputs alone", () => {
  const { root, timeline } = mount();
  timeline.update(inputsFor(snapshot()));
  timeline.update(inputsFor(snapshot(s => { s.layers[0].hoppers[0].track = true; })));
  // Markers are in time order: B1 (288 lb/hr) empties before A1 (216 lb/hr).
  assert.deepEqual(allByClass(root, "station-rundown__marker").map(m => m.getAttribute("data-hopper")), ["B1", "A1", "B2"]);
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[0].track = false; })));
  assert.deepEqual(allByClass(root, "station-rundown__marker").map(m => m.getAttribute("data-hopper")), ["B2"]);
});

test("a tracked hopper with no estimate is not silently dropped: it is a chip with the actual reason", () => {
  const { root, timeline } = mount();
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[2].track = true; })));
  const chips = allByClass(root, "station-rundown__chip");
  assert.equal(chips.length, 1);
  assert.equal(chips[0].getAttribute("data-hopper"), "B3");
  assert.equal(byClass(chips[0], "station-rundown__reason").textContent, "No weight");
  assert.ok(chips[0].classList.contains("is-unavailable"));
  assert.equal(allByClass(root, "station-rundown__marker").length, 2, "the others still mark");
  // No output: every tracked hopper says so.
  timeline.update(inputsFor(snapshot(s => { s.job.lineRate = 0; })));
  assert.equal(allByClass(root, "station-rundown__marker").length, 0);
  assert.deepEqual(allByClass(root, "station-rundown__reason").map(n => n.textContent), ["No output", "No output"]);
  // No blend.
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[0].pct = 0; })));
  assert.deepEqual(allByClass(root, "station-rundown__reason").map(n => n.textContent), ["No blend"]);
});

test("a pumped-off hopper keeps its marker, subdued and said so - the application's 'done'", () => {
  const { root, timeline } = mount();
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[0].pumpOff = true; })));
  const b1 = root.querySelector("[data-hopper='B1']");
  assert.ok(b1.classList.contains("is-pump-off"));
  assert.match(b1.getAttribute("aria-label"), /pump off/);
  assert.ok(xOf(b1) > 0);
});

test("output, blend and weight changes move the marker at once", () => {
  const { root, timeline } = mount();
  timeline.update(inputsFor(snapshot()));
  const at = () => xOf(root.querySelector("[data-hopper='B1']"));
  const base = at();
  timeline.update(inputsFor(snapshot(s => { s.job.lineRate = 2400; })));
  assert.ok(Math.abs(at() - base / 2) < 0.01, "double output, half the distance");
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[0].pct = 30; })));
  assert.ok(Math.abs(at() - base * 2) < 0.01, "half the blend, twice the distance");
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[0].effectiveWeight = 800; })));
  assert.ok(Math.abs(at() - base * 2) < 0.01, "double the weight, twice the distance");
});

/* ----------------------------------------------------------------------
 *   Real time
 * -------------------------------------------------------------------- */

test("the clock's pass moves every marker left and the Now clock on, every twenty seconds, with no interval and no frame loop", () => {
  const { root, timeline, clock } = mount();
  timeline.update(inputsFor(snapshot()));
  const before = xOf(root.querySelector("[data-hopper='B1']"));
  clock.advance(20000);
  const after20 = xOf(root.querySelector("[data-hopper='B1']"));
  assert.ok(after20 < before, "twenty seconds on, the marker has moved left");
  assert.ok(Math.abs((before - after20) - (20000 / (6 * HOUR)) * 100) < 0.001, "by twenty seconds' worth of the window");
  clock.advance(10 * MINUTE);
  const after10 = xOf(root.querySelector("[data-hopper='B1']"));
  assert.ok(Math.abs((before - after10) - ((10 * MINUTE + 20000) / (6 * HOUR)) * 100) < 0.001);
  assert.match(byClass(root, "station-rundown__now-clock").textContent, /2:13|14:13/);
  assert.equal(timeline.getEntries()[0].emptyAt, timeline.getEntries()[0].emptyAt, "the empty instant is fixed");
  // The pass is a timeout chain: exactly one pending at any time.
  assert.equal(clock.queue.length, 1);
  const src = fs.readFileSync(path.join(__dirname, "station/station-rundown-timeline.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /setInterval|requestAnimationFrame/);
  assert.equal(timelineModule.TICK_MS, 20000);
});

test("the estimate is anchored when the weight was seen: a new weight re-anchors, output and blend changes do not, untracking forgets", () => {
  const { timeline, clock } = mount();
  timeline.update(inputsFor(snapshot()));
  assert.deepEqual(timeline.getObserved(), { "B:0": NOW, "B:1": NOW });
  clock.advance(5 * MINUTE);
  timeline.update(inputsFor(snapshot(s => { s.job.lineRate = 900; })));
  assert.deepEqual(timeline.getObserved(), { "B:0": NOW, "B:1": NOW }, "an output change keeps the anchor");
  timeline.update(inputsFor(snapshot(s => { s.job.lineRate = 900; s.layers[1].hoppers[0].pct = 50; })));
  assert.deepEqual(timeline.getObserved(), { "B:0": NOW, "B:1": NOW }, "a blend change keeps the anchor");
  timeline.update(inputsFor(snapshot(s => { s.job.lineRate = 900; s.layers[1].hoppers[0].pct = 50; s.layers[1].hoppers[0].effectiveWeight = 350; })));
  assert.deepEqual(timeline.getObserved(), { "B:0": NOW + 5 * MINUTE, "B:1": NOW }, "a new weight is observed now");
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[1].track = false; })));
  assert.deepEqual(Object.keys(timeline.getObserved()), ["B:0"]);
  clock.advance(MINUTE);
  timeline.update(inputsFor(snapshot()));
  assert.equal(timeline.getObserved()["B:1"], NOW + 6 * MINUTE, "tracked again: observed afresh");
});

test("the page becoming visible, focused or shown runs a pass at once and restarts the chain - sleep leaves no stale picture", () => {
  const { root, timeline, clock, view } = mount();
  timeline.update(inputsFor(snapshot()));
  const before = xOf(root.querySelector("[data-hopper='B1']"));
  // The machine slept: the clock jumped, and no timer fired.
  clock.queue = [];
  clock.now += 2 * HOUR;
  assert.equal(xOf(root.querySelector("[data-hopper='B1']")), before, "nothing has run yet");
  view.fire("focus");
  const woken = xOf(root.querySelector("[data-hopper='B1']"));
  assert.equal(woken, 0, "two hours on, B1 (1h 23m) is past: on the Now line");
  assert.ok(root.querySelector("[data-hopper='B1']").classList.contains("is-past"));
  assert.match(root.querySelector("[data-hopper='B1']").getAttribute("aria-label"), /estimated empty since/);
  assert.equal(clock.queue.length, 1, "the chain restarted");
  // Each of the three wake events does it.
  for (const type of ["pageshow", "focus"]) { clock.queue = []; view.fire(type); assert.equal(clock.queue.length, 1, type); }
  clock.queue = []; view.document.visibilityState = "visible";
  for (const fn of view.document.listeners.visibilitychange) fn({});
  assert.equal(clock.queue.length, 1, "visibilitychange");
  timeline.destroy();
  assert.equal(clock.queue.length, 0);
});

test("a data change recalculates at once without waiting for the clock", () => {
  const { root, timeline, clock } = mount();
  timeline.update(inputsFor(snapshot()));
  clock.now += 3 * MINUTE;   // the clock moved, no pass ran
  timeline.update(inputsFor(snapshot(s => { s.job.lineRate = 1300; })));
  const entry = timeline.getEntries()[0];
  assert.ok(Math.abs(entry.remainingMs - (400 / (1300 * 0.4 * 0.6) * HOUR - 3 * MINUTE)) < 1);
  assert.match(byClass(root, "station-rundown__now-clock").textContent, /2:06|14:06/);
});

/* ----------------------------------------------------------------------
 *   Window
 * -------------------------------------------------------------------- */

test("6H and 12H change the scale and nothing else: the same instant at half the fraction, the entries untouched", () => {
  const { root, timeline } = mount();
  timeline.update(inputsFor(snapshot()));
  const six = xOf(root.querySelector("[data-hopper='B1']"));
  const entriesBefore = JSON.stringify(timeline.getEntries());
  assert.equal(timeline.setWindow(12), true);
  assert.equal(root.getAttribute("data-window"), "12");
  assert.ok(Math.abs(xOf(root.querySelector("[data-hopper='B1']")) - six / 2) < 0.001);
  assert.equal(JSON.stringify(timeline.getEntries()), entriesBefore);
  assert.equal(timeline.setWindow(12), false);
  assert.equal(timeline.setWindow(9), false);
  assert.equal(timeline.getWindow(), 12);
  // The ticks open up: ten-minute marks at 12H on 1200px, five at 6H.
  assert.equal(timeline.getLayout().ticks.plan.minor, 10);
  timeline.setWindow(6);
  assert.equal(timeline.getLayout().ticks.plan.minor, 5);
  assert.equal(allByClass(root, "station-rundown__tick").length, 72);
  assert.equal(allByClass(root, "station-rundown__tick-label").length, 11, "the last half-hour is too near the edge for a label");
});

test("the scale is chosen on the timeline: 6H | 12H under the Now clock, one pressed, and a click is exactly setWindow - the same fractions, the same entries, no command", () => {
  const windows = [];
  const { root, timeline } = mount({ onWindow: h => windows.push(h) });
  timeline.update(inputsFor(snapshot()));
  const now = byClass(root, "station-rundown__now");
  assert.deepEqual(now.children.map(n => n.getAttribute("class")), ["station-rundown__now-label", "station-rundown__now-clock", "station-rundown__range"], "under the label and the clock, in the anchor's column");
  const range = byClass(root, "station-rundown__range");
  assert.equal(range.getAttribute("role"), "group");
  assert.equal(range.getAttribute("aria-label"), "Timeline range");
  const options = allByClass(root, "station-rundown__range-option");
  assert.deepEqual(options.map(n => [n.tagName, n.getAttribute("type"), n.textContent, n.getAttribute("data-window"), n.getAttribute("aria-pressed")]),
    [["BUTTON", "button", "6H", "6", "true"], ["BUTTON", "button", "12H", "12", "false"]]);
  const six = xOf(root.querySelector("[data-hopper='B1']"));
  const entriesBefore = JSON.stringify(timeline.getEntries());
  // Clicking 12H is what setWindow(12) is (the test above): half the fraction, the entries untouched.
  click(options[1]);
  assert.equal(timeline.getWindow(), 12);
  assert.equal(root.getAttribute("data-window"), "12");
  assert.deepEqual(options.map(n => n.getAttribute("aria-pressed")), ["false", "true"]);
  assert.ok(Math.abs(xOf(root.querySelector("[data-hopper='B1']")) - six / 2) < 0.001);
  assert.equal(JSON.stringify(timeline.getEntries()), entriesBefore);
  assert.equal(timeline.getLayout().ticks.plan.minor, 10);
  assert.deepEqual(windows, [12], "the host is told once");
  click(options[1]);
  assert.deepEqual(windows, [12], "the pressed scale again is nothing");
  // And 6H brings the six-hour picture back exactly.
  click(options[0]);
  assert.equal(timeline.getWindow(), 6);
  assert.deepEqual(options.map(n => n.getAttribute("aria-pressed")), ["true", "false"]);
  assert.ok(Math.abs(xOf(root.querySelector("[data-hopper='B1']")) - six) < 0.001);
  assert.equal(timeline.getLayout().ticks.plan.minor, 5);
  assert.deepEqual(windows, [12, 6]);
  // A programmatic setWindow keeps the buttons true to the scale, and tells nobody.
  timeline.setWindow(12);
  assert.deepEqual(options.map(n => n.getAttribute("aria-pressed")), ["false", "true"]);
  assert.deepEqual(windows, [12, 6]);
  // The initial scale is the option pressed at build.
  const twelve = mount({ window: 12 });
  assert.deepEqual(allByClass(twelve.root, "station-rundown__range-option").map(n => n.getAttribute("aria-pressed")), ["false", "true"]);
});

/* ----------------------------------------------------------------------
 *   Beyond the window, and the changeover
 * -------------------------------------------------------------------- */

test("a hopper past the window's edge is a right-hand chip with an arrow and its time, soonest first; several fold into +N", () => {
  const { root, timeline } = mount();
  // Heavy hoppers everywhere: B1 holds 3000 lb at 288 lb/hr (10.4 h), the
  // rest more; nothing is inside six hours.
  timeline.update(inputsFor(snapshot(s => {
    s.layers.forEach(L => L.hoppers.forEach((h, i) => { if (i < 3) { h.track = true; h.effectiveWeight = L.name === "B" && i === 0 ? 3000 : 4000 - i * 500; } }));
  })));
  assert.equal(allByClass(root, "station-rundown__marker").length, 0);
  const chips = allByClass(root, "station-rundown__chip");
  assert.equal(chips.length, timelineModule.SIDE_LIMIT);
  assert.ok(chips.slice(0, 3).every(c => c.classList.contains("is-beyond")));
  assert.equal(byClass(chips[0], "station-rundown__chip-sep").textContent, "→");
  assert.match(byClass(chips[0], "station-rundown__time").textContent, /^\d+h \d\dm$/);
  // Soonest first: B3 (3000 lb at 1200x0.4x0.1 = 48 lb/hr) is not soonest; A2/C2 are.
  const remaining = chips.slice(0, 3).map(c => timeline.getEntries().find(e => e.key === c.getAttribute("data-key")).remainingMs);
  assert.deepEqual(remaining, remaining.slice().sort((a, b) => a - b));
  const more = chips[3];
  assert.ok(more.classList.contains("is-more"));
  assert.equal(more.textContent, "+6");
  assert.match(more.getAttribute("title"), /\n/);
  // At 12H, B1 comes into the window as a marker and the fold shrinks.
  timeline.setWindow(12);
  assert.deepEqual(allByClass(root, "station-rundown__marker").map(m => m.getAttribute("data-hopper")), ["B1"]);
  assert.equal(root.querySelector("[data-more]").textContent, "+5");
});

test("the changeover is a distinct marker at its instant with its clock time and relative time, and a wash after it; beyond the window it is a chip; stale it is not drawn", () => {
  const { root, timeline } = mount();
  const co = byClass(root, "station-rundown__changeover");
  assert.ok(hidden(co));
  const at = new Date(2026, 8, 12, 16, 30).getTime();
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "16:30"; s.job.changeoverSetAt = NOW; })));
  assert.ok(!hidden(co));
  assert.ok(Math.abs(xOf(co) - (at - NOW) / (6 * HOUR) * 100) < 0.001);
  assert.equal(byClass(co, "station-rundown__changeover-name").textContent, "Line changeover");
  assert.ok(!co.classList.contains("is-end"), "well inside the track, the words sit to the right of the line");
  // The tick labels the box would cover are left out; the ticks stay.
  const coX = xOf(co) / 100 * 1200;
  for (const label of allByClass(root, "station-rundown__tick-label")) {
    const x = xOf(label) / 100 * 1200;
    assert.ok(x < coX - 28 || x > coX + 210 + 28, `tick label ${label.textContent} at ${x}px sits under the changeover's words at ${coX}px`);
  }
  assert.ok(allByClass(root, "station-rundown__tick").some(t => Math.abs(xOf(t) / 100 * 1200 - coX) < 60));
  assert.match(byClass(co, "station-rundown__changeover-time").textContent, /4:30|16:30/);
  assert.equal(byClass(co, "station-rundown__changeover-rel").textContent, "in 2h 26m");
  assert.ok(!co.classList.contains("station-rundown__marker"));
  const zone = byClass(root, "station-rundown__zone");
  assert.ok(!hidden(zone));
  assert.equal(xOf(zone), xOf(co));
  // Near the track's end: the words sit to the left of the line.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "19:50"; s.job.changeoverSetAt = NOW; })));
  assert.ok(!hidden(co));
  assert.ok(co.classList.contains("is-end"));
  // Beyond six hours: a chip, not a line at the edge.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "23:00"; s.job.changeoverSetAt = NOW; })));
  assert.ok(hidden(co));
  // B1 and B2 stand at their pump-off points, hours before it, beyond the
  // window too: chips ahead of the changeover's own, soonest pump-off
  // first (B2's 30% share runs longer, so its point comes first).
  const chips = allByClass(root, "station-rundown__chip");
  assert.deepEqual(chips.map(c => c.getAttribute("data-hopper")), ["B2", "B1", null]);
  const chip = chips[2];
  assert.ok(chip.classList.contains("is-changeover"));
  assert.match(chip.textContent, /^Changeover → 8h 56m$/);
  // Stale: not a boundary to plan by.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "16:30"; s.job.changeoverSetAt = NOW - 30 * HOUR; })));
  assert.ok(hidden(co));
  assert.ok(byClass(root, "station-rundown__chip").classList.contains("is-stale"));
  // Cleared: nothing.
  timeline.update(inputsFor(snapshot()));
  assert.ok(hidden(co));
  assert.equal(allByClass(root, "station-rundown__chip").length, 0);
});

test("with a changeover, a marker stands at the hopper's pump-off point and moves with the changeover; at Now it is late, or off once the pump is; without one it stands at the run-empty estimate", () => {
  const { root, timeline } = mount();
  const marker = id => root.querySelector(`[data-hopper='${id}']`);
  const label = id => byClass(marker(id), "station-rundown__id").textContent;
  const said = id => marker(id).getAttribute("aria-label");
  // No changeover: B1 (1h 23m to empty) stands at its empty-at estimate.
  timeline.update(inputsFor(snapshot()));
  const emptyX = xOf(marker("B1"));
  assert.ok(Math.abs(emptyX - (400 / 288) / 6 * 100) < 0.01);
  assert.equal(label("B1"), "B1");
  assert.match(said("B1"), /empty in 1h 23m/);
  assert.equal(timeline.getEntries().find(e => e.key === "B:0").markKind, "empty");
  // A changeover at 16:30: the pump-off point is 15:06:40, 1h 03m off.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "16:30"; s.job.changeoverSetAt = NOW; })));
  const co = new Date(2026, 8, 12, 16, 30).getTime();
  const pumpOffBy = co - (400 / 288) * HOUR;
  assert.ok(Math.abs(xOf(marker("B1")) - (pumpOffBy - NOW) / (6 * HOUR) * 100) < 0.01, "the marker stands at the pump-off point");
  assert.ok(xOf(marker("B1")) < emptyX);
  assert.equal(label("B1"), "B1", "the label stays the id: the time is the detail's");
  assert.match(said("B1"), /^B1: pump off in 1h 03m, by (3:06 PM|15:06), to run empty by the changeover$/);
  assert.equal(timeline.getEntries().find(e => e.key === "B:0").markKind, "pump-off");
  assert.ok(!marker("B1").classList.contains("is-late"));
  // Moved an hour later: every marker moves the hour with it.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "17:30"; s.job.changeoverSetAt = NOW; })));
  assert.ok(Math.abs(xOf(marker("B1")) - (pumpOffBy + HOUR - NOW) / (6 * HOUR) * 100) < 0.01);
  assert.match(said("B1"), /pump off in 2h 03m/);
  // Moved to within the hour: the pump-off point has passed. The marker
  // sits on Now, late - the hopper the stage draws overdue.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "15:00"; s.job.changeoverSetAt = NOW; })));
  assert.equal(xOf(marker("B1")), 0);
  assert.ok(marker("B1").classList.contains("is-past") && marker("B1").classList.contains("is-late"));
  assert.equal(label("B1"), "B1");
  assert.match(said("B1"), /^B1: late - pump off by (1:36 PM|13:36) to run empty by the changeover$/);
  assert.equal(timeline.getEntries().find(e => e.key === "B:0").overdue, true);
  // The pump turned off: done, not late - subdued, "Off" (wherever the
  // marker stands: a pumped-off hopper's point is done), the estimate stands.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "15:00"; s.job.changeoverSetAt = NOW; s.layers[1].hoppers[0].pumpOff = true; })));
  assert.ok(marker("B1").classList.contains("is-pump-off") && !marker("B1").classList.contains("is-late"));
  assert.match(said("B1"), /^B1: pump off, empty in 1h 23m$/);
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "17:30"; s.job.changeoverSetAt = NOW; s.layers[1].hoppers[0].pumpOff = true; })));
  assert.ok(xOf(marker("B1")) > 0 && marker("B1").classList.contains("is-pump-off"), "ahead of Now too");
  // Cleared: back to the run-empty estimate, where it was.
  timeline.update(inputsFor(snapshot()));
  assert.ok(Math.abs(xOf(marker("B1")) - emptyX) < 0.01);
  assert.match(said("B1"), /empty in 1h 23m/);
  // Stale: not a boundary to plan by - the run-empty estimate again.
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "16:30"; s.job.changeoverSetAt = NOW - 30 * HOUR; })));
  assert.ok(Math.abs(xOf(marker("B1")) - emptyX) < 0.01);
  assert.equal(timeline.getEntries().find(e => e.key === "B:0").markKind, "empty");
});

test("labels never overlap: a marker's label is its id alone; hoppers at one instant stack their ids down one stem, and more than the lanes hold collapse to 'N hoppers' whose detail lists every one", () => {
  const { root, timeline } = mount();
  // Two identical hoppers (B1 and A1: the same weight, share and blend) at
  // one instant: two stems at one x, ids in successive lanes.
  timeline.update(inputsFor(snapshot(s => { s.layers[0].hoppers[0].track = true; s.layers[0].layerPct = 40; s.layers[2].layerPct = 20; })));
  const markers = () => allByClass(root, "station-rundown__marker");
  const of = id => markers().find(m => m.getAttribute("data-hopper") === id);
  assert.equal(xOf(of("A1")), xOf(of("B1")));
  assert.equal(of("A1").getAttribute("data-group"), of("B1").getAttribute("data-group"));
  assert.deepEqual([of("A1").getAttribute("data-lane"), of("B1").getAttribute("data-lane")], ["0", "1"]);
  assert.deepEqual([byClass(of("A1"), "station-rundown__id").textContent, byClass(of("B1"), "station-rundown__id").textContent], ["A1", "B1"]);
  assert.equal(allByClass(root, "station-rundown__group").length, 0);
  // Five hoppers at one instant: more than three lanes hold. One label,
  // "5 hoppers", on the first; the rest carry a stem and a dot and no
  // label; each is still its own marker at its own x.
  timeline.update(inputsFor(snapshot(s => {
    s.layers.forEach(L => { L.layerPct = 100 / 3; L.hoppers[0].track = true; L.hoppers[1].track = true; L.hoppers[1].pct = 60; L.hoppers[2].track = false; });
    s.layers[0].hoppers[1].track = false;
  })));
  const group = markers().filter(m => m.getAttribute("data-group") === of("A1").getAttribute("data-group"));
  assert.equal(group.length, 5);
  assert.ok(group.every(m => xOf(m) === xOf(group[0])));
  const labelled = group.filter(m => byClass(m, "station-rundown__label"));
  assert.equal(labelled.length, 1);
  assert.equal(byClass(labelled[0], "station-rundown__group").textContent, "5 hoppers");
  assert.ok(labelled[0].classList.contains("is-group"));
  assert.ok(group.filter(m => m !== labelled[0]).every(m => m.classList.contains("is-grouped") && !byClass(m, "station-rundown__label")));
  assert.ok(group.every(m => m.getAttribute("data-lane") === group[0].getAttribute("data-lane")));
  assert.match(labelled[0].getAttribute("aria-label"), /; 5 hoppers empty by .*: A1, B1, B2, C1, C2$/);
  // Hovering any member opens the group's listing: every hopper, its
  // resin, its instants and its run-down, the hovered one first.
  const detail = byClass(root, "station-rundown__detail");
  group[2].dispatchEvent({ type: "mouseover", bubbles: true });
  assert.ok(!hidden(detail));
  assert.equal(byClass(detail, "station-rundown__group").textContent, "5 hoppers");
  const members = allByClass(detail, "station-rundown__member");
  assert.equal(members.length, 5);
  assert.equal(byClass(members[0], "station-rundown__id").textContent, group[2].getAttribute("data-hopper"));
  assert.deepEqual(members.map(m => byClass(m, "station-rundown__id").textContent).sort(), ["A1", "B1", "B2", "C1", "C2"]);
  assert.match(byClass(members[0], "station-rundown__member-resin").textContent, /^R-/);
  assert.match(byClass(members[0], "station-rundown__member-facts").textContent, /^empty .* · \d+h \d\dm run-down$/);
  root.dispatchEvent({ type: "mouseleave", bubbles: false });
  // With a changeover the listing carries the pump-off point too.
  timeline.update(inputsFor(snapshot(s => {
    s.layers.forEach(L => { L.layerPct = 100 / 3; L.hoppers[0].track = true; L.hoppers[1].track = true; L.hoppers[1].pct = 60; L.hoppers[2].track = false; });
    s.layers[0].hoppers[1].track = false; s.job.changeoverTime = "18:00"; s.job.changeoverSetAt = NOW;
  })));
  of("A1").dispatchEvent({ type: "mouseover", bubbles: true });
  assert.match(byClass(allByClass(detail, "station-rundown__member")[0], "station-rundown__member-facts").textContent, /^pump off by .* · empty .* · \d+h \d\dm run-down$/);
  // The row never grows: every marker sits in one of three lanes.
  assert.ok(markers().every(m => ["0", "1", "2"].includes(m.getAttribute("data-lane"))));
});

/* ----------------------------------------------------------------------
 *   Inspection
 * -------------------------------------------------------------------- */

test("a marker is inspectable by pointer, keyboard focus and click; the detail is the entry in words; Escape closes it", () => {
  const { root, timeline, doc } = mount();
  timeline.update(inputsFor(snapshot(s => { s.job.changeoverTime = "16:30"; s.job.changeoverSetAt = NOW; })));
  const detail = byClass(root, "station-rundown__detail");
  assert.ok(hidden(detail));
  const b1 = root.querySelector("[data-hopper='B1']");
  b1.dispatchEvent({ type: "mouseover", bubbles: true });
  assert.ok(!hidden(detail));
  assert.equal(byClass(detail, "station-rundown__detail-resin").textContent, "R-B0");
  const rows = allByClass(detail, "station-rundown__row").map(r => [byClass(r, "station-rundown__term").textContent, byClass(r, "station-rundown__value").textContent]);
  assert.deepEqual(rows.map(r => r[0]), ["Layer", "Weight", "Blend", "Consumption", "Pump off by", "Time remaining", "Empty at", "Run-down"]);
  assert.equal(rows[0][1], "B");
  assert.equal(rows[1][1], "400 lb");
  assert.equal(rows[2][1], "60% of layer B (40%)");
  assert.equal(rows[3][1], "288 lb/hr");
  // 16:30 less 1h 23m: 3:06 PM, 1h 03m from 14:03.
  assert.match(rows[4][1], /^(3:06 PM|15:06) · in 1h 03m$/);
  assert.equal(rows[5][1], "1h 23m");
  assert.equal(rows[7][1], "1h 23m");
  assert.equal(b1.getAttribute("aria-describedby"), timelineModule.DETAIL_ID);
  assert.equal(detail.getAttribute("role"), "tooltip");
  root.dispatchEvent({ type: "mouseleave", bubbles: false });
  assert.ok(hidden(detail));
  // Keyboard: focus shows, blur hides.
  b1.focus();
  b1.dispatchEvent({ type: "focusin", bubbles: true });
  assert.ok(!hidden(detail));
  b1.dispatchEvent({ type: "focusout", bubbles: true, relatedTarget: null });
  assert.ok(hidden(detail));
  // Click pins it past a mouseleave; Escape closes it.
  click(b1);
  assert.ok(!hidden(detail));
  assert.ok(detail.classList.contains("is-pinned"));
  root.dispatchEvent({ type: "mouseleave", bubbles: false });
  assert.ok(!hidden(detail));
  b1.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true, stopPropagation() { this.stopped = true; } });
  assert.ok(hidden(detail));
  // A chip opens the same detail with the reason.
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[2].track = true; })));
  const chip = root.querySelector("[data-hopper='B3']");
  click(chip);
  assert.ok(!hidden(detail));
  const chipRows = allByClass(detail, "station-rundown__row").map(r => byClass(r, "station-rundown__value").textContent);
  assert.ok(chipRows.includes("No weight"));
  // The pinned detail survives a clock pass, and keyboard focus is restored to the same marker.
  timeline.tick();
  assert.ok(!hidden(detail));
  b1.focus();
  timeline.tick();
  assert.equal(doc.activeElement.getAttribute("data-hopper"), "B1", "focus followed the rebuilt marker");
  // A detail for a hopper that vanished closes.
  timeline.update(inputsFor(snapshot(s => { s.layers[1].hoppers[2].track = false; })));
  assert.equal(timeline.getDetail(), null);
  assert.ok(hidden(detail));
});

/* ----------------------------------------------------------------------
 *   Boundaries
 * -------------------------------------------------------------------- */

test("the timeline reads its inputs and writes nothing: no bridge, no dispatch, no storage, no mutation of what it is given", () => {
  const src = fs.readFileSync(path.join(__dirname, "station/station-rundown-timeline.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pattern of [/PolynStationStateBridge/, /PolynStationCommandBridge/, /\.dispatch\s*\(/, /\.subscribe\s*\(/, /localStorage/, /supabase/i, /\.publish\s*\(/, /\.connect\s*\(/]) {
    assert.doesNotMatch(src, pattern);
  }
  const { timeline } = mount();
  const inputs = inputsFor(snapshot());
  const before = JSON.stringify(inputs);
  timeline.update(inputs);
  timeline.tick();
  timeline.setWindow(12);
  assert.equal(JSON.stringify(inputs), before);
  // What it draws is derived: the entries it holds are the projection's.
  const entries = timeline.getEntries();
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => Number.isFinite(e.emptyAt)));
});

test("with no line at all the hint says so and nothing is projected", () => {
  const { root, timeline } = mount();
  timeline.update({ model: null, hopperState: {}, layerState: {}, job: null, live: false });
  assert.equal(byClass(root, "station-rundown__hint").textContent, "No line to project.");
  assert.equal(allByClass(root, "station-rundown__marker").length, 0);
  timeline.update(null);
  assert.equal(allByClass(root, "station-rundown__marker").length, 0);
});
