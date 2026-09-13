/* The layer card's menu: a quiet "⋯" in the bottom-left of a Blend Edit
 * card (station-focus-editor.js, compact variant) that opens the three
 * things done to a layer as a whole - Copy, Paste and Reset.
 *
 * WHAT IT IS
 *
 * The Recipe grid gives every layer column a Copy / Paste / Cancel button
 * and a Reset all. On the stage those become one control per card, as
 * small as a control can be - three dots, no pill, no border, faded until
 * the pointer or the keyboard reaches it - and a short menu over it:
 *
 *   Copy layer         arms this layer as the source. While a layer is
 *                      armed the same item reads Cancel copy on that
 *                      layer's card, and the card wears a quiet ring
 *                      (focus-editor.css) so the clipboard is readable
 *                      without hunting for the word.
 *   Paste from Layer X the armed layer's assignment - every hopper's resin
 *                      and blend - written onto this layer. Disabled while
 *                      nothing is armed, and on the source itself. On a
 *                      3-layer line's core the title says resin only, the
 *                      grid's one exception (station-blend-actions.js
 *                      words it; the application applies it). One paste
 *                      per copy: the boot file disarms after.
 *   Reset layer        every hopper emptied. Destructive and easy to do by
 *                      accident, so it is two clicks in place, as the
 *                      rail's Reset Tracking is: the first ARMS the item,
 *                      which reads Confirm reset and waits; the second
 *                      confirms. A pause, Escape, or the menu closing
 *                      disarm it. No dialog.
 *
 * The menu closes on a choice, on Escape (spent here, so the stage's own
 * Escape does not leave the mode under it), on a press anywhere outside it,
 * and when focus leaves it.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: whether it is open, whether the reset is armed,
 * and what it was last told to show - which layer is the source, how many
 * layers the line has, what the bridge offers. It reads no job and
 * dispatches nothing: every choice is handed to the boot file through the
 * callbacks it was built with. Built as the rest of Station is: HTML from
 * an injected document, no framework, every look in the stylesheet.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationLayerMenu = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* How long an armed reset waits for its confirming click - the rail's. */
  const ARM_DURATION = 5000;

  const LABEL = Object.freeze({
    more: "Layer actions", copy: "Copy layer", cancel: "Cancel copy", paste: "Paste layer", reset: "Reset layer", confirm: "Confirm reset"
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

  function text(doc, name, className, content, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = content;
    return node;
  }

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  /**
   * Build the menu for one card.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {string}   options.layer          the card's layer id
   * @param {function} [options.onCopy]       () => void; arm this layer as the source
   * @param {function} [options.onCancelCopy] () => void; disarm it
   * @param {function} [options.onPaste]      () => void; paste the source onto this layer
   * @param {function} [options.onReset]      () => void; the confirming click
   * @param {function} [options.resinOnly]    (layerCount, layerId) => boolean; the
   *        paste exception's wording (station-blend-actions.js resinOnlyTarget)
   * @param {function} [options.setTimeout]   for the arm timer; the host's by default
   * @param {function} [options.clearTimeout]
   * @param {number}   [options.armDuration]
   * @returns {{ element, button, menu, items, update, open, close, isOpen, isArmed, getState }}
   */
  function create(doc, options) {
    const settings = options || {};
    const layer = String(settings.layer || "");
    const onCopy = typeof settings.onCopy === "function" ? settings.onCopy : () => {};
    const onCancelCopy = typeof settings.onCancelCopy === "function" ? settings.onCancelCopy : () => {};
    const onPaste = typeof settings.onPaste === "function" ? settings.onPaste : () => {};
    const onReset = typeof settings.onReset === "function" ? settings.onReset : () => {};
    const resinOnly = typeof settings.resinOnly === "function" ? settings.resinOnly : () => false;
    const timers = {
      set: typeof settings.setTimeout === "function" ? settings.setTimeout : (typeof setTimeout === "function" ? setTimeout : null),
      clear: typeof settings.clearTimeout === "function" ? settings.clearTimeout : (typeof clearTimeout === "function" ? clearTimeout : null)
    };
    const armDuration = finite(settings.armDuration) && settings.armDuration >= 0 ? settings.armDuration : ARM_DURATION;

    const state = {
      open: false,
      armed: false,
      timer: null,
      /* What it was told: the armed source layer (or null), the line's
       * layer count, and which of the three the bridge offers. */
      source: null,
      layerCount: 0,
      able: { copy: false, paste: false, reset: false },
      reason: ""
    };

    const rootEl = element(doc, "div", "station-layer-menu", { "data-role": "layer-menu", "data-layer": layer, "data-open": "false" });
    const button = element(doc, "button", "station-layer-menu__button", {
      type: "button", "data-action": "layer-menu", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": `${LABEL.more} for Layer ${layer}`, title: LABEL.more
    });
    for (let i = 0; i < 3; i++) button.appendChild(element(doc, "span", "station-layer-menu__dot", { "aria-hidden": "true" }));
    const menu = element(doc, "div", "station-layer-menu__list", { role: "menu", "aria-label": `Layer ${layer} actions`, "data-open": "false", inert: "", "aria-hidden": "true" });
    const items = {
      copy: text(doc, "button", "station-layer-menu__item station-layer-menu__item--copy", LABEL.copy, { type: "button", role: "menuitem", "data-action": "copy-layer" }),
      paste: text(doc, "button", "station-layer-menu__item station-layer-menu__item--paste", LABEL.paste, { type: "button", role: "menuitem", "data-action": "paste-layer" }),
      reset: text(doc, "button", "station-layer-menu__item station-layer-menu__item--reset", LABEL.reset, { type: "button", role: "menuitem", "data-action": "reset-layer" })
    };
    menu.appendChild(items.copy);
    menu.appendChild(items.paste);
    menu.appendChild(items.reset);
    rootEl.appendChild(button);
    rootEl.appendChild(menu);

    /* ---- Drawing what it was told ---- */

    function draw() {
      rootEl.setAttribute("data-open", state.open ? "true" : "false");
      rootEl.classList.toggle("is-open", state.open);
      rootEl.classList.toggle("is-source", state.source === layer);
      button.setAttribute("aria-expanded", state.open ? "true" : "false");
      menu.setAttribute("data-open", state.open ? "true" : "false");
      if (state.open) { menu.removeAttribute("inert"); menu.setAttribute("aria-hidden", "false"); }
      else { menu.setAttribute("inert", ""); menu.setAttribute("aria-hidden", "true"); }

      const isSource = state.source === layer;
      const unavailable = `${state.reason || "no application is connected to Station commands."}`;
      items.copy.textContent = isSource ? LABEL.cancel : LABEL.copy;
      items.copy.disabled = !state.able.copy && !isSource;
      items.copy.setAttribute("title", isSource
        ? `${LABEL.cancel} · Layer ${layer} is no longer the layer to paste`
        : (state.able.copy ? `${LABEL.copy} · Layer ${layer}'s resins and blend, ready to paste onto another layer` : `${LABEL.copy} is not available: ${unavailable}`));

      const canPaste = state.able.paste && !!state.source && !isSource;
      items.paste.textContent = state.source && !isSource ? `Paste from Layer ${state.source}` : LABEL.paste;
      items.paste.disabled = !canPaste;
      items.paste.setAttribute("title", !state.able.paste
        ? `${LABEL.paste} is not available: ${unavailable}`
        : (!state.source
          ? `${LABEL.paste} · copy a layer first`
          : (isSource
            ? `${LABEL.paste} · this is the copied layer; choose another layer to paste onto`
            : (resinOnly(state.layerCount, layer)
              ? `Paste Layer ${state.source}'s resins onto Layer ${layer} · the core layer keeps its own percentages`
              : `Paste Layer ${state.source}'s resins and blend onto Layer ${layer}`))));

      items.reset.textContent = state.armed ? LABEL.confirm : LABEL.reset;
      items.reset.disabled = !state.able.reset;
      items.reset.classList.toggle("is-armed", state.armed);
      if (state.armed) items.reset.setAttribute("data-armed", "true");
      else items.reset.removeAttribute("data-armed");
      items.reset.setAttribute("aria-label", state.armed ? `Confirm: reset Layer ${layer}` : `${LABEL.reset} ${layer}`);
      items.reset.setAttribute("title", state.armed
        ? `Click again to reset Layer ${layer} · every hopper's resin and percentage cleared, tracking off`
        : (state.able.reset ? `${LABEL.reset} · every hopper on Layer ${layer} emptied; asks once more before it does` : `${LABEL.reset} is not available: ${unavailable}`));
    }

    /* ---- Arming the reset ---- */

    function disarm() {
      if (!state.armed) return false;
      state.armed = false;
      if (state.timer !== null && timers.clear) timers.clear(state.timer);
      state.timer = null;
      draw();
      return true;
    }

    function arm() {
      if (state.armed) return false;
      state.armed = true;
      if (timers.set && armDuration > 0) state.timer = timers.set(() => { state.timer = null; disarm(); }, armDuration);
      draw();
      return true;
    }

    /* ---- Opening and closing ---- */

    function onDocumentPointerDown(event) {
      const target = event && event.target;
      if (target && typeof rootEl.contains === "function" && rootEl.contains(target)) return;
      close();
    }

    function open() {
      if (state.open) return false;
      state.open = true;
      if (typeof doc.addEventListener === "function") doc.addEventListener("pointerdown", onDocumentPointerDown, true);
      draw();
      const first = [items.copy, items.paste, items.reset].find(item => !item.disabled);
      if (first && typeof first.focus === "function") first.focus();
      return true;
    }

    function close(options) {
      const restore = !!(options && options.restoreFocus);
      if (!state.open) return false;
      state.open = false;
      disarm();
      if (typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      draw();
      if (restore && typeof button.focus === "function") button.focus();
      return true;
    }

    button.addEventListener("click", () => {
      if (state.open) close({ restoreFocus: true });
      else open();
    });

    items.copy.addEventListener("click", () => {
      if (items.copy.disabled) return;
      const cancelling = state.source === layer;
      close({ restoreFocus: true });
      if (cancelling) onCancelCopy();
      else onCopy();
    });
    items.paste.addEventListener("click", () => {
      if (items.paste.disabled) return;
      close({ restoreFocus: true });
      onPaste();
    });
    items.reset.addEventListener("click", () => {
      if (items.reset.disabled) return;
      if (!state.armed) { arm(); return; }
      close({ restoreFocus: true });
      onReset();
    });

    /* Escape closes the menu (and disarms with it) and is spent here; the
     * arrow keys walk the items, as a menu's do. */
    menu.addEventListener("keydown", event => {
      if (!state.open) return;
      if (event.key === "Escape") {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof event.preventDefault === "function") event.preventDefault();
        close({ restoreFocus: true });
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const list = [items.copy, items.paste, items.reset].filter(item => !item.disabled);
      if (!list.length) return;
      const at = list.indexOf(event.target);
      const next = list[(at + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length];
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (next && typeof next.focus === "function") next.focus();
    });
    /* Focus leaving the menu altogether closes it. */
    rootEl.addEventListener("focusout", event => {
      const to = event && event.relatedTarget;
      if (to && typeof rootEl.contains === "function" && rootEl.contains(to)) return;
      if (state.open) close();
    });

    /* ---- The surface ---- */

    /**
     * Tell the menu what to show.
     *
     * @param {object} next
     * @param {string|null} [next.source]     the armed source layer's id, or null
     * @param {number}      [next.layerCount] how many layers the line has
     * @param {object}      [next.able]       { copy, paste, reset } - the bridge's offer
     * @param {string}      [next.reason]     why not, when it does not
     */
    function update(next) {
      const n = next || {};
      if ("source" in n) state.source = typeof n.source === "string" && n.source ? n.source : null;
      if (finite(n.layerCount)) state.layerCount = n.layerCount;
      if (n.able && typeof n.able === "object") {
        state.able = { copy: !!n.able.copy, paste: !!n.able.paste, reset: !!n.able.reset };
      }
      if (typeof n.reason === "string") state.reason = n.reason;
      if (state.armed && !state.able.reset) disarm();
      else draw();
    }

    draw();

    return {
      element: rootEl,
      button,
      menu,
      items,
      update,
      open,
      close,
      disarm,
      isOpen: () => state.open,
      isArmed: () => state.armed,
      getState: () => ({ open: state.open, armed: state.armed, source: state.source, layerCount: state.layerCount, able: Object.assign({}, state.able) })
    };
  }

  return Object.freeze({ ARM_DURATION, LABEL, create });
});
