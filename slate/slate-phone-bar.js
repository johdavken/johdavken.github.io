/* The phone's bar: five keys along the foot of the screen.
 *
 * On a phone (data-viewport="phone" under touch, slate/slate-tier.js) the
 * rail gives way to this bar: the three sections an operator moves between
 * all shift - Recipe, Weights, the Recipe Book - the Timeline, which is a
 * page of its own there, and Menu, which raises the rail itself as a sheet
 * for everything else (Resin Balance, the tools, Settings, the
 * administrator's sections).
 *
 * The bar never shows anything itself and never reads state: a key asks
 * the boot (`onSelect(id)`), which owns the pages, and the boot marks the
 * key that is current (`setActive`), raises a key's dot (`setDot` - the
 * Timeline's when a hopper is overdue) and says whether the Menu's sheet is
 * open (`setExpanded`). Everywhere else the bar is built and never seen.
 */
(function (root, factory) {
  const rail = typeof require === "function"
    ? require("./slate-rail.js")
    : (root && root.PolynSlateRail);
  const api = factory(rail);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlatePhoneBar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (railModule) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MENU = "menu";
  /* The keys, left to right: a section id (or the Timeline's, or Menu),
   * the word under it, and the rail's glyph for it. */
  const KEYS = Object.freeze([
    Object.freeze({ id: "recipe", label: "Recipe", icon: "recipe" }),
    Object.freeze({ id: "timeline", label: "Timeline", icon: "timeline" }),
    Object.freeze({ id: "weights", label: "Weights", icon: "weights" }),
    Object.freeze({ id: "recipe-book", label: "Book", icon: "book" }),
    Object.freeze({ id: MENU, label: "Menu", icon: MENU })
  ]);
  const MENU_GLYPH = "M4 6h12M4 10h12M4 14h12";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function glyph(doc, name) {
    const glyphs = railModule && railModule.GLYPHS ? railModule.GLYPHS : {};
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "slate-bar__glyph");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", name === MENU ? MENU_GLYPH : (glyphs[name] || glyphs.generic || "M4 4h12v12H4Z"));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {function} options.onSelect  called with a key's id
   */
  function create(doc, options) {
    const settings = options || {};
    const onSelect = typeof settings.onSelect === "function" ? settings.onSelect : () => {};
    const bar = element(doc, "div", "slate-bar__keys");
    const keys = new Map();
    for (const key of KEYS) {
      const attributes = { type: "button", "data-bar-key": key.id };
      if (key.id === MENU) Object.assign(attributes, { "aria-haspopup": "dialog", "aria-expanded": "false" });
      const button = element(doc, "button", "slate-bar__key", attributes);
      button.appendChild(glyph(doc, key.icon));
      const label = element(doc, "span", "slate-bar__label");
      label.textContent = key.label;
      button.appendChild(label);
      const dot = element(doc, "span", "slate-bar__dot", { "aria-hidden": "true", hidden: "" });
      button.appendChild(dot);
      button.addEventListener("click", () => onSelect(key.id));
      keys.set(key.id, { button, dot });
      bar.appendChild(button);
    }

    /* The key that is current, or none (null): a page the bar has no key
     * for - a tool, Settings - lights nothing but Menu, the way to it. */
    function setActive(id) {
      for (const [keyId, key] of keys) {
        const on = keyId === id;
        key.button.classList.toggle("is-active", on);
        if (on) key.button.setAttribute("aria-current", "page");
        else key.button.removeAttribute("aria-current");
      }
    }

    function setDot(id, on) {
      const key = keys.get(id);
      if (!key) return false;
      if (on) key.dot.removeAttribute("hidden");
      else key.dot.setAttribute("hidden", "");
      key.button.classList.toggle("has-dot", !!on);
      return true;
    }

    function setExpanded(on) {
      keys.get(MENU).button.setAttribute("aria-expanded", on ? "true" : "false");
    }

    return Object.freeze({ element: bar, setActive, setDot, setExpanded, key: id => (keys.has(id) ? keys.get(id).button : null) });
  }

  return Object.freeze({ KEYS, MENU, create });
});
