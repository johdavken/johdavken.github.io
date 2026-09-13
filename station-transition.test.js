"use strict";

/* The transition between the normal row and the focused workspace
 * (station/station-transition.js): a FLIP over two renders, driven by the
 * Web Animations API, with a four-state machine around it. Everything a
 * browser would supply - animations, computed style, screen matrices - is
 * faked here, so what is tested is the geometry and the state machine, not
 * a browser.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const transition = require("./station/station-transition.js");
const render = require("./station/station-render.js");
const layoutModule = require("./station/station-machine-layout.js");
const model = require("./station/station-line-model.js");

/* ----------------------------------------------------------------------
 *   A fake DOM with just enough selector support, and fake animations
 * -------------------------------------------------------------------- */

function makeNode(name) {
  const node = {
    nodeName: name,
    attributes: {},
    children: [],
    textContent: "",
    animations: [],
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      return child;
    },
    querySelectorAll(selector) {
      const out = [];
      walk(this, n => { if (n !== this && matches(n, selector)) out.push(n); });
      return out;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    getAnimations() { return this.animations.filter(a => !a.cancelled); },
    classList: {
      add(name) { const set = classSet(node); set.add(name); node.attributes.class = [...set].join(" "); },
      remove(name) { const set = classSet(node); set.delete(name); node.attributes.class = [...set].join(" "); },
      contains(name) { return classSet(node).has(name); },
      [Symbol.iterator]() { return classSet(node)[Symbol.iterator](); }
    }
  };
  return node;
}

function classSet(node) {
  return new Set(String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean));
}

function matches(node, selector) {
  const attr = selector.match(/^\[([a-z-]+)='([^']+)'\]$/);
  if (attr) return node.getAttribute(attr[1]) === attr[2];
  const cls = selector.match(/^\.([a-z0-9_-]+)$/i);
  if (cls) return classSet(node).has(cls[1]);
  throw new Error(`unsupported selector ${selector}`);
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

const fakeDocument = () => ({
  createElement: name => makeNode(name),
  createElementNS: (ns, name) => { const n = makeNode(name); n.namespaceURI = ns; return n; }
});

/* A recording Animation: finishes when told to. */
function fakeAnimation(element, keyframes, options) {
  let resolve;
  const animation = {
    element, keyframes, options,
    playbackRate: 1,
    currentTime: 0,
    reversed: false,
    finishedFlag: false,
    cancelled: false,
    paused: false,
    effect: { getTiming: () => ({ delay: options.delay || 0, duration: options.duration }) },
    finished: new Promise(r => { resolve = r; }),
    finish() { this.finishedFlag = true; resolve(this); },
    reverse() { this.reversed = !this.reversed; this.playbackRate = -this.playbackRate; },
    cancel() { this.cancelled = true; },
    pause() { this.paused = true; },
    play() { this.paused = false; }
  };
  element.animations.push(animation);
  return animation;
}

/* Computed style: the class states the stylesheet would give a layer, and
 * - as a browser reports it - the value a finished fill-forwards animation
 * is holding. */
const computedStyle = element => ({
  opacity: (() => {
    const held = (element.animations || []).filter(a => !a.cancelled && a.finishedFlag && a.options.fill === "forwards" && a.keyframes[1].opacity !== undefined).pop();
    if (held) return String(held.keyframes[1].opacity);
    return classSet(element).has("is-dimmed") ? "0" : "1";
  })(),
  getPropertyValue: name => ({
    "--station-motion-ack": "80ms", "--station-motion-move": "300ms", "--station-motion-lead": "40ms",
    "--station-motion-settle": "120ms", "--station-motion-ease": "cubic-bezier(0.2, 0.8, 0.2, 1)"
  })[name] || ""
});

function literal(overrides) {
  return Object.assign({
    lineKey: "test", displayName: "Test line", layerCount: 5, layerAPosition: "outside",
    hopperNamingMode: "standard", hopperCount: 6
  }, overrides || {});
}

/* A stage with a controller round it, and the seams to drive it. */
function harness(config, options) {
  const settings = options || {};
  const doc = fakeDocument();
  const mount = makeNode("section");
  mount.setAttribute("class", "station-machine");
  const lineModel = model.buildLineModel(literal(config));
  const renders = [];
  const animated = [];
  // Every stage gets the identity screen matrix unless the test says otherwise.
  const ctm = settings.ctm || (() => ({ a: 1, d: 1, e: 0, f: 0 }));
  const hopperState = settings.hopperState || { "A:0": { resinName: "HX204", pct: 60 }, "D:0": { resinName: "LD105", pct: 40 } };
  const controller = transition.createController({
    mount,
    render: (focusLayer, extra) => {
      renders.push({ focusLayer, raiseLayer: extra && extra.raiseLayer });
      const svg = render.mountStage(mount, lineModel, { document: doc, focusLayer, hopperState, raiseLayer: extra && extra.raiseLayer });
      svg.getScreenCTM = () => ctm(svg);
      // The agitator of every running layer is animating, as the stylesheet
      // would have it, at whatever phase the previous render handed over.
      for (const agitator of svg.querySelectorAll(".station-mixer__agitator")) {
        const running = agitator.parent && agitator.parent.parent && agitator.parent.parent.parent && classSet(layerOf(agitator)).has("is-running");
        if (running) agitator.animations.push({ currentTime: 0, options: { css: true } });
      }
      return svg;
    },
    computedStyle,
    animate: (element, keyframes, opts) => { const a = fakeAnimation(element, keyframes, opts); animated.push(a); return a; },
    reducedMotion: () => !!settings.reducedMotion,
    onChange: state => changes.push(state.phase)
  });
  const changes = [];
  return { controller, mount, renders, animated, changes, svg: () => mount.children[0] };
}

function layerOf(node) {
  let current = node;
  while (current && current.getAttribute("data-role") !== "layer") current = current.parent;
  return current;
}

/* Finish everything in flight and let the promises settle. */
async function land(h) {
  for (let round = 0; round < 4; round++) {
    for (const a of h.controller.animations()) if (!a.finishedFlag) a.finish();
    await new Promise(r => setImmediate(r));
  }
}

const transformsOf = h => h.animated.filter(a => a.keyframes[0].transform !== undefined && !a.cancelled);
const parseTransform = value => {
  const m = value.match(/^translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)$/);
  return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
};

