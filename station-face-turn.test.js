"use strict";

/* The face turn (station-face-turn.js): a layer's hopper cluster and blend
 * card trading places in place - the class changing at once, the two
 * faces cross-fading from a frame that has been painted, and one routine
 * whether one layer turns or every layer does.
 *
 * Pure: a small fake layer with the two faces, a recording animate, and a
 * frame queue the test drains by hand. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const faceTurn = require("./station/station-face-turn.js");

const ROOT = __dirname;

/* ----------------------------------------------------------------------
 *   A layer with two faces, an animation that can be finished by hand
 * -------------------------------------------------------------------- */

function classList(node) {
  const set = new Set();
  return {
    add: n => set.add(n),
    remove: n => set.delete(n),
    contains: n => set.has(n),
    toggle: (n, on) => { if (on === undefined ? !set.has(n) : on) set.add(n); else set.delete(n); return set.has(n); },
    list: () => Array.from(set),
    node
  };
}

function fakeAnimation(keyframes, options) {
  let resolve;
  const a = {
    keyframes, options,
    state: "running",
    log: [],
    finished: new Promise(r => { resolve = r; }),
    pause() { this.state = "paused"; this.log.push("pause"); },
    play() { this.state = "running"; this.log.push("play"); },
    finish() { this.state = "finished"; this.log.push("finish"); resolve(); },
    cancel() { this.state = "idle"; this.log.push("cancel"); }
  };
  return a;
}

function layerWith(faces, animatable) {
  const made = [];
  const face = name => ({
    className: name,
    animate: animatable === false ? undefined : (keyframes, options) => {
      if (animatable === null) return null;
      const a = fakeAnimation(keyframes, options);
      a.owner = name;
      made.push(a);
      return a;
    }
  });
  /* The animate function Station hands in: the transition module's play,
   * which asks the element and answers null for one that cannot. */
  const animate = (element, keyframes, options) => (element && typeof element.animate === "function" ? element.animate(keyframes, options) : null);
  const cluster = faces.includes("cluster") ? face("station-hopper-cluster") : null;
  const card = faces.includes("card") ? face("station-blend-card") : null;
  const layer = {
    classList: null,
    querySelector: selector => (selector === ".station-blend-card" ? card : selector === ".station-hopper-cluster" ? cluster : null)
  };
  layer.classList = classList(layer);
  return { layer, cluster, card, made, animate };
}

function frames() {
  const queue = [];
  return {
    request: fn => { queue.push(fn); return queue.length; },
    /* Run one frame's callbacks - those queued before it began. */
    tick() { const now = queue.splice(0); for (const fn of now) fn(); return now.length; },
    pending: () => queue.length
  };
}

const settle = () => new Promise(r => setImmediate(r));

/* ----------------------------------------------------------------------
 *   The turn
 * -------------------------------------------------------------------- */

