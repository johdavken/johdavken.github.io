/* The section rail: the column down Slate's left edge.
 *
 * The mark at the top; one item per section in the middle,
 * with Tools as a drop-down listing the tool sections (open until it is
 * closed by hand); Settings at the foot. Selecting an item asks the boot to show that section - the rail
 * never shows anything itself, and it never reads state. It marks what is
 * current per pane (setActive for the centre, setActivePane for the rest),
 * since a tool can be open in the aside or the stats row while the
 * centre keeps its section.
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

  /* A press outside, by the shared rule - a finger closes on a still
   * release, a mouse on the press - and the Back key's stack
   * (slate-dismiss.js). */
  function dismissal(target, inside, close) {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.outside === "function" ? shared.outside(target, inside, close) : Object.freeze({ start() {}, stop() {}, isOn: () => false });
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TOOLS_EMPTY = "No tools yet";
  /* The pane a definition without one shows in. */
  const CENTRE = "centre";

  /* Glyphs, 20 units square, stroked in currentColor. No image asset,
   * no icon font: the rail's shapes are its own. */
  const GLYPHS = Object.freeze({
    recipe: "M4 5h12M4 10h12M4 15h8",
    book: "M3 4.5h5.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 0-1.5-1.5H3ZM17 4.5h-5.5A1.5 1.5 0 0 0 10 6v10a1.5 1.5 0 0 1 1.5-1.5H17Z",
    settings: "M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
    tools: "M13.5 3.5a3.5 3.5 0 0 0-3.9 4.9L3 15l2 2 6.6-6.6a3.5 3.5 0 0 0 4.9-3.9l-2.3 2.3-2-2Z",
    chevron: "M6 8l4 4 4-4",
    balance: "M10 3v14M6 17h8M4 5h12M2 10l3-5 3 5a3 3 0 0 1-6 0ZM12 10l3-5 3 5a3 3 0 0 1-6 0Z",
    timeline: "M5 3v14M9 6h8M9 10h6M9 14h8",
    gauge: "M3 15a7 7 0 0 1 14 0M10 15l4-5M10 15h.01",
    weights: "M10 3v3M6 6h8l2 11H4ZM7.5 11.5h5",
    winding: "M8 10a5 5 0 1 0 10 0a5 5 0 1 0-10 0M13 10h.01M2 10h5M4.5 7.5 7 10l-2.5 2.5",
    admin: "M10 2.5 16 5v4.5c0 3.8-2.6 6.9-6 8-3.4-1.1-6-4.2-6-8V5ZM7.5 10l1.8 1.8 3.4-3.6",
    alarm: "M10 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM10 8v3.5l2 1.5M3.5 5.5l2.5-2M16.5 5.5l-2.5-2M6 16l-1.5 1.5M14 16l1.5 1.5",
    home: "M3 9.5 10 3.5l7 6V17h-4.5v-4.5h-5V17H3Z",
    workspaces: "M10 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM5 12.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM15 12.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4M8.8 7.4 6.2 11M11.2 7.4l2.6 3.6",
    lines: "M3 6h4M11 6h6M3 12h8M15 12h2M9 4v4M13 10v4",
    resins: "M8 3h4M9 3v4.5L5.6 14.8a1 1 0 0 0 .9 1.5h7a1 1 0 0 0 .9-1.5L11 7.5V3M7.6 11h4.8",
    guide: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4M10 14.2h.01",
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
    // The label is ellipsised at the rail's width, so the whole of it is
    // carried on the item itself for a name too long to fit.
    const button = element(doc, "button", "slate-rail__item", { type: "button", "data-section": definition.id, title: definition.label, "aria-label": definition.label });
    button.appendChild(glyph(doc, definition.icon || definition.id));
    const label = element(doc, "span", "slate-rail__label");
    label.textContent = definition.label;
    button.appendChild(label);
    return button;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {object[]} options.sections   section definitions ({id, label, group, icon, pane?})
   * @param {function} options.onSelect   called with a section id
   * @param {string} [options.brand]      the mark's accessible name
   * @param {function} [options.flyout]   () => true while the rail is the compact icon rail
   *        (the touch tier): the Tools menu then floats beside it and closes on a press
   *        outside or on a selection, since it covers the page
   */
  function create(doc, options) {
    const settings = options || {};
    const definitions = settings.sections || [];
    const onSelect = typeof settings.onSelect === "function" ? settings.onSelect : () => {};
    const flyout = () => {
      try { return typeof settings.flyout === "function" && !!settings.flyout(); } catch (error) { return false; }
    };
    const rail = element(doc, "div", "slate-rail__inner");

    // The brand: the mark alone, filling the width of the rail. It carries
    // its own name for assistive tech (the SVG's aria-label).
    const brand = element(doc, "div", "slate-rail__brand");
    if (logoModule && typeof logoModule.create === "function") brand.appendChild(logoModule.create(doc, { label: settings.brand || "Resin.Tools" }));
    rail.appendChild(brand);

    // The sections, then the two drop-downs: Tools, and - behind a rule,
    // listed only while an administrator is signed in (setListed) - Admin,
    // which holds the administrator's sections. One drop-down open at a
    // time: opening either closes the other, so a phone's sheet never
    // has to hold both lists at once.
    const list = element(doc, "div", "slate-rail__sections");
    const items = new Map();
    const sectionDefinitions = definitions.filter(one => one.group === "sections");
    for (const definition of sectionDefinitions.filter(one => !one.admin)) {
      const button = item(doc, definition);
      // A phone's own (Home) and a drawer's own (the Timeline, a
      // tablet's) wait to be listed.
      if (definition.phone || definition.drawer) button.setAttribute("hidden", "");
      items.set(definition.id, button);
      list.appendChild(button);
    }

    /* A drop-down: one item that opens a menu of sections. */
    function dropdown(key, label, glyphName, members, emptyText) {
      const wrap = element(doc, "div", `slate-rail__tools slate-rail__tools--${key}`, { "data-menu": key });
      const button = element(doc, "button", `slate-rail__item slate-rail__item--${key}`, {
        type: "button", "aria-haspopup": "menu", "aria-expanded": "false"
      });
      button.appendChild(glyph(doc, glyphName));
      const words = element(doc, "span", "slate-rail__label");
      words.textContent = label;
      button.appendChild(words);
      const chevron = glyph(doc, "chevron");
      chevron.setAttribute("class", "slate-rail__glyph slate-rail__chevron");
      button.appendChild(chevron);
      wrap.appendChild(button);
      const menu = element(doc, "ul", "slate-rail__menu", { role: "menu", hidden: "", "data-menu": key });
      if (members.length === 0 && emptyText) {
        const empty = element(doc, "li", "slate-rail__menu-empty", { role: "presentation" });
        empty.textContent = emptyText;
        menu.appendChild(empty);
      }
      for (const definition of members) {
        const li = element(doc, "li", "slate-rail__menu-item", { role: "presentation" });
        const entry = item(doc, definition);
        entry.setAttribute("role", "menuitem");
        // Named in the flyout, where the rail's own labels are hidden.
        entry.classList.add("slate-rail__item--menu");
        const entryLabel = entry.querySelector(".slate-rail__label");
        if (entryLabel) entryLabel.classList.add("slate-rail__label--menu");
        items.set(definition.id, entry);
        li.appendChild(entry);
        menu.appendChild(li);
      }
      wrap.appendChild(menu);
      return { key, wrap, button, menu, open: false };
    }

    const toolsMenu = dropdown("tools", "Tools", "tools", definitions.filter(one => one.group === "tools"), TOOLS_EMPTY);
    list.appendChild(toolsMenu.wrap);
    const adminDefinitions = sectionDefinitions.filter(one => one.admin);
    let divider = null;
    let adminMenu = null;
    if (adminDefinitions.length) {
      divider = element(doc, "div", "slate-rail__divider", { role: "separator", hidden: "" });
      list.appendChild(divider);
      adminMenu = dropdown("admin", "Admin", "admin", adminDefinitions, "");
      // Each administrator's section waits to be listed; the drop-down
      // stands with the first of them.
      for (const definition of adminDefinitions) items.get(definition.id).setAttribute("hidden", "");
      adminMenu.wrap.setAttribute("hidden", "");
      list.appendChild(adminMenu.wrap);
    }
    const menus = [toolsMenu, adminMenu].filter(Boolean);
    rail.appendChild(list);

    // The foot: Settings.
    const foot = element(doc, "div", "slate-rail__foot");
    for (const definition of definitions.filter(one => one.group === "foot")) {
      const button = item(doc, definition);
      items.set(definition.id, button);
      foot.appendChild(button);
    }
    rail.appendChild(foot);

    /* A menu stays open once opened - through a selection, through a
       press elsewhere on the page - until its item is pressed again, the
       other drop-down is opened, or Escape while the rail has focus. The
       tools are used side by side, and the list is the way to them. */
    const outsideCloser = dismissal(doc, node => menus.some(one => typeof one.wrap.contains === "function" && one.wrap.contains(node)), () => closeAll());
    /* The flyout stands beside its item, fixed to the screen: the rail
     * scrolls, and a scrolling box clips whatever leaves it sideways,
     * so a menu anchored inside the rail could open and never be seen or
     * tapped. It is placed from the item each time it opens (rail.css
     * reads the two properties). */
    function placeFlyout(one) {
      if (typeof one.button.getBoundingClientRect !== "function" || !one.menu.style || typeof one.menu.style.setProperty !== "function") return;
      const rect = one.button.getBoundingClientRect();
      one.menu.style.setProperty("--slate-flyout-top", `${Math.round(rect.top)}px`);
      one.menu.style.setProperty("--slate-flyout-left", `${Math.round(rect.right)}px`);
    }

    function openMenu(one) {
      if (!one || one.open) return;
      for (const other of menus) if (other !== one) shut(other);
      one.open = true;
      one.menu.removeAttribute("hidden");
      one.button.setAttribute("aria-expanded", "true");
      one.wrap.classList.add("is-open");
      // Only the flyout closes on a press outside; the sidebar's menu stays.
      if (flyout()) {
        placeFlyout(one);
        outsideCloser.start();
      } else if (typeof one.menu.scrollIntoView === "function") {
        // In a phone's sheet (or a short sidebar) the menu opens below its
        // item and can end past the sheet's foot: bring it in.
        one.menu.scrollIntoView({ block: "nearest" });
      }
    }
    function shut(one) {
      if (!one || !one.open) return;
      one.open = false;
      one.menu.setAttribute("hidden", "");
      one.button.setAttribute("aria-expanded", "false");
      one.wrap.classList.remove("is-open");
    }
    function closeMenu(one) {
      shut(one);
      if (!menus.some(other => other.open)) outsideCloser.stop();
    }
    function closeAll() {
      for (const one of menus) shut(one);
      outsideCloser.stop();
    }
    const openTools = () => openMenu(toolsMenu);
    const closeTools = () => closeMenu(toolsMenu);
    const openAdmin = () => openMenu(adminMenu);
    const closeAdmin = () => closeMenu(adminMenu);

    for (const one of menus) one.button.addEventListener("click", () => { if (one.open) closeMenu(one); else openMenu(one); });
    rail.addEventListener("keydown", event => {
      const open = menus.find(one => one.open);
      if (event && event.key === "Escape" && open) {
        closeMenu(open);
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof open.button.focus === "function") open.button.focus();
      }
    });
    rail.addEventListener("click", event => {
      const target = event && event.target;
      const button = target && typeof target.closest === "function" ? target.closest("[data-section]") : null;
      if (!button || !rail.contains(button)) return;
      onSelect(button.getAttribute("data-section"));
      const holder = menus.find(one => one.open && one.menu.contains(button));
      if (holder && flyout()) closeMenu(holder);
    });

    /* Several things are current at once: the centre's section, and what
       each other pane shows in its home's place (a definition with a
       `pane`: the aside in the Timeline's, the stats row in the Scrap
       card's). Each pane is marked apart, so none unmarks another. The
       mark is on the item alone: a drop-down's item is a list, not a
       place, and never lights. */
    const paneOf = id => {
      const definition = definitions.find(one => one.id === id);
      return definition && definition.pane ? definition.pane : CENTRE;
    };

    function mark(button, on) {
      button.classList.toggle("is-active", on);
      if (on) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }

    /* `id` is the pane's current section, or null when its home is back. */
    function setActivePane(pane, id) {
      for (const [itemId, button] of items) if (paneOf(itemId) === pane) mark(button, itemId === id);
    }

    function setActive(id) {
      setActivePane(CENTRE, id);
    }

    /* Whether an item is offered at all. The administrator's sections are
     * built with the rest and stand hidden until there is an administrator
     * to use them; the Admin drop-down, and the rule above it, go with the
     * first of them. */
    function setListed(id, on) {
      const button = items.get(id);
      if (!button) return false;
      if (on) button.removeAttribute("hidden");
      else button.setAttribute("hidden", "");
      if (adminMenu) {
        const anyAdmin = adminDefinitions.some(one => items.get(one.id) && !items.get(one.id).hasAttribute("hidden"));
        for (const node of [divider, adminMenu.wrap]) {
          if (anyAdmin) node.removeAttribute("hidden");
          else node.setAttribute("hidden", "");
        }
        if (!anyAdmin) closeMenu(adminMenu);
      }
      return true;
    }

    function isListed(id) {
      const button = items.get(id);
      return !!button && !button.hasAttribute("hidden");
    }

    /* A dot on an item that wants looking at (the Timeline's while a
     * hopper is overdue and running). */
    function setAlert(id, on) {
      const button = items.get(id);
      if (!button) return false;
      button.classList.toggle("is-alert", !!on);
      return true;
    }

    return Object.freeze({
      element: rail, setActive, setActivePane, setListed, isListed, setAlert,
      openTools, closeTools, isToolsOpen: () => toolsMenu.open,
      openAdmin, closeAdmin, isAdminOpen: () => !!(adminMenu && adminMenu.open)
    });
  }

  return Object.freeze({ GLYPHS, TOOLS_EMPTY, CENTRE, create });
});
