"use strict";

/* The header's job controls (station/station-job-controls.js): OUTPUT,
 * CHANGEOVER and 6H | 12H, driven against a small fake DOM and a fake
 * command bridge. What they show for a job, how an edit becomes one
 * command, what a refusal does, and that the window is a scale only.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const controlsModule = require("./station/station-job-controls.js");
const rundown = require("./station/station-rundown.js");
const scheduling = require("./scheduling.js");
const commandBridgeModule = require("./station-command-bridge.js");
const contract = require("./station-command-contract.js");

const { MINUTE, HOUR } = rundown;
const NOW = new Date(2026, 8, 12, 14, 3, 20).getTime();

/* ---- A fake DOM (as the other Station tests) ---- */

function makeNode(doc, name) {
  const node = {
    ownerDocument: doc, tagName: name.toUpperCase(), attributes: {}, children: [], parent: null, listeners: {}, textContent: "", value: "",
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    append(...nodes) { for (const child of nodes) this.appendChild(child); },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    closest(selector) { let n = this; while (n && n.tagName) { if (matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatchEvent(event) { event.target = event.target || this; let n = this; while (n && !event.stopped) { for (const fn of n.listeners[event.type] || []) fn(event); if (!event.bubbles) break; n = n.parent; } return true; },
    focus() { doc.activeElement = this; },
    select() { this.selected = true; },
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
function fakeDocument() { const doc = makeNode(null, "#document"); doc.activeElement = null; doc.createElement = name => makeNode(doc, name); return doc; }

const byClass = (root, name) => root.querySelector(`.${name}`);
const hidden = node => node.hasAttribute("hidden");
const click = node => node.dispatchEvent({ type: "click", bubbles: true });
const key = (node, k) => { const e = { type: "keydown", key: k, bubbles: true, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; node.dispatchEvent(e); return e; };
const blur = node => node.dispatchEvent({ type: "blur", bubbles: false });

/* A connected command bridge whose executor records what it was asked. */
function connected(capabilities, answer) {
  const bridge = commandBridgeModule.create();
  const calls = [];
  bridge.connect({
    capabilities: capabilities || ["setLineRate", "setChangeover"],
    execute(command, args) {
      calls.push({ command, args });
      return answer ? answer(command, args) : contract.success({ changed: true, revision: calls.length, persisted: true, snapshot: Object.freeze({}) });
    }
  });
  return { bridge, calls };
}

function mount(options) {
  const doc = fakeDocument();
  const committed = [];
  const windows = [];
  const settings = Object.assign({ now: () => NOW, onCommitted: r => committed.push(r), onWindow: h => windows.push(h) }, options || {});
  const controls = controlsModule.create(doc, settings);
  const root = controls.element;
  const item = field => root.querySelector(`[data-field='${field}']`);
  return {
    doc, controls, root, committed, windows,
    trigger: field => byClass(item(field), "station-job__trigger"),
    value: field => byClass(item(field), "station-job__value"),
    input: field => byClass(item(field), "station-job__input"),
    editor: field => byClass(item(field), "station-job__editor"),
    wrap: item,
    note: () => byClass(root, "station-job__note")
  };
}

/* ----------------------------------------------------------------------
 *   Display
 * -------------------------------------------------------------------- */

test("the three items, compact and in order: OUTPUT, CHANGEOVER, then 6H | 12H; nothing is a heading", () => {
  const { root } = mount();
  assert.deepEqual(root.children.map(n => n.getAttribute("class").split(" ")[0]), ["station-job__item", "station-job__item", "station-job__window", "station-job__note"]);
  assert.deepEqual(root.children.slice(0, 2).map(n => n.getAttribute("data-field")), ["output", "changeover"]);
  assert.deepEqual(root.querySelectorAll(".station-job__key").map(n => n.textContent), ["Output", "Changeover"]);
  assert.deepEqual(root.querySelectorAll(".station-job__scale").map(n => [n.textContent, n.getAttribute("aria-pressed")]), [["6H", "true"], ["12H", "false"]]);
  walk(root, node => assert.ok(!/^H[1-6]$/.test(node.tagName)));
  assert.equal(root.getAttribute("role"), "group");
});

test("the readouts state the job: output in lb/hr or Not set; the changeover as its clock time and how far off, or Not set, or needing confirmation", () => {
  const { controls, value, wrap } = mount();
  controls.update({ job: { lineRate: 0, changeoverTime: "", changeoverSetAt: null } });
  assert.equal(value("output").textContent, "Not set");
  assert.equal(value("changeover").textContent, "Not set");
  assert.ok(wrap("output").classList.contains("is-unset"));
  controls.update({ job: { lineRate: 850, changeoverTime: "16:30", changeoverSetAt: NOW - HOUR } });
  assert.equal(value("output").textContent, "850 lb/hr");
  assert.match(value("changeover").textContent, /^(4:30 PM|16:30) · in 2h 26m$/);
  assert.ok(!wrap("output").classList.contains("is-unset"));
  assert.ok(!wrap("changeover").classList.contains("is-stale"));
  controls.update({ job: { lineRate: 1234.5, changeoverTime: "16:30", changeoverSetAt: NOW - scheduling.CHANGEOVER_STALE_MS - 1 } });
  assert.equal(value("output").textContent, "1,234.5 lb/hr");
  assert.match(value("changeover").textContent, /· confirm$/);
  assert.ok(wrap("changeover").classList.contains("is-stale"));
  assert.equal(controlsModule.outputText(null), "Not set");
});

test("the changeover readout follows the clock through refresh, not a clock of its own", () => {
  let now = NOW;
  const { controls, value } = mount({ now: () => now });
  controls.update({ job: { lineRate: 850, changeoverTime: "16:30", changeoverSetAt: NOW } });
  assert.match(value("changeover").textContent, /in 2h 26m$/);
  now += 30 * MINUTE;
  controls.refresh();
  assert.match(value("changeover").textContent, /in 1h 56m$/);
  const src = fs.readFileSync(path.join(__dirname, "station/station-job-controls.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /setTimeout|setInterval|requestAnimationFrame/);
});

/* ----------------------------------------------------------------------
 *   Output
 * -------------------------------------------------------------------- */

test("clicking OUTPUT opens an in-place field with the value; Enter commits one setLineRate; the readout then shows what the application holds", () => {
  const { bridge, calls } = connected();
  const h = mount({ commands: () => bridge });
  h.controls.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  assert.ok(hidden(h.editor("output")));
  click(h.trigger("output"));
  assert.ok(!hidden(h.editor("output")));
  assert.equal(h.input("output").value, "850");
  assert.equal(h.doc.activeElement, h.input("output"));
  assert.equal(h.input("output").selected, true);
  assert.equal(h.trigger("output").getAttribute("aria-expanded"), "true");
  h.input("output").value = "1,200";
  const enter = key(h.input("output"), "Enter");
  assert.equal(enter.prevented, true);
  assert.deepEqual(calls, [{ command: "setLineRate", args: { lineRate: 1200 } }]);
  assert.ok(hidden(h.editor("output")), "the editor closed");
  assert.equal(h.committed.length, 1);
  assert.equal(h.doc.activeElement, h.trigger("output"), "focus returned to the trigger");
  // The readout is the job's, not the field's: until the application
  // publishes 1200 it still says 850.
  assert.equal(h.value("output").textContent, "850 lb/hr");
  h.controls.update({ job: { lineRate: 1200, changeoverTime: "", changeoverSetAt: null } });
  assert.equal(h.value("output").textContent, "1,200 lb/hr");
});

test("an invalid output is refused by the contract before the application sees it; the field stays open, marked, with the reason; Escape abandons it", () => {
  const { bridge, calls } = connected();
  const h = mount({ commands: () => bridge });
  h.controls.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  click(h.trigger("output"));
  h.input("output").value = "abc";
  key(h.input("output"), "Enter");
  assert.deepEqual(calls, [], "nothing reached the executor");
  assert.ok(!hidden(h.editor("output")));
  assert.equal(h.input("output").getAttribute("aria-invalid"), "true");
  assert.ok(!hidden(h.note()));
  assert.match(h.note().textContent, /number of pounds per hour/);
  assert.equal(h.committed.length, 0);
  h.input("output").value = "-5";
  key(h.input("output"), "Enter");
  assert.match(h.note().textContent, /cannot be less than 0/);
  key(h.input("output"), "Escape");
  assert.ok(hidden(h.editor("output")));
  assert.ok(hidden(h.note()));
  assert.deepEqual(calls, []);
});

test("an emptied output clears it (zero, as the field reads it); blur commits like Enter; an unchanged answer commits nothing upstream", () => {
  const { bridge, calls } = connected(null, () => contract.success({ changed: false, revision: 1, persisted: false, snapshot: Object.freeze({}) }));
  const h = mount({ commands: () => bridge });
  h.controls.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  click(h.trigger("output"));
  h.input("output").value = "";
  blur(h.input("output"));
  assert.deepEqual(calls, [{ command: "setLineRate", args: { lineRate: 0 } }]);
  assert.ok(hidden(h.editor("output")));
  assert.equal(h.committed.length, 0, "an unchanged result runs no publish");
});

/* ----------------------------------------------------------------------
 *   Changeover
 * -------------------------------------------------------------------- */

test("clicking CHANGEOVER opens a time field; a clock time becomes the instant the application would read it as - today, or tomorrow once passed", () => {
  const { bridge, calls } = connected();
  const h = mount({ commands: () => bridge });
  h.controls.update({ job: { lineRate: 850, changeoverTime: "16:30", changeoverSetAt: NOW } });
  click(h.trigger("changeover"));
  assert.equal(h.input("changeover").getAttribute("type"), "time");
  assert.equal(h.input("changeover").value, "16:30");
  h.input("changeover").value = "03:28";
  key(h.input("changeover"), "Enter");
  const expected = scheduling.parseChangeoverDate("03:28", new Date(NOW)).getTime();
  assert.deepEqual(calls, [{ command: "setChangeover", args: { at: expected } }]);
  assert.ok(expected > NOW, "03:28 has passed today, so it is tomorrow's");
  assert.equal(new Date(expected).getHours(), 3);
  assert.equal(new Date(expected).getMinutes(), 28);
  assert.equal(h.committed.length, 1);
  // Later today stays today.
  click(h.trigger("changeover"));
  h.input("changeover").value = "18:00";
  key(h.input("changeover"), "Enter");
  assert.equal(calls[1].args.at, new Date(2026, 8, 12, 18, 0).getTime());
  // Empty clears.
  click(h.trigger("changeover"));
  h.input("changeover").value = "";
  key(h.input("changeover"), "Enter");
  assert.deepEqual(calls[2], { command: "setChangeover", args: { at: null } });
});

test("a refused changeover keeps the field open with the application's own message", () => {
  const { bridge } = connected(null, () => contract.failure("out_of_range", { field: "at", message: "That changeover time has already passed." }));
  const h = mount({ commands: () => bridge });
  h.controls.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  click(h.trigger("changeover"));
  h.input("changeover").value = "14:02";
  key(h.input("changeover"), "Enter");
  assert.ok(!hidden(h.editor("changeover")));
  assert.equal(h.input("changeover").getAttribute("aria-invalid"), "true");
  assert.equal(h.note().textContent, "That changeover time has already passed.");
  assert.equal(h.committed.length, 0);
  // Garbage in the field never becomes a request.
  h.input("changeover").value = "soon";
  key(h.input("changeover"), "Enter");
  assert.match(h.note().textContent, /hours and minutes/);
});

/* ----------------------------------------------------------------------
 *   Read-only
 * -------------------------------------------------------------------- */

test("with no bridge, or one without the command, the readouts stand and a click explains rather than opening a field", () => {
  const h = mount({ commands: () => null });
  h.controls.update({ job: { lineRate: 850, changeoverTime: "", changeoverSetAt: null } });
  assert.ok(h.wrap("output").classList.contains("is-readonly"));
  assert.equal(h.trigger("output").getAttribute("aria-disabled"), "true");
  click(h.trigger("output"));
  assert.ok(hidden(h.editor("output")));
  assert.match(h.note().textContent, /Output cannot be changed here: no application is connected/);
  assert.equal(h.value("output").textContent, "850 lb/hr");
  const partial = connected(["setLineRate"]);
  const p = mount({ commands: () => partial.bridge });
  assert.ok(!p.wrap("output").classList.contains("is-readonly"));
  assert.ok(p.wrap("changeover").classList.contains("is-readonly"));
  click(p.trigger("changeover"));
  assert.match(p.note().textContent, /does not support setChangeover/);
  assert.deepEqual(partial.calls, []);
});

/* ----------------------------------------------------------------------
 *   Window
 * -------------------------------------------------------------------- */

test("6H | 12H is a scale: it presses the button, tells the host, and asks the application nothing", () => {
  const { bridge, calls } = connected();
  const h = mount({ commands: () => bridge });
  const twelve = h.root.querySelector("[data-window='12']");
  click(twelve);
  assert.deepEqual(h.windows, [12]);
  assert.equal(h.controls.getWindow(), 12);
  assert.deepEqual(h.root.querySelectorAll(".station-job__scale").map(n => n.getAttribute("aria-pressed")), ["false", "true"]);
  assert.equal(h.root.getAttribute("data-window"), "12");
  click(twelve);
  assert.deepEqual(h.windows, [12], "the same scale again is nothing");
  assert.deepEqual(calls, [], "no command");
  assert.equal(h.committed.length, 0);
  assert.equal(h.controls.setWindow(6), true);
  assert.equal(h.controls.setWindow(7), false);
});

/* ----------------------------------------------------------------------
 *   Boundaries
 * -------------------------------------------------------------------- */

test("the controls dispatch only on the bridge they are handed, and hold no job state of their own", () => {
  const src = fs.readFileSync(path.join(__dirname, "station/station-job-controls.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(src, /commands\.dispatch\s*\(/);
  for (const pattern of [/PolynStationCommandBridge/, /PolynStationStateBridge/, /localStorage/, /supabase/i, /\.subscribe\s*\(/, /\.publish\s*\(/, /\.connect\s*\(/, /lineRate\s*=[^=]/]) {
    assert.doesNotMatch(src, pattern);
  }
  assert.deepEqual(controlsModule.COMMAND, { output: "setLineRate", changeover: "setChangeover" });
});
