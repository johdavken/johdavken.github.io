"use strict";

/* The machine utility rail (station/station-machine-rail.js): the short
 * stack of icon controls beside the far-right hopper cluster - Blend
 * Edit's and Weights' switches, Smart Hoppers and Reset Tracking.
 *
 * Tested on its own here: what it draws, where it stands over the
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
    get parentNode() { return this.parent; },
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
    onNextEdit: () => calls.push("next"),
    onPromote: () => calls.push("promote"),
    onCopy: () => calls.push("copy"),
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
  }, options || {}));
  doc.body.appendChild(rail.element);
  const live = () => rail.update({ hidden: false, blend: { active: false, available: true } });
  return { doc, rail, calls, timers, live, blend: rail.blendButton, weights: rail.weightsButton, smart: rail.smartButton, next: rail.nextButton, promote: rail.promoteButton, copy: rail.copyButton };
}

/* ----------------------------------------------------------------------
 *   What it draws
 * -------------------------------------------------------------------- */

test("five in the column - Current Recipe with Load Next in a flyout beside it, Next Recipe with Copy Current, Weights with Smart Hoppers, Tools, Print - each an SVG glyph in Station's own classes with its name on hover and to a reader - no text label, no Reset (the timeline's) and no Bulk Edit (the header's hopper editor)", () => {
  const { rail, blend, weights, smart, next, promote, copy } = build();
  assert.equal(rail.element.getAttribute("data-role"), "machine-rail");
  assert.equal(rail.element.getAttribute("role"), "group");
  assert.deepEqual(rail.element.children.map(node => [node.tagName, node.getAttribute("data-action") || node.getAttribute("data-role")]),
    [["DIV", "blend-group"], ["DIV", "next-group"], ["DIV", "weights-group"], ["DIV", "tools-group"], ["DIV", "print-group"]]);
  assert.equal(rail.element.querySelector("[data-action='reset-tracking']"), null, "Reset Tracking stands in the timeline's Now column, not on the rail");
  // Current Recipe's group: the switch, and beside it one row - Load
  // Next: the move that writes to this face stands beside this face's
  // switch. No Bulk Edit, no Confirm, no Cancel, no field: a selection
  // of hoppers is made on the cards' badges and written from the
  // header's hopper editor (station-hopper-edit.js).
  assert.deepEqual(rail.blendGroup.children.map(node => node.getAttribute("data-action") || node.getAttribute("class")), ["blend-edit", "station-rail__flyout"]);
  assert.deepEqual(rail.blendFlyout.children.map(node => node.getAttribute("data-role")), ["blend-row"], "the Current flyout holds its row");
  assert.deepEqual(rail.blendRow.children.map(node => node.getAttribute("data-action") || node.getAttribute("data-role")), ["promote-next"], "Load Next alone on the row");
  assert.equal(rail.blendFlyout.getAttribute("aria-label"), "Current Recipe actions");
  assert.equal(rail.blendFlyout.getAttribute("data-open"), "false");
  assert.equal(rail.element.querySelectorAll("input").length, 0, "the rail builds no field");
  for (const action of ["bulk-edit", "bulk-confirm", "bulk-cancel"]) assert.equal(rail.element.querySelector(`[data-action='${action}']`), null, `${action} is on the rail`);
  assert.equal(rail.element.querySelector("[data-role='bulk-set'], [data-role='bulk-field-slot']"), null);
  for (const gone of ["bulkButton", "confirmButton", "cancelButton", "bulkSet", "fieldSlot", "bulkGlyph"]) assert.equal(gone in rail || gone in railModule, false, `${gone} survives`);
  assert.deepEqual(rail.weightsGroup.children.map(node => node.getAttribute("data-action") || node.getAttribute("class")), ["weights-edit", "station-rail__flyout"]);
  assert.deepEqual(rail.weightsFlyout.children.map(node => node.getAttribute("data-action")), ["smart-hoppers"]);
  assert.equal(rail.weightsFlyout.getAttribute("aria-label"), "Weights actions");
  assert.equal(rail.weightsFlyout.getAttribute("data-open"), "false");
  assert.ok(rail.weightsFlyout.hasAttribute("inert"));
  // The Next group: the switch in the column, the flyout beside it holding
  // its one row - Copy Current.
  assert.deepEqual(rail.nextGroup.children.map(node => [node.tagName, node.getAttribute("data-action") || node.getAttribute("class")]), [["BUTTON", "next-edit"], ["DIV", "station-rail__flyout"]]);
  assert.deepEqual(rail.flyout.children.map(node => node.getAttribute("data-role")), ["next-row"], "the Next flyout holds its row");
  assert.deepEqual(rail.nextRow.children.map(node => node.getAttribute("data-action")), ["copy-current"], "Copy Current alone on the row");
  assert.equal(rail.nextRow.hasAttribute("data-bulk"), false);
  assert.equal(rail.flyout.getAttribute("role"), "group");
  assert.equal(rail.flyout.getAttribute("aria-label"), "Next Recipe actions");
  const REST_TITLE = {
    "Current Recipe": "Current Recipe needs a line with layers on the stage",
    "Weights": "Weights needs a line with layers on the stage",
    "Next Recipe": "Next Recipe needs a line with layers on the stage",
    "Load Next into Current": "Load Next into Current is not available: no application is connected to Station commands.",
    "Copy Current into Next": "Copy Current into Next is not available: no application is connected to Station commands.",
    "Smart Hoppers": "Smart Hoppers is not available: no application is connected to Station commands."
  };
  for (const [button, label] of [[blend, "Current Recipe"], [weights, "Weights"], [next, "Next Recipe"], [promote, "Load Next into Current"], [copy, "Copy Current into Next"], [smart, "Smart Hoppers"]]) {
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.getAttribute("aria-label"), label);
    assert.equal(button.getAttribute("title"), REST_TITLE[label]);
    assert.equal(button.textContent, "", "no text on the control");
    assert.ok(button.classList.contains("station-rail__control"));
    const svg = button.children[0];
    assert.equal(svg.tagName, "SVG");
    // The launcher's tile: the same 64-unit space, the same plate inset
    // the same, drawn under the glyph as station-handbook.js draws it
    // under the book (its own test pins the launcher's).
    assert.equal(svg.getAttribute("viewBox"), "0 0 64 64");
    assert.equal(svg.getAttribute("width"), "64");
    assert.equal(svg.getAttribute("height"), "64");
    assert.equal(svg.getAttribute("aria-hidden"), "true");
    assert.deepEqual(svg.children.map(node => [node.tagName, node.getAttribute("class")]), [["RECT", "station-rail__glyph-plate"], ["G", "station-rail__glyph-art"]]);
    const plate = svg.children[0];
    assert.deepEqual(["x", "y", "width", "height", "rx"].map(name => plate.getAttribute(name)), ["1.5", "1.5", "61", "61", "14"]);
    assert.equal(svg.children[1].getAttribute("transform"), "translate(12 12) scale(2)", "the 20-unit glyph doubled and centred on the plate");
    assert.ok(svg.children[1].children.length >= 1, "a drawn glyph");
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
  assert.equal(next.getAttribute("aria-pressed"), "false", "Next is the third face's switch");
  assert.equal(rail.flyout.getAttribute("data-open"), "false", "Copy Current is folded until the Next face is on");
  assert.equal(rail.blendFlyout.getAttribute("data-open"), "false", "Load Next until the Current face is");
  assert.ok(rail.flyout.hasAttribute("inert") && rail.flyout.getAttribute("aria-hidden") === "true", "folded: out of the tab order and the reader's tree");
  // Hidden until told there is a line: a rail with nothing to stand beside.
  assert.ok(rail.element.hidden);
  assert.deepEqual(railModule.LABEL, { blend: "Current Recipe", weights: "Weights", smart: "Smart Hoppers", next: "Next Recipe", promote: "Load Next into Current", copy: "Copy Current into Next", tools: "Tools", winding: "Winding Tension", totals: "Resin Totals", pressure: "Pressure", print: "Print Recipe", printCurrent: "Print Current Recipe", printNext: "Print Next Recipe", printBoth: "Print both recipes" });
});

