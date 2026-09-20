"use strict";

/* Show Extruders: the Station display preference (station-display.js),
 * its switch on the Appearance page, and what the stage draws under it.
 *
 * Off - the default - each layer's train is the blender alone on a canvas
 * that ends at the blenders' discharge, so the stage's fit draws every
 * blender assembly larger in the room the extruders took; on, the train
 * is drawn whole, as it always was. The preference is the device's, kept
 * beside the theme, and reaches the layout as one option. These tests
 * pin the controller, the layout under both states, the renderer, the
 * switch, a booted Station's redraw, and the two hosts' wiring.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const display = require("./station-display.js");
const theme = require("./station-theme.js");
const appearance = require("./station/station-appearance.js");
const layoutModule = require("./station/station-machine-layout.js");
const render = require("./station/station-render.js");
const lineModel = require("./station/station-line-model.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); }
  };
}

function literal(overrides) {
  return Object.assign({
    lineNumber: 1, displayName: "Test line", layerCount: 3, layerAPosition: "outside",
    hopperNamingMode: "standard", hopperGeometry: "cylindrical"
  }, overrides);
}
const modelFor = config => lineModel.buildLineModel(literal(config));
const layoutFor = (config, options) => layoutModule.computeLayout(modelFor(config), options);

/* ----------------------------------------------------------------------
 *   A fake DOM: enough for the Appearance page and, below, a booted Station
 * -------------------------------------------------------------------- */

