"use strict";

/* Arm-and-confirm (station/station-armed.js): the shared two-clicks-in-
 * place behaviour under the machine rail's Load Next and the timeline's
 * Reset. Tested on its own here with a fake document: what arms,
 * what disarms, one at a time, and that it draws nothing and dispatches
 * nothing - the owner is told (onChange) and does the drawing.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const armedModule = require("./station/station-armed.js");

function node(name) {
  const n = {
    tagName: name.toUpperCase(), listeners: {}, parent: null, children: [],
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
    dispatchEvent(event) { event.target = event.target || this; for (const fn of (this.listeners[event.type] || []).slice()) fn(event); return true; },
    contains(other) { let x = other; while (x) { if (x === this) return true; x = x.parent; } return false; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
  };
  return n;
}

function build(options) {
  const doc = node("#document");
  const reset = node("button");
  const promote = node("button");
  const inner = node("span");
  reset.appendChild(inner);
  const timers = [];
  const changes = [];
  const armed = armedModule.create(Object.assign({
    doc, controls: { reset, promote },
    onChange: () => changes.push(armed ? armed.armed() : null),
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
  }, options || {}));
  return { doc, reset, promote, inner, timers, changes, armed };
}

test("arm() arms one named control and tells the owner; arming another disarms the first; disarm() clears and tells; an unknown name arms nothing", () => {
  const h = build();
  assert.equal(h.armed.armed(), null);
  assert.equal(h.armed.arm("reset"), true);
  assert.equal(h.armed.armed(), "reset");
  assert.deepEqual(h.changes, ["reset"]);
  assert.equal(h.armed.arm("reset"), false, "already armed: nothing to do");
  assert.deepEqual(h.changes, ["reset"]);
  // One at a time: promote replaces reset, with a change for each step.
  assert.equal(h.armed.arm("promote"), true);
  assert.equal(h.armed.armed(), "promote");
  assert.deepEqual(h.changes, ["reset", null, "promote"]);
  assert.equal(h.armed.disarm(), true);
  assert.equal(h.armed.armed(), null);
  assert.equal(h.armed.disarm(), false, "nothing armed: nothing to do");
  assert.deepEqual(h.changes, ["reset", null, "promote", null]);
  assert.equal(h.armed.arm("nothing"), false);
  assert.equal(h.armed.armed(), null);
  assert.ok(h.armed.control("reset") === h.reset);
  assert.equal(h.armed.control("nothing"), null);
});

test("an armed control waits ARM_DURATION on the host's clock and disarms when it runs out; the timer is cleared on a disarm; 0 waits forever", () => {
  const h = build();
  h.armed.arm("reset");
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, armedModule.ARM_DURATION);
  assert.equal(armedModule.ARM_DURATION, 5000);
  h.timers[0].fn();
  assert.equal(h.armed.armed(), null, "the timeout disarmed it");
  h.armed.arm("reset");
  h.armed.disarm();
  assert.equal(h.timers[1].cleared, true, "the timer is cleared with the arm");
  const forever = build({ armDuration: 0 });
  forever.armed.arm("reset");
  assert.equal(forever.timers.length, 0, "no timer: it waits until told");
  const custom = build({ armDuration: 250 });
  custom.armed.arm("promote");
  assert.equal(custom.timers[0].ms, 250);
});

test("a pointer down anywhere but on the armed control disarms it - registered on the document in the capture phase only while armed; one inside the control does not", () => {
  const h = build();
  assert.deepEqual(h.doc.listeners, {}, "nothing listens until something is armed");
  h.armed.arm("reset");
  assert.equal((h.doc.listeners.pointerdown || []).length, 1);
  // Inside the armed control (a child of it): stays armed.
  h.doc.dispatchEvent({ type: "pointerdown", target: h.inner });
  assert.equal(h.armed.armed(), "reset");
  // On the other control: disarms (it is elsewhere).
  h.doc.dispatchEvent({ type: "pointerdown", target: h.promote });
  assert.equal(h.armed.armed(), null);
  assert.equal((h.doc.listeners.pointerdown || []).length, 0, "the listener is gone with the arm");
  h.armed.arm("promote");
  h.doc.dispatchEvent({ type: "pointerdown", target: node("div") });
  assert.equal(h.armed.armed(), null);
});

test("Escape on the armed control disarms it and stops there; blur disarms it; the same keys on the other control do nothing", () => {
  const h = build();
  h.armed.arm("reset");
  const other = { type: "keydown", key: "Escape", stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  h.promote.dispatchEvent(other);
  assert.equal(h.armed.armed(), "reset", "Escape on a control that is not armed is not ours");
  assert.equal(other.stopped, false);
  const enter = { type: "keydown", key: "Enter", stopPropagation() {}, preventDefault() {} };
  h.reset.dispatchEvent(enter);
  assert.equal(h.armed.armed(), "reset");
  const escape = { type: "keydown", key: "Escape", stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  h.reset.dispatchEvent(escape);
  assert.equal(h.armed.armed(), null);
  assert.ok(escape.stopped && escape.prevented, "Escape is consumed: it does not go on to close anything else");
  h.armed.arm("promote");
  h.reset.dispatchEvent({ type: "blur" });
  assert.equal(h.armed.armed(), "promote", "blur on the other control is not ours");
  h.promote.dispatchEvent({ type: "blur" });
  assert.equal(h.armed.armed(), null);
});

test("the module draws nothing and dispatches nothing, and is loaded by both hosts before the rail and the timeline that use it", () => {
  const read = file => fs.readFileSync(path.join(__dirname, file), "utf8");
  const source = read("station/station-armed.js").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pattern of [/\.dispatch\s*\(/, /PolynStation(?:Command|State|Connection|Recipes)Bridge/, /setAttribute|classList|textContent|createElement/, /localStorage/, /\bwindow\./]) {
    assert.doesNotMatch(source, pattern, `the helper reaches outside itself (${pattern})`);
  }
  const host = read("station-host.js");
  const html = read("station/station.html");
  const order = (text, quote) => ["station-armed.js", "station-machine-rail.js", "station-rundown-timeline.js", "station.js"].map(name => text.indexOf(quote(name)));
  for (const [text, quote] of [[host, name => `"station/${name}"`], [html, name => `src="${name}?v=`]]) {
    const at = order(text, quote);
    assert.ok(at.every(index => index > -1), "a host does not load the helper");
    assert.ok(at[0] < at[1] && at[0] < at[2] && at[2] < at[3], "the helper must be evaluated before the rail and the timeline, and both before station.js");
  }
});
