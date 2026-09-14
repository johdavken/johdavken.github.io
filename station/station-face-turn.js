/* A layer turning over: its blend card fading in over its hopper cluster,
 * or out from it, in place.
 *
 * WHAT IT IS
 *
 * While Blend Edit is on, every layer on the stage carries both faces -
 * the cluster it always had and the card the mode gave it - and the
 * layer's `is-flipped` class says whether the card is shown (hopper.css).
 * The cluster is always shown: the card is glass, and the hoppers stand
 * behind it, seen through it. Turning a layer over is therefore not a
 * redraw: it is that class changing, and the card arriving over the
 * cluster or leaving it. This module is that move. The card fades and
 * widens in, or fades and narrows out, over the settle time the tokens
 * name; the cluster under it never moves, so there is no frame with
 * neither face and nothing for the cluster to do.
 *
 * One layer or every layer, the turn is this same routine run once per
 * layer, so the rail's switch and a train's click cannot look different.
 *
 * HOW IT KEEPS TIME
 *
 * The class is set at once: the DOM tells the truth the moment the
 * operator acts, whatever the animation is doing. Then `is-turning` goes
 * on the layer, which shows the card regardless of `is-flipped`, and the
 * animation is created PAUSED at its first frame - the card whole if it
 * is leaving, invisible if it is arriving - so the next paint, however
 * long it takes (the stage may just have been rebuilt), still shows the
 * picture the operator was looking at. It is set going two frames later,
 * once that paint is behind it, so the fade runs its full length from a
 * frame that has actually been drawn rather than starting on a clock the
 * paint could not keep up with. When it finishes, `is-turning` comes off
 * and the stylesheet hides a departed card where it lies.
 *
 * Reduced motion, a face that is not there, no animate function handed
 * in, or an element that cannot animate (a test's fake node: the function
 * answers null) make the turn instant: the class changes,
 * nothing else, and the handle says so synchronously - `animated: false` -
 * so a caller that must do something after the turn can do it at once
 * instead of waiting on a promise that would resolve a tick later.
 *
 * Node standard library only; the browser surfaces (animate, the frame
 * callback) come in through the options.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationFaceTurn = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SETTLE = 120;
  const FACES = Object.freeze({ card: ".station-blend-card", cluster: ".station-hopper-cluster" });

  /* The card's arriving frames - the same settle the focus workspace
   * uses - and its departing ones, which are those in reverse. The
   * cluster has no frames: it stands where it is under the glass. */
  const ARRIVE = Object.freeze([{ opacity: 0, transform: "scaleX(0.92)" }, { opacity: 1, transform: "none" }]);
  const DEPART = Object.freeze([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scaleX(0.92)" }]);

  function setClass(element, name, on) {
    if (!element || !element.classList) return;
    if (on) element.classList.add(name);
    else element.classList.remove(name);
  }

  function faceOf(layer, name) {
    if (!layer || !name || typeof layer.querySelector !== "function") return null;
    return layer.querySelector(FACES[name]) || null;
  }

  function settled(animations) {
    return Promise.all(animations.map(a => (a && a.finished ? a.finished.catch(() => {}) : Promise.resolve())));
  }

  /**
   * Turn one layer's face.
   *
   * @param {Element} layer   the layer group ([data-role='layer'])
   * @param {object}  options
   * @param {string}  options.to     "card" | "cluster" - the face to show
   * @param {string}  [options.from] "card" | "cluster" | null - the face
   *        being left. Only the card is ever animated: to the card, it
   *        arrives over the cluster; to the cluster, it departs from over
   *        it. `from` null (or the same as `to`) with the card arriving is
   *        the same arrival, as when the mode switches faces and the card
   *        that was there is already gone; to the cluster from nothing,
   *        there is nothing to move and the turn is instant
   * @param {object}  [options.timing]  { settle } in ms
   * @param {function} [options.animate]  (element, keyframes, options) => Animation | null;
   *        none makes the turn instant
   * @param {boolean|function} [options.reducedMotion]
   * @param {function} [options.requestAnimationFrame]
   * @returns {{ animated: boolean, done: Promise, finish: function }}
   */
  function turn(layer, options) {
    const settings = options || {};
    const to = settings.to === "cluster" ? "cluster" : "card";
    const from = settings.from && settings.from !== to && FACES[settings.from] ? settings.from : null;
    const settle = settings.timing && Number.isFinite(settings.timing.settle) ? settings.timing.settle : SETTLE;
    // The animate function is handed in (Station hands the transition
    // module's play, so that module stays the one place the stage is
    // animated through); with none, the turn is instant.
    const animate = typeof settings.animate === "function" ? settings.animate : null;
    const reduced = typeof settings.reducedMotion === "function" ? !!settings.reducedMotion() : !!settings.reducedMotion;
    const raf = settings.requestAnimationFrame
      || (typeof requestAnimationFrame === "function" ? requestAnimationFrame : null);

    const instant = { animated: false, done: Promise.resolve(), finish() {} };
    if (!layer) return instant;

    // The truth first, whatever follows.
    setClass(layer, "is-flipped", to === "card");

    // The card, arriving or departing; the cluster never moves.
    const card = to === "card" || from === "card" ? faceOf(layer, "card") : null;
    if (reduced || !animate || !card || !raf) return instant;
    const frames = to === "card" ? ARRIVE : DEPART;
    const easing = to === "card" ? "ease-out" : "ease-in";

    // The card shown while it moves, held at its first frame until the
    // frame after the next paint.
    setClass(layer, "is-turning", true);
    let animations;
    try {
      animations = [animate(card, frames, { duration: settle, easing, fill: "both" })].filter(Boolean);
    } catch (error) {
      animations = [];
    }
    if (animations.length !== 1) {
      // A card that cannot animate: no half-turn - land it now.
      for (const a of animations) { try { a.cancel(); } catch (error) { /* ok */ } }
      setClass(layer, "is-turning", false);
      return instant;
    }
    for (const a of animations) { try { a.pause(); } catch (error) { /* ok */ } }

    let landed = false;
    function land() {
      if (landed) return;
      landed = true;
      setClass(layer, "is-turning", false);
      for (const a of animations) { try { a.cancel(); } catch (error) { /* ok */ } }
    }

    let released = false;
    function release() {
      if (released || landed) return;
      released = true;
      for (const a of animations) { try { a.play(); } catch (error) { /* ok */ } }
    }
    raf(() => raf(release));

    const done = settled(animations).then(land);
    return {
      animated: true,
      done,
      /* Land it early: the end state at once, the promise resolving as it
       * would have. */
      finish() {
        release();
        for (const a of animations) { try { a.finish(); } catch (error) { /* ok */ } }
        land();
      }
    };
  }

  return { turn, FACES, ARRIVE, DEPART, SETTLE };
});
