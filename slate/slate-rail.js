/* The section rail: the column down Slate's left edge.
 *
 * The mark at the top; one item per section in the middle,
 * with Tools as a drop-down listing the tool sections; Settings at the
 * foot. Selecting an item asks the boot to show that section - the rail
 * never shows anything itself, and it never reads state.
 */
(function (root, factory) {
  const logo = typeof require === "function"
    ? require("./slate-logo.js")
    : (root && root.PolynSlateLogo);
  const api = factory(logo);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRail = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (logoModule) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TOOLS_EMPTY = "No tools yet";

  /* Glyphs, 20 units square, stroked in currentColor. No image asset,
   * no icon font: the rail's shapes are its own. */
  const GLYPHS = Object.freeze({
    recipe: "M4 5h12M4 10h12M4 15h8",
    book: "M3 4.5h5.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 0-1.5-1.5H3ZM17 4.5h-5.5A1.5 1.5 0 0 0 10 6v10a1.5 1.5 0 0 1 1.5-1.5H17Z",
    settings: "M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
    tools: "M13.5 3.5a3.5 3.5 0 0 0-3.9 4.9L3 15l2 2 6.6-6.6a3.5 3.5 0 0 0 4.9-3.9l-2.3 2.3-2-2Z",
    chevron: "M6 8l4 4 4-4",
    generic: "M4 4h12v12H4Z"
  });

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function glyph(doc, name) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "slate-rail__glyph");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", GLYPHS[name] || GLYPHS.generic);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function item(doc, definition) {
    const button = element(doc, "button", "slate-rail__item", { type: "button", "data-section": definition.id });
    button.appendChild(glyph(doc, definition.icon || definition.id));
    const label = element(doc, "span", "slate-rail__label");
    label.textContent = definition.label;
    button.appendChild(label);
    return button;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {object[]} options.sections   section definitions ({id, label, group, icon})
   * @param {function} options.onSelect   called with a section id
   * @param {string} [options.brand]      the mark's accessible name
   */
  function create(doc, options) {
    const settings = options || {};
    const definitions = settings.sections || [];
    const onSelect = typeof settings.onSelect === "function" ? settings.onSelect : () => {};
    const rail = element(doc, "div", "slate-rail__inner");

    // The brand: the mark alone, filling the width of the rail. It carries
    // its own name for assistive tech (the SVG's aria-label).
    const brand = element(doc, "div", "slate-rail__brand");
    if (logoModule && typeof logoModule.create === "function") brand.appendChild(logoModule.create(doc, { label: settings.brand || "Resin.Tools" }));
    rail.appendChild(brand);

    // The sections.
    const list = element(doc, "div", "slate-rail__sections");
    const items = new Map();
    for (const definition of definitions.filter(one => one.group === "sections")) {
      const button = item(doc, definition);
      items.set(definition.id, button);
      list.appendChild(button);
    }

    // Tools: one item that opens a menu of the tool sections.
    const tools = element(doc, "div", "slate-rail__tools");
    const toolsButton = element(doc, "button", "slate-rail__item slate-rail__item--tools", {
      type: "button", "aria-haspopup": "menu", "aria-expanded": "false"
    });
    toolsButton.appendChild(glyph(doc, "tools"));
    const toolsLabel = element(doc, "span", "slate-rail__label");
    toolsLabel.textContent = "Tools";
    toolsButton.appendChild(toolsLabel);
    const chevron = glyph(doc, "chevron");
    chevron.setAttribute("class", "slate-rail__glyph slate-rail__chevron");
    toolsButton.appendChild(chevron);
    tools.appendChild(toolsButton);
    const menu = element(doc, "ul", "slate-rail__menu", { role: "menu", hidden: "" });
    const toolDefinitions = definitions.filter(one => one.group === "tools");
    if (toolDefinitions.length === 0) {
      const empty = element(doc, "li", "slate-rail__menu-empty", { role: "presentation" });
      empty.textContent = TOOLS_EMPTY;
      menu.appendChild(empty);
    }
    for (const definition of toolDefinitions) {
      const li = element(doc, "li", "slate-rail__menu-item", { role: "presentation" });
      const button = item(doc, definition);
      button.setAttribute("role", "menuitem");
      items.set(definition.id, button);
      li.appendChild(button);
      menu.appendChild(li);
    }
    tools.appendChild(menu);
    list.appendChild(tools);
    rail.appendChild(list);

    // The foot: Settings.
    const foot = element(doc, "div", "slate-rail__foot");
    for (const definition of definitions.filter(one => one.group === "foot")) {
      const button = item(doc, definition);
      items.set(definition.id, button);
      foot.appendChild(button);
    }
    rail.appendChild(foot);

    let toolsOpen = false;
    function outside(event) {
      if (event && event.target && typeof tools.contains === "function" && tools.contains(event.target)) return;
      closeTools();
    }
    function openTools() {
      if (toolsOpen) return;
      toolsOpen = true;
      menu.removeAttribute("hidden");
      toolsButton.setAttribute("aria-expanded", "true");
      tools.classList.add("is-open");
      if (typeof doc.addEventListener === "function") doc.addEventListener("pointerdown", outside, true);
    }
    function closeTools() {
      if (!toolsOpen) return;
      toolsOpen = false;
      menu.setAttribute("hidden", "");
      toolsButton.setAttribute("aria-expanded", "false");
      tools.classList.remove("is-open");
      if (typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", outside, true);
    }

    toolsButton.addEventListener("click", () => { if (toolsOpen) closeTools(); else openTools(); });
    rail.addEventListener("keydown", event => {
      if (event && event.key === "Escape" && toolsOpen) {
        closeTools();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof toolsButton.focus === "function") toolsButton.focus();
      }
    });
    rail.addEventListener("click", event => {
      const target = event && event.target;
      const button = target && typeof target.closest === "function" ? target.closest("[data-section]") : null;
      if (!button || !rail.contains(button)) return;
      closeTools();
      onSelect(button.getAttribute("data-section"));
    });

    function setActive(id) {
      for (const [itemId, button] of items) {
        const active = itemId === id;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
      const activeIsTool = toolDefinitions.some(one => one.id === id);
      toolsButton.classList.toggle("is-active", activeIsTool);
    }

    return Object.freeze({ element: rail, setActive, openTools, closeTools, isToolsOpen: () => toolsOpen });
  }

  return Object.freeze({ GLYPHS, TOOLS_EMPTY, create });
});