let focused = null;
function classSet(node) { return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
function matchesOne(node, selector) {
  const parts = selector.match(/(\.[a-zA-Z0-9_-]+|\[[a-zA-Z-]+(?:=(?:'[^']*'|"[^"]*"))?\]|:[a-z-]+|[a-zA-Z]+)/g) || [];
  return parts.every(part => {
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
    stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }
  }, init || {});
}
function makeNode(doc, name, ns) {
  const node = {
    nodeName: name, tagName: name.toUpperCase(), namespaceURI: ns || null, nodeType: 1,
    attributes: {}, children: [], parent: null, listeners: {}, style: {}, dataset: {}, value: "", disabled: false,
    ownerDocument: doc,
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get parentNode() { return this.parent; },
    get parentElement() { return this.parent; },
    get textContent() { return this._text !== undefined && !this.children.length ? this._text : this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this.children = []; this._text = String(v); },
    get innerHTML() { return ""; },
    set innerHTML(v) { this.children = []; },
    get hidden() { return this.hasAttribute("hidden"); },
    set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); },
    get id() { return this.getAttribute("id") || ""; },
    set id(v) { this.setAttribute("id", v); },
    get className() { return this.getAttribute("class") || ""; },
    set className(v) { this.setAttribute("class", v); },
    get isConnected() { let n = this; while (n) { if (n === doc) return true; n = n.parent; } return false; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { if (child.parent) child.parent.removeChild(child); this.children.push(child); child.parent = this; this._text = undefined; return child; },
    append(...kids) { for (const k of kids) this.appendChild(typeof k === "string" ? doc.createTextNode(k) : k); },
    prepend(...kids) { for (const k of kids.reverse()) { const c = typeof k === "string" ? doc.createTextNode(k) : k; if (c.parent) c.parent.removeChild(c); this.children.unshift(c); c.parent = this; } },
    insertBefore(fresh, ref) { if (fresh.parent) fresh.parent.removeChild(fresh); const at = ref ? this.children.indexOf(ref) : -1; if (at < 0) this.children.push(fresh); else this.children.splice(at, 0, fresh); fresh.parent = this; return fresh; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parent = null; return child; },
    replaceChild(fresh, old) { const at = this.children.indexOf(old); if (at < 0) throw new Error("not a child"); if (fresh.parent) fresh.parent.removeChild(fresh); this.children[at] = fresh; fresh.parent = this; old.parent = null; return old; },
    replaceChildren(...kids) { for (const c of this.children) c.parent = null; this.children = []; this.append(...kids); },
    remove() { if (this.parent) this.parent.removeChild(this); },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parent; } return false; },
    closest(selector) { let n = this; while (n) { if (n.nodeType === 1 && matches(n, selector)) return n; n = n.parent; } return null; },
    matches(selector) { return matches(this, selector); },
    querySelectorAll(selector) { const out = []; walk(this, n => { if (n !== this && n.nodeType === 1 && matches(n, selector)) out.push(n); }); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    getElementsByTagName(tag) { return this.querySelectorAll(tag); },
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
    focus() { focused = this; this.dispatchEvent(makeEvent("focus")); this.dispatchEvent(makeEvent("focusin", { bubbles: true })); },
    blur() { if (focused === this) focused = null; },
    select() {},
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    getBBox() { return { x: 0, y: 0, width: 10, height: 10 }; },
    scrollIntoView() {},
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
  doc.createDocumentFragment = () => makeNode(doc, "#fragment");
  doc.head = doc.appendChild(makeNode(doc, "head"));
  doc.body = doc.appendChild(makeNode(doc, "body"));
  doc.documentElement = doc;
  doc.readyState = "complete";
  Object.defineProperty(doc, "activeElement", { get: () => focused });
  return doc;
}

/* ----------------------------------------------------------------------
 *   The controller
 * -------------------------------------------------------------------- */

test("the preference is off by default, stamped on the root, and survives a storage that is empty, broken, or absent", () => {
  assert.deepEqual(display.DEFAULTS, { showExtruders: false });
  assert.equal(display.STORAGE_KEY, "polyn.station.display.v1");
  for (const saved of [storage(), storage({ [display.STORAGE_KEY]: "not json" }), storage({ [display.STORAGE_KEY]: "[1,2]" }),
    storage({ [display.STORAGE_KEY]: JSON.stringify({ showExtruders: "yes", other: true }) }), null]) {
    const root = fakeDocument().createElement("div");
    const controller = display.create(root, saved);
    assert.equal(controller.getShowExtruders(), false);
    assert.equal(root.getAttribute("data-extruders"), "hidden");
    // Restoring writes nothing: an empty storage stays empty.
    if (saved) assert.equal(saved.value(display.STORAGE_KEY) === undefined || saved.value(display.STORAGE_KEY) !== JSON.stringify({ showExtruders: false }), true);
  }
  assert.equal(display.create(null, storage()), null);
  assert.equal(display.create({}, storage()), null, "a root that cannot carry the attribute is no root");
});

test("setting the preference persists it as JSON, stamps the root, tells subscribers once per change, and restores on the next load", () => {
  const saved = storage();
  const root = fakeDocument().createElement("div");
  const controller = display.create(root, saved);
  const heard = [];
  const off = controller.subscribe(state => heard.push(state));
  assert.equal(controller.setShowExtruders(true), true);
  assert.equal(root.getAttribute("data-extruders"), "shown");
  assert.deepEqual(JSON.parse(saved.value(display.STORAGE_KEY)), { showExtruders: true });
  assert.deepEqual(heard, [{ showExtruders: true }]);
  assert.ok(Object.isFrozen(heard[0]), "a listener is handed a copy it cannot change");
  // The same value again is no change: nothing said.
  controller.setShowExtruders(true);
  assert.equal(heard.length, 1);
  controller.setShowExtruders("");
  assert.equal(controller.getShowExtruders(), false, "anything is read as a boolean");
  assert.equal(root.getAttribute("data-extruders"), "hidden");
  assert.equal(heard.length, 2);
  off();
  controller.setShowExtruders(true);
  assert.equal(heard.length, 2, "an unsubscribed listener hears nothing");
  // A fresh controller over the same storage restores the choice.
  const again = display.create(fakeDocument().createElement("div"), saved);
  assert.equal(again.getShowExtruders(), true);
  assert.equal(display.read(saved).showExtruders, true);
  assert.deepEqual(display.normalize(undefined), { showExtruders: false });
  assert.equal(display.subscribe, undefined, "the module surface holds no state of its own");
  assert.ok(Object.isFrozen(display) && Object.isFrozen(controller));
});

test("a listener that throws stops nothing, and initialize reads the environment's storage without naming it in Station", () => {
  const saved = storage();
  const root = fakeDocument().createElement("div");
  const controller = display.initialize(root, { localStorage: saved });
  controller.subscribe(() => { throw new Error("one view"); });
  const heard = [];
  controller.subscribe(state => heard.push(state.showExtruders));
  controller.setShowExtruders(true);
  assert.deepEqual(heard, [true]);
  assert.equal(display.initialize(root, null).getShowExtruders(), false);
  assert.equal(display.initialize(root, { get localStorage() { throw new Error("blocked"); } }).getShowExtruders(), false);
  // Storage is the root file's business alone, as it is the theme's.
  for (const file of ["station/station.js", "station/station-appearance.js", "station-host.js"]) {
    assert.doesNotMatch(read(file), /localStorage/, `${file} names storage`);
  }
});

/* ----------------------------------------------------------------------
 *   The layout
 * -------------------------------------------------------------------- */

test("with the extruders off the train is the blender alone, the throat is gone, and the canvas ends under the blenders", () => {
  const d = layoutModule.DIMENSIONS;
  assert.equal(d.extruders, true, "the layout's own default draws the train whole");
  assert.ok(d.heightWithoutExtruders < d.height);
  for (const config of [{ layerCount: 1 }, { layerCount: 3 }, { layerCount: 5, hopperCount: 3 }, { layerCount: 3, hopperManufacturer: "tsm" }]) {
    const whole = layoutFor(config);
    const bare = layoutFor(config, { showExtruders: false });
    assert.equal(whole.height, d.height);
    assert.equal(bare.height, d.heightWithoutExtruders);
    assert.equal(bare.dimensions.extruders, false);
    for (const bank of bare.banks) {
      assert.equal(bank.extruder, null, `${bank.id} still places an extruder`);
      assert.equal(bank.throat, null, `${bank.id} still places a throat`);
      // The train ends where the last machine discharges - the downcomer's
      // on a TSM line - with clearance under it, and stays on the canvas.
      const last = bank.downcomer || bank.mixer;
      const train = bank.objects.train;
      assert.ok(Math.abs(train.y + train.height - last.bounds.bottom) < 1e-6, `${bank.id}'s train does not end at its blender`);
      assert.ok(train.y + train.height + 12 <= bare.height, `${bank.id}'s blender runs off the shorter canvas`);
      assert.ok(train.y + train.height <= bare.height - 12);
    }
    // Neighbouring blenders keep their room: the throat carried no width.
    for (let i = 1; i < bare.banks.length; i++) {
      assert.ok(bare.banks[i - 1].objects.train.x + bare.banks[i - 1].objects.train.width < bare.banks[i].objects.train.x);
    }
  }
});

test("nothing above the discharge moves: hoppers, headers, blenders and the canvas width are the same drawing with or without the extruders", () => {
  for (const config of [{ layerCount: 3 }, { layerCount: 5 }, { layerCount: 3, hopperManufacturer: "tsm" }]) {
    const state = {};
    for (const layer of modelFor(config).layers) for (const h of layer.hoppers) state[`${layer.id}:${h.index}`] = { usableHeight: 24 + h.index * 3 };
    const whole = layoutFor(config, { hopperState: state });
    const bare = layoutFor(config, { hopperState: state, showExtruders: false });
    assert.equal(bare.width, whole.width);
    whole.banks.forEach((bank, i) => {
      const other = bare.banks[i];
      assert.deepEqual(other.cluster, bank.cluster, `${bank.id}'s cluster moved`);
      assert.deepEqual(other.header, bank.header);
      assert.deepEqual(other.mixer, bank.mixer, `${bank.id}'s blender moved`);
      assert.deepEqual(other.downcomer, bank.downcomer);
      assert.deepEqual(other.objects.cluster, bank.objects.cluster);
      assert.equal(other.cardBottom, bank.cardBottom, "the blend card keeps its box");
      // The train's box was the extruder's where it reached past the
      // blender; without one it is the blender's, inside the old box,
      // hung from the same top.
      assert.equal(other.objects.train.y, bank.objects.train.y);
      assert.ok(other.objects.train.x >= bank.objects.train.x - 1e-9);
      assert.ok(other.objects.train.x + other.objects.train.width <= bank.objects.train.x + bank.objects.train.width + 1e-9);
      assert.ok(other.objects.train.height < bank.objects.train.height);
    });
  }
  // showExtruders true or omitted is the whole train, unchanged.
  assert.deepEqual(layoutFor({ layerCount: 3 }, { showExtruders: true }), layoutFor({ layerCount: 3 }));
  /* A line narrower than the canvas is tall is centred on a canvas as
   * wide as it is tall (minAspect), so a one-layer line's canvas follows
   * the height down: the row is the same, the margin around it less.
   * Squarer, it fills more of a wide stage - the room goes to the
   * blender, as everywhere else. */
  const d = layoutModule.DIMENSIONS;
  const one = layoutFor({ layerCount: 1 });
  const oneBare = layoutFor({ layerCount: 1 }, { showExtruders: false });
  assert.equal(one.width, d.height * d.minAspect);
  assert.equal(oneBare.width, d.heightWithoutExtruders * d.minAspect);
  assert.equal(oneBare.row.width, one.row.width);
  assert.ok(Math.abs((oneBare.row.x - (oneBare.width - oneBare.row.width) / 2)) < 1e-6, "the row stays centred");
});

test("the focused layout works without the extruders: three columns on the shorter canvas, the train column sized to the blenders", () => {
  for (const config of [{ layerCount: 3 }, { layerCount: 5 }, { layerCount: 3, hopperManufacturer: "tsm" }]) {
    for (const focusLayer of modelFor(config).layers.map(l => l.id)) {
      const layout = layoutFor(config, { focusLayer, showExtruders: false, stageAspect: 1.8 });
      assert.equal(layout.height, layoutModule.DIMENSIONS.heightWithoutExtruders);
      assert.equal(layout.focusLayer, focusLayer);
      const open = layout.banks.find(bank => bank.id === focusLayer);
      assert.equal(open.extruder, null);
      const { train, cluster } = open.objects;
      assert.ok(train.x >= 0 && train.x + train.width <= cluster.x, `${focusLayer}: train and cluster overlap`);
      assert.ok(cluster.x + cluster.width <= layout.workspace.x);
      assert.ok(train.y >= 0 && train.y + train.height <= layout.height, `${focusLayer}: the train leaves the canvas`);
      // The train column is the blenders' widest view, so it is narrower
      // than the whole train's column: the workspace gains the difference.
      const whole = layoutFor(config, { focusLayer, stageAspect: 1.8 });
      assert.ok(layout.workspace.x <= whole.workspace.x);
      for (const ghost of layout.banks.filter(bank => bank.id !== focusLayer)) assert.equal(ghost.extruder, null);
    }
  }
});

/* ----------------------------------------------------------------------
 *   The renderer
 * -------------------------------------------------------------------- */

test("the stage says which train it draws, draws no extruder or feed with them off, and the same hoppers either way", () => {
  const doc = fakeDocument();
  const model = modelFor({ layerCount: 3 });
  const whole = render.renderStage(model, { document: doc });
  const bare = render.renderStage(model, { document: doc, showExtruders: false });
  assert.equal(whole.getAttribute("data-extruders"), "shown");
  assert.equal(bare.getAttribute("data-extruders"), "hidden");
  assert.equal(render.renderStage(model, { document: doc, showExtruders: true }).getAttribute("data-extruders"), "shown");
  assert.equal(whole.querySelectorAll("[data-role='extruder']").length, 3);
  assert.equal(whole.querySelectorAll("[data-role='feed']").length, 3);
  assert.equal(bare.querySelectorAll("[data-role='extruder']").length, 0);
  assert.equal(bare.querySelectorAll("[data-role='feed']").length, 0);
  assert.equal(bare.querySelectorAll("[data-station-target='extruder']").length, 0, "no target for a machine that is not drawn");
  assert.equal(bare.querySelectorAll("[data-role='mixer']").length, 3);
  assert.equal(bare.querySelectorAll("[data-role='hopper']").length, whole.querySelectorAll("[data-role='hopper']").length);
  const box = svg => svg.getAttribute("viewBox").split(" ").map(Number);
  assert.equal(box(bare)[2], box(whole)[2], "the canvas keeps its width");
  assert.equal(box(bare)[3], layoutModule.DIMENSIONS.heightWithoutExtruders);
  assert.equal(box(whole)[3], layoutModule.DIMENSIONS.height);
  // Every hopper is the same element either way: the same attributes,
  // the same children.
  const hoppers = svg => svg.querySelectorAll("[data-role='hopper']").map(h => JSON.stringify([h.attributes, h.children.map(c => c.attributes)]));
  assert.deepEqual(hoppers(bare), hoppers(whole));
  // The bank's declared train is the blender's box.
  for (const layer of bare.querySelectorAll("[data-role='layer']")) {
    const [, y, , height] = layer.getAttribute("data-object-train").split(" ").map(Number);
    assert.ok(y + height <= layoutModule.DIMENSIONS.heightWithoutExtruders);
  }
});

test("a mounted stage is patched under the same preference it was drawn with, and mountStage stamps the attribute", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  const model = modelFor({ layerCount: 3 });
  const state = {};
  for (const layer of model.layers) for (const h of layer.hoppers) state[`${layer.id}:${h.index}`] = { assigned: h.index < 2, pct: h.index < 2 ? 50 : 0 };
  const svg = render.mountStage(mount, model, { document: doc, hopperState: state, showExtruders: false });
  assert.equal(svg.getAttribute("data-extruders"), "hidden");
  state["B:0"] = { assigned: true, pct: 50, track: true };
  const touched = render.patchStage(mount, model, { document: doc, hopperState: state, showExtruders: false });
  assert.ok(touched && touched.hoppers >= 1, "the value patch still finds its hoppers on the shorter canvas");
  assert.equal(mount.querySelectorAll("[data-role='extruder']").length, 0, "a patch draws no extruder into a stage without them");
  assert.equal(svg.getAttribute("data-extruders"), "hidden");
});

/* ----------------------------------------------------------------------
 *   The Appearance page
 * -------------------------------------------------------------------- */

const pageFor = (controller, themeController) => appearance.section.create(fakeDocument(), {
  theme: themeController || theme.create(fakeDocument().createElement("div"), storage()),
  themes: theme.THEMES, families: theme.FAMILIES, display: controller
});

test("the Appearance heading carries the switch after the theme copy: a labelled role=switch, I and O on its track, off by default", () => {
  const controller = display.create(fakeDocument().createElement("div"), storage());
  const page = pageFor(controller);
  const intro = page.element.querySelector(".station-appearance__intro");
  assert.deepEqual(intro.children.map(n => n.getAttribute("class")),
    ["station-appearance__title", "station-appearance__copy", "station-appearance__switch"]);
  const control = intro.children[2];
  assert.equal(control.tagName, "BUTTON");
  assert.equal(control.getAttribute("type"), "button");
  assert.equal(control.getAttribute("role"), "switch");
  assert.equal(control.getAttribute("aria-checked"), "false");
  assert.equal(control.getAttribute("data-preference"), "show-extruders");
  assert.equal(control.querySelector(".station-appearance__switch-label").textContent, "Show Extruders");
  const track = control.querySelector(".station-appearance__switch-track");
  assert.equal(track.getAttribute("aria-hidden"), "true");
  assert.deepEqual(track.children.map(n => [n.getAttribute("class"), n.textContent]), [
    ["station-appearance__switch-mark station-appearance__switch-mark--on", "I"],
    ["station-appearance__switch-mark station-appearance__switch-mark--off", "O"],
    ["station-appearance__switch-knob", ""]
  ]);
  // The gallery is untouched by it: the same twelve tiles.
  assert.equal(page.element.querySelectorAll(".station-appearance__tile").length, theme.THEMES.length);
  assert.equal(page.element.querySelector(".station-appearance__gallery").getAttribute("aria-label"), "Station theme");
});

test("clicking the switch asks the controller and reads its state back; a change from elsewhere moves the switch; the theme is untouched", () => {
  const saved = storage();
  const controller = display.create(fakeDocument().createElement("div"), saved);
  const themeController = theme.create(fakeDocument().createElement("div"), storage());
  themeController.setTheme("gruvbox-dark");
  const page = pageFor(controller, themeController);
  const control = page.element.querySelector(".station-appearance__switch");
  control.click();
  assert.equal(controller.getShowExtruders(), true);
  assert.equal(control.getAttribute("aria-checked"), "true");
  assert.deepEqual(JSON.parse(saved.value(display.STORAGE_KEY)), { showExtruders: true });
  control.click();
  assert.equal(controller.getShowExtruders(), false);
  assert.equal(control.getAttribute("aria-checked"), "false");
  // Another page over the same controller: its switch follows.
  const other = pageFor(controller, themeController).element.querySelector(".station-appearance__switch");
  controller.setShowExtruders(true);
  assert.equal(other.getAttribute("aria-checked"), "true");
  assert.equal(control.getAttribute("aria-checked"), "true");
  assert.equal(themeController.getTheme(), "gruvbox-dark", "the switch is not a theme");
  assert.equal(page.element.querySelector("[data-theme-choice='gruvbox-dark']").getAttribute("aria-checked"), "true");
  // A page restored over a saved "on" starts on.
  assert.equal(pageFor(display.create(fakeDocument().createElement("div"), saved)).element
    .querySelector(".station-appearance__switch").getAttribute("aria-checked"), "true");
});

test("without a display controller the page is the gallery alone, as it was", () => {
  const page = appearance.section.create(fakeDocument(), { theme: theme.create(fakeDocument().createElement("div"), storage()), themes: theme.THEMES, families: theme.FAMILIES });
  assert.equal(page.element.querySelector(".station-appearance__switch"), null);
  assert.equal(page.element.querySelector(".station-appearance__intro").children.length, 2);
  const half = appearance.section.create(fakeDocument(), { theme: null, themes: theme.THEMES, families: theme.FAMILIES, display: { getShowExtruders: () => true } });
  assert.equal(half.element.querySelector(".station-appearance__switch").getAttribute("aria-checked"), "true",
    "a controller without subscribe still drives the switch");
});

/* ----------------------------------------------------------------------
 *   A booted Station
 * -------------------------------------------------------------------- */

function hostScripts() {
  const host = read("station-host.js");
  const block = host.slice(host.indexOf("const SCRIPTS = ["), host.indexOf("];", host.indexOf("const SCRIPTS = [")));
  const files = [...block.matchAll(/"(station\/[^"]+\.js)"/g)].map(m => m[1]);
  assert.ok(files.includes("station/station.js"));
  return files.filter(file => file !== "station/station.js");
}
const SHARED = [
  "hookup-sources.js", "line-identity.js", "scheduling.js", "workspace-configuration-payloads.js",
  "station-state-bridge.js", "station-command-contract.js", "station-command-bridge.js",
  "station-connection-bridge.js", "station-recipes-bridge.js", "station-weight-profiles-bridge.js",
  "station-theme.js", "station-display.js"
];

function snapshot(overrides) {
  const line = Object.assign({ lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard", linked: true }, overrides || {});
  return {
    line,
    job: { lineRate: 900, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    smartHoppers: { enabled: false, geometryMode: "cylindrical", circumference: 40 },
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layerPct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
        weight: 0, usableHeight: 30, usableGallons: 0, effectiveWeight: 0, smartWeight: null, track: false, pumpOff: false
      }))
    })),
    revision: 1
  };
}

