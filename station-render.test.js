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
    },
    replaceChild(fresh, old) {
      const at = this.children.indexOf(old);
      if (at < 0) throw new Error("replaceChild: not a child");
      this.children[at] = fresh;
      fresh.parentNode = this;
      old.parentNode = null;
      return old;
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

/* ----------------------------------------------------------------------
 *   Patching a mounted stage
 * -------------------------------------------------------------------- */

/* A value-only publish must update the drawing that is already mounted,
 * not rebuild it: rebuilding replaces the <foreignObject> and the editor
 * in it, which is what destroyed an open resin search. What is pinned
 * here is that the patch touches what changed, leaves the workspace node
 * alone, and lands on the same drawing a fresh render would. */

function runtimeFor(overrides) {
  const state = {};
  for (const layer of ["A", "B", "C"]) {
    for (let index = 0; index < 6; index++) {
      state[`${layer}:${index}`] = { track: false, pumpOff: false, assigned: index < 2, resinName: index < 2 ? `R-${layer}${index}` : "",
        pct: index === 0 ? 60 : index === 1 ? 40 : 0, usableHeight: 30, source: index === 0 ? "SILO 1" : "" };
    }
  }
  return Object.assign(state, overrides || {});
}

const LAYER_STATE = { A: { layerPct: 25 }, B: { layerPct: 50 }, C: { layerPct: 25 } };

function serialize(node) {
  const attributes = Object.assign({}, node.attributes);
  return {
    name: node.nodeName,
    attributes,
    text: node.textContent,
    children: node.children.map(serialize)
  };
}

function hopperNodes(root) {
  return allWith(root, "data-role", "hopper");
}

function mountFocused(doc, state, extra) {
  const mount = doc.createElement("div");
  const editor = doc.createElement("div");
  editor.setAttribute("data-role", "focus-editor");
  render.mountStage(mount, model.buildLineModel(literal({ layerCount: 3 })), Object.assign({
    document: doc, hopperState: state, layerState: LAYER_STATE, focusLayer: "B", workspace: editor, stageAspect: 1.6
  }, extra || {}));
  return { mount, editor };
}

test("patchStage keeps the mounted <svg> and its <foreignObject>: a value change does not rebuild the stage", () => {
  const doc = fakeDocument();
  const before = runtimeFor();
  const { mount, editor } = mountFocused(doc, before);
  const svg = mount.children[0];
  const foreign = allWith(svg, "class", "station-workspace__editor")[0];
  assert.ok(foreign && foreign.nodeName === "foreignObject");
  assert.equal(foreign.children[0], editor);

  const after = runtimeFor({ "B:0": Object.assign({}, before["B:0"], { track: true, pct: 55, resinName: "R-NEW" }) });
  const result = render.patchStage(mount, model.buildLineModel(literal({ layerCount: 3 })), {
    document: doc, hopperState: after, layerState: LAYER_STATE, focusLayer: "B", stageAspect: 1.6
  });
  assert.deepEqual(result, { hoppers: 1, layers: 3 });
  assert.equal(mount.children.length, 1);
  assert.equal(mount.children[0], svg, "the stage was replaced");
  assert.equal(allWith(svg, "class", "station-workspace__editor")[0], foreign, "the foreignObject was replaced");
  assert.equal(foreign.children[0], editor, "the editor element was replaced");
});

test("patchStage redraws only the hoppers whose runtime changed, and their classes and readouts follow", () => {
  const doc = fakeDocument();
  const before = runtimeFor();
  const { mount } = mountFocused(doc, before);
  const untouched = hopperNodes(mount).filter(n => n.getAttribute("data-layer") === "A");
  const b0Before = hopperNodes(mount).find(n => n.getAttribute("data-layer") === "B" && n.getAttribute("data-hopper-index") === "0");
  assert.ok(!classesOf(b0Before).includes("is-tracking"));

  const after = runtimeFor({
    "B:0": Object.assign({}, before["B:0"], { track: true, pumpOff: true, pct: 55, resinName: "R-NEW", source: "BOX 9" }),
    "C:2": { track: false, pumpOff: false, assigned: true, resinName: "R-C2", pct: 5, usableHeight: 30, source: "" }
  });
  render.patchStage(mount, model.buildLineModel(literal({ layerCount: 3 })), {
    document: doc, hopperState: after, layerState: LAYER_STATE, focusLayer: "B", stageAspect: 1.6
  });
  for (const node of untouched) {
    assert.ok(hopperNodes(mount).includes(node), "an unchanged hopper was redrawn");
  }
  const b0 = hopperNodes(mount).find(n => n.getAttribute("data-layer") === "B" && n.getAttribute("data-hopper-index") === "0");
  assert.notEqual(b0, b0Before);
  assert.ok(classesOf(b0).includes("is-tracking"));
  assert.ok(classesOf(b0).includes("is-pump-off"));
  assert.equal(allWith(b0, "data-role", "hopper-pump")[0].getAttribute("data-pump"), "off");
  assert.deepEqual(allWithClass(b0, "station-hopper__pct").map(n => n.textContent), ["55%"]);
  assert.deepEqual(allWithClass(b0, "station-hopper__source").map(n => n.textContent), ["BOX 9"]);
  const c2 = hopperNodes(mount).find(n => n.getAttribute("data-layer") === "C" && n.getAttribute("data-hopper-index") === "2");
  assert.ok(!classesOf(c2).includes("is-unassigned"), "a newly assigned hopper still reads unassigned");
});

test("patchStage updates a layer's running state and its extruder share in place", () => {
  const doc = fakeDocument();
  const before = runtimeFor();
  const { mount } = mountFocused(doc, before);
  const layerC = allWith(mount, "data-role", "layer").find(n => n.getAttribute("data-layer") === "C");
  assert.ok(classesOf(layerC).includes("is-running"));
  const emptied = runtimeFor();
  for (let index = 0; index < 6; index++) emptied[`C:${index}`] = Object.assign({}, emptied[`C:${index}`], { assigned: false, resinName: "", pct: 0, source: "" });
  render.patchStage(mount, model.buildLineModel(literal({ layerCount: 3 })), {
    document: doc, hopperState: emptied, layerState: { A: { layerPct: 30 }, B: { layerPct: 70 }, C: { layerPct: 0 } }, focusLayer: "B", stageAspect: 1.6
  });
  assert.equal(allWith(mount, "data-role", "layer").find(n => n.getAttribute("data-layer") === "C"), layerC, "the layer group was replaced");
  assert.ok(!classesOf(layerC).includes("is-running"));
  const shares = {};
  for (const layer of allWith(mount, "data-role", "layer")) {
    shares[layer.getAttribute("data-layer")] = allWithClass(layer, "station-extruder__pct")[0].textContent;
  }
  assert.deepEqual(shares, { A: "30%", B: "70%", C: "—" });
});

test("a patched stage and a fresh render of the same inputs are the same drawing", () => {
  const doc = fakeDocument();
  const before = runtimeFor();
  const after = runtimeFor({
    "A:1": Object.assign({}, before["A:1"], { track: true, pct: 45, resinName: "R-A1-NEW" }),
    "B:0": Object.assign({}, before["B:0"], { pumpOff: true, source: "" }),
    "C:3": { track: false, pumpOff: false, assigned: true, resinName: "R-C3", pct: 12, usableHeight: 30, source: "SILO 4" }
  });
  const layerAfter = { A: { layerPct: 40 }, B: { layerPct: 40 }, C: { layerPct: 20 } };
  const { mount } = mountFocused(doc, before, { selectedHopper: "B1" });
  render.patchStage(mount, model.buildLineModel(literal({ layerCount: 3 })), {
    document: doc, hopperState: after, layerState: layerAfter, focusLayer: "B", selectedHopper: "B1", stageAspect: 1.6
  });
  const fresh = render.renderStage(model.buildLineModel(literal({ layerCount: 3 })), {
    document: doc, hopperState: after, layerState: layerAfter, focusLayer: "B", selectedHopper: "B1", stageAspect: 1.6
  });
  const patchedLayers = allWith(mount, "data-role", "layer").map(serialize);
  const freshLayers = allWith(fresh, "data-role", "layer").map(serialize);
  assert.deepEqual(patchedLayers, freshLayers);
});

test("patchStage carries the pointer's highlight onto a redrawn hopper", () => {
  const doc = fakeDocument();
  const before = runtimeFor();
  const { mount } = mountFocused(doc, before);
  const b1 = hopperNodes(mount).find(n => n.getAttribute("data-layer") === "B" && n.getAttribute("data-hopper-index") === "1");
  b1.setAttribute("class", `${b1.getAttribute("class")} is-highlighted`);
  render.patchStage(mount, model.buildLineModel(literal({ layerCount: 3 })), {
    document: doc, hopperState: runtimeFor({ "B:1": Object.assign({}, before["B:1"], { pct: 41 }) }), layerState: LAYER_STATE, focusLayer: "B", stageAspect: 1.6
  });
  const redrawn = hopperNodes(mount).find(n => n.getAttribute("data-layer") === "B" && n.getAttribute("data-hopper-index") === "1");
  assert.notEqual(redrawn, b1);
  assert.ok(classesOf(redrawn).includes("is-highlighted"));
});

test("patchStage refuses a stage whose structure does not match, so the caller renders instead", () => {
  const doc = fakeDocument();
  const { mount } = mountFocused(doc, runtimeFor());
  assert.equal(render.patchStage(mount, model.buildLineModel(literal({ layerCount: 5 })), { document: doc, hopperState: runtimeFor() }), null);
  assert.equal(render.patchStage(mount, null, { document: doc }), null);
  assert.equal(render.patchStage(doc.createElement("div"), model.buildLineModel(literal({ layerCount: 3 })), { document: doc }), null);
  // And an unchanged state patches nothing.
  assert.deepEqual(render.patchStage(mount, model.buildLineModel(literal({ layerCount: 3 })), {
    document: doc, hopperState: runtimeFor(), layerState: LAYER_STATE, focusLayer: "B", stageAspect: 1.6
  }), { hoppers: 0, layers: 3 });
});
