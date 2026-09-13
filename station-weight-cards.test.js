"use strict";

/* The weight cards (station/station-weight-cards.js): the hopper
 * cluster's third face - receiver weights and, with Smart Hoppers on,
 * the geometry each is computed from - and the seam the rail's Smart
 * Hoppers switch goes through.
 *
 * Tested on its own here over a small fake DOM: what a card draws for
 * each line and switch state, the field rules (the Handbook's Weights
 * page's, verbatim), what each commit hands to the bridge, what a
 * refusal leaves standing, and what update() may and may not touch.
 * What the boot file does with a card - the mode, the rail, the publish
 * - is the booted suite's (station-blend-edit-exit.test.js).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cards = require("./station/station-weight-cards.js");

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

function makeNode(doc, name) {
  const node = {
    nodeName: name, tagName: name.toUpperCase(), nodeType: 1,
    attributes: {}, children: [], parent: null, listeners: {}, value: "", ownerDocument: doc,
    get readOnly() { return this._readOnly === true; },
    set readOnly(v) { this._readOnly = !!v; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text !== undefined && !this.children.length ? this._text : this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this.children = []; this._text = String(v); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { if (child.parent) child.parent.removeChild(child); this.children.push(child); child.parent = this; this._text = undefined; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && n.nodeType === 1 && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatchEvent(event) {
      event.target = event.target || this;
      let n = this;
      while (n && !event.stopped) {
        for (const fn of (n.listeners[event.type] || []).slice()) fn(event);
        if (!event.bubbles) break;
        n = n.parent;
      }
      return true;
    },
    focus() { const old = focused; focused = this; if (old && old !== this) old.dispatchEvent(makeEvent("blur")); this.dispatchEvent(makeEvent("focus")); },
    blur() { if (focused !== this) return; focused = null; this.dispatchEvent(makeEvent("blur")); },
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
  doc.body = doc.appendChild(makeNode(doc, "body"));
  Object.defineProperty(doc, "activeElement", { get: () => focused });
  return doc;
}

/* ----------------------------------------------------------------------
 *   Fixtures
 * -------------------------------------------------------------------- */

const LAYER = Object.freeze({ id: "A", role: "outside", hoppers: [0, 1, 2].map(index => ({ id: `A${index + 1}`, index })) });

function hopperStateFor(overrides) {
  const base = {
    "A:0": { resinName: "A0301", weight: 1250, effectiveWeight: 1250, usableHeight: 30, usableGallons: 0, smartWeight: null },
    "A:1": { resinName: "", weight: 0, effectiveWeight: 0, usableHeight: 0, usableGallons: 0, smartWeight: null },
    "A:2": { resinName: "LD01", weight: 600, effectiveWeight: 600, usableHeight: 0, usableGallons: 0, smartWeight: null }
  };
  return Object.assign(base, overrides || {});
}

/* A command bridge that records, applies to a state, and answers as the
 * contract does; `refuse` makes the application refuse one command. */
function fakeCommands(options) {
  const settings = options || {};
  const calls = [];
  const offered = settings.capabilities || ["setHopperWeight", "setHopperGeometry", "setHopperCircumference", "setSmartHoppers"];
  return {
    calls,
    isAvailable: () => settings.available !== false,
    capabilities: () => offered.slice(),
    dispatch(command, args) {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
      if (settings.refuse && settings.refuse(command, args)) return { ok: false, code: "out_of_range", message: settings.refuse(command, args) };
      if (settings.unchanged) return { ok: true, changed: false, revision: 7 };
      return { ok: true, changed: true, revision: 8, snapshot: {} };
    }
  };
}