/* ----------------------------------------------------------------------
 *   Geometry
 * -------------------------------------------------------------------- */

test("the FLIP transform lays the destination box exactly over the source box", () => {
  const source = { x: 100, y: 200, width: 50, height: 80 };
  const destination = { x: 300, y: 40, width: 125, height: 200 };
  const delta = transition.flip(source, destination);
  assert.equal(delta.s, 0.4);
  // Every corner of the destination, through the transform, is the source's.
  const map = ([x, y]) => [delta.s * x + delta.tx, delta.s * y + delta.ty];
  assert.deepEqual(map([destination.x, destination.y]), [source.x, source.y]);
  assert.deepEqual(map([destination.x + destination.width, destination.y + destination.height]),
    [source.x + source.width, source.y + source.height]);
  // Uniform: one scale, so the shape cannot change.
  assert.equal(transition.transformValue(delta), "translate(-20px, 184px) scale(0.4)");
});

test("a box travels between two canvases through the screen, so a canvas that changes scale is no special case", () => {
  // Old canvas drawn at 0.5px per unit, offset 10; new canvas at 0.8px per unit, offset 40.
  const from = { scale: 0.5, x: 10, y: 10 };
  const to = { scale: 0.8, x: 40, y: 0 };
  const box = { x: 100, y: 200, width: 60, height: 90 };
  const moved = transition.rebox(box, from, to);
  // On screen the box was at (60, 110) size (30, 45); in the new canvas that is ...
  assert.deepEqual(moved, { x: (60 - 40) / 0.8, y: 110 / 0.8, width: 30 / 0.8, height: 45 / 0.8 });
  // With identical canvases nothing changes.
  assert.deepEqual(transition.rebox(box, from, from), box);
});

