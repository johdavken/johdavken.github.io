/* The bulk edit's fields: one tab of the Recipe section as a form.
 *
 * Built over a body the section already holds - its rows, each with a
 * resin cell and a blend cell - the form hides those two cells on every
 * row and stands a field in each one's place, seeded with the value
 * shown: the resin as a text field with the catalog's suggestions under
 * it (slate-resin-search.js's attach), the blend as a number field, and
 * H1's blend as a live preview of what the layer's others leave it, since
 * that blend is the application's to derive. The draft lives here, as
 * text, exactly as typed; slate-recipe-draft.js says what it changes.
 *
 * Keys: Enter moves on - resin to blend, blend to the next row's resin,
 * the last field to whatever the section names (Apply); a suggestion
 * chosen with Enter moves on the same way. Tab is the browser's. Escape
 * is the section's (it closes an open list first, in the search). A
 * blanked resin blanks the row's blend with it, visibly, so the diff
 * clears the hopper as the inline editor's blank does.
 *
 * A selection rides on the form for the fill: a row is picked by its
 * id (Shift for a run within the layer), a layer by its name, and the
 * section's fill strip writes one resin and/or one blend into every
 * picked row's fields - still the draft, still one Apply. Picking is
 * pointer work; the fields themselves stay the keyboard's.
 *
 * The form dispatches nothing and touches no cell text: the section
 * applies the draft and restores the cells when the form is destroyed.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(
    pick("PolynSlateRecipeDraft", "./slate-recipe-draft.js"),
    pick("PolynSlateResinSearch", "./slate-resin-search.js")
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipeForm = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (draftModule, searchModule) {
  "use strict";

  const EMPTY = "—";
  const H1_TITLE = "Calculated from hoppers 2–6 as you type";
  const CHANGED_UNDERNEATH = "changed in the application while you were editing; what you are entering here has not been applied.";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function formatPct(value) {
    if (value === null || !Number.isFinite(value)) return EMPTY;
    return `${Number.isInteger(value) ? value : Math.round(value * 10) / 10}%`;
  }

  /**
   * @param {Document} doc
   * @param {object} body        the section's body: { recipe, rows: Map(key -> entry), el }
   * @param {object} options
   * @param {object} options.base       slate-recipe-draft.js baseFrom(...)
   * @param {object} options.model      resolved.line (its layers, for the totals)
   * @param {function} options.resins   () => the catalog
   * @param {function} [options.sameResin]  slate-source.js's comparison
   * @param {function} [options.validate]   the application's validateHopperPercentages
   * @param {function} [options.onChange]   after any field moved
   * @param {function} [options.onLast]     Enter on the last field
   * @param {function} [options.onPick]     after the selection moved
   */
  function create(doc, body, options) {
    const settings = options || {};
    const resins = typeof settings.resins === "function" ? settings.resins : () => [];
    const onChange = typeof settings.onChange === "function" ? settings.onChange : () => {};
    const onLast = typeof settings.onLast === "function" ? settings.onLast : () => {};
    const onPick = typeof settings.onPick === "function" ? settings.onPick : () => {};
    const sameResin = typeof settings.sameResin === "function" ? settings.sameResin : null;
    const validate = typeof settings.validate === "function" ? settings.validate : null;
    const model = settings.model || null;
    let base = settings.base || {};
    const draft = draftModule.draftFrom(base);
    const fields = [];          // in tab order: { key, kind, input, entry }
    const byKey = new Map();    // key -> { entry, resin, pct, preview, search }
    const picked = new Set();   // the selection, by key
    let anchor = null;          // the last key picked alone, for a Shift run
    let destroyed = false;

    body.el.classList.add("is-drafting");

    function advanceFrom(input) {
      const at = fields.findIndex(field => field.input === input);
      if (at < 0) return;
      const next = fields[at + 1];
      if (!next) { onLast(); return; }
      if (typeof next.input.focus === "function") next.input.focus();
      if (typeof next.input.select === "function") next.input.select();
    }

    // H1's preview follows the layer's others - but only once H1 has a
    // resin: an empty hopper reads "—", as its cell does, not "100%".
    function paintH1() {
      for (const [key, slot] of byKey) {
        if (!slot.preview) continue;
        const derived = draftModule.derivedH1(base, draft, base[key].layer);
        const assigned = String(draft[key].resin || "").trim() !== "";
        slot.preview.textContent = assigned ? formatPct(derived.value) : EMPTY;
        slot.preview.classList.toggle("is-over", derived.over);
      }
    }

    function paintProblems() {
      const problems = new Map(draftModule.problemsFor(base, draft).map(problem => [problem.key, problem.message]));
      for (const [key, slot] of byKey) {
        const message = problems.get(key) || null;
        if (slot.pct) {
          if (message) slot.pct.setAttribute("aria-invalid", "true");
          else slot.pct.removeAttribute("aria-invalid");
        }
        if (slot.foreign) continue;
        slot.entry.note.textContent = message || "";
        show(slot.entry.note, !!message);
      }
    }

    function refresh() {
      if (destroyed) return;
      paintH1();
      paintProblems();
      onChange();
    }

    for (const [key, entry] of body.rows) {
      const start = draft[key];
      if (!start) continue;
      const slot = { entry, resin: null, pct: null, preview: null, search: null, foreign: false };
      const wrapper = element(doc, "div", "slate-combobox slate-hopper__draft");
      const resin = element(doc, "input", "slate-hopper__draft-resin", {
        type: "text", autocomplete: "off", spellcheck: "false", maxlength: String(searchModule.CODE_MAX),
        "aria-label": `Resin for ${entry.hopper}`, "data-slate-draft": "resin", placeholder: "No resin"
      });
      resin.value = start.resin;
      wrapper.appendChild(resin);
      show(entry.cells.resin, false);
      entry.row.insertBefore(wrapper, entry.cells.resin.nextSibling);
      slot.resin = resin;
      slot.search = searchModule.attach(doc, resin, {
        resins, host: wrapper, id: `slate-draft-${body.recipe}-${entry.layer}-${entry.index}`,
        onChoose: code => { draft[key].resin = code; if (code === "" && slot.pct) { slot.pct.value = ""; draft[key].pct = ""; } refresh(); advanceFrom(resin); }
      });
      fields.push({ key, kind: "resin", input: resin, entry });
      resin.addEventListener("input", () => {
        draft[key].resin = resin.value;
        if (String(resin.value).trim() === "" && slot.pct) { slot.pct.value = ""; draft[key].pct = ""; }
        refresh();
      });

      show(entry.cells.pct, false);
      if (entry.index === 0) {
        const preview = element(doc, "span", "slate-hopper__draft-h1", { title: H1_TITLE, "data-slate-draft": "h1" });
        entry.row.insertBefore(preview, entry.cells.pct.nextSibling);
        slot.preview = preview;
      } else {
        const pct = element(doc, "input", "slate-hopper__draft-pct", {
          type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": `Blend for ${entry.hopper}`, "data-slate-draft": "pct"
        });
        pct.value = start.pct;
        entry.row.insertBefore(pct, entry.cells.pct.nextSibling);
        slot.pct = pct;
        fields.push({ key, kind: "pct", input: pct, entry });
        pct.addEventListener("input", () => { draft[key].pct = pct.value; refresh(); });
      }
      byKey.set(key, slot);
      entry.row.classList.add("is-drafting");
    }

    // Enter moves on. Listened for on each row, below the search's own
    // handler on the field: an Enter the open list spent never gets here.
    const onKeydown = event => {
      if (!event || event.key !== "Enter" || destroyed) return;
      const target = event.target;
      if (!target || !target.hasAttribute || !target.hasAttribute("data-slate-draft")) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      advanceFrom(target);
    };
    for (const slot of byKey.values()) slot.entry.row.addEventListener("keydown", onKeydown);

    /* ---- The selection and the fill ---- */

    function paintPicked() {
      for (const [key, slot] of byKey) slot.entry.row.classList.toggle("is-picked", picked.has(key));
      onPick();
    }

    /** Toggle one row; with `range`, every row of its layer between the anchor and it. */
    function pick(key, options) {
      if (destroyed || !byKey.has(key)) return;
      const range = !!(options && options.range);
      if (range && anchor && base[anchor] && base[anchor].layer === base[key].layer) {
        const [from, to] = [base[anchor].index, base[key].index].sort((a, b) => a - b);
        for (const each of Object.keys(base)) {
          if (base[each].layer === base[key].layer && base[each].index >= from && base[each].index <= to) picked.add(each);
        }
      } else {
        if (picked.has(key)) picked.delete(key); else picked.add(key);
        anchor = key;
      }
      paintPicked();
    }

    /** Every row of a layer, or none of them when all are picked already. */
    function pickLayer(layerId) {
      if (destroyed) return;
      const keys = Object.keys(base).filter(key => base[key].layer === layerId && byKey.has(key));
      if (!keys.length) return;
      const all = keys.every(key => picked.has(key));
      for (const key of keys) { if (all) picked.delete(key); else picked.add(key); }
      anchor = null;
      paintPicked();
    }

    function clearPicked() {
      if (!picked.size) return;
      picked.clear();
      anchor = null;
      paintPicked();
    }

    /** The fill: `values` into every picked row's fields. Returns how many fields moved. */
    function fill(values) {
      if (destroyed) return 0;
      const keys = [...picked];
      const moved = draftModule.fillInto(base, draft, keys, values);
      if (!moved) return 0;
      for (const key of keys) {
        const slot = byKey.get(key);
        if (!slot) continue;
        slot.resin.value = draft[key].resin;
        if (slot.pct) slot.pct.value = draft[key].pct;
      }
      refresh();
      return moved;
    }

    function focusFirst() {
      const first = fields[0];
      if (!first) return;
      if (typeof first.input.focus === "function") first.input.focus();
      if (typeof first.input.select === "function") first.input.select();
    }

    /* A foreign publish moved a slot under the draft: the diff is now
     * against the new value, the field keeps what was typed, and the row
     * says so until the form goes. */
    function rebase(key, next) {
      const slot = byKey.get(key);
      if (!slot) return;
      base = draftModule.rebase(base, key, next);
      slot.foreign = true;
      slot.entry.row.classList.add("is-changed-underneath");
      slot.entry.note.textContent = `${slot.entry.hopper} ${CHANGED_UNDERNEATH}`;
      show(slot.entry.note, true);
      refresh();
    }

    /** The application's words on one row (a refusal naming a hopper). */
    function setNote(key, message) {
      const slot = byKey.get(key);
      if (!slot) return;
      slot.entry.note.textContent = message || "";
      show(slot.entry.note, !!message);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [, slot] of byKey) {
        slot.entry.row.removeEventListener("keydown", onKeydown);
        if (slot.search) slot.search.destroy();
        const wrapper = slot.resin.parentNode;
        if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        if (slot.pct && slot.pct.parentNode) slot.pct.parentNode.removeChild(slot.pct);
        if (slot.preview && slot.preview.parentNode) slot.preview.parentNode.removeChild(slot.preview);
        show(slot.entry.cells.resin, true);
        show(slot.entry.cells.pct, true);
        slot.entry.row.classList.remove("is-drafting", "is-changed-underneath", "is-picked");
        slot.entry.note.textContent = "";
        show(slot.entry.note, false);
      }
      byKey.clear();
      fields.length = 0;
      picked.clear();
      body.el.classList.remove("is-drafting");
    }

    paintH1();
    paintProblems();

    return Object.freeze({
      recipe: body.recipe,
      changes: () => draftModule.changesFor(base, draft, sameResin),
      problems: () => draftModule.problemsFor(base, draft),
      totals: () => draftModule.totalsFor(base, draft, model, validate),
      draft: () => JSON.parse(JSON.stringify(draft)),
      fields: () => fields.map(field => ({ key: field.key, kind: field.kind, input: field.input })),
      rebase,
      setNote,
      pick,
      pickLayer,
      clearPicked,
      picked: () => [...picked],
      fill,
      focusFirst,
      refresh,
      destroy,
      isDestroyed: () => destroyed
    });
  }

  return Object.freeze({ EMPTY, H1_TITLE, CHANGED_UNDERNEATH, formatPct, create });
});