test("the recipe faces' vocabulary: the hopper is Current, the folded sheet is Next; each switch draws its own object, each move the other face's object stood right with one arrow pointing left at the switch; the two moves share every arrow coordinate and the objects are faces on the plate", () => {
  const { rail, blend, next, promote, copy } = build();
  const art = button => button.children[0].children[1].children.map(node => [node.tagName, node.getAttribute("class").replace("station-rail__glyph-", ""), node.getAttribute("d") || `${node.getAttribute("cx")},${node.getAttribute("cy")},${node.getAttribute("r")}`]);
  const HOPPER = "M 4.75 3 L 15.25 3 L 12.25 12.5 L 11.25 16.5 L 8.75 16.5 L 7.75 12.5 Z";
  const SHEET = "M 4.75 2.5 L 11.75 2.5 L 15.25 6 L 15.25 17.5 L 4.75 17.5 Z";
  const SHAFT = "M 10.5 10 L 2 10";
  const HEAD = "M 4.8 7.2 L 2 10 L 4.8 12.8";
  assert.deepEqual(art(blend), [["PATH", "face", HOPPER]], "Current Recipe: the hopper, centred, a face");
  assert.deepEqual(art(next), [["PATH", "face", SHEET], ["PATH", "stroke", "M 11.75 2.5 L 11.75 6 L 15.25 6"], ["CIRCLE", "dot", "15.95,3.8,2.2"]], "Next Recipe: the sheet, centred, the planned dot on its corner");
  assert.deepEqual(art(promote), [
    ["PATH", "face", "M 7 13 L 7 17.5 L 17.5 17.5 L 17.5 6 L 14 2.5 L 7 2.5 L 7 7"],
    ["PATH", "stroke", "M 14 2.5 L 14 6 L 17.5 6"],
    ["PATH", "stroke", SHAFT], ["PATH", "stroke", HEAD]
  ], "Load Next: the sheet stood right and opened, the arrow leaving it leftward");
  assert.deepEqual(art(copy), [
    ["PATH", "face", "M 10.6 13 L 11.5 16.5 L 14 16.5 L 15 12.5 L 18 3 L 7.5 3 L 8.8 7"],
    ["PATH", "stroke", SHAFT], ["PATH", "stroke", HEAD]
  ], "Copy Current: the hopper stood right and opened, the same arrow");
  // The move's object is the switch's, the same size, stood right: its
  // closed corners are the switch's shifted by one constant.
  const xs = d => d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0);
  const ys = d => d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
  const sheetOpen = art(promote)[0][2], hopperOpen = art(copy)[0][2];
  assert.deepEqual([Math.min(...xs(sheetOpen)) - Math.min(...xs(SHEET)), Math.max(...xs(sheetOpen)) - Math.max(...xs(SHEET))], [2.25, 2.25]);
  assert.deepEqual([Math.min(...ys(sheetOpen)), Math.max(...ys(sheetOpen))], [Math.min(...ys(SHEET)), Math.max(...ys(SHEET))]);
  assert.deepEqual([Math.min(...xs(hopperOpen)) - Math.min(...xs(HOPPER)), Math.max(...xs(hopperOpen)) - Math.max(...xs(HOPPER))], [2.75, 2.75]);
  assert.deepEqual([Math.min(...ys(hopperOpen)), Math.max(...ys(hopperOpen))], [Math.min(...ys(HOPPER)), Math.max(...ys(HOPPER))]);
  // The arrow's head is at the left edge of the shaft, pointing at the switch.
  assert.equal(Math.min(...xs(SHAFT)), Math.min(...xs(HEAD)));
  // No hopper outline (the Smart Hoppers style) on a recipe face: the
  // stylesheet fills a face and strokes it at the switch weight.
  const css = read("station/styles/components/machine-rail.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.station-rail__glyph-face \{\s*fill: var\(--station-surface\);\s*stroke: currentColor;\s*stroke-width: 0\.75;/);
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

test("update() is what it shows: the switch's state and availability, hidden and withdrawn", () => {
  const { rail, blend, live } = build();
  live();
  assert.ok(!rail.element.hidden);
  assert.equal(blend.disabled, false);
  assert.equal(blend.getAttribute("title"), "Current Recipe");
  rail.update({ blend: { active: true, available: true } });
  assert.equal(blend.getAttribute("aria-pressed"), "true");
  assert.ok(blend.classList.contains("is-active"));
  assert.ok(rail.element.classList.contains("is-blend-active"));
  assert.match(blend.getAttribute("title"), /^Current Recipe · on/);
  rail.update({ blend: { active: false, available: false } });
  assert.equal(blend.disabled, true);
  assert.match(blend.getAttribute("title"), /needs a line with layers/);
  // On with no line to enter it with: the switch still lets the mode out.
  rail.update({ blend: { active: true, available: false } });
  assert.equal(blend.disabled, false, "an active mode can always be left");
  rail.update({ withdrawn: true });
  assert.ok(rail.element.classList.contains("is-withdrawn"));
  rail.update({ withdrawn: false, hidden: true });
  assert.ok(!rail.element.classList.contains("is-withdrawn"));
  assert.ok(rail.element.hidden);
  assert.ok(!("reset" in rail.getState()), "the rail holds nothing of the reset");
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
 *   Where it lives
 * -------------------------------------------------------------------- */

test("the module is presentation only: no dispatch, no bridge, no job read, no reach for the globals; loaded by both hosts after the hopper controls and before the boot file", () => {
  const source = read("station/station-machine-rail.js").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pattern of [/\.dispatch\s*\(/, /PolynStation(?:Command|State|Connection|Recipes)Bridge/, /hopperState|resinName|\.layers\b/, /localStorage/, /\.connect\s*\(/, /\.publish\s*\(/, /\bwindow\./]) {
    assert.doesNotMatch(source, pattern, `the rail reaches outside itself (${pattern})`);
  }
  const host = read("station-host.js");
  const html = read("station/station.html");
  const order = (text, quote) => ["station-hopper-controls.js", "station-armed.js", "station-machine-rail.js", "station.js"].map(name => text.indexOf(quote(name)));
  for (const [text, quote] of [[host, name => `"station/${name}"`], [html, name => `src="${name}?v=`]]) {
    const at = order(text, quote);
    assert.ok(at.every(index => index > -1), "a host does not load the rail");
    assert.ok(at[0] < at[2] && at[1] < at[2] && at[2] < at[3], "the rail must be evaluated after the hopper controls and the armed helper, and before station.js");
  }
  assert.match(host, /"station\/styles\/components\/machine-rail\.css"/);
  assert.match(html, /styles\/components\/machine-rail\.css\?v=/);
  assert.doesNotMatch(read("index.html"), /machine-rail/, "index.html loads Station modules through the host only");
});

test("the stylesheet names no colour of its own, cuts every tile to the Handbook launcher's size and plate, and stands the column over the launcher", () => {
  const raw = read("station/styles/components/machine-rail.css");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, "machine-rail.css names a colour");
  // The Handbook is the master of the tile: the launcher's size is one
  // token (tokens.css), which handbook.css spends on the launcher and
  // this sheet on every control - never a second 64px.
  const tokens = read("station/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(tokens, /--station-handbook-launcher: 64px;/);
  assert.match(read("station/styles/components/handbook.css"), /\.station-root \.station-handbook__launcher \{[^}]*width: var\(--station-handbook-launcher\);[^}]*height: var\(--station-handbook-launcher\);/);
  assert.match(css, /\.station-root \.station-rail__control \{[^}]*width: var\(--station-handbook-launcher\);[^}]*height: var\(--station-handbook-launcher\);[^}]*border-radius: var\(--station-radius-lg\);/);
  assert.doesNotMatch(css, /64px/, "a second 64px beside the token");
  // The plate is the launcher's icon-plate over again, in the same
  // tokens, coloured through the two properties the control sets; no
  // glass, no border on the button itself.
  assert.match(css, /\.station-rail__glyph-plate \{[^}]*fill: var\(--station-rail-plate\);[^}]*stroke: var\(--station-rail-plate-edge\);[^}]*stroke-width: 1\.5;/);
  assert.match(css, /\.station-root \.station-rail__control \{[^}]*--station-rail-plate: var\(--station-surface-raised\);[^}]*--station-rail-plate-edge: var\(--station-border-strong\);/);
  assert.match(css, /\.station-root \.station-rail__control:hover:not\(:disabled\) \{[^}]*--station-rail-plate-edge: var\(--station-accent\);/, "under the pointer, the accent on the plate's edge, as the launcher's");
  assert.match(read("station/styles/components/handbook.css"), /\.station-handbook__icon-plate \{[^}]*fill: var\(--station-surface-raised\);[^}]*stroke: var\(--station-border-strong\);[^}]*stroke-width: 1\.5;/, "the launcher's plate, which the tile copies");
  assert.doesNotMatch(css, /handbook-glass|backdrop-filter|border: var\(--station-stroke\) solid var\(--station-handbook/, "the tile is the launcher's plate, not the console's glass");
  // The glyph is doubled onto the plate, so its strokes are halved back
  // to the launcher icon's weight.
  assert.match(css, /\.station-rail__glyph-stroke \{[^}]*stroke-width: 0\.75;/);
  assert.match(css, /\.station-root \.station-rail__control\.is-active \{[^}]*--station-rail-plate-edge: var\(--station-accent\);/);
  assert.match(css, /\.station-root \.station-rail__control\.is-armed \{[^}]*--station-rail-plate-edge: var\(--station-warning\);/);
  // Smart Hoppers on wears the computed colour the captions wear (hopper.css).
  assert.match(css, /\.station-root \.station-rail__control\.is-on \{[^}]*--station-rail-plate-edge: var\(--station-smart, var\(--station-accent\)\);/);
  assert.match(css, /\.station-rail\.is-withdrawn \{[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;/, "a withdrawn rail leaves the tab order, not only the eye");
  assert.match(css, /\.station-rail\[hidden\] \{[^}]*display: none;/);
  // The slot is the shell's; the rail is absolute in it, in the launcher's
  // corner, its foot one launcher and one gap up from the launcher's own
  // - the gap between the tiles. Nothing is measured and nothing placed.
  assert.match(css, /\.station-rail \{[^}]*position: absolute;[^}]*left: var\(--station-space-4\);[^}]*bottom: calc\(var\(--station-space-4\) \+ var\(--station-handbook-launcher\) \+ var\(--station-space-2\)\);[^}]*flex-direction: column;[^}]*gap: var\(--station-space-2\);/);
  assert.match(read("station/styles/components/handbook.css"), /\.station-root \.station-handbook__launcher \{[^}]*left: var\(--station-space-4\);[^}]*bottom: var\(--station-space-4\);/);
  assert.doesNotMatch(css, /is-placed|data-room/);
  assert.doesNotMatch(css, /station-rail__control--reset/, "no reset tile: the reset is the timeline's");
  // No bulk set, no field slot: the sheet knows nothing of a selection
  // beyond the root's flag the moves are held under.
  assert.doesNotMatch(css, /bulk|field-slot/);
  assert.doesNotMatch(css, /@media \(max-width|min-width/, "no breakpoint: the rail is desktop only, as Station is");
  // Every registered theme carries the tokens the rail spends.
  for (const theme of require("./station-theme.js").THEME_IDS) {
    const sheet = read(`station/styles/themes/${theme}.css`);
    for (const token of ["--station-surface-raised:", "--station-border-strong:", "--station-accent:", "--station-accent-soft:", "--station-warning:", "--station-text-muted:", "--station-text-disabled:", "--station-border-subtle:"]) {
      assert.ok(sheet.includes(token), `${theme} lacks ${token}`);
    }
  }
});

