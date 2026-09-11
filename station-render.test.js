"use strict";

/* What the renderer owns once the drawing itself has moved out.
 *
 * The machine's composition - layer counts, hopper counts, positioning,
 * angles, interaction targets - is asserted in station-machine.test.js against
 * the layout and the parts. What is left here is this file's own job: turning
 * a model into a mounted stage, and doing something sensible when there is no
 * model to mount.
 *
 * The repo has no jsdom, which is why station-render.js takes its document as
 * an argument. The fake below implements only what the renderer touches.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const render = require("./station/station-render.js");
const model = require("./station/station-line-model.js");

/* ----------------------------------------------------------------------
 *   A document, just big enough
 * -------------------------------------------------------------------- */

function makeNode(name) {
  return {
    nodeName: name,
    attributes: {},
    children: [],
    textContent: "",
    parentNode: null,
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null;
      return child;
    }
  };
}

function fakeDocument() {
  return {
    createElement: name => makeNode(name),
    createElementNS: (ns, name) => {
      const node = makeNode(name);
      node.namespaceURI = ns;
      return node;
    }
  };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function allWith(node, attribute, value) {
  const found = [];
  walk(node, current => {
    const actual = current.getAttribute(attribute);
    if (actual === null) return;
    if (value === undefined || actual === value) found.push(current);
  });
  return found;
}

function classesOf(node) {
  return String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

function allWithClass(node, className) {
  const found = [];
  walk(node, current => { if (classesOf(current).includes(className)) found.push(current); });
  return found;
}

function stageFor(config) {
  return render.renderStage(model.buildLineModel(config), { document: fakeDocument() });
}

function literal(overrides) {
  return Object.assign({
    lineNumber: 1,
    displayName: "Test line",
    layerCount: 3,
    layerAPosition: "outside",
    hopperNamingMode: "standard",
    hopperGeometry: "cylindrical"
  }, overrides);
}

/* ----------------------------------------------------------------------
 *   Mounting
 * -------------------------------------------------------------------- */

test("mountStage replaces previous contents rather than appending a second machine", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  render.mountStage(mount, model.buildLineModel(literal({ layerCount: 5 })), { document: doc });
  render.mountStage(mount, model.buildLineModel(literal({ layerCount: 3 })), { document: doc });
  assert.equal(mount.children.length, 1);
  assert.equal(allWith(mount, "data-role", "layer").length, 3);
  assert.equal(mount.getAttribute("data-layer-count"), "3");
});

test("the mount advertises the focused layer, and stops advertising it on exit", () => {
  // The attribute is how anything outside the SVG - a test, a stylesheet, a
  // later inspector - can tell the stage is expanded without reading into it.
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  const built = model.buildLineModel(literal({ layerCount: 3 }));

  render.mountStage(mount, built, { document: doc, focusLayer: "B" });
  assert.equal(mount.getAttribute("data-focus-layer"), "B");

  render.mountStage(mount, built, { document: doc });
  assert.equal(mount.getAttribute("data-focus-layer"), null);
});

test("a null model mounts an explicit empty state, not a blank or invented machine", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  render.mountStage(mount, null, { document: doc });
  assert.equal(mount.getAttribute("data-layer-count"), "0");
  assert.equal(allWith(mount, "data-role", "layer").length, 0);
  assert.match(mount.children[0].textContent, /cannot be drawn/);
});

test("mounting over an expanded stage clears the focus attribute with it", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  render.mountStage(mount, model.buildLineModel(literal({ layerCount: 3 })), { document: doc, focusLayer: "A" });
  render.mountStage(mount, null, { document: doc });
  assert.equal(mount.getAttribute("data-focus-layer"), null);
});

/* ----------------------------------------------------------------------
 *   Metrics
 * -------------------------------------------------------------------- */

test("stageMetrics describes the stage without building it", () => {
  const metrics = render.stageMetrics(model.buildLineModel(literal({ layerCount: 5 })));
  assert.equal(metrics.bankCount, 5);
  assert.ok(metrics.width > 0 && metrics.height > 0);
  assert.ok(metrics.rowWidth > 0);
  assert.equal(metrics.focusLayer, null);
  assert.equal(render.stageMetrics(model.buildLineModel(literal({})), { focusLayer: "B" }).focusLayer, "B");
});

test("hopperStateClasses names the same states the hopper component emits", () => {
  assert.deepEqual(render.hopperStateClasses(null), ["station-hopper"]);
  assert.deepEqual(render.hopperStateClasses({ track: true }), ["station-hopper", "is-tracking"]);
  assert.deepEqual(render.hopperStateClasses({ pumpOff: true }), ["station-hopper", "is-pump-off"]);
  assert.deepEqual(render.hopperStateClasses({ assigned: false }), ["station-hopper", "is-unassigned"]);
});

test("renderStage refuses to work without a document rather than guessing one", () => {
  assert.throws(() => render.renderStage(model.buildLineModel(literal({})), { document: null }),
    /no document available/);
});