function build(options) {
  focused = null;
  const settings = options || {};
  const doc = fakeDocument();
  const commands = settings.commands === null ? null : (settings.commands || fakeCommands(settings.bridge));
  const editing = [];
  const committed = [];
  const card = cards.create(doc, {
    layer: LAYER,
    hopperState: settings.hopperState || hopperStateFor(),
    smartHoppers: settings.smartHoppers || { enabled: false, geometryMode: "cylindrical", circumference: 0 },
    commands,
    recipe: settings.recipe || "current",
    onEditing: record => editing.push(record),
    onCommitted: result => committed.push(result)
  });
  doc.body.appendChild(card.element);
  const items = () => card.element.querySelectorAll(".station-weight-card__item");
  const weightField = key => card.element.querySelectorAll(".station-weight-card__field").find(i => i.getAttribute("data-key") === key);
  const geometryField = key => card.element.querySelectorAll(".station-weight-card__geometry-field").find(i => i.getAttribute("data-key") === key);
  const computed = key => card.element.querySelectorAll(".station-weight-card__computed").find(i => i.getAttribute("data-key") === key);
  const circumference = () => card.element.querySelector(".station-weight-card__circumference-field");
  const note = () => card.element.querySelector(".station-weight-card__note");
  const type = (input, value) => { input.focus(); input.value = String(value); input.dispatchEvent(makeEvent("input", { bubbles: true })); return input; };
  const enter = input => input.dispatchEvent(makeEvent("keydown", { key: "Enter", bubbles: true }));
  const escape = input => { const event = makeEvent("keydown", { key: "Escape", bubbles: true }); input.dispatchEvent(event); return event; };
  return { doc, card, commands, editing, committed, items, weightField, geometryField, computed, circumference, note, type, enter, escape };
}

const CYL_ON = { enabled: true, geometryMode: "cylindrical", circumference: 40 };
const VOL_ON = { enabled: true, geometryMode: "volume", circumference: 0 };

/* ----------------------------------------------------------------------
 *   What it draws
 * -------------------------------------------------------------------- */

test("with the switch off: one row per hopper - badge, resin, a weight field in pounds - no geometry, no circumference, no computed readout", () => {
  const s = build();
  assert.equal(s.card.element.getAttribute("data-role"), "weights-card");
  assert.equal(s.card.element.getAttribute("data-layer"), "A");
  assert.equal(s.card.element.getAttribute("data-mode"), "editing");
  assert.equal(s.card.element.getAttribute("data-shape"), "off");
  assert.deepEqual(s.items().map(i => [i.getAttribute("data-hopper"), i.getAttribute("data-layer"), i.getAttribute("data-hopper-index")]),
    [["A1", "A", "0"], ["A2", "A", "1"], ["A3", "A", "2"]]);
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__resin").map(n => n.textContent), ["A0301", "—", "LD01"]);
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__field").map(i => [i.value, i.getAttribute("aria-label")]),
    [["1250", "A1 receiver weight, pounds"], ["", "A2 receiver weight, pounds"], ["600", "A3 receiver weight, pounds"]]);
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__unit").map(n => n.textContent), ["lb", "lb", "lb"]);
  assert.equal(s.card.element.querySelectorAll(".station-weight-card__geometry-field").length, 0);
  assert.equal(s.card.element.querySelectorAll(".station-weight-card__computed").length, 0);
  assert.equal(s.circumference(), null);
  assert.equal(s.card.element.querySelector(".station-weight-card__foot").children.length, 0);
});

test("on a cylindrical line with the switch on: a usable-height field in inches per hopper, the computed weight or why there is none, and the shared circumference on the foot", () => {
  const s = build({
    smartHoppers: CYL_ON,
    hopperState: hopperStateFor({ "A:0": { resinName: "A0301", weight: 1250, effectiveWeight: 132, usableHeight: 30, usableGallons: 0, smartWeight: { value: 132.4, bulkDensity: 44.9, resinCode: "A0301" } } })
  });
  assert.equal(s.card.element.getAttribute("data-shape"), "smart:cylindrical");
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__geometry-field").map(i => [i.value, i.getAttribute("aria-label")]),
    [["30", "A1 usable height, inches"], ["", "A2 usable height, inches"], ["", "A3 usable height, inches"]]);
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__geometry").map(w => w.children[1].textContent), ["in", "in", "in"]);
  assert.equal(s.computed("A:0").textContent, "✓ 132 lb");
  assert.equal(s.computed("A:0").getAttribute("data-kind"), "computed");
  assert.match(s.computed("A:0").getAttribute("title"), /Computed from A1's usable height and A0301's bulk density \(44\.9 lb\/ft³\)/);
  assert.ok(s.items()[0].classList.contains("is-smart"));
  assert.equal(s.computed("A:1").textContent, "no resin");
  assert.equal(s.computed("A:1").getAttribute("data-kind"), "hint");
  assert.equal(s.computed("A:2").textContent, "no height", "a resin with no measure says which measure");
  assert.ok(!s.items()[2].classList.contains("is-smart"));
  assert.equal(s.circumference().value, "40");
  assert.equal(s.circumference().getAttribute("aria-label"), "Hopper circumference, inches, shared by every hopper on the line");
  assert.equal(s.card.element.querySelector(".station-weight-card__shared").textContent, "shared by every hopper");
});

