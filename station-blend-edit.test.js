"use strict";

/* Blend Edit: the mode under which a layer's hopper cluster turns over to
 * a compact editor of its blend, in its own footprint.
 *
 * Three layers of it, tested at three levels:
 *
 *   the renderer   (station-render.js, station-machine-parts.js) draws the
 *                  card where a cluster was turned over - at the cluster's
 *                  own box, with the layout untouched - and nothing else
 *                  for the mode: the mode is switched from the machine
 *                  rail and a layer is turned back by its own train, and
 *                  the header above, share slot included, is the same in
 *                  the mode as out of it;
 *   the card       (station-focus-editor.js, variant "compact") is the
 *                  focused editor with its header, source line and drag
 *                  left out, committing through the same commands;
 *   the boot file  (station.js) owns the mode as presentation state and is
 *                  pinned at source, as the publish policy is.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const render = require("./station/station-render.js");
const parts = require("./station/station-machine-parts.js");
const lineModel = require("./station/station-line-model.js");
const editor = require("./station/station-focus-editor.js");
const stationSource = require("./station/station-source.js");
const contract = require("./station-command-contract.js");
const commandBridge = require("./station-command-bridge.js");

const ROOT = __dirname;
const boot = fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8");

function body(name) {
  const at = boot.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is not defined`);
  return boot.slice(at, boot.indexOf("\n  }\n", at) + 4);
}

/* ----------------------------------------------------------------------
 *   A fake DOM, for the renderer and the editor alike
 * -------------------------------------------------------------------- */

let focused = null;

function makeNode(name, ns) {
  const node = {
    nodeName: name,
    tagName: name.toUpperCase(),
    namespaceURI: ns || null,
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    textContent: "",
    value: "",
    get firstChild() { return this.children[0] || null; },
    get parentNode() { return this.parent; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    replaceChild(fresh, old) { const at = this.children.indexOf(old); if (at < 0) throw new Error("not a child"); this.children[at] = fresh; fresh.parent = this; old.parent = null; return old; },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (matches(n, selector)) return n; n = n.parent; } return null; },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
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
    focus() { focused = this; },
    select() {},
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attributes.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attributes.class = [...set].join(" "); },
      contains(name) { return classSet(node).has(name); },
      toggle(name, force) { const on = force === undefined ? !classSet(node).has(name) : !!force; (on ? this.add : this.remove)(name); return on; }
    }
  };
  return node;
}
function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matchesOne(node, selector) {
  const parts_ = selector.match(/(\.[a-z0-9_-]+|\[[a-z-]+(?:='[^']*')?\]|[a-z]+)/gi) || [];
  return parts_.every(part => {
    if (part.startsWith(".")) return classSet(node).has(part.slice(1));
    const attr = part.match(/^\[([a-z-]+)(?:='([^']*)')?\]$/);
    if (attr) return attr[2] === undefined ? node.hasAttribute(attr[1]) : node.getAttribute(attr[1]) === attr[2];
    return node.nodeName.toLowerCase() === part.toLowerCase();
  });
}
function matches(node, selector) { return selector.split(",").some(one => matchesOne(node, one.trim())); }
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function fakeDocument() {
  const doc = makeNode("#document");
  doc.createElement = name => makeNode(name);
  doc.createElementNS = (ns, name) => makeNode(name, ns);
  Object.defineProperty(doc, "activeElement", { get: () => focused });
  doc.removeEventListener = (type, fn) => { const list = doc.listeners[type] || []; const at = list.indexOf(fn); if (at >= 0) list.splice(at, 1); };
  return doc;
}
const allWith = (node, attribute, value) => { const out = []; walk(node, n => { if (n.getAttribute(attribute) === value) out.push(n); }); return out; };
const layerGroup = (svg, id) => allWith(svg, "data-role", "layer").find(g => g.getAttribute("data-layer") === id);

/* ----------------------------------------------------------------------
 *   A three-layer line with a running recipe
 * -------------------------------------------------------------------- */

function snapshot() {
  return {
    line: { lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layerPct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
        weight: 0, usableHeight: 30, effectiveWeight: 0, track: false, pumpOff: false
      }))
    })),
    revision: 1
  };
}

function resolved(snap) {
  return stationSource.resolveSource({ snapshot: snap || snapshot(), mode: "auto" });
}

function model() {
  const r = resolved();
  return { model: lineModel.buildLineModel(r.modelInput), resolved: r };
}

function connectedBridge(capabilities) {
  const bridge = commandBridge.create();
  const calls = [];
  bridge.connect({
    execute(command, args) { calls.push({ command, args }); return contract.success({ changed: true, revision: 2, snapshot: Object.freeze({}) }); },
    capabilities: capabilities || [...contract.COMMANDS]
  });
  return { bridge, calls };
}

function stage(options) {
  const doc = fakeDocument();
  const { model: m, resolved: r } = model();
  const svg = render.renderStage(m, Object.assign({ document: doc, hopperState: r.hopperState, layerState: r.layerState }, options || {}));
  return { doc, svg, model: m, resolved: r };
}

/* ----------------------------------------------------------------------
 *   The renderer: chips, cards, and a layout that does not move
 * -------------------------------------------------------------------- */

test("outside Blend Edit nothing is drawn for it: no card, no class - the stage is the stage it was", () => {
  const { svg } = stage();
  assert.equal(allWith(svg, "data-role", "flip").length, 0);
  assert.equal(allWith(svg, "data-role", "blend-card").length, 0);
  for (const id of ["A", "B", "C"]) {
    const layer = layerGroup(svg, id);
    assert.ok(!layer.classList.contains("is-flippable") && !layer.classList.contains("is-flipped"));
  }
  assert.equal(svg.getAttribute("role"), "img");
});

test("with the mode on, no chip is drawn on the stage: turning a layer over is the Handbook's, and every normal bank can be", () => {
  const { svg } = stage({ blendEdit: true });
  assert.equal(allWith(svg, "data-role", "flip").length, 0, "a flip chip is drawn");
  assert.equal(allWith(svg, "data-station-target", "flip").length, 0);
  assert.equal(allWith(svg, "data-role", "blend-card").length, 0, "no card until a layer is turned over");
  for (const id of ["A", "B", "C"]) assert.ok(layerGroup(svg, id).classList.contains("is-flippable"));
});

