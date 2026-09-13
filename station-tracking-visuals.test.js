"use strict";

/* The hopper's tracking visuals: the run-down flow (a column of large downward
 * chevrons inside a tracked hopper's vessel, moved by CSS) and the
 * overdue wash (the pump-off point passed with the pump still running).
 *
 * What is pinned: the chevrons are drawn only for a tracked hopper, inside
 * the vessel, over nothing that is read; overdue is the application's own
 * judgement (app.js's startBy and isLate, scheduling's formatTimelineStart),
 * projected once in station-rundown.js and written to the drawing by the
 * boot file from the timeline's projection - never derived in the
 * renderer, never a second timer, never a publish; pump-off is never
 * overdue; the classes for hover, selection and focus stand over it; and
 * Blend Edit leaves the marks where they were.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const parts = require("./station/station-machine-parts.js");
const layoutModule = require("./station/station-machine-layout.js");
const lineModel = require("./station/station-line-model.js");
const render = require("./station/station-render.js");
const rundown = require("./station/station-rundown.js");
const timelineModule = require("./station/station-rundown-timeline.js");
const scheduling = require("./scheduling.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const { MINUTE, HOUR } = rundown;
const NOW = new Date(2026, 8, 12, 14, 0, 0).getTime();

/* ----------------------------------------------------------------------
 *   A fake DOM (the boot tests' one)
 * -------------------------------------------------------------------- */

let focused = null;

function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }

