/* The card rail: the short column of controls riding the right side of
 * the far-right layer card while Blend Edit is on.
 *
 * WHAT IT IS
 *
 * Two switches, then two moves under them, and nothing that unfolds.
 * Each switch changes how EVERY card on the stage shows, at once, and
 * shows that state as its own; each move takes the face's recipe one
 * edit back, or forward.
 *
 *   Compare     the other recipe's resin under every row that differs -
 *               the plan's on the Current face, the running job's on the
 *               Next face - on every card at once. Once the eye at each
 *               card's foot, one card at a time; there was never a
 *               reason to open one card's and not the rest, so it is one
 *               switch here. Held, with the reason, on the Weights face
 *               (no other recipe there) and while nothing is planned.
 *   Large       the cards' other size: the type on every card up by a
 *               quarter, the cards themselves as they are (focus-editor
 *               .css reads the size off each card's group, which the
 *               renderer stamps in place). Every face has it.
 *   Undo        the face's recipe one edit back: the application's own
 *   Redo        history for that recipe (its Recipe grid's toolbar has
 *               the same pair), asked for through the boot file as one
 *               command each. Held, with the reason, while the bridge
 *               says there is nothing to take back or put back, on the
 *               Weights face (the weights keep no edit history) and
 *               where the command is not on offer.
 *
 * WHERE IT STANDS
 *
 * In the drawing, not over it: the renderer (station-render.js) carries
 * the element in a <foreignObject> stood against the far-right bank's
 * card box, top-aligned, a gap off its right edge - so it rides the
 * card whatever the line, scales with the drawing as the cards do, and
 * is gone with them when the mode ends. Nothing is measured.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: what each control was last told to show. It
 * reads no job, keeps no mode of its own and dispatches nothing - a
 * click is handed to the boot file, which keeps the two switches' states
 * for the session, asks the application for an undo or a redo, and tells
 * the rail (update()) and the cards what to show.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationCardRail = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* The tile, in canvas units: the card's own controls' size - the layer
   * menu's dots and the eye that stood at the foot were this tall - and
   * the gap between two. The glyphs are drawn 20 by 20 and set on the
   * plate at this size. */
  const TILE = 26;
  const GAP = 6;
  const GLYPH = 20;

  const LABEL = Object.freeze({
    compare: "Compare",
    large: "Large cards",
    undo: "Undo",
    redo: "Redo"
  });

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

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  /* A tile: the plate, and a glyph on it, every part in the control's
   * own colour (focus-editor.css) so each follows its control through
   * hover, pressed and held. */
  function glyphTile(doc) {
    const svg = svgNode(doc, "svg", "station-card-rail__glyph", {
      viewBox: `0 0 ${GLYPH} ${GLYPH}`, width: String(TILE), height: String(TILE), "aria-hidden": "true", focusable: "false"
    });
    return svg;
  }

  /* Compare: the eye the cards' feet wore - a lens and a pupil. */
  function compareGlyph(doc) {
    const svg = glyphTile(doc);
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", {
      d: "M 2.5 10 C 4.5 6.2 7 4.5 10 4.5 C 13 4.5 15.5 6.2 17.5 10 C 15.5 13.8 13 15.5 10 15.5 C 7 15.5 4.5 13.8 2.5 10 Z"
    }));
    svg.appendChild(svgNode(doc, "circle", "station-card-rail__glyph-fill", { cx: 10, cy: 10, r: 2.4 }));
    return svg;
  }

  /* Large: a card, and the arrow that stretches it - its top and bottom
   * edges with a double-headed arrow between, the width unchanged. */
  function largeGlyph(doc) {
    const svg = glyphTile(doc);
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", { d: "M 4 3.5 L 16 3.5" }));
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", { d: "M 4 16.5 L 16 16.5" }));
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", { d: "M 10 6 L 10 14" }));
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", { d: "M 7.5 8.5 L 10 6 L 12.5 8.5" }));
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", { d: "M 7.5 11.5 L 10 14 L 12.5 11.5" }));
    return svg;
  }

  /* Undo and Redo: one arrow each, curling back over itself to the left
   * and to the right - the pair every toolbar draws, so they read at a
   * glance. Mirror images: the same path flipped about the tile's
   * centre line. */
  function historyGlyph(doc, forward) {
    const svg = glyphTile(doc);
    const mirror = forward ? { transform: `translate(${GLYPH} 0) scale(-1 1)` } : {};
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", Object.assign({ d: "M 4 8.5 L 11.5 8.5 C 14.5 8.5 16.5 10.3 16.5 12.8 C 16.5 15.3 14.5 17 11.5 17 L 8 17" }, mirror)));
    svg.appendChild(svgNode(doc, "path", "station-card-rail__glyph-stroke", Object.assign({ d: "M 7.2 5 L 3.5 8.5 L 7.2 12" }, mirror)));
    return svg;
  }

  function undoGlyph(doc) { return historyGlyph(doc, false); }
  function redoGlyph(doc) { return historyGlyph(doc, true); }

  /**
   * Build the rail.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {function} [options.onCompare] () => void; the Compare switch was clicked
   * @param {function} [options.onSize]    () => void; the Large switch was clicked
   * @param {function} [options.onUndo]    () => void; Undo was clicked
   * @param {function} [options.onRedo]    () => void; Redo was clicked
   * @returns {{ element, compareButton, sizeButton, undoButton, redoButton, update, getState }}
   */
  function create(doc, options) {
    const settings = options || {};
    const onCompare = typeof settings.onCompare === "function" ? settings.onCompare : () => {};
    const onSize = typeof settings.onSize === "function" ? settings.onSize : () => {};
    const onUndo = typeof settings.onUndo === "function" ? settings.onUndo : () => {};
    const onRedo = typeof settings.onRedo === "function" ? settings.onRedo : () => {};

    const state = {
      compare: { active: false, available: true, reason: "" },
      size: "normal",
      /* The history pair: whether the recipe has an edit to take back or
       * put back, whether the application offers the pair at all, and
       * why not when it does not. */
      history: { canUndo: false, canRedo: false, available: false, reason: "" }
    };

    const rootEl = element(doc, "div", "station-card-rail", { "data-role": "card-rail", role: "group", "aria-label": "Card display" });

    const compareButton = element(doc, "button", "station-card-rail__control", {
      type: "button", "data-action": "compare", "aria-pressed": "false", "aria-label": LABEL.compare, title: LABEL.compare
    });
    compareButton.appendChild(compareGlyph(doc));
    compareButton.addEventListener("click", event => {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      if (compareButton.disabled) return;
      onCompare();
    });
    rootEl.appendChild(compareButton);

    const sizeButton = element(doc, "button", "station-card-rail__control", {
      type: "button", "data-action": "size", "aria-pressed": "false", "aria-label": LABEL.large, title: LABEL.large
    });
    sizeButton.appendChild(largeGlyph(doc));
    sizeButton.addEventListener("click", event => {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      onSize();
    });
    rootEl.appendChild(sizeButton);

    /* The history pair, under the switches with a step between: momentary
     * controls, not switches - no pressed state, just held or not. */
    const undoButton = element(doc, "button", "station-card-rail__control station-card-rail__control--history", {
      type: "button", "data-action": "undo", "aria-label": LABEL.undo, title: LABEL.undo
    });
    undoButton.appendChild(undoGlyph(doc));
    undoButton.addEventListener("click", event => {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      if (undoButton.disabled) return;
      onUndo();
    });
    rootEl.appendChild(undoButton);

    const redoButton = element(doc, "button", "station-card-rail__control", {
      type: "button", "data-action": "redo", "aria-label": LABEL.redo, title: LABEL.redo
    });
    redoButton.appendChild(redoGlyph(doc));
    redoButton.addEventListener("click", event => {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      if (redoButton.disabled) return;
      onRedo();
    });
    rootEl.appendChild(redoButton);

    function hold(button, held) {
      button.disabled = held;
      if (held) button.setAttribute("disabled", "");
      else button.removeAttribute("disabled");
    }

    function paint() {
      const compare = state.compare;
      compareButton.setAttribute("aria-pressed", compare.active ? "true" : "false");
      compareButton.classList.toggle("is-active", compare.active);
      compareButton.disabled = !compare.available;
      if (compare.available) compareButton.removeAttribute("disabled");
      else compareButton.setAttribute("disabled", "");
      compareButton.setAttribute("title", !compare.available
        ? `${LABEL.compare} · ${compare.reason || "nothing to compare"}`
        : (compare.active ? `${LABEL.compare} on · the other recipe's resin under every row that differs` : `${LABEL.compare} · show the other recipe's resin on every card`));

      const large = state.size === "large";
      sizeButton.setAttribute("aria-pressed", large ? "true" : "false");
      sizeButton.classList.toggle("is-active", large);
      sizeButton.setAttribute("title", large ? `${LABEL.large} on · click for the normal size` : `${LABEL.large} · larger type on every card`);
      rootEl.setAttribute("data-size", state.size);

      const history = state.history;
      hold(undoButton, !history.available || !history.canUndo);
      hold(redoButton, !history.available || !history.canRedo);
      undoButton.setAttribute("title", !history.available
        ? `${LABEL.undo} · ${history.reason || "not available"}`
        : (history.canUndo ? `${LABEL.undo} · take back the last edit to this recipe` : `${LABEL.undo} · nothing to undo`));
      redoButton.setAttribute("title", !history.available
        ? `${LABEL.redo} · ${history.reason || "not available"}`
        : (history.canRedo ? `${LABEL.redo} · put back the edit last undone` : `${LABEL.redo} · nothing to redo`));
    }

    /**
     * Tell the rail what the stage holds.
     *
     * @param {object} next
     * @param {object} [next.compare] { active, available, reason }
     * @param {string} [next.size]    "normal" | "large"
     * @param {object} [next.history] { canUndo, canRedo, available, reason }
     */
    function update(next) {
      const patch = next || {};
      if (patch.history && typeof patch.history === "object") {
        state.history = {
          canUndo: !!patch.history.canUndo,
          canRedo: !!patch.history.canRedo,
          available: patch.history.available !== false,
          reason: typeof patch.history.reason === "string" ? patch.history.reason : ""
        };
      }
      if (patch.compare && typeof patch.compare === "object") {
        state.compare = {
          active: !!patch.compare.active,
          available: patch.compare.available !== false,
          reason: typeof patch.compare.reason === "string" ? patch.compare.reason : ""
        };
      }
      if (patch.size === "large" || patch.size === "normal") state.size = patch.size;
      paint();
    }

    function getState() {
      return { compare: Object.assign({}, state.compare), size: state.size, history: Object.assign({}, state.history) };
    }

    paint();
    return { element: rootEl, compareButton, sizeButton, undoButton, redoButton, update, getState };
  }

  return { TILE, GAP, GLYPH, LABEL, compareGlyph, largeGlyph, undoGlyph, redoGlyph, create };
});