test("on a volume line with the switch on: a usable-volume field in gallons, no circumference, and 'no bulk density' where the resin has none", () => {
  const s = build({
    smartHoppers: VOL_ON,
    hopperState: hopperStateFor({ "A:2": { resinName: "LD01", weight: 600, effectiveWeight: 600, usableHeight: 0, usableGallons: 55, smartWeight: null } })
  });
  assert.equal(s.card.element.getAttribute("data-shape"), "smart:volume");
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__geometry-field").map(i => [i.value, i.getAttribute("aria-label")]),
    [["", "A1 usable volume, gallons"], ["", "A2 usable volume, gallons"], ["55", "A3 usable volume, gallons"]]);
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__geometry").map(w => w.children[1].textContent), ["gal", "gal", "gal"]);
  assert.equal(s.circumference(), null, "a volume line has no circumference");
  assert.equal(s.computed("A:0").textContent, "no volume");
  assert.equal(s.computed("A:2").textContent, "no bulk density");
});

test("with the switch on but no identified line (geometry mode null) the card is the plain one: the switch's state alone adds nothing", () => {
  const s = build({ smartHoppers: { enabled: true, geometryMode: null, circumference: 40 } });
  assert.equal(s.card.element.getAttribute("data-shape"), "off");
  assert.equal(s.card.element.querySelectorAll(".station-weight-card__geometry-field").length, 0);
  assert.equal(s.circumference(), null);
});

test("with no bridge, or one without the commands, the fields are read-only and the card says why; the Next recipe is never asked", () => {
  const none = build({ commands: null, smartHoppers: CYL_ON });
  assert.equal(none.card.element.getAttribute("data-mode"), "read-only");
  assert.match(none.card.element.getAttribute("title"), /^Read-only: no application is connected/);
  for (const input of none.card.element.querySelectorAll("input")) {
    assert.equal(input.readOnly, true);
    assert.equal(input.getAttribute("aria-disabled"), "true");
    assert.ok(input.hasAttribute("readonly"));
  }
  none.type(none.weightField("A:0"), "900");
  none.enter(none.weightField("A:0"));
  assert.deepEqual(none.editing, [], "a read-only field opens no draft");

  const partial = build({ bridge: { capabilities: ["setHopperWeight"] }, smartHoppers: CYL_ON });
  assert.equal(partial.card.element.getAttribute("data-mode"), "editing");
  assert.equal(partial.weightField("A:0").readOnly, false);
  assert.equal(partial.geometryField("A:0").readOnly, true, "geometry is read-only without its command");
  assert.equal(partial.circumference().readOnly, true);
  assert.deepEqual(partial.card.able, { weight: true, geometry: false, circumference: false, smart: false });

  const next = build({ recipe: "next" });
  assert.equal(next.card.element.getAttribute("data-mode"), "read-only");
  assert.match(next.card.element.getAttribute("title"), /belong to the physical hoppers, not to a recipe/);
});

/* ----------------------------------------------------------------------
 *   Writing
 * -------------------------------------------------------------------- */

test("a weight entered and committed with Enter is one setHopperWeight addressed to Current, the layer and the hopper; the boot file is told; focus stays", () => {
  const s = build();
  const input = s.type(s.weightField("A:1"), "950");
  assert.equal(s.editing.length, 2, "focus and typing each report the draft");
  assert.deepEqual(s.editing[1], { layer: "A", index: 1, hopper: "A2", slot: "weight", mode: "typing", draft: "950", baseValue: "" });
  s.enter(input);
  assert.deepEqual(s.commands.calls, [{ command: "setHopperWeight", args: { recipe: "current", layer: "A", index: 1, weight: "950" } }]);
  assert.equal(s.committed.length, 1);
  assert.ok(s.doc.activeElement === input, "Enter keeps the focus in the field");
  assert.equal(input.getAttribute("aria-invalid"), null);
});

