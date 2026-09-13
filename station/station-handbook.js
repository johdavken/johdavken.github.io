/* The Operator Handbook: the launcher in the stage's corner, and the panel
 * it opens across the lower half of the workspace.
 *
 * WHAT IT IS
 *
 * The one place on the Station desktop for the operator-facing work that
 * does not belong permanently on the stage. It holds the Recipe Book
 * (station-recipe-book.js), Resin Totals and Appearance, and it is built
 * as a shell that holds sections, so the next one is a section added to
 * the list this file is handed and not a second panel beside the first.
 * That is the whole of the architecture: a launcher, a panel, tabs for
 * the sections it was given, and the body they draw into. There is no
 * registry, no plugin surface, no message bus. Blend Edit is not the
 * Handbook's: the mode is switched from the machine utility rail
 * (station-machine-rail.js), and the Handbook opens, closes and turns its
 * pages the same with the mode on as off.
 *
 * A SECTION
 *
 *   { id, title, create(doc, context) -> { element, update(), focus() } }
 *
 * create() is called once, when the Handbook is built, with the context
 * the boot file gave the Handbook (the bridges it may use); update() is
 * called whenever the Handbook is told something
 * changed, and on opening; focus() when the section is shown.
 *
 * WHERE IT OPENS, AND HOW
 *
 * Over the stage's lower half - the same grid cell as the machine, laid
 * on top (shell.css, handbook.css) - centred, at a fixed width, no taller
 * than half the stage. The hoppers in the upper half are untouched and
 * still take the pointer: Blend Edit's cards work on them while this is
 * open, and the Recipe Book can be read beside them.
 * Nothing is dimmed and nothing moves; opening the Handbook is not a
 * modal and changes no state but its own.
 *
 * Opening is a flight, in the convention station-transition.js set for a
 * layer: the panel is rendered where it will stand, then placed over the
 * launcher with a translate and one uniform scale and released, on the
 * same motion tokens (ack, move, settle, ease) read off the stylesheet.
 * Closing reverses the same animation in place, so a panel asked to close
 * while opening turns around where it is. Reduced motion keeps the state
 * change and drops the travel.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only, and only for this screen: whether the panel is
 * open, which section is showing, the flight in progress. Nothing here
 * reads the job or writes to it; the sections do that through what they
 * were handed.
 */