/* Station booted as the production host boots it - the host's own script
 * list, the state bridge connected - over a fake window whose storage
 * holds what a test wants the device to have saved. The display
 * preferences are initialized on the host root the way station-host.js
 * does it, and the boot file finds them there. */
function boot(options) {
  const settings = options || {};
  focused = null;
  const doc = fakeDocument();
  const saved = storage(settings.saved);
  const timers = [];
  const window = {
    document: doc,
    location: { href: "https://resin.tools/?view=station", search: "?view=station" },
    matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame: fn => { timers.push({ fn, ms: 0 }); return timers.length; },
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    URL, Promise, console, Math, Date, Number, String, Object, Array, JSON, Error, Set, Map, WeakMap, Symbol, RegExp,
    parseInt, parseFloat, isFinite, isNaN, Intl,
    navigator: { userAgent: "node" },
    localStorage: saved
  };
  window.window = window;
  window.globalThis = window;
  window.self = window;
  doc.location = window.location;
  const context = vm.createContext(window);
  for (const file of SHARED.concat(hostScripts())) new vm.Script(read(file), { filename: file }).runInContext(context);
  // The host root, with the two controllers on it as station-host.js puts them.
  const host = doc.createElement("div");
  host.setAttribute("data-station-host", "");
  host.setAttribute("data-station-app", "");
  host.className = "station-root";
  host.stationTheme = window.PolynStationTheme.initialize(host, window);
  host.stationDisplay = window.PolynStationDisplay.initialize(host, window);
  doc.body.appendChild(host);
  const snap = snapshot(settings.line);
  const handle = window.PolynStationStateBridge.connect({ read: () => snap });
  new vm.Script(read("station/station.js"), { filename: "station/station.js" }).runInContext(context);
  const machine = doc.querySelector("[data-station-mount='machine']");
  const launcher = doc.querySelector(".station-handbook__launcher");
  assert.ok(machine && launcher, "Station booted with its stage and Handbook");
  return {
    doc, host, saved, snap, handle, machine, launcher,
    display: host.stationDisplay,
    stage: () => machine.querySelector(".station-machine__stage"),
    extruders: () => machine.querySelectorAll("[data-role='extruder']").length,
    openAppearance() {
      launcher.click();
      const tab = doc.querySelectorAll(".station-handbook__tab").find(n => n.textContent === "Appearance");
      assert.ok(tab, "the Handbook offers Appearance");
      tab.click();
      return doc.querySelector(".station-appearance__switch");
    }
  };
}