test("leaving the field commits once; the same value again, or the text unchanged, sends nothing; blank is 0", () => {
  const s = build();
  const input = s.type(s.weightField("A:0"), "1300");
  input.blur();
  assert.equal(s.commands.calls.length, 1);
  assert.equal(s.editing[s.editing.length - 1], null, "leaving the field clears the record");
  // Unchanged text: nothing to send.
  s.type(s.weightField("A:2"), "600").blur();
  assert.equal(s.commands.calls.length, 1);
  // Blank clears.
  const cleared = s.type(s.weightField("A:2"), "");
  s.enter(cleared);
  assert.deepEqual(s.commands.calls[1].args, { recipe: "current", layer: "A", index: 2, weight: 0 });
  // Enter then blur: the blur finds the field at rest and sends nothing more.
  cleared.blur();
  assert.equal(s.commands.calls.length, 2);
});

test("a height on a cylindrical line is one setHopperGeometry naming the height; a volume on a volume line names the volume; the circumference is one setHopperCircumference with no recipe", () => {
  const cyl = build({ smartHoppers: CYL_ON });
  cyl.enter(cyl.type(cyl.geometryField("A:1"), "28"));
  assert.deepEqual(cyl.commands.calls, [{ command: "setHopperGeometry", args: { recipe: "current", layer: "A", index: 1, dimension: "height", value: "28" } }]);
  cyl.enter(cyl.type(cyl.circumference(), "42"));
  assert.deepEqual(cyl.commands.calls[1], { command: "setHopperCircumference", args: { circumference: "42" } });
  assert.deepEqual(cyl.editing.filter(Boolean).map(r => r.slot), ["geometry", "geometry", "circumference", "circumference"]);
  assert.equal(cyl.editing.filter(r => r && r.slot === "circumference")[0].hopper, null, "the circumference is the line's, not a hopper's");

  const vol = build({ smartHoppers: VOL_ON });
  vol.enter(vol.type(vol.geometryField("A:2"), "60"));
  assert.deepEqual(vol.commands.calls, [{ command: "setHopperGeometry", args: { recipe: "current", layer: "A", index: 2, dimension: "volume", value: "60" } }]);
});

test("a refusal keeps the draft, marks the field invalid and says why on the card's note; typing clears the mark; the next Enter tries again", () => {
  const s = build({ bridge: { refuse: (command, args) => (command === "setHopperWeight" && Number(args.weight) > 5000 ? "That is more than the receiver holds." : null) } });
  const input = s.type(s.weightField("A:0"), "9000");
  s.enter(input);
  assert.equal(input.value, "9000", "the draft stands");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(s.note().textContent, "That is more than the receiver holds.");
  assert.equal(s.note().getAttribute("data-kind"), "error");
  assert.equal(s.committed.length, 0, "a refusal is not a commit");
  s.type(input, "4000");
  assert.equal(input.getAttribute("aria-invalid"), null);
  s.enter(input);
  assert.equal(s.commands.calls.length, 2);
  assert.equal(s.note().textContent, "", "an accepted commit clears the note");
});

test("Escape drops the draft, restores the canonical value and is spent in the field; a second Escape with no draft leaves the field", () => {
  const s = build();
  const input = s.type(s.weightField("A:0"), "77");
  const first = s.escape(input);
  assert.equal(first.stopped, true, "the stage's Escape never sees a field's");
  assert.equal(first.defaultPrevented, true);
  assert.equal(input.value, "1250");
  assert.ok(s.doc.activeElement === input, "the field keeps the focus while it had a draft to drop");
  assert.deepEqual(s.commands.calls, [], "nothing was sent");
  const second = s.escape(input);
  assert.equal(second.stopped, true);
  assert.ok(s.doc.activeElement !== input, "with no draft, Escape leaves the field");
  assert.deepEqual(s.commands.calls, [], "leaving after Escape sends nothing: the field was at rest");
});

test("an answer of unchanged puts the field back to the canonical value without telling the boot file", () => {
  const s = build({ bridge: { unchanged: true } });
  const input = s.type(s.weightField("A:0"), "1250.0");
  s.enter(input);
  assert.equal(s.commands.calls.length, 1);
  assert.equal(s.committed.length, 0);
  assert.equal(input.value, "1250");
});

