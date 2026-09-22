/* The bulk edit's arithmetic: what a draft of a whole tab would change.
 *
 * Bulk edit turns every resin and blend cell of the shown recipe into a
 * field at once, and nothing reaches the line until Apply. Apply is ONE
 * setHopperAssignments: `{ recipe, hoppers: [{ layer, index, resin?,
 * pct? }] }`, where each entry names what changes on that hopper and
 * leaves out what does not (station-command-contract.js). This file is
 * the pure part - the base the draft starts from, the diff, the live H1
 * preview, the layer totals, the foot's line - so the form (slate-recipe-
 * form.js) holds only fields and the section only the mode.
 *
 * Rules the contract and the executor set, kept here so the form never
 * sends what would be refused:
 *   - H1's blend is derived (100 - the layer's others); an entry naming a
 *     blend at index 0 is refused as `h1_derived`, so a draft never
 *     carries one. The preview is computed here instead.
 *   - Resins compare as the application compares them (sameResin from
 *     slate-source.js: trimmed, collapsed, case-insensitive); the code
 *     itself goes as typed.
 *   - A blank blend is 0. Blanking a resin is a clear: the row's blend
 *     goes with it (the form blanks the field, the diff carries pct 0).
 *   - Each layer's hoppers 2-6 must still total (the application's own
 *     validateHopperPercentages, handed in by the boot).
 *   - A fill writes one resin and/or one blend into several rows of the
 *     draft at once (the form's selection); a blank fill value leaves
 *     that field alone on every row, and H1 takes the resin only.
 *
 * No DOM, no timers, no bridge.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipeDraft = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NOT_A_NUMBER = "The blend must be a number.";
  const OUT_OF_RANGE = "The blend must be between 0 and 100.";
  const OVER_TOTAL = "Hopper percentages 2–6 cannot total more than 100%.";

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function plainSame(a, b) {
    const norm = value => String(value == null ? "" : value).trim().replace(/\s+/g, " ").toUpperCase();
    return norm(a) === norm(b);
  }

  /** A blend field's text as a number: blank is 0; not a number is NaN. */
  function pctOf(text) {
    const raw = String(text == null ? "" : text).trim().replace(/,/g, "");
    if (raw === "") return 0;
    const number = Number(raw);
    return Number.isFinite(number) ? number : NaN;
  }

  /** What is wrong with one blend field's text, or null. */
  function pctProblem(text) {
    const number = pctOf(text);
    if (Number.isNaN(number)) return NOT_A_NUMBER;
    if (number < 0 || number > 100) return OUT_OF_RANGE;
    return null;
  }

  /**
   * The base a draft starts from: every slot of the shown recipe, keyed
   * as the section's rows are ("A:0"), in layer then hopper order.
   *
   * @param {object} state  slate-source.js stateFor(resolved, recipe)
   * @param {object} model  resolved.line
   */
  function baseFrom(state, model) {
    const base = {};
    const hoppers = (state && state.hoppers) || {};
    const layers = model && Array.isArray(model.layers) ? model.layers : [];
    for (const layer of layers) {
      for (const hopper of layer.hoppers) {
        const key = `${layer.id}:${hopper.index}`;
        const slot = hoppers[key] || {};
        base[key] = Object.freeze({
          key, layer: layer.id, index: hopper.index, hopper: hopper.id,
          resin: slot.resinName ? String(slot.resinName) : "",
          pct: finite(slot.pct)
        });
      }
    }
    return base;
  }

  /** A draft seeded from the base: the text each field starts with. */
  function draftFrom(base) {
    const draft = {};
    for (const key of Object.keys(base)) {
      const slot = base[key];
      draft[key] = { resin: slot.resin, pct: slot.index > 0 && slot.pct > 0 ? String(slot.pct) : "" };
    }
    return draft;
  }

  /** The base with one slot moved underneath the draft (a foreign publish). */
  function rebase(base, key, slot) {
    if (!base[key]) return base;
    const next = Object.assign({}, base);
    next[key] = Object.freeze(Object.assign({}, base[key], {
      resin: slot && slot.resinName ? String(slot.resinName) : "",
      pct: finite(slot && slot.pct)
    }));
    return next;
  }

  /**
   * The contract-shaped list of what the draft changes: an entry per
   * hopper whose resin or blend differs from the base, naming only what
   * differs; never a blend at index 0. A blend that is not a number is
   * skipped here - problemsFor says so, and Apply is withheld on it.
   */
  function changesFor(base, draft, sameResin) {
    const same = typeof sameResin === "function" ? sameResin : plainSame;
    const out = [];
    for (const key of Object.keys(base)) {
      const from = base[key];
      const to = draft && draft[key];
      if (!to) continue;
      const entry = { layer: from.layer, index: from.index };
      const resin = String(to.resin == null ? "" : to.resin).trim().replace(/\s+/g, " ");
      if (!same(resin, from.resin)) entry.resin = resin;
      if (from.index > 0) {
        const pct = pctOf(to.pct);
        if (Number.isFinite(pct) && pct !== from.pct) entry.pct = pct;
      }
      if (entry.resin !== undefined || entry.pct !== undefined) out.push(Object.freeze(entry));
    }
    return out;
  }

  /** The fields that cannot be sent as typed: [{ key, message }]. */
  function problemsFor(base, draft) {
    const out = [];
    for (const key of Object.keys(base)) {
      const to = draft && draft[key];
      if (!to || base[key].index === 0) continue;
      const message = pctProblem(to.pct);
      if (message) out.push(Object.freeze({ key, message }));
    }
    return out;
  }

  function layerSlots(base, layerId) {
    return Object.keys(base).map(key => base[key]).filter(slot => slot.layer === layerId).sort((a, b) => a.index - b.index);
  }

  /**
   * H1's live preview for a layer: 100 less the draft's other blends.
   * `value` is null while any other blend is not a number; `over` says
   * the others already exceed 100 (the preview then shows nothing).
   */
  function derivedH1(base, draft, layerId) {
    let total = 0;
    for (const slot of layerSlots(base, layerId)) {
      if (slot.index === 0) continue;
      const to = draft && draft[slot.key];
      const pct = pctOf(to ? to.pct : "");
      if (Number.isNaN(pct)) return { value: null, over: false, total: null };
      total += pct;
    }
    const value = Math.round((100 - total) * 1000) / 1000;
    return { value: total > 100 ? null : value, over: total > 100, total };
  }

  /**
   * Each layer's hoppers 2-6 against the application's own rule, so the
   * foot can say which layer would be refused before Apply asks. Without
   * a validator the rule is the same one, restated.
   */
  function totalsFor(base, draft, model, validate) {
    const out = [];
    const layers = model && Array.isArray(model.layers) ? model.layers : [];
    for (const layer of layers) {
      const others = layerSlots(base, layer.id).filter(slot => slot.index > 0).map(slot => pctOf(draft && draft[slot.key] ? draft[slot.key].pct : ""));
      if (others.some(Number.isNaN)) { out.push(Object.freeze({ layer: layer.id, ok: false, message: NOT_A_NUMBER })); continue; }
      let result;
      if (typeof validate === "function") {
        try { result = validate(others); } catch (error) { result = null; }
      }
      if (!result) {
        const total = others.reduce((sum, value) => sum + value, 0);
        result = others.some(value => value < 0 || value > 100)
          ? { valid: false, message: OUT_OF_RANGE }
          : { valid: total <= 100, total, message: total <= 100 ? "" : OVER_TOTAL };
      }
      out.push(Object.freeze({ layer: layer.id, ok: !!result.valid, message: result.valid ? "" : String(result.message || OVER_TOTAL) }));
    }
    return out;
  }

  /**
   * One value into many rows: the selected keys take `resin` where one
   * is given and `pct` where one is given (never at index 0). Returns
   * how many fields moved, so the caller can say so; a fill naming
   * nothing, or only a blend for H1s, moves none.
   */
  function fillInto(base, draft, keys, values) {
    const resin = String(values && values.resin != null ? values.resin : "").trim().replace(/\s+/g, " ");
    const pct = String(values && values.pct != null ? values.pct : "").trim();
    let moved = 0;
    for (const key of Array.isArray(keys) ? keys : []) {
      const slot = base[key];
      const to = draft && draft[key];
      if (!slot || !to) continue;
      if (resin !== "" && to.resin !== resin) { to.resin = resin; moved += 1; }
      if (pct !== "" && slot.index > 0 && to.pct !== pct) { to.pct = pct; moved += 1; }
    }
    return moved;
  }

  /** The foot's line. */
  function summary(changes) {
    const count = Array.isArray(changes) ? changes.length : 0;
    if (count === 0) return "Nothing changes";
    if (count === 1) return "1 hopper changes on Apply";
    return `${count} hoppers change on Apply`;
  }

  /** What the section says once the application took the list. */
  function applied(changes) {
    const count = Array.isArray(changes) ? changes.length : 0;
    return count === 1 ? "1 hopper changed." : `${count} hoppers changed.`;
  }

  return Object.freeze({
    NOT_A_NUMBER, OUT_OF_RANGE, OVER_TOTAL,
    pctOf, pctProblem, baseFrom, draftFrom, rebase, changesFor, problemsFor, derivedH1, totalsFor, fillInto, summary, applied
  });
});
