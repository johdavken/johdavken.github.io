/* Resin Balance: the first tool, in the Timeline's place.
 *
 * How many pounds of each resin the job has consumed - the production and
 * scrap pounds from the job's cards, split across the running recipe by
 * each layer's share and each hopper's blend, gathered by resin. The
 * arithmetic is the application's own (resin-totals.js, PolynResinTotals:
 * the function the floor UI's Resin Totals runs), handed in by the boot
 * so this panel cannot total differently. Nothing is computed here.
 *
 * With a mouse the panel leaves out the production and scrap figures
 * themselves (they are the stat cards above the recipe, entered and read
 * there). Under a finger - a tablet or a phone, where the strip keeps
 * only the changeover and the output - they are entered here, in place,
 * through the cards' own entry. Scanned lots are left out everywhere (no
 * room in the aside; the floor UI keeps them). The panel dispatches
 * nothing and reads nothing but the resolved state it is handed.
 *
 * The head's close hands the aside back to the Timeline (ctx.back).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateResinBalance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE = "Resin Balance";
  const CLOSE_LABEL = "Back to the Timeline";
  const UNAVAILABLE = "Resin Balance is unavailable: the shared calculation did not load.";
  const NO_LINE = "No line to balance.";
  const NO_POUNDS = "Enter production or scrap pounds in the job cards above to see the balance.";
  const NO_POUNDS_TOUCH = "Enter production or scrap pounds above to see the balance.";
  const JOB_FIELDS = Object.freeze([["production", "Production"], ["scrap", "Scrap"]]);
  const NO_RESINS = "Assign resins and blends in the recipe to see the balance.";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /* Whole pounds, truncated as the application shows them, grouped for
   * reading; a dash for anything that is not a number. */
  function formatPounds(totals, value) {
    const whole = totals && typeof totals.wholePounds === "function" ? totals.wholePounds(value) : null;
    return whole === null ? "—" : `${whole.toLocaleString("en-US")} lb`;
  }

  /* A resin's share of the total, to one place; whole when it is. */
  function formatShare(lbs, total) {
    if (!(total > 0) || !Number.isFinite(lbs)) return "";
    const pct = (lbs / total) * 100;
    const rounded = Math.round(pct * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
  }

  /**
   * The calculation's input from the resolved state: the job's pounds and
   * the RUNNING recipe as [{layerPct, hoppers: [{pct, resinName}]}] in line
   * order, read from Slate's own model (never the raw snapshot). Null
   * without a line.
   */
  function inputsFor(resolved) {
    if (!resolved || !resolved.line || !Array.isArray(resolved.line.layers)) return null;
    const hoppers = resolved.hopperState || {};
    const layerState = resolved.layerState || {};
    const job = resolved.job || {};
    const layers = resolved.line.layers.map(layer => ({
      layerPct: layerState[layer.id] ? layerState[layer.id].layerPct : 0,
      hoppers: layer.hoppers.map(hopper => {
        const state = hoppers[`${layer.id}:${hopper.index}`] || {};
        return { pct: state.pct, resinName: state.resinName || "" };
      })
    }));
    return { prodResinLb: job.prodResinLb, scrapResinLb: job.scrapResinLb, layers };
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.totals   PolynResinTotals, or null when it did not load
   * @param {function} [ctx.back]      hands the aside back to the Timeline
   * @param {object} [ctx.job]          the job's production and scrap, under touch:
   *        { value(field) -> the card's words, draft(field) -> the text a field opens
   *        with, enter(field, raw) -> the job cards' answer }
   * @param {function} [ctx.tier]       the tier (slate/slate-tier.js), for the words
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const totals = settings.totals || null;
    const back = typeof settings.back === "function" ? settings.back : () => {};

    const rootEl = element(doc, "section", "slate-panel slate-balance", { "aria-label": TITLE, "data-count": "0" });
    const head = element(doc, "div", "slate-panel__head");
    head.appendChild(text(doc, "h2", "slate-panel__title", TITLE));
    const close = element(doc, "button", "slate-panel__close", { type: "button", "aria-label": CLOSE_LABEL, title: CLOSE_LABEL, "data-slate-back": "" });
    close.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    head.appendChild(close);
    rootEl.appendChild(head);
    rootEl.appendChild(text(doc, "p", "slate-balance__caption", "The job's production and scrap, split across the running recipe."));

    /* Under a finger (tablet and phone) the job's strip keeps the
     * changeover and the output, and production and scrap are entered here
     * (resin-balance.css shows the pair under touch only): each a row that
     * shows the card's words and, tapped, becomes a field with Save and
     * Cancel. What is typed goes to the job cards' own entry (ctx.job.enter)
     * - read and sent as the card's editor sends it; this panel dispatches
     * nothing. One field open at a time; a publish never takes the typing. */
    const job = settings.job && typeof settings.job.enter === "function" ? settings.job : null;
    const jobEl = element(doc, "div", "slate-balance__job");
    const entries = {};
    let editingField = null;
    for (const [field, label] of job ? JOB_FIELDS : []) {
      const box = element(doc, "div", "slate-balance__entry-box", { "data-balance-field": field });
      const button = element(doc, "button", "slate-balance__entry", { type: "button", "aria-label": `${label}: change` });
      button.appendChild(text(doc, "span", "slate-balance__entry-label", label));
      const value = text(doc, "span", "slate-balance__entry-value", "—");
      button.appendChild(value);
      box.appendChild(button);
      const editor = element(doc, "div", "slate-balance__editor", { hidden: "" });
      editor.appendChild(text(doc, "span", "slate-balance__entry-label", label));
      const input = element(doc, "input", "slate-balance__input", { type: "text", inputmode: "decimal", autocomplete: "off", enterkeyhint: "done", "aria-label": `${label} pounds` });
      editor.appendChild(input);
      editor.appendChild(text(doc, "span", "slate-balance__unit", "lb"));
      const actions = element(doc, "div", "slate-balance__editor-actions");
      const cancel = text(doc, "button", "slate-balance__action", "Cancel", { type: "button", "data-balance-do": "cancel" });
      const save = text(doc, "button", "slate-balance__action slate-balance__action--save", "Save", { type: "button", "data-balance-do": "save" });
      actions.appendChild(cancel);
      actions.appendChild(save);
      editor.appendChild(actions);
      const note = element(doc, "p", "slate-balance__note", { role: "status", hidden: "" });
      editor.appendChild(note);
      box.appendChild(editor);
      jobEl.appendChild(box);
      entries[field] = { box, button, value, editor, input, note };
      button.addEventListener("click", () => openEntry(field));
      cancel.addEventListener("click", () => closeEntry());
      save.addEventListener("click", () => saveEntry());
      input.addEventListener("keydown", event => {
        if (!event) return;
        if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); saveEntry(); }
        else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeEntry(); }
      });
    }
    rootEl.appendChild(jobEl);

    function openEntry(field) {
      if (editingField === field) return;
      closeEntry();
      const entry = entries[field];
      if (!entry) return;
      editingField = field;
      entry.input.value = typeof job.draft === "function" ? job.draft(field) : "";
      show(entry.note, false);
      show(entry.button, false);
      show(entry.editor, true);
      if (typeof entry.input.focus === "function") entry.input.focus();
    }

    function closeEntry() {
      const entry = editingField ? entries[editingField] : null;
      editingField = null;
      if (!entry) return;
      show(entry.editor, false);
      show(entry.note, false);
      show(entry.button, true);
    }

    function saveEntry() {
      const field = editingField;
      if (!field) return null;
      const entry = entries[field];
      const result = job.enter(field, entry.input.value);
      if (result && result.ok) { closeEntry(); return result; }
      entry.note.textContent = (result && result.message) || "The application refused the change.";
      show(entry.note, true);
      return result;
    }

    const touch = () => {
      try { const t = typeof settings.tier === "function" ? settings.tier() : null; return !!t && t.input === "touch"; } catch (error) { return false; }
    };

    const list = element(doc, "div", "slate-balance__list", { role: "list" });
    rootEl.appendChild(list);
    const empty = element(doc, "p", "slate-balance__empty", { hidden: "" });
    rootEl.appendChild(empty);

    const foot = element(doc, "div", "slate-balance__foot", { hidden: "" });
    foot.appendChild(text(doc, "span", "slate-balance__foot-label", "Total"));
    const footValue = text(doc, "span", "slate-balance__foot-value", "");
    foot.appendChild(footValue);
    rootEl.appendChild(foot);

    let last = [];

    function emptyState(message) {
      empty.textContent = message;
      show(empty, true);
      show(list, false);
      show(foot, false);
    }

    function row(entry, total) {
      const item = element(doc, "div", "slate-balance__row", { role: "listitem", "data-resin": entry.key });
      item.appendChild(text(doc, "span", "slate-balance__name", entry.displayName));
      item.appendChild(text(doc, "span", "slate-balance__lbs", formatPounds(totals, entry.lbs)));
      item.appendChild(text(doc, "span", "slate-balance__share", formatShare(entry.lbs, total)));
      const bar = element(doc, "span", "slate-balance__bar", { "aria-hidden": "true" });
      const fill = element(doc, "span", "slate-balance__fill");
      fill.style.width = total > 0 ? `${Math.max(0, Math.min(100, (entry.lbs / total) * 100))}%` : "0%";
      bar.appendChild(fill);
      item.appendChild(bar);
      return item;
    }

    function update(resolved) {
      if (job) for (const [field] of JOB_FIELDS) entries[field].value.textContent = job.value(field);
      const inputs = inputsFor(resolved);
      const result = totals && inputs ? totals.compute(inputs) : { prod: 0, scrap: 0, total: 0, rows: [] };
      last = result.rows;
      rootEl.setAttribute("data-count", String(result.rows.length));
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!totals) { emptyState(UNAVAILABLE); return result; }
      if (!inputs) { emptyState(NO_LINE); return result; }
      if (!(result.total > 0)) { emptyState(touch() ? NO_POUNDS_TOUCH : NO_POUNDS); return result; }
      if (!result.rows.length) { emptyState(NO_RESINS); return result; }
      show(empty, false);
      show(list, true);
      for (const entry of result.rows) list.appendChild(row(entry, result.total));
      footValue.textContent = formatPounds(totals, result.total);
      show(foot, true);
      return result;
    }

    close.addEventListener("click", () => { closeEntry(); back(); });

    return Object.freeze({
      element: rootEl,
      update,
      rows: () => last.slice()
    });
  }

  return Object.freeze({
    TITLE, CLOSE_LABEL, UNAVAILABLE, NO_LINE, NO_POUNDS, NO_POUNDS_TOUCH, NO_RESINS,
    formatPounds, formatShare, inputsFor, create
  });
});
