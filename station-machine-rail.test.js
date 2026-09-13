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

test("three in the column - Blend Edit with Bulk Edit in a flyout beside it, Next with its two children, Weights with Smart Hoppers - each an SVG glyph in Station's own classes with its name on hover and to a reader - no text label, and no Reset (the timeline's)", () => {
  const { rail, blend, weights, smart, next, promote, copy } = build();
  assert.equal(rail.element.getAttribute("data-role"), "machine-rail");
  assert.equal(rail.element.getAttribute("role"), "group");
  assert.deepEqual(rail.element.children.map(node => [node.tagName, node.getAttribute("data-action") || node.getAttribute("data-role")]),
    [["DIV", "blend-group"], ["DIV", "next-group"], ["DIV", "weights-group"]]);
  assert.equal(rail.element.querySelector("[data-action='reset-tracking']"), null, "Reset Tracking stands in the timeline's Now column, not on the rail");
  // Blend Edit's group: the switch, and beside it Bulk Edit with the
  // Confirm / Cancel / field it becomes (hidden until it does).
  assert.deepEqual(rail.blendGroup.children.map(node => node.getAttribute("data-action") || node.getAttribute("class")), ["blend-edit", "station-rail__flyout"]);
  assert.deepEqual(rail.blendFlyout.children.map(node => node.getAttribute("data-role")), ["bulk-row"], "the Blend flyout holds the bulk row");
  assert.deepEqual(rail.bulkRow.children.map(node => node.getAttribute("data-action") || node.getAttribute("data-role")), ["bulk-edit", "bulk-confirm", "bulk-cancel", "bulk-field-slot"]);
  assert.equal(rail.bulkRow.getAttribute("data-bulk"), "false");
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
  assert.deepEqual(rail.flyout.children.map(node => node.getAttribute("data-role")), ["moves-row"], "the Next flyout holds the two moves' row, and the bulk row only while the Next face is on");
  assert.deepEqual(rail.movesRow.children.map(node => node.getAttribute("data-action")), ["promote-next", "copy-current"]);
  assert.equal(rail.flyout.getAttribute("role"), "group");
  assert.equal(rail.flyout.getAttribute("aria-label"), "Next Recipe actions");
  const REST_TITLE = {
    "Blend Edit": "Blend Edit needs a line with layers on the stage",
    "Weights": "Weights needs a line with layers on the stage",
    "Next Recipe": "Next Recipe needs a line with layers on the stage",
    "Load Next into Current": "Load Next into Current is not available: no application is connected to Station commands.",
    "Copy Current into Next": "Copy Current into Next is not available: no application is connected to Station commands.",
    "Smart Hoppers": "Smart Hoppers is not available: no application is connected to Station commands.",
    "Bulk Edit": "Bulk Edit is not available: no application is connected to Station commands.",
    "Apply resin to selected hoppers": "Apply resin to selected hoppers · select a hopper on a card first",
    "Cancel bulk edit": "Cancel bulk edit · nothing is written; the selection is cleared"
  };
  for (const [button, label] of [[blend, "Blend Edit"], [weights, "Weights"], [next, "Next Recipe"], [promote, "Load Next into Current"], [copy, "Copy Current into Next"], [smart, "Smart Hoppers"], [rail.bulkButton, "Bulk Edit"], [rail.confirmButton, "Apply resin to selected hoppers"], [rail.cancelButton, "Cancel bulk edit"]]) {
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
  assert.equal(rail.flyout.getAttribute("data-open"), "false", "the two moves are folded until the Next face is on");
  assert.ok(rail.flyout.hasAttribute("inert") && rail.flyout.getAttribute("aria-hidden") === "true", "folded: out of the tab order and the reader's tree");
  // Hidden until told there is a line: a rail with nothing to stand beside.
  assert.ok(rail.element.hidden);
  assert.deepEqual(railModule.LABEL, { blend: "Blend Edit", weights: "Weights", smart: "Smart Hoppers", next: "Next Recipe", promote: "Load Next into Current", copy: "Copy Current into Next", bulk: "Bulk Edit", confirm: "Apply resin to selected hoppers", cancel: "Cancel bulk edit" });
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
  assert.equal(blend.getAttribute("title"), "Blend Edit");
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
  // The bulk field, focused, looks as it does at rest: no ring, no
  // shadow, no accent border.
  assert.match(css, /\.station-root \.station-bulk-field__input:focus-visible \{[^}]*outline: none;[^}]*--station-field-shadow: none;/);
  assert.doesNotMatch(css, /bulk-field__input:focus-visible \{[^}]*--station-field-border/);
  assert.doesNotMatch(css, /@media \(max-width|min-width/, "no breakpoint: the rail is desktop only, as Station is");
  // The six themes all carry the tokens the rail spends.
  for (const theme of ["industrial-light", "industrial-dark", "gruvbox-light", "gruvbox-dark", "engineering-paper", "blueprint"]) {
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

test("an armed promotion disarms on its timeout, a click elsewhere, Escape, the focus leaving, the plan vanishing, and the face closing - each without a call; the arming is the shared helper's", () => {
  const { rail, promote, calls, timers, live, doc } = build();
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

test("Bulk Edit is the Next face's child too: while that face is on the one bulk row stands in the Next flyout above the two moves, on the Next bracket, works exactly as under Blend Edit, and goes back to the Blend flyout when the face changes", () => {
  const { rail, calls } = build({ onBulkEdit: () => calls.push("bulk"), onBulkConfirm: () => calls.push("confirm") });
  rail.update({ hidden: false, blend: { active: false, available: true }, next: { active: true, available: true, planned: true }, bulk: { active: false, available: true } });
  // The row moved: the Next flyout is [bulk row, moves row]; the Blend flyout is empty.
  assert.deepEqual(rail.flyout.children.map(node => node.getAttribute("data-role")), ["bulk-row", "moves-row"]);
  assert.deepEqual(rail.blendFlyout.children, []);
  assert.ok(rail.flyout.contains(rail.bulkButton) && rail.flyout.contains(rail.fieldSlot));
  assert.equal(rail.flyout.getAttribute("data-open"), "true", "unfolded with the Next face");
  assert.equal(rail.blendFlyout.getAttribute("data-open"), "false");
  assert.equal(rail.bulkButton.disabled, false);
  assert.match(rail.bulkButton.getAttribute("title"), /onto all of them in the plan$/);
  rail.bulkButton.click();
  assert.deepEqual(calls, ["bulk"]);
  // On: the swap, on the row, under the Next group.
  rail.update({ bulk: { active: true, available: true, count: 2, resin: "HDPE 9" } });
  assert.equal(rail.bulkRow.getAttribute("data-bulk"), "true");
  assert.equal(rail.nextGroup.getAttribute("data-bulk"), "true");
  assert.equal(rail.blendGroup.getAttribute("data-bulk"), "false");
  assert.ok(rail.element.classList.contains("is-bulk-active"));
  assert.ok(rail.bulkButton.hasAttribute("hidden"));
  assert.equal(rail.confirmButton.hasAttribute("hidden"), false);
  assert.equal(rail.fieldSlot.hasAttribute("hidden"), false);
  assert.equal(rail.confirmButton.disabled, false);
  rail.confirmButton.click();
  assert.deepEqual(calls, ["bulk", "confirm"]);
  // The face changes: the row goes back to the Blend flyout, at rest.
  rail.update({ blend: { active: true, available: true }, next: { active: false, available: true, planned: true }, bulk: { active: false, available: true } });
  assert.deepEqual(rail.blendFlyout.children.map(node => node.getAttribute("data-role")), ["bulk-row"]);
  assert.deepEqual(rail.flyout.children.map(node => node.getAttribute("data-role")), ["moves-row"]);
  assert.equal(rail.nextGroup.getAttribute("data-bulk"), "false");
  assert.doesNotMatch(rail.bulkButton.getAttribute("title"), /in the plan/);
  // Neither face: the row rests in the Blend flyout, folded.
  rail.update({ blend: { active: false, available: true } });
  assert.deepEqual(rail.blendFlyout.children.map(node => node.getAttribute("data-role")), ["bulk-row"]);
  assert.equal(rail.blendFlyout.getAttribute("data-open"), "false");
  // The stylesheet: a flyout grows upward from the switch's row, so the
  // Next flyout's upper row stands where the Blend tile does; the stem
  // stays at the switch's row; the swap is keyed on the row, not a group.
  const css = read("station/styles/components/machine-rail.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.station-rail__flyout \{[^}]*bottom: 0;[^}]*flex-direction: column;[^}]*gap: var\(--station-space-2\);/);
  assert.match(css, /\.station-rail__flyout::before \{[^}]*bottom: calc\(var\(--station-handbook-launcher\) \/ 2\);/);
  assert.match(css, /\.station-rail__row--bulk\[data-bulk="true"\] \.station-rail__control--confirm/);
  assert.doesNotMatch(css, /station-rail__group--blend\[data-bulk/);
});
