/* The hopper editor: where a selection of hoppers is written to, in the
 * header beside the changeover readout.
 *
 * WHAT IT IS
 *
 * One small form for the hoppers the operator has selected on the Blend
 * Edit cards (a click on a card's badge selects it; the boot file keeps
 * the selection): how many are selected, a resin field, a percentage
 * field, Apply and Cancel. Both fields default to NO CHANGE - an empty
 * field leaves that value as it is on every selected hopper - so a resin
 * can be written without touching the blend, a blend without touching
 * the resin, or both at once. Apply is held until a hopper is selected
 * and something is entered; Cancel clears the selection and the fields.
 *
 * WHERE IT STANDS
 *
 * In the header's own slot (station-shell.js: `edit`), to the right of
 * the job ribbon whose changeover readout launches the calculator - the
 * one place on the console that is neither the stage nor a surface over
 * it, so the form stands still while the cards below it are selected
 * from, and never covers a card. Shown while the selection holds a
 * hopper; hidden, inert and out of the reader's tree otherwise.
 *
 * WHAT IT HOLDS
 *
 * The drafts, in their inputs, and what it was told to show - whether a
 * selection is on, how many hoppers are in it, which recipe it writes
 * to, and the catalog's codes. The boot file keeps the drafts too (told
 * on every keystroke), so a rebuilt form takes them back. Enter in
 * either field applies and Escape cancels, each handed to the boot file
 * and spent here so the stage's own Escape does not run twice; the write
 * itself is the boot file's (station-blend-actions.js applyAssignments)
 * - this module dispatches nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationHopperEdit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The most catalog codes offered as suggestions. */
  const MAX_SUGGESTIONS = 400;

  const LABEL = Object.freeze({
    resin: "Resin",
    pct: "%",
    apply: "Apply",
    cancel: "Cancel",
    noChange: "No change"
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

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function hoppers(count) {
    return `${count} hopper${count === 1 ? "" : "s"}`;
  }

  /* The percentage field's reading of itself: empty is no change; a
   * number in 0..100 is the blend; anything else is not a percentage.
   * Pure, so the boot file reads the draft the same way. */
  function readPct(value) {
    const typed = String(value === null || value === undefined ? "" : value).trim();
    if (!typed) return { ok: true, pct: null };
    const number = Number(typed.replace(/,/g, "").replace(/%$/, ""));
    if (!Number.isFinite(number)) return { ok: false, message: "The percentage must be a number." };
    if (number < 0 || number > 100) return { ok: false, message: "The percentage must be between 0 and 100." };
    return { ok: true, pct: number };
  }

  /* The resin field's: empty is no change; otherwise the code as typed,
   * trimmed - the application normalizes it further. */
  function readResin(value) {
    const typed = String(value === null || value === undefined ? "" : value).trim();
    return typed ? { ok: true, resin: typed } : { ok: true, resin: null };
  }

  /**
   * Build the editor.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {function} [options.onInput]  ({ resin, pct }) => void; every keystroke, both drafts
   * @param {function} [options.onApply]  () => void; Apply, or Enter in a field
   * @param {function} [options.onCancel] () => void; Cancel, or Escape in a field
   * @param {function} [options.activeElement] () => Element; the document's, by default
   * @returns {{ element, resinInput, pctInput, applyButton, cancelButton, update, focus, isFocused, getState }}
   */
  function create(doc, options) {
    const settings = options || {};
    const onInput = typeof settings.onInput === "function" ? settings.onInput : () => {};
    const onApply = typeof settings.onApply === "function" ? settings.onApply : () => {};
    const onCancel = typeof settings.onCancel === "function" ? settings.onCancel : () => {};
    const activeElement = typeof settings.activeElement === "function"
      ? settings.activeElement
      : () => (doc && "activeElement" in doc ? doc.activeElement : null);

    const state = { shown: false, count: 0, recipe: "current", resins: [] };

    const rootEl = element(doc, "form", "station-hopper-edit station-glass", {
      "data-role": "hopper-edit", role: "group", "aria-label": "Selected hoppers", hidden: "", inert: "", "aria-hidden": "true"
    });
    // A form so the fields group for a reader; it never submits - Enter
    // is spent on the field (below) and Apply is a plain button.
    rootEl.addEventListener("submit", event => {
      if (typeof event.preventDefault === "function") event.preventDefault();
    });

    const count = text(doc, "span", "station-hopper-edit__count", "", { "data-role": "hopper-edit-count" });
    rootEl.appendChild(count);

    const suffix = Math.random().toString(36).slice(2, 8);
    const listId = `station-hopper-edit-resins-${suffix}`;

    const resinField = element(doc, "label", "station-hopper-edit__field station-hopper-edit__field--resin");
    resinField.appendChild(text(doc, "span", "station-hopper-edit__label", LABEL.resin));
    const resinInput = element(doc, "input", "station-hopper-edit__input station-hopper-edit__input--resin", {
      type: "text", "data-action": "edit-resin", autocomplete: "off", spellcheck: "false", placeholder: LABEL.noChange,
      "aria-label": "Resin for the selected hoppers", list: listId
    });
    resinField.appendChild(resinInput);
    const list = element(doc, "datalist", null, { id: listId });
    resinField.appendChild(list);
    rootEl.appendChild(resinField);

    const pctField = element(doc, "label", "station-hopper-edit__field station-hopper-edit__field--pct");
    pctField.appendChild(text(doc, "span", "station-hopper-edit__label", LABEL.pct));
    const pctInput = element(doc, "input", "station-hopper-edit__input station-hopper-edit__input--pct", {
      type: "text", inputmode: "decimal", "data-action": "edit-pct", autocomplete: "off", spellcheck: "false", placeholder: LABEL.noChange,
      "aria-label": "Blend percentage for the selected hoppers"
    });
    pctField.appendChild(pctInput);
    rootEl.appendChild(pctField);

    const applyButton = text(doc, "button", "station-hopper-edit__action is-primary", LABEL.apply, {
      type: "button", "data-action": "edit-apply", title: LABEL.apply
    });
    applyButton.addEventListener("click", event => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (!applyButton.disabled) onApply();
    });
    rootEl.appendChild(applyButton);
    const cancelButton = text(doc, "button", "station-hopper-edit__action", LABEL.cancel, {
      type: "button", "data-action": "edit-cancel", title: `${LABEL.cancel} · clears the selection; nothing is written`
    });
    cancelButton.addEventListener("click", event => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      onCancel();
    });
    rootEl.appendChild(cancelButton);

    function drafts() {
      return { resin: String(resinInput.value || ""), pct: String(pctInput.value || "") };
    }

    /* What Apply would do, for its title and whether it is held: nothing
     * without a hopper; nothing with both fields empty; a bad percentage
     * says so; otherwise what is written where. */
    function describe() {
      const d = drafts();
      const resin = readResin(d.resin);
      const pct = readPct(d.pct);
      const where = state.recipe === "next" ? " in the plan" : "";
      if (state.count === 0) return { able: false, title: `${LABEL.apply} · select a hopper on a card first` };
      if (!pct.ok) return { able: false, title: `${LABEL.apply} · ${pct.message}` };
      if (resin.resin === null && pct.pct === null) return { able: false, title: `${LABEL.apply} · enter a resin, a percentage, or both; an empty field is no change` };
      const parts = [];
      if (resin.resin !== null) parts.push(`resin ${resin.resin}`);
      if (pct.pct !== null) parts.push(`${pct.pct}%`);
      return { able: true, title: `Apply ${parts.join(" and ")} to ${hoppers(state.count)}${where}` };
    }

    function draw() {
      const shown = state.shown;
      if (shown) { rootEl.removeAttribute("hidden"); rootEl.removeAttribute("inert"); rootEl.removeAttribute("aria-hidden"); }
      else { rootEl.setAttribute("hidden", ""); rootEl.setAttribute("inert", ""); rootEl.setAttribute("aria-hidden", "true"); }
      rootEl.setAttribute("data-recipe", state.recipe);
      const where = state.recipe === "next" ? " · plan" : "";
      count.textContent = state.count > 0 ? `${hoppers(state.count)}${where}` : "";
      count.setAttribute("title", state.count > 0
        ? `${hoppers(state.count)} selected${state.recipe === "next" ? " on the plan's cards" : ""} · Apply writes to all of them`
        : "");
      resinInput.setAttribute("title", `Resin for ${state.count > 0 ? hoppers(state.count) : "the selected hoppers"} · empty leaves each hopper's resin as it is · Enter applies, Escape cancels`);
      pctInput.setAttribute("title", `Blend percentage for ${state.count > 0 ? hoppers(state.count) : "the selected hoppers"} · empty leaves each hopper's blend as it is · Enter applies, Escape cancels`);
      const what = describe();
      applyButton.disabled = !what.able;
      if (what.able) applyButton.removeAttribute("disabled");
      else applyButton.setAttribute("disabled", "");
      applyButton.setAttribute("title", what.title);
      if (typeof list.replaceChildren === "function") list.replaceChildren();
      else while (list.children && list.children.length) list.removeChild(list.children[0]);
      for (const code of state.resins) list.appendChild(element(doc, "option", null, { value: code }));
    }

    function keys(input) {
      input.addEventListener("input", () => { draw(); onInput(drafts()); });
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (!applyButton.disabled) onApply();
        } else if (event.key === "Escape") {
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          if (typeof event.preventDefault === "function") event.preventDefault();
          onCancel();
        }
      });
    }
    keys(resinInput);
    keys(pctInput);

    /**
     * Tell the editor what to show.
     *
     * @param {object} next
     * @param {boolean}  [next.shown]   a hopper is selected: the form shows
     * @param {number}   [next.count]   selected hoppers
     * @param {string}   [next.recipe]  "current" | "next": which recipe Apply writes to
     * @param {string}   [next.resin]   the resin draft, when the boot file holds a
     *        newer one than the input (a form rebuilt)
     * @param {string}   [next.pct]     the percentage draft, the same way
     * @param {string[]} [next.resins]  catalog codes to suggest
     */
    function update(next) {
      const n = next || {};
      if (typeof n.shown === "boolean") state.shown = n.shown;
      if (Number.isInteger(n.count) && n.count >= 0) state.count = n.count;
      if (n.recipe === "current" || n.recipe === "next") state.recipe = n.recipe;
      if (Array.isArray(n.resins)) state.resins = n.resins.filter(code => typeof code === "string" && code).slice(0, MAX_SUGGESTIONS);
      if (typeof n.resin === "string" && resinInput.value !== n.resin) resinInput.value = n.resin;
      if (typeof n.pct === "string" && pctInput.value !== n.pct) pctInput.value = n.pct;
      draw();
    }

    function isFocused() {
      const active = activeElement();
      return active === resinInput || active === pctInput;
    }

    /* Focus the resin field: the first thing to enter. */
    function focus() {
      if (!state.shown || typeof resinInput.focus !== "function") return false;
      try { resinInput.focus({ preventScroll: true }); } catch (error) { resinInput.focus(); }
      return true;
    }

    draw();

    return {
      element: rootEl,
      resinInput,
      pctInput,
      applyButton,
      cancelButton,
      update,
      focus,
      isFocused,
      getState: () => Object.assign({ shown: state.shown, count: state.count, recipe: state.recipe, resins: state.resins.slice() }, drafts())
    };
  }

  return Object.freeze({ MAX_SUGGESTIONS, LABEL, readPct, readResin, create });
});