test("a booted Station draws no extruders by default, and the switch on its Appearance page turns them on and off, redrawing the stage each time", () => {
  const s = boot();
  assert.equal(s.host.getAttribute("data-extruders"), "hidden");
  assert.equal(s.stage().getAttribute("data-extruders"), "hidden");
  assert.equal(s.extruders(), 0);
  assert.equal(s.machine.querySelectorAll("[data-role='mixer']").length, 3);
  const before = s.stage();
  const control = s.openAppearance();
  assert.ok(control, "the switch is on the page");
  assert.equal(control.getAttribute("aria-checked"), "false");
  control.click();
  assert.equal(s.display.getShowExtruders(), true);
  assert.equal(control.getAttribute("aria-checked"), "true");
  assert.equal(s.host.getAttribute("data-extruders"), "shown");
  assert.notEqual(s.stage(), before, "the stage was redrawn");
  assert.equal(s.stage().getAttribute("data-extruders"), "shown");
  assert.equal(s.extruders(), 3);
  assert.deepEqual(JSON.parse(s.saved.value(display.STORAGE_KEY)), { showExtruders: true });
  // The Handbook stayed open on its page across the redraw.
  assert.equal(s.launcher.getAttribute("aria-expanded"), "true");
  assert.equal(s.doc.querySelector(".station-appearance__switch"), control, "the page was not rebuilt");
  control.click();
  assert.equal(s.extruders(), 0);
  assert.equal(s.stage().getAttribute("data-extruders"), "hidden");
  // The job was not touched: no command, the same snapshot, the same revision.
  assert.equal(s.snap.revision, 1);
});