test("the layer's share stays in its header slot in Blend Edit, unchanged in value and place, so the mode swaps nothing there", () => {
  const plain = stage();
  const doc = fakeDocument();
  const { model: m, resolved: r } = model();
  const cards = { B: doc.createElement("div") };
  const on = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: cards, layerShare: { share: true } });
  const off = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, layerShare: { share: true } });
  const shareOf = (svg, id) => allWith(svg, "data-role", "layer-share").find(n => n.getAttribute("data-layer") === id);
  for (const id of ["A", "B", "C"]) {
    for (const [name, svg] of [["on", on], ["off", off]]) {
      const share = shareOf(svg, id);
      assert.ok(share, `${id} has no share with the mode ${name}`);
      assert.equal(share.getAttribute("data-station-target"), "share");
      assert.equal(share.getAttribute("data-able"), "true", "the share is not editable in the mode");
      assert.equal(share.querySelector(".station-layer__share-value").textContent, `${id === "B" ? 40 : 30}%`);
      const face = share.querySelector(".station-layer__share-face");
      const resting = shareOf(plain.svg, id).querySelector(".station-layer__share-face");
      for (const attr of ["x", "y", "width", "height"]) assert.equal(face.getAttribute(attr), resting.getAttribute(attr), `${id}'s slot moved with the mode ${name}`);
    }
  }
  // The turned-over layer's card starts under the slot, never over it.
  const card = allWith(on, "data-role", "blend-card")[0].querySelector("foreignObject");
  const slot = shareOf(on, "B").querySelector(".station-layer__share-face");
  assert.ok(Number(card.getAttribute("y")) > Number(slot.getAttribute("y")) + Number(slot.getAttribute("height")), "the card covers the share");
});

test("a layer turned over shows its card over its cluster; the others are untouched, and the cluster stays drawn under the glass, pointer off", () => {
  const doc = fakeDocument();
  const card = doc.createElement("div");
  card.setAttribute("data-role", "blend-editor");
  const { svg, model: m, resolved: r } = (() => {
    const { model: m_, resolved: r_ } = model();
    return { svg: render.renderStage(m_, { document: doc, hopperState: r_.hopperState, layerState: r_.layerState, blendEdit: true, blendCards: { B: card } }), model: m_, resolved: r_ };
  })();
  const b = layerGroup(svg, "B");
  assert.ok(b.classList.contains("is-flipped"));
  assert.ok(!layerGroup(svg, "A").classList.contains("is-flipped"));
  assert.ok(!layerGroup(svg, "C").classList.contains("is-flipped"));
  // The card: a frame and a foreignObject at the cluster's box, holding
  // the editor it was handed - the same node.
  const cards = allWith(svg, "data-role", "blend-card");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute("data-layer"), "B");
  assert.ok(b.contains(cards[0]), "the card is inside its layer's group");
  const host = cards[0].querySelector("foreignObject");
  assert.ok(host);
  assert.equal(host.children[0], card);
  const frame = cards[0].querySelector(".station-blend-card__frame");
  for (const attr of ["x", "y", "width", "height"]) assert.equal(host.getAttribute(attr), frame.getAttribute(attr), "the frame and the editor's box differ");
  // Its box is the cluster's footprint, read off the same layout the
  // cluster was drawn from: inside the bank's declared cluster object.
  const clusterBox = b.getAttribute("data-object-cluster").split(" ").map(Number);
  const x = Number(host.getAttribute("x")), y = Number(host.getAttribute("y")), w = Number(host.getAttribute("width")), h = Number(host.getAttribute("height"));
  assert.ok(y > clusterBox[1] && y + h <= clusterBox[1] + clusterBox[3] + 0.01, "the card runs outside the cluster's box vertically");
  assert.ok(w >= clusterBox[2], "the card is narrower than the cluster");
  assert.ok(x <= clusterBox[0] && x + w >= clusterBox[0] + clusterBox[2], "the card does not cover the cluster");
  // The hoppers are still there under it - drawn, seen through the
  // card's glass, and a value patch finds them; only the pointer leaves
  // them (the stylesheet).
  const cluster = allWith(b, "data-role", "hopper-cluster")[0];
  assert.ok(cluster, "the cluster was removed");
  assert.equal(allWith(cluster, "data-role", "hopper").length, 6);
  assert.equal(allWith(b, "data-role", "flip").length, 0, "a flip chip is drawn on the turned-over layer");
  // A card makes the drawing a group with controls in it.
  assert.equal(svg.getAttribute("role"), "group");
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/hopper.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.station-layer\.is-flipped \.station-hopper-cluster \{\s*pointer-events: none;\s*\}/);
  void m; void r;
});

test("turning a layer over moves nothing: the viewBox and every bank's declared boxes are identical with and without cards", () => {
  const plain = stage();
  const doc = fakeDocument();
  const cards = { A: doc.createElement("div"), B: doc.createElement("div"), C: doc.createElement("div") };
  const { model: m, resolved: r } = model();
  const flipped = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: cards });
  const on = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true });
  assert.equal(flipped.getAttribute("viewBox"), plain.svg.getAttribute("viewBox"));
  assert.equal(on.getAttribute("viewBox"), plain.svg.getAttribute("viewBox"));
  for (const id of ["A", "B", "C"]) {
    for (const attr of ["data-object-cluster", "data-object-train"]) {
      assert.equal(layerGroup(flipped, id).getAttribute(attr), layerGroup(plain.svg, id).getAttribute(attr), `${id}'s ${attr} moved`);
      assert.equal(layerGroup(on, id).getAttribute(attr), layerGroup(plain.svg, id).getAttribute(attr), `${id}'s ${attr} moved`);
    }
    // The train - mixer, throat, extruder - is the same drawing.
    for (const role of ["mixer", "extruder", "feed"]) {
      const a = allWith(layerGroup(flipped, id), "data-role", role)[0];
      const b = allWith(layerGroup(plain.svg, id), "data-role", role)[0];
      assert.equal(JSON.stringify(a.children.map(c => c.attributes)), JSON.stringify(b.children.map(c => c.attributes)), `${id}'s ${role} was redrawn`);
    }
  }
  assert.equal(allWith(flipped, "data-role", "blend-card").length, 3);
  // Cards never appear in the focused layout: the mode and the open
  // layer are exclusive.
  const focusedSvg = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, focusLayer: "B", blendEdit: true, blendCards: cards, stageAspect: 1.6 });
  assert.equal(allWith(focusedSvg, "data-role", "blend-card").length, 0);
  for (const id of ["A", "B", "C"]) assert.ok(!layerGroup(focusedSvg, id).classList.contains("is-flippable"));
});

