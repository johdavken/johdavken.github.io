/* The Station window: the frame every floating utility surface stands in.
 *
 * WHAT IT IS
 *
 * One box of glass with a title bar and a body, spawned at the centre of
 * the stage's cell, that opens out of a tile on the rail and returns to
 * it. The Winding Tension calculator and Resin Totals are windows; the
 * next tool will be one too. What a window holds is its owner's: the
 * owner builds its content into the body this module hands back, and
 * reads or writes the readout in the bar. Nothing here knows what a
 * window is for.
 *
 * THE TITLE BAR
 *
 * A handle. Held by the pointer, the frame goes anywhere within the
 * stage's cell and never off it; on the tab order, the arrow keys move
 * it a space-4 a press and Home puts it back at the centre. Where it was
 * put is where it opens next, brought back within the cell as the cell
 * stands then. Close is the window's own control: the small round
 * button at the bar's right, wordless on the glass, named for assistive
 * tech, its cross shown while the pointer is on the bar. The same button
 * closes the Operator Handbook and the Changeover Calculator, which are
 * not windows but take the window vocabulary for it (window.css).
 *
 * THE FLIGHT
 *
 * The Changeover Calculator's, verbatim: the frame is rendered where it
 * stands and released from a transform that lays it over its tile, on
 * the transition's tokens; closing reverses it; reduced motion drops the
 * travel. The frame's place on the cell is a translate UNDER the flight's
 * transform (window.css), so the two compose and a flight is measured
 * from wherever the frame stands.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: whether it is open, the flight in progress,
 * where the frame was put, and the drag in hand. Nothing is stored,
 * nothing is dispatched.
 */