test("a device that saved the extruders on boots with them drawn, and a publish patches or redraws under the same preference", () => {
  const s = boot({ saved: { [display.STORAGE_KEY]: JSON.stringify({ showExtruders: true }) } });
  assert.equal(s.extruders(), 3);
  assert.equal(s.stage().getAttribute("data-extruders"), "shown");
  // A value publish: patched in place, the extruders stand.
  const stage = s.stage();
  s.snap.layers[1].hoppers[0].track = true;
  s.snap.revision += 1;
  s.handle.publish();
  assert.equal(s.stage(), stage, "a value change is a patch, not a redraw");
  assert.equal(s.extruders(), 3);
  // A structural publish: redrawn, still with them.
  s.snap.layers[2].hoppers[2].resinName = "NEW";
  s.snap.layers[2].hoppers[2].pct = 10;
  s.snap.layers[2].hoppers[1].pct = 30;
  s.snap.line = Object.assign({}, s.snap.line, { displayName: "Line 9 renamed", layerCount: 3 });
  s.snap.revision += 1;
  s.handle.publish();
  assert.equal(s.extruders(), 3);
  assert.equal(s.stage().getAttribute("data-extruders"), "shown");
});

/* ----------------------------------------------------------------------
 *   Wiring
 * -------------------------------------------------------------------- */