test("the renderer declares every bank's two objects, and the transition reads exactly those", () => {
  const h = harness({ layerCount: 3 });
  h.controller.refresh(null);
  const boxes = transition.objectBoxes(h.svg());
  assert.deepEqual(Object.keys(boxes).sort(), ["A", "B", "C"]);
  const layout = layoutModule.computeLayout(model.buildLineModel(literal({ layerCount: 3 })), {});
  for (const bank of layout.banks) {
    for (const object of ["cluster", "train"]) {
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(boxes[bank.id][object][key] - bank.objects[object][key]) < 0.01, `${bank.id} ${object} ${key}`);
      }
    }
  }
  assert.equal(transition.parseBox("1 2 x 4"), null);
});

test("timing comes from the tokens, with the module's own numbers as the fallback", () => {
  const read = transition.readTiming(makeNode("div"), computedStyle);
  assert.deepEqual(read, { ack: 80, move: 300, lead: 40, settle: 120, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  assert.deepEqual(transition.readTiming(makeNode("div"), () => ({ getPropertyValue: () => "" })), transition.DEFAULT_TIMING);
  assert.deepEqual(transition.readTiming(null, null), transition.DEFAULT_TIMING);
  // Seconds are understood too.
  assert.equal(transition.readTiming(makeNode("div"), () => ({ getPropertyValue: n => (n === "--station-motion-move" ? "0.25s" : "") })).move, 250);
  // And the stylesheet agrees with the fallback, so the two cannot drift.
  const tokens = fs.readFileSync(path.join(ROOT, "station/styles/tokens.css"), "utf8");
  assert.match(tokens, /--station-motion-ack: 80ms;/);
  assert.match(tokens, /--station-motion-move: 300ms;/);
  assert.match(tokens, /--station-motion-lead: 40ms;/);
  assert.match(tokens, /--station-motion-settle: 120ms;/);
  assert.match(tokens, /--station-motion-ease: cubic-bezier\(0\.2, 0\.8, 0\.2, 1\);/);
});

/* ----------------------------------------------------------------------
 *   Opening
 * -------------------------------------------------------------------- */

test("opening a layer acknowledges first, then renders the destination and places every object over where it was", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  const before = transition.objectBoxes(h.svg());
  const oldD = h.svg().querySelector("[data-role='layer']");

  h.controller.open("D");
  assert.equal(h.controller.getState().phase, "opening");
  assert.ok(h.mount.classList.contains("is-transitioning"));
  // Stage A: nothing has been re-rendered; the clicked layer is marked on
  // the render the operator is looking at, and the others start to fade.
  assert.equal(h.renders.length, 1);
  const layers = Object.fromEntries(h.svg().querySelectorAll("[data-role='layer']").map(l => [l.getAttribute("data-layer"), l]));
  assert.ok(layers.D.classList.contains("is-activating"));
  assert.ok(!layers.A.classList.contains("is-activating"));
  for (const id of ["A", "B", "C", "E"]) {
    const fade = layers[id].animations.find(a => a.keyframes[0].opacity !== undefined);
    assert.ok(fade, `${id} is not stepping back`);
    assert.deepEqual(fade.keyframes, [{ opacity: 1 }, { opacity: 0.6 }]);
    assert.equal(fade.options.duration, 80);
  }
  assert.equal(layers.D.animations.length, 0, "the clicked layer itself does not fade");

  // Stage B: the acknowledgement lands, the destination is rendered in place.
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  assert.equal(h.renders.length, 2);
  assert.deepEqual(h.renders[1], { focusLayer: "D", raiseLayer: "D" });
  assert.equal(h.svg().getAttribute("data-focus-layer"), "D");

  // Every object of every layer got its inversion: at the first frame the
  // new element sits exactly on the old one's box.
  const after = transition.objectBoxes(h.svg());
  const newLayers = Object.fromEntries(h.svg().querySelectorAll("[data-role='layer']").map(l => [l.getAttribute("data-layer"), l]));
  for (const id of ["A", "B", "C", "D", "E"]) {
    for (const [object, roles] of Object.entries(transition.OBJECTS)) {
      for (const role of roles) {
        const el = newLayers[id].querySelector(`[data-role='${role}']`);
        const move = el.animations.find(a => a.keyframes[0].transform);
        assert.ok(move, `${id} ${role} is not moving`);
        assert.equal(move.keyframes[1].transform, "none");
        assert.equal(move.options.duration, 300);
        assert.equal(move.options.easing, "cubic-bezier(0.2, 0.8, 0.2, 1)");
        // The clicked layer's train sets off at once; its bank follows by
        // the lead. Nothing else waits.
        assert.equal(move.options.delay, id === "D" && object === "cluster" ? 40 : 0, `${id} ${role} delay`);
        const { tx, ty, s } = parseTransform(move.keyframes[0].transform);
        const dest = after[id][object];
        const src = before[id][object];
        assert.ok(Math.abs(s * dest.x + tx - src.x) < 0.25 && Math.abs(s * dest.y + ty - src.y) < 0.25,
          `${id} ${object} does not start where it was`);
        // (The transform is written to three decimals; over a 260-unit box
        // that is a quarter of a unit.)
        assert.ok(Math.abs(s * dest.width - src.width) < 0.25, `${id} ${object} does not start at its old size`);
        // Uniform: the height agrees with the width, or the object would be stretched.
        assert.ok(Math.abs(s * dest.height - src.height) < 0.3, `${id} ${object} is stretched`);
      }
    }
  }
  // The open layer grows; the others shrink and fade the rest of the way.
  const dTrain = parseTransform(newLayers.D.querySelector("[data-role='mixer']").animations[0].keyframes[0].transform);
  assert.ok(Math.abs(dTrain.s - 1 / layoutModule.DIMENSIONS.focusScale) < 1e-3);
  const aTrain = parseTransform(newLayers.A.querySelector("[data-role='mixer']").animations[0].keyframes[0].transform);
  assert.ok(Math.abs(aTrain.s - 1 / layoutModule.DIMENSIONS.dimScale) < 1e-3);
  for (const id of ["A", "B", "C", "E"]) {
    const fade = newLayers[id].animations.find(a => a.keyframes[0].opacity !== undefined);
    assert.deepEqual(fade.keyframes, [{ opacity: 0.6 }, { opacity: 0 }], `${id} does not continue its fade from where it was`);
  }
  // Stage C: the workspace settles in over the end of the move.
  const workspace = h.svg().querySelector("[data-role='focus-workspace']");
  const settle = workspace.animations[0];
  assert.deepEqual(settle.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(settle.options.duration, 120);
  // Over the end of the whole move - the bank lands at 340.
  assert.equal(settle.options.delay, 220);

  await land(h);
  assert.equal(h.controller.getState().phase, "focused");
  assert.ok(!h.mount.classList.contains("is-transitioning"));
  // Landed: no re-render, and every effect taken off the (correct) DOM.
  assert.equal(h.renders.length, 2);
  assert.ok(h.animated.every(a => a.cancelled || a.element === h.mount));
  assert.deepEqual(h.changes, ["normal", "opening", "focused"]);
  assert.ok(oldD !== newLayers.D);
});

test("the rotor's phase is handed from the old render to the new one, so it never restarts", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  const agitator = h.svg().querySelector("[data-role='layer']").querySelector(".station-mixer__agitator");
  assert.ok(agitator.getAnimations().length, "the running layer's rotor is animating");
  agitator.getAnimations()[0].currentTime = 4321;
  h.controller.open("A");
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  const layerA = h.svg().querySelectorAll("[data-role='layer']").find(l => l.getAttribute("data-layer") === "A");
  assert.equal(layerA.querySelector(".station-mixer__agitator").getAnimations()[0].currentTime, 4321);
  await land(h);
});

/* ----------------------------------------------------------------------
 *   Closing
 * -------------------------------------------------------------------- */

test("closing recedes the workspace, then carries everything back to exactly where it came from", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  const home = transition.objectBoxes(h.svg());
  h.controller.open("C");
  await land(h);
  assert.equal(h.controller.getState().phase, "focused");
  const focusedBoxes = transition.objectBoxes(h.svg());

  h.controller.close();
  assert.equal(h.controller.getState().phase, "closing");
  // Stage A of a close: the workspace recedes on the render being left.
  const workspace = h.svg().querySelector("[data-role='focus-workspace']");
  assert.deepEqual(workspace.animations[workspace.animations.length - 1].keyframes, [{ opacity: 1 }, { opacity: 0 }]);
  assert.equal(h.renders.length, 2);

  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  // The normal row is rendered with the returning layer painted last.
  assert.deepEqual(h.renders[2], { focusLayer: null, raiseLayer: "C" });
  const layers = h.svg().querySelectorAll("[data-role='layer']");
  assert.equal(layers[layers.length - 1].getAttribute("data-layer"), "C");
  // Everything starts from its focused position and lands home.
  const back = transition.objectBoxes(h.svg());
  assert.deepEqual(back, home, "the normal row is not where it was");
  const layerC = layers.find(l => l.getAttribute("data-layer") === "C");
  // The mirror of opening: the bank leaves at once, the train follows and
  // lands last.
  assert.equal(layerC.querySelector("[data-role='hopper-cluster']").animations[0].options.delay, 0);
  assert.equal(layerC.querySelector("[data-role='mixer']").animations[0].options.delay, 40);
  assert.equal(layerC.querySelector("[data-role='extruder']").animations[0].options.delay, 40);
  const { tx, ty, s } = parseTransform(layerC.querySelector("[data-role='hopper-cluster']").animations[0].keyframes[0].transform);
  assert.ok(Math.abs(s - layoutModule.DIMENSIONS.focusScale) < 1e-3);
  assert.ok(Math.abs(s * back.C.cluster.x + tx - focusedBoxes.C.cluster.x) < 0.01);
  assert.ok(Math.abs(s * back.C.cluster.y + ty - focusedBoxes.C.cluster.y) < 0.01);
  // Ghosts come back from nothing.
  const layerA = layers.find(l => l.getAttribute("data-layer") === "A");
  assert.deepEqual(layerA.animations.find(a => a.keyframes[0].opacity !== undefined).keyframes, [{ opacity: 0 }, { opacity: 1 }]);

  await land(h);
  assert.equal(h.controller.getState().phase, "normal");
  assert.equal(h.renders.length, 3);
  assert.deepEqual(h.changes, ["normal", "opening", "focused", "closing", "normal"]);
});