function matchesOne(node, selector) {
  const parts_ = selector.match(/(\.[a-zA-Z0-9_-]+|\[[a-zA-Z-]+(?:=(?:'[^']*'|"[^"]*"))?\]|:[a-z-]+|[a-zA-Z]+)/g) || [];
  return parts_.every(part => {
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
    focus() { focused = this; this.dispatchEvent(makeEvent("focusin", { bubbles: true })); },
    blur() { if (focused === this) focused = null; },
    select() {},
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
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

/* ----------------------------------------------------------------------
 *   The drawing: chevrons for a tracked hopper, inside the vessel
 * -------------------------------------------------------------------- */

function oneHopperGeometry(runtime) {
  const config = { layerCount: 1, layerAPosition: null, hopperCount: 2, hopperNamingMode: "standard", layers: [{ name: "A", layerPct: 100, hoppers: [{ index: 0, usableHeight: 30 }, { index: 1, usableHeight: 30 }] }] };
  const model = lineModel.buildLineModel(config);
  const layout = layoutModule.computeLayout(model, { hopperState: { "A:0": runtime, "A:1": runtime } });
  const bank = layout.banks[0];
  return { bank, geometry: Object.assign({ layer: bank.id }, bank.cluster.hoppers[0]) };
}

function drawHopper(runtime) {
  const doc = fakeDocument();
  const { bank, geometry } = oneHopperGeometry(runtime);
  return { g: parts.hopper(doc, geometry, runtime, { scale: bank.scale }), geometry };
}

test("an untracked hopper draws no flow; a tracked one draws a column of large, bowed downward chevrons spanning the vessel's interior, tiled so every phase shows the column, clipped by its own box, under the hardware and over nothing that is read", () => {
  const plain = drawHopper({ track: false, pumpOff: false, resinName: "HX204", pct: 60, assigned: true });
  assert.equal(plain.g.querySelectorAll(".station-hopper__rundown").length, 0);
  assert.equal(plain.g.querySelectorAll("[data-role='hopper-rundown']").length, 0);

  const tracked = drawHopper({ track: true, pumpOff: false, resinName: "HX204", pct: 60, assigned: true });
  const box = tracked.g.querySelector(".station-hopper__rundown");
  assert.ok(box, "the tracked hopper has a flow box");
  assert.equal(box.nodeName, "svg", "a nested svg, which clips by itself: no clipPath, no id");
  assert.equal(box.getAttribute("aria-hidden"), "true");
  assert.equal(tracked.g.querySelectorAll("clipPath").length, 0);
  assert.equal(box.getAttribute("id"), null);
  assert.match(box.getAttribute("style"), /^--station-rundown-period: [\d.]+px; --station-rundown-duration: [\d.]+s;$/);
  const flow = box.querySelector(".station-hopper__rundown-flow");
  assert.ok(flow && flow.getAttribute("data-role") === "hopper-rundown");
  const chevrons = flow.querySelector(".station-hopper__rundown-chevrons");
  assert.ok(chevrons);
  const geometry = tracked.geometry;
  const w = geometry.width;
  const bx = Number(box.getAttribute("x")), by = Number(box.getAttribute("y"));
  const bw = Number(box.getAttribute("width")), bh = Number(box.getAttribute("height"));
  // Each chevron is two bowed arms - a quadratic from each end down to the
  // shared point - so it lies on the drum rather than flat on the screen:
  // the control point sits below the arm's midpoint (steep off the edge,
  // flatter into the point), and the point is below both ends.
  const arm = /M ([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g;
  const arms = [...chevrons.getAttribute("d").matchAll(arm)].map(m => m.slice(1).map(Number));
  assert.ok(arms.length >= 4 && arms.length % 2 === 0, "whole chevrons, two arms each");
  const rows = [];
  for (let i = 0; i < arms.length; i += 2) {
    const [lx, ly, lcx, lcy, lpx, lpy] = arms[i];
    const [rx, ry, rcx, rcy, rpx, rpy] = arms[i + 1];
    assert.equal(ly, ry, "the two ends are level");
    assert.ok(lpx === rpx && lpy === rpy, "the arms meet at one point");
    assert.ok(lpy > ly, "the point is below the ends: a DOWNWARD chevron");
    assert.ok(lx < lpx && lpx < rx, "left end, point, right end");
    assert.ok(Math.abs(lpx - (lx + rx) / 2) < 0.02, "the point is on the centreline");
    assert.ok(lcy > ly + (lpy - ly) / 2 && rcy > ry + (rpy - ry) / 2, "the arms bow: steep off the edges, flatter into the point");
    assert.ok(lcx > lx && lcx < lpx && rcx < rx && rcx > lpx, "each control lies between its end and the point");
    rows.push({ y: ly, height: lpy - ly, left: lx, right: rx });
  }
  // Large and few: each chevron spans the interior between the clamps (its
  // round caps inside the box), stands about a third of the width tall,
  // and the next is more than a width below it.
  const strokeWidth = Number(chevrons.getAttribute("stroke-width"));
  assert.ok(strokeWidth >= w * 0.07 && strokeWidth <= w * 0.1, `a heavy stroke (${(strokeWidth / w).toFixed(3)}w)`);
  const first = rows[0];
  assert.ok(first.right - first.left >= w * 0.55, `wide: ${((first.right - first.left) / w).toFixed(2)}w from end to end`);
  assert.ok(first.left >= strokeWidth / 2 - 0.02 && first.right <= bw - strokeWidth / 2 + 0.02, "the caps stay inside the box");
  assert.ok(first.height >= w * 0.28 && first.height <= w * 0.4, `tall: ${(first.height / w).toFixed(2)}w`);
  const spacing = rows[1].y - rows[0].y;
  assert.ok(spacing > w, `widely spaced: ${(spacing / w).toFixed(2)}w apart`);
  assert.ok(spacing > 3 * first.height, "more than three chevron heights apart: flow, not texture");
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(Math.abs(rows[i].y - rows[i - 1].y - spacing) < 0.02, "evenly spaced");
    assert.ok(Math.abs(rows[i].height - first.height) < 0.02);
    assert.equal(rows[i].left, first.left);
    assert.equal(rows[i].right, first.right);
  }
  // Tiled: one chevron above the box's top edge, then one every spacing
  // down to its bottom, and the period is the spacing - so the column is
  // seamless at every phase, and at phase zero (reduced motion: the group
  // stands where it was drawn) the vessel shows its full column.
  const [, periodText, secondsText] = /^--station-rundown-period: ([\d.]+)px; --station-rundown-duration: ([\d.]+)s;$/.exec(box.getAttribute("style"));
  const period = Number(periodText), seconds = Number(secondsText);
  assert.ok(Math.abs(period - spacing) < 0.02, "the period is the spacing: the chevron leaving at the bottom is the one arriving at the top");
  assert.ok(Math.abs(rows[0].y + spacing) < 0.02, "the first chevron stands one spacing above the box");
  assert.ok(rows[rows.length - 1].y < bh && rows[rows.length - 1].y + spacing >= bh, "the column runs to the box's bottom and no further");
  const visibleAtRest = rows.filter(r => r.y + r.height > 0 && r.y < bh).length;
  assert.ok(visibleAtRest >= 2, `at phase zero the column is there (${visibleAtRest} chevrons in the box)`);
  // Nothing stands further outside the box than a spacing above (phase
  // zero) or a spacing and a chevron below (the loop's end): under the
  // receiver, over the hose, inside the hopper's own extent.
  assert.ok(by - spacing >= geometry.receiverTop, "at the loop's start the column stands under the receiver, inside the hopper's own extent");
  assert.ok(by + bh + spacing + first.height <= geometry.spoutTop + geometry.spoutHeight, "at its end, over the hose, inside it too");
  // One speed on every vessel: the duration follows the period, an eighth
  // of the vessel's width a second (the width is the drawing's unit).
  assert.ok(Math.abs(seconds - period / (w * 0.125)) < 0.05, "the duration follows the period");
  // Inside the vessel: the box spans the interior between the clamps
  // (0.08-0.18w and 0.82-0.92w) and is centred on the vessel; between the
  // top and bottom rims, above the discharge and the caption.
  const centre = bx + bw / 2 - geometry.x;
  assert.ok(Math.abs(centre - w / 2) < 0.02, `the lane is centred on the vessel (${(centre / w).toFixed(2)}w)`);
  assert.ok(bw >= w * 0.6, `and spans the interior (${(bw / w).toFixed(2)}w)`);
  assert.ok(bx >= geometry.x + w * 0.1 && bx + bw <= geometry.x + w * 0.9, "inside the vessel's walls");
  assert.ok(by >= geometry.vesselTop && by + bh <= geometry.coneTop, "within the vessel, above the discharge");
  assert.ok(by + bh < geometry.captionTop, "above the caption");
  // The readout is untouched: id, percentage, resin as before.
  assert.equal(tracked.g.querySelector(".station-hopper__id").textContent, plain.g.querySelector(".station-hopper__id").textContent);
  assert.equal(tracked.g.querySelector(".station-hopper__pct").textContent, "60%");
  // Drawn under the hardware (bands, clamps, ports and the fill valve go
  // over the flow, so it passes behind them and covers none of them),
  // after the material.
  const order = tracked.g.querySelector(".station-hopper__drawing").children.map(c => c.getAttribute("data-role"));
  assert.ok(order.indexOf("hopper-rundown") < 0, "the flow box is the svg, not the group");
  const svgIndex = tracked.g.querySelector(".station-hopper__drawing").children.findIndex(c => c === box);
  assert.ok(svgIndex > order.indexOf("hopper-material") && svgIndex < order.indexOf("hopper-details"));
  const details = tracked.g.querySelector("[data-role='hopper-details']");
  assert.ok(details.querySelector(".station-hopper__port") && details.querySelector(".station-hopper__fill-valve") && details.querySelector(".station-hopper__clamp") && details.querySelector(".station-hopper__band"),
    "the ports, the fill valve, the clamps and the bands are the hardware painted over the flow");
  // The hopper's title still says tracked; the state key still carries it.
  assert.match(tracked.g.querySelector("title").textContent, /· tracked/);
  assert.match(tracked.g.getAttribute("data-state"), /^t\|/);
  // The drawing is inert to the pointer as a whole (hopper.css covers descendants).
  assert.equal(tracked.g.querySelector(".station-hopper__drawing").getAttribute("pointer-events"), "none");
});

test("a short vessel still carries a column: the tiling follows the box's own height", () => {
  const config = { layerCount: 1, layerAPosition: null, hopperCount: 1, hopperNamingMode: "standard", layers: [{ name: "A", layerPct: 100, hoppers: [{ index: 0 }] }] };
  const model = lineModel.buildLineModel(config);
  const runtime = { track: true, pumpOff: false, resinName: "EVA3", pct: 10, assigned: true, usableHeight: 12 };
  const layout = layoutModule.computeLayout(model, { hopperState: { "A:0": runtime } });
  const bank = layout.banks[0];
  const geometry = Object.assign({ layer: bank.id }, bank.cluster.hoppers[0]);
  const g = parts.hopper(fakeDocument(), geometry, runtime, { scale: bank.scale });
  const box = g.querySelector(".station-hopper__rundown");
  assert.ok(box);
  const bh = Number(box.getAttribute("height"));
  const ys = [...box.querySelector("path").getAttribute("d").matchAll(/M [\d.-]+ ([\d.-]+) Q/g)].map(m => Number(m[1])).filter((_, i) => i % 2 === 0);
  const spacing = ys[1] - ys[0];
  assert.ok(ys[0] < 0 && ys[ys.length - 1] < bh && ys[ys.length - 1] + spacing >= bh, `tiled to the box (${ys.join(", ")} in ${bh})`);
  assert.ok(ys.some(y => y >= 0 && y < bh), "at least one chevron stands in the box at phase zero");
});

test("drawing a tracked hopper neither mutates the runtime it is handed nor writes anything but the drawing", () => {
  const runtime = Object.freeze({ track: true, pumpOff: false, resinName: "HX204", pct: 60, assigned: true });
  const drawn = drawHopper(runtime);
  assert.ok(drawn.g, "drawn from a frozen runtime");
  const source = read("station/station-machine-parts.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(source, /\.dispatch\s*\(|\.publish\s*\(|setTimeout|setInterval|requestAnimationFrame|Date\.now/);
});

/* ----------------------------------------------------------------------
 *   The projection: the pump-off point, late, overdue
 * -------------------------------------------------------------------- */

test("late is the application's own judgement: pumpOffBy restates startByDate, late is formatTimelineStart's, and overdue needs the pump running", () => {
  const app = read("app.js");
  assert.match(app, /startByDate = new Date\(changeoverDate\.getTime\(\) - totalMinutes\*60\*1000\);/);
  assert.match(app, /const startStatus = formatTimelineStart\(startByDate, changeoverDate, new Date\(\), state\.timeFormat\);\s*startByText = startStatus\.text;\s*isLate = startStatus\.late;/);
  assert.match(app, /\(h\.isLate && !h\.pumpOff \? " late" : ""\)/);
  const input = { track: true, pumpOff: false, effectiveWeight: 300, pct: 60, layerPct: 30, lineRate: 900 };
  // 300 lb at 162 lb/hr: 111.1 minutes to empty.
  const duration = (300 / 162) * HOUR;
  const soon = rundown.hopperRundown(input, { now: NOW, changeoverAt: NOW + 30 * MINUTE });
  assert.equal(soon.pumpOffBy, NOW + 30 * MINUTE - duration);
  assert.equal(soon.pumpOffBy, NOW + 30 * MINUTE - soon.durationMs, "changeover minus the run-down time: app.js's startByDate");
  assert.equal(soon.late, scheduling.formatTimelineStart(new Date(soon.pumpOffBy), new Date(NOW + 30 * MINUTE), new Date(NOW)).late);
  assert.equal(soon.late, true);
  assert.equal(soon.overdue, true);
  assert.equal(soon.past, false, "late is not 'estimated empty already'");
  const later = rundown.hopperRundown(input, { now: NOW, changeoverAt: NOW + 3 * HOUR });
  assert.equal(later.late, false);
  assert.equal(later.overdue, false);
  assert.ok(later.pumpOffBy > NOW);
  // Exactly at the point: not yet late, as the application reads `<`.
  const exact = rundown.hopperRundown(input, { now: NOW, changeoverAt: NOW + duration });
  assert.equal(exact.pumpOffBy, NOW);
  assert.equal(exact.late, false);
  // Pump off: still late by the clock, never overdue.
  const off = rundown.hopperRundown(Object.assign({}, input, { pumpOff: true }), { now: NOW, changeoverAt: NOW + 30 * MINUTE });
  assert.equal(off.late, true);
  assert.equal(off.overdue, false);
  // No changeover: no point to be late against.
  const none = rundown.hopperRundown(input, { now: NOW });
  assert.equal(none.pumpOffBy, null);
  assert.equal(none.late, false);
  assert.equal(none.overdue, false);
  // No estimate (no weight): nothing to be late with.
  const empty = rundown.hopperRundown(Object.assign({}, input, { effectiveWeight: 0 }), { now: NOW, changeoverAt: NOW + 30 * MINUTE });
  assert.equal(empty.reason, "no-weight");
  assert.equal(empty.late, false);
  assert.equal(empty.overdue, false);
  // Untracked: nothing at all.
  const untracked = rundown.hopperRundown(Object.assign({}, input, { track: false }), { now: NOW, changeoverAt: NOW + 30 * MINUTE });
  assert.equal(untracked.overdue, false);
  // The anchor moves the marker, not the pump-off point: the point is the
  // application's, from the weight as entered, so a hopper becomes late
  // here at the moment the floor UI's Timeline marks its row late.
  const anchored = rundown.hopperRundown(Object.assign({}, input, { observedAt: NOW - HOUR }), { now: NOW, changeoverAt: NOW + 3 * HOUR });
  assert.equal(anchored.emptyAt, later.emptyAt - HOUR);
  assert.equal(anchored.pumpOffBy, later.pumpOffBy);
  assert.equal(anchored.late, later.late);
  // And the clock walks up to it: two hours on, the same inputs are late.
  const walked = rundown.hopperRundown(Object.assign({}, input, { observedAt: NOW }), { now: NOW + 2 * HOUR, changeoverAt: NOW + 3 * HOUR });
  assert.equal(walked.late, true);
  assert.equal(walked.overdue, true);
});

test("projectEntries carries the marks, hopperMarks narrows them to what the drawing needs, and the timeline projects against its changeover - not a stale one", () => {
  const config = { layerCount: 1, layerAPosition: null, hopperCount: 3, hopperNamingMode: "standard", layers: [{ name: "A", layerPct: 100, hoppers: [{ index: 0 }, { index: 1 }, { index: 2 }] }] };
  const model = lineModel.buildLineModel(config);
  const hopperState = {
    "A:0": { track: true, pumpOff: false, effectiveWeight: 300, pct: 60, resinName: "HX" },
    "A:1": { track: true, pumpOff: true, effectiveWeight: 300, pct: 30, resinName: "LD" },
    "A:2": { track: false, pumpOff: false, effectiveWeight: 300, pct: 10, resinName: "EV" }
  };
  // Layer A at 30%: A1 runs 111 minutes (162 lb/hr), A2 222 (81 lb/hr).
  const layerState = { A: { layerPct: 30 } };
  const entries = rundown.projectEntries({ model, hopperState, layerState, job: { lineRate: 900 } }, { now: NOW, changeoverAt: NOW + 10 * MINUTE });
  assert.deepEqual(entries.map(e => [e.key, e.late, e.overdue]), [["A:0", true, true], ["A:1", true, false]]);
  const marks = rundown.hopperMarks(entries);
  assert.deepEqual(marks, {
    "A:0": { tracked: true, pumpOff: false, late: true, overdue: true },
    "A:1": { tracked: true, pumpOff: true, late: true, overdue: false }
  });
  assert.deepEqual(rundown.hopperMarks(null), {});

  // The timeline: the same projection its markers are drawn from.
  const doc = fakeDocument();
  let now = NOW;
  const timeline = timelineModule.create(doc, { now: () => now, timers: null, view: null });
  const changeover = new Date(NOW + 10 * MINUTE);
  const clock = `${String(changeover.getHours()).padStart(2, "0")}:${String(changeover.getMinutes()).padStart(2, "0")}`;
  timeline.update({ model, hopperState, layerState, job: { lineRate: 900, changeoverTime: clock, changeoverSetAt: NOW } });
  assert.deepEqual(timeline.getMarks(), marks);
  assert.equal(timeline.getEntries().find(e => e.key === "A:0").overdue, true);
  // The changeover cleared: no point to be late against.
  timeline.update({ model, hopperState, layerState, job: { lineRate: 900, changeoverTime: "", changeoverSetAt: null } });
  assert.equal(timeline.getMarks()["A:0"].overdue, false);
  assert.equal(timeline.getMarks()["A:0"].tracked, true);
  // A stale changeover draws no line on the axis, and bounds nothing here.
  timeline.update({ model, hopperState, layerState, job: { lineRate: 900, changeoverTime: clock, changeoverSetAt: NOW - 21 * HOUR } });
  assert.equal(timeline.getLayout().changeover.stale, true);
  assert.equal(timeline.getMarks()["A:0"].overdue, false);
  // A changeover far enough off: not late; the clock running on makes it so.
  const far = new Date(NOW + 3 * HOUR);
  timeline.update({ model, hopperState, layerState, job: { lineRate: 900, changeoverTime: `${String(far.getHours()).padStart(2, "0")}:${String(far.getMinutes()).padStart(2, "0")}`, changeoverSetAt: NOW } });
  assert.equal(timeline.getMarks()["A:0"].overdue, false);
  now = NOW + 2 * HOUR;
  timeline.tick();
  assert.equal(timeline.getMarks()["A:0"].overdue, true, "with an hour left and 111 minutes to run down, the pump-off point has passed");
  assert.equal(timeline.getMarks()["A:1"].overdue, false, "the pumped-off hopper is never overdue");
  timeline.destroy();
});

test("a patch carries an overdue mark across to the rebuilt hopper, as it carries the highlight", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  const config = { layerCount: 1, layerAPosition: null, hopperCount: 2, hopperNamingMode: "standard", layers: [{ name: "A", layerPct: 100, hoppers: [{ index: 0 }, { index: 1 }] }] };
  const model = lineModel.buildLineModel(config);
  const hopperState = { "A:0": { track: true, pumpOff: false, resinName: "HX", pct: 60, assigned: true }, "A:1": { track: false, pumpOff: false, resinName: "LD", pct: 40, assigned: true } };
  render.mountStage(mount, model, { hopperState, layerState: { A: { layerPct: 100 } }, stageAspect: 1.5 });
  const hopper = mount.querySelectorAll("[data-role='hopper']").find(h => h.getAttribute("data-hopper-index") === "0");
  hopper.classList.add("is-overdue");
  hopper.classList.add("is-highlighted");
  const next = { "A:0": Object.assign({}, hopperState["A:0"], { pct: 65 }), "A:1": hopperState["A:1"] };
  const patched = render.patchStage(mount, model, { hopperState: next, layerState: { A: { layerPct: 100 } }, stageAspect: 1.5 });
  assert.equal(patched.hoppers, 1);
  const fresh = mount.querySelectorAll("[data-role='hopper']").find(h => h.getAttribute("data-hopper-index") === "0");
  assert.ok(fresh !== hopper, "the hopper was rebuilt");
  assert.ok(fresh.classList.contains("is-overdue"));
  assert.ok(fresh.classList.contains("is-highlighted"));
  assert.ok(fresh.querySelector(".station-hopper__rundown"), "still tracked, still flowing");
});

/* ----------------------------------------------------------------------
 *   The stylesheet: precedence, tokens, reduced motion
 * -------------------------------------------------------------------- */

test("the flow and the wash are styled from tokens, the outline's claimants stand over overdue, reduced motion stills the flow and keeps the state, and every theme names a flow colour", () => {
  const raw = read("station/styles/components/hopper.css");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = name => { const at = css.indexOf(`${name} {`); assert.ok(at >= 0, `${name} has no rule`); return css.slice(at, css.indexOf("}", at)); };
  // The flow: the theme's flow colour, with the tracking colour behind it,
  // at full strength - the chevrons ARE the tracked state.
  assert.match(rule(".station-hopper__rundown-chevrons"), /stroke: var\(--station-rundown-flow, var\(--station-tracking\)\);/);
  const flowOpacity = Number(/opacity: (0\.\d+|1);/.exec(rule(".station-hopper__rundown-chevrons"))[1]);
  assert.ok(flowOpacity >= 0.9, `the chevrons are at full strength (${flowOpacity})`);
  assert.match(rule(".station-hopper__rundown"), /overflow: hidden;/);
  assert.match(rule(".station-hopper__rundown-flow"), /animation: station-rundown-flow var\(--station-rundown-duration, 2\.4s\) linear infinite;/);
  // Tracked is chevron-led, not fill-led: the vessel keeps its own steel
  // but for the faintest tint of the flow colour - the fill only, the
  // outline stays free.
  const trackedShell = rule(".station-hopper.is-tracking .station-hopper__shell");
  assert.match(trackedShell, /\{\s*fill: color-mix\(in srgb, var\(--station-rundown-flow, var\(--station-tracking\)\) (\d+)%, var\(--station-hopper-metal\)\);\s*$/);
  const trackedShare = Number(/\) (\d+)%, var\(--station-hopper-metal\)/.exec(trackedShell)[1]);
  assert.ok(trackedShare >= 4 && trackedShare <= 12, `a faint tint, not a wash (${trackedShare}%)`);
  assert.doesNotMatch(trackedShell, /stroke/);
  assert.match(css, /@keyframes station-rundown-flow \{\s*from \{ transform: translateY\(0\); \}\s*to \{ transform: translateY\(var\(--station-rundown-period, \d+px\)\); \}/);
  // Slow, linear, continuous: no pulse, no glow, no bounce, no flash.
  assert.doesNotMatch(css, /animation:[^;]*(alternate|ease-in-out|steps\(|infinite\s+[a-z]+\s+alternate)/);
  assert.doesNotMatch(css, /@keyframes[^{]*\{[^}]*opacity/, "the flow animates nothing but transform");
  assert.doesNotMatch(css, /filter:\s*drop-shadow|text-shadow/);
  // Reduced motion: the flow stands; nothing removes it.
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(reduced);
  assert.match(reduced[1], /\.station-hopper__rundown-flow \{\s*animation: none;\s*\}/);
  assert.doesNotMatch(reduced[1], /display: none|visibility: hidden|opacity: 0/);
  // Overdue: a strong wash of the DANGER colour on the vessel - late in
  // every palette, never the warning's amber - stronger than the tracked
  // wash, not a red slab, not a flash; the outline and the chevrons in danger.
  const overdue = rule(".station-hopper.is-overdue .station-hopper__shell");
  assert.match(overdue, /fill: color-mix\(in srgb, var\(--station-danger\) \d+%, var\(--station-hopper-metal\)\);/);
  const share = Number(/var\(--station-danger\) (\d+)%/.exec(overdue)[1]);
  assert.ok(share >= 25 && share <= 35, `a controlled wash (${share}%)`);
  assert.ok(share >= trackedShare * 2, "clearly stronger than the tracked tint, and in the danger family rather than the flow's");
  assert.match(overdue, /stroke: var\(--station-danger\);/);
  assert.match(overdue, /stroke-width: var\(--station-line-medium\);/);
  assert.doesNotMatch(css, /is-overdue[^{]*\{[^}]*--station-warning/, "overdue never borrows the warning's amber");
  assert.match(rule(".station-hopper.is-overdue .station-hopper__rundown-chevrons"), /stroke: var\(--station-danger\);/);
  const overdueFlowOpacity = Number(/opacity: (0\.\d+|1);/.exec(rule(".station-hopper.is-overdue .station-hopper__rundown-chevrons"))[1]);
  assert.ok(overdueFlowOpacity >= 0.85, "the danger chevrons are not weaker than the tracked ones' family");
  assert.doesNotMatch(css, /is-overdue[^{]*\{[^}]*animation/);
  assert.doesNotMatch(css, /is-overdue[^{]*__(resin|id)\b/, "the resin name and the id stay their own");
  // The outline's claimants are restated after overdue, so they win by
  // specificity and position: hover, highlight, focus, selection.
  const at = name => css.indexOf(name);
  assert.ok(at(".station-hopper.is-overdue:hover .station-hopper__shell") > at(".station-hopper.is-overdue .station-hopper__shell {"));
  assert.match(css, /\.station-hopper\.is-overdue:hover \.station-hopper__shell,\s*\.station-hopper\.is-overdue:focus-within \.station-hopper__shell,\s*\.station-hopper\.is-overdue\.is-focused \.station-hopper__shell,\s*\.station-hopper\.is-overdue\.is-highlighted \.station-hopper__shell \{\s*stroke: color-mix\(in srgb, var\(--station-accent-hover\) 68%, var\(--station-hopper-stroke\)\);/);
  assert.match(css, /\.station-hopper\.is-overdue\.is-selected \.station-hopper__shell,\s*\.station-hopper\.is-overdue\.is-drop-target \.station-hopper__shell \{\s*stroke: var\(--station-accent\);/);
  // Pump-off keeps its own marks (the receiver, the fill, the hose) untouched by overdue.
  assert.doesNotMatch(css, /is-overdue[^{]*(receiver|__fill\b|hose)/);
  // Blend Edit hides the cluster whole; it removes no class.
  assert.match(css, /\.station-layer\.is-flipped \.station-hopper-cluster \{\s*display: none;/);
  // No raw colour anywhere in the sheet.
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(/i);
  // Every theme answers the flow token.
  for (const theme of fs.readdirSync(path.join(ROOT, "station/styles/themes")).filter(n => n.endsWith(".css"))) {
    assert.match(read(`station/styles/themes/${theme}`), /--station-rundown-flow: #[0-9a-f]{6};/i, `${theme} names no flow colour`);
  }
  // Blueprint's flow is its pale blue, Gruvbox's a warm tone: not one green everywhere.
  assert.match(read("station/styles/themes/blueprint.css"), /--station-rundown-flow: #a9d6f5;/);
  assert.match(read("station/styles/themes/gruvbox-dark.css"), /--station-rundown-flow: #e0a028;/);
  assert.match(read("station/styles/themes/gruvbox-light.css"), /--station-rundown-flow: #4a4405;/);
  // And every theme's flow holds against the vessel it is drawn on: at
  // least 3:1 (WCAG's graphical-object floor) against the hopper metal
  // (hopper.css: steel-light 72%, hopper-stroke 28%), the light themes
  // included - and never the theme's danger, which overdue owns.
  for (const theme of fs.readdirSync(path.join(ROOT, "station/styles/themes")).filter(n => n.endsWith(".css"))) {
    const sheet = read(`station/styles/themes/${theme}`);
    const token = name => { const m = new RegExp(`${name}: (#[0-9a-f]{6});`, "i").exec(sheet); assert.ok(m, `${theme} lacks ${name}`); return m[1]; };
    const metal = mixHex(token("--station-steel-light"), token("--station-hopper-stroke"), 0.72);
    const flow = token("--station-rundown-flow");
    assert.ok(contrast(flow, metal) >= 3, `${theme}: the flow (${flow}) at ${contrast(flow, metal).toFixed(2)}:1 against the vessel`);
    assert.notEqual(flow.toLowerCase(), token("--station-danger").toLowerCase(), `${theme}: the flow is not the danger`);
  }
});

/* sRGB arithmetic for the contrast check above: what color-mix(in srgb)
   does to the vessel, and WCAG's relative luminance and contrast ratio. */
function hexChannels(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function mixHex(a, b, share) { const [ca, cb] = [hexChannels(a), hexChannels(b)]; return ca.map((v, i) => v * share + cb[i] * (1 - share)); }
function luminance(channels) {
  const [r, g, b] = channels.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(hex, channels) {
  const [hi, lo] = [luminance(hexChannels(hex)), luminance(channels)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ----------------------------------------------------------------------
 *   Station booted for real: the marks on the stage
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  return [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]).filter(file => file !== "station/station.js");
}

const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "changeover-estimate.js", "workspace-configuration-payloads.js",
  "station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js",
  "station-connection-bridge.js", "station-recipes-bridge.js"
];

const tick = () => new Promise(resolve => setImmediate(resolve));
const clockOf = at => `${String(new Date(at).getHours()).padStart(2, "0")}:${String(new Date(at).getMinutes()).padStart(2, "0")}`;

function snapshot() {
  return {
    line: { lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layerPct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
        // A1 and C1: 300 lb at 162 lb/hr, 111 min. B1: 30 lb at 216 lb/hr,
        // 8 min. A2: tracked, no weight, no estimate.
        weight: index === 0 ? (name === "B" ? 30 : 300) : 0, usableHeight: 30, effectiveWeight: index === 0 ? (name === "B" ? 30 : 300) : 0,
        track: index === 0 || (name === "A" && index === 1), pumpOff: false
      }))
    })),
    revision: 1
  };
}

function boot() {
  focused = null;
  const doc = fakeDocument();
  const timers = [];
  const window = {
    document: doc,
    location: { href: "https://resin.tools/?view=station", search: "?view=station" },
    matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    URL, Promise, console, Math, Date, Number, String, Object, Array, JSON, Error, Set, Map, WeakMap, Symbol, RegExp,
    parseInt, parseFloat, isFinite, isNaN, Intl,
    navigator: { userAgent: "node" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
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
  const layerOf = id => snap.layers.find(layer => layer.name === id) || null;
  window.PolynStationCommandBridge.connect({
    execute(command, args) {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
      if (command === "setChangeover") { snap.job.changeoverTime = args.at === null ? "" : clockOf(args.at); snap.job.changeoverSetAt = args.at === null ? null : Date.now(); }
      if (command === "setPumpOff" && layerOf(args.layer)) layerOf(args.layer).hoppers[args.index].pumpOff = !!args.pumpOff;
      if (command === "setHopperTracking" && layerOf(args.layer)) layerOf(args.layer).hoppers[args.index].track = !!args.track;
      snap.revision += 1;
      handle.publish();
      return contract.success({ changed: true, revision: stateBridge.getRevision(), persisted: true, snapshot: stateBridge.getSnapshot() });
    },
    capabilities: [...contract.COMMANDS]
  });
  new vm.Script(read("station/station.js"), { filename: "station/station.js" }).runInContext(context);
  const machine = doc.querySelector("[data-station-mount='machine']");
  assert.ok(machine);
  const hoppers = () => machine.querySelectorAll("[data-role='hopper']");
  return {
    doc, window, calls, machine, timers, snap, handle,
    hopper: id => hoppers().find(h => h.getAttribute("data-hopper") === id),
    overdue: () => hoppers().filter(h => h.classList.contains("is-overdue")).map(h => h.getAttribute("data-hopper")),
    tracked: () => hoppers().filter(h => h.classList.contains("is-tracking")).map(h => h.getAttribute("data-hopper")),
    flowing: () => hoppers().filter(h => h.querySelector(".station-hopper__rundown")).map(h => h.getAttribute("data-hopper")),
    /* A change from elsewhere - another device, the floor UI - arrives as
     * a publish the bridge coalesces to the next microtask: awaited. */
    setChangeover: async at => { snap.job.changeoverTime = at === null ? "" : clockOf(at); snap.job.changeoverSetAt = at === null ? null : Date.now(); snap.revision += 1; handle.publish(); await tick(); await tick(); },
    /* The timeline's clock pass, as its timer would run it. */
    tick: () => { const timer = timers[timers.length - 1]; assert.ok(timer, "the timeline scheduled its pass"); timer.fn(); },
    control: (id, kind) => machine.querySelectorAll("[data-station-target]").find(n => n.getAttribute("data-station-target") === kind && n.getAttribute("data-hopper") === id)
  };
}

test("booted: tracked hoppers flow, none is overdue without a changeover; a changeover the tracked hopper cannot make marks it - and only it - overdue, from the timeline's projection; clearing the changeover clears the mark", async () => {
  const s = boot();
  assert.deepEqual(s.tracked().sort(), ["A1", "A2", "B1", "C1"]);
  assert.deepEqual(s.flowing().sort(), ["A1", "A2", "B1", "C1"], "every tracked hopper flows, weight or not");
  assert.deepEqual(s.overdue(), []);
  const before = s.calls.length;
  // A changeover in 30 minutes: A1 (111 min to empty) and C1 (111 min) are
  // past their pump-off point; B1 (8 min) has 22 minutes in hand, A2 has no
  // weight and no estimate.
  await s.setChangeover(Date.now() + 30 * MINUTE);
  assert.deepEqual(s.overdue().sort(), ["A1", "C1"]);
  assert.ok(s.hopper("A1").classList.contains("is-tracking"));
  assert.ok(s.hopper("A1").querySelector(".station-hopper__rundown"), "overdue keeps the flow: the hopper is still running down");
  assert.ok(!s.hopper("B1").classList.contains("is-overdue"));
  assert.ok(!s.hopper("A2").classList.contains("is-overdue"));
  assert.ok(!s.hopper("A3").classList.contains("is-overdue"));
  // The same mark the timeline carries.
  const marks = s.window.PolynStationRundown.hopperMarks;
  assert.ok(typeof marks === "function");
  assert.equal(s.calls.length, before, "the marks dispatched nothing");
  assert.equal(s.snap.revision, 2, "the marks published nothing (one publish: the changeover)");
  await s.setChangeover(null);
  assert.deepEqual(s.overdue(), []);
  assert.deepEqual(s.flowing().sort(), ["A1", "A2", "B1", "C1"]);
});

test("a moved changeover moves every derived instant with it: pumpOffBy shifts by the move, late and overdue follow, in both directions", () => {
  const model = lineModel.buildLineModel({ layerCount: 1, layerAPosition: null, hopperCount: 2, hopperNamingMode: "standard", layers: [{ name: "A", layerPct: 100, hoppers: [{ index: 0, usableHeight: 30 }, { index: 1, usableHeight: 30 }] }] });
  // At 270 lb/hr: A:0 runs 111 minutes (300 lb at 162 lb/hr), A:1 17 minutes (30 lb at 108 lb/hr).
  const hopperState = {
    "A:0": { track: true, pumpOff: false, pct: 60, effectiveWeight: 300, observedAt: NOW },
    "A:1": { track: true, pumpOff: false, pct: 40, effectiveWeight: 30, observedAt: NOW }
  };
  const layerState = { A: { layerPct: 100 } };
  const project = changeoverAt => rundown.projectEntries({ model, hopperState, layerState, job: { lineRate: 270 } }, { now: NOW, changeoverAt });
  const by = entries => Object.fromEntries(entries.map(e => [e.key, { pumpOffBy: e.pumpOffBy, late: e.late, overdue: e.overdue, emptyAt: e.emptyAt }]));

  // Established: a changeover in 30 minutes. A:0 needs 111 minutes, so its
  // pump-off point is 81 minutes gone; A:1 needs 17, with 13 in hand.
  const early = by(project(NOW + 30 * MINUTE));
  assert.equal(early["A:0"].late, true); assert.equal(early["A:0"].overdue, true);
  assert.equal(early["A:1"].late, false); assert.equal(early["A:1"].overdue, false);
  assert.ok(Math.abs(early["A:0"].pumpOffBy - (NOW + 30 * MINUTE - (300 / 162) * HOUR)) < 1, "pumpOffBy is the changeover less the run-down");
  // Moved two hours later: every pump-off point moves the same two hours,
  // A:0 comes back on time, and nothing anchored (the empty-at instants) moves.
  const later = by(project(NOW + 150 * MINUTE));
  for (const key of ["A:0", "A:1"]) {
    assert.ok(Math.abs(later[key].pumpOffBy - early[key].pumpOffBy - 120 * MINUTE) < 1, `${key}'s pump-off point moved with the changeover`);
    assert.equal(later[key].emptyAt, early[key].emptyAt, `${key}'s run-down end is the anchor's, not the changeover's`);
  }
  assert.equal(later["A:0"].late, false); assert.equal(later["A:0"].overdue, false);
  assert.deepEqual(rundown.hopperMarks(project(NOW + 150 * MINUTE)), {
    "A:0": { tracked: true, pumpOff: false, late: false, overdue: false },
    "A:1": { tracked: true, pumpOff: false, late: false, overdue: false }
  });
  // Moved earlier than either can make - 10 minutes out: both late at once.
  const earlier = by(project(NOW + 10 * MINUTE));
  assert.ok(Math.abs(early["A:1"].pumpOffBy - earlier["A:1"].pumpOffBy - 20 * MINUTE) < 1);
  assert.deepEqual(rundown.hopperMarks(project(NOW + 10 * MINUTE)), {
    "A:0": { tracked: true, pumpOff: false, late: true, overdue: true },
    "A:1": { tracked: true, pumpOff: false, late: true, overdue: true }
  });
  // Cleared: no boundary, no pump-off point, nothing late.
  assert.deepEqual(by(project(null))["A:0"], { pumpOffBy: null, late: false, overdue: false, emptyAt: early["A:0"].emptyAt });
});

test("booted: a changeover set through the Station's own path (the calculator's deadline, the job controls' command) re-derives the marks at once - later clears the overdue hoppers, earlier marks new ones, the timeline's line moves with them, no refresh and no clock pass between", () => {
  const s = boot();
  const panel = s.doc.querySelector(".station-changeover__panel");
  assert.ok(panel, "the calculator is mounted");
  const deadline = panel.querySelector(".station-changeover__time");
  const line = () => s.doc.querySelector(".station-rundown__changeover");
  const lineTime = () => { const t = line().querySelector(".station-rundown__changeover-time"); return t ? t.textContent : null; };
  const markerX = id => { const m = s.doc.querySelector(`.station-rundown__marker[data-hopper='${id}']`); return m ? Number(/--station-rundown-x: ([\d.]+)%/.exec(m.getAttribute("style"))[1]) : null; };
  const markerWord = id => { const m = s.doc.querySelector(`.station-rundown__marker[data-hopper='${id}']`); return m ? (m.classList.contains("is-late") ? "Late" : "on time") : null; };
  const set = at => {
    const before = s.calls.length;
    deadline.value = clockOf(at);
    deadline.dispatchEvent(makeEvent("input", { bubbles: true }));
    panel.querySelector("[data-action='set-deadline']").click();
    // One command, answered and drawn synchronously: what follows is read
    // straight after the click, with no bridge notification awaited.
    assert.equal(s.calls.length, before + 1);
    assert.equal(s.calls[before].command, "setChangeover");
    assert.ok(Math.abs(s.calls[before].args.at - at) < MINUTE, "the deadline is the instant typed, to the minute");
  };
  const clockOfSnap = () => s.snap.job.changeoverTime;

  assert.deepEqual(s.overdue(), []);
  assert.ok(line().hasAttribute("hidden"), "no changeover, no line");

  // Established, 30 minutes out: A1 and C1 (111 minutes to run) are past
  // their pump-off point; B1 (8 minutes) is not.
  const emptyX = markerX("A1");
  assert.ok(emptyX > 0, "without a changeover A1's marker stands at its run-empty estimate");
  const first = Date.now() + 30 * MINUTE;
  set(first);
  assert.equal(clockOfSnap(), clockOf(first));
  assert.deepEqual(s.overdue().sort(), ["A1", "C1"]);
  assert.ok(!line().hasAttribute("hidden"));
  assert.equal(lineTime(), s.window.PolynStationRundown.formatClock(first));
  // The markers stand at the pump-off points now: A1's has passed (on
  // Now, "Late"), B1's is 22 minutes off.
  assert.equal(markerX("A1"), 0);
  assert.equal(markerWord("A1"), "Late");
  assert.ok(markerX("B1") > 0 && markerX("B1") < emptyX);
  const b1Early = markerX("B1");

  // Moved three hours later: A1 and C1 come back on time - the wash goes
  // with the mark, the flow stays - and the line follows.
  const later = Date.now() + 3 * HOUR;
  set(later);
  assert.equal(clockOfSnap(), clockOf(later));
  assert.deepEqual(s.overdue(), []);
  assert.ok(s.hopper("A1").classList.contains("is-tracking") && s.hopper("A1").querySelector(".station-hopper__rundown"));
  assert.equal(lineTime(), s.window.PolynStationRundown.formatClock(later));
  // Every pump-off point moved the same two and a half hours with it.
  assert.ok(markerX("A1") > 0 && markerWord("A1") !== "Late");
  assert.ok(Math.abs(markerX("B1") - b1Early - (150 * MINUTE) / (6 * HOUR) * 100) < 0.05, "B1's marker moved by the move");

  // Moved earlier than any of them can make - five minutes out: B1 joins
  // A1 and C1 at once.
  const earlier = Date.now() + 5 * MINUTE;
  set(earlier);
  assert.deepEqual(s.overdue().sort(), ["A1", "B1", "C1"]);
  assert.equal(lineTime(), s.window.PolynStationRundown.formatClock(earlier));
  assert.deepEqual(["A1", "B1", "C1"].map(markerWord), ["Late", "Late", "Late"]);

  // The marks agree with a fresh projection of the very same inputs -
  // one derivation (station-rundown.js), the classes its reading.
  const snapshotNow = s.window.PolynStationStateBridge.getSnapshot();
  const resolved = s.window.PolynStationSource.resolveSource({ href: s.window.location.href, snapshot: snapshotNow, demoLines: s.window.PolynStationDemoLines });
  const co = s.window.PolynStationRundown.resolveChangeover(resolved.job, { now: Date.now() });
  const fresh = s.window.PolynStationRundown.hopperMarks(s.window.PolynStationRundown.projectEntries({
    model: s.window.PolynStationLineModel.buildLineModel(resolved.modelInput), hopperState: resolved.hopperState, layerState: resolved.layerState, job: resolved.job
  }, { now: Date.now(), changeoverAt: co.at }));
  assert.deepEqual(Object.keys(fresh).filter(k => fresh[k].overdue).sort(), ["A:0", "B:0", "C:0"]);

  // Cleared through the same surface: the marks and the line go together.
  panel.querySelector("[data-action='clear-deadline']").click();
  assert.equal(s.calls[s.calls.length - 1].command, "setChangeover");
  assert.equal(s.calls[s.calls.length - 1].args.at, null);
  assert.deepEqual(s.overdue(), []);
  assert.ok(line().hasAttribute("hidden"));
  assert.ok(Math.abs(markerX("A1") - emptyX) < 0.05, "and A1's marker is back at its run-empty estimate");
});

test("booted: the clock pass moves the mark; pump-off takes it away; untracking takes the flow away; the marks survive a value patch and Blend Edit", async () => {
  const s = boot();
  // A changeover three hours off: A1 has 111 minutes to run, so it is not
  // yet late...
  await s.setChangeover(Date.now() + 3 * HOUR);
  assert.deepEqual(s.overdue(), []);
  // ...until the clock has run 90 minutes, which the timeline's pass
  // discovers; the pass writes the mark, and no other clock does.
  const realNow = Date.now;
  Date.now = () => realNow() + 90 * MINUTE;
  try {
    s.tick();
    assert.deepEqual(s.overdue().sort(), ["A1", "C1"]);
  } finally {
    Date.now = realNow;
  }
  s.tick();
  assert.deepEqual(s.overdue(), []);
  // Overdue again, then A1's pump is marked off through its own control:
  // not overdue, still tracked, still flowing.
  await s.setChangeover(Date.now() + 30 * MINUTE);
  assert.deepEqual(s.overdue().sort(), ["A1", "C1"]);
  s.control("A1", "pump").click();
  assert.equal(s.calls[s.calls.length - 1].command, "setPumpOff");
  assert.ok(s.hopper("A1").classList.contains("is-pump-off"));
  assert.ok(!s.hopper("A1").classList.contains("is-overdue"));
  assert.ok(s.hopper("A1").classList.contains("is-tracking"));
  assert.ok(s.hopper("A1").querySelector(".station-hopper__rundown"));
  assert.deepEqual(s.overdue(), ["C1"]);
  // C1 untracked: no flow, no mark.
  s.control("C1", "tracking").click();
  assert.equal(s.calls[s.calls.length - 1].command, "setHopperTracking");
  assert.ok(!s.hopper("C1").classList.contains("is-tracking"));
  assert.equal(s.hopper("C1").querySelector(".station-hopper__rundown"), null);
  assert.deepEqual(s.overdue(), []);
  // Tracked again: overdue again, at once.
  s.control("C1", "tracking").click();
  assert.deepEqual(s.overdue(), ["C1"]);
  // Blend Edit (the machine rail's switch) turns every layer over: the
  // cluster is hidden whole, the hopper and its mark stand under the
  // card, and come back as they went.
  const blendSwitch = s.doc.querySelector("[data-role='machine-rail'] [data-action='blend-edit']");
  blendSwitch.click();
  const layerC = s.machine.querySelectorAll("[data-role='layer']").find(n => n.getAttribute("data-layer") === "C");
  assert.ok(layerC.classList.contains("is-flipped"));
  assert.ok(s.hopper("C1").classList.contains("is-overdue"), "the mark stands on the hidden cluster");
  assert.equal(layerC.querySelectorAll(".station-blend-card .station-hopper__rundown").length, 0, "the card draws no flow of its own");
  blendSwitch.click();
  assert.ok(!s.machine.querySelectorAll("[data-role='layer']").find(n => n.getAttribute("data-layer") === "C").classList.contains("is-flipped"));
  assert.deepEqual(s.overdue(), ["C1"]);
});

test("the boot file writes the marks from the timeline's projection and nothing else: no deadline of its own, no timer, no publish", () => {
  const source = read("station/station.js").replace(/\/\*[\s\S]*?\*\//g, "");
  const fn = source.slice(source.indexOf("function applyRundownMarks()"), source.indexOf("\n  }", source.indexOf("function applyRundownMarks()")));
  assert.match(fn, /timeline\.getMarks\(\)/);
  assert.match(fn, /classList\.toggle\("is-overdue", !!\(mark && mark\.overdue\)\)/);
  assert.doesNotMatch(fn, /changeover|Date\.now|resolveChangeover|hopperRundown|projectEntries|dispatch|publish|setTimeout/);
  // Called on every path that draws or moves the job: the render, the
  // feed, the clock pass.
  assert.match(source, /onTick: \(\) => \{[^}]*applyRundownMarks\(\);/);
  assert.match(source, /if \(changeoverPanel\) changeoverPanel\.update\(inputs\);\s*applyRundownMarks\(\);/);
  assert.match(source, /applyRundownMarks\(\);\s*return svg;/);
  for (const pattern of [/setInterval/, /requestAnimationFrame/]) assert.doesNotMatch(source, pattern);
  // The renderer derives no deadline and keeps no clock.
  const renderer = read("station/station-render.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(renderer, /changeover|Date\.now|hopperRundown|is-late/);
  assert.match(renderer, /for \(const carried of \["is-highlighted", "is-overdue"\]\)/);
});
