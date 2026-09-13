"use strict";

/* The machine utility rail (station/station-machine-rail.js): the short
 * stack of icon controls beside the far-right hopper cluster - Blend
 * Edit's and Weights' switches, Smart Hoppers and Reset Tracking.
 *
 * Tested on its own here: what it draws, how it is placed against the
 * drawn stage (pure arithmetic over what the SVG declares), what each
 * click hands back, and the reset's arm-and-confirm. What the boot file
 * does with the callbacks - the mode, the command, the publish - is the
 * booted suite's (station-blend-edit-exit.test.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const railModule = require("./station/station-machine-rail.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake DOM
 * -------------------------------------------------------------------- */

let focused = null;

function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matchesOne(node, selector) {
  const parts = selector.match(/(\.[a-zA-Z0-9_-]+|\[[a-zA-Z-]+(?:='[^']*')?\]|[a-zA-Z]+)/g) || [];
  return parts.every(part => {
    if (part.startsWith(".")) return classSet(node).has(part.slice(1));
    const attr = part.match(/^\[([a-zA-Z-]+)(?:='([^']*)')?\]$/);
    if (attr) return attr[2] === undefined ? node.hasAttribute(attr[1]) : node.getAttribute(attr[1]) === attr[2];
    return node.nodeName.toLowerCase() === part.toLowerCase();
  });
}
function matches(node, selector) { return selector.split(",").some(one => matchesOne(node, one.trim())); }
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }

function makeEvent(type, init) {
  return Object.assign({ type, bubbles: false, stopped: false, defaultPrevented: false, target: null,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } }, init || {});
}

function makeNode(doc, name, ns) {
  const node = {
    nodeName: name, tagName: name.toUpperCase(), namespaceURI: ns || null, nodeType: 1,
    attributes: {}, children: [], parent: null, listeners: {}, style: {}, disabled: false, ownerDocument: doc,
    rect: null,
    get textContent() { return this._text !== undefined && !this.children.length ? this._text : this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this.children = []; this._text = String(v); },
    get hidden() { return this.hasAttribute("hidden"); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { if (child.parent) child.parent.removeChild(child); this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (n.nodeType === 1 && matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && n.nodeType === 1 && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
    dispatchEvent(event) {
      event.target = event.target || this;
      // Capture on the document first, as the rail's click-away listener is registered.
      if (doc && doc !== this) for (const fn of (doc.listeners[event.type] || []).slice()) fn(event);
      let n = this;
      while (n && !event.stopped) {
        for (const fn of (n.listeners[event.type] || []).slice()) fn(event);
        if (!event.bubbles) break;
        n = n.parent;
      }
      return true;
    },
    click() { this.dispatchEvent(makeEvent("pointerdown", { bubbles: true })); this.dispatchEvent(makeEvent("click", { bubbles: true })); },
    focus() { const old = focused; focused = this; if (old && old !== this) old.dispatchEvent(makeEvent("blur")); },
    blur() { if (focused !== this) return; focused = null; this.dispatchEvent(makeEvent("blur")); },
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: 0, height: 0 }; },
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
  doc.body = doc.appendChild(makeNode(doc, "body"));
  return doc;
}

/* A rail with recording callbacks and a hand-driven clock. */
function build(options) {
  focused = null;
  const doc = fakeDocument();
  const calls = [];
  const timers = [];
  const rail = railModule.create(doc, Object.assign({
    onBlendEdit: () => calls.push("blend"),
    onWeightsEdit: () => calls.push("weights"),
    onSmartHoppers: () => calls.push("smart"),
    onResetTracking: () => calls.push("reset"),
    onNextEdit: () => calls.push("next"),
    onPromote: () => calls.push("promote"),
    onCopy: () => calls.push("copy"),
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
  }, options || {}));
  doc.body.appendChild(rail.element);
  const live = () => rail.update({ hidden: false, blend: { active: false, available: true }, reset: { available: true, count: 4 } });
  return { doc, rail, calls, timers, live, blend: rail.blendButton, weights: rail.weightsButton, smart: rail.smartButton, reset: rail.resetButton, next: rail.nextButton, promote: rail.promoteButton, copy: rail.copyButton };
}

/* ----------------------------------------------------------------------
 *   What it draws
 * -------------------------------------------------------------------- */

test("four in the column - Blend Edit, Next with its two children in a flyout beside it, Weights with Smart Hoppers beside it, Reset - each an SVG glyph in Station's own classes with its name on hover and to a reader - no text label", () => {
  const { rail, blend, weights, smart, reset, next, promote, copy } = build();
  assert.equal(rail.element.getAttribute("data-role"), "machine-rail");
  assert.equal(rail.element.getAttribute("role"), "group");
  assert.deepEqual(rail.element.children.map(node => [node.tagName, node.getAttribute("data-action") || node.getAttribute("data-role")]),
    [["DIV", "blend-group"], ["DIV", "next-group"], ["DIV", "weights-group"], ["BUTTON", "reset-tracking"]]);
  // Blend Edit's group: the switch, and beside it Bulk Edit with the
  // Confirm / Cancel / field it becomes (hidden until it does).
  assert.deepEqual(rail.blendGroup.children.map(node => node.getAttribute("data-action") || node.getAttribute("class")), ["blend-edit", "station-rail__flyout"]);
  assert.deepEqual(rail.blendFlyout.children.map(node => node.getAttribute("data-action") || node.getAttribute("data-role")), ["bulk-edit", "bulk-confirm", "bulk-cancel", "bulk-field-slot"]);
  assert.ok(rail.fieldSlot.hasAttribute("hidden"), "the field's slot is hidden until a selection is on");
  assert.equal(rail.blendFlyout.getAttribute("aria-label"), "Blend Edit actions");
  assert.equal(rail.blendFlyout.getAttribute("data-open"), "false");
  assert.equal(rail.blendGroup.getAttribute("data-bulk"), "false");
  assert.equal(rail.bulkButton.hasAttribute("hidden"), false);
  assert.ok(rail.confirmButton.hasAttribute("hidden") && rail.cancelButton.hasAttribute("hidden"));
  // The rail builds no field of its own: the boot file hands one in (station-bulk-field.js).
  assert.equal(rail.element.querySelectorAll("input").length, 0);
  assert.deepEqual(rail.weightsGroup.children.map(node => node.getAttribute("data-action") || node.getAttribute("class")), ["weights-edit", "station-rail__flyout"]);
  assert.deepEqual(rail.weightsFlyout.children.map(node => node.getAttribute("data-action")), ["smart-hoppers"]);
  assert.equal(rail.weightsFlyout.getAttribute("aria-label"), "Weights actions");
  assert.equal(rail.weightsFlyout.getAttribute("data-open"), "false");
  assert.ok(rail.weightsFlyout.hasAttribute("inert"));
  // The group: the switch in the column, the flyout beside it holding the two moves.
  assert.deepEqual(rail.nextGroup.children.map(node => [node.tagName, node.getAttribute("data-action") || node.getAttribute("class")]), [["BUTTON", "next-edit"], ["DIV", "station-rail__flyout"]]);
  assert.deepEqual(rail.flyout.children.map(node => node.getAttribute("data-action")), ["promote-next", "copy-current"]);
  assert.equal(rail.flyout.getAttribute("role"), "group");
  assert.equal(rail.flyout.getAttribute("aria-label"), "Next Recipe actions");
  const REST_TITLE = {
    "Blend Edit": "Blend Edit needs a line with layers on the stage",
    "Weights": "Weights needs a line with layers on the stage",
    "Next Recipe": "Next Recipe needs a line with layers on the stage",
    "Load Next into Current": "Load Next into Current is not available: no application is connected to Station commands.",
    "Copy Current into Next": "Copy Current into Next is not available: no application is connected to Station commands.",
    "Smart Hoppers": "Smart Hoppers is not available: no application is connected to Station commands.",
    "Reset Tracking": "Reset Tracking is not available: no application is connected to Station commands.",
    "Bulk Edit": "Bulk Edit is not available: no application is connected to Station commands.",
    "Apply resin to selected hoppers": "Apply resin to selected hoppers · select a hopper on a card first",
    "Cancel bulk edit": "Cancel bulk edit · nothing is written; the selection is cleared"
  };
  for (const [button, label] of [[blend, "Blend Edit"], [weights, "Weights"], [next, "Next Recipe"], [promote, "Load Next into Current"], [copy, "Copy Current into Next"], [smart, "Smart Hoppers"], [reset, "Reset Tracking"], [rail.bulkButton, "Bulk Edit"], [rail.confirmButton, "Apply resin to selected hoppers"], [rail.cancelButton, "Cancel bulk edit"]]) {
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.getAttribute("aria-label"), label);
    assert.equal(button.getAttribute("title"), REST_TITLE[label]);
    assert.equal(button.textContent, "", "no text on the control");
    assert.ok(button.classList.contains("station-rail__control"));
    const svg = button.children[0];
    assert.equal(svg.tagName, "SVG");
    assert.equal(svg.getAttribute("viewBox"), "0 0 20 20");
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.ok(svg.children.length >= 1, "a drawn glyph");
    walk(svg, node => {
      assert.match(node.getAttribute("class") || "", /^station-rail__glyph/, `a glyph part outside the namespace: ${node.tagName}`);
      assert.ok(!["TEXT", "IMAGE", "USE"].includes(node.tagName), "a glyph from text, an image or a symbol");
    });
  }
  assert.equal(blend.getAttribute("aria-pressed"), "false", "the switch says which way it is");
  assert.equal(weights.getAttribute("aria-pressed"), "false", "so does the Weights switch");
  assert.equal(smart.getAttribute("role"), "switch", "Smart Hoppers is a switch to a reader");
  assert.equal(smart.getAttribute("aria-checked"), "false");
  assert.equal(smart.disabled, true, "held until the boot file says the application offers it");
  assert.equal(reset.getAttribute("aria-pressed"), null, "the reset is a command, not a switch");
  assert.equal(next.getAttribute("aria-pressed"), "false", "Next is the third face's switch");
  assert.equal(rail.flyout.getAttribute("data-open"), "false", "the two moves are folded until the Next face is on");
  assert.ok(rail.flyout.hasAttribute("inert") && rail.flyout.getAttribute("aria-hidden") === "true", "folded: out of the tab order and the reader's tree");
  // Hidden until told there is a line: a rail with nothing to stand beside.
  assert.ok(rail.element.hidden);
  assert.deepEqual(railModule.LABEL, { blend: "Blend Edit", weights: "Weights", smart: "Smart Hoppers", reset: "Reset Tracking", next: "Next Recipe", promote: "Load Next into Current", copy: "Copy Current into Next", bulk: "Bulk Edit", confirm: "Apply resin to selected hoppers", cancel: "Cancel bulk edit" });
});

test("the Weights switch and the Smart Hoppers switch show what they are told and hand every click back as one call; a held switch takes no click", () => {
  const { rail, weights, smart, calls, live } = build();
  live();
  assert.equal(weights.disabled, true, "Weights waits to be told there is a line");
  rail.update({ weights: { active: false, available: true } });
  assert.equal(weights.disabled, false);
  assert.match(weights.getAttribute("title"), /^Weights · receiver weights and hopper geometry/);
  weights.click();
  assert.deepEqual(calls, ["weights"]);
  assert.equal(weights.getAttribute("aria-pressed"), "false", "the rail does not turn itself on: the boot file tells it");
  rail.update({ weights: { active: true, available: true } });
  assert.equal(weights.getAttribute("aria-pressed"), "true");
  assert.ok(weights.classList.contains("is-active"));
  assert.ok(rail.element.classList.contains("is-weights-active"));
  assert.match(weights.getAttribute("title"), /^Weights · on/);
  rail.update({ weights: { active: true, available: false } });
  assert.equal(weights.disabled, false, "an active mode can always be left");

  // Smart Hoppers: held with its reason, then on offer, then on.
  rail.update({ smart: { on: false, available: false, reason: "Connect this desktop to an identified line to use Smart Hoppers." } });
  assert.equal(smart.disabled, true);
  assert.equal(smart.getAttribute("title"), "Smart Hoppers is not available: Connect this desktop to an identified line to use Smart Hoppers.");
  smart.click();
  assert.deepEqual(calls, ["weights"], "a held switch hands nothing back");
  rail.update({ smart: { on: false, available: true } });
  assert.equal(smart.disabled, false);
  assert.match(smart.getAttribute("title"), /^Smart Hoppers · off — click to compute/);
  smart.click();
  assert.deepEqual(calls, ["weights", "smart"]);
  assert.equal(smart.getAttribute("aria-checked"), "false", "the switch shows the application's state, not the click");
  rail.update({ smart: { on: true, available: true } });
  assert.equal(smart.getAttribute("aria-checked"), "true");
  assert.ok(smart.classList.contains("is-on"));
  assert.match(smart.getAttribute("title"), /^Smart Hoppers · on — weights computed/);
  assert.deepEqual(rail.getState().smart, { on: true, available: true, reason: "" });
  assert.deepEqual(rail.getState().weights, { active: true, available: false });
});

test("update() is what it shows: the switch's state and availability, the reset's availability and count, hidden and withdrawn", () => {
  const { rail, blend, reset, live } = build();
  live();
  assert.ok(!rail.element.hidden);
  assert.equal(blend.disabled, false);
  assert.equal(blend.getAttribute("title"), "Blend Edit");
  assert.equal(reset.disabled, false);
  assert.equal(reset.getAttribute("title"), "Reset Tracking · 4 hoppers");
  rail.update({ blend: { active: true, available: true } });
  assert.equal(blend.getAttribute("aria-pressed"), "true");
  assert.ok(blend.classList.contains("is-active"));
  assert.ok(rail.element.classList.contains("is-blend-active"));
  assert.match(blend.getAttribute("title"), /^Blend Edit · on/);
  rail.update({ blend: { active: false, available: false } });
  assert.equal(blend.disabled, true);
  assert.match(blend.getAttribute("title"), /needs a line with layers/);
  // On with no line to enter it with: the switch still lets the mode out.
  rail.update({ blend: { active: true, available: false } });
  assert.equal(blend.disabled, false, "an active mode can always be left");
  rail.update({ reset: { available: true, count: 1 } });
  assert.equal(reset.getAttribute("title"), "Reset Tracking · 1 hopper");
  rail.update({ reset: { available: true, count: 0 } });
  assert.equal(reset.disabled, true);
  assert.equal(reset.getAttribute("title"), "Reset Tracking · nothing is tracked");
  rail.update({ reset: { available: false, reason: "the application does not offer a tracking reset from Station.", count: 3 } });
  assert.equal(reset.disabled, true);
  assert.equal(reset.getAttribute("title"), "Reset Tracking is not available: the application does not offer a tracking reset from Station.");
  rail.update({ withdrawn: true });
  assert.ok(rail.element.classList.contains("is-withdrawn"));
  rail.update({ withdrawn: false, hidden: true });
  assert.ok(!rail.element.classList.contains("is-withdrawn"));
  assert.ok(rail.element.hidden);
  assert.deepEqual(rail.getState().reset, { available: false, reason: "the application does not offer a tracking reset from Station.", count: 3 });
});

/* ----------------------------------------------------------------------
 *   The switch
 * -------------------------------------------------------------------- */

test("the switch hands every click back as one call, whichever way the mode is going, and keeps no mode of its own", () => {
  const { rail, blend, calls, live } = build();
  live();
  blend.click();
  assert.deepEqual(calls, ["blend"]);
  assert.equal(blend.getAttribute("aria-pressed"), "false", "the rail does not turn itself on: the boot file tells it");
  rail.update({ blend: { active: true, available: true } });
  blend.click();
  assert.deepEqual(calls, ["blend", "blend"]);
  assert.equal(blend.getAttribute("aria-pressed"), "true", "nor off");
});

/* ----------------------------------------------------------------------
 *   Reset Tracking: armed, then confirmed
 * -------------------------------------------------------------------- */

test("the first click arms the reset and says so; the second confirms it as one call; nothing happens on the first", () => {
  const { rail, reset, calls, timers, live } = build();
  live();
  reset.click();
  assert.deepEqual(calls, [], "the first click resets nothing");
  assert.equal(rail.isArmed(), true);
  assert.equal(reset.getAttribute("data-armed"), "true");
  assert.ok(reset.classList.contains("is-armed"));
  assert.equal(reset.getAttribute("aria-label"), "Confirm: reset tracking for 4 hoppers");
  assert.match(reset.getAttribute("title"), /^Click again to reset tracking · 4 hoppers/);
  assert.equal(timers.length, 1, "the arm started its timer");
  assert.equal(timers[0].ms, railModule.ARM_DURATION);
  assert.ok(railModule.ARM_DURATION >= 3000 && railModule.ARM_DURATION <= 8000, "a few seconds: long enough to click again, short enough to forget");
  reset.click();
  assert.deepEqual(calls, ["reset"]);
  assert.equal(rail.isArmed(), false);
  assert.equal(reset.getAttribute("data-armed"), null);
  assert.equal(reset.getAttribute("aria-label"), "Reset Tracking");
  assert.equal(timers[0].cleared, true, "the confirm cleared the timer");
});

test("an armed reset disarms on its timeout, on a click anywhere else, on Escape, on the focus leaving, and when it stops being possible - each without a call", () => {
  const { doc, rail, reset, calls, timers, live } = build();
  live();
  // Timeout.
  reset.click();
  assert.equal(rail.isArmed(), true);
  timers[0].fn();
  assert.equal(rail.isArmed(), false);
  // Click-away: a pointer down anywhere outside the control.
  reset.click();
  const elsewhere = doc.createElement("div");
  doc.body.appendChild(elsewhere);
  elsewhere.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(rail.isArmed(), false, "a click elsewhere disarmed it");
  assert.equal(timers[1].cleared, true);
  // A pointer down on the control itself (the confirming click's own) does not.
  reset.click();
  assert.equal(rail.isArmed(), true);
  reset.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(rail.isArmed(), true);
  // Escape on the control.
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  reset.dispatchEvent(escape);
  assert.equal(rail.isArmed(), false);
  assert.equal(escape.stopped, true, "spent on the control, not passed to the stage's Escape");
  // Escape when not armed is not the rail's.
  const idle = makeEvent("keydown", { key: "Escape", bubbles: true });
  reset.dispatchEvent(idle);
  assert.equal(idle.stopped, false);
  // Focus leaving.
  reset.focus();
  reset.click();
  assert.equal(rail.isArmed(), true);
  reset.blur();
  assert.equal(rail.isArmed(), false);
  // The reset stopping being possible.
  reset.click();
  rail.update({ reset: { available: true, count: 0 } });
  assert.equal(rail.isArmed(), false);
  rail.update({ reset: { available: true, count: 2 } });
  reset.click();
  rail.update({ withdrawn: true });
  assert.equal(rail.isArmed(), false, "a layer opening disarms it");
  rail.update({ withdrawn: false });
  reset.click();
  rail.update({ reset: { available: false, count: 2 } });
  assert.equal(rail.isArmed(), false);
  assert.deepEqual(calls, [], "none of it reset anything");
  // Disabled: a click does nothing at all.
  reset.click();
  assert.equal(rail.isArmed(), false);
  // The switch's click disarms too: one thing at a time.
  rail.update({ reset: { available: true, count: 2 } });
  reset.click();
  assert.equal(rail.isArmed(), true);
  rail.blendButton.click();
  assert.equal(rail.isArmed(), false);
  assert.deepEqual(calls, ["blend"]);
  // The click-away listener is gone once disarmed: nothing is left on the document.
  assert.deepEqual(doc.listeners.pointerdown || [], []);
});

/* ----------------------------------------------------------------------
 *   Placement
 * -------------------------------------------------------------------- */

const VB = { width: 1378, height: 740 };
const CLUSTERS = [
  { x: 48, y: 10, width: 210, height: 394 },
  { x: 584, y: 10, width: 210, height: 394 },
  { x: 1120, y: 10, width: 210, height: 394 }
];

test("anchor() stands the rail along the far-right box's outer edge - its top and height the box's own - through the scale-to-fit arithmetic, in the host's pixels", () => {
  // Height-constrained: the drawing is letterboxed left and right.
  const stage = { left: 16, top: 80, width: 1400, height: 560 };
  const host = { left: 0, top: 64, width: 1432, height: 592 };
  const rail = { width: 36, height: 78 };
  const at = railModule.anchor({ viewBox: VB, clusters: CLUSTERS, stage, host, rail });
  const scale = 560 / 740;
  const offsetX = (1400 - 1378 * scale) / 2;
  const right = 1330 * scale + offsetX + 16;
  const top = 10 * scale + 80 - 64;
  const left = Math.round(right + railModule.GAP);
  assert.deepEqual(at, { left, top: Math.round(top), height: Math.round(394 * scale), roomRight: Math.round(1432 - (right + railModule.GAP + 36) - railModule.EDGE) });
  assert.ok(at.height > 78, "the strip is the box's height, taller than its two controls");
  assert.ok(at.roomRight >= railModule.FLYOUT_ROW_WIDTH, "letterboxed, there is room for a two-child flyout beside the rail");
  // Which cluster is furthest right is read, not assumed: the order of
  // the list does not matter (a line drawn with Layer A on the right).
  const reversed = railModule.anchor({ viewBox: VB, clusters: CLUSTERS.slice().reverse(), stage, host, rail });
  assert.deepEqual(reversed, at);
  // Width-constrained: the drawing is letterboxed top and bottom instead.
  const tall = railModule.anchor({ viewBox: VB, clusters: CLUSTERS, stage: { left: 16, top: 80, width: 1068, height: 1200 }, host: { left: 0, top: 64, width: 1100, height: 1232 }, rail });
  const tallScale = 1068 / 1378;
  const tallOffsetY = (1200 - 740 * tallScale) / 2;
  assert.equal(tall.top, Math.round(10 * tallScale + tallOffsetY + 16));
  assert.equal(tall.height, Math.round(394 * tallScale));
  // A box drawn smaller than the controls: the strip is never shorter than them.
  const tiny = railModule.anchor({ viewBox: VB, clusters: [{ x: 1120, y: 10, width: 210, height: 40 }], stage, host, rail });
  assert.equal(tiny.height, 78);
  // A cluster at the very edge of its cell: the rail stays inside the host.
  assert.equal(tall.left, Math.min(Math.round(1330 * tallScale + 16 + railModule.GAP), 1100 - 36 - railModule.EDGE));
  assert.ok(tall.left + 36 <= 1100);
  assert.ok(tall.roomRight < railModule.FLYOUT_ROW_WIDTH, "against the edge, no room for a row of two beside the rail");
  // Nothing to stand beside, or nothing drawn: null, and the rail keeps its place.
  assert.equal(railModule.anchor({ viewBox: VB, clusters: [], stage, host, rail }), null);
  assert.equal(railModule.anchor({ viewBox: VB, clusters: CLUSTERS, stage: { left: 0, top: 0, width: 0, height: 0 }, host, rail }), null);
  assert.equal(railModule.anchor(null), null);
});

test("readStage() takes the viewBox and every normal bank's declared cluster box off the drawn SVG, and nothing of a focused layout", () => {
  const doc = fakeDocument();
  const svg = doc.createElement("svg");
  svg.setAttribute("viewBox", "0 0 1378 740");
  for (const [id, emphasis, box] of [["A", "normal", "48 10 210 394"], ["B", "normal", "584 10 210 394"], ["C", "normal", "1120 10 210 394"]]) {
    const layer = doc.createElement("g");
    layer.setAttribute("data-role", "layer");
    layer.setAttribute("data-layer", id);
    layer.setAttribute("data-emphasis", emphasis);
    layer.setAttribute("data-object-cluster", box);
    svg.appendChild(layer);
  }
  assert.deepEqual(railModule.readStage(svg), { viewBox: { width: 1378, height: 740 }, clusters: CLUSTERS });
  // The card's footprint, when the drawing declares it, is what the rail
  // stands beside: wider than the cluster, the same whichever face shows.
  svg.children[2].setAttribute("data-object-card", "1106 40 238 364");
  assert.deepEqual(railModule.readStage(svg).clusters[2], { x: 1106, y: 40, width: 238, height: 364 });
  svg.children[2].removeAttribute("data-object-card");
  for (const layer of svg.children) layer.setAttribute("data-emphasis", layer.getAttribute("data-layer") === "B" ? "focused" : "dimmed");
  assert.deepEqual(railModule.readStage(svg).clusters, [], "a focused layout declares nothing for the rail");
  svg.setAttribute("viewBox", "bad");
  assert.equal(railModule.readStage(svg), null);
  assert.equal(railModule.readStage(null), null);
  assert.deepEqual(railModule.parseBox("1 2 3 4"), { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(railModule.parseBox("1 2 3"), null);
});

test("place() measures the stage, the host and itself, writes the anchor as the rail's own left and top, and marks the rail placed", () => {
  const { doc, rail, live } = build();
  live();
  const host = doc.createElement("div");
  host.rect = { left: 0, top: 64, width: 1432, height: 592 };
  const svg = doc.createElement("svg");
  svg.setAttribute("viewBox", "0 0 1378 740");
  svg.rect = { left: 16, top: 80, width: 1400, height: 560 };
  const layer = doc.createElement("g");
  layer.setAttribute("data-role", "layer");
  layer.setAttribute("data-emphasis", "normal");
  layer.setAttribute("data-object-cluster", "1120 10 210 394");
  svg.appendChild(layer);
  rail.element.rect = { left: 0, top: 0, width: 36, height: 78 };
  const at = rail.place(svg, host);
  assert.deepEqual(at, railModule.anchor({ viewBox: VB, clusters: [CLUSTERS[2]], stage: svg.rect, host: host.rect, rail: { width: 36, height: 78 } }));
  // The flyouts' shape follows the room beside the rail: a row with room
  // for two children, a column against the edge.
  assert.equal(rail.element.getAttribute("data-room"), at.roomRight < railModule.FLYOUT_ROW_WIDTH ? "tight" : "wide");
  const edge = build();
  edge.rail.update({ hidden: false, blend: { active: false, available: true } });
  const narrow = edge.doc.createElement("div");
  narrow.rect = { left: 0, top: 0, width: 1100, height: 1232 };
  svg.rect = { left: 16, top: 16, width: 1068, height: 1200 };
  edge.rail.element.rect = { left: 0, top: 0, width: 36, height: 78 };
  const tight = edge.rail.place(svg, narrow);
  assert.ok(tight && tight.roomRight < railModule.FLYOUT_ROW_WIDTH);
  assert.equal(edge.rail.element.getAttribute("data-room"), "tight");
  assert.equal(rail.element.style.left, `${at.left}px`);
  assert.equal(rail.element.style.top, `${at.top}px`);
  assert.equal(rail.element.style.height, `${at.height}px`);
  assert.ok(rail.element.classList.contains("is-placed"));
  assert.deepEqual(rail.getState().placed, at);
  // A rail not yet laid out (no size of its own) is placed by its
  // stylesheet size, so it does not land somewhere absurd.
  rail.element.rect = null;
  const fallback = rail.place(svg, host);
  assert.deepEqual(fallback, railModule.anchor({ viewBox: VB, clusters: [CLUSTERS[2]], stage: svg.rect, host: host.rect, rail: railModule.FALLBACK_SIZE }));
  // A stage with nothing to stand beside leaves the place as it was.
  layer.setAttribute("data-emphasis", "focused");
  assert.equal(rail.place(svg, host), null);
  assert.equal(rail.element.style.left, `${fallback.left}px`);
});

/* ----------------------------------------------------------------------
 *   Where it lives
 * -------------------------------------------------------------------- */

test("the module is presentation only: no dispatch, no bridge, no job read, no reach for the globals; loaded by both hosts after the hopper controls and before the boot file", () => {
  const source = read("station/station-machine-rail.js").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pattern of [/\.dispatch\s*\(/, /PolynStation(?:Command|State|Connection|Recipes)Bridge/, /hopperState|resinName|\.layers\b/, /localStorage/, /\.connect\s*\(/, /\.publish\s*\(/, /\bwindow\./]) {
    assert.doesNotMatch(source, pattern, `the rail reaches outside itself (${pattern})`);
  }
  const host = read("station-host.js");
  const html = read("station/station.html");
  const order = (text, quote) => ["station-hopper-controls.js", "station-machine-rail.js", "station.js"].map(name => text.indexOf(quote(name)));
  for (const [text, quote] of [[host, name => `"station/${name}"`], [html, name => `src="${name}?v=`]]) {
    const at = order(text, quote);
    assert.ok(at.every(index => index > -1), "a host does not load the rail");
    assert.ok(at[0] < at[1] && at[1] < at[2], "the rail must be evaluated after the hopper controls and before station.js");
  }
  assert.match(host, /"station\/styles\/components\/machine-rail\.css"/);
  assert.match(html, /styles\/components\/machine-rail\.css\?v=/);
  assert.doesNotMatch(read("index.html"), /machine-rail/, "index.html loads Station modules through the host only");
});

test("the stylesheet names no colour and no length of its own, sizes the controls from the spacing tokens, and wears the console's glass", () => {
  const raw = read("station/styles/components/machine-rail.css");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, "machine-rail.css names a colour");
  assert.match(css, /\.station-root \.station-rail__control \{[^}]*width: calc\(var\(--station-space-6\) \+ var\(--station-space-1\)\);/);
  assert.match(css, /background: var\(--station-handbook-glass\);/);
  assert.match(css, /backdrop-filter: blur\(var\(--station-handbook-glass-blur\)\)/);
  assert.match(css, /\.station-root \.station-rail__control\.is-active \{[^}]*border-color: var\(--station-accent\);/);
  assert.match(css, /\.station-root \.station-rail__control\.is-armed \{[^}]*border-color: var\(--station-warning\);/);
  // Smart Hoppers on wears the computed colour the captions wear (hopper.css).
  assert.match(css, /\.station-root \.station-rail__control\.is-on \{[^}]*border-color: var\(--station-smart, var\(--station-accent\)\);/);
  assert.match(css, /\.station-rail\.is-withdrawn \{[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;/, "a withdrawn rail leaves the tab order, not only the eye");
  assert.match(css, /\.station-rail\[hidden\] \{[^}]*display: none;/);
  // The slot is the shell's; the rail is absolute in it, its fallback the
  // cell's lower right until the script has measured.
  assert.match(css, /\.station-rail \{[^}]*position: absolute;[^}]*right: var\(--station-space-4\);[^}]*bottom: var\(--station-space-4\);/);
  assert.match(css, /\.station-rail\.is-placed \{[^}]*right: auto;[^}]*bottom: auto;/);
  assert.doesNotMatch(css, /@media \(max-width|min-width/, "no breakpoint: the rail is desktop only, as Station is");
  // The six themes all carry the tokens the rail spends.
  for (const theme of ["industrial-light", "industrial-dark", "gruvbox-light", "gruvbox-dark", "engineering-paper", "blueprint"]) {
    const sheet = read(`station/styles/themes/${theme}.css`);
    for (const token of ["--station-handbook-glass:", "--station-handbook-glass-border:", "--station-accent:", "--station-accent-soft:", "--station-warning:", "--station-text-muted:", "--station-text-disabled:", "--station-border-subtle:"]) {
      assert.ok(sheet.includes(token), `${theme} lacks ${token}`);
    }
  }
});

/* ----------------------------------------------------------------------
 *   The Next face: its switch, and the two moves under it
 * -------------------------------------------------------------------- */

test("the Next switch shows the face and whether a plan exists, hands every click back as one call, and reveals the two moves only while the face is on", () => {
  const { rail, next, promote, copy, calls, live } = build();
  live();
  assert.equal(next.disabled, true, "Next waits to be told there is a line");
  rail.update({ next: { active: false, available: true, planned: false } });
  assert.equal(next.disabled, false);
  assert.match(next.getAttribute("title"), /nothing is planned yet/);
  assert.ok(!next.classList.contains("is-planned"));
  assert.equal(rail.flyout.getAttribute("data-open"), "false");
  assert.equal(rail.element.getAttribute("data-face"), null);
  rail.update({ next: { active: false, available: true, planned: true } });
  assert.ok(next.classList.contains("is-planned"), "the dot: a plan exists");
  assert.match(next.getAttribute("title"), /a recipe is planned/);
  next.click();
  assert.deepEqual(calls, ["next"]);
  assert.equal(next.getAttribute("aria-pressed"), "false", "the rail does not turn the face on: the boot file tells it");
  rail.update({ next: { active: true, available: true, planned: true } });
  assert.equal(next.getAttribute("aria-pressed"), "true");
  assert.ok(next.classList.contains("is-active"));
  assert.ok(rail.element.classList.contains("is-next-active"));
  assert.equal(rail.element.getAttribute("data-face"), "next");
  assert.equal(rail.flyout.getAttribute("data-open"), "true", "the moves unfold beside the switch");
  assert.equal(rail.nextGroup.getAttribute("data-open"), "true");
  assert.ok(!rail.flyout.hasAttribute("inert") && rail.flyout.getAttribute("aria-hidden") === "false");
  assert.match(next.getAttribute("title"), /^Next Recipe · on/);
  next.click();
  assert.deepEqual(calls, ["next", "next"]);
  rail.update({ next: { active: false, available: true, planned: true } });
  assert.equal(rail.flyout.getAttribute("data-open"), "false", "and fold with it");
  assert.ok(rail.flyout.hasAttribute("inert"));
  // An active face can always be left, line or no line.
  rail.update({ next: { active: true, available: false, planned: false } });
  assert.equal(next.disabled, false);
});

test("Load Next arms then confirms as one call, worded by the summary it was told; it is held with no plan or no offer; Copy Current is one click, worded by what it replaces", () => {
  const { rail, promote, copy, calls, timers, live, doc } = build();
  live();
  rail.update({ next: { active: true, available: true, planned: false }, promote: { available: true, summary: "" }, copy: { available: true } });
  assert.equal(promote.disabled, true, "nothing planned: nothing to load");
  assert.equal(promote.getAttribute("title"), "Load Next into Current · nothing is planned");
  assert.equal(copy.disabled, false);
  assert.equal(copy.getAttribute("title"), "Copy Current into Next · the running recipe becomes the plan; the running job is untouched");
  rail.update({ next: { active: true, available: true, planned: true }, promote: { available: true, summary: "2 resin changes · 1 percentage change" } });
  assert.equal(promote.disabled, false);
  assert.equal(promote.getAttribute("title"), "Load Next into Current · 2 resin changes · 1 percentage change");
  assert.match(copy.getAttribute("title"), /replacing what is planned/);
  promote.click();
  assert.deepEqual(calls, [], "the first click arms, and calls nothing");
  assert.equal(rail.isArmed(), true);
  assert.equal(rail.armedControl(), "promote");
  assert.equal(rail.getState().armed, false, "the reset is not the one armed");
  assert.equal(promote.getAttribute("data-armed"), "true");
  assert.ok(promote.classList.contains("is-armed"));
  assert.equal(promote.getAttribute("aria-label"), "Confirm: load the planned recipe into Current · 2 resin changes · 1 percentage change");
  assert.match(promote.getAttribute("title"), /^Click again to load the plan into Current · 2 resin changes · 1 percentage change · receiver weights, tracking and pump state stay with their hoppers; the plan is kept$/);
  assert.equal(timers.length, 1);
  promote.click();
  assert.deepEqual(calls, ["promote"]);
  assert.equal(rail.isArmed(), false);
  assert.equal(promote.getAttribute("data-armed"), null);
  assert.ok(timers[0].cleared, "the confirming click cleared the arm timer");
  copy.click();
  assert.deepEqual(calls, ["promote", "copy"]);
  assert.equal(rail.isArmed(), false, "a copy never arms");
  // Held: no offer.
  rail.update({ promote: { available: false, reason: "the application does not offer Load Next into Current from Station." } });
  assert.equal(promote.disabled, true);
  assert.equal(promote.getAttribute("title"), "Load Next into Current is not available: the application does not offer Load Next into Current from Station.");
  promote.click();
  assert.deepEqual(calls, ["promote", "copy"], "a held control takes no click");
  rail.update({ copy: { available: false, reason: "no application is connected to Station commands." } });
  assert.equal(copy.disabled, true);
  copy.click();
  assert.deepEqual(calls, ["promote", "copy"]);
  assert.equal(typeof doc, "object");
});

test("an armed promotion disarms on its timeout, a click elsewhere, Escape, the focus leaving, the plan vanishing, and the face closing - each without a call; arming one control disarms the other", () => {
  const { rail, promote, reset, calls, timers, live, doc } = build();
  const on = () => rail.update({ next: { active: true, available: true, planned: true }, promote: { available: true, summary: "1 resin change" } });
  live(); on();
  promote.click();
  assert.equal(rail.armedControl(), "promote");
  timers[0].fn();
  assert.equal(rail.isArmed(), false, "the timeout disarmed it");
  promote.click();
  const elsewhere = doc.createElement("div");
  doc.body.appendChild(elsewhere);
  elsewhere.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(rail.isArmed(), false, "a click elsewhere disarmed it");
  promote.click();
  promote.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(rail.isArmed(), true, "a pointer down on the control itself does not");
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  promote.dispatchEvent(escape);
  assert.equal(rail.isArmed(), false, "Escape disarmed it");
  assert.equal(escape.stopped, true);
  promote.focus();
  promote.click();
  promote.blur();
  assert.equal(rail.isArmed(), false, "the focus leaving disarmed it");
  promote.click();
  rail.update({ next: { active: true, available: true, planned: false } });
  assert.equal(rail.isArmed(), false, "the plan vanishing disarmed it");
  on(); promote.click();
  rail.update({ next: { active: false, available: true, planned: true } });
  assert.equal(rail.isArmed(), false, "the face closing disarmed it");
  on(); promote.click();
  reset.click();
  assert.equal(rail.armedControl(), "reset", "arming the reset disarmed the promotion");
  assert.equal(promote.getAttribute("data-armed"), null);
  assert.equal(reset.getAttribute("data-armed"), "true");
  promote.click();
  assert.equal(rail.armedControl(), "promote", "and back");
  assert.equal(reset.getAttribute("data-armed"), null);
  assert.deepEqual(calls, [], "none of it called anything");
});

test("Smart Hoppers is the Weights switch's child: folded until the Weights face is on, unfolded beside it while it is, and folded again with it - its own state untouched by the fold", () => {
  const { rail, weights, smart, calls, live } = build();
  live();
  rail.update({ weights: { active: false, available: true }, smart: { on: true, available: true } });
  assert.equal(rail.weightsFlyout.getAttribute("data-open"), "false");
  assert.ok(rail.weightsFlyout.hasAttribute("inert") && rail.weightsFlyout.getAttribute("aria-hidden") === "true");
  assert.equal(smart.getAttribute("aria-checked"), "true", "the switch shows its state whether or not it is unfolded");
  rail.update({ weights: { active: true, available: true } });
  assert.equal(rail.weightsGroup.getAttribute("data-open"), "true");
  assert.equal(rail.weightsFlyout.getAttribute("data-open"), "true");
  assert.ok(!rail.weightsFlyout.hasAttribute("inert") && rail.weightsFlyout.getAttribute("aria-hidden") === "false");
  smart.click();
  assert.deepEqual(calls, ["smart"]);
  weights.click();
  assert.deepEqual(calls, ["smart", "weights"]);
  rail.update({ weights: { active: false, available: true } });
  assert.equal(rail.weightsFlyout.getAttribute("data-open"), "false");
  assert.equal(smart.getAttribute("aria-checked"), "true");
  // The Next group is its own: unaffected by the Weights face.
  assert.equal(rail.flyout.getAttribute("data-open"), "false");
});

/* ----------------------------------------------------------------------
 *   Bulk Edit: Blend Edit's child, and what it becomes
 * -------------------------------------------------------------------- */

function blendOn(rail, bulk) {
  rail.update({ hidden: false, blend: { active: true, available: true }, bulk: Object.assign({ active: false, available: true, count: 0, resin: "" }, bulk || {}) });
}

test("Bulk Edit unfolds beside Blend Edit only while that face is on, and asks the boot file on its click", () => {
  const { rail, calls, live } = build({ onBulkEdit: () => calls.push("bulk") });
  live();
  assert.equal(rail.blendGroup.getAttribute("data-open"), "false");
  assert.ok(rail.blendFlyout.hasAttribute("inert"));
  blendOn(rail);
  assert.equal(rail.blendGroup.getAttribute("data-open"), "true");
  assert.equal(rail.blendFlyout.hasAttribute("inert"), false);
  assert.equal(rail.bulkButton.disabled, false);
  assert.match(rail.bulkButton.getAttribute("title"), /select hoppers on the cards/);
  rail.bulkButton.click();
  assert.deepEqual(calls, ["bulk"]);
  // Not offered: held, with the reason.
  blendOn(rail, { available: false, reason: "the application does not offer bulk resin editing from Station." });
  assert.equal(rail.bulkButton.disabled, true);
  assert.match(rail.bulkButton.getAttribute("title"), /does not offer bulk resin editing/);
  rail.bulkButton.click();
  assert.deepEqual(calls, ["bulk"]);
  // The Weights face: Blend's flyout folds with its child.
  rail.update({ blend: { active: false, available: true }, weights: { active: true, available: true } });
  assert.equal(rail.blendGroup.getAttribute("data-open"), "false");
});

test("on, Bulk Edit swaps in place for Confirm and Cancel; Confirm waits for a selected hopper and a drafted resin, both told by the boot file", () => {
  const { rail, calls } = build({ onBulkConfirm: () => calls.push("confirm"), onBulkCancel: () => calls.push("cancel") });
  blendOn(rail, { active: true, count: 0 });
  assert.equal(rail.blendGroup.getAttribute("data-bulk"), "true");
  assert.ok(rail.element.classList.contains("is-bulk-active"));
  assert.ok(rail.bulkButton.hasAttribute("hidden") && rail.bulkButton.hasAttribute("inert"));
  assert.equal(rail.confirmButton.hasAttribute("hidden"), false);
  assert.equal(rail.cancelButton.hasAttribute("hidden"), false);
  assert.equal(rail.fieldSlot.hasAttribute("hidden"), false, "the field's slot shows with the selection");
  assert.equal(rail.confirmButton.disabled, true);
  assert.match(rail.confirmButton.getAttribute("title"), /select a hopper on a card first/);
  rail.confirmButton.click();
  assert.deepEqual(calls, []);

  blendOn(rail, { active: true, count: 2 });
  assert.equal(rail.confirmButton.disabled, true, "no resin drafted yet");
  assert.match(rail.confirmButton.getAttribute("title"), /enter the resin in the card's field for 2 hoppers/);
  blendOn(rail, { active: true, count: 2, resin: "  LLDPE 1001 " });
  assert.equal(rail.confirmButton.disabled, false);
  assert.equal(rail.confirmButton.getAttribute("title"), 'Apply "LLDPE 1001" to 2 hoppers');
  assert.equal(rail.confirmButton.getAttribute("aria-label"), "Apply resin to 2 hoppers");
  rail.confirmButton.click();
  assert.deepEqual(calls, ["confirm"]);
  // The boot file ends the selection: back to Bulk Edit.
  blendOn(rail, { active: false });
  assert.equal(rail.blendGroup.getAttribute("data-bulk"), "false");
  assert.equal(rail.bulkButton.hasAttribute("hidden"), false);
  assert.ok(rail.confirmButton.hasAttribute("hidden") && rail.fieldSlot.hasAttribute("hidden"));
  // A field handed in stands in the slot, above the row.
  const doc2 = fakeDocument();
  const field = doc2.createElement("label");
  field.setAttribute("data-role", "bulk-resin");
  const hosted = railModule.create(doc2, { bulkField: field });
  assert.ok(hosted.fieldSlot.children[0] === field);
  assert.ok(hosted.blendFlyout.contains(field), "in the Blend flyout, so it folds and unfolds with it");
  // Cancel.
  blendOn(rail, { active: true, count: 1 });
  rail.cancelButton.click();
  assert.deepEqual(calls, ["confirm", "cancel"]);
  const state = rail.getState();
  assert.deepEqual(state.bulk, { active: true, available: true, reason: "", count: 1, resin: "" });
  // Bulk on without the Blend face is drawn folded and at rest: the boot
  // file owns the mode, the rail shows what can be seen.
  rail.update({ blend: { active: false, available: true } });
  assert.equal(rail.blendGroup.getAttribute("data-bulk"), "false");
  assert.equal(rail.bulkButton.hasAttribute("hidden"), false);
});