test("turning to the card: the class at once, both faces held at their first frame, released two frames on, landed when both finish", async () => {
  const { layer, made, animate } = layerWith(["cluster", "card"]);
  layer.classList.add("is-flippable");
  const f = frames();
  const handle = faceTurn.turn(layer, { to: "card", from: "cluster", timing: { settle: 200 }, animate, requestAnimationFrame: f.request });
  assert.equal(handle.animated, true);
  assert.ok(layer.classList.contains("is-flipped"), "the class says the card, at once");
  assert.ok(layer.classList.contains("is-turning"), "and the layer is mid-turn");
  // Two animations, paused where they start: the card invisible and
  // narrow, the cluster whole.
  assert.equal(made.length, 2);
  const card = made.find(a => a.owner === "station-blend-card");
  const cluster = made.find(a => a.owner === "station-hopper-cluster");
  assert.deepEqual(card.keyframes, [{ opacity: 0, transform: "scaleX(0.92)" }, { opacity: 1, transform: "none" }]);
  assert.deepEqual(cluster.keyframes, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scaleX(0.92)" }]);
  for (const a of made) {
    assert.equal(a.options.duration, 200, "the settle time handed in");
    assert.equal(a.options.fill, "both", "held at its first frame before it plays, and at its last after");
    assert.deepEqual(a.log, ["pause"]);
  }
  assert.equal(card.options.easing, "ease-out");
  assert.equal(cluster.options.easing, "ease-in");
  // Not the next frame - the one after, once that paint is behind them.
  assert.equal(f.pending(), 1);
  f.tick();
  for (const a of made) assert.deepEqual(a.log, ["pause"], "released on the first frame");
  assert.equal(f.pending(), 1);
  f.tick();
  for (const a of made) assert.deepEqual(a.log, ["pause", "play"]);
  assert.ok(layer.classList.contains("is-turning"), "still mid-turn while they run");
  // The first finishing is not the end.
  card.finish();
  await settle();
  assert.ok(layer.classList.contains("is-turning"));
  cluster.finish();
  await handle.done;
  assert.ok(!layer.classList.contains("is-turning"), "landed: the stylesheet hides the departing face");
  assert.ok(layer.classList.contains("is-flipped"));
  for (const a of made) assert.equal(a.log[a.log.length - 1], "cancel", "the held last frame is let go once the class hides the face");
});

test("turning back to the cluster is the same turn the other way", async () => {
  const { layer, made, animate } = layerWith(["cluster", "card"]);
  layer.classList.add("is-flippable");
  layer.classList.add("is-flipped");
  const f = frames();
  const handle = faceTurn.turn(layer, { to: "cluster", from: "card", animate, requestAnimationFrame: f.request });
  assert.equal(handle.animated, true);
  assert.ok(!layer.classList.contains("is-flipped"));
  assert.ok(layer.classList.contains("is-turning"));
  const cluster = made.find(a => a.owner === "station-hopper-cluster");
  const card = made.find(a => a.owner === "station-blend-card");
  assert.deepEqual(cluster.keyframes, faceTurn.ARRIVE);
  assert.deepEqual(card.keyframes, faceTurn.DEPART);
  assert.equal(cluster.options.duration, faceTurn.SETTLE, "the token's default without a timing handed in");
  f.tick(); f.tick();
  for (const a of made) a.finish();
  await handle.done;
  assert.ok(!layer.classList.contains("is-turning"));
});

test("with no face to leave (a face switch: the card that was there is gone) only the arrival plays", async () => {
  const { layer, made, animate } = layerWith(["cluster", "card"]);
  layer.classList.add("is-flipped");
  const f = frames();
  const handle = faceTurn.turn(layer, { to: "card", from: null, animate, requestAnimationFrame: f.request });
  assert.equal(handle.animated, true);
  assert.equal(made.length, 1);
  assert.equal(made[0].owner, "station-blend-card");
  // `from` the same as `to` is the same thing said differently.
  const again = layerWith(["cluster", "card"]);
  faceTurn.turn(again.layer, { to: "card", from: "card", animate: again.animate, requestAnimationFrame: f.request });
  assert.equal(again.made.length, 1);
  f.tick(); f.tick();
  made[0].finish();
  await handle.done;
  assert.ok(!layer.classList.contains("is-turning"));
});

test("finish() lands a turn early: released if it was not, the end state at once, the promise resolving as it would have", async () => {
  const { layer, made, animate } = layerWith(["cluster", "card"]);
  const f = frames();
  const handle = faceTurn.turn(layer, { to: "card", from: "cluster", animate, requestAnimationFrame: f.request });
  handle.finish();
  assert.ok(!layer.classList.contains("is-turning"));
  assert.ok(layer.classList.contains("is-flipped"));
  for (const a of made) assert.deepEqual(a.log, ["pause", "play", "finish", "cancel"]);
  await handle.done;
  // The frames that were queued do nothing now.
  f.tick(); f.tick();
  for (const a of made) assert.equal(a.log.length, 4, "a landed turn is not played again");
});

/* ----------------------------------------------------------------------
 *   Instant turns
 * -------------------------------------------------------------------- */

test("reduced motion: the class alone, at once, and the handle says nothing is in flight", async () => {
  const { layer, made, animate } = layerWith(["cluster", "card"]);
  const f = frames();
  for (const reducedMotion of [true, () => true]) {
    const handle = faceTurn.turn(layer, { to: "card", from: "cluster", reducedMotion, animate, requestAnimationFrame: f.request });
    assert.equal(handle.animated, false);
    assert.ok(layer.classList.contains("is-flipped"));
    assert.ok(!layer.classList.contains("is-turning"));
    assert.equal(made.length, 0, "nothing animated");
    assert.equal(f.pending(), 0, "no frame asked for");
    await handle.done;
  }
});

test("a face that cannot animate - a node with no animate, one whose animate returns null, or no animate function handed in at all - is an instant turn with no half-turn left on the layer", () => {
  for (const animatable of [false, null]) {
    const { layer, animate } = layerWith(["cluster", "card"], animatable);
    const f = frames();
    const handle = faceTurn.turn(layer, { to: "cluster", from: "card", animate, requestAnimationFrame: f.request });
    assert.equal(handle.animated, false);
    assert.ok(!layer.classList.contains("is-flipped"));
    assert.ok(!layer.classList.contains("is-turning"), "no is-turning on an instant turn");
    assert.equal(f.pending(), 0);
  }
  {
    // No animate function: the module animates nothing of its own accord.
    const { layer, made } = layerWith(["cluster", "card"]);
    const f = frames();
    assert.equal(faceTurn.turn(layer, { to: "card", from: "cluster", requestAnimationFrame: f.request }).animated, false);
    assert.equal(made.length, 0);
    assert.ok(layer.classList.contains("is-flipped") && !layer.classList.contains("is-turning"));
  }
  // One face that animates and one that does not: no half-turn either.
  const { layer, card, made, animate } = layerWith(["cluster", "card"]);
  card.animate = () => null;
  const f = frames();
  const handle = faceTurn.turn(layer, { to: "card", from: "cluster", animate, requestAnimationFrame: f.request });
  assert.equal(handle.animated, false);
  assert.ok(!layer.classList.contains("is-turning"));
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].log, ["cancel"], "the one that was made is let go");
});

