/* Resin Totals: the Tools row's second tool.
 *
 * WHAT IT IS
 *
 * The application's Resin Totals - how many pounds of each resin the job
 * consumed - drawn as a page for a Station window (station-window.js;
 * once the Operator Handbook's bench, and still built on the Handbook
 * section contract: create / update / focus). An end-of-job, end-of-shift
 * reading: production, scrap and their total across the top, then every
 * material's pounds in two columns underneath, with a scanned lot beside
 * a material when one was scanned.
 *
 * ONE CALCULATION
 *
 * Nothing is computed here. The section hands the resolved job - the
 * production and scrap pounds, the recipe's layers and hoppers, the scanned
 * lots, all as the state bridge carries them - to resin-totals.js
 * (PolynResinTotals), the module the application's own Resin Totals section
 * runs, and draws what comes back. Same function, same inputs, same rows in
 * the same order: the window cannot show a different total from the floor
 * UI because it has no arithmetic of its own to differ with.
 *
 * WHAT IT WRITES, AND HOW
 *
 * The application's Resin Totals section has two fields of its own - the
 * production and scrap pounds - and this page keeps them: the two figures
 * in the strip are edited in place (click, type, Enter; Escape cancels),
 * each issued as one command on the bridge this section is handed
 * (setProductionPounds / setScrapPounds), which the application runs
 * through those fields' own input handlers. That is the whole of what is
 * written from here. Resins and blends are edited in Blend Edit or the
 * layer editor; lots arrive from the existing scanning workflows; the
 * material rows and the total are read-only. This is the fifth Station
 * file that dispatches (station-isolation.test.js names it), and it
 * dispatches only on the bridge it was given.
 *
 * REDRAWING
 *
 * update() reads the current resolved state through the function the boot
 * file hands it and redraws from scratch - a few dozen nodes at most - and
 * answers with what it drew (the production, scrap and total pounds, the
 * rows), so the window's bar can say the total. The boot file calls it as
 * the window opens and whenever it learns of a change, so an accepted
 * recipe edit or a new production figure is on the page the next time it
 * is looked at, with no subscription of this section's own.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationResinTotals = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* Whole pounds, grouped for reading: the application's truncation
   * (wholePounds, never rounded up) with a thousands separator, which the
   * floor UI's single-line rows do not have room for and this page does. */
  function formatPounds(totals, value) {
    const whole = totals && typeof totals.wholePounds === "function" ? totals.wholePounds(value) : null;
    return whole === null ? "—" : whole.toLocaleString("en-US");
  }

  const COMMAND = Object.freeze({ production: "setProductionPounds", scrap: "setScrapPounds" });
  const LABEL = Object.freeze({ production: "Production", scrap: "Scrap" });

  /* Whether a command is on offer from the bridge this section was handed
   * - the same question the job controls ask, asked the same way. */
  function able(commands, field) {
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable()
      && typeof commands.capabilities === "function" && commands.capabilities().includes(COMMAND[field]));
  }

  function reason(commands, field) {
    if (!commands || typeof commands.isAvailable !== "function" || !commands.isAvailable()) return "no application is connected to Station commands.";
    if (!able(commands, field)) return `the application does not support ${COMMAND[field]}.`;
    return "";
  }

  /* The three readings across the top: a label over a number and its unit.
   * Production and scrap are fields: the reading is a button that opens an
   * input in its place; the total is a figure and nothing else. */
  function stat(doc, id, label, editable) {
    const box = element(doc, "div", "station-totals__stat", { "data-stat": id });
    box.appendChild(text(doc, "span", "station-totals__stat-label", label));
    const reading = element(doc, editable ? "button" : "span", `station-totals__stat-reading${editable ? " is-field" : ""}`,
      editable ? { type: "button", "data-field": id, "aria-expanded": "false" } : null);
    const value = text(doc, "strong", "station-totals__stat-value", "0", { "data-value": id });
    reading.appendChild(value);
    reading.appendChild(text(doc, "span", "station-totals__stat-unit", "lb"));
    box.appendChild(reading);
    let editor = null, input = null;
    if (editable) {
      editor = element(doc, "span", "station-totals__editor", { hidden: "" });
      input = element(doc, "input", "station-totals__input", {
        type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false",
        "aria-label": `${label} resin, pounds`
      });
      editor.appendChild(input);
      editor.appendChild(text(doc, "span", "station-totals__stat-unit", "lb"));
      box.appendChild(editor);
    }
    return { box, reading, value, editor, input };
  }

  /* A material: its code, its pounds, its lot on a second line - the lot
   * spelled out when there is one, and a quiet "Lot —" when there is not,
   * so the common case (nothing scanned) does not shout it once per row. */
  function materialRow(doc, row, totals) {
    const item = element(doc, "div", "station-totals__row", { "data-resin": row.key, role: "listitem" });
    item.appendChild(text(doc, "span", "station-totals__code", row.displayName, { title: row.displayName }));
    const pounds = element(doc, "span", "station-totals__pounds");
    pounds.appendChild(text(doc, "strong", "station-totals__pounds-value", formatPounds(totals, row.lbs)));
    pounds.appendChild(text(doc, "span", "station-totals__pounds-unit", "lb"));
    item.appendChild(pounds);
    const lot = element(doc, "span", `station-totals__lot${row.lot ? " has-lot" : ""}`, { "data-lot": row.lot || "" });
    if (row.lot) {
      lot.appendChild(text(doc, "span", "station-totals__lot-label", "Lot"));
      lot.appendChild(text(doc, "span", "station-totals__lot-value", row.lot, { title: row.lot }));
    } else {
      lot.appendChild(text(doc, "span", "station-totals__lot-label", "Lot"));
      lot.appendChild(text(doc, "span", "station-totals__lot-value", "—", { "aria-label": "no scanned lot" }));
    }
    item.appendChild(lot);
    return item;
  }

  /**
   * @param {Document} doc
   * @param {object} context
   * @param {function} context.resolved   () => the boot file's current resolved
   *        source (station-source.js): { live, job: { prodResinLb,
   *        scrapResinLb, lots }, recipe: { layers } }
   * @param {object} context.resinTotals  the shared resin-totals.js module
   * @param {function} [context.commands]  () => the command bridge for what is
   *        on screen, or null when nothing may be written (demo, no producer)
   * @param {function} [context.onCommitted]  (result) => void, told of every
   *        command that changed something; the boot file re-runs its publish
   *        policy from it
   */
  function create(doc, context) {
    const settings = context || {};
    const totals = settings.resinTotals && typeof settings.resinTotals.compute === "function" ? settings.resinTotals : null;
    const resolved = typeof settings.resolved === "function" ? settings.resolved : () => null;
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};

    const rootEl = element(doc, "div", "station-totals", { "data-role": "resin-totals" });
    let editing = null;   // "production" | "scrap" | null
    let last = { prod: 0, scrap: 0 };

    /* ---- The strip ---- */
    const strip = element(doc, "div", "station-totals__strip", { role: "group", "aria-label": "Resin totals" });
    const production = stat(doc, "production", "Production", true);
    const scrap = stat(doc, "scrap", "Scrap", true);
    const total = stat(doc, "total", "Total", false);
    const fields = { production, scrap };
    strip.appendChild(production.box);
    strip.appendChild(scrap.box);
    strip.appendChild(total.box);
    rootEl.appendChild(strip);
    const note = element(doc, "p", "station-totals__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    function say(message, kind) {
      note.textContent = message || "";
      note.setAttribute("data-kind", kind || "");
      if (message) note.removeAttribute("hidden");
      else note.setAttribute("hidden", "");
    }

    /* ---- Editing production and scrap ---- */

    function refreshOffer() {
      const commands = commandsFor();
      for (const field of Object.keys(fields)) {
        const can = able(commands, field);
        fields[field].box.classList.toggle("is-readonly", !can);
        fields[field].reading.setAttribute("aria-disabled", String(!can));
        fields[field].reading.setAttribute("title", can
          ? `Edit ${LABEL[field].toLowerCase()} pounds`
          : `${LABEL[field]} is read-only here: ${reason(commands, field)}`);
      }
    }

    function open(field) {
      const commands = commandsFor();
      if (!able(commands, field)) {
        say(`${LABEL[field]} cannot be changed here: ${reason(commands, field)}`, "error");
        return;
      }
      close();
      editing = field;
      const f = fields[field];
      const current = field === "production" ? last.prod : last.scrap;
      f.input.value = current > 0 ? String(current) : "";
      f.input.removeAttribute("aria-invalid");
      f.box.classList.add("is-editing");
      f.reading.setAttribute("aria-expanded", "true");
      f.reading.setAttribute("hidden", "");
      f.editor.removeAttribute("hidden");
      say("");
      if (typeof f.input.focus === "function") f.input.focus();
      if (typeof f.input.select === "function") f.input.select();
    }

    function close() {
      const field = editing;
      if (!field) return;
      editing = null;
      const f = fields[field];
      f.box.classList.remove("is-editing");
      f.reading.setAttribute("aria-expanded", "false");
      f.reading.removeAttribute("hidden");
      f.editor.setAttribute("hidden", "");
    }

    /* One request to the application: the field's text as the command is
     * asked for it - empty clears, as the floor UI's own field reads an
     * emptied value - and the boot file told of a change. */
    function send(field, raw) {
      const value = String(raw == null ? "" : raw).trim();
      const commands = commandsFor();
      const result = commands && typeof commands.dispatch === "function"
        ? commands.dispatch(COMMAND[field], { pounds: value === "" ? 0 : value })
        : { ok: false, code: "unavailable", message: "No application is connected to Station commands." };
      if (result && result.ok && result.changed) onCommitted(result);
      return result;
    }

    function commit(field) {
      if (editing !== field) return null;
      const f = fields[field];
      const result = send(field, f.input.value);
      if (!result || !result.ok) {
        f.input.setAttribute("aria-invalid", "true");
        say(result && result.message ? result.message : "The change could not be applied.", "error");
        return result;
      }
      f.input.removeAttribute("aria-invalid");
      close();
      say("");
      update();
      if (typeof f.reading.focus === "function") f.reading.focus();
      return result;
    }

    function cancel(field) {
      if (editing !== field) return;
      const f = fields[field];
      close();
      say("");
      if (typeof f.reading.focus === "function") f.reading.focus();
    }

    for (const field of Object.keys(fields)) {
      const f = fields[field];
      f.reading.addEventListener("click", () => { open(field); });
      f.input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          commit(field);
        } else if (event.key === "Escape") {
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          if (typeof event.preventDefault === "function") event.preventDefault();
          cancel(field);
        }
      });
      /* Leaving the field commits it, as the header's output field does; a
       * refused value keeps the editor open and marked, so what was typed
       * is not lost, and says why. */
      f.input.addEventListener("blur", () => {
        if (editing !== field) return;
        commit(field);
      });
    }

    /* ---- By material ---- */
    const materials = element(doc, "div", "station-totals__materials");
    const head = element(doc, "div", "station-totals__materials-head");
    head.appendChild(text(doc, "h3", "station-totals__materials-title", "By material"));
    head.appendChild(text(doc, "span", "station-totals__materials-note", "Calculated from the current recipe percentages."));
    materials.appendChild(head);
    const list = element(doc, "div", "station-totals__list", { role: "list", "aria-label": "Pounds by material", tabindex: "0" });
    materials.appendChild(list);
    const empty = element(doc, "p", "station-totals__empty", { hidden: "" });
    materials.appendChild(empty);
    rootEl.appendChild(materials);

    /* The material list's empty state: one sentence in the list's place. */
    function emptyState(message) {
      empty.textContent = message;
      empty.removeAttribute("hidden");
      list.setAttribute("hidden", "");
    }

    function update() {
      const current = resolved() || null;
      const job = current && current.job ? current.job : {};
      const recipe = current && current.recipe ? current.recipe : { layers: [] };
      const result = totals
        ? totals.compute({ prodResinLb: job.prodResinLb, scrapResinLb: job.scrapResinLb, layers: recipe.layers, lots: job.lots })
        : { prod: 0, scrap: 0, total: 0, rows: [] };

      last = { prod: result.prod, scrap: result.scrap };
      production.value.textContent = formatPounds(totals, result.prod);
      scrap.value.textContent = formatPounds(totals, result.scrap);
      total.value.textContent = formatPounds(totals, result.total);
      strip.setAttribute("data-empty", result.total > 0 ? "false" : "true");
      refreshOffer();

      clear(list);
      rootEl.setAttribute("data-count", String(result.rows.length));
      if (!totals) { emptyState("Resin Totals is unavailable: the shared calculation did not load."); return result; }
      if (!current || !current.live) {
        emptyState(current && current.kind === "demo"
          ? "Demo data: no job is running, so there is nothing to total."
          : "No application is connected; there is nothing to total.");
        return result;
      }
      if (result.total <= 0) { emptyState("Enter production or scrap pounds in the application to see totals here."); return result; }
      if (!result.rows.length) { emptyState("Add resin names and recipe percentages to see totals here."); return result; }
      empty.setAttribute("hidden", "");
      list.removeAttribute("hidden");
      result.rows.forEach((row, index) => {
        const item = materialRow(doc, row, totals);
        // Two columns, filled across: even rows left, odd rows right; the
        // first two share the first line. Said on the row for the sheet.
        item.setAttribute("data-column", index % 2 === 0 ? "left" : "right");
        if (index < 2) item.setAttribute("class", `${item.getAttribute("class")} is-first-line`);
        list.appendChild(item);
      });
      return result;
    }

    update();
    return {
      element: rootEl,
      update,
      /* The first thing to do on this page is usually to enter the pounds. */
      focus() { if (typeof production.reading.focus === "function") production.reading.focus(); },
      /* The sheet runs one line per hopper and scrolls past three layers:
       * a bench holding it may be raised for it. */
      grows: () => true,
      isEditing: () => editing
    };
  }

  return Object.freeze({
    formatPounds,
    section: Object.freeze({ id: "resin-totals", title: "Resin Totals", create })
  });
});
