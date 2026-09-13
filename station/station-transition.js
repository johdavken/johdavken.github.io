/* Opening and closing a layer: the transition between Station's normal row
 * and its focused workspace.
 *
 * WHAT IT IS FOR
 *
 * When an operator clicks a layer's mixer, that layer's equipment should be
 * seen to travel into the workspace - the same drum, the same hoppers, moving
 * from where they stood to where they are needed - and to travel back when
 * the layer is closed. One interface reorganising itself, not one screen
 * replaced by another. This file is that motion and nothing else: it decides
 * no geometry (the layout does), draws nothing (the renderer does), and holds
 * no application state.
 *
 * HOW IT WORKS: FLIP OVER TWO RENDERS
 *
 * The renderer rebuilds the stage for each state. So a transition is:
 *
 *   1. CAPTURE   read where every rigid object is on screen in the current
 *                render - the boxes each bank declares on its markup
 *                (data-object-cluster, data-object-train), taken through the
 *                <svg>'s screen matrix. No element is measured; the drawing
 *                already knows where everything is.
 *   2. RENDER    build the destination layout for real, in place.
 *   3. INVERT    for each object, the transform that puts its NEW element
 *                exactly over its old screen position: a translate and one
 *                uniform scale, in the new canvas's own units.
 *   4. PLAY      animate that transform to identity with the Web Animations
 *                API, transform and opacity only, on the compositor.
 *
 * The object the operator sees moving is therefore the destination element,
 * placed over the source and released - which is why nothing stretches: the
 * layout draws every bank as one rigid assembly at one scale, and the
 * transform between two such drawings is always translate + uniform scale.
 * Closing is the same procedure from the other layout, so the equipment
 * lands exactly where it came from because that is where the normal layout
 * puts it.
 *
 * WHAT MAKES IT CONTINUOUS
 *
 *   - the rotor: the agitator's CSS animation is handed from the old element
 *     to the new one at the swap (same currentTime), so it never restarts;
 *   - the swap itself happens inside one task, so the old render is never
 *     painted without the new one already placed over it;
 *   - text is sized against the bank's scale (--station-bank-scale), so the
 *     destination drawing IS the source drawing scaled and nothing re-sizes
 *     at the handoff.
 *
 * THE STATE MACHINE
 *
 *   normal --open--> opening --done--> focused --close--> closing --done--> normal
 *
 * A request while a transition is running is handled deterministically:
 *   - the same request again (open the layer already opening) is ignored;
 *   - the opposite request (close while opening, open while closing)
 *     REVERSES the running animations in place, so the equipment turns
 *     around wherever it is and goes back;
 *   - any other request (a different layer, a re-render) SETTLES the running
 *     transition instantly - jumps to its end - and then proceeds. Nothing
 *     can leave the stage between layouts.
 *
 * Reduced motion keeps every state change and drops the travel: the new
 * layout is rendered at once.
 *
 * Node standard library only; every browser surface (animate, computed
 * style, screen matrices) is reachable through the options so the state
 * machine and the geometry are testable without a browser.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationTransition = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The timing the tokens carry (tokens.css), as the fallback when they
   * cannot be read - the numbers must agree. */
  const DEFAULT_TIMING = Object.freeze({
    ack: 80,       // acknowledgement before anything moves
    move: 300,     // the spatial transition
    lead: 40,      // the train sets off this much before the bank follows
    settle: 120,   // the destination's own chrome, overlapping the end of the move
    ease: "cubic-bezier(0.2, 0.8, 0.2, 1)"
  });

  /* The elements that make up each rigid object of a layer, by data-role.
   * The cluster carries the layer's header with it; the train is the three
   * machine groups, which share one transform because they are one thing. */
  const OBJECTS = Object.freeze({
    cluster: ["layer-header", "hopper-cluster"],
    train: ["extruder", "feed", "mixer"]
  });

  function parseMs(value, fallback) {
    const text = String(value || "").trim();
    if (!text) return fallback;
    const number = parseFloat(text);
    if (!Number.isFinite(number)) return fallback;
    return /s$/.test(text) && !/ms$/.test(text) ? number * 1000 : number;
  }

  /* The motion tokens, read off the mount so the stylesheet is the single
   * source. `computedStyle` is injectable for tests. */
  function readTiming(element, computedStyle) {
    const style = element && computedStyle ? computedStyle(element) : null;
    const read = name => (style && style.getPropertyValue ? style.getPropertyValue(name) : "");
    return {
      ack: parseMs(read("--station-motion-ack"), DEFAULT_TIMING.ack),
      move: parseMs(read("--station-motion-move"), DEFAULT_TIMING.move),
      lead: parseMs(read("--station-motion-lead"), DEFAULT_TIMING.lead),
      settle: parseMs(read("--station-motion-settle"), DEFAULT_TIMING.settle),
      ease: String(read("--station-motion-ease") || "").trim() || DEFAULT_TIMING.ease
    };
  }

  /* ------------------------------------------------------------------
   *   Geometry
   * ---------------------------------------------------------------- */

  function parseBox(text) {
    const numbers = String(text || "").trim().split(/\s+/).map(Number);
    if (numbers.length !== 4 || numbers.some(n => !Number.isFinite(n))) return null;
    return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] };
  }

  /* Every bank's declared objects, by layer id, in the canvas units of the
   * <svg> they were read from. */
  function objectBoxes(svg) {
    const out = {};
    if (!svg || !svg.querySelectorAll) return out;
    for (const layer of svg.querySelectorAll("[data-role='layer']")) {
      const id = layer.getAttribute("data-layer");
      const cluster = parseBox(layer.getAttribute("data-object-cluster"));
      const train = parseBox(layer.getAttribute("data-object-train"));
      if (id && cluster && train) out[id] = { cluster, train };
    }
    return out;
  }

  /* An <svg>'s canvas-to-screen mapping, reduced to the three numbers that
   * matter for a canvas that is scaled to fit and never rotated. */
  function screenMatrix(svg) {
    const m = svg && typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
    if (!m) return { scale: 1, x: 0, y: 0 };
    return { scale: m.a, x: m.e, y: m.f };
  }

  /* A box from one canvas expressed in another canvas's units, via the
   * screen. Both canvases are uniformly scaled, so a box stays a box. */
  function rebox(box, from, to) {
    const k = from.scale / to.scale;
    return {
      x: (box.x * from.scale + from.x - to.x) / to.scale,
      y: (box.y * from.scale + from.y - to.y) / to.scale,
      width: box.width * k,
      height: box.height * k
    };
  }

  /**
   * The transform that lays `destination` over `source` - both boxes in the
   * destination canvas's units - as a translate and one uniform scale about
   * the canvas origin. Animating this to identity is the whole move.
   *
   * The scale comes from the widths; a rigid object has the same ratio in
   * both axes, and the test suite holds the layout to that.
   */
  function flip(source, destination) {
    const s = destination.width > 0 ? source.width / destination.width : 1;
    return {
      s,
      tx: source.x - s * destination.x,
      ty: source.y - s * destination.y
    };
  }

  function transformValue(delta) {
    const r = n => Math.round(n * 1000) / 1000;
    return `translate(${r(delta.tx)}px, ${r(delta.ty)}px) scale(${r(delta.s)})`;
  }

  /* ------------------------------------------------------------------
   *   Motion for the rest of Station
   * ------------------------------------------------------------------
   * The transition module is the one Station file that animates
   * (station-host-isolation.test.js), so any other surface that moves -
   * the Handbook opening out of its launcher, a hopper cluster turning
   * over to its blend card - moves through these two helpers, on the same
   * tokens, with the same fallbacks, and never by calling animate() of
   * its own. Both are finite Web Animations of transform and opacity,
   * run by the compositor; neither keeps a timer. */

  /** The transform that lays an element standing at `to` over the box
   * `from`, in CSS terms - a translate and one uniform scale from the
   * element's top-left corner (transform-origin: 0 0). Both rects in the
   * viewport (getBoundingClientRect). Null when either cannot be measured. */
  function overlayTransform(from, to) {
    if (!from || !to || !(to.width > 0) || !(to.height > 0) || !(from.width > 0)) return null;
    const s = from.width / to.width;
    return transformValue({ s, tx: from.left - to.left, ty: from.top - to.top });
  }

  /** Play keyframes on an element that can be animated; null for one that
   * cannot (a test's fake node), so a caller never has to guard. */
  function play(element, keyframes, options) {
    if (!element || typeof element.animate !== "function") return null;
    try {
      return element.animate(keyframes, options);
    } catch (error) {
      return null;
    }
  }

  /* ------------------------------------------------------------------
   *   The controller
   * ---------------------------------------------------------------- */

  /**
   * @param {object} options
   * @param {Element}  options.mount     the machine mount the stage renders into
   * @param {function} options.render    (focusLayer, { raiseLayer }) => <svg>, rendered into the mount
   * @param {function} [options.onChange]  (state) => void, on every phase change
   * @param {function} [options.reducedMotion]  () => boolean
   * @param {function} [options.animate]  (element, keyframes, options) => Animation
   * @param {function} [options.computedStyle]  (element) => CSSStyleDeclaration
   * @param {object}   [options.timing]   overrides for the token timing
   */
  function createController(options) {
    const settings = options || {};
    const mount = settings.mount;
    const render = settings.render;
    if (!mount || typeof render !== "function") throw new Error("station-transition: mount and render are required");
    const computedStyle = settings.computedStyle
      || (typeof getComputedStyle === "function" ? el => getComputedStyle(el) : null);
    const animate = settings.animate || ((element, keyframes, opts) => element.animate(keyframes, opts));
    const reducedMotion = settings.reducedMotion || (() => false);
    const notify = settings.onChange || (() => {});
    const timing = Object.assign(readTiming(mount, computedStyle), settings.timing || {});

    let phase = "normal";       // normal | opening | focused | closing
    let shown = null;           // the focus layer the DOM currently draws
    let svg = null;             // the current stage
    let slowdown = 1;
    let flight = null;          // the running transition, or null

    function state() {
      return {
        phase,
        focusLayer: flight ? flight.heading : shown,
        shown,
        inFlight: !!flight,
        heading: flight ? flight.heading : null
      };
    }

    function announce() { notify(state()); }

    function setTransitioning(on) {
      if (!mount.classList) return;
      if (on) mount.classList.add("is-transitioning");
      else mount.classList.remove("is-transitioning");
    }

    /* The agitators' phase, by layer, read before a swap and written after
     * it so the rotor never restarts. */
    function rotorPhases(root) {
      const out = {};
      if (!root || !root.querySelectorAll) return out;
      for (const layer of root.querySelectorAll("[data-role='layer']")) {
        const agitator = layer.querySelector && layer.querySelector(".station-mixer__agitator");
        const animations = agitator && typeof agitator.getAnimations === "function" ? agitator.getAnimations() : [];
        if (animations.length) out[layer.getAttribute("data-layer")] = animations[0].currentTime;
      }
      return out;
    }

    function restoreRotorPhases(root, phases) {
      if (!root || !root.querySelectorAll) return;
      for (const layer of root.querySelectorAll("[data-role='layer']")) {
        const id = layer.getAttribute("data-layer");
        if (!(id in phases)) continue;
        const agitator = layer.querySelector && layer.querySelector(".station-mixer__agitator");
        const animations = agitator && typeof agitator.getAnimations === "function" ? agitator.getAnimations() : [];
        for (const animation of animations) animation.currentTime = phases[id];
      }
    }

    function layerGroups(root) {
      const out = {};
      if (!root || !root.querySelectorAll) return out;
      for (const layer of root.querySelectorAll("[data-role='layer']")) out[layer.getAttribute("data-layer")] = layer;
      return out;
    }

    function partsOf(layer, roles) {
      const out = [];
      for (const role of roles) {
        const el = layer.querySelector ? layer.querySelector(`[data-role='${role}']`) : null;
        if (el) out.push(el);
      }
      return out;
    }

    function opacityOf(element) {
      if (!computedStyle) return 1;
      const value = parseFloat(computedStyle(element).opacity);
      return Number.isFinite(value) ? value : 1;
    }

    function play(element, keyframes, opts) {
      const animation = animate(element, keyframes, opts);
      if (animation && slowdown !== 1) animation.playbackRate = 1 / slowdown;
      return animation;
    }

    /* Render the destination and hand everything over: the rotor phases,
     * and the selection the source was showing. Returns the new stage. */
    function swap(focusLayer, raiseLayer) {
      const phases = rotorPhases(svg);
      svg = render(focusLayer, { raiseLayer });
      shown = focusLayer;
      restoreRotorPhases(svg, phases);
      return svg;
    }

    /* The whole FLIP for one swap: every object of every layer present in
     * both renders is placed over its old position and released; every
     * layer's opacity is carried from what it was to what it becomes.
     *
     * On the layer in transit the two objects do not set off together: the
     * train - the thing that was clicked - leads by `lead`, and the bank
     * follows, so the motion is seen to originate at the equipment. Closing
     * mirrors it (the bank leaves first, the train lands last), and a flight
     * reversed mid-way mirrors it of itself, because the same animations run
     * backwards. */
    function moveEverything(before, after, beforeMatrix, afterMatrix, oldOpacity, transit, opening) {
      const animations = [];
      const newBoxes = objectBoxes(after);
      const newLayers = layerGroups(after);
      // `both`: a reversed flight must HOLD its landing frame until the
      // source layout is rendered under it, or the far layout would show
      // for one frame. commit() removes every effect once the DOM is right.
      const move = { duration: timing.move, easing: timing.ease, fill: "both" };
      const follows = opening ? "cluster" : "train";
      for (const id of Object.keys(newLayers)) {
        const layer = newLayers[id];
        const from = before[id];
        const to = newBoxes[id];
        if (from && to) {
          for (const object of Object.keys(OBJECTS)) {
            const source = rebox(from[object], beforeMatrix, afterMatrix);
            const delta = flip(source, to[object]);
            const delay = id === transit && object === follows ? timing.lead : 0;
            for (const el of partsOf(layer, OBJECTS[object])) {
              animations.push(play(el, [{ transform: transformValue(delta) }, { transform: "none" }], Object.assign({ delay }, move)));
            }
          }
        }
        const was = id in oldOpacity ? oldOpacity[id] : 1;
        const becomes = opacityOf(layer);
        if (Math.abs(was - becomes) > 0.001) {
          animations.push(play(layer, [{ opacity: was }, { opacity: becomes }], move));
        }
      }
      return animations;
    }

    function workspaceOf(root) {
      return root && root.querySelector ? root.querySelector("[data-role='focus-workspace']") : null;
    }

    function allSettled(animations) {
      return Promise.all(animations.filter(Boolean).map(a => a.finished.catch(() => {})));
    }

    /* ---- the flight ------------------------------------------------ */

    function commit(focusLayer) {
      const done = flight;
      flight = null;
      if (done) for (const a of done.animations) { try { a.cancel(); } catch (error) { /* already gone */ } }
      // The DOM is only re-rendered when it does not already show the
      // layout being committed - a reversed flight lands on the source.
      if (shown !== focusLayer || (done && done.dirty)) {
        svg = render(focusLayer, {});
      } else if (!focusLayer) {
        // Landed back on the source render itself: take off the marks the
        // click put on it.
        for (const layer of Object.values(layerGroups(svg))) {
          if (!layer.classList) continue;
          for (const name of Array.from(layer.classList)) {
            if (name === "is-activating" || /^is-[a-z]+-selected$/.test(name)) layer.classList.remove(name);
          }
        }
      }
      shown = focusLayer;
      phase = focusLayer ? "focused" : "normal";
      setTransitioning(false);
      announce();
    }

    /* Waits on the flight's current animations; a stale generation (the
     * flight was reversed or settled meanwhile) is ignored. */
    function whenFinished(current, then) {
      const generation = ++current.generation;
      allSettled(current.animations).then(() => {
        if (flight !== current || current.generation !== generation) return;
        then();
      });
    }

    function start(target) {
      const from = shown;
      const kind = target ? (from ? "switch" : "open") : "close";
      const layer = target || from;
      phase = target ? "opening" : "closing";
      setTransitioning(true);
      const current = flight = { from, heading: target, layer, animations: [], generation: 0, swapped: false, dirty: false };
      announce();

      const before = objectBoxes(svg);
      const beforeMatrix = screenMatrix(svg);
      const oldLayers = layerGroups(svg);

      /* Stage A - acknowledge on the source render, before anything moves.
       * Opening: the clicked layer takes its accent, the others begin to
       * step back. Closing: the workspace recedes. The wait is itself an
       * animation, so slowdown and interruption treat it like the rest. */
      const ack = [];
      if (kind !== "close") {
        for (const id of Object.keys(oldLayers)) {
          if (id === layer) {
            if (oldLayers[id].classList) oldLayers[id].classList.add("is-activating");
          } else if (id !== from) {
            // Begin stepping back: to 0.6, or no brighter than it already is.
            const now = opacityOf(oldLayers[id]);
            ack.push(play(oldLayers[id], [{ opacity: now }, { opacity: Math.min(now, 0.6) }],
              { duration: timing.ack, easing: "ease-out", fill: "forwards" }));
          }
        }
      } else {
        const workspace = workspaceOf(svg);
        if (workspace) ack.push(play(workspace, [{ opacity: 1 }, { opacity: 0 }],
          { duration: timing.ack, easing: "ease-out", fill: "forwards" }));
      }
      ack.push(play(mount, [{ opacity: 1 }, { opacity: 1 }], { duration: timing.ack, fill: "none" }));
      current.animations = ack;

      whenFinished(current, () => {
        /* Stage B - the swap and the move. Opacity is read off the old
         * layers at this instant, so a layer that was mid-acknowledgement
         * continues from where it is rather than jumping. */
        const oldOpacity = {};
        for (const id of Object.keys(oldLayers)) oldOpacity[id] = opacityOf(oldLayers[id]);
        for (const a of current.animations) { try { a.cancel(); } catch (error) { /* ok */ } }
        const after = swap(target, layer);
        current.swapped = true;
        const afterMatrix = screenMatrix(after);
        const animations = moveEverything(before, after, beforeMatrix, afterMatrix, oldOpacity, layer, kind !== "close");
        /* Stage C - the destination's own chrome settles in over the end
         * of the move (which ends when the following object lands). */
        const workspace = workspaceOf(after);
        if (workspace) {
          animations.push(play(workspace, [{ opacity: 0 }, { opacity: 1 }],
            { duration: timing.settle, delay: Math.max(0, timing.move + timing.lead - timing.settle), easing: "ease-out", fill: "both" }));
        }
        current.animations = animations;
        whenFinished(current, () => commit(current.heading));
      });
    }

    /* Turn the running flight around where it is. */
    function reverse() {
      const current = flight;
      if (!current) return;
      const heading = current.from;
      current.from = current.heading;
      current.heading = heading;
      phase = heading ? "opening" : "closing";
      // The DOM shows the far layout once swapped; landing on the near one
      // then needs a render at commit.
      current.dirty = current.swapped;
      for (const a of current.animations) { try { a.reverse(); } catch (error) { /* ok */ } }
      if (!current.swapped) {
        // Still acknowledging: nothing has moved, so just take it back.
        for (const layer of Object.values(layerGroups(svg))) {
          if (layer.classList) layer.classList.remove("is-activating");
        }
        current.dirty = false;
      }
      announce();
      whenFinished(current, () => commit(current.heading));
    }

    /* Land the running flight instantly, at wherever it was heading. */
    function settle() {
      const current = flight;
      if (!current) return;
      for (const a of current.animations) { try { a.finish(); } catch (error) { /* ok */ } }
      current.dirty = current.dirty || !current.swapped || shown !== current.heading;
      commit(current.heading);
    }

    /* ---- the public surface ---------------------------------------- */

    /**
     * Ask for a focus state: a layer id to open, or null to close.
     */
    function request(target) {
      const next = target || null;
      if (reducedMotion()) {
        settle();
        if (next !== shown) {
          svg = render(next, {});
          shown = next;
          const workspace = workspaceOf(svg);
          if (workspace) play(workspace, [{ opacity: 0 }, { opacity: 1 }], { duration: timing.settle, fill: "none" });
        }
        phase = next ? "focused" : "normal";
        announce();
        return;
      }
      if (flight) {
        if (next === flight.heading) return;
        if (next === flight.from) { reverse(); return; }
        settle();
      }
      if (next === shown) return;
      start(next);
    }

    /* Re-draw the current state (the line changed under us, or the very
     * first draw). Any flight lands first. */
    function refresh(focusLayer) {
      const next = focusLayer === undefined ? (flight ? flight.heading : shown) : (focusLayer || null);
      settle();
      svg = render(next, {});
      shown = next;
      phase = next ? "focused" : "normal";
      announce();
    }

    function setSlowdown(factor) {
      slowdown = Number.isFinite(factor) && factor > 0 ? factor : 1;
      if (flight) for (const a of flight.animations) if (a) a.playbackRate = (a.playbackRate < 0 ? -1 : 1) / slowdown;
    }

    return {
      request,
      open: layer => request(layer),
      close: () => request(null),
      refresh,
      settle,
      reverse,
      setSlowdown,
      getSlowdown: () => slowdown,
      getState: state,
      getTiming: () => Object.assign({}, timing),
      /* Development: the animations in flight, for scrubbing. */
      animations: () => (flight ? flight.animations.slice() : [])
    };
  }

  return { DEFAULT_TIMING, OBJECTS, readTiming, parseBox, objectBoxes, screenMatrix, rebox, flip, transformValue, overlayTransform, play, createController };
});
