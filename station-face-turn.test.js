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

test("turning to the card: the class at once, the card held at its first frame over the cluster, released two frames on, landed when it finishes - the cluster never moves", async () => {
  const { layer, made, animate } = layerWith(["cluster", "card"]);
  layer.classList.add("is-flippable");
  const f = frames();
  const handle = faceTurn.turn(layer, { to: "card", from: "cluster", timing: { settle: 200 }, animate, requestAnimationFrame: f.request });
  assert.equal(handle.animated, true);
  assert.ok(layer.classList.contains("is-flipped"), "the class says the card, at once");
  assert.ok(layer.classList.contains("is-turning"), "and the layer is mid-turn");
  // One animation, paused where it starts: the card invisible and narrow.
  // The cluster stands under the glass and is given no frames at all.
  assert.equal(made.length, 1);
  const card = made[0];
  assert.equal(card.owner, "station-blend-card");
  assert.deepEqual(card.keyframes, [{ opacity: 0, transform: "scaleX(0.92)" }, { opacity: 1, transform: "none" }]);
  assert.equal(card.options.duration, 200, "the settle time handed in");
  assert.equal(card.options.fill, "both", "held at its first frame before it plays, and at its last after");
  assert.deepEqual(card.log, ["pause"]);
  assert.equal(card.options.easing, "ease-out");
  // Not the next frame - the one after, once that paint is behind it.
  assert.equal(f.pending(), 1);
  f.tick();
  assert.deepEqual(card.log, ["pause"], "released on the first frame");
  assert.equal(f.pending(), 1);
  f.tick();
  assert.deepEqual(card.log, ["pause", "play"]);
  assert.ok(layer.classList.contains("is-turning"), "still mid-turn while it runs");
  card.finish();
  await handle.done;
  assert.ok(!layer.classList.contains("is-turning"), "landed");
  assert.ok(layer.classList.contains("is-flipped"));
  assert.equal(card.log[card.log.length - 1], "cancel", "the held last frame is let go once the class shows the face");
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
  // The card departs from over the cluster, which was there all along.
  assert.equal(made.length, 1);
  const card = made[0];
  assert.equal(card.owner, "station-blend-card");
  assert.deepEqual(card.keyframes, faceTurn.DEPART);
  assert.equal(card.options.easing, "ease-in");
  assert.equal(card.options.duration, faceTurn.SETTLE, "the token's default without a timing handed in");
  f.tick(); f.tick();
  card.finish();
  await handle.done;
  assert.ok(!layer.classList.contains("is-turning"));
});

test("to the cluster from nothing there is nothing to move: instant, the class alone", () => {
  const { layer, made, animate } = layerWith(["cluster", "card"]);
  layer.classList.add("is-flipped");
  const f = frames();
  assert.equal(faceTurn.turn(layer, { to: "cluster", from: null, animate, requestAnimationFrame: f.request }).animated, false);
  assert.ok(!layer.classList.contains("is-flipped"));
  assert.ok(!layer.classList.contains("is-turning"));
  assert.equal(made.length, 0);
  assert.equal(f.pending(), 0);
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
  // A cluster that cannot animate is no matter: it is never asked to.
  const { layer, cluster, made, animate } = layerWith(["cluster", "card"]);
  cluster.animate = () => null;
  const f = frames();
  const handle = faceTurn.turn(layer, { to: "card", from: "cluster", animate, requestAnimationFrame: f.request });
  assert.equal(handle.animated, true);
  assert.ok(layer.classList.contains("is-turning"));
  assert.equal(made.length, 1);
  assert.equal(made[0].owner, "station-blend-card");
  handle.finish();
  assert.ok(!layer.classList.contains("is-turning"));
});

test("a missing face, no frame callback, or no layer at all: instant, and never a throw", () => {
  const f = frames();
  const only = faces => { const l = layerWith(faces); return { layer: l.layer, animate: l.animate }; };
  // No card to move: instant.
  const a = only(["cluster"]);
  assert.equal(faceTurn.turn(a.layer, { to: "card", from: "cluster", animate: a.animate, requestAnimationFrame: f.request }).animated, false);
  assert.equal(faceTurn.turn(a.layer, { to: "cluster", from: "card", animate: a.animate, requestAnimationFrame: f.request }).animated, false);
  // No cluster is no matter: the card is the only face that moves.
  const b = only(["card"]);
  const own = frames();
  const moved = faceTurn.turn(b.layer, { to: "card", from: "cluster", animate: b.animate, requestAnimationFrame: own.request });
  assert.equal(moved.animated, true);
  moved.finish();
  assert.ok(!b.layer.classList.contains("is-turning"));
  const { layer, animate } = layerWith(["cluster", "card"]);
  assert.equal(faceTurn.turn(layer, { to: "card", from: "cluster", animate, requestAnimationFrame: null }).animated, false);
  assert.ok(layer.classList.contains("is-flipped"), "the class is still set");
  assert.equal(faceTurn.turn(null, { to: "card" }).animated, false);
  assert.equal(f.pending(), 0);
});

/* ----------------------------------------------------------------------
 *   The stylesheet's side of it, and the loading
 * -------------------------------------------------------------------- */

test("the stylesheet keeps the cluster drawn under the card with the pointer off it, hides a card the class does not name, shows it mid-turn with the pointer off both, and keeps the rule the patch relies on", () => {
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/hopper.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.station-layer\.is-flipped \.station-hopper-cluster \{\s*pointer-events: none;\s*\}/);
  assert.doesNotMatch(css, /\.station-layer\.is-flipped \.station-hopper-cluster \{[^}]*display/, "the cluster is hidden under the glass");
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