test("the module measures nothing: no placement, no stage read, no client rects", () => {
  const source = read("station/station-machine-rail.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(source, /getBoundingClientRect|ResizeObserver|viewBox"\)|data-object-card|anchor\(|readStage|\.place\b/);
  assert.equal(railModule.TILE, 64);
  assert.ok(!("place" in build().rail));
});

/* ----------------------------------------------------------------------
 *   The Next face: its switch, and Copy Current under it; Load Next under Current
 * -------------------------------------------------------------------- */

test("the Next switch shows the face and whether a plan exists, hands every click back as one call, and reveals Copy Current only while the face is on", () => {
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
  assert.equal(rail.flyout.getAttribute("data-open"), "true", "Copy Current unfolds beside the switch");
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

test("Load Next arms then confirms as one call, worded by the summary it was told; it is held with no plan, no offer, or a hopper selection open; Copy Current arms and confirms the same way, worded by what it replaces, and is held by a selection too", () => {
  const { rail, promote, copy, calls, timers, live, doc } = build();
  live();
  // Load Next stands under the Current face; Copy Current under Next. The
  // rail draws both from what it is told, whichever face is on.
  rail.update({ blend: { active: true, available: true }, next: { active: false, available: true, planned: false }, promote: { available: true, summary: "" }, copy: { available: true } });
  assert.equal(promote.disabled, true, "nothing planned: nothing to load");
  assert.equal(promote.getAttribute("title"), "Load Next into Current · nothing is planned");
  assert.equal(copy.disabled, false);
  assert.equal(copy.getAttribute("title"), "Copy Current into Next · the running recipe becomes the plan; the running job is untouched");
  rail.update({ next: { active: false, available: true, planned: true }, promote: { available: true, summary: "2 resin changes · 1 percentage change" } });
  assert.equal(promote.disabled, false);
  assert.equal(promote.getAttribute("title"), "Load Next into Current · 2 resin changes · 1 percentage change");
  assert.match(copy.getAttribute("title"), /replacing what is planned/);
  // A hopper selection open on the cards holds both moves: the edit is
  // applied or cancelled first, never dropped by a promotion or a copy.
  rail.update({ selection: { active: true } });
  assert.ok(rail.element.classList.contains("is-selection-open"));
  assert.equal(promote.disabled, true);
  assert.equal(promote.getAttribute("title"), "Load Next into Current · apply or cancel the hopper edit first");
  assert.equal(copy.disabled, true);
  assert.equal(copy.getAttribute("title"), "Copy Current into Next · apply or cancel the hopper edit first");
  promote.click();
  assert.equal(rail.isArmed(), false, "held: no arming");
  assert.deepEqual(rail.getState().selection, { active: true });
  rail.update({ selection: { active: false } });
  assert.equal(rail.element.classList.contains("is-selection-open"), false);
  assert.equal(promote.disabled, false);
  assert.equal(copy.disabled, false);
  promote.click();
  assert.deepEqual(calls, [], "the first click arms, and calls nothing");
  assert.equal(rail.isArmed(), true);
  assert.equal(rail.armedControl(), "promote");
  assert.equal(rail.getState().armedControl, "promote");
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
  // Copy Current: the same two clicks, under the Next face.
  rail.update({ blend: { active: false, available: true }, next: { active: true, available: true, planned: true } });
  copy.click();
  assert.deepEqual(calls, ["promote"], "the first click arms, and calls nothing");
  assert.equal(rail.armedControl(), "copy");
  assert.equal(copy.getAttribute("data-armed"), "true");
  assert.ok(copy.classList.contains("is-armed"));
  assert.equal(copy.getAttribute("aria-label"), "Confirm: copy the running recipe into Next, replacing what is planned");
  assert.equal(copy.getAttribute("title"), "Click again to copy the running recipe into Next · what is planned is replaced · the running job is untouched");
  assert.equal(timers.length, 2, "one arm timer for it");
  copy.click();
  assert.deepEqual(calls, ["promote", "copy"]);
  assert.equal(rail.isArmed(), false);
  assert.equal(copy.getAttribute("data-armed"), null);
  assert.equal(copy.getAttribute("aria-label"), "Copy Current into Next");
  assert.ok(timers[1].cleared, "the confirming click cleared the arm timer");
  // With nothing planned the armed words say nothing is replaced.
  rail.update({ next: { active: true, available: true, planned: false } });
  copy.click();
  assert.equal(copy.getAttribute("aria-label"), "Confirm: copy the running recipe into Next");
  assert.equal(copy.getAttribute("title"), "Click again to copy the running recipe into Next · the running job is untouched");
  rail.disarm();
  // One control is armed at a time: arming one disarms the other.
  rail.update({ blend: { active: true, available: true }, next: { active: true, available: true, planned: true } });
  promote.click();
  assert.equal(rail.armedControl(), "promote");
  copy.click();
  assert.equal(rail.armedControl(), "copy", "the last clicked is the armed one");
  assert.equal(promote.getAttribute("data-armed"), null);
  rail.disarm();
  rail.update({ blend: { active: true, available: true }, next: { active: false, available: true, planned: true } });
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
  assert.equal(rail.isArmed(), false, "a held control takes no click and never arms");
  assert.equal(typeof doc, "object");
});

test("an armed copy disarms on its timeout, a click elsewhere, Escape, the focus leaving, the offer vanishing, the Next face closing, a hopper selection opening and the rail stepping back - each without a call", () => {
  const { rail, copy, calls, timers, live, doc } = build();
  const on = () => rail.update({ blend: { active: false, available: true }, next: { active: true, available: true, planned: true }, copy: { available: true }, selection: { active: false } });
  live(); on();
  copy.click();
  assert.equal(rail.armedControl(), "copy");
  timers[0].fn();
  assert.equal(rail.isArmed(), false, "the timeout disarmed it");
  copy.click();
  const elsewhere = doc.createElement("div");
  doc.body.appendChild(elsewhere);
  elsewhere.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(rail.isArmed(), false, "a click elsewhere disarmed it");
  copy.click();
  copy.dispatchEvent(makeEvent("pointerdown", { bubbles: true }));
  assert.equal(rail.isArmed(), true, "a pointer down on the control itself does not");
  const escape = makeEvent("keydown", { key: "Escape", bubbles: true });
  copy.dispatchEvent(escape);
  assert.equal(rail.isArmed(), false, "Escape disarmed it");
  copy.focus();
  copy.click();
  copy.blur();
  assert.equal(rail.isArmed(), false, "the focus leaving disarmed it");
  copy.click();
  rail.update({ copy: { available: false, reason: "gone" } });
  assert.equal(rail.isArmed(), false, "the offer vanishing disarmed it");
  on(); copy.click();
  rail.update({ next: { active: false, available: true, planned: true } });
  assert.equal(rail.isArmed(), false, "the Next face closing disarmed it");
  on(); copy.click();
  rail.update({ selection: { active: true } });
  assert.equal(rail.isArmed(), false, "a hopper selection opening disarmed it");
  on(); copy.click();
  rail.update({ withdrawn: true });
  assert.equal(rail.isArmed(), false, "the rail stepping back disarmed it");
  rail.update({ withdrawn: false }); on(); copy.click();
  rail.update({ next: { active: true, available: true, planned: false } });
  assert.equal(rail.isArmed(), true, "the plan vanishing does not: a copy needs no plan");
  rail.disarm();
  assert.deepEqual(calls, [], "none of it called anything");
});

test("an armed promotion disarms on its timeout, a click elsewhere, Escape, the focus leaving, the plan vanishing, the face closing, and a hopper selection opening - each without a call; the arming is the shared helper's", () => {
  const { rail, promote, calls, timers, live, doc } = build();
  const on = () => rail.update({ blend: { active: true, available: true }, next: { active: false, available: true, planned: true }, promote: { available: true, summary: "1 resin change" }, selection: { active: false } });
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
  rail.update({ next: { active: false, available: true, planned: false } });
  assert.equal(rail.isArmed(), false, "the plan vanishing disarmed it");
  on(); promote.click();
  rail.update({ blend: { active: false, available: true } });
  assert.equal(rail.isArmed(), false, "the Current face closing disarmed it");
  on(); promote.click();
  rail.update({ selection: { active: true } });
  assert.equal(rail.isArmed(), false, "a hopper selection opening disarmed it");
  on(); promote.click();
  rail.update({ withdrawn: true });
  assert.equal(rail.isArmed(), false, "the rail stepping back disarmed it");
  assert.deepEqual(calls, [], "none of it called anything");
  // The arming is station-armed.js's, the same the timeline's Reset uses:
  // one wait, one set of ways out.
  const armed = require("./station/station-armed.js");
  assert.equal(railModule.ARM_DURATION, armed.ARM_DURATION);
  assert.equal(timers[0].ms, armed.ARM_DURATION);
  const source = read("station/station-machine-rail.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(source, /require\("\.\/station-armed\.js"\)/);
  assert.doesNotMatch(source, /addEventListener\("pointerdown"|timers\.set|state\.armed/, "the rail keeps no arming of its own");
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
 *   No Bulk Edit: the selection is the cards' and the header's
 * -------------------------------------------------------------------- */

test("the rail offers no Bulk Edit and takes no field: a selection is told as one flag, shown on the root, and holds the two moves; the stylesheet keeps the flyout's shape without a bulk set", () => {
  const { rail, calls, live } = build();
  live();
  rail.update({ hidden: false, blend: { active: true, available: true }, selection: { active: true } });
  assert.equal(rail.blendGroup.getAttribute("data-open"), "true");
  assert.ok(rail.blendFlyout.hasAttribute("inert") === false);
  assert.deepEqual(rail.blendRow.children.map(node => node.getAttribute("data-action")), ["promote-next"]);
  assert.equal(rail.element.querySelector("input, datalist, label"), null);
  assert.ok(rail.element.classList.contains("is-selection-open"));
  assert.deepEqual(calls, []);
  const source = read("station/station-machine-rail.js");
  assert.doesNotMatch(source, /onBulk|bulkField|bulkSet|fieldSlot|drawBulk|placeBulkSet|Bulk Edit"/, "the module still speaks of Bulk Edit");
  // The stylesheet: a flyout grows upward from the switch's row; the stem
  // stays at the switch's row; the move arrives a beat after the row
  // unfolds; nothing of a bulk set or a field slot survives.
  const css = read("station/styles/components/machine-rail.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.station-rail__flyout \{[^}]*bottom: 0;[^}]*flex-direction: column;[^}]*gap: var\(--station-space-2\);/);
  assert.match(css, /\.station-rail__flyout::before \{[^}]*bottom: calc\(var\(--station-handbook-launcher\) \/ 2\);/);
  assert.match(css, /\.station-rail__row \{[^}]*display: flex;[^}]*gap: var\(--station-space-2\);/);
  assert.match(css, /\.station-rail__flyout \.station-rail__control--promote,\s*\.station-rail__flyout \.station-rail__control--copy \{\s*transition-delay: var\(--station-motion-lead\);/);
  assert.doesNotMatch(css, /station-rail__bulk|station-rail__field-slot|station-bulk-field|data-bulk|station-rail-arrive/);
  assert.match(css, /\.station-rail__glyph-stroke--bold \{\s*stroke-width: 1;\s*\}/, "the bold stroke the Tools and Pressure glyphs draw with");
});