test("told which layers are turned over, the renderer builds every card handed in and shows only those: a layer turned back keeps its card hidden under its hoppers, in the same boxes", () => {
  const doc = fakeDocument();
  const cards = { A: doc.createElement("div"), B: doc.createElement("div"), C: doc.createElement("div") };
  const { model: m, resolved: r } = model();
  const plain = stage();
  const svg = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: cards, flipped: ["A", "C"] });
  // Three cards built, two layers turned over.
  assert.equal(allWith(svg, "data-role", "blend-card").length, 3);
  assert.ok(layerGroup(svg, "A").classList.contains("is-flipped"));
  assert.ok(!layerGroup(svg, "B").classList.contains("is-flipped"), "B shows its hoppers");
  assert.ok(layerGroup(svg, "B").classList.contains("is-flippable"));
  assert.ok(layerGroup(svg, "C").classList.contains("is-flipped"));
  // B's card is there, holding the editor it was handed, under its cluster.
  const b = layerGroup(svg, "B");
  const card = allWith(b, "data-role", "blend-card")[0];
  assert.ok(card, "the turned-back layer has no card built");
  assert.equal(card.querySelector("foreignObject").children[0], cards.B);
  assert.ok(allWith(b, "data-role", "hopper-cluster")[0], "and its cluster");
  // Nothing moved for it.
  for (const id of ["A", "B", "C"]) {
    for (const attr of ["data-object-cluster", "data-object-train", "data-object-card"]) {
      assert.equal(layerGroup(svg, id).getAttribute(attr), layerGroup(plain.svg, id).getAttribute(attr), `${id}'s ${attr} moved`);
    }
  }
  assert.equal(svg.getAttribute("viewBox"), plain.svg.getAttribute("viewBox"));
  // An empty list turns nothing over; no list at all keeps the older
  // contract - a card handed is a card shown.
  const none = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: cards, flipped: [] });
  for (const id of ["A", "B", "C"]) assert.ok(!layerGroup(none, id).classList.contains("is-flipped"));
  assert.equal(allWith(none, "data-role", "blend-card").length, 3);
  const all = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: cards });
  for (const id of ["A", "B", "C"]) assert.ok(layerGroup(all, id).classList.contains("is-flipped"));
  // A layer with no card cannot be turned over by naming it.
  const one = render.renderStage(m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: { B: cards.B }, flipped: ["A", "B"] });
  assert.ok(!layerGroup(one, "A").classList.contains("is-flipped"));
  assert.ok(layerGroup(one, "B").classList.contains("is-flipped"));
  // The mount forwards the list.
  const mount = doc.createElement("section");
  render.mountStage(mount, m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: cards, flipped: ["B"], stageAspect: 1.6 });
  assert.deepEqual(["A", "B", "C"].map(id => layerGroup(mount, id).classList.contains("is-flipped")), [false, true, false]);
  // The stylesheet hides the card the class does not show.
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/hopper.css"), "utf8");
  assert.match(css, /\.station-layer\.is-flippable:not\(\.is-flipped\) \.station-blend-card \{\s*display: none;/);
});

test("the mount says when the mode is on, and a value patch works through a turned-over cluster", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("section");
  const { model: m, resolved: r } = model();
  const card = doc.createElement("div");
  render.mountStage(mount, m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, blendEdit: true, blendCards: { A: card }, stageAspect: 1.6 });
  assert.equal(mount.getAttribute("data-blend-edit"), "true");
  const next = snapshot();
  next.layers[0].hoppers[1].pct = 35;
  next.layers[0].hoppers[0].pct = 65;
  next.layers[2].hoppers[1].resinName = "NEW";
  const r2 = resolved(next);
  const patched = render.patchStage(mount, m, { document: doc, hopperState: r2.hopperState, layerState: r2.layerState, stageAspect: 1.6 });
  assert.deepEqual(patched, { hoppers: 3, layers: 3 }, "the hidden hoppers under the card are patched like any other");
  const a = layerGroup(mount, "A");
  assert.ok(a.classList.contains("is-flipped"), "the patch took the card away");
  assert.equal(allWith(a, "data-role", "blend-card")[0].querySelector("foreignObject").children[0], card, "the patch rebuilt the card");
  render.mountStage(mount, m, { document: doc, hopperState: r.hopperState, layerState: r.layerState, stageAspect: 1.6 });
  assert.ok(!mount.hasAttribute("data-blend-edit"));
});

test("the card's box is exported and stable: the cluster's column, no narrower than the bank, under the header's share slot", () => {
  const { model: m, resolved: r } = model();
  const layout = require("./station/station-machine-layout.js").computeLayout(m, { hopperState: r.hopperState });
  for (const bank of layout.banks) {
    const slot = parts.shareSlotBox(bank);
    const box = parts.blendCardBox(bank);
    assert.ok(slot.y > bank.header.y, "the slot is above the header");
    assert.ok(box.y > slot.y + slot.height, "the card overlaps the slot");
    assert.equal(box.width, Math.max(bank.objects.cluster.width, bank.width));
    assert.ok(box.x <= bank.objects.cluster.x);
    assert.ok(Math.abs(box.y + box.height - (bank.objects.cluster.y + bank.objects.cluster.height)) < 0.01, "the card's bottom is not the cluster's");
    assert.ok(box.height > 200, "a six-row card needs the cluster's height");
  }
});

/* ----------------------------------------------------------------------
 *   The card: the focused editor, compact
 * -------------------------------------------------------------------- */

function buildCard(bridge, options) {
  const doc = fakeDocument();
  const { model: m, resolved: r } = model();
  const committed = [];
  const card = editor.create(doc, Object.assign({
    layer: m.layers[0], hopperState: r.hopperState, resins: () => [{ resin_code: "HX0" }, { resin_code: "NEW1" }],
    commands: bridge, recipe: "current", variant: "compact",
    onCommitted: result => committed.push(result)
  }, options || {}));
  return { doc, card, committed, model: m, resolved: r };
}