/* ----------------------------------------------------------------------
 *   update(): the source moved
 * -------------------------------------------------------------------- */

test("update() patches every resting field, resin and readout in place, and never writes the field being typed in - which is marked, and the note says so, when its own value moved", () => {
  const s = build({ smartHoppers: CYL_ON });
  const busy = s.type(s.weightField("A:0"), "1300");
  s.card.update({ hopperState: hopperStateFor({
    "A:0": { resinName: "A0450", weight: 1400, effectiveWeight: 700, usableHeight: 30, usableGallons: 0, smartWeight: { value: 700, bulkDensity: 39, resinCode: "A0450" } },
    "A:2": { resinName: "LD01", weight: 650, effectiveWeight: 650, usableHeight: 20, usableGallons: 0, smartWeight: null }
  }), smartHoppers: { enabled: true, geometryMode: "cylindrical", circumference: 44 } });
  assert.equal(busy.value, "1300", "the draft is untouched");
  assert.ok(busy.classList.contains("is-changed-underneath"));
  assert.equal(s.note().textContent, "A1's weight is now 1,400 lb in the application; what you are entering has not been applied.");
  assert.equal(s.note().getAttribute("data-kind"), "warning");
  assert.equal(s.weightField("A:2").value, "650", "a resting field follows the source");
  assert.equal(s.geometryField("A:2").value, "20");
  assert.equal(s.computed("A:2").textContent, "no bulk density");
  assert.equal(s.computed("A:0").textContent, "✓ 700 lb");
  assert.equal(s.card.element.querySelectorAll(".station-weight-card__resin")[0].textContent, "A0450");
  assert.equal(s.circumference().value, "44");
  assert.ok(s.card.element.querySelector(".station-weight-card__list") === s.card.element.children[0], "no rebuild: the same list");
  // The same value again underneath does not say it twice; the operator's
  // own commit then starts the draft afresh from the applied value.
  const items = s.items();
  s.card.update({ hopperState: hopperStateFor({ "A:0": { resinName: "A0450", weight: 1400, effectiveWeight: 700, usableHeight: 30, usableGallons: 0, smartWeight: null } }) });
  assert.ok(s.items()[0] === items[0], "rows are patched, not rebuilt");
  s.enter(busy);
  assert.deepEqual(s.commands.calls[0].args, { recipe: "current", layer: "A", index: 0, weight: "1300" });
  assert.ok(!busy.classList.contains("is-changed-underneath"));
});

test("a change of shape - the switch, or the line's measure - rebuilds the rows: the geometry fields and the circumference come and go", () => {
  const s = build();
  const before = s.items();
  s.card.update({ smartHoppers: CYL_ON });
  assert.equal(s.card.element.getAttribute("data-shape"), "smart:cylindrical");
  assert.equal(s.card.element.querySelectorAll(".station-weight-card__geometry-field").length, 3);
  assert.ok(s.circumference());
  assert.ok(s.items()[0] !== before[0], "rebuilt");
  s.card.update({ smartHoppers: VOL_ON });
  assert.equal(s.card.element.getAttribute("data-shape"), "smart:volume");
  assert.equal(s.circumference(), null);
  assert.deepEqual(s.card.element.querySelectorAll(".station-weight-card__geometry").map(w => w.children[1].textContent), ["gal", "gal", "gal"]);
  s.card.update({ smartHoppers: { enabled: false, geometryMode: "volume", circumference: 0 } });
  assert.equal(s.card.element.getAttribute("data-shape"), "off");
  assert.equal(s.card.element.querySelectorAll(".station-weight-card__geometry-field").length, 0);
  assert.equal(s.card.element.querySelectorAll(".station-weight-card__field").length, 3, "the weight fields are there in every shape");
});

/* ----------------------------------------------------------------------
 *   The rail's switch, through this seam
 * -------------------------------------------------------------------- */

