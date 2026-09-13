/* The bulk resin field: where the one resin Bulk Edit writes onto its
 * selection is entered.
 *
 * WHERE IT STANDS
 *
 * Above the machine rail's Blend Edit row, right-aligned to the Confirm
 * and Cancel the selection ends in and reaching back across the switch
 * (machine-rail.css): the empty band between the layer header and the
 * card, beside the two controls that act on what is typed - and never to
 * the RIGHT of the rail, where a far-right bank leaves no room. The boot
 * file builds ONE field and hands it to the rail, which stands it in the
 * Blend flyout; it shows while a selection is on and hides with it.
 *
 * WHAT IT HOLDS
 *
 * The draft, in its input, and what it was told to show - whether the
 * selection is on, how many hoppers are in it, and the catalog's codes.
 * The boot file keeps the draft too (told on every keystroke), so the
 * rail's Confirm can read it. Enter confirms and Escape cancels, each
 * handed to the boot file and spent here so the stage's own Escape does
 * not run twice; the write itself is the rail's Confirm or this Enter,
 * both the boot file's confirmBulk.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationBulkField = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The most catalog codes offered as suggestions. */
  const MAX_SUGGESTIONS = 400;

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

  function hoppers(count) {
    return `${count} hopper${count === 1 ? "" : "s"}`;
  }

  /**
   * Build the field.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {function} [options.onInput]   (value) => void; every keystroke
   * @param {function} [options.onConfirm] () => void; Enter
   * @param {function} [options.onCancel]  () => void; Escape
   * @returns {{ element, input, update, focus, isFocused, getState }}
   */
  function create(doc, options) {
    const settings = options || {};
    const onInput = typeof settings.onInput === "function" ? settings.onInput : () => {};
    const onConfirm = typeof settings.onConfirm === "function" ? settings.onConfirm : () => {};
    const onCancel = typeof settings.onCancel === "function" ? settings.onCancel : () => {};
    const activeElement = typeof settings.activeElement === "function"
      ? settings.activeElement
      : () => (doc && "activeElement" in doc ? doc.activeElement : null);

    const state = { shown: false, count: 0, resins: [] };

    const rootEl = element(doc, "label", "station-bulk-field", { "data-role": "bulk-resin", hidden: "", inert: "", "aria-hidden": "true" });
    const label = element(doc, "span", "station-bulk-field__label");
    label.textContent = "Resin";
    const listId = `station-bulk-resins-${Math.random().toString(36).slice(2, 8)}`;
    const input = element(doc, "input", "station-bulk-field__input", {
      type: "text", "data-action": "bulk-resin", autocomplete: "off", spellcheck: "false", placeholder: "Resin code", "aria-label": "Resin for selected hoppers", list: listId
    });
    const list = element(doc, "datalist", null, { id: listId });
    rootEl.appendChild(label);
    rootEl.appendChild(input);
    rootEl.appendChild(list);

    function draw() {
      const shown = state.shown;
      if (shown) { rootEl.removeAttribute("hidden"); rootEl.removeAttribute("inert"); rootEl.removeAttribute("aria-hidden"); }
      else { rootEl.setAttribute("hidden", ""); rootEl.setAttribute("inert", ""); rootEl.setAttribute("aria-hidden", "true"); }
      const what = state.count > 0 ? `Resin for ${hoppers(state.count)}` : "Resin for selected hoppers";
      input.setAttribute("aria-label", what);
      input.setAttribute("title", `${what} · Enter applies it, Escape cancels the selection`);
      label.textContent = state.count > 0 ? `Resin · ${hoppers(state.count)}` : "Resin name";
      if (typeof list.replaceChildren === "function") list.replaceChildren();
      else while (list.children && list.children.length) list.removeChild(list.children[0]);
      for (const code of state.resins) list.appendChild(element(doc, "option", null, { value: code }));
    }

    input.addEventListener("input", () => { onInput(String(input.value || "")); });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        onConfirm();
      } else if (event.key === "Escape") {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof event.preventDefault === "function") event.preventDefault();
        onCancel();
      }
    });

    /**
     * Tell the field what to show.
     *
     * @param {object} next
     * @param {boolean}  [next.shown]   a selection is on: the field shows
     * @param {number}   [next.count]   selected hoppers, for the label
     * @param {string}   [next.draft]   the draft, when the boot file holds a
     *        newer one than the input (a field rebuilt or moved)
     * @param {string[]} [next.resins]  catalog codes to suggest
     */
    function update(next) {
      const n = next || {};
      if (typeof n.shown === "boolean") state.shown = n.shown;
      if (Number.isInteger(n.count) && n.count >= 0) state.count = n.count;
      if (Array.isArray(n.resins)) state.resins = n.resins.filter(code => typeof code === "string" && code).slice(0, MAX_SUGGESTIONS);
      if (typeof n.draft === "string" && input.value !== n.draft) input.value = n.draft;
      draw();
    }

    function isFocused() {
      return activeElement() === input;
    }

    function focus() {
      if (!state.shown || typeof input.focus !== "function") return false;
      try { input.focus({ preventScroll: true }); } catch (error) { input.focus(); }
      return true;
    }

    draw();

    return {
      element: rootEl,
      input,
      update,
      focus,
      isFocused,
      getState: () => ({ shown: state.shown, count: state.count, draft: String(input.value || ""), resins: state.resins.slice() })
    };
  }

  return Object.freeze({ MAX_SUGGESTIONS, create });
});