test("the compact variant is the same editor with its header and source line left out - and its drag kept", () => {
  const { bridge } = connectedBridge();
  const { card } = buildCard(bridge);
  assert.equal(card.variant, "compact");
  assert.equal(card.element.getAttribute("data-variant"), "compact");
  assert.equal(card.element.getAttribute("data-role"), "blend-editor");
  assert.equal(card.element.getAttribute("aria-label"), "Layer A blend");
  assert.equal(card.element.querySelector(".station-editor__header"), null, "the card repeats the layer's header");
  assert.equal(card.element.querySelector(".station-editor__source-value"), null, "the card carries a source line");
  assert.equal(card.element.querySelector(".station-editor__list.is-moving"), null);
  const rows = card.element.querySelectorAll(".station-editor__item");
  assert.equal(rows.length, 6);
  // Rearranging is part of the blend: a row with an assignment offers the
  // drag on the card as in the editor; an empty row has nothing to lift.
  assert.deepEqual(rows.map(row => row.classList.contains("is-movable")), [true, true, false, false, false, false]);
  assert.deepEqual(rows.slice(0, 2).map(row => row.querySelector(".station-editor__badge").textContent), ["A1", "A2"]);
  assert.deepEqual(rows.slice(0, 2).map(row => row.querySelector(".station-editor__resin-value").textContent), ["HX0", "LD0"]);
  assert.deepEqual(rows.slice(0, 2).map(row => row.querySelector(".station-editor__pct-input").value), ["60", "40"]);
  assert.equal(card.element.querySelector(".station-editor__total-value").textContent, "100%");
  assert.ok(card.element.querySelector(".station-editor__note"));
  assert.deepEqual(card.able, { resin: true, pct: true, source: false, move: true });
  // The full editor is untouched by the variant: header, source, drag.
  const { card: full } = buildCard(bridge, { variant: undefined });
  assert.equal(full.variant, "full");
  assert.equal(full.element.getAttribute("data-role"), "focus-editor");
  assert.ok(full.element.querySelector(".station-editor__header"));
  assert.ok(full.element.querySelector(".station-editor__source-value"));
  assert.deepEqual(full.able, { resin: true, pct: true, source: true, move: true });
  // Not on offer from the application: the card's rows do not drag, as
  // the editor's do not - the one offer, read once.
  const { bridge: noMove } = connectedBridge([...contract.COMMANDS].filter(name => name !== "moveHopper"));
  const { card: still } = buildCard(noMove);
  assert.equal(still.able.move, false);
  assert.ok(still.element.querySelectorAll(".station-editor__item").every(row => !row.classList.contains("is-movable")));
});

/* A drag on a card, step by step, as the editor's own tests drive it:
 * press on the badge, travel past the threshold, arrive over another row,
 * release. `under` stands in for elementFromPoint. */
function dragOnCard(bridge, options) {
  const hit = { under: null };
  const built = buildCard(bridge, Object.assign({ elementAt: () => hit.under }, options || {}));
  const root = built.card.element;
  const list = root.querySelector(".station-editor__list");
  const rowEl = id => root.querySelector(`[data-hopper='${id}']`);
  const badge = id => rowEl(id).querySelector(".station-editor__badge");
  const pointer = (type, target, extra) => Object.assign({ type, target, bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }, extra || {});
  built.rowEl = rowEl;
  built.press = (id, x, y) => badge(id).dispatchEvent(pointer("pointerdown", badge(id), { clientX: x, clientY: y }));
  built.moveTo = (x, y, underId) => { hit.under = underId ? badge(underId) : null; list.dispatchEvent(pointer("pointermove", list, { clientX: x, clientY: y })); };
  built.release = (x, y) => list.dispatchEvent(pointer("pointerup", list, { clientX: x, clientY: y, buttons: 0 }));
  built.marks = () => ({
    dragging: root.querySelectorAll(".station-editor__item").filter(i => i.classList.contains("is-dragging")).map(i => i.getAttribute("data-hopper")),
    targets: root.querySelectorAll(".station-editor__item").filter(i => i.classList.contains("is-drop-target")).map(i => i.getAttribute("data-hopper")),
    moving: list.classList.contains("is-moving")
  });
  return built;
}

test("a row dragged on a card and released on another is one moveHopper within the card's layer, through the bridge handed in; the marks are the editor's own and gone after", () => {
  const { bridge, calls } = connectedBridge();
  const b = dragOnCard(bridge);
  b.press("A2", 10, 10);
  assert.deepEqual(b.marks(), { dragging: [], targets: [], moving: false }, "a press is not yet a drag");
  b.moveTo(10, 40, "A4");
  assert.deepEqual(b.marks(), { dragging: ["A2"], targets: ["A4"], moving: true });
  b.release(10, 40);
  assert.deepEqual(calls, [{ command: "moveHopper", args: { recipe: "current", layer: "A", index: 1, toLayer: "A", toIndex: 3 } }]);
  assert.equal(b.committed.length, 1, "one authoritative update, as a value committed on the card");
  assert.deepEqual(b.marks(), { dragging: [], targets: [], moving: false });
  // Released off every row, or on the row itself: nothing is handed over.
  b.press("A1", 10, 10);
  b.moveTo(10, 200, null);
  b.release(10, 200);
  b.press("A1", 10, 10);
  b.moveTo(10, 30, "A1");
  b.release(10, 30);
  assert.equal(calls.length, 1);
  // A press on a control is that control's: the percentage field never
  // starts a drag, so typing on the card is what it was.
  const pct = b.rowEl("A2").querySelector(".station-editor__pct-input");
  pct.dispatchEvent({ type: "pointerdown", target: pct, bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0 });
  b.moveTo(0, 60, "A4");
  assert.deepEqual(b.marks(), { dragging: [], targets: [], moving: false });
});

test("the card a drag lifts off a compact row is stamped compact, so the stylesheet sizes its badge, resin and percentage as the row's - the editor's own drag rules name the stamp", () => {
  const { bridge } = connectedBridge();
  const mount = makeNode("div");
  const b = dragOnCard(bridge, { measure: () => ({ left: 100, top: 50, width: 90, height: 22 }), dragRoot: () => mount });
  b.press("A2", 110, 60);
  b.moveTo(110, 90, "A3");
  assert.equal(mount.children.length, 1);
  const proxy = mount.children[0];
  assert.equal(proxy.getAttribute("class"), "station-editor__item station-editor__drag-proxy");
  assert.equal(proxy.getAttribute("data-variant"), "compact");
  assert.equal(proxy.querySelector(".station-editor__source-value"), null, "the compact card's proxy has no source line either");
  assert.equal(proxy.getAttribute("style"), "width:90px;height:22px;transform:translate3d(100px, 80px, 0) scale(1.02);");
  b.release(110, 90);
  assert.equal(mount.children.length, 0);
  // The full editor's proxy says which face it left too.
  const full = dragOnCard(bridge, { variant: undefined, measure: () => ({ left: 0, top: 0, width: 200, height: 64 }), dragRoot: () => mount });
  full.press("A2", 10, 10);
  full.moveTo(10, 40, "A3");
  assert.equal(mount.children[0].getAttribute("data-variant"), "full");
  full.release(10, 40);
  // The stylesheet: every compact row rule that sizes what the proxy
  // carries names the stamped proxy alongside the row.
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/focus-editor.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const part of ["__badge", "__resin-value", "__pct", "__unit"]) {
    assert.match(css, new RegExp(`\\.station-editor\\[data-variant="compact"\\] \\.station-editor${part},\\n\\.station-editor__drag-proxy\\[data-variant="compact"\\] \\.station-editor${part} \\{`), `the compact ${part} rule leaves the proxy out`);
  }
  assert.match(css, /\.station-editor\[data-variant="compact"\] \.station-editor__item,\n\.station-editor__drag-proxy\[data-variant="compact"\] \{/);
  assert.match(css, /\.station-editor__drag-proxy\[data-variant="compact"\] \{\n  font-size: var\(--station-text-sm\);\n\}/);
  // And the compact face no longer declares the move off: one offer, read once.
  const source = fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8");
  assert.match(source, /if \(variant === "compact"\) able\.source = false;/);
  assert.doesNotMatch(source, /able\.move = false/);
});