test("toggleSmart is one setSmartHoppers stating the opposite of what the source holds; held with the reason off an identified line or without the command or a bridge", () => {
  const commands = fakeCommands();
  const off = cards.smartFrom({ smartHoppers: { enabled: false, geometryMode: "cylindrical", circumference: 40 } });
  assert.deepEqual(cards.toggleSmart(commands, off), { ok: true, changed: true, revision: 8, snapshot: {} });
  assert.deepEqual(commands.calls, [{ command: "setSmartHoppers", args: { enabled: true } }]);
  const on = cards.smartFrom({ smartHoppers: { enabled: true, geometryMode: "volume", circumference: 0 } });
  cards.toggleSmart(commands, on);
  assert.deepEqual(commands.calls[1], { command: "setSmartHoppers", args: { enabled: false } });
  assert.equal(cards.canToggleSmart(commands, on), true);
  assert.equal(cards.smartReason(commands, on), "");

  const unlinked = cards.smartFrom({ smartHoppers: { enabled: false, geometryMode: null, circumference: 0 } });
  const held = cards.toggleSmart(commands, unlinked);
  assert.equal(held.ok, false);
  assert.equal(held.code, "unavailable");
  assert.equal(held.message, cards.SMART_UNAVAILABLE_TEXT);
  assert.equal(commands.calls.length, 2, "nothing was dispatched");
  assert.equal(cards.canToggleSmart(commands, unlinked), false);
  assert.equal(cards.smartReason(commands, unlinked), cards.SMART_UNAVAILABLE_TEXT);

  const without = fakeCommands({ capabilities: ["setHopperWeight"] });
  assert.equal(cards.canToggleSmart(without, on), false);
  assert.equal(cards.smartReason(without, on), "the application does not offer the Smart Hoppers switch from Station.");
  assert.equal(cards.toggleSmart(null, on).code, "unavailable");
  assert.equal(cards.canToggleSmart(null, on), false);
  assert.equal(cards.smartReason(null, on), "no application is connected to Station commands.");
  // At rest when the source carries nothing (a demo line, an older producer).
  assert.deepEqual(cards.smartFrom(null), { enabled: false, geometryMode: null, circumference: 0 });
  assert.deepEqual(cards.smartFrom({ smartHoppers: { enabled: true, geometryMode: "square", circumference: -3 } }), { enabled: true, geometryMode: null, circumference: 0 });
});

/* ----------------------------------------------------------------------
 *   The module's place
 * -------------------------------------------------------------------- */

test("the module computes no weight, keeps no application state, reaches for no global, and is loaded by both hosts before the rail and the boot file; its stylesheet spends the smart token the captions spend", () => {
  const source = read("station/station-weight-cards.js").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pattern of [/bulk_density|bulkDensityOf|smartHopperComputation|\/\s*1728|Math\.PI/, /PolynStation(?:Command|State|Connection|Recipes)Bridge/, /localStorage/, /\.connect\s*\(/, /\.publish\s*\(/, /\bwindow\./, /\bdocument\./]) {
    assert.doesNotMatch(source, pattern, `the weight cards reach outside themselves (${pattern})`);
  }
  assert.equal((source.match(/\.dispatch\s*\(/g) || []).length, 2, "one dispatch for the fields, one for the switch - both on the bridge handed in");
  const host = read("station-host.js");
  const html = read("station/station.html");
  const order = (text, quote) => ["station-weight-cards.js", "station-machine-rail.js", "station.js"].map(name => text.indexOf(quote(name)));
  for (const [text, quote] of [[host, name => `"station/${name}"`], [html, name => `src="${name}?v=`]]) {
    const at = order(text, quote);
    assert.ok(at.every(index => index > -1), "a host does not load the weight cards");
    assert.ok(at[0] < at[1] && at[1] < at[2], "the weight cards must be evaluated before the rail and the boot file");
  }
  assert.match(host, /"station\/styles\/components\/weight-cards\.css"/);
  assert.match(html, /styles\/components\/weight-cards\.css\?v=/);
  assert.doesNotMatch(read("index.html"), /weight-cards/, "index.html loads Station modules through the host only");
  const css = read("station/styles/components/weight-cards.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, "weight-cards.css names a colour");
  assert.match(css, /\.station-weight-card__computed\[data-kind="computed"\] \{[^}]*color: var\(--station-smart, var\(--station-accent\)\);/);
  assert.match(css, /\.station-weight-card__field\.is-changed-underneath[^{]*\{[^}]*var\(--station-warning\)/);
  assert.match(css, /\[aria-invalid="true"\][^{]*\{[^}]*var\(--station-danger\)/);
});