test("closing works from every layer of a five-layer line and both ends of a three-layer one", async () => {
  for (const [layerCount, ids] of [[5, ["A", "B", "C", "D", "E"]], [3, ["A", "B", "C"]]]) {
    for (const id of ids) {
      const h = harness({ layerCount });
      h.controller.refresh(null);
      const home = transition.objectBoxes(h.svg());
      h.controller.open(id);
      await land(h);
      assert.equal(h.svg().getAttribute("data-focus-layer"), id);
      h.controller.close();
      await land(h);
      assert.equal(h.controller.getState().phase, "normal");
      assert.deepEqual(transition.objectBoxes(h.svg()), home, `${layerCount} layers, ${id}: did not land home`);
    }
  }
});

/* ----------------------------------------------------------------------
 *   Interruption
 * -------------------------------------------------------------------- */

test("escape during the move turns the flight around in place and lands on the source layout", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  h.controller.open("D");
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  assert.equal(h.renders.length, 2);
  const inFlight = h.controller.animations();
  assert.ok(inFlight.length > 10);

  h.controller.close();
  assert.equal(h.controller.getState().phase, "closing");
  // No new render, no new animations: the same ones run backwards.
  assert.equal(h.renders.length, 2);
  assert.ok(inFlight.every(a => a.reversed));
  assert.deepEqual(h.controller.animations(), inFlight);

  await land(h);
  // Landed on the normal row, which is then rendered for real - the
  // focused DOM held its first frame under the swap.
  assert.equal(h.controller.getState().phase, "normal");
  assert.equal(h.renders.length, 3);
  assert.deepEqual(h.renders[2], { focusLayer: null, raiseLayer: undefined });
  assert.equal(h.svg().getAttribute("data-focus-layer"), null);
});