test("both hosts load the preference beside the theme and initialize it on the Station root; the boot file reads it there and asks the renderer on every render and patch", () => {
  const index = read("index.html");
  const harness = read("station/station.html");
  const host = read("station-host.js");
  const boot = read("station/station.js");
  assert.match(index, /<script src="station-display\.js\?v=[^"]+" defer><\/script>/);
  assert.ok(index.indexOf("station-display.js") < index.indexOf("station-host.js?"), "the host finds the preference loaded");
  assert.match(harness, /<script src="\.\.\/station-display\.js\?v=[^"]+"><\/script>/);
  assert.match(harness, /document\.documentElement\.stationDisplay = globalThis\.PolynStationDisplay\.initialize\(document\.documentElement, globalThis\)/);
  assert.match(host, /host\.stationDisplay = display && typeof display\.initialize === "function"\s*\?\s*display\.initialize\(host, root\)\s*:\s*null;/);
  assert.match(boot, /displayController = container\.stationDisplay \|\| \(doc\.documentElement && doc\.documentElement\.stationDisplay\) \|\| null;/);
  // Every render and every patch is asked for the same preference.
  assert.equal((boot.match(/showExtruders: showExtruders\(\)/g) || []).length, 3, "a render site does not carry the preference");
  assert.equal((boot.match(/render\.(mountStage|patchStage)\(/g) || []).length, 3);
  assert.match(boot, /display: displayController,/);
  // The preference module is as inert as the theme's: no DOM, no network.
  const source = read("station-display.js");
  for (const pattern of [/\bdocument\b/, /\bfetch\s*\(/, /supabase/i, /XMLHttpRequest/, /addEventListener/]) {
    assert.doesNotMatch(source, pattern, `station-display.js reaches outside itself (${pattern})`);
  }
  // The stylesheet: the switch has its rules, and the sheet still has no breakpoint.
  const css = read("station/styles/components/handbook.css");
  for (const cls of ["station-appearance__switch", "station-appearance__switch-track", "station-appearance__switch-knob", "station-appearance__switch-mark"]) {
    assert.ok(css.includes(`.${cls}`), `handbook.css does not style .${cls}`);
  }
  assert.match(css, /\.station-appearance__switch\[aria-checked="true"\] \.station-appearance__switch-knob/);
});