test("a percentage committed on a card is one setHopperBlend to the Current recipe, and a resin chosen is one setHopperResin - through the bridge handed in", () => {
  const { bridge, calls } = connectedBridge();
  const { card, committed } = buildCard(bridge);
  const rows = card.element.querySelectorAll(".station-editor__item");
  const pct = rows[1].querySelector(".station-editor__pct-input");
  pct.dispatchEvent({ type: "focus" });
  pct.value = "35";
  pct.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.deepEqual(calls, [{ command: "setHopperBlend", args: { recipe: "current", layer: "A", index: 1, pct: 35 } }]);
  assert.equal(committed.length, 1);
  rows[1].querySelector(".station-editor__resin-value").dispatchEvent({ type: "click" });
  const search = rows[1].querySelector(".station-editor__search");
  assert.ok(search, "the card's resin opens the same search");
  search.value = "NEW";
  search.dispatchEvent({ type: "input" });
  search.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.deepEqual(calls[1], { command: "setHopperResin", args: { recipe: "current", layer: "A", index: 1, resin: "NEW1" } });
  // H1 is derived: its field is read-only on the card as in the editor.
  assert.ok(rows[0].querySelector(".station-editor__pct-input").hasAttribute("readonly"));
  // The total flags a bad blend on the card as in the editor.
  const bad = snapshot();
  bad.layers[0].hoppers[1].pct = 50;
  card.update({ hopperState: resolved(bad).hopperState });
  assert.ok(card.element.querySelector(".station-editor__total").classList.contains("is-invalid"));
  assert.equal(card.element.querySelector(".station-editor__total-value").textContent, "110%");
});

test("the Next face's card is the same card turned to the plan: it reads the plan's hopper state, says so, and every command names the next recipe - the running job never reaches it", () => {
  const { bridge, calls } = connectedBridge();
  const planned = snapshot();
  planned.nextRecipe = { layers: ["A", "B", "C"].map((name, i) => ({
    name, layerPct: 33,
    hoppers: Array.from({ length: 6 }, (_, index) => ({ index, pct: index === 0 ? 70 : index === 2 ? 30 : 0, resinName: index === 0 ? `PLAN${i}` : index === 2 ? `PL${i}` : "" }))
  })) };
  planned.sources.next = { "A:0": { resin: "PLAN0", source: "SILO 3" } };
  const r = resolved(planned);
  const { card } = buildCard(bridge, { hopperState: r.nextHopperState, recipe: "next" });
  assert.equal(card.element.getAttribute("data-recipe"), "next");
  assert.equal(card.element.getAttribute("aria-label"), "Layer A planned blend");
  const rows = card.element.querySelectorAll(".station-editor__item");
  const resinOf = row => { const node = row.querySelector(".station-editor__resin-value"); return node ? node.textContent : ""; };
  const pctOf = row => { const node = row.querySelector(".station-editor__pct-input"); return node ? node.value : ""; };
  assert.deepEqual(rows.slice(0, 3).map(resinOf), ["PLAN0", "", "PL0"]);
  assert.deepEqual([rows[0], rows[2]].map(pctOf), ["70", "30"]);
  assert.deepEqual(rows.map(row => row.classList.contains("is-movable")), [true, false, true, false, false, false]);
  const pct = rows[2].querySelector(".station-editor__pct-input");
  pct.dispatchEvent({ type: "focus" });
  pct.value = "25";
  pct.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.deepEqual(calls, [{ command: "setHopperBlend", args: { recipe: "next", layer: "A", index: 2, pct: 25 } }]);
  rows[1].querySelector(".station-editor__resin-value").dispatchEvent({ type: "click" });
  const search = rows[1].querySelector(".station-editor__search");
  search.value = "NEW";
  search.dispatchEvent({ type: "input" });
  search.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.deepEqual(calls[1], { command: "setHopperResin", args: { recipe: "next", layer: "A", index: 1, resin: "NEW1" } });
  // A publish that empties the plan empties the card - never a fall back
  // to the running job's hoppers.
  card.update({ hopperState: resolved(snapshot()).nextHopperState });
  assert.deepEqual(card.element.querySelectorAll(".station-editor__item").map(resinOf), ["", "", "", "", "", ""]);
  // The running card is unchanged by any of it: no stamp of the plan.
  const { card: running } = buildCard(bridge);
  assert.equal(running.element.getAttribute("data-recipe"), "current");
  assert.equal(running.element.getAttribute("aria-label"), "Layer A blend");
});

test("with no commands on offer the card is read-only and says so; it never invents a state to edit", () => {
  const { card } = buildCard(null);
  assert.equal(card.element.getAttribute("data-mode"), "read-only");
  const rows = card.element.querySelectorAll(".station-editor__item");
  assert.ok(rows[1].querySelector(".station-editor__resin-value").classList.contains("is-readonly"));
  assert.ok(rows[1].querySelector(".station-editor__pct-input").hasAttribute("readonly"));
  rows[1].querySelector(".station-editor__resin-value").dispatchEvent({ type: "click" });
  assert.equal(rows[1].querySelector(".station-editor__search"), null);
  assert.match(card.element.querySelector(".station-editor__note").textContent, /no application is connected/);
});

/* ----------------------------------------------------------------------
 *   The boot file: the mode as presentation state
 * -------------------------------------------------------------------- */

