"use strict";

/* The machine utility rail (station/station-machine-rail.js): the short
 * stack of icon controls beside the far-right hopper cluster - Blend
 * Edit's switch and Reset Tracking.
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
    onResetTracking: () => calls.push("reset"),
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
  }, options || {}));
  doc.body.appendChild(rail.element);
  const live = () => rail.update({ hidden: false, blend: { active: false, available: true }, reset: { available: true, count: 4 } });
  return { doc, rail, calls, timers, live, blend: rail.blendButton, reset: rail.resetButton };
}

/* ----------------------------------------------------------------------
 *   What it draws
 * -------------------------------------------------------------------- */

test("two controls and nothing else, each an SVG glyph in Station's own classes with its name on hover and to a reader - no text label", () => {
  const { rail, blend, reset } = build();
  assert.equal(rail.element.getAttribute("data-role"), "machine-rail");
  assert.equal(rail.element.getAttribute("role"), "group");
  assert.deepEqual(rail.element.children.map(node => [node.tagName, node.getAttribute("data-action")]), [["BUTTON", "blend-edit"], ["BUTTON", "reset-tracking"]]);
  for (const [button, label] of [[blend, "Blend Edit"], [reset, "Reset Tracking"]]) {
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.getAttribute("aria-label"), label);
    assert.equal(button.getAttribute("title"), label.startsWith("Reset") ? "Reset Tracking is not available: no application is connected to Station commands." : "Blend Edit needs a line with layers on the stage");
    assert.equal(button.textContent, "", "no text on the control");
    assert.ok(button.classList.contains("station-rail__control"));
    const svg = button.children[0];
    assert.equal(svg.tagName, "SVG");
    assert.equal(svg.getAttribute("viewBox"), "0 0 20 20");
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.ok(svg.children.length >= 3, "a drawn glyph, not a single mark");
    walk(svg, node => {
      assert.match(node.getAttribute("class") || "", /^station-rail__glyph/, `a glyph part outside the namespace: ${node.tagName}`);
      assert.ok(!["TEXT", "IMAGE", "USE"].includes(node.tagName), "a glyph from text, an image or a symbol");
    });
  }
  assert.equal(blend.getAttribute("aria-pressed"), "false", "the switch says which way it is");
  assert.equal(reset.getAttribute("aria-pressed"), null, "the reset is a command, not a switch");
  // Hidden until told there is a line: a rail with nothing to stand beside.
  assert.ok(rail.element.hidden);
  assert.deepEqual(railModule.LABEL, { blend: "Blend Edit", reset: "Reset Tracking" });
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
  assert.deepEqual(at, { left: Math.round(right + railModule.GAP), top: Math.round(top), height: Math.round(394 * scale) });
  assert.ok(at.height > 78, "the strip is the box's height, taller than its two controls");
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
