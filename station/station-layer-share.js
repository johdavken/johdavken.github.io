/* Station layer share - the layer's percentage of the film, edited in
 * its header.
 *
 * WHAT IT IS
 *
 * The write seam for the one value a layer carries that is not a
 * hopper's: its share of the film structure, drawn in the third line of
 * the layer header (station-machine-parts.js: layerShare). A click on
 * the drawn value (station.js delegates it here) opens a compact field
 * in the same slot; Enter or leaving the field hands the value to the
 * application as ONE command through the command bridge the caller was
 * handed - setLayerShare, addressed to the Current recipe and one layer
 * - and the answer goes back to the caller untouched. The application
 * judges the value by its own rule (the grid's: a number, 0 to 100,
 * blank meaning 0, whether the layers total 100 an attention fact
 * rather than a block), carries it out along its own paths, saves,
 * syncs and publishes; the caller runs the publish policy over the
 * answer, so what the header then shows is what the application holds,
 * never what was asked for.
 *
 * THE FIELD
 *
 * The same conventions as the header's job controls and the editors'
 * blend field: Enter commits; Escape drops the draft and closes; leaving
 * the field by any other route commits a changed value, once. A value
 * the field can see is unchanged is not handed over - the field simply
 * closes. A refused draft stays in the field, marked, with the reason
 * on the note, for the operator to correct or abandon. The field is
 * HTML in a <foreignObject> sized to the slot the label occupies, so
 * the header is the same height with the field in it as without.
 *
 * WHAT IT HOLDS
 *
 * One open editor at most, and only while it is open: no copy of any
 * recipe value, no timers. It never reaches for the global bridge; it is
 * handed one, or null, and answers `unavailable` for null exactly as the
 * bridge itself answers for no producer - so the standalone harness and
 * a pinned demo are read-only here by the same rule that makes them
 * read-only everywhere else.
 *
 * WHY A SEPARATE FILE
 *
 * station.js is a reader that hands bridges over; it does not dispatch
 * (station-isolation.test.js). The focused editor dispatches for its
 * rows, the hopper controls for the cluster, the job controls for the
 * line. The layer's share is none of those: it lives on the drawing, in
 * the header, and works with no layer open and in Blend Edit alike. So it
 * gets a module of its own, as small as the seam it is, and the isolation
 * test names it as the fourth file that may say `.dispatch(`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationLayerShare = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMMAND = "setLayerShare";
  const TARGET = "share";
  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function round(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  /* The value as the label shows it, and as the field opens with it:
   * the number, rounded as the drawing rounds; nothing for an unknown
   * share, so the field opens blank rather than with a dash in it. */
  function restingText(value) {
    return Number.isFinite(value) && value > 0 ? String(round(value)) : "";
  }

  /* Whether the bridge offers the command, and why not when it does not.
   * Asked once per render: the application declares its commands when it
   * connects. The share is recipe state, so any recipe may carry it; the
   * caller names the one it shows. */
  function abilities(commands, recipe) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    const usable = connected && typeof commands.dispatch === "function" && typeof commands.capabilities === "function";
    const offered = usable ? commands.capabilities() : [];
    return Object.freeze({
      share: !!recipe && usable && Array.isArray(offered) && offered.includes(COMMAND)
    });
  }

  function reason(commands, recipe) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    if (!connected) return "no application is connected to Station commands.";
    if (!recipe) return "no recipe is being shown.";
    return "the application does not offer layer shares from Station.";
  }

  /* The request a drawn share's element describes. The renderer writes
   * the layer's address and the offer onto the group
   * (station-machine-parts.js); this reads them back, so the click needs
   * nothing but the element it landed on. Null for anything that is not
   * a share. */
  function requestFrom(element) {
    if (!element || typeof element.getAttribute !== "function") return null;
    if (element.getAttribute("data-station-target") !== TARGET) return null;
    const layer = element.getAttribute("data-layer");
    if (!layer) return null;
    return Object.freeze({
      layer,
      able: element.getAttribute("data-able") === "true"
    });
  }

  function unavailable(message) {
    return Object.freeze({ ok: false, code: "unavailable", message });
  }

  function element(doc, ns, name, className, attributes) {
    const el = doc.createElementNS ? doc.createElementNS(ns, name) : doc.createElement(name);
    if (className) el.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        el.setAttribute(key, String(value));
      }
    }
    return el;
  }

  /* The slot's box, read off the face the renderer drew: the drawing is
   * the source of where the slot is, in canvas units, at every scale. */
  function slotBox(target) {
    const face = typeof target.querySelector === "function" ? target.querySelector(".station-layer__share-face") : null;
    if (!face) return null;
    const box = {};
    for (const key of ["x", "y", "width", "height"]) {
      const value = Number(face.getAttribute(key));
      if (!Number.isFinite(value)) return null;
      box[key] = value;
    }
    return box;
  }

  /**
   * Open the share editor in a drawn share's slot.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {Element} options.target      the share group the click landed on
   * @param {string}  options.layer       the layer id, as the request says
   * @param {number|null} options.value   the share the application holds
   * @param {object|null} options.commands  the command bridge the caller was handed
   * @param {string}  options.recipe      which recipe the command addresses
   * @param {function} [options.note]     where a refusal is said; "" clears it
   * @param {function} [options.onEditing]  the control the operator is in, or null
   * @param {function} [options.onCommitted] a command changed something: its result
   * @param {function} [options.onClosed]  the editor left the slot, by any route
   * @returns {object|null} the handle, or null when the slot cannot hold one
   */
  function open(doc, options) {
    const settings = options || {};
    const target = settings.target;
    const layer = settings.layer;
    if (!doc || !target || !layer) return null;
    const box = slotBox(target);
    if (!box) return null;
    const commands = settings.commands || null;
    const note = typeof settings.note === "function" ? settings.note : () => {};
    const onEditing = typeof settings.onEditing === "function" ? settings.onEditing : () => {};
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const onClosed = typeof settings.onClosed === "function" ? settings.onClosed : () => {};
    const base = restingText(settings.value);

    const host = element(doc, SVG_NS, "foreignObject", "station-layer__share-editor", {
      x: box.x, y: box.y, width: box.width, height: box.height
    });
    const form = element(doc, XHTML_NS, "div", "station-layer__share-form");
    const input = element(doc, XHTML_NS, "input", "station-layer__share-input", {
      type: "text",
      inputmode: "decimal",
      autocomplete: "off",
      spellcheck: "false",
      "data-slot": "share",
      "aria-label": `Layer ${layer} percentage`
    });
    input.value = base;
    const unit = element(doc, XHTML_NS, "span", "station-layer__share-unit", { "aria-hidden": "true" });
    unit.textContent = "%";
    form.appendChild(input);
    form.appendChild(unit);
    host.appendChild(form);

    const state = { open: true, committing: false };

    function record() {
      return {
        layer,
        index: null,
        hopper: null,
        slot: "share",
        mode: "typing",
        draft: String(input.value === undefined || input.value === null ? "" : input.value),
        baseValue: base
      };
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      if (host.parentNode && typeof host.parentNode.removeChild === "function") host.parentNode.removeChild(host);
      if (target.classList) {
        target.classList.remove("is-editing");
        target.classList.remove("is-invalid");
      }
      onEditing(null);
      onClosed();
    }

    /* WRITE CONTRACT: the field's value is handed to the application as
     * setLayerShare. The field's own reading of itself is the grid's:
     * blank means 0. Everything else - whether it is a number, in range
     * - is the application's to judge, and its answer is shown as the
     * note. A refused draft stays in the field, marked; an accepted one
     * is replaced by what the application now holds, on the label the
     * publish policy updates. */
    function commit() {
      if (!state.open || state.committing) return null;
      const draft = String(input.value === undefined || input.value === null ? "" : input.value).trim();
      if (draft === base) { close(); note(""); return null; }   // unchanged: nothing to hand over
      if (!commands || typeof commands.dispatch !== "function") {
        const refused = unavailable("No application is connected to Station commands.");
        markInvalid(refused.message);
        return refused;
      }
      state.committing = true;
      let result;
      try {
        result = commands.dispatch(COMMAND, { recipe: settings.recipe, layer, pct: draft === "" ? "0" : draft });
      } finally {
        state.committing = false;
      }
      if (!result || !result.ok) {
        markInvalid(result && result.message ? result.message : "The change could not be applied.");
        return result;
      }
      close();
      note("");
      if (result.changed) onCommitted(result);
      return result;
    }

    function markInvalid(message) {
      input.setAttribute("aria-invalid", "true");
      if (target.classList) target.classList.add("is-invalid");
      note(message);
      onEditing(record());
    }

    function cancel() {
      if (!state.open) return;
      close();
      note("");
    }

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        // The key is spent here: the boot file's Escape closes layers and
        // leaves Blend Edit, and a dropped draft is neither.
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        cancel();
      }
    });
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      if (target.classList) target.classList.remove("is-invalid");
      onEditing(record());
    });
    /* Leaving the field commits a changed value - once: a value Enter
     * already committed has closed the field by then. */
    input.addEventListener("blur", () => {
      if (!state.open || state.committing) return;
      commit();
    });

    target.appendChild(host);
    if (target.classList) target.classList.add("is-editing");
    note("");
    onEditing(record());
    if (typeof input.focus === "function") input.focus();
    if (typeof input.select === "function") input.select();

    return Object.freeze({
      layer,
      element: host,
      input,
      isOpen: () => state.open,
      focus: () => { if (state.open && typeof input.focus === "function") input.focus(); },
      commit,
      cancel,
      close
    });
  }

  return Object.freeze({ COMMAND, TARGET, restingText, abilities, reason, requestFrom, open });
});