test("escape during the acknowledgement takes it back without ever rendering the destination", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  h.controller.open("B");
  const layerB = h.svg().querySelectorAll("[data-role='layer']").find(l => l.getAttribute("data-layer") === "B");
  assert.ok(layerB.classList.contains("is-activating"));
  h.controller.close();
  assert.equal(h.controller.getState().phase, "closing");
  assert.ok(!layerB.classList.contains("is-activating"));
  await land(h);
  assert.equal(h.controller.getState().phase, "normal");
  assert.equal(h.renders.length, 1, "the destination was rendered for a flight that never left");
});

test("opening again while closing turns the flight around; the same request twice is ignored", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  h.controller.open("C");
  await land(h);
  h.controller.close();
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  assert.equal(h.controller.getState().phase, "closing");
  const flying = h.controller.animations();
  h.controller.open("C");
  assert.equal(h.controller.getState().phase, "opening");
  assert.ok(flying.every(a => a.reversed));
  // Asking for what is already under way changes nothing.
  const renders = h.renders.length;
  h.controller.open("C");
  assert.equal(h.controller.getState().phase, "opening");
  assert.equal(h.renders.length, renders);
  await land(h);
  assert.equal(h.controller.getState().phase, "focused");
  assert.equal(h.svg().getAttribute("data-focus-layer"), "C");
});