(function (root, factory) {
  const transition = typeof require === "function"
    ? require("./station-transition.js")
    : (root && root.PolynStationTransition);
  const api = factory(transition);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationHandbook = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (transitionModule) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* The motion tokens' values, as the transition module carries them, for
   * a document whose stylesheet cannot be read (tests). */
  const DEFAULT_TIMING = transitionModule && transitionModule.DEFAULT_TIMING
    ? transitionModule.DEFAULT_TIMING
    : Object.freeze({ ack: 80, move: 300, lead: 40, settle: 120, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" });

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

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  /* --------------------------------------------------------------------
   *   The launcher's icon
   * ------------------------------------------------------------------
   * An open handbook on a tile, 64 by 64: a written page on the left, a
   * blend's rows - three layer colours - on the right, a ribbon in the
   * accent. Drawn here, in Station's tokens (handbook.css), so it follows
   * the theme; no image asset, no glyph from a font. */
  function launcherIcon(doc) {
    const svg = svgNode(doc, "svg", "station-handbook__icon", {
      viewBox: "0 0 64 64", width: "64", height: "64", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "rect", "station-handbook__icon-plate", { x: 1.5, y: 1.5, width: 61, height: 61, rx: 14 }));
    // Left page, right page: two leaves meeting at the spine, each curving
    // up from it as an open book's do.
    svg.appendChild(svgNode(doc, "path", "station-handbook__icon-page", {
      d: "M 31 18 C 26 14.5 18 14 11 15.5 L 11 46 C 18 44.5 26 45 31 48.5 Z"
    }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__icon-page", {
      d: "M 33 18 C 38 14.5 46 14 53 15.5 L 53 46 C 46 44.5 38 45 33 48.5 Z"
    }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__icon-spine", { d: "M 32 18 L 32 49" }));
    // The written page: four lines, the last one short.
    for (const [index, width] of [[0, 12], [1, 12], [2, 12], [3, 7]].values()) {
      const y = 23 + index * 5.5;
      svg.appendChild(svgNode(doc, "path", "station-handbook__icon-line", { d: `M 15.5 ${y} L ${15.5 + width} ${y + 0.6}` }));
    }
    // The blend page: three rows in the layers' colours, each a bar whose
    // length is its share.
    const rows = [["", 12], ["station-handbook__icon-row--core", 8], ["station-handbook__icon-row--inside", 10]];
    rows.forEach(([modifier, width], index) => {
      svg.appendChild(svgNode(doc, "rect", `station-handbook__icon-row${modifier ? ` ${modifier}` : ""}`, {
        x: 37, y: 22 + index * 7, width, height: 3.5, rx: 1.5
      }));
    });
    // The ribbon, hanging from the top of the right page.
    svg.appendChild(svgNode(doc, "path", "station-handbook__icon-ribbon", { d: "M 45 15 L 50 15 L 50 27 L 47.5 24.5 L 45 27 Z" }));
    return svg;
  }

  /* --------------------------------------------------------------------
   *   The Handbook
   * ------------------------------------------------------------------ */

  /**
   * Build the Handbook.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {Array} options.sections     the sections, in tab order; each
   *        { id, title, create(doc, context) }. The first is shown first.
   * @param {object} [options.context]   handed to every section's create()
   * @param {Element} [options.mount]    the element the motion tokens are
   *        read off (the slot); defaults are used when none is given
   * @param {function} [options.reducedMotion]  () => boolean
   * @param {function} [options.animate]  (element, keyframes, options) => Animation
   * @param {function} [options.measure]  (element) => client rect
   * @param {function} [options.computedStyle]  (element) => CSSStyleDeclaration
   * @param {object} [options.timing]    overrides for the token timing
   * @param {function} [options.onOpenChange]  (open) => void
   * @param {function} [options.beforeClose]   () => void, run first on every
   *   close - Close, the launcher, Escape inside the panel, close() - before
   *   the panel goes; the boot file finishes what the panel was hosting.
   */
  function create(doc, options) {
    const settings = options || {};
    const sections = (Array.isArray(settings.sections) ? settings.sections : [])
      .filter(section => section && typeof section.id === "string" && section.id && typeof section.create === "function");
    const context = settings.context || {};
    const reducedMotion = typeof settings.reducedMotion === "function" ? settings.reducedMotion : () => false;
    /* Motion runs through the transition module's own helper, the one
     * place Station animates; a test may hand in a recorder instead. */
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
    const beforeClose = typeof settings.beforeClose === "function" ? settings.beforeClose : () => {};

    const state = {
      open: false,
      current: sections.length ? sections[0].id : null,
      flight: null   // { animations, closing } while the panel travels
    };

    const rootEl = element(doc, "div", "station-handbook", { "data-role": "handbook" });

    /* ---- Launcher ---- */
    const launcher = element(doc, "button", "station-handbook__launcher", {
      type: "button",
      "data-action": "toggle-handbook",
      "aria-expanded": "false",
      "aria-label": "Operator Handbook",
      title: "Operator Handbook"
    });
    launcher.appendChild(launcherIcon(doc));
    rootEl.appendChild(launcher);

    /* ---- Panel ---- */
    const panel = element(doc, "section", "station-handbook__panel", {
      role: "region", "aria-label": "Operator Handbook", hidden: ""
    });
    const head = element(doc, "header", "station-handbook__head");
    head.appendChild(text(doc, "h2", "station-handbook__title", "Operator Handbook"));
    const tabs = element(doc, "div", "station-handbook__tabs", { role: "tablist", "aria-label": "Handbook sections" });
    head.appendChild(tabs);
    const closeButton = text(doc, "button", "station-handbook__close", "Close", {
      type: "button", "data-action": "close-handbook", title: "Close the Handbook (Esc)"
    });
    head.appendChild(closeButton);
    panel.appendChild(head);
    const body = element(doc, "div", "station-handbook__body");
    panel.appendChild(body);
    rootEl.appendChild(panel);

    /* ---- Sections ---- */
    const built = {};
    for (const section of sections) {
      const tab = text(doc, "button", "station-handbook__tab", String(section.title || section.id), {
        type: "button", role: "tab", "data-section": section.id, "aria-pressed": "false", "aria-selected": "false"
      });
      tabs.appendChild(tab);
      const host = element(doc, "div", "station-handbook__section", { "data-section": section.id, role: "tabpanel", hidden: "" });
      let instance = null;
      try {
        instance = section.create(doc, context) || null;
      } catch (error) {
        instance = null;
      }
      if (instance && instance.element) host.appendChild(instance.element);
      body.appendChild(host);
      built[section.id] = { section, tab, host, instance };
    }

    function showSection(id) {
      if (!built[id]) return false;
      state.current = id;
      for (const key of Object.keys(built)) {
        const on = key === id;
        built[key].tab.setAttribute("aria-pressed", on ? "true" : "false");
        built[key].tab.setAttribute("aria-selected", on ? "true" : "false");
        show(built[key].host, on);
      }
      const current = built[id].instance;
      if (current && typeof current.update === "function") current.update();
      return true;
    }
    if (state.current) showSection(state.current);

    /* ---- Opening and closing ---- */

    function announce() {
      launcher.setAttribute("aria-expanded", state.open ? "true" : "false");
      rootEl.classList.toggle("is-open", state.open);
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

    /* The panel's arrival: rendered where it stands, placed over the
     * launcher - the transform that lays its box over the launcher's, a
     * translate and one uniform scale from its top-left corner - and
     * released to identity. The same arithmetic station-transition.js
     * uses for a bank, on the same tokens. */
    function flightTransform() {
      if (!transitionModule || typeof transitionModule.overlayTransform !== "function") return null;
      return transitionModule.overlayTransform(measure(launcher), measure(panel));
    }

    function open() {
      if (state.open && !(state.flight && state.flight.closing)) return false;
      const wasClosing = !!(state.flight && state.flight.closing);
      state.open = true;
      show(panel, true);
      const current = state.current ? built[state.current] : null;
      if (current && current.instance && typeof current.instance.update === "function") current.instance.update();
      announce();
      if (wasClosing) {
        // Turned around mid-flight: the same animations run back to open.
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
      if (current && current.instance && typeof current.instance.focus === "function") current.instance.focus();
      return true;
    }

    function hideNow() {
      show(panel, false);
      cancelFlight();
    }

    /* The one way out. Whatever closes the panel comes through here, so
     * what has to happen before it goes - a mode the panel's own Done
     * would have ended - happens once, first, on every path. */
    function close() {
      if (!state.open) return false;
      beforeClose();
      state.open = false;
      announce();
      if (reducedMotion() || !state.flight) {
        // No flight to reverse: leave along the same path the panel came
        // in on, when motion is wanted, or at once.
        const transform = reducedMotion() ? null : flightTransform();
        if (!transform) { hideNow(); if (typeof launcher.focus === "function") launcher.focus(); return true; }
        const animations = [
          animate(panel, [{ transform: "none", opacity: 1 }, { transform, opacity: 0.3 }],
            { duration: timing.move, easing: timing.ease, fill: "both" })
        ].filter(Boolean);
        const flight = { animations, closing: true };
        state.flight = flight;
        settled(animations).then(() => { if (!state.open) hideNow(); });
        if (typeof launcher.focus === "function") launcher.focus();
        return true;
      }
      // Still arriving: turn around where it is. When it lands, a panel
      // that is still closed is hidden - whatever became of the flight
      // record meanwhile (a reopening replaces it; a hidden closed panel is
      // right either way).
      const flight = state.flight;
      flight.closing = true;
      for (const animation of flight.animations) { try { animation.reverse(); } catch (error) { /* ok */ } }
      settled(flight.animations).then(() => { if (!state.open) hideNow(); });
      if (typeof launcher.focus === "function") launcher.focus();
      return true;
    }

    function toggle() {
      return state.open ? close() : open();
    }

    launcher.addEventListener("click", toggle);
    closeButton.addEventListener("click", () => { close(); });
    tabs.addEventListener("click", event => {
      const tab = event.target && event.target.closest ? event.target.closest("[data-section]") : null;
      if (!tab) return;
      showSection(tab.getAttribute("data-section"));
    });
    // Escape inside the panel closes it and is spent here; anywhere else
    // it stays the boot file's.
    panel.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      if (typeof event.preventDefault === "function") event.preventDefault();
      close();
    });

    /* Tell every section something changed; the one showing redraws. */
    function update() {
      for (const key of Object.keys(built)) {
        const instance = built[key].instance;
        if (instance && typeof instance.update === "function") instance.update();
      }
    }

    return {
      element: rootEl,
      launcher,
      panel,
      open,
      close,
      toggle,
      update,
      show: showSection,
      isOpen: () => state.open,
      current: () => state.current,
      sections: () => sections.map(section => section.id),
      section: id => (built[id] ? built[id].instance : null),
      getTiming: () => Object.assign({}, timing)
    };
  }

  return Object.freeze({ DEFAULT_TIMING, launcherIcon, create });
});
