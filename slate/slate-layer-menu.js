/* The layer head's menu: what can be done to a whole layer.
 *
 * Copy to another layer (one item per other layer of the line) and clear
 * the layer, the latter armed on the first choice and done on the second
 * within a few seconds. Callbacks only - the section it stands in asks
 * the application. Licensed for one setTimeout (the arm).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateLayerMenu = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* A press outside, by the shared rule - a finger closes on a still
   * release, a mouse on the press - and the Back key's stack
   * (slate-dismiss.js). */
  function dismissal(target, inside, close) {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.outside === "function" ? shared.outside(target, inside, close) : Object.freeze({ start() {}, stop() {}, isOn: () => false });
  }

  const ARM_MS = 4000;
  const CLEAR_LABEL = "Clear layer";
  const CLEAR_ARMED_LABEL = "Confirm clear";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {string} options.layer         this layer's id
   * @param {string[]} options.others      the other layers' ids
   * @param {function} options.onCopyTo    (toLayer)
   * @param {function} options.onClear     ()
   * @param {function} [options.able]      () => { copy, clear }
   * @param {function} [options.reason]    (action) => why not
   * @param {function} [options.say]
   * @param {object} [options.timers]
   */
  function create(doc, options) {
    const settings = options || {};
    const layer = String(settings.layer || "");
    const others = Array.isArray(settings.others) ? settings.others.filter(id => id !== layer) : [];
    const onCopyTo = typeof settings.onCopyTo === "function" ? settings.onCopyTo : () => {};
    const onClear = typeof settings.onClear === "function" ? settings.onClear : () => {};
    const able = typeof settings.able === "function" ? settings.able : () => ({ copy: true, clear: true });
    const reason = typeof settings.reason === "function" ? settings.reason : () => "";
    const say = typeof settings.say === "function" ? settings.say : () => {};
    const timers = settings.timers || { setTimeout, clearTimeout };

    const rootEl = element(doc, "div", "slate-layer-menu");
    const button = element(doc, "button", "slate-layer-menu__button", {
      type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": `Layer ${layer} actions`, title: `Layer ${layer}`
    });
    for (let index = 0; index < 3; index += 1) button.appendChild(element(doc, "span", "slate-layer-menu__dot", { "aria-hidden": "true" }));
    rootEl.appendChild(button);
    const list = element(doc, "div", "slate-layer-menu__list", { role: "menu", hidden: "" });
    const items = [];
    for (const other of others) {
      const item = text(doc, "button", "slate-layer-menu__item", `Copy to layer ${other}`, { type: "button", role: "menuitem", "data-menu-copy": other });
      items.push({ item, action: "copy", other });
      list.appendChild(item);
    }
    const clear = text(doc, "button", "slate-layer-menu__item slate-layer-menu__item--danger", CLEAR_LABEL, { type: "button", role: "menuitem", "data-menu-clear": "" });
    items.push({ item: clear, action: "clear" });
    list.appendChild(clear);
    rootEl.appendChild(list);

    let open = false;
    let armTimer = null;

    function refresh() {
      const can = able() || {};
      for (const entry of items) {
        const allowed = !!can[entry.action];
        entry.item.setAttribute("aria-disabled", allowed ? "false" : "true");
        entry.item.setAttribute("title", allowed ? "" : `Unavailable: ${reason(entry.action)}`);
      }
    }

    function disarm() {
      if (armTimer !== null) { timers.clearTimeout(armTimer); armTimer = null; }
      clear.removeAttribute("data-armed");
      clear.textContent = CLEAR_LABEL;
    }

    const outsideCloser = dismissal(doc, node => rootEl.contains(node), () => close());

    function show() {
      if (open) return;
      open = true;
      refresh();
      list.removeAttribute("hidden");
      button.setAttribute("aria-expanded", "true");
      rootEl.classList.add("is-open");
      outsideCloser.start();
    }

    function close() {
      if (!open) return;
      open = false;
      disarm();
      list.setAttribute("hidden", "");
      button.setAttribute("aria-expanded", "false");
      rootEl.classList.remove("is-open");
      outsideCloser.stop();
    }

    button.addEventListener("click", () => { if (open) close(); else show(); });
    rootEl.addEventListener("keydown", event => {
      if (event && event.key === "Escape" && open) {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        close();
        if (typeof button.focus === "function") button.focus();
      }
    });
    list.addEventListener("click", event => {
      const target = event && event.target;
      const item = target && typeof target.closest === "function" ? target.closest("[role='menuitem']") : null;
      if (!item) return;
      const entry = items.find(one => one.item === item);
      if (!entry) return;
      if (item.getAttribute("aria-disabled") === "true") {
        say(`${entry.action === "clear" ? "Clear layer" : "Copy layer"} is unavailable: ${reason(entry.action)}`);
        return;
      }
      if (entry.action === "copy") {
        close();
        onCopyTo(entry.other);
        return;
      }
      if (!clear.hasAttribute("data-armed")) {
        clear.setAttribute("data-armed", "");
        clear.textContent = CLEAR_ARMED_LABEL;
        armTimer = timers.setTimeout(() => { armTimer = null; disarm(); }, ARM_MS);
        return;
      }
      close();
      onClear();
    });

    return Object.freeze({ element: rootEl, button, list, open: show, close, refresh, isOpen: () => open, isArmed: () => clear.hasAttribute("data-armed") });
  }

  return Object.freeze({ ARM_MS, CLEAR_LABEL, CLEAR_ARMED_LABEL, create });
});