test("asking for a different layer mid-flight settles the flight and then goes there - nothing is left between layouts", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  h.controller.open("A");
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  const flying = h.controller.animations();
  h.controller.open("E");
  // The A flight was finished on the spot ...
  assert.ok(flying.every(a => a.finishedFlag || a.cancelled));
  // ... and the E flight starts from the focused-A render.
  assert.equal(h.controller.getState().phase, "opening");
  assert.equal(h.controller.getState().focusLayer, "E");
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(h.renders[h.renders.length - 1], { focusLayer: "E", raiseLayer: "E" });
  await land(h);
  assert.equal(h.controller.getState().phase, "focused");
  assert.equal(h.svg().getAttribute("data-focus-layer"), "E");
});

test("a redraw mid-flight lands the flight first, so the stage can never be redrawn between layouts", async () => {
  const h = harness({ layerCount: 5 });
  h.controller.refresh(null);
  h.controller.open("D");
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  h.controller.refresh();
  assert.equal(h.controller.getState().phase, "focused");
  assert.equal(h.svg().getAttribute("data-focus-layer"), "D");
  assert.ok(!h.mount.classList.contains("is-transitioning"));
  assert.ok(h.animated.every(a => a.cancelled || a.finishedFlag || a.element === h.mount));
});

test("the state is a plain four-state machine, and the mount says when it is in transit", async () => {
  const h = harness({ layerCount: 3 });
  h.controller.refresh(null);
  assert.equal(h.controller.getState().phase, "normal");
  h.controller.open("B");
  assert.equal(h.controller.getState().phase, "opening");
  assert.ok(h.mount.classList.contains("is-transitioning"));
  await land(h);
  assert.equal(h.controller.getState().phase, "focused");
  assert.ok(!h.mount.classList.contains("is-transitioning"));
  h.controller.close();
  assert.equal(h.controller.getState().phase, "closing");
  assert.ok(h.mount.classList.contains("is-transitioning"));
  await land(h);
  assert.equal(h.controller.getState().phase, "normal");
  assert.deepEqual([...new Set(h.changes)].sort(), ["closing", "focused", "normal", "opening"]);
  // While in transit nothing on the stage is a click target.
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/machine.css"), "utf8");
  assert.match(css, /\.station-machine\.is-transitioning \.station-hit \{\s*pointer-events: none;/);
});

test("the slowdown is a playback rate on the animations in flight, and only there", async () => {
  const h = harness({ layerCount: 3 });
  h.controller.refresh(null);
  h.controller.setSlowdown(4);
  h.controller.open("A");
  assert.ok(h.controller.animations().every(a => a.playbackRate === 0.25));
  for (const a of h.controller.animations()) a.finish();
  await new Promise(r => setImmediate(r));
  assert.ok(h.controller.animations().every(a => a.playbackRate === 0.25));
  // Durations themselves are untouched: production timing is the tokens'.
  assert.ok(h.controller.animations().some(a => a.options.duration === 300));
  h.controller.setSlowdown(1);
  assert.ok(h.controller.animations().every(a => a.playbackRate === 1));
  await land(h);
});

/* ----------------------------------------------------------------------
 *   Reduced motion
 * -------------------------------------------------------------------- */

test("with reduced motion the state changes and nothing travels", async () => {
  const h = harness({ layerCount: 5 }, { reducedMotion: true });
  h.controller.refresh(null);
  h.controller.open("D");
  assert.equal(h.controller.getState().phase, "focused");
  assert.equal(h.svg().getAttribute("data-focus-layer"), "D");
  assert.equal(transformsOf(h).length, 0, "something travelled under reduced motion");
  assert.ok(!h.mount.classList.contains("is-transitioning"));
  // The workspace still fades in briefly - opacity only.
  const workspace = h.svg().querySelector("[data-role='focus-workspace']");
  assert.deepEqual(workspace.animations[0].keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  h.controller.close();
  assert.equal(h.controller.getState().phase, "normal");
  assert.equal(h.svg().getAttribute("data-focus-layer"), null);
  assert.equal(transformsOf(h).length, 0);
});

/* ----------------------------------------------------------------------
 *   Loading and boundaries
 * -------------------------------------------------------------------- */

test("the transition module is loaded by both entry points after the renderer and before the boot", () => {
  const harnessHtml = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  for (const [name, source] of [["station.html", harnessHtml], ["station-host.js", host]]) {
    const at = source.indexOf("station-transition.js");
    assert.ok(at > 0, `${name} does not load the transition`);
    assert.ok(at > source.indexOf("station-render.js"), `${name} loads the transition before the renderer`);
    assert.ok(at < source.search(/station\.js["?]/), `${name} loads the transition after the boot`);
  }
});

test("the transition animates transform and opacity only, from one place, with no timers", () => {
  const source = fs.readFileSync(path.join(ROOT, "station/station-transition.js"), "utf8");
  // Every keyframe list in the file starts with one of the two properties
  // the compositor can animate - never a width, a height, or a coordinate.
  const keyframeProperties = new Set([...source.matchAll(/\[\{ ([a-zA-Z]+):/g)].map(m => m[1]));
  assert.deepEqual([...keyframeProperties].sort(), ["opacity", "transform"]);
  assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame/);
  // Nothing of the application, nothing of the network.
  for (const pattern of [/localStorage/, /\bfetch\s*\(/, /supabase/i, /PolynStationStateBridge/]) {
    assert.doesNotMatch(source, pattern);
  }
});

test("the review controls are development-only: the harness loads them, the application host cannot", () => {
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  assert.ok(!host.includes("station-transition-dev"), "station-host.js loads the development-only transition controls");
  const harnessHtml = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  assert.match(harnessHtml, /station-transition-dev\.js/);
  assert.match(harnessHtml, /components\/dev\.css/);
  assert.ok(!host.includes("dev.css"));
  const boot = fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8");
  const guard = boot.slice(boot.indexOf("function transitionDebugRequested()"));
  const body = guard.slice(0, guard.indexOf("\n  }") + 4);
  assert.match(body, /if \(!root\.PolynStationTransitionDev\) return false;/);
  assert.match(body, /searchParams\.get\("transition"\) === "debug"/);
  const dev = fs.readFileSync(path.join(ROOT, "station/station-transition-dev.js"), "utf8");
  assert.match(dev, /REMOVING IT/);
});
