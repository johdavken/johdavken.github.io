/* Station theme preview.
 *
 * One miniature of Station, drawn once per theme in the Appearance gallery
 * so an operator can see what a theme does to the whole console - the
 * machine, the layer colours, the timeline, the Handbook's glass - before
 * choosing it. A swatch cannot show that; a screenshot goes stale.
 *
 * WHAT IT IS
 *
 * A fixed composition, presentation only: a header, three layer banks
 * (hoppers, a mixer, an extruder), a run-down rail, the status bar, and
 * a corner of the Handbook laid over the third bank as the real one lies
 * over the stage. Every fill and stroke is a class whose colour is one of
 * Station's semantic tokens (styles/components/theme-preview.css), and the
 * drawing sits inside a THEME SCOPE - an element carrying the theme's own
 * data-theme attribute, which the theme stylesheets match alongside the
 * root - so each miniature resolves its tokens under the theme it shows,
 * whatever theme the console around it is wearing.
 *
 * WHAT IT IS NOT
 *
 * Not a second Station. It reads no bridge, holds no state, subscribes to
 * nothing, and never touches the root's data-theme; it does not reuse the
 * renderer's parts, because those are sized and stated for a live machine.
 * It is a picture, and it stays one.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationThemePreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const VIEW_WIDTH = 160;
  const VIEW_HEIGHT = 90;
  const CLASS = "station-theme-preview";

  /* The three banks, left to right as a three-layer line reads: the
   * outside layer, the core, the inside. Each carries the hoppers it
   * shows - which are running, which stand empty, which one is tracked
   * and which one's pump is off - so the miniature shows the states an
   * operator will meet, in the theme's colours for them. */
  const BANKS = Object.freeze([
    Object.freeze({ cx: 40, name: "C", role: "outside", roleLabel: "OUTSIDE", pct: "25%",
      hoppers: [{ level: 0.7 }, { level: 0.45 }, { level: 0 }] }),
    Object.freeze({ cx: 80, name: "B", role: "core", roleLabel: "CORE", pct: "50%",
      hoppers: [{ level: 0.8, tracked: true }, { level: 0.55 }, { level: 0.3, pumpOff: true }] }),
    Object.freeze({ cx: 120, name: "A", role: "inside", roleLabel: "INSIDE", pct: "25%",
      hoppers: [{ level: 0.6 }, { level: 0.35 }, { level: 0 }] })
  ]);

  function svg(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function label(doc, className, value, attributes) {
    const node = svg(doc, "text", className, attributes);
    node.textContent = value;
    return node;
  }

  function gridPath(step, width, height) {
    const parts = [];
    for (let x = step; x < width; x += step) parts.push(`M ${x} 0 V ${height}`);
    for (let y = step; y < height; y += step) parts.push(`M 0 ${y} H ${width}`);
    return parts.join(" ");
  }

  function hopper(doc, x, state) {
    const group = svg(doc, "g", `${CLASS}__hopper`);
    const running = state.level > 0;
    // Receiver: the pump indicator, amber when conveying, steel when off.
    group.appendChild(svg(doc, "path", `${CLASS}__receiver${state.pumpOff ? " is-pump-off" : ""}`, {
      d: `M ${x - 3} 24 H ${x + 3} L ${x} 28 Z`
    }));
    // The vessel, with its material at the level the recipe would put it.
    group.appendChild(svg(doc, "rect", `${CLASS}__vessel${running ? "" : " is-unassigned"}`, {
      x: x - 2.6, y: 28, width: 5.2, height: 13, rx: 0.6
    }));
    if (running) {
      const height = 11 * state.level;
      group.appendChild(svg(doc, "rect", `${CLASS}__material${state.pumpOff ? " is-pump-off" : ""}`, {
        x: x - 1.8, y: 40 - height, width: 3.6, height
      }));
    }
    // The hose down to the mixer, past the readout.
    group.appendChild(svg(doc, "path", `${CLASS}__hose`, { d: `M ${x} 41 V 42.4 M ${x} 45.6 V 48` }));
    return group;
  }

  function bank(doc, spec) {
    const group = svg(doc, "g", `${CLASS}__bank`, { "data-layer-role": spec.role });
    const cx = spec.cx;
    group.appendChild(label(doc, `${CLASS}__layer-name`, spec.name, { x: cx, y: 17, "text-anchor": "middle" }));
    group.appendChild(label(doc, `${CLASS}__layer-role`, spec.roleLabel, { x: cx, y: 21.2, "text-anchor": "middle" }));
    spec.hoppers.forEach((state, index) => group.appendChild(hopper(doc, cx + (index - 1) * 11, state)));
    group.appendChild(label(doc, `${CLASS}__readout`, "60  30  10", { x: cx, y: 44.9, "text-anchor": "middle" }));
    // The mixer: the drum, its weigh-hopper band in the layer's colour,
    // and the inspection window with a paddle behind it.
    group.appendChild(svg(doc, "rect", `${CLASS}__mixer`, { x: cx - 7, y: 48, width: 14, height: 11, rx: 1 }));
    group.appendChild(svg(doc, "rect", `${CLASS}__mixer-band`, { x: cx - 7, y: 48, width: 14, height: 1.8 }));
    group.appendChild(svg(doc, "circle", `${CLASS}__window`, { cx, cy: 54.6, r: 2.6 }));
    group.appendChild(svg(doc, "path", `${CLASS}__blade`, { d: `M ${cx - 1.6} 53.2 L ${cx + 1.6} 56` }));
    // The extruder: the motor at the left, the barrel to the right, the
    // layer's share of the film under it.
    group.appendChild(svg(doc, "rect", `${CLASS}__motor`, { x: cx - 12.5, y: 59.5, width: 7, height: 8, rx: 1 }));
    group.appendChild(svg(doc, "rect", `${CLASS}__extruder`, { x: cx - 6, y: 60.5, width: 18, height: 6, rx: 1.5 }));
    group.appendChild(label(doc, `${CLASS}__pct`, spec.pct, { x: cx, y: 72.4, "text-anchor": "middle" }));
    return group;
  }

  function timeline(doc) {
    const group = svg(doc, "g", `${CLASS}__timeline`);
    group.appendChild(label(doc, `${CLASS}__now-label`, "NOW", { x: 3, y: 79.4 }));
    group.appendChild(svg(doc, "path", `${CLASS}__rail`, { d: "M 14 81 H 157" }));
    const ticks = [];
    for (let x = 26; x < 157; x += 12) ticks.push(`M ${x} 79.6 V 82.4`);
    group.appendChild(svg(doc, "path", `${CLASS}__tick`, { d: ticks.join(" ") }));
    group.appendChild(svg(doc, "path", `${CLASS}__now`, { d: "M 14 77 V 85" }));
    group.appendChild(svg(doc, "path", `${CLASS}__transition`, { d: "M 74 77 V 85" }));
    group.appendChild(svg(doc, "circle", `${CLASS}__marker`, { cx: 104, cy: 81, r: 1.4 }));
    return group;
  }

  /* A corner of the Handbook, over the third bank: the glass, its title,
   * the active tab's underline, three rows of a book, and the one primary
   * action. Enough to show what the glass and the accent do. */
  function handbook(doc) {
    const group = svg(doc, "g", `${CLASS}__handbook`);
    group.appendChild(svg(doc, "rect", `${CLASS}__glass`, { x: 98, y: 44, width: 58, height: 29, rx: 2.5 }));
    group.appendChild(label(doc, `${CLASS}__glass-title`, "HANDBOOK", { x: 102, y: 49.2 }));
    group.appendChild(svg(doc, "rect", `${CLASS}__tab`, { x: 102, y: 50.6, width: 9, height: 0.8 }));
    [[55.5, 22], [59.5, 16], [63.5, 19]].forEach(([y, width]) => {
      group.appendChild(svg(doc, "rect", `${CLASS}__row`, { x: 102, y, width, height: 1.6, rx: 0.8 }));
    });
    group.appendChild(svg(doc, "rect", `${CLASS}__action`, { x: 136, y: 63.5, width: 16, height: 5.5, rx: 1 }));
    return group;
  }

  /**
   * Draw the miniature for one theme.
   *
   * @param {Document} doc
   * @param {string} themeId  a registered Station theme id; it becomes the
   *        scope's data-theme, and nothing here checks it against the
   *        registry - an unknown id draws in the surrounding theme's
   *        tokens, which is the honest fallback for a picture
   * @returns {Element} the theme scope, holding the drawing
   */
  function create(doc, themeId) {
    const scope = doc.createElement("span");
    scope.setAttribute("class", "station-theme-scope");
    scope.setAttribute("data-theme", String(themeId));

    const picture = svg(doc, "svg", CLASS, {
      viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`, "aria-hidden": "true", focusable: "false"
    });
    picture.appendChild(svg(doc, "rect", `${CLASS}__canvas`, { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT }));
    // The drafting grid the technical themes draw; transparent elsewhere.
    picture.appendChild(svg(doc, "path", `${CLASS}__grid-minor`, { d: gridPath(8, VIEW_WIDTH, VIEW_HEIGHT) }));
    picture.appendChild(svg(doc, "path", `${CLASS}__grid-major`, { d: gridPath(32, VIEW_WIDTH, VIEW_HEIGHT) }));
    // The header: the wordmark and two of its controls.
    picture.appendChild(svg(doc, "rect", `${CLASS}__bar`, { x: -1, y: -1, width: VIEW_WIDTH + 2, height: 10 }));
    picture.appendChild(label(doc, `${CLASS}__wordmark`, "Station", { x: 4, y: 6.4 }));
    picture.appendChild(svg(doc, "rect", `${CLASS}__pill`, { x: 118, y: 2.4, width: 16, height: 4.2, rx: 1 }));
    picture.appendChild(svg(doc, "rect", `${CLASS}__pill`, { x: 138, y: 2.4, width: 16, height: 4.2, rx: 1 }));
    for (const spec of BANKS) picture.appendChild(bank(doc, spec));
    picture.appendChild(timeline(doc));
    // The status bar along the bottom edge.
    picture.appendChild(svg(doc, "rect", `${CLASS}__bar`, { x: -1, y: 86.5, width: VIEW_WIDTH + 2, height: 5 }));
    picture.appendChild(handbook(doc));

    scope.appendChild(picture);
    return scope;
  }

  return Object.freeze({ VIEW_WIDTH, VIEW_HEIGHT, create });
});