(function (root, factory) {
  const transition = typeof require === "function"
    ? require("./station-transition.js")
    : (root && root.PolynStationTransition);
  const api = factory(transition);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationWindow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (transitionModule) {
  "use strict";

  const DEFAULT_TIMING = transitionModule && transitionModule.DEFAULT_TIMING
    ? transitionModule.DEFAULT_TIMING
    : Object.freeze({ ack: 80, move: 300, lead: 40, settle: 120, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" });

  /* The window vocabulary (window.css): the bar, its controls, the body. */
  const CLASS = Object.freeze({
    root: "station-window",
    panel: "station-window__panel",
    bar: "station-window__bar",
    title: "station-window__title",
    readout: "station-window__readout",
    close: "station-window__close",
    body: "station-window__body"
  });

  /* One arrow key's move of the frame, in px: a space-4 (tokens.css). */
  const NUDGE = 16;

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /* The Close control alone, for a surface that is not a window (the
   * Handbook, the Changeover Calculator) but closes with the same button. */
  function closeButton(doc, action, title, className) {
    return element(doc, "button", className ? `${CLASS.close} ${className}` : CLASS.close, {
      type: "button", "data-action": action, "aria-label": "Close", title: title || "Close (Esc)"
    });
  }

  /**
   * Build a window.
   *
   * @param {Document} doc
   * @param {object}   options
   * @param {string}   options.name         the window's key: data-window, and
   *        its Close's action "close-<name>"
   * @param {string}   options.title        the words on the bar
   * @param {string}   [options.label]      the region's name (the title)
   * @param {string}   [options.className]  a class of the owner's on the panel,
   *        for its size (the owner's sheet)
   * @param {string}   [options.closeTitle] Close's tooltip
   * @param {Element}  [options.anchor]     the rail's tile the window opens
   *        out of and returns to
   * @param {Element}  [options.mount]      the element the motion tokens are read off
   * @param {function} [options.reducedMotion]  () => boolean
   * @param {function} [options.animate]    (element, keyframes, options) => Animation
   * @param {function} [options.measure]    (element) => client rect
   * @param {function} [options.computedStyle]
   * @param {object}   [options.timing]
   * @param {function} [options.onOpenChange]  (open) => void
   * @param {function} [options.focus]      () => Element to focus once open
   */
  function create(doc, options) {
    const settings = options || {};
    const name = String(settings.name || "window");
    const reducedMotion = typeof settings.reducedMotion === "function" ? settings.reducedMotion : () => false;
    const animate = typeof settings.animate === "function"
      ? settings.animate
      : (el, keyframes, opts) => (transitionModule && typeof transitionModule.play === "function" ? transitionModule.play(el, keyframes, opts) : null);
    const measure = typeof settings.measure === "function"
      ? settings.measure
      : el => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);
    const computedStyle = settings.computedStyle
      || (typeof getComputedStyle === "function" ? el => getComputedStyle(el) : null);
    const timing = Object.assign({},
      transitionModule && typeof transitionModule.readTiming === "function" && settings.mount
        ? transitionModule.readTiming(settings.mount, computedStyle)
        : DEFAULT_TIMING,
      settings.timing || {});
    const onOpenChange = typeof settings.onOpenChange === "function" ? settings.onOpenChange : () => {};
    const focusTarget = typeof settings.focus === "function" ? settings.focus : () => null;
    const anchor = settings.anchor || null;

    const state = {
      open: false,
      flight: null,          // { animations, closing }
      place: { x: 0, y: 0 }, // where the frame was put, from the centre
      drag: null             // { pointerId, x, y, from, bounds } while the bar is held
    };

    const rootEl = element(doc, "div", CLASS.root, { "data-window": name });
    const panel = element(doc, "section", settings.className ? `${CLASS.panel} station-glass ${settings.className}` : `${CLASS.panel} station-glass`, {
      role: "region", "aria-label": settings.label || settings.title || name, hidden: ""
    });
    const bar = element(doc, "header", CLASS.bar, {
      "data-role": "title-bar", tabindex: "0",
      "aria-label": `${settings.title || name} window. Drag to move, or use the arrow keys; Home puts it back.`,
      title: "Drag to move"
    });
    bar.appendChild(text(doc, "h2", CLASS.title, settings.title || name));
    const readout = text(doc, "span", CLASS.readout, "");
    bar.appendChild(readout);
    const closeControl = closeButton(doc, `close-${name}`, settings.closeTitle);
    bar.appendChild(closeControl);
    panel.appendChild(bar);
    const body = element(doc, "div", CLASS.body);
    panel.appendChild(body);
    rootEl.appendChild(panel);

    /* ---- Moving: the bar in hand ----
     * The frame's place is two custom properties on it, which the sheet
     * lays on as a translate from the centre (window.css). Kept within
     * the window's root: the slot's box, the one place a window can be. */

    function paintPlace() {
      const style = panel.style;
      if (!style || typeof style.setProperty !== "function") return;
      if (!state.place.x && !state.place.y) {
        style.removeProperty("--station-window-x");
        style.removeProperty("--station-window-y");
        return;
      }
      style.setProperty("--station-window-x", `${Math.round(state.place.x)}px`);
      style.setProperty("--station-window-y", `${Math.round(state.place.y)}px`);
    }

    /* How far the frame may go from the centre: the slot's box less the
     * frame's own. Null while there is nothing to measure. */
    function room() {
      const slot = measure(rootEl);
      const box = measure(panel);
      if (!slot || !box || !(box.width > 0) || !(slot.width > 0)) return null;
      const base = { left: box.left - state.place.x, top: box.top - state.place.y };
      return {
        minX: slot.left - base.left, maxX: slot.right - box.width - base.left,
        minY: slot.top - base.top, maxY: slot.bottom - box.height - base.top
      };
    }

    function within(value, low, high) {
      return Math.min(Math.max(value, low), Math.max(low, high));
    }

    function moveTo(x, y, bounds) {
      const b = bounds || room();
      state.place = b
        ? { x: within(x, b.minX, b.maxX), y: within(y, b.minY, b.maxY) }
        : { x, y };
      paintPlace();
      return Object.assign({}, state.place);
    }

    function endMove(event) {
      const drag = state.drag;
      if (!drag || (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      state.drag = null;
      panel.removeAttribute("data-moving");
    }

    bar.addEventListener("pointerdown", event => {
      if (!state.open || (event.button !== undefined && event.button !== 0)) return;
      const target = event.target;
      // A press on a control on the bar is the control's, not a drag.
      if (target && target !== bar && typeof target.closest === "function" && target.closest("[data-action]")) return;
      const bounds = room();
      if (!bounds) return;
      state.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: Object.assign({}, state.place), bounds };
      panel.setAttribute("data-moving", "");
      if (typeof bar.setPointerCapture === "function" && event.pointerId !== undefined) {
        try { bar.setPointerCapture(event.pointerId); } catch (error) { /* it drags while the pointer stays on the bar */ }
      }
      if (typeof event.preventDefault === "function") event.preventDefault();
    });
    bar.addEventListener("pointermove", event => {
      const drag = state.drag;
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      moveTo(drag.from.x + (event.clientX - drag.x), drag.from.y + (event.clientY - drag.y), drag.bounds);
    });
    bar.addEventListener("pointerup", endMove);
    bar.addEventListener("pointercancel", endMove);
    bar.addEventListener("lostpointercapture", endMove);
    bar.addEventListener("keydown", event => {
      if (event.target !== bar) return;
      const now = state.place;
      let next;
      if (event.key === "ArrowLeft") next = { x: now.x - NUDGE, y: now.y };
      else if (event.key === "ArrowRight") next = { x: now.x + NUDGE, y: now.y };
      else if (event.key === "ArrowUp") next = { x: now.x, y: now.y - NUDGE };
      else if (event.key === "ArrowDown") next = { x: now.x, y: now.y + NUDGE };
      else if (event.key === "Home") next = { x: 0, y: 0 };
      else return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      moveTo(next.x, next.y);
    });

    /* ---- Opening and closing: the flight ---- */

    function announce() {
      rootEl.classList.toggle("is-open", state.open);
      if (anchor && typeof anchor.setAttribute === "function") anchor.setAttribute("aria-expanded", state.open ? "true" : "false");
      onOpenChange(state.open);
    }

    function cancelFlight() {
      const flight = state.flight;
      state.flight = null;
      if (!flight) return;
      for (const animation of flight.animations) { try { animation.cancel(); } catch (error) { /* gone */ } }
    }

    function settled(animations) {
      return Promise.all(animations.filter(Boolean).map(a => (a.finished ? a.finished.catch(() => {}) : Promise.resolve())));
    }

    function flightTransform() {
      if (!anchor || !transitionModule || typeof transitionModule.overlayTransform !== "function") return null;
      return transitionModule.overlayTransform(measure(anchor), measure(panel));
    }

    function open() {
      if (state.open && !(state.flight && state.flight.closing)) return false;
      const wasClosing = !!(state.flight && state.flight.closing);
      state.open = true;
      show(panel, true);
      // Where it was put, brought back within the cell as it stands now.
      if (state.place.x || state.place.y) moveTo(state.place.x, state.place.y);
      announce();
      if (wasClosing) {
        const flight = state.flight;
        flight.closing = false;
        for (const animation of flight.animations) { try { animation.reverse(); } catch (error) { /* ok */ } }
        settled(flight.animations).then(() => { if (state.flight === flight) state.flight = null; });
        return true;
      }
      cancelFlight();
      const transform = reducedMotion() ? null : flightTransform();
      if (transform) {
        const move = { duration: timing.move, easing: timing.ease, fill: "both" };
        const animations = [
          animate(panel, [{ transform, opacity: 0.3 }, { transform: "none", opacity: 1 }], move),
          animate(body, [{ opacity: 0 }, { opacity: 1 }],
            { duration: timing.settle, delay: Math.max(0, timing.move - timing.settle), easing: "ease-out", fill: "both" })
        ].filter(Boolean);
        const flight = { animations, closing: false };
        state.flight = flight;
        settled(animations).then(() => { if (state.flight === flight) state.flight = null; });
      }
      const target = focusTarget();
      if (target && typeof target.focus === "function") target.focus();
      return true;
    }

    function hideNow() {
      show(panel, false);
      cancelFlight();
      endMove();
    }

    function returnFocus() {
      if (anchor && typeof anchor.focus === "function") anchor.focus();
    }

    function close() {
      if (!state.open) return false;
      state.open = false;
      endMove();
      announce();
      if (reducedMotion() || !state.flight) {
        const transform = reducedMotion() ? null : flightTransform();
        if (!transform) { hideNow(); returnFocus(); return true; }
        const animations = [
          animate(panel, [{ transform: "none", opacity: 1 }, { transform, opacity: 0.3 }],
            { duration: timing.move, easing: timing.ease, fill: "both" })
        ].filter(Boolean);
        const flight = { animations, closing: true };
        state.flight = flight;
        settled(animations).then(() => { if (!state.open) hideNow(); });
        returnFocus();
        return true;
      }
      const flight = state.flight;
      flight.closing = true;
      for (const animation of flight.animations) { try { animation.reverse(); } catch (error) { /* ok */ } }
      settled(flight.animations).then(() => { if (!state.open) hideNow(); });
      returnFocus();
      return true;
    }

    function toggle() {
      return state.open ? close() : open();
    }

    closeControl.addEventListener("click", () => { close(); });
    panel.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      if (typeof event.preventDefault === "function") event.preventDefault();
      close();
    });

    // The tile is the launcher from the start: closed, and said so.
    if (anchor && typeof anchor.setAttribute === "function") anchor.setAttribute("aria-expanded", "false");

    return {
      element: rootEl,
      panel,
      bar,
      body,
      readout,
      closeButton: closeControl,
      open,
      close,
      toggle,
      isOpen: () => state.open,
      place: () => Object.assign({}, state.place),
      moveTo: (x, y) => moveTo(x, y),
      getTiming: () => Object.assign({}, timing)
    };
  }

  /* A finite motion on the transition's tokens, for what a window's
   * owner animates inside it (the range's sweep): the transition
   * module's play, so no window file animates on its own. */
  function play(el, keyframes, options) {
    return transitionModule && typeof transitionModule.play === "function" ? transitionModule.play(el, keyframes, options) : null;
  }

  return Object.freeze({ DEFAULT_TIMING, CLASS, NUDGE, closeButton, play, create });
});