test("a missing face, no frame callback, or no layer at all: instant, and never a throw", () => {
  const f = frames();
  const only = faces => { const l = layerWith(faces); return { layer: l.layer, animate: l.animate }; };
  const a = only(["cluster"]);
  assert.equal(faceTurn.turn(a.layer, { to: "card", from: "cluster", animate: a.animate, requestAnimationFrame: f.request }).animated, false);
  const b = only(["card"]);
  assert.equal(faceTurn.turn(b.layer, { to: "card", from: "cluster", animate: b.animate, requestAnimationFrame: f.request }).animated, false);
  const { layer, animate } = layerWith(["cluster", "card"]);
  assert.equal(faceTurn.turn(layer, { to: "card", from: "cluster", animate, requestAnimationFrame: null }).animated, false);
  assert.ok(layer.classList.contains("is-flipped"), "the class is still set");
  assert.equal(faceTurn.turn(null, { to: "card" }).animated, false);
  assert.equal(f.pending(), 0);
});

/* ----------------------------------------------------------------------
 *   The stylesheet's side of it, and the loading
 * -------------------------------------------------------------------- */

test("the stylesheet hides the face the class does not name, shows both mid-turn with the pointer off them, and keeps the rule the patch relies on", () => {
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/hopper.css"), "utf8");
  assert.match(css, /\.station-layer\.is-flipped \.station-hopper-cluster \{\s*display: none;/);
  assert.match(css, /\.station-layer\.is-flippable:not\(\.is-flipped\) \.station-blend-card \{\s*display: none;/);
  assert.match(css, /\.station-layer\.is-turning \.station-hopper-cluster,\n\.station-layer\.is-turning \.station-blend-card \{\s*display: inline;\s*pointer-events: none;/);
});

test("the module is loaded by the host and the harness after the transition module it takes its timing from", () => {
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  for (const [text, transitionTag, turnTag] of [
    [host, '"station/station-transition.js"', '"station/station-face-turn.js"'],
    [harness, 'src="station-transition.js', 'src="station-face-turn.js']
  ]) {
    const a = text.indexOf(transitionTag), b = text.indexOf(turnTag);
    assert.ok(a > -1 && b > a, "station-face-turn.js is loaded after station-transition.js");
  }
});
