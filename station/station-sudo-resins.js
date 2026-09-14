/* Resin Database: Sudo's third tool (station-sudo.js).
 *
 * WHAT IT IS
 *
 * The resin catalog, for an administrator: every record the plant keeps -
 * active and inactive - and for each its code, its density and its bulk
 * density. The same records the floor UI's Resin Database panel edits
 * (resin-admin-ui.js), in the Handbook's fixed bench: a searchable list
 * of codes on the left, the chosen record on the right as short aligned
 * rows, each pane scrolling on its own.
 *
 * WHAT A RESIN IS MADE OF
 *
 * A code, which is the record's name and the thing a recipe carries, and
 * two densities, each a number or unknown - blank is unknown, never zero.
 * Whether it is active decides whether Recipe Setup and Blend Edit offer
 * it; an inactive record is kept, with its densities, for the recipes
 * that still name it. Active or inactive is a maintenance act here, under
 * the fold beside Delete, not a field of the form: turning a record off
 * is asked and confirmed on its own, never carried along with an edit.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything comes through station-admin-bridge.js: the list is one
 * request (listResins), a save is one (saveResin) carrying the record, a
 * delete is one (deleteResin), and the list is re-read after each. The
 * application answers with its own admin instance's procedures (resin-
 * admin.js), which validate the record and, on success, refresh the
 * shared resin catalog - which is how a change reaches Recipe Setup, the
 * Resin Reference and Station's own Blend Edit search without this tool
 * touching the catalog at all.
 *
 * The value rules - the density ranges, a code the catalog already holds
 * - live in that service and in the database, and are deliberately not
 * copied here: no shared validator is reachable from a Station file. What
 * is checked before asking is what the tool can know on its own: that a
 * code was typed, and that it is not another loaded record's code. A
 * refusal from the service is shown in its own words, against the field
 * it names, with the draft kept.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: the last answered list, the search text, which
 * record is chosen, the working copy of it while it is being edited (dirty
 * until saved or discarded), what the right pane is showing (the record, a
 * confirmation), whether maintenance is unfolded, a request in flight, the
 * last message. Nothing survives a lost session.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationSudoResins = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ID = "resins";
  const TITLE = "Resin Database";
  const LABEL = "Resin Database";   // the word in Sudo's row of tools
  const SVG_NS = "http://www.w3.org/2000/svg";

  const ACTION = "station-handbook__action";
  const PRIMARY = `${ACTION} is-primary`;
  const QUIET = `${ACTION} is-quiet`;
  const DANGER = `${ACTION} is-danger`;
  const UTILITY = "station-handbook__utility";

  /* The two densities, with the unit each is read in. */
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

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function refreshGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-handbook__glyph", {
      viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.2 8.6 A 5.2 5.2 0 1 1 11.9 4.3" }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.4 2.6 L 13.4 5.8 L 10.2 5.8" }));
    return svg;
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

  /* --------------------------------------------------------------------
   *   The record: the fields, and what follows from them
   * ------------------------------------------------------------------ */

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

  /* A working copy of a record, with the fields the editor sets: the
   * densities as text, blank for unknown, so the field reads what was
   * stored and nothing is rounded under the operator. */
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
   * which may be NaN - sent as it is, so the bridge refuses it by name and
   * the field is marked, rather than quietly becoming unknown. */
  function parseNumberField(value) {
    const trimmed = String(value === null || value === undefined ? "" : value).trim();
    return trimmed === "" ? null : Number(trimmed);
  }

  /* The draft as a record, the shape the bridge takes. */
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

  /* Whether a code is another loaded record's - without regard to case,
   * as the catalog compares them; the record being edited is not its own
   * duplicate. The floor UI's panel makes the same check before it asks. */
  function duplicateCode(resins, code, id) {
    const wanted = String(code || "").trim().toLocaleLowerCase();
    if (!wanted) return false;
    return (resins || []).some(resin => resin.id !== id && String(resin.resinCode || "").trim().toLocaleLowerCase() === wanted);
  }

  /* In code order, whatever order they were answered in. */
  function sortResins(resins) {
    return (resins || []).slice().sort((a, b) => String(a.resinCode || "").localeCompare(String(b.resinCode || ""), undefined, { sensitivity: "base" }));
  }

  /* The rows a search shows: those whose code contains the text, without
   * regard to case; no text shows them all. Codes only, as the floor UI's
   * panel searches. */
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
   * Build the tool.
   *
   * @param {Document} doc
   * @param {object} context
   * @param {object|null} context.admin        the admin bridge (request).
   *        Handed in, never reached for.
   * @param {Element} [context.statusSlot]     where the catalog's count
   *        goes - the strip above the tool (station-sudo.js)
   * @param {function} [context.visible]       () => whether the tool is
   *        on screen; the list is read only for a page an operator can see
   */
  function create(doc, context) {
    const settings = context || {};
    const admin = settings.admin || null;
    const visible = typeof settings.visible === "function" ? settings.visible : () => true;

    const state = {
      resins: [],
      query: "",
      focusId: null,        // the chosen record's id, or "new" for one being added
      draft: null,          // the working copy of the chosen record
      loaded: false,
      loading: false,
      pending: null,        // the request in flight, by action
      view: null,           // null (the record) | { kind: "confirm", ... }
      maintenanceOpen: false,
      note: "",
      noteKind: ""
    };
    let access = null;

    const rootEl = element(doc, "div", "station-sudo-resins", { "data-role": "resin-database" });

    /* ---- The catalog's count, in the strip ---- */
    const status = element(doc, "span", "station-sudo-resins__current");
    const statusText = element(doc, "span", "station-sudo-resins__current-text");
    status.appendChild(statusText);
    if (settings.statusSlot && typeof settings.statusSlot.appendChild === "function") settings.statusSlot.appendChild(status);
    else rootEl.appendChild(status);

    const note = element(doc, "p", "station-sudo-ws__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    /* ---- The two panes: the shapes Workspace Management drew ---- */
    const columns = element(doc, "div", "station-sudo-ws__columns");
    rootEl.appendChild(columns);

    const listPane = element(doc, "section", "station-sudo-ws__list-pane", { "aria-label": "Resins" });
    const listHead = element(doc, "div", "station-sudo-ws__pane-head");
    const listTitle = element(doc, "span", "station-sudo-ws__eyebrow");
    listTitle.appendChild(text(doc, "span", "", "Resins"));
    const listCount = text(doc, "span", "station-sudo-ws__count", "", { "aria-label": "Resin count" });
    listTitle.appendChild(listCount);
    listHead.appendChild(listTitle);
    const addButton = text(doc, "button", ACTION, "Add Resin", {
      type: "button", "data-action": "add-resin", title: "Add a catalog record: its code and densities"
    });
    const refreshButton = element(doc, "button", UTILITY, {
      type: "button", "data-action": "refresh", "aria-label": "Refresh", title: "Refresh the resin list"
    });
    refreshButton.appendChild(refreshGlyph(doc));
    const listActions = element(doc, "span", "station-sudo-ws__pane-actions");
    listActions.appendChild(addButton); listActions.appendChild(refreshButton);
    listHead.appendChild(listActions);
    listPane.appendChild(listHead);
    // The search stands outside the list so a redraw of the rows never
    // takes the caret with it.
    const searchRow = element(doc, "div", "station-sudo-resins__search-row");
    const search = element(doc, "input", "station-sudo-resins__search", {
      type: "search", "data-role": "search", "aria-label": "Search resin codes", placeholder: "Search resin code",
      autocomplete: "off", spellcheck: "false"
    });
    searchRow.appendChild(search);
    listPane.appendChild(searchRow);
    const list = element(doc, "ol", "station-sudo-ws__list", { "aria-label": "Resins" });
    listPane.appendChild(list);
    columns.appendChild(listPane);

    const detailPane = element(doc, "section", "station-sudo-ws__detail-pane", { "aria-label": "Selected resin", "aria-live": "polite" });
    columns.appendChild(detailPane);

    /* ---- Reading ---- */

    function say(message, kind) {
      state.note = message || "";
      state.noteKind = state.note ? (kind || "") : "";
      note.textContent = state.note;
      note.setAttribute("data-kind", state.noteKind);
      show(note, !!state.note);
    }

    function chosen() {
      if (state.focusId === "new") return null;
      return state.resins.find(resin => resin.id === state.focusId) || null;
    }

    function adding() {
      return state.focusId === "new";
    }

    function dirty() {
      if (!state.draft) return false;
      if (adding()) return true;
      const resin = chosen();
      return !!resin && !sameDraft(state.draft, draftOf(resin));
    }

    function busy() {
      return !!state.pending || state.loading;
    }

    function shown() {
      return filterResins(state.resins, state.query);
    }

    /* ---- Drawing ---- */

    function drawStrip() {
      if (!state.loaded) { statusText.textContent = ""; return; }
      const active = state.resins.filter(resin => resin.isActive).length;
      statusText.textContent = `${active} active · ${state.resins.length - active} inactive`;
    }

    function drawList() {
      clearChildren(list);
      const rows = shown();
      listCount.textContent = !state.loaded ? "" : (state.query.trim() ? `${rows.length} of ${state.resins.length}` : String(state.resins.length));
      addButton.disabled = busy();
      refreshButton.disabled = busy();
      refreshButton.classList.toggle("is-busy", state.loading);
      search.disabled = !state.loaded && !state.resins.length;
      if (!rows.length && !adding()) {
        list.appendChild(text(doc, "li", "station-sudo-ws__empty",
          state.loading ? "Reading resins…" : (state.loaded ? (state.resins.length ? "No matching resin records." : "No resin records.") : "")));
        return;
      }
      for (const resin of rows) {
        const item = element(doc, "li");
        const row = element(doc, "button", `station-sudo-ws__row${resin.isActive ? "" : " is-inactive"}`, {
          type: "button", "data-resin": resin.id, "aria-pressed": resin.id === state.focusId ? "true" : "false",
          title: resin.isActive ? resin.resinCode : `${resin.resinCode} — inactive`
        });
        row.appendChild(text(doc, "span", "station-sudo-ws__row-name", resin.resinCode));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-mark", "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-meta", rowMeta(resin)));
        item.appendChild(row);
        list.appendChild(item);
      }
      if (adding()) {
        const item = element(doc, "li");
        const row = element(doc, "button", "station-sudo-ws__row is-new", { type: "button", "data-resin": "new", "aria-pressed": "true" });
        row.appendChild(text(doc, "span", "station-sudo-ws__row-name", state.draft && state.draft.resinCode.trim() ? state.draft.resinCode.trim() : "New resin"));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-mark", "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-meta", "Not saved yet"));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawConfirm(view) {
      const confirm = element(doc, "div", "station-sudo-ws__confirm", { "data-confirm": view.action, "data-danger": view.danger ? "true" : "false" });
      confirm.appendChild(text(doc, "h3", "station-sudo-ws__confirm-title", view.title));
      const lines = element(doc, "div", "station-sudo-ws__confirm-lines");
      for (const line of view.lines) lines.appendChild(text(doc, "p", "station-sudo-ws__confirm-line", line));
      confirm.appendChild(lines);
      const row = element(doc, "div", "station-sudo-ws__confirm-actions");
      const go = text(doc, "button", view.danger ? DANGER : PRIMARY, view.label, { type: "button", "data-action": "confirm-view" });
      go.disabled = busy();
      const cancel = text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-view" });
      row.appendChild(go); row.appendChild(cancel);
      confirm.appendChild(row);
      return confirm;
    }

    /* A field row: a label in the left track, the control in the right. */
    function fieldRow(label, control, attributes) {
      const row = element(doc, "div", "station-sudo-resins__field", attributes);
      row.appendChild(text(doc, "span", "station-sudo-resins__label", label));
      const value = element(doc, "span", "station-sudo-resins__value");
      value.appendChild(control);
      row.appendChild(value);
      return row;
    }

    function textField(field, value, attributes) {
      const input = element(doc, "input", "station-sudo-resins__input", Object.assign({
        type: "text", autocomplete: "off", spellcheck: "false", "data-field": field
      }, attributes || {}));
      input.value = value === null || value === undefined ? "" : String(value);
      input.disabled = busy();
      return input;
    }

    function drawMaintenance(resin) {
      const section = element(doc, "section", "station-sudo-ws__maintenance", { "aria-label": "Resin maintenance" });
      const toggle = element(doc, "button", "station-sudo-ws__fold", {
        type: "button", "data-action": "toggle-maintenance", "aria-expanded": state.maintenanceOpen ? "true" : "false"
      });
      toggle.appendChild(text(doc, "span", "station-sudo-ws__fold-mark", state.maintenanceOpen ? "▾" : "▸", { "aria-hidden": "true" }));
      toggle.appendChild(text(doc, "span", "station-sudo-ws__eyebrow", "Resin maintenance"));
      toggle.appendChild(text(doc, "span", "station-sudo-ws__fold-note", `${resin.isActive ? "Deactivate" : "Reactivate"} · Delete`));
      section.appendChild(toggle);
      const body = element(doc, "div", "station-sudo-ws__maintenance-body", { hidden: state.maintenanceOpen ? null : "" });
      const held = busy() || dirty();
      const hint = dirty() ? "Save or discard the changes first" : "";

      const active = element(doc, "div", `station-sudo-ws__maintenance-item${resin.isActive ? " is-danger" : ""}`);
      active.appendChild(text(doc, "h4", "station-sudo-ws__maintenance-title", resin.isActive ? "Deactivate resin" : "Reactivate resin"));
      active.appendChild(text(doc, "p", "station-sudo-ws__maintenance-copy", resin.isActive
        ? "It leaves the active catalog: Recipe Setup and Station's recipe cards stop offering it. The record and its densities are kept."
        : "It returns to the active catalog and is offered again."));
      const activeButton = text(doc, "button", resin.isActive ? DANGER : ACTION, resin.isActive ? "Deactivate Resin" : "Reactivate Resin", {
        type: "button", "data-action": resin.isActive ? "deactivate" : "reactivate"
      });
      activeButton.disabled = held;
      activeButton.setAttribute("title", hint);
      active.appendChild(activeButton);
      body.appendChild(active);

      const remove = element(doc, "div", "station-sudo-ws__maintenance-item is-danger");
      remove.appendChild(text(doc, "h4", "station-sudo-ws__maintenance-title", "Delete resin"));
      remove.appendChild(text(doc, "p", "station-sudo-ws__maintenance-copy",
        "Removes the record permanently. Use Inactive instead if it may be needed again."));
      const removeButton = text(doc, "button", DANGER, "Delete Resin", { type: "button", "data-action": "delete" });
      removeButton.disabled = held;
      removeButton.setAttribute("title", hint);
      remove.appendChild(removeButton);
      body.appendChild(remove);

      section.appendChild(body);
      return section;
    }

    function drawEditor() {
      const draft = state.draft;
      const resin = chosen();
      const isNew = adding();
      const detail = element(doc, "div", "station-sudo-resins__detail", { "data-dirty": dirty() ? "true" : "false" });

      const head = element(doc, "div", "station-sudo-ws__detail-head");
      const identity = element(doc, "div", "station-sudo-ws__identity");
      const nameRow = element(doc, "div", "station-sudo-resins__name-row");
      nameRow.appendChild(text(doc, "h3", "station-sudo-ws__detail-name", isNew ? "New Resin" : resin.resinCode));
      if (resin && !resin.isActive) nameRow.appendChild(text(doc, "span", "station-sudo-resins__tag", "Inactive", { "data-tag": "inactive" }));
      if (dirty()) nameRow.appendChild(text(doc, "span", "station-sudo-resins__tag", "Unsaved changes", { "data-tag": "dirty" }));
      identity.appendChild(nameRow);
      identity.appendChild(text(doc, "p", "station-sudo-ws__detail-meta", isNew
        ? "A catalog record: its code and densities. Active resins are offered in Recipe Setup and Station's recipe cards."
        : detailMeta(resin)));
      head.appendChild(identity);
      const actions = element(doc, "div", "station-sudo-ws__detail-actions");
      const save = text(doc, "button", PRIMARY, isNew ? "Add Resin" : "Save Changes", { type: "button", "data-action": "save" });
      save.disabled = busy() || !dirty();
      actions.appendChild(save);
      const discard = text(doc, "button", QUIET, isNew ? "Cancel" : "Discard", { type: "button", "data-action": "discard" });
      discard.disabled = busy() || !dirty();
      actions.appendChild(discard);
      head.appendChild(actions);
      detail.appendChild(head);

      const fields = element(doc, "div", "station-sudo-resins__fields");
      fields.appendChild(fieldRow("Resin code", textField("resinCode", draft.resinCode, { maxlength: "100", "aria-label": "Resin code" })));
      for (const entry of DENSITY_FIELDS) {
        fields.appendChild(fieldRow(`${entry.label} (${entry.unit})`, textField(entry.field, draft[entry.field], {
          inputmode: "decimal", "aria-label": entry.ariaLabel, placeholder: "Blank if unknown", "data-width": "short"
        })));
      }
      detail.appendChild(fields);

      detail.appendChild(text(doc, "p", "station-sudo-resins__reach",
        "A saved change refreshes this device's active catalog now; other devices read it when they next load the catalog."));

      if (resin) detail.appendChild(drawMaintenance(resin));
      return detail;
    }

    function drawDetail() {
      clearChildren(detailPane);
      if (state.view && state.view.kind === "confirm") { detailPane.appendChild(drawConfirm(state.view)); return; }
      if (!state.draft) {
        detailPane.appendChild(text(doc, "p", "station-sudo-ws__empty", state.resins.length
          ? "Select a resin to see its record."
          : ""));
        return;
      }
      detailPane.appendChild(drawEditor());
    }

    function refresh() {
      drawStrip();
      drawList();
      drawDetail();
    }

    /* ---- Requests ---- */

    async function request(action, args) {
      if (!admin || typeof admin.request !== "function") {
        return { ok: false, code: "unavailable", message: "No application is connected to Station's administrator tools." };
      }
      state.pending = action;
      refresh();
      let result;
      try {
        result = await admin.request(action, args);
      } finally {
        state.pending = null;
      }
      return result || { ok: false, code: "failed", message: "The application did not answer." };
    }

    function accessLost(result) {
      return !!result && (result.code === "not_authenticated" || result.code === "access_denied");
    }

    async function load() {
      if (state.loading) return null;
      state.loading = true;
      say("Loading resin database…");
      refresh();
      let result;
      try {
        result = await request("listResins");
      } finally {
        state.loading = false;
      }
      if (!result.ok) {
        if (accessLost(result)) { reset(); return result; }
        say(result.message || "Could not load the resin database.", "error");
        refresh();
        return result;
      }
      state.resins = sortResins(result.resins);
      state.loaded = true;
      // The chosen record as re-read, unless it is being edited: a draft
      // in hand is the operator's and is not replaced under them.
      if (state.focusId && !adding()) {
        const resin = chosen();
        if (!resin) { state.focusId = null; state.draft = null; }
        else if (!dirty()) state.draft = draftOf(resin);
      }
      say(`${state.resins.length} resin records loaded.`, "ok");
      refresh();
      return result;
    }

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
      say("");
      refresh();
      if (id === "new") {
        const input = detailPane.querySelector ? detailPane.querySelector("[data-field='resinCode']") : null;
        if (input && typeof input.focus === "function") input.focus();
      }
    }

    /* Choose a record - or, with unsaved changes in hand, ask first. */
    function choose(id) {
      if (id === state.focusId) return;
      if (dirty()) {
        const resin = chosen() || { resinCode: state.draft && state.draft.resinCode.trim() };
        ask({
          action: "discard", title: "Unsaved Changes", label: "Discard Changes", danger: false,
          lines: discardLines(resin),
          run: async () => { chooseNow(id); return { ok: true }; }
        });
        return;
      }
      chooseNow(id);
    }

    /* ---- Searching and editing ---- */

    function setQuery(value) {
      state.query = String(value || "");
      drawList();
    }

    function setField(field, value) {
      if (!state.draft) return;
      if (field !== "resinCode" && field !== "densityGCm3" && field !== "bulkDensityLbFt3") return;
      state.draft[field] = String(value || "");
      say("");
      // A record being added stands in the list under its code as typed.
      if (adding() && field === "resinCode") drawList();
      // The inputs keep their own values; only what reads from the draft
      // is redrawn, and not while the operator is in a field.
      const head = detailPane.querySelector ? detailPane.querySelector(".station-sudo-resins__detail") : null;
      if (head) head.setAttribute("data-dirty", dirty() ? "true" : "false");
      const save = detailPane.querySelector ? detailPane.querySelector("[data-action='save']") : null;
      if (save) save.disabled = busy() || !dirty();
      const discard = detailPane.querySelector ? detailPane.querySelector("[data-action='discard']") : null;
      if (discard) discard.disabled = busy() || !dirty();
      const input = detailPane.querySelector ? detailPane.querySelector(`[data-field='${field}']`) : null;
      if (input) input.removeAttribute("aria-invalid");
      syncDirtyTag();
    }

    function syncDirtyTag() {
      const row = detailPane.querySelector ? detailPane.querySelector(".station-sudo-resins__name-row") : null;
      if (!row) return;
      const existing = row.querySelector ? row.querySelector("[data-tag='dirty']") : null;
      if (dirty() && !existing) row.appendChild(text(doc, "span", "station-sudo-resins__tag", "Unsaved changes", { "data-tag": "dirty" }));
      else if (!dirty() && existing) row.removeChild(existing);
    }

    function discard() {
      if (adding()) { state.focusId = null; state.draft = null; say(""); refresh(); return; }
      const resin = chosen();
      state.draft = resin ? draftOf(resin) : null;
      say("");
      refresh();
    }

    /* ---- Saving ---- */

    /* Mark the field a refusal names: by the field the bridge gives, or
     * failing that by the word in the service's message. */
    function markInvalid(result) {
      const byMessage = { resinCode: /resin code/i, densityGCm3: /^density/i, bulkDensityLbFt3: /bulk density/i };
      const message = String((result && result.message) || "");
      const named = result && typeof result.field === "string" ? result.field : "";
      for (const field of Object.keys(byMessage)) {
        const input = detailPane.querySelector ? detailPane.querySelector(`[data-field='${field}']`) : null;
        if (!input) continue;
        const invalid = named ? named === field : byMessage[field].test(message);
        if (invalid) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
    }

    async function save() {
      if (!state.draft || busy()) return null;
      const values = valuesOf(state.draft);
      if (!values.resinCode) {
        const refused = { ok: false, code: "invalid", message: "Resin code is required.", field: "resinCode" };
        say(refused.message, "error");
        markInvalid(refused);
        return refused;
      }
      if (duplicateCode(state.resins, values.resinCode, values.id)) {
        const refused = { ok: false, code: "duplicate_code", message: "That resin code already exists.", field: "resinCode" };
        say(refused.message, "error");
        markInvalid(refused);
        return refused;
      }
      const wasNew = adding();
      say(wasNew ? "Adding resin…" : "Saving…");
      const result = await request("saveResin", { id: values.id || "", resin: values });
      if (!result.ok) {
        if (accessLost(result)) { reset(); return result; }
        say(result.message || "Could not save the resin. No changes were applied.", "error");
        refresh();
        markInvalid(result);
        return result;
      }
      const saved = result.resin;
      // The saved record as the server returned it becomes the chosen
      // record's baseline, so the editor reads clean before the list is re-read.
      state.focusId = saved.id || state.focusId;
      state.resins = sortResins(state.resins.filter(resin => resin.id !== saved.id).concat([saved]));
      state.draft = draftOf(saved);
      await load();
      say("Resin saved. The active catalog has been refreshed.", "ok");
      refresh();
      return result;
    }

    /* ---- The right pane's other face: a confirmation ---- */

    function ask(view) {
      state.view = Object.assign({ kind: "confirm" }, view);
      say("");
      refresh();
      const go = detailPane.querySelector ? detailPane.querySelector("[data-action='confirm-view']") : null;
      if (go && typeof go.focus === "function") go.focus();
    }

    function closeView() {
      state.view = null;
      refresh();
    }

    async function confirmView() {
      const view = state.view;
      if (!view || view.kind !== "confirm" || typeof view.run !== "function") return null;
      return view.run();
    }

    /* Deactivate and reactivate: the same save, with one field turned,
     * asked first and kept under the fold. */
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
          say(nextActive ? "Reactivating resin…" : "Deactivating resin…");
          const result = await request("saveResin", { id: resin.id, resin: values });
          if (!result.ok) {
            if (accessLost(result)) { reset(); return result; }
            state.view = null;
            say(result.message || "The resin could not be changed.", "error");
            refresh();
            return result;
          }
          state.view = null;
          state.draft = draftOf(result.resin);
          await load();
          say(`${resin.resinCode} ${nextActive ? "reactivated" : "deactivated"}.`, "ok");
          refresh();
          return result;
        }
      });
    }

    /* Delete: asked first in the floor UI's words, under the fold. */
    function askDelete() {
      const resin = chosen();
      if (!resin || dirty()) return;
      ask({
        action: "delete", title: "Delete Resin", label: "Delete Resin", danger: true,
        lines: deleteLines(resin),
        run: async () => {
          say("Deleting…");
          const result = await request("deleteResin", { id: resin.id });
          if (!result.ok) {
            if (accessLost(result)) { reset(); return result; }
            state.view = null;
            say(result.message || "Could not delete the resin. No changes were applied.", "error");
            refresh();
            return result;
          }
          state.view = null;
          state.focusId = null;
          state.draft = null;
          state.maintenanceOpen = false;
          state.resins = state.resins.filter(item => item.id !== resin.id);
          await load();
          say(`${resin.resinCode} deleted.`, "ok");
          refresh();
          return result;
        }
      });
    }

    /* ---- Access ---- */

    /** Drop everything read under a session: nothing of it survives one. */
    function reset() {
      state.resins = [];
      state.query = "";
      search.value = "";
      state.focusId = null;
      state.draft = null;
      state.loaded = false;
      state.view = null;
      state.maintenanceOpen = false;
      say("");
      refresh();
    }

    /** The page's word on every publish, and on showing: read once per session. */
    function update(current) {
      access = current || access;
      const signedIn = !!(access && access.access && access.access.signedIn);
      if (!signedIn) { if (state.loaded || state.resins.length) reset(); else refresh(); return; }
      if (!state.loaded && !state.loading && visible()) { void load(); return; }
      refresh();
    }

    rootEl.addEventListener("click", event => {
      const target = event.target && event.target.closest
        ? event.target.closest("[data-action], [data-resin]")
        : null;
      if (!target || target.disabled) return;
      const resinId = target.getAttribute("data-resin");
      if (resinId) { choose(resinId); return; }
      const action = target.getAttribute("data-action");
      if (action === "refresh") { void load(); return; }
      if (action === "add-resin") { choose("new"); return; }
      if (action === "save") { void save(); return; }
      if (action === "discard") { discard(); return; }
      if (action === "confirm-view") { void confirmView(); return; }
      if (action === "cancel-view") { closeView(); return; }
      if (action === "toggle-maintenance") { state.maintenanceOpen = !state.maintenanceOpen; refresh(); return; }
      if (action === "deactivate") { askActive(false); return; }
      if (action === "reactivate") { askActive(true); return; }
      if (action === "delete") { askDelete(); return; }
    });
    rootEl.addEventListener("input", event => {
      const target = event.target;
      if (!target || typeof target.getAttribute !== "function") return;
      if (target.getAttribute("data-role") === "search") { setQuery(target.value); return; }
      const field = target.getAttribute("data-field");
      if (!field) return;
      setField(field, target.value);
    });
    rootEl.addEventListener("keydown", event => {
      if (!event || event.key !== "Enter") return;
      const target = event.target;
      const field = target && typeof target.getAttribute === "function" ? target.getAttribute("data-field") : null;
      if (!field) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (dirty()) void save();
    });

    refresh();

    return {
      element: rootEl,
      update,
      reset,
      focus() {
        const first = list.querySelector ? list.querySelector("[data-resin][aria-pressed='true'], [data-resin]") : null;
        const target = first || addButton;
        if (target && typeof target.focus === "function" && !target.disabled) target.focus();
      },
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
    };
  }

  /* The tool as Sudo takes it. */
  const tool = Object.freeze({ id: ID, title: TITLE, label: LABEL, create });

  return Object.freeze({
    ID, TITLE, LABEL, tool, create,
    DENSITY_FIELDS,
    rowMeta, detailMeta, draftOf, valuesOf, parseNumberField, sameDraft, duplicateCode, sortResins, filterResins,
    deactivateLines, reactivateLines, deleteLines, discardLines
  });
});
