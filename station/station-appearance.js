/* Operator Handbook > Appearance.
 *
 * A gallery over the Station theme controller: it owns no preference and no
 * palette. Each theme is a tile - a miniature of Station drawn under that
 * theme's own tokens (station-theme-preview.js), and its name - grouped by
 * family, the light theme above its dark one, three families to a row.
 * Choosing a tile asks the
 * controller to change the authoritative root attribute immediately; CSS
 * does the rest, and the tiles keep showing their own themes because each
 * miniature resolves its tokens in its own scope, not the root's.
 *
 * In the heading, beside the theme's copy, the page's one other
 * preference: Show Extruders, a switch over the display controller
 * (station-display.js). Off, the default, the stage draws each layer's
 * blender alone and larger; on, the extruder under it. The switch asks
 * the controller and reads its state back, as the tiles do the theme's;
 * the stage redraws from the controller, not from here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationAppearance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  /* The chosen tile's mark: a check, drawn here in the console's accent
   * (handbook.css) rather than a glyph from a font. */
  function checkMark(doc) {
    const svg = doc.createElementNS ? doc.createElementNS(SVG_NS, "svg") : doc.createElement("svg");
    svg.setAttribute("class", "station-appearance__mark");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = doc.createElementNS ? doc.createElementNS(SVG_NS, "path") : doc.createElement("path");
    path.setAttribute("d", "M 3.5 8.5 L 6.8 11.8 L 12.8 4.8");
    svg.appendChild(path);
    return svg;
  }

  /* Families in registry order, each with its themes in registry order;
   * a theme naming no family, or one the registry does not list, stands
   * in a family of its own so it is never dropped from the gallery. */
  function families(context) {
    const registry = Array.isArray(context.themes) ? context.themes : [];
    const known = Array.isArray(context.families) ? context.families : [];
    const order = new Map(known.map(family => [family.id, { id: family.id, label: family.label || family.id, themes: [] }]));
    for (const theme of registry) {
      const id = theme.family && order.has(theme.family) ? theme.family : `theme:${theme.id}`;
      if (!order.has(id)) order.set(id, { id, label: theme.label, themes: [] });
      order.get(id).themes.push(theme);
    }
    return [...order.values()].filter(family => family.themes.length);
  }

  /* The extruders' switch: a labelled two-position switch, I for on and
   * O for off marked on the knob's track, in the console's own controls
   * (handbook.css). role="switch" with aria-checked, so it reads as the
   * on/off it is and not as a pressed button. */
  function extruderSwitch(doc, display) {
    const control = element(doc, "button", "station-appearance__switch", {
      type: "button", role: "switch", "aria-checked": "false", "data-preference": "show-extruders",
      title: "Draw each layer's extruder under its blender. Off, the blenders are drawn larger in the room the extruders took."
    });
    control.appendChild(text(doc, "span", "station-appearance__switch-label", "Show Extruders"));
    const track = element(doc, "span", "station-appearance__switch-track", { "aria-hidden": "true" });
    track.appendChild(text(doc, "span", "station-appearance__switch-mark station-appearance__switch-mark--on", "I"));
    track.appendChild(text(doc, "span", "station-appearance__switch-mark station-appearance__switch-mark--off", "O"));
    track.appendChild(element(doc, "span", "station-appearance__switch-knob"));
    control.appendChild(track);
    control.addEventListener("click", () => {
      if (display && typeof display.setShowExtruders === "function") display.setShowExtruders(!display.getShowExtruders());
    });
    return control;
  }

  function create(doc, context) {
    const settings = context || {};
    const controller = settings.theme;
    const display = settings.display && typeof settings.display.getShowExtruders === "function" ? settings.display : null;
    const preview = settings.preview && typeof settings.preview.create === "function" ? settings.preview : null;
    const rootEl = element(doc, "div", "station-appearance");
    const intro = element(doc, "div", "station-appearance__intro");
    intro.appendChild(text(doc, "h2", "station-appearance__title", "Appearance"));
    intro.appendChild(text(doc, "p", "station-appearance__copy",
      "Choose this Station's display theme. The preference stays on this device."));
    /* The switch stands at the heading's far end, after the copy; without
     * a display controller (a harness with none) the page is the gallery
     * alone, as it was. */
    const extruders = display ? extruderSwitch(doc, display) : null;
    if (extruders) intro.appendChild(extruders);
    rootEl.appendChild(intro);

    const gallery = element(doc, "div", "station-appearance__gallery", { role: "radiogroup", "aria-label": "Station theme" });
    const tiles = new Map();
    for (const family of families(settings)) {
      const column = element(doc, "div", "station-appearance__family", { "data-family": family.id });
      column.appendChild(text(doc, "span", "station-appearance__family-name", family.label, { "aria-hidden": "true" }));
      for (const theme of family.themes) {
        const tile = element(doc, "button", "station-appearance__tile", {
          type: "button", role: "radio", "aria-checked": "false", "data-theme-choice": theme.id,
          "aria-label": `${theme.label} (${family.label})`, title: theme.description || theme.label
        });
        const frame = element(doc, "span", "station-appearance__preview");
        if (preview) frame.appendChild(preview.create(doc, theme.id));
        tile.appendChild(frame);
        const caption = element(doc, "span", "station-appearance__caption");
        caption.appendChild(text(doc, "span", "station-appearance__name", theme.label));
        caption.appendChild(checkMark(doc));
        tile.appendChild(caption);
        tile.addEventListener("click", () => {
          if (controller && typeof controller.setTheme === "function") controller.setTheme(theme.id);
          update();
        });
        column.appendChild(tile);
        tiles.set(theme.id, tile);
      }
      gallery.appendChild(column);
    }
    rootEl.appendChild(gallery);

    function update() {
      const selected = controller && typeof controller.getTheme === "function" ? controller.getTheme() : "";
      for (const [id, tile] of tiles) tile.setAttribute("aria-checked", id === selected ? "true" : "false");
      if (extruders) extruders.setAttribute("aria-checked", display.getShowExtruders() ? "true" : "false");
    }

    /* The switch follows the controller, whoever moved it - this page, or
     * a second Appearance page over the same controller. The theme tiles
     * have no such listener: the controller writes the root attribute the
     * tiles read their check from on the page's own update. */
    if (display && typeof display.subscribe === "function") display.subscribe(() => update());
    update();
    return {
      element: rootEl,
      update,
      /* Two rows of families is more than the frame's default height
       * shows without scrolling, so the gallery takes the Handbook's grip:
       * raised, both rows stand in view. */
      grows: () => true,
      focus() { const selected = tiles.get(controller?.getTheme?.()); if (selected) selected.focus(); }
    };
  }

  return Object.freeze({
    section: Object.freeze({ id: "appearance", title: "Appearance", create })
  });
});