test("the mode is presentation state: two fields, no copy of a recipe, and entering it dispatches nothing and turns every layer over at once", () => {
  assert.match(boot, /const blendEdit = \{ active: false, kind: "blend", flipped: \[\] \};/);
  assert.match(boot, /let cardHandles = \{\};/);
  const enter = body("enterBlendEdit");
  assert.doesNotMatch(enter, /dispatch|\.request\(|publish|hopperState|resinName|pct/, "entering Blend Edit touches recipe state");
  // The same face already out is nothing to enter; a face the stage cannot
  // show (no layers; the Weights face without its module) is refused.
  assert.match(enter, /if \(modeIs\(face\)\) return false;\n\s+if \(face === "weights" \? !canEnterWeightsEdit\(\) : !canEnterBlendEdit\(\)\) return false;/);
  assert.match(enter, /leaveStageControl\(\);/);
  assert.match(enter, /focus = null;/, "the open layer is not closed on entry");
  assert.match(enter, /blendEdit\.active = true;/);
  assert.match(enter, /blendEdit\.flipped = layerIds\(\);/, "every layer is turned over on entry: the rail's one click is Edit All");
  // The stage is drawn with both faces on every layer; then the ones
  // showing hoppers turn over to the card and, when the face is being
  // switched, the ones already out settle their new card in - and the
  // face's hint said.
  assert.match(enter, /redrawForBlend\(\);\n\s+turnFaces\(blendEdit\.flipped\.filter\(id => !were\.includes\(id\)\), "cluster", "card"\);\n\s+turnFaces\(were, null, "card"\);/);
  assert.match(enter, /say\(HINT\[face\]\);/, "the mode says how to leave it and how to turn a layer back");
  assert.match(boot, /const HINT = \{ blend: BLEND_EDIT_HINT, weights: WEIGHTS_EDIT_HINT, next: NEXT_EDIT_HINT \};/);
  assert.match(boot, /const FACES = \["blend", "weights", "next"\];/);
  assert.match(enter, /const face = FACES\.includes\(kind\) \? kind : "blend";/);
  // The rail's switch is the one toggle over the one entry and the one exit.
  const toggle = body("toggleBlendEdit");
  assert.match(toggle, /return modeIs\("blend"\) \? exitBlendEdit\(\) : enterBlendEdit\("blend"\);/);
  assert.equal((boot.match(/blendEdit\.active = false;/g) || []).length, 2, "the mode is turned off in exitBlendEdit and by a line that lost its layers, nowhere else");
  assert.equal((boot.match(/blendEdit\.active = true;/g) || []).length, 1, "and turned on in enterBlendEdit only");
});

test("a layer is turned over or back one at a time, only while the mode is on; there is no Edit All / Show All beside the rail's switch", () => {
  const flip = body("flipLayer");
  assert.match(flip, /if \(!blendEdit\.active \|\| !layerIds\(\)\.includes\(id\)\) return false;/);
  assert.match(flip, /const wanted = on === undefined \? !isFlipped\(id\) : !!on;/);
  assert.match(flip, /blendEdit\.flipped = wanted \? blendEdit\.flipped\.concat\(\[id\]\) : blendEdit\.flipped\.filter\(other => other !== id\);/);
  // A flip is the layer's two faces trading in place - the same turn the
  // rail's switch gives every layer - never a redraw of the stage.
  assert.match(flip, /turnFaces\(\[id\], wanted \? "cluster" : "card", wanted \? "card" : "cluster"\);/);
  assert.doesNotMatch(flip, /stage\.refresh|redrawForBlend|mountStage/, "a flip redraws the stage");
  // The pages that read values - the Handbook's, Resin Totals in its
  // window - are told through the one helper, then the rail.
  assert.match(flip, /refreshPages\(\);\n\s+syncRail\(\);/);
  // On the Next face the header's share follows the face, by the value
  // patch - the running job's hopper state, the face's layer state.
  assert.match(flip, /if \(blendEdit\.kind === "next" && current\.model && current\.resolved\) \{\n\s+render\.patchStage\(mounts\.machine, current\.model, \{\n\s+hopperState: current\.resolved\.hopperState,\n\s+layerState: stageLayerState\(current\.resolved\),/);
  assert.doesNotMatch(flip, /dispatch|publish|nextHopperState/, "a flip touches recipe state");
  assert.doesNotMatch(boot, /function flipAll\(/, "Edit All is entering the mode; nothing else turns every layer at once");
  // It leaves the control the operator is in before the stage is rebuilt,
  // so a value typed on one card commits rather than vanishing.
  assert.match(flip, /leaveStageControl\(\);/);
  const leave = body("leaveStageControl");
  assert.match(leave, /mounts\.machine\.contains\(active\) && typeof active\.blur === "function"\) active\.blur\(\);/);
});

test("Done commits what is being entered along the editor's own path, turns every layer back, and restores the stage", () => {
  const exit = body("exitBlendEdit");
  assert.match(exit, /if \(!blendEdit\.active\) return false;/);
  assert.match(exit, /leaveStageControl\(\);/);
  assert.match(exit, /blendEdit\.active = false;/);
  assert.match(exit, /blendEdit\.flipped = \[\];/);
  // The cards turn back where they stand; the stage is drawn without them
  // once the turn lands - at once when nothing is in flight - unless
  // something else drew it meanwhile.
  assert.match(exit, /const turn = turnFaces\(were, "card", "cluster"\);/);
  assert.match(exit, /if \(!turn\.animated\) redrawForBlend\(\);/);
  assert.match(exit, /turn\.done\.then\(\(\) => \{ if \(drawCount === drawn\) redrawForBlend\(\); \}\);/);
  assert.doesNotMatch(exit, /dispatch|undo|discard|revert/, "Done applies or discards on its own");
  // And the redraw is the stage's own refresh: no second render path.
  const redraw = body("redrawForBlend");
  assert.match(redraw, /stage\.refresh\(focusLayerFor\(\)\);/);
  assert.match(redraw, /refreshPages\(\);/);
  assert.match(body("refreshPages"), /if \(handbookPanel\) handbookPanel\.update\(\);\n\s+refreshTotals\(\);/);
  // The turn itself is the face-turn module's, through the transition
  // module's play, on the stage's timing; without the module the class
  // alone changes, at once.
  const turn = body("turnFaces");
  assert.match(turn, /faceTurn\.turn\(layer, \{\n\s+to,\n\s+from,\n\s+timing,\n\s+reducedMotion: reduced,/);
  assert.match(turn, /animate: transition\.play/);
  assert.match(turn, /layer\.classList\.toggle\("is-flipped", to === "card"\)/);
  assert.doesNotMatch(turn, /stage\.refresh|mountStage|\.animate\(/);
  assert.match(boot, /const faceTurn = root\.PolynStationFaceTurn \|\| null;/);
  assert.match(boot, /let drawCount = 0;/);
  // Escape with nothing open is Done - once a Bulk Edit selection in
  // progress has been cancelled, which is the nearer thing to leave.
  assert.match(boot, /if \(focus\) \{ clearFocus\(\); return; \}\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+if \(bulk\.active\) \{ cancelBulk\(\); return; \}\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+if \(blendEdit\.active\) exitBlendEdit\(\);/);
});

test("the stage draws the cards from the same editor, addressed to the same recipe, and the mode never reaches the focused layout", () => {
  const draw = body("drawStage");
  assert.match(draw, /if \(blendEdit\.active && model && !focusLayer\) \{/);
  // One card per layer, turned over or not: the stage carries both faces
  // and is told which to show, so a turn is a class change, not a redraw.
  assert.doesNotMatch(draw, /if \(!isFlipped\(entry\.id\)\) continue;/);
  assert.match(draw, /for \(const entry of model\.layers\) \{\n\s+\/\* The Weights face/);
  assert.match(draw, /blendCards: cards,\n\s+flipped: blendEdit\.flipped\.slice\(\),/);
  assert.match(draw, /\}\);\n\s+drawCount \+= 1;/);
  // The Weights face (station-weight-cards.js) takes the same footprint
  // from the same builder; the blend face is the editor, as before.
  assert.match(draw, /const card = blendEdit\.kind === "weights" && weightCards \? weightCards\.create\(mounts\.machine\.ownerDocument, \{[\s\S]*?\}\) : focusEditor\.create\(mounts\.machine\.ownerDocument, \{/);
  assert.match(draw, /variant: "compact",/);
  // A card is addressed to the face's recipe: the running one, or - on
  // the Next face - the plan, whose hopper state it then reads.
  assert.match(draw, /const cardRecipe = blendEdit\.kind === "next" \? "next" : recipe;/);
  assert.match(draw, /const cardHopperState = blendEdit\.kind === "next" \? \(current\.resolved \? current\.resolved\.nextHopperState : null\) : hopperState;/);
  assert.match(draw, /recipe: cardRecipe,\n/, "a card is not addressed to the face's recipe");
  assert.match(draw, /hopperState: cardHopperState,\n/, "a card does not read the face's hopper state");
  assert.match(draw, /blendEdit: blendEdit\.active && !focusLayer,/);
  assert.match(draw, /blendCards: cards,/);
  // The value path updates every card in place, as it does the editor.
  const publish = body("onPublish");
  assert.match(publish, /for \(const id of Object\.keys\(cardHandles\)\) \{\n\s+cardHandles\[id\]\.update\(\{\n\s+hopperState: blendEdit\.kind === "next" \? resolved\.nextHopperState : resolved\.hopperState,\n\s+smartHoppers: resolved\.smartHoppers,\n\s+otherResins: otherResinsFor\(resolved\)\n\s+\}\);\n\s+\}/);
  // The other recipe's resin rides beside each card: the plan's on the
  // running face, the job's on the Next face, nothing on Weights - and
  // whether the cards show it is the card rail's Compare, the boot
  // file's session state for every card at once, so a rebuilt stage
  // shows what the operator switched on.
  assert.match(draw, /otherResins: otherResinsFor\(current\.resolved\),\n\s+otherRecipe: cardRecipe === "next" \? "current" : "next",\n\s+showOther: cardView\.compare,\n/);
  assert.doesNotMatch(draw, /onShowOther/, "a card is still asked for its own eye");
  const other = body("otherResinsFor");
  assert.match(other, /if \(blendEdit\.kind === "next"\) return source\.otherResins\(resolved, "next"\);/);
  assert.match(other, /if \(blendEdit\.kind === "blend"\) return source\.otherResins\(resolved, "current"\);/);
  assert.match(other, /return null;\s*\}$/);
  assert.doesNotMatch(draw.slice(draw.indexOf("weightCards.create("), draw.indexOf("weightCards.create(") + 900), /otherResins|showOther/, "the Weights face has an eye");
  // A plan appearing or going under the cards takes the full path: the
  // value path cannot add or take a card's eye.
  assert.match(publish, /const planTurned = blendEdit\.active && blendEdit\.kind !== "weights"\n\s+&& !!otherResinsFor\(current\.resolved\) !== !!otherResinsFor\(resolved\);/);
  assert.match(publish, /if \(kind === "values" && !openLayerGone && stage\.getState\(\)\.phase !== "opening" && stage\.getState\(\)\.phase !== "closing" && !planTurned\) \{/);
  // Session-only: kept across a face change and the mode's end (Compare
  // means "the other recipe" on either face), never stored.
  assert.match(boot, /const cardView = \{ compare: false, size: "normal" \};/);
  assert.doesNotMatch(body("enterBlendEdit"), /cardView/);
  assert.doesNotMatch(body("exitBlendEdit"), /cardView/);
  assert.doesNotMatch(boot, /cardView[^\n]*(localStorage|sessionStorage|setItem)/);
  assert.doesNotMatch(boot, /showOther\.(clear|has|add|delete)/, "the per-card set is still there");
  // A layer that vanished is dropped from the mode; a line with no layers ends it.
  const all = body("renderAll");
  assert.match(all, /blendEdit\.flipped = blendEdit\.flipped\.filter\(id => !!model && model\.layers\.some\(layer => layer\.id === id\)\);/);
  assert.match(all, /if \(blendEdit\.active && \(!model \|\| !model\.layers\.length\)\) blendEdit\.active = false;/);
});

test("the header's share is its own click target, ahead of the mode's guard; a train click during the mode opens nothing and turns that layer instead; ordinary clicks are untouched", () => {
  const start = boot.slice(boot.indexOf("function start()"));
  const click = start.slice(start.indexOf('mounts.machine?.addEventListener("click"'), start.indexOf("mounts.machine?.addEventListener(\"mouseover\""));
  assert.doesNotMatch(click, /"flip"/, "the click handler still resolves a flip chip");
  assert.match(click, /if \(target === "share"\) \{\n\s+openShareEditor\(hit\);\n\s+return;\n\s+\}/);
  assert.match(click, /if \(blendEdit\.active && opensLayer\(target\)\) \{\n\s+flipLayer\(layer\);\n\s+return;\n\s+\}/);
  assert.doesNotMatch(click, /Done in the Handbook/, "the mode's exit is no longer the Handbook's");
  // The controls and the focus paths that were there are there, in order:
  // controls first, then the share, then the mode's guard, then focus.
  const order = ["toggleHopperControl(hit)", 'if (target === "share")', "if (blendEdit.active && opensLayer(target))", "setFocus({ layer, target, hopper })"];
  const positions = order.map(needle => click.indexOf(needle));
  assert.ok(positions.every(p => p > -1) && positions.every((p, i) => i === 0 || p > positions[i - 1]), "the click handler's order changed");
});

test("the Handbook is mounted from the shell's slot with Recipe Book, Resin Totals, Appearance, and their narrow surfaces - and no Blend Edit surface, no exit of the mode on close", () => {
  const start = boot.slice(boot.indexOf("function start()"));
  const mount = start.slice(start.indexOf("if (handbook && mounts.handbook) {"), start.indexOf("feedJob(current.model, current.resolved);"));
  assert.match(mount, /handbookPanel = handbook\.create\(doc, \{/);
  assert.match(mount, /if \(recipeBook\) handbookSections\.push\(recipeBook\.section\);/);
  assert.match(mount, /if \(appearance\) handbookSections\.push\(appearance\.section\);/);
  assert.match(mount, /sections: handbookSections,/);
  assert.match(mount, /recipes,\s+\/\*[\s\S]*?theme: themeController,\s+themes: theme \? theme\.THEMES : \[\]/);
  assert.doesNotMatch(mount, /blend|beforeClose|exitBlendEdit/, "the Handbook is handed nothing of the mode and ends nothing on close");
  assert.doesNotMatch(boot, /blendSurface/, "no surface over the mode is built for the book");
  assert.match(mount, /reducedMotion: prefersReducedMotion/);
  assert.match(mount, /mounts\.handbook\.appendChild\(handbookPanel\.element\);/);
  // The rail is mounted from its own slot, ahead of the Handbook, and
  // handed the two callbacks and nothing else of the state.
  const rail = start.slice(start.indexOf("if (machineRail && mounts.rail) {"), start.indexOf("if (handbook && mounts.handbook) {"));
  assert.match(rail, /railPanel = machineRail\.create\(doc, \{\s+onBlendEdit: toggleBlendEdit,\s+onWeightsEdit: toggleWeightsEdit,\s+onSmartHoppers: toggleSmartHoppers,\s+onNextEdit: toggleNextEdit,/);
  assert.doesNotMatch(rail, /onResetTracking/, "Reset Tracking is the timeline's, not the rail's");
  assert.match(boot, /timeline = rundownTimeline\.create\(doc, \{[^}]*onResetTracking: resetTracking,/);
  assert.match(rail, /mounts\.rail\.appendChild\(railPanel\.element\);/);
  assert.match(rail, /syncRail\(\);\s+\}/, "the rail is told once the stage that was drawn before it exists");
  assert.doesNotMatch(boot, /placeRail|ResizeObserver/, "the rail stands in the launcher's corner by stylesheet: nothing is measured or placed");
  assert.doesNotMatch(rail, /hopperState|commands|snapshot|blendEdit\./, "the rail is handed state to hold");
  // The boot file still never dispatches, connects or publishes.
  assert.doesNotMatch(boot, /\.dispatch\s*\(|\.connect\s*\(|\.publish\s*\(/);
});

test("the shell's slot lies over the stage's cell and the Handbook's stylesheet is part of Station's set on both pages", () => {
  const shellCss = fs.readFileSync(path.join(ROOT, "station/styles/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(shellCss, /\.station-handbook-slot \{[^}]*grid-area: machine;[^}]*z-index: 5;[^}]*pointer-events: none;/);
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  assert.match(host, /"station\/styles\/components\/handbook\.css"/);
  assert.match(harness, /styles\/components\/handbook\.css\?v=/);
});

test("a card's row list is not a scroll container: the result list a search hangs from a row stands clear of it, as in the full editor, instead of being clipped inside it with a scrollbar grown for it", () => {
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/focus-editor.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const list = css.match(/\.station-editor\[data-variant="compact"\] \.station-editor__list \{([^}]*)\}/);
  assert.ok(list, "the compact list rule is missing");
  assert.doesNotMatch(list[1], /overflow/, "the compact list is a scroll container: an absolutely positioned result list inside it counts as its scrollable overflow, so it grows a scrollbar for the list and clips it at its own edge");
  // The result list is still placed inside the card's own box - the
  // <foreignObject> - by the editor, on both faces.
  assert.match(css, /\.station-editor__results \{[^}]*position: absolute;/);
  const source = fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8");
  assert.match(source, /row\.item\.closest\("foreignObject"\)/);
});

/* ----------------------------------------------------------------------
 *   The card's material: the console's glass
 * -------------------------------------------------------------------- */

test("the layer card is glass: every face wears .station-glass on its HTML root, the SVG frame under it paints nothing, and the Next face keeps its ring inside the glass's shadows", () => {
  const { bridge } = connectedBridge();
  // The compact faces - current and Next - wear the material; the full
  // editor in the focus workspace does not (the workspace is its frame).
  for (const recipe of ["current", "next"]) {
    const { card } = buildCard(bridge, { recipe });
    assert.ok(classSet(card.element).has("station-glass"), `the ${recipe} face is not glass`);
    assert.ok(classSet(card.element).has("station-editor"));
  }
  const { card: full } = buildCard(bridge, { variant: "full" });
  assert.ok(!classSet(full.element).has("station-glass"), "the focus workspace's editor wears the card's glass");
  // The drag proxy a row lifts is not a face and wears none of it.
  const proxy = (fs.readFileSync(path.join(ROOT, "station/station-focus-editor.js"), "utf8").match(/station-editor__drag-proxy[^"]*"/g) || []).join(" ");
  assert.doesNotMatch(proxy, /station-glass/);

  const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (css, name) => { const at = css.indexOf(`${name} {`); assert.ok(at >= 0, `${name} has no rule`); return css.slice(at, css.indexOf("}", at)); };
  const hopper = strip(fs.readFileSync(path.join(ROOT, "station/styles/components/hopper.css"), "utf8"));
  const frame = rule(hopper, ".station-blend-card__frame");
  assert.match(frame, /fill: none;/);
  assert.match(frame, /stroke: none;/);
  assert.doesNotMatch(frame, /surface-editable|border-strong/, "the frame still paints the old sunken panel under the glass");
  // The material is spelled once, in glass.css; the faces restate none
  // of it but the one property the Next ring shares with it. (The card's
  // "⋯" menu is its own glass in focus-editor.css, as it was.)
  const focus = strip(fs.readFileSync(path.join(ROOT, "station/styles/components/focus-editor.css"), "utf8"));
  const weights = strip(fs.readFileSync(path.join(ROOT, "station/styles/components/weight-cards.css"), "utf8"));
  const restated = /backdrop-filter|--station-handbook-glass\)|--station-handbook-glass-blur|--station-handbook-glass-border/;
  assert.doesNotMatch(weights, restated, "weight-cards.css restates the glass");
  assert.doesNotMatch(rule(focus, ".station-editor"), restated);
  const compact = rule(focus, '.station-editor[data-variant="compact"]');
  assert.doesNotMatch(compact, restated);
  assert.match(compact, /box-sizing: border-box;/, "the glass's edge would push the face past its box");
  const next = rule(focus, '.station-editor[data-variant="compact"][data-recipe="next"]');
  assert.match(next, /box-shadow:\s*inset 0 0 0 var\(--station-stroke\) var\(--station-timeline-upcoming, var\(--station-info\)\),\s*inset 0 var\(--station-stroke\) 0 var\(--station-handbook-glass-highlight\),\s*var\(--station-handbook-glass-shadow\);/);
  assert.doesNotMatch(next, restated);
  assert.doesNotMatch(next, /border-radius/, "the Next face rounds itself differently from the glass");
});
