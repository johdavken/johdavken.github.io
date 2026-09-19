/* The card rail: the short column of switches riding the right side of
 * the far-right layer card while Blend Edit is on.
 *
 * WHAT IT IS
 *
 * Two switches, and nothing that unfolds: each changes how EVERY card on
 * the stage shows, at once, and shows that state as its own.
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
 * Presentation state only: what each switch was last told to show. It
 * reads no job, keeps no mode of its own and dispatches nothing - a
 * click is handed to the boot file, which keeps the two states for the
 * session and tells the rail (update()) and the cards what to show.
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
    large: "Large cards"
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

  /**
   * Build the rail.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {function} [options.onCompare] () => void; the Compare switch was clicked
   * @param {function} [options.onSize]    () => void; the Large switch was clicked
   * @returns {{ element, compareButton, sizeButton, update, getState }}
   */
  function create(doc, options) {
    const settings = options || {};
    const onCompare = typeof settings.onCompare === "function" ? settings.onCompare : () => {};
    const onSize = typeof settings.onSize === "function" ? settings.onSize : () => {};

    const state = {
      compare: { active: false, available: true, reason: "" },
      size: "normal"
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
    }

    /**
     * Tell the rail what the stage holds.
     *
     * @param {object} next
     * @param {object} [next.compare] { active, available, reason }
     * @param {string} [next.size]    "normal" | "large"
     */
    function update(next) {
      const patch = next || {};
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
      return { compare: Object.assign({}, state.compare), size: state.size };
    }

    paint();
    return { element: rootEl, compareButton, sizeButton, update, getState };
  }

  return { TILE, GAP, GLYPH, LABEL, create };
});
