/* Resin Database: the catalog every recipe's resin is looked up in.
 *
 * WHAT IT IS
 *
 * Every record the plant keeps - active and inactive - and for each its
 * code, its density and its bulk density. The same records the floor
 * UI's own Resin Database panel edits, over the same admin session: a
 * searchable list of codes on the left, the chosen record on the right.
 *
 * WHAT A RESIN IS MADE OF
 *
 * A code, which is the record's name and the thing a recipe carries, and
 * two densities, each a number or unknown - blank is unknown, never zero.
 * Whether it is active decides whether the recipe's search offers it; an
 * inactive record is kept, with its densities, for the recipes that still
 * name it. Active or inactive is a maintenance act here, under the fold
 * beside Delete, not a field of the form: turning a record off is asked
 * and confirmed on its own, never carried along with an edit.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything through slate-admin-actions.js: the list is one request, a
 * save is one carrying the record, a delete is one, and the list is read
 * again after each. The application answers with its own admin
 * procedures, which validate the record and, on success, refresh the
 * shared resin catalog - which is how a change reaches Recipe Setup, the
 * Resin Lookup and Slate's own resin search without this section
 * touching the catalog at all. Slate never reads or writes
 * PolynResinCatalog: that is the application's to keep.
 *
 * The value rules - the density ranges, a code the catalog already holds
 * - live in that service and in the database. What is checked before
 * asking is only what this section can know on its own: that a code was
 * typed, and that it is not another loaded record's code. A refusal from
 * the service is shown in its own words, against the field it names,
 * with the draft kept.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(pick("PolynSlateAdminActions", "./slate-admin-actions.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateResinDb = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (actionsModule) {
  "use strict";

  const TITLE = "Resin Database";
  const LEAD = "The shared resin catalog: codes, densities and what is still offered.";
  const SIGNED_OUT = "No administrator is signed in. Sign in under Administrator access in Settings.";
  const NO_BRIDGE = "No application is connected to Slate's administrator tools.";
  const ADD_HINT = "A catalog record: its code and densities. Active resins are offered wherever a resin is chosen.";
  const REACH = "A saved change refreshes this device's active catalog now; other devices read it when they next load the catalog.";
  const CODE_NEEDED = "Resin code is required.";
  const CODE_TAKEN = "That resin code already exists.";

  const ACTION = "slate-book__action";
  const PRIMARY = `${ACTION} slate-book__action--primary`;
  const QUIET = `${ACTION} slate-book__action--quiet`;
  const DANGER = `${ACTION} slate-book__action--danger`;

  /** The two densities, with the unit each is read in. */
  const DENSITY_FIELDS = Object.freeze([
    Object.freeze({ field: "densityGCm3", label: "Density", unit: "g/cm³", ariaLabel: "Density in g/cm³" }),
    Object.freeze({ field: "bulkDensityLbFt3", label: "Bulk density", unit: "lb/ft³", ariaLabel: "Bulk density in lb/ft³" })
  ]);

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

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function formatDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    } catch (error) {
      return date.toISOString().slice(0, 10);
    }
  }

  function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  /* A density as the list reads it: the number as given, with its unit. */
  function densityText(value, unit) {
    return isNumber(value) ? `${value} ${unit}` : "";
  }

  /** One line under a resin's code in the list. */
  function rowMeta(resin) {
    const parts = DENSITY_FIELDS.map(entry => densityText(resin[entry.field], entry.unit)).filter(Boolean);
    if (!parts.length) parts.push("No densities recorded");
    if (!resin.isActive) parts.push("Inactive");
    return parts.join(" · ");
  }

  /** The chosen record's summary: when it last changed. */
  function detailMeta(resin) {
    const updated = formatDate(resin.updatedAt);
    return updated ? `Updated ${updated}` : "A catalog record";
  }

  /* A working copy of a record: the densities as text, blank for unknown,
   * so the field reads what was stored and nothing is rounded under the
   * operator. */
  function draftOf(resin) {
    return {
      id: resin ? resin.id : "",
      resinCode: resin ? resin.resinCode : "",
      densityGCm3: resin && isNumber(resin.densityGCm3) ? String(resin.densityGCm3) : "",
      bulkDensityLbFt3: resin && isNumber(resin.bulkDensityLbFt3) ? String(resin.bulkDensityLbFt3) : "",
      isActive: resin ? resin.isActive !== false : true
    };
  }

  /* A typed density: blank is null (unknown); anything else is its number,
   * which may be NaN - sent as it is, so the application refuses it by
   * name and the field is marked, rather than quietly becoming unknown. */
  function parseNumberField(value) {
    const trimmed = String(value === null || value === undefined ? "" : value).trim();
    return trimmed === "" ? null : Number(trimmed);
  }

  /** The draft as a record, the shape the bridge takes. */
  function valuesOf(draft) {
    return {
      id: draft.id || null,
      resinCode: String(draft.resinCode || "").trim(),
      densityGCm3: parseNumberField(draft.densityGCm3),
      bulkDensityLbFt3: parseNumberField(draft.bulkDensityLbFt3),
      isActive: draft.isActive !== false
    };
  }

  /* Two drafts as typed: the text of each field, trimmed, and the flag.
   * Compared as text, not as values, so a field holding something that is
   * not a number still reads as a change the operator made. */
  function sameDraft(a, b) {
    if (!a || !b) return a === b;
    for (const field of ["resinCode", "densityGCm3", "bulkDensityLbFt3"]) {
      if (String(a[field] || "").trim() !== String(b[field] || "").trim()) return false;
    }
    return (a.isActive !== false) === (b.isActive !== false);
  }

  /* Whether a code is another loaded record's - without regard to case, as
   * the catalog compares them; the record being edited is not its own
   * duplicate. The floor UI makes the same check before it asks. */
  function duplicateCode(resins, code, id) {
    const wanted = String(code || "").trim().toLocaleLowerCase();
    if (!wanted) return false;
    return (resins || []).some(resin => resin.id !== id
      && String(resin.resinCode || "").trim().toLocaleLowerCase() === wanted);
  }

  /** In code order, whatever order they were answered in. */
  function sortResins(resins) {
    return (resins || []).slice().sort((a, b) =>
      String(a.resinCode || "").localeCompare(String(b.resinCode || ""), undefined, { sensitivity: "base" }));
  }

  /* The rows a search shows: those whose code contains the text, without
   * regard to case; no text shows them all. Codes only, as the floor UI
   * searches. */
  function filterResins(resins, query) {
    const wanted = String(query || "").trim().toLocaleLowerCase();
    if (!wanted) return (resins || []).slice();
    return (resins || []).filter(resin => String(resin.resinCode || "").toLocaleLowerCase().includes(wanted));
  }

  /* --------------------------------------------------------------------
   *   The words a confirmation says - the floor UI's own, unchanged
   * ------------------------------------------------------------------ */

  function deactivateLines(resin) {
    return [`Deactivate ${resin.resinCode}? It leaves the active catalog: Recipe Setup and Station's recipe cards stop offering it. The record and its densities are kept, and recipes that name it still do.`];
  }

  function reactivateLines(resin) {
    return [`Reactivate ${resin.resinCode}? It returns to the active catalog and is offered again.`];
  }

  function deleteLines(resin) {
    return [`Permanently delete ${resin.resinCode}? Use Inactive instead if this catalog record may be needed again. This cannot be undone.`];
  }

  function discardLines(resin) {
    return [`Discard the unsaved changes to ${resin.resinCode || "this resin"}? The record stays as it was last saved.`];
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.admin  the admin bridge, handed in
   * @param {function} [ctx.say]     a line for the operator
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const admin = settings.admin || null;
    const say = typeof settings.say === "function" ? settings.say : () => {};

    const state = {
      resins: [],
      query: "",
      focusId: null,     // a record's id, or "new" for one being added
      draft: null,
      loaded: false,
      loading: false,
      pending: null,
      view: null,        // null (the record) | { kind: "confirm", … }
      maintenanceOpen: false,
      note: "",
      noteKind: "",
      shown: false
    };

    const able = () => actionsModule.can(admin);
    const why = control => actionsModule.reason(admin, control);
    const open = () => actionsModule.signedIn(admin);
    const busy = () => !!state.pending || state.loading;
    const adding = () => state.focusId === "new";
    const chosen = () => (adding() ? null : state.resins.find(resin => resin.id === state.focusId) || null);
    const rows = () => filterResins(state.resins, state.query);

    function dirty() {
      if (!state.draft) return false;
      if (adding()) return true;
      const resin = chosen();
      return !!resin && !sameDraft(state.draft, draftOf(resin));
    }

    const rootEl = element(doc, "div", "slate-admin", { "data-admin": "resins" });

    /* ---- The bar ---- */

    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", LEAD);
    bar.appendChild(subtitle);
    const addButton = text(doc, "button", ACTION, "Add Resin", { type: "button", "data-action": "add-resin" });
    const refreshButton = text(doc, "button", ACTION, "Refresh", { type: "button", "data-action": "refresh" });
    bar.appendChild(addButton);
    bar.appendChild(refreshButton);
    rootEl.appendChild(bar);

    const note = element(doc, "p", "slate-book__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    const gate = text(doc, "p", "slate-admin__gate", SIGNED_OUT, { role: "status" });
    rootEl.appendChild(gate);

    const columns = element(doc, "div", "slate-book__columns", { hidden: "" });
    const listPane = element(doc, "div", "slate-resins__list-pane");
    // The search stands outside the list, so a redraw of the rows never
    // takes the caret with it.
    const search = element(doc, "input", "slate-resins__search", {
      type: "search", "data-role": "search", "aria-label": "Search resin codes",
      placeholder: "Search resin code", autocomplete: "off", spellcheck: "false"
    });
    const count = text(doc, "p", "slate-resins__count", "", { "aria-live": "polite" });
    const list = element(doc, "ol", "slate-book__list", { "aria-label": "Resins" });
    listPane.appendChild(search);
    listPane.appendChild(count);
    listPane.appendChild(list);
    const detailPane = element(doc, "div", "slate-book__detail", { "aria-live": "polite" });
    columns.appendChild(listPane);
    columns.appendChild(detailPane);
    rootEl.appendChild(columns);

    /* ---- Saying ---- */

    function setNote(message, kind) {
      state.note = message || "";
      state.noteKind = state.note ? (kind || "") : "";
      note.textContent = state.note;
      note.classList.toggle("is-ok", state.noteKind === "ok");
      note.classList.toggle("is-error", state.noteKind === "error");
      show(note, !!state.note);
    }

    function withhold(button, control, extra) {
      const can = !!able()[control] && !(extra && extra.unable);
      button.setAttribute("data-able", can ? "true" : "false");
      const reason = extra && extra.reason ? extra.reason : why(control);
      button.setAttribute("title", can ? (extra && extra.title) || "" : `Unavailable: ${reason}`);
      if (busy()) button.setAttribute("disabled", "");
      else button.removeAttribute("disabled");
    }

    /* ---- Drawing ---- */

    function drawBar() {
      const signedIn = open();
      if (signedIn && state.loaded) {
        const active = state.resins.filter(resin => resin.isActive).length;
        subtitle.textContent = `${active} active · ${state.resins.length - active} inactive`;
      } else {
        subtitle.textContent = LEAD;
      }
      show(addButton, signedIn);
      show(refreshButton, signedIn);
      withhold(addButton, "saveResin", { title: ADD_HINT });
      withhold(refreshButton, "listResins", { title: "Read the catalog again" });
      refreshButton.classList.toggle("is-busy", state.loading);
    }

    function drawList() {
      clearChildren(list);
      const shown = rows();
      count.textContent = !state.loaded ? ""
        : (state.query.trim() ? `${shown.length} of ${state.resins.length}` : `${state.resins.length} records`);
      if (busy()) search.setAttribute("disabled", "");
      else search.removeAttribute("disabled");
      if (!shown.length && !adding()) {
        list.appendChild(text(doc, "li", "slate-book__empty", state.loading
          ? "Reading the resin database…"
          : (state.loaded ? (state.resins.length ? "No matching resin records." : "No resin records.") : "")));
        return;
      }
      for (const resin of shown) {
        const item = element(doc, "li");
        const row = element(doc, "button", "slate-book__row", {
          type: "button", "data-resin": resin.id,
          "aria-pressed": resin.id === state.focusId ? "true" : "false",
          title: resin.isActive ? resin.resinCode : `${resin.resinCode} — inactive`
        });
        if (!resin.isActive) row.classList.add("is-inactive");
        row.appendChild(text(doc, "span", "slate-book__star", "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "slate-book__row-name", resin.resinCode));
        row.appendChild(text(doc, "span", "slate-book__row-meta", rowMeta(resin)));
        item.appendChild(row);
        list.appendChild(item);
      }
      if (adding()) {
        const item = element(doc, "li");
        const row = element(doc, "button", "slate-book__row is-new", { type: "button", "data-resin": "new", "aria-pressed": "true" });
        row.appendChild(text(doc, "span", "slate-book__star", "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "slate-book__row-name",
          state.draft && state.draft.resinCode.trim() ? state.draft.resinCode.trim() : "New resin"));
        row.appendChild(text(doc, "span", "slate-book__row-meta", "Not saved yet"));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawConfirm(view) {
      const confirm = element(doc, "div", "slate-book__confirm", {
        "data-confirm": view.action, "data-kind": view.danger ? "delete" : "load"
      });
      confirm.appendChild(text(doc, "h3", "slate-admin__confirm-title", view.title));
      for (const line of view.lines) confirm.appendChild(text(doc, "p", "slate-admin__confirm-line", line));
      const actions = element(doc, "div", "slate-book__confirm-actions");
      const go = text(doc, "button", view.danger ? DANGER : PRIMARY, view.label, { type: "button", "data-action": "confirm-view" });
      if (busy()) go.setAttribute("disabled", "");
      actions.appendChild(go);
      actions.appendChild(text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-view" }));
      confirm.appendChild(actions);
      return confirm;
    }

    function fieldRow(label, control) {
      const row = element(doc, "div", "slate-lines__field");
      row.appendChild(text(doc, "span", "slate-lines__label", label));
      const value = element(doc, "span", "slate-lines__value");
      value.appendChild(control);
      row.appendChild(value);
      return row;
    }

    function textField(field, value, attributes) {
      const input = element(doc, "input", "slate-lines__input", Object.assign({
        type: "text", autocomplete: "off", spellcheck: "false", "data-field": field
      }, attributes || {}));
      input.value = value === null || value === undefined ? "" : String(value);
      if (busy()) input.setAttribute("disabled", "");
      return input;
    }

    function drawMaintenance(resin) {
      const section = element(doc, "section", "slate-admin__maintenance", { "aria-label": "Resin maintenance" });
      const toggle = element(doc, "button", "slate-admin__fold", {
        type: "button", "data-action": "toggle-maintenance", "aria-expanded": state.maintenanceOpen ? "true" : "false"
      });
      toggle.appendChild(text(doc, "span", "slate-admin__fold-mark", state.maintenanceOpen ? "▾" : "▸", { "aria-hidden": "true" }));
      toggle.appendChild(text(doc, "span", "slate-admin__fold-title", "Resin maintenance"));
      toggle.appendChild(text(doc, "span", "slate-admin__fold-note", `${resin.isActive ? "Deactivate" : "Reactivate"} · Delete`));
      section.appendChild(toggle);
      const body = element(doc, "div", "slate-admin__maintenance-body", { hidden: state.maintenanceOpen ? null : "" });
      const held = dirty() ? "save or discard the changes first." : "";

      const active = element(doc, "div", `slate-admin__maintenance-item${resin.isActive ? " is-danger" : ""}`);
      active.appendChild(text(doc, "h4", "slate-admin__maintenance-title", resin.isActive ? "Deactivate resin" : "Reactivate resin"));
      active.appendChild(text(doc, "p", "slate-admin__maintenance-copy", resin.isActive
        ? "It leaves the active catalog: Recipe Setup and Slate's resin search stop offering it. The record and its densities are kept."
        : "It returns to the active catalog and is offered again."));
      const activeButton = text(doc, "button", resin.isActive ? DANGER : ACTION,
        resin.isActive ? "Deactivate Resin" : "Reactivate Resin",
        { type: "button", "data-action": resin.isActive ? "deactivate" : "reactivate" });
      withhold(activeButton, "saveResin", { unable: dirty(), reason: held || why("saveResin") });
      active.appendChild(activeButton);
      body.appendChild(active);

      const removal = element(doc, "div", "slate-admin__maintenance-item is-danger");
      removal.appendChild(text(doc, "h4", "slate-admin__maintenance-title", "Delete resin"));
      removal.appendChild(text(doc, "p", "slate-admin__maintenance-copy",
        "Removes the record permanently. Use Inactive instead if it may be needed again."));
      const removeButton = text(doc, "button", DANGER, "Delete Resin", { type: "button", "data-action": "delete" });
      withhold(removeButton, "deleteResin", { unable: dirty(), reason: held || why("deleteResin") });
      removal.appendChild(removeButton);
      body.appendChild(removal);

      section.appendChild(body);
      return section;
    }

    function drawEditor() {
      const draft = state.draft;
      const resin = chosen();
      const isNew = adding();
      const detail = element(doc, "div", "slate-resins__detail", { "data-dirty": dirty() ? "true" : "false" });

      const nameRow = element(doc, "div", "slate-lines__name-row");
      nameRow.appendChild(text(doc, "h3", "slate-book__detail-name", isNew ? "New Resin" : resin.resinCode));
      if (resin && !resin.isActive) nameRow.appendChild(text(doc, "span", "slate-lines__tag", "Inactive", { "data-tag": "inactive" }));
      if (dirty()) nameRow.appendChild(text(doc, "span", "slate-lines__tag", "Unsaved changes", { "data-tag": "dirty" }));
      detail.appendChild(nameRow);
      detail.appendChild(text(doc, "p", "slate-admin__detail-meta", isNew ? ADD_HINT : detailMeta(resin)));

      const actions = element(doc, "div", "slate-book__actions");
      const save = text(doc, "button", PRIMARY, isNew ? "Add Resin" : "Save Changes", { type: "button", "data-action": "save" });
      withhold(save, "saveResin", { unable: !dirty(), reason: dirty() ? why("saveResin") : "nothing has changed." });
      actions.appendChild(save);
      const discardButton = text(doc, "button", QUIET, isNew ? "Cancel" : "Discard", { type: "button", "data-action": "discard" });
      discardButton.setAttribute("data-able", dirty() ? "true" : "false");
      if (busy() || !dirty()) discardButton.setAttribute("disabled", "");
      actions.appendChild(discardButton);
      detail.appendChild(actions);

      const fields = element(doc, "div", "slate-lines__fields");
      fields.appendChild(fieldRow("Resin code", textField("resinCode", draft.resinCode, { maxlength: "100", "aria-label": "Resin code" })));
      for (const entry of DENSITY_FIELDS) {
        fields.appendChild(fieldRow(`${entry.label} (${entry.unit})`, textField(entry.field, draft[entry.field], {
          inputmode: "decimal", "aria-label": entry.ariaLabel, placeholder: "Blank if unknown", "data-width": "value"
        })));
      }
      detail.appendChild(fields);
      detail.appendChild(text(doc, "p", "slate-lines__reach", REACH));

      if (resin) detail.appendChild(drawMaintenance(resin));
      return detail;
    }

    function drawDetail() {
      clearChildren(detailPane);
      if (state.view && state.view.kind === "confirm") { detailPane.appendChild(drawConfirm(state.view)); return; }
      if (!state.draft) {
        detailPane.appendChild(text(doc, "p", "slate-book__hint", state.resins.length ? "Select a resin to see its record." : ""));
        return;
      }
      detailPane.appendChild(drawEditor());
    }

    function paint() {
      const signedIn = open();
      const connected = !!(admin && typeof admin.isConnected === "function" && admin.isConnected());
      gate.textContent = connected ? SIGNED_OUT : NO_BRIDGE;
      show(gate, !signedIn);
      show(columns, signedIn);
      drawBar();
      if (!signedIn) return;
      drawList();
      drawDetail();
    }

    /* ---- Requests ---- */

    async function run(action, call) {
      state.pending = action;
      paint();
      let result;
      try {
        result = await call();
      } finally {
        state.pending = null;
      }
      return result || { ok: false, code: "failed", message: actionsModule.WORDING.noAnswer };
    }

    function failed(result, fallback) {
      if (actionsModule.accessLost(result)) { reset(); setNote(actionsModule.WORDING.accessEnded, "error"); return result; }
      setNote(result.message || fallback, "error");
      paint();
      return result;
    }

    async function load() {
      if (state.loading) return null;
      state.loading = true;
      setNote("Loading resin database…");
      paint();
      let result;
      try {
        result = await run("listResins", () => actionsModule.listResins(admin));
      } finally {
        state.loading = false;
      }
      if (!result.ok) return failed(result, "The resin database could not be read.");
      state.resins = sortResins(result.resins);
      state.loaded = true;
      // The chosen record as re-read - unless it is being edited: a draft
      // in hand is the operator's and is not replaced under them.
      if (state.focusId && !adding()) {
        const resin = chosen();
        if (!resin) { state.focusId = null; state.draft = null; }
        else if (!dirty()) state.draft = draftOf(resin);
      }
      setNote(`${state.resins.length} resin records loaded.`, "ok");
      paint();
      return result;
    }

    /* ---- Choosing ---- */

    function chooseNow(id) {
      state.view = null;
      state.maintenanceOpen = false;
      if (id === "new") {
        state.focusId = "new";
        state.draft = draftOf(null);
      } else {
        state.focusId = id || null;
        const resin = chosen();
        state.draft = resin ? draftOf(resin) : null;
      }
      setNote("");
      paint();
      if (id === "new") {
        const input = detailPane.querySelector("[data-field='resinCode']");
        if (input && typeof input.focus === "function") input.focus();
      }
    }

    /** Choose a record - or, with unsaved changes in hand, ask first. */
    function choose(id) {
      if (id === state.focusId) return;
      if (dirty()) {
        const resin = chosen() || { resinCode: state.draft && state.draft.resinCode.trim() };
        ask({
          action: "discard", title: "Unsaved Changes", label: "Discard Changes", danger: false,
          lines: discardLines(resin),
          run: () => { chooseNow(id); return { ok: true }; }
        });
        return;
      }
      chooseNow(id);
    }

    /* ---- Searching and editing ---- */

    function setQuery(value) {
      state.query = String(value || "");
      // Only the rows: the search field itself keeps its caret.
      drawList();
    }

    /* A typed field is never redrawn under the operator; what follows
     * from it is written in place. */
    function setField(field, value) {
      if (!state.draft) return;
      if (field !== "resinCode" && field !== "densityGCm3" && field !== "bulkDensityLbFt3") return;
      state.draft[field] = String(value || "");
      setNote("");
      // A record being added stands in the list under its code as typed.
      if (adding() && field === "resinCode") drawList();
      const input = detailPane.querySelector(`[data-field='${field}']`);
      if (input) input.removeAttribute("aria-invalid");
      syncDirty();
    }

    function syncDirty() {
      const detail = detailPane.querySelector(".slate-resins__detail");
      if (detail) detail.setAttribute("data-dirty", dirty() ? "true" : "false");
      const save = detailPane.querySelector("[data-action='save']");
      if (save) withhold(save, "saveResin", { unable: !dirty(), reason: dirty() ? why("saveResin") : "nothing has changed." });
      const discardButton = detailPane.querySelector("[data-action='discard']");
      if (discardButton) {
        discardButton.setAttribute("data-able", dirty() ? "true" : "false");
        if (busy() || !dirty()) discardButton.setAttribute("disabled", "");
        else discardButton.removeAttribute("disabled");
      }
      const row = detailPane.querySelector(".slate-lines__name-row");
      if (!row) return;
      const existing = row.querySelector("[data-tag='dirty']");
      if (dirty() && !existing) row.appendChild(text(doc, "span", "slate-lines__tag", "Unsaved changes", { "data-tag": "dirty" }));
      else if (!dirty() && existing) row.removeChild(existing);
    }

    function discard() {
      if (adding()) { state.focusId = null; state.draft = null; setNote(""); paint(); return; }
      const resin = chosen();
      state.draft = resin ? draftOf(resin) : null;
      setNote("");
      paint();
    }

    /* ---- Saving ---- */

    /* Mark the field a refusal names: by the field the bridge gives, or
     * failing that by the word in the application's message. */
    function markInvalid(result) {
      const byMessage = { resinCode: /resin code/i, densityGCm3: /^density/i, bulkDensityLbFt3: /bulk density/i };
      const message = String((result && result.message) || "");
      const named = result && typeof result.field === "string" ? result.field : "";
      for (const field of Object.keys(byMessage)) {
        const input = detailPane.querySelector(`[data-field='${field}']`);
        if (!input) continue;
        const invalid = named ? named === field : byMessage[field].test(message);
        if (invalid) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
    }

    async function save() {
      if (!state.draft || busy()) return null;
      const values = valuesOf(state.draft);
      // The two things this section can know on its own. Everything else
      // - the ranges, a code the database already holds - is the
      // application's, and its words are what a refusal shows.
      if (!values.resinCode) {
        const refused = { ok: false, code: "invalid", message: CODE_NEEDED, field: "resinCode" };
        setNote(refused.message, "error");
        markInvalid(refused);
        return refused;
      }
      if (duplicateCode(state.resins, values.resinCode, values.id)) {
        const refused = { ok: false, code: "duplicate_code", message: CODE_TAKEN, field: "resinCode" };
        setNote(refused.message, "error");
        markInvalid(refused);
        return refused;
      }
      const wasNew = adding();
      setNote(wasNew ? "Adding resin…" : "Saving…");
      const result = await run("saveResin", () => actionsModule.saveResin(admin, values.id || "", values, state.resins));
      if (!result.ok) {
        const answer = failed(result, "The resin could not be saved. Nothing was changed.");
        if (!actionsModule.accessLost(result)) markInvalid(result);
        return answer;
      }
      const saved = result.resin;
      // The record as the application returned it becomes the baseline, so
      // the editor reads clean before the list is read again.
      state.focusId = saved.id || state.focusId;
      state.resins = sortResins(state.resins.filter(resin => resin.id !== saved.id).concat([saved]));
      state.draft = draftOf(saved);
      await load();
      setNote("Resin saved. The active catalog has been refreshed.", "ok");
      paint();
      return result;
    }

    /* ---- The right pane's other face ---- */

    function ask(view) {
      state.view = Object.assign({ kind: "confirm" }, view);
      setNote("");
      paint();
      const go = detailPane.querySelector("[data-action='confirm-view']");
      if (go && typeof go.focus === "function") go.focus();
    }

    function closeView() {
      if (!state.view) return;
      state.view = null;
      paint();
    }

    function confirmView() {
      const view = state.view;
      if (!view || view.kind !== "confirm" || typeof view.run !== "function" || busy()) return null;
      return view.run();
    }

    /* Deactivate and reactivate: the same save with one field turned,
     * asked first and kept under the fold so neither rides along with an
     * edit. */
    function askActive(nextActive) {
      const resin = chosen();
      if (!resin || dirty()) return;
      ask({
        action: nextActive ? "reactivate" : "deactivate",
        title: nextActive ? "Reactivate Resin" : "Deactivate Resin",
        label: nextActive ? "Reactivate Resin" : "Deactivate Resin",
        danger: !nextActive,
        lines: nextActive ? reactivateLines(resin) : deactivateLines(resin),
        run: async () => {
          const values = Object.assign(valuesOf(draftOf(resin)), { isActive: nextActive });
          setNote(nextActive ? "Reactivating resin…" : "Deactivating resin…");
          const result = await run("saveResin", () => actionsModule.saveResin(admin, resin.id, values, state.resins));
          if (!result.ok) {
            if (actionsModule.accessLost(result)) return failed(result, "");
            state.view = null;
            return failed(result, "The resin could not be changed.");
          }
          state.view = null;
          state.draft = draftOf(result.resin);
          await load();
          setNote(`${resin.resinCode} ${nextActive ? "reactivated" : "deactivated"}.`, "ok");
          paint();
          return result;
        }
      });
    }

    /* Delete: permanent, asked for on its own, under the fold. */
    function askDelete() {
      const resin = chosen();
      if (!resin || dirty()) return;
      ask({
        action: "delete", title: "Delete Resin", label: "Delete Resin", danger: true,
        lines: deleteLines(resin),
        run: async () => {
          setNote("Deleting…");
          const result = await run("deleteResin", () => actionsModule.deleteResin(admin, resin.id));
          if (!result.ok) {
            if (actionsModule.accessLost(result)) return failed(result, "");
            state.view = null;
            return failed(result, "The resin could not be deleted. Nothing was changed.");
          }
          state.view = null;
          state.focusId = null;
          state.draft = null;
          state.maintenanceOpen = false;
          state.resins = state.resins.filter(item => item.id !== resin.id);
          await load();
          setNote(`${resin.resinCode} deleted.`, "ok");
          paint();
          return result;
        }
      });
    }

    /* ---- Access ---- */

    /** Drop everything read under a session: none of it survives one. */
    function reset() {
      state.resins = [];
      state.query = "";
      search.value = "";
      state.focusId = null;
      state.draft = null;
      state.loaded = false;
      state.view = null;
      state.maintenanceOpen = false;
      setNote("");
      paint();
    }

    function update() {
      if (!open()) {
        if (state.loaded || state.resins.length) reset();
        else paint();
        return;
      }
      if (!state.loaded && !state.loading && state.shown) { void load(); return; }
      paint();
    }

    rootEl.addEventListener("click", event => {
      const target = event && event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-action], [data-resin]")
        : null;
      if (!target || target.hasAttribute("disabled")) return;

      const resinId = target.getAttribute("data-resin");
      if (resinId) { choose(resinId); return; }

      const action = target.getAttribute("data-action");
      if (action === "toggle-maintenance") { state.maintenanceOpen = !state.maintenanceOpen; paint(); return; }
      if (action === "cancel-view") { closeView(); return; }
      if (action === "confirm-view") { void confirmView(); return; }
      if (action === "discard") { discard(); return; }
      if (target.getAttribute("data-able") === "false") {
        say(`${target.textContent} is unavailable: ${(target.getAttribute("title") || "").replace(/^Unavailable: /, "")}`);
        return;
      }
      if (action === "refresh") { void load(); return; }
      if (action === "add-resin") { choose("new"); return; }
      if (action === "save") { void save(); return; }
      if (action === "deactivate") { askActive(false); return; }
      if (action === "reactivate") { askActive(true); return; }
      if (action === "delete") { askDelete(); return; }
    });

    rootEl.addEventListener("input", event => {
      const target = event && event.target;
      if (!target || typeof target.getAttribute !== "function") return;
      if (target.getAttribute("data-role") === "search") { setQuery(target.value); return; }
      const field = target.getAttribute("data-field");
      if (field) setField(field, target.value);
    });

    rootEl.addEventListener("keydown", event => {
      if (!event) return;
      if (event.key === "Escape" && state.view) {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        closeView();
        return;
      }
      if (event.key !== "Enter") return;
      const target = event.target;
      const field = target && typeof target.getAttribute === "function" ? target.getAttribute("data-field") : null;
      if (!field) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (dirty()) void save();
    });

    if (admin && typeof admin.subscribe === "function") admin.subscribe(update);
    paint();

    return Object.freeze({
      element: rootEl,
      refresh: update,
      onShow() { state.shown = true; update(); },
      onHide() { state.shown = false; state.view = null; state.maintenanceOpen = false; paint(); },
      load,
      choose,
      save,
      search: setQuery,
      getState: () => ({
        focusId: state.focusId, loaded: state.loaded, loading: state.loading, pending: state.pending,
        dirty: dirty(), view: state.view ? { kind: state.view.kind, action: state.view.action } : null,
        maintenanceOpen: state.maintenanceOpen, resins: state.resins.length, query: state.query,
        note: state.note, noteKind: state.noteKind,
        draft: state.draft ? valuesOf(state.draft) : null
      })
    });
  }

  return Object.freeze({
    TITLE, LEAD, SIGNED_OUT, NO_BRIDGE, ADD_HINT, REACH, CODE_NEEDED, CODE_TAKEN, DENSITY_FIELDS,
    formatDate, densityText, rowMeta, detailMeta, draftOf, valuesOf, parseNumberField,
    sameDraft, duplicateCode, sortResins, filterResins,
    deactivateLines, reactivateLines, deleteLines, discardLines, create
  });
});
