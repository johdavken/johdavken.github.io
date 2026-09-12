/* The focused layer's recipe editor: what fills the reserved workspace when
 * a layer is open.
 *
 * WHAT IT IS
 *
 * One entry per hopper in the open layer, as a stacked list of configuration
 * rows - not a table, not a grid of cells. Each row carries the hopper's
 * identity as a badge, its blend percentage as the leading number, the
 * resin it holds, and where that resin comes from. A blend total closes the
 * list. This is desktop data entry: every value is reachable with Tab, the
 * arrow keys move between hoppers, and the resin is found by searching the
 * shared catalog rather than typed blind.
 *
 * WHAT IT IS NOT, YET
 *
 * A way to change anything. The Station state bridge is a one-way window
 * onto the application, and the command bridge (station-command-bridge.js)
 * has no producer connected. So the structure here is the structure we
 * intend to keep - the fields, their semantics, their focus order, the
 * search - but nothing commits: a resin chosen from the search, or a key
 * pressed on a percentage, is answered with a note saying it was not
 * applied, and the row keeps showing what the bridge says. No value that
 * looks saved and is not is ever shown, because that is worse than no field
 * at all. When the executor exists it plugs in at the two places marked
 * WRITE CONTRACT below.
 *
 * WHAT IT HOLDS, AND WHAT IT DOES NOT
 *
 * Canonical recipe values belong to the application and arrive through the
 * bridge; the editor copies none of them anywhere but into the controls it
 * draws. What it does hold is TRANSIENT INTERACTION state - which control
 * the operator is in, and what they have typed there - and it reports that
 * to the boot file through `onEditing` as it changes:
 *
 *   { layer, index, hopper, slot, mode, draft, baseValue }
 *     slot  resin | pct | source      mode  search | typing
 *
 * so the boot file can keep one `editing` record beside its canonical
 * snapshot and never confuse the two.
 *
 * WHAT A PUBLISH DOES TO AN OPEN EDITOR
 *
 * The application publishes on every committed change - a weight on a
 * phone, a tracking toggle, a resin from another device - and every one
 * used to rebuild this editor, destroying an open search and its focus. So
 * `update()` applies new canonical values to the rows that already exist,
 * and protects whichever control is active: its live value is never
 * overwritten by a publish. If the canonical value under that control has
 * moved since the operator started, the row is marked and the note says
 * so; the draft is left alone. A row whose shape must change (a hopper
 * emptied or filled) while one of its controls is active is rebuilt only
 * once the control is left.
 *
 * HOW IT IS LINKED TO THE DRAWING
 *
 * Every row carries `data-hopper` and `data-layer`, the same two attributes
 * the drawn hopper carries, so the boot file can resolve a row and its
 * hopper to one another from either side. Hover and selection classes are
 * applied there, not here: this module builds the list and owns the search;
 * it holds no selection of its own.
 *
 * It is built the way the rest of Station is built: HTML from an injected
 * document, no framework, no timers, and every decision about appearance in
 * the stylesheet (styles/components/focus-editor.css).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationFocusEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RESULT_LIMIT = 8;

  /* --------------------------------------------------------------------
   *   Result list placement
   * ------------------------------------------------------------------
   * The list hangs below the value it belongs to. On the lower rows it ran
   * past the bottom of the drawing and lost its last options: the stage
   * <svg> clips at its own edge, as every non-root <svg> does, in both
   * Chromium and Firefox - and Firefox stops short of even that, at the
   * <foreignObject> box, for content that grew past it after layout (see
   * workspaceBounds in create()). So the list is placed after it is
   * measured: below when it fits below, above when it fits above, and on
   * the roomier side, no taller than that room, when it fits neither.
   *
   * Pure, so the arithmetic is tested without a browser. Every rectangle
   * is in one coordinate space (the viewport, as getBoundingClientRect
   * reports it); `gap` is the space between the value and the list. */
  function placeResults(measure) {
    const m = measure || {};
    const anchor = m.anchor;
    const list = m.list;
    const bounds = m.bounds;
    const gap = Number.isFinite(m.gap) ? m.gap : 0;
    if (!anchor || !list || !bounds) return { placement: "below", maxHeight: null };
    const below = bounds.bottom - (anchor.bottom + gap);
    const above = (anchor.top - gap) - bounds.top;
    if (list.height <= below) return { placement: "below", maxHeight: null };
    if (list.height <= above) return { placement: "above", maxHeight: null };
    return below >= above
      ? { placement: "below", maxHeight: Math.max(0, Math.floor(below)) }
      : { placement: "above", maxHeight: Math.max(0, Math.floor(above)) };
  }

  function round(value) {
    return Math.round(Number(value) * 100) / 100;
  }

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

  /* --------------------------------------------------------------------
   *   The blend - one derivation, shared with the inspector
   * ------------------------------------------------------------------ */

  /**
   * A layer's hoppers as the rows the editor shows, and their total.
   * `hopperState` is the runtime shape station-source.js resolves, keyed
   * "<layer>:<index>". A hopper counts as assigned when it has a resin or a
   * percentage; the total is over every row, so a percentage on a hopper
   * with no resin still counts, because it counts on the floor.
   */
  function blendFor(layer, hopperState) {
    if (!layer) return null;
    const rows = layer.hoppers.map(hopper => {
      const runtime = (hopperState && hopperState[`${layer.id}:${hopper.index}`]) || {};
      const pct = Number.isFinite(runtime.pct) ? runtime.pct : 0;
      const resin = runtime.resinName || "";
      return {
        id: hopper.id,
        index: hopper.index,
        resin,
        pct,
        source: runtime.source || "",
        assigned: !!(resin || pct)
      };
    });
    const total = rows.reduce((sum, row) => sum + row.pct, 0);
    return {
      layer,
      rows,
      total,
      assigned: rows.filter(row => row.assigned),
      valid: Math.round(total) === 100
    };
  }

  /* --------------------------------------------------------------------
   *   Resin search
   * ------------------------------------------------------------------ */

  /**
   * The catalog entries matching a query, best first: codes that start
   * with it, then codes that contain it, each in catalog order. An empty
   * query lists the start of the catalog, so opening the search on an empty
   * hopper shows something to pick rather than nothing.
   *
   * @param {Array<{resin_code: string}>} catalog
   * @param {string} query
   * @param {number} [limit]
   */
  function filterResins(catalog, query, limit) {
    const max = Number.isInteger(limit) && limit > 0 ? limit : RESULT_LIMIT;
    const needle = String(query || "").trim().toLocaleLowerCase();
    const entries = Array.isArray(catalog) ? catalog.filter(entry => entry && entry.resin_code) : [];
    if (!needle) return entries.slice(0, max);
    const starts = [];
    const contains = [];
    for (const entry of entries) {
      const code = String(entry.resin_code).toLocaleLowerCase();
      if (code.startsWith(needle)) starts.push(entry);
      else if (code.includes(needle)) contains.push(entry);
    }
    return starts.concat(contains).slice(0, max);
  }

  function densityLabel(entry) {
    return Number.isFinite(entry.density_g_cm3) ? `${entry.density_g_cm3.toFixed(3)} g/cm³` : "";
  }

  /* The search, opened in place of a row's resin value: a combobox input
   * with a listbox under it, filtering the catalog as the operator types.
   * Everything it creates it removes again on close, and the resting value
   * button gets focus back so a keyboard user does not lose their place. */
  function openSearch(doc, row, state, deps) {
    if (row.search) return;
    const resinBlock = row.resinBlock;
    const button = row.resinButton;
    const listId = `station-editor-results-${state.layer.id}-${row.index}`;

    const input = element(doc, "input", "station-editor__search", {
      type: "text",
      role: "combobox",
      autocomplete: "off",
      spellcheck: "false",
      "aria-autocomplete": "list",
      "aria-expanded": "true",
      "aria-controls": listId,
      "aria-label": `Search resins for ${row.id}`,
      placeholder: "Search resins"
    });
    input.value = row.resin;

    const results = element(doc, "ul", "station-editor__results", { role: "listbox", id: listId });
    // The list's own surface - its padding, and the scrollbar it grows when
    // clamped - must not take focus off the input either; the options below
    // say the same for themselves.
    results.addEventListener("mousedown", event => event.preventDefault());

    const search = { input, results, matches: [], active: -1 };
    row.search = search;
    row.base = row.resin;
    row.item.classList.add("is-searching");
    button.setAttribute("hidden", "");
    button.setAttribute("aria-expanded", "true");
    resinBlock.appendChild(input);
    resinBlock.appendChild(results);

    const catalog = deps.resins();

    function renderResults() {
      while (results.firstChild) results.removeChild(results.firstChild);
      search.matches = filterResins(catalog, input.value);
      search.active = search.matches.length ? Math.max(0, Math.min(search.active, search.matches.length - 1)) : -1;
      if (!search.matches.length) {
        results.appendChild(text(doc, "li", "station-editor__no-match", "No matching resin", { role: "presentation" }));
        input.removeAttribute("aria-activedescendant");
        return;
      }
      search.matches.forEach((entry, index) => {
        const option = element(doc, "li", "station-editor__option", {
          role: "option",
          id: `${listId}-${index}`,
          "data-resin": entry.resin_code,
          "aria-selected": index === search.active ? "true" : "false"
        });
        if (index === search.active) option.classList.add("is-active");
        option.appendChild(text(doc, "span", "station-editor__option-code", entry.resin_code));
        const density = densityLabel(entry);
        if (density) option.appendChild(text(doc, "span", "station-editor__option-note", density));
        // mousedown would move focus off the input and close the search
        // before the click could land; the click itself does the choosing.
        option.addEventListener("mousedown", event => event.preventDefault());
        option.addEventListener("click", () => choose(entry));
        results.appendChild(option);
      });
      input.setAttribute("aria-activedescendant", search.active >= 0 ? `${listId}-${search.active}` : "");
    }

    /* Measure the list at its natural height where the stylesheet puts it
     * by default (below), then decide. The gap is read off that first
     * placement rather than restated here, so the stylesheet stays the
     * only place the spacing is written. The decision lands on the list as
     * data - a placement name and, when clamped, a height - and the
     * stylesheet decides what those look like. */
    function position() {
      results.removeAttribute("data-placement");
      results.removeAttribute("style");
      const anchor = deps.measure(input);
      const list = deps.measure(results);
      const decision = placeResults({
        anchor,
        list,
        bounds: deps.bounds(row),
        gap: anchor && list ? list.top - anchor.bottom : 0
      });
      results.setAttribute("data-placement", decision.placement);
      if (decision.maxHeight !== null) results.setAttribute("style", `--station-results-max: ${decision.maxHeight}px;`);
    }

    function move(step) {
      if (!search.matches.length) return;
      search.active = (search.active + step + search.matches.length) % search.matches.length;
      renderResults();
    }

    function choose(entry) {
      closeSearch(doc, row, state, deps);
      /* WRITE CONTRACT: this is where a chosen resin would be handed to the
       * application. There is no such hand-off yet, and nothing is held
       * back here as if there were; the row keeps showing what the bridge
       * says, and the note says why. */
      deps.note(`${entry.resin_code} for ${row.id} was not applied: Station is read-only in this phase.`);
    }

    input.addEventListener("input", () => {
      search.active = 0;
      renderResults();
      position();
      deps.onEditing(editingRecord(state, row, "resin", "search", input.value, row.base));
    });
    input.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") { event.preventDefault(); move(1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); move(-1); return; }
      if (event.key === "Enter") {
        event.preventDefault();
        if (search.active >= 0 && search.matches[search.active]) choose(search.matches[search.active]);
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(doc, row, state, deps); }
    });
    // Leaving the search by any other means (Tab, a click elsewhere) closes
    // it; the listbox options refuse focus, so a click on one stays inside.
    input.addEventListener("blur", event => {
      const to = event.relatedTarget;
      if (to && results.contains && results.contains(to)) return;
      closeSearch(doc, row, state, deps, { keepFocus: true });
    });

    search.active = 0;
    renderResults();
    position();
    if (typeof input.focus === "function") input.focus();
    if (typeof input.select === "function") input.select();
    deps.onEditing(editingRecord(state, row, "resin", "search", input.value, row.base));
  }

  function closeSearch(doc, row, state, deps, options) {
    const search = row.search;
    if (!search) return;
    row.search = null;
    row.item.classList.remove("is-searching");
    row.resinBlock.removeChild(search.input);
    row.resinBlock.removeChild(search.results);
    row.resinButton.removeAttribute("hidden");
    row.resinButton.setAttribute("aria-expanded", "false");
    if (!(options && options.keepFocus) && typeof row.resinButton.focus === "function") row.resinButton.focus();
    settleRow(doc, row, state, deps);
  }

  /* --------------------------------------------------------------------
   *   Rows
   * ------------------------------------------------------------------ */

  const SLOTS = ["pct", "resin", "source"];

  /* The focusable in `row` for a slot, or the row's first focusable when it
   * has no such slot (an empty hopper has only its resin control). */
  function focusableFor(row, slot) {
    const wanted = row.item.querySelector(`[data-slot='${slot}']`);
    if (wanted) return wanted;
    for (const name of SLOTS) {
      const fallback = row.item.querySelector(`[data-slot='${name}']`);
      if (fallback) return fallback;
    }
    return null;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* The resin value at rest: the code, or the "add" placeholder. Written
   * on build and again on patch, so a row's resin follows the bridge. */
  function writeResinButton(doc, button, entry) {
    clearChildren(button);
    button.setAttribute("aria-label", entry.resin ? `${entry.id} resin, ${entry.resin}` : `Add resin to ${entry.id}`);
    if (entry.resin) {
      button.classList.remove("is-placeholder");
      button.textContent = entry.resin;
    } else {
      button.classList.add("is-placeholder");
      button.textContent = "";
      button.appendChild(text(doc, "span", "station-editor__glyph", "+", { "aria-hidden": "true" }));
      button.appendChild(text(doc, "span", null, "Add resin"));
    }
  }

  function writeSourceButton(button, entry) {
    button.setAttribute("aria-label", entry.source ? `${entry.id} source, ${entry.source}` : `Add source for ${entry.id}`);
    if (entry.source) {
      button.classList.remove("is-placeholder");
      button.textContent = entry.source;
    } else {
      button.classList.add("is-placeholder");
      button.textContent = "Add source";
    }
  }

  /* Fill (or refill) a row's item from an entry. The <li> itself is kept:
   * it carries the identity attributes and the selection and highlight
   * classes the boot file writes, and it is what the drawn hopper links
   * to. Everything inside it is built here. */
  function fillRow(doc, row, entry, state, deps) {
    const item = row.item;
    clearChildren(item);
    row.entry = entry;
    row.built = entry.assigned;   // the shape the controls below were built for
    row.resin = entry.resin;
    row.search = null;
    row.pctInput = null;
    row.sourceButton = null;
    row.pending = null;
    item.classList.remove("is-searching");
    item.classList.toggle("is-empty", !entry.assigned);

    /* The badge: static identity, anchoring the row. Not a control. */
    item.appendChild(text(doc, "span", "station-editor__badge", entry.id));

    const main = element(doc, "div", "station-editor__main");
    const resinBlock = element(doc, "div", "station-editor__resin");
    row.resinBlock = resinBlock;

    /* The resin, as a value that becomes a search when activated. At rest
     * it reads as text; the button semantics are what make it reachable
     * and announce that a list opens. */
    const resinButton = element(doc, "button", "station-editor__resin-value", {
      type: "button",
      "data-slot": "resin",
      "aria-haspopup": "listbox",
      "aria-expanded": "false"
    });
    writeResinButton(doc, resinButton, entry);
    resinButton.addEventListener("click", () => openSearch(doc, row, state, deps));
    row.resinButton = resinButton;
    resinBlock.appendChild(resinButton);
    main.appendChild(resinBlock);

    /* The source, under the resin: secondary, quiet when absent. Only a
     * hopper that has a resin can have a source, so an empty hopper does
     * not get a second placeholder under its first. */
    if (entry.assigned) {
      const sourceButton = element(doc, "button", "station-editor__source-value", {
        type: "button",
        "data-slot": "source"
      });
      writeSourceButton(sourceButton, entry);
      sourceButton.addEventListener("click", () => {
        /* WRITE CONTRACT: setting a source. Hookup sources are the
         * application's; this reports that they cannot be set from here. */
        deps.note(`The source for ${entry.id} is set in the application: Station is read-only in this phase.`);
      });
      row.sourceButton = sourceButton;
      main.appendChild(sourceButton);
    }
    item.appendChild(main);

    /* The percentage: the leading number, right-aligned so the column
     * sums into the total below it. A real input, read-only for now, so
     * its semantics and its place in the Tab order are already right. */
    const pct = element(doc, "div", "station-editor__pct");
    if (entry.assigned) {
      const input = element(doc, "input", "station-editor__pct-input", {
        type: "text",
        inputmode: "decimal",
        readonly: "",
        size: "3",
        "data-slot": "pct",
        "aria-label": `${entry.id} blend percentage`
      });
      input.value = String(round(entry.pct));
      input.addEventListener("keydown", event => {
        // A printable key on a read-only value is an attempt to edit it;
        // say why it does nothing rather than letting it silently not.
        if (event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          deps.note(`${entry.id}'s percentage was not changed: Station is read-only in this phase.`);
        }
      });
      /* Focus in the field is an interaction in progress, even while the
       * field is read-only: a publish must not rewrite a value the
       * operator is looking at with the caret in it. Reported as
       * "typing" so the boot file's record has the shape it will keep. */
      input.addEventListener("focus", () => {
        row.base = row.entry.pct;
        deps.onEditing(editingRecord(state, row, "pct", "typing", input.value, row.base));
      });
      input.addEventListener("blur", () => settleRow(doc, row, state, deps));
      row.pctInput = input;
      pct.appendChild(input);
      pct.appendChild(text(doc, "span", "station-editor__unit", "%", { "aria-hidden": "true" }));
    }
    item.appendChild(pct);
  }

  function buildRow(doc, entry, state, deps) {
    const item = element(doc, "li", "station-editor__item", {
      "data-hopper": entry.id,
      "data-layer": state.layer.id,
      "data-hopper-index": entry.index
    });
    if (deps.selected === entry.id) item.classList.add("is-selected");
    const row = { id: entry.id, index: entry.index, item, search: null, entry, pending: null, base: null };
    fillRow(doc, row, entry, state, deps);
    // Any click in the row selects its hopper - including the clicks that
    // also open a control, since selecting is what the operator means too.
    item.addEventListener("click", () => { if (deps.onSelect) deps.onSelect(entry.id); });
    return row;
  }

  function editingRecord(state, row, slot, mode, draft, baseValue) {
    return {
      layer: state.layer.id,
      index: row.index,
      hopper: row.id,
      slot,
      mode,
      draft: String(draft === undefined || draft === null ? "" : draft),
      baseValue: baseValue === undefined || baseValue === null ? "" : baseValue
    };
  }

  /* Which of a row's slots the operator is in: the search, when it is
   * open, or the slot of the focused control. Null when none. */
  function activeSlotOf(row, deps) {
    if (row.search) return "resin";
    const active = deps.activeElement();
    if (!active || !row.item.contains || !row.item.contains(active)) return null;
    const slot = typeof active.getAttribute === "function" ? active.getAttribute("data-slot") : null;
    return slot || null;
  }

  /* Write an entry's values onto a row's existing controls. `protect`
   * names the slot whose live value must be left alone. */
  function patchRow(doc, row, entry, protect) {
    row.entry = entry;
    row.resin = entry.resin;
    row.item.classList.toggle("is-empty", !entry.assigned);
    writeResinButton(doc, row.resinButton, entry);
    if (row.sourceButton) writeSourceButton(row.sourceButton, entry);
    if (row.pctInput && protect !== "pct") row.pctInput.value = String(round(entry.pct));
  }

  const SLOT_LABEL = { resin: "resin", pct: "percentage", source: "source" };

  function canonicalOf(entry, slot) {
    if (slot === "pct") return entry.pct;
    if (slot === "source") return entry.source;
    return entry.resin;
  }

  function describe(slot, value) {
    if (slot === "pct") return `${round(value)}%`;
    return value ? String(value) : "none";
  }

  /* Bring one row into line with a new entry. A row with no control active
   * is refilled when its shape changes (assigned or not) and patched
   * otherwise. A row with an active control is patched around that
   * control; a shape change is held as `pending` until the control is
   * left; and if the canonical value under the control has moved since
   * the operator started, the row says so rather than moving the draft. */
  function refreshRow(doc, row, entry, state, deps) {
    const active = activeSlotOf(row, deps);
    if (!active) {
      row.item.classList.remove("is-changed-underneath");
      if (entry.assigned !== row.built) fillRow(doc, row, entry, state, deps);
      else patchRow(doc, row, entry, null);
      return;
    }
    patchRow(doc, row, entry, active);
    row.pending = entry.assigned !== row.built ? entry : null;
    const moved = row.base !== null && row.base !== undefined && String(canonicalOf(entry, active)) !== String(row.base);
    row.item.classList.toggle("is-changed-underneath", moved);
    if (moved) {
      deps.note(`${row.id}'s ${SLOT_LABEL[active]} is now ${describe(active, canonicalOf(entry, active))} in the application; what you are entering here has not been changed.`);
    }
  }

  /* The operator has left a row's control: apply any shape change that was
   * held back, or the latest values to the control that was protected;
   * drop the marker; report that nothing is being edited. */
  function settleRow(doc, row, state, deps) {
    row.base = null;
    row.item.classList.remove("is-changed-underneath");
    if (row.pending) {
      const entry = row.pending;
      row.pending = null;
      fillRow(doc, row, entry, state, deps);
    } else if (row.entry) {
      patchRow(doc, row, row.entry, null);
    }
    deps.onEditing(null);
  }

  /* --------------------------------------------------------------------
   *   The editor
   * ------------------------------------------------------------------ */

  function writeTotal(doc, total, blend) {
    clearChildren(total);
    /* A layer with nothing in it is unconfigured, not wrong: its total is
     * shown as none rather than flagged as a bad blend. */
    const empty = blend.assigned.length === 0;
    total.classList.toggle("is-empty", empty);
    total.classList.toggle("is-invalid", !empty && !blend.valid);
    const label = element(doc, "span", "station-editor__total-label");
    label.appendChild(text(doc, "span", null, "Blend total"));
    // The flag sits by the label, so the number stays under its column.
    if (!empty && !blend.valid) {
      label.appendChild(text(doc, "span", "station-editor__total-flag", "≠ 100%", { role: "img", "aria-label": "does not total 100 percent" }));
    }
    total.appendChild(label);
    total.appendChild(text(doc, "span", "station-editor__total-value", empty ? "—" : `${Math.round(blend.total)}%`));
  }

  /**
   * Build the editor for one layer.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {object} options.layer         the line model's layer: id, role, roleLabel, hoppers
   * @param {object} [options.hopperState] runtime state by "<layer>:<index>"
   * @param {function} [options.resins]    () => catalog entries with resin_code
   * @param {string} [options.selected]    the selected hopper's id, if any
   * @param {function} [options.onSelect]  (hopperId) when a row is clicked
   * @param {function} [options.onEditing] (record|null) as the operator
   *        enters and leaves a control; see the header
   * @param {object} [options.commands]    the command bridge, for discovery
   *        only: whether an application is connected to it decides what
   *        the header says
   * @param {function} [options.activeElement] () => the focused element;
   *        defaults to the document's
   * @param {function} [options.measure]   (element) => client rect, for the
   *        result list's placement; defaults to getBoundingClientRect
   * @param {function} [options.bounds]    (row) => the rect the list must
   *        stay inside; defaults to the <foreignObject> the row is drawn in
   * @returns {{ element: Element, blend: object, note: function, update: function }}
   */
  function create(doc, options) {
    const settings = options || {};
    const blend = blendFor(settings.layer, settings.hopperState);
    if (!blend) return null;
    const state = { layer: blend.layer, blend };

    /* The list stays inside the <foreignObject> that carries the editor.
     *
     * Not the stage <svg>, though that is the first thing that clips and the
     * workspace's own overflow is `visible`. Firefox paints foreignObject
     * content past the box only as the box's overflow region stood at the
     * last SVG layout: a list that GROWS past the edge afterwards - which is
     * what typing into the search does - is neither painted nor hit-tested
     * beyond it until something relays out the <svg>, while Chromium keeps
     * up. Placing within the box is the same rule for both engines and
     * leans on no overflow behaviour at all. A row that is not inside a
     * <foreignObject> - the test DOM - has nothing to stay inside, and the
     * placement then reads "fits below". */
    const measureRect = el => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);
    const workspaceBounds = row => {
      let box = null;
      try { box = row.item.closest("foreignObject"); } catch (error) { box = null; }
      return measureRect(box);
    };

    const rootEl = element(doc, "div", "station-editor", {
      "data-layer": blend.layer.id,
      "data-layer-role": blend.layer.role,
      "data-role": "focus-editor"
    });

    // The note is one line under the total, updated in place; aria-live so
    // a screen reader hears why a field did not take the edit.
    const note = text(doc, "p", "station-editor__note", "", { "aria-live": "polite" });
    const deps = {
      resins: typeof settings.resins === "function" ? settings.resins : () => [],
      selected: settings.selected || null,
      onSelect: settings.onSelect,
      onEditing: typeof settings.onEditing === "function" ? settings.onEditing : () => {},
      activeElement: typeof settings.activeElement === "function"
        ? settings.activeElement
        : () => (doc && "activeElement" in doc ? doc.activeElement : null),
      measure: typeof settings.measure === "function" ? settings.measure : measureRect,
      bounds: typeof settings.bounds === "function" ? settings.bounds : workspaceBounds,
      note: message => { note.textContent = message; }
    };

    /* Discovery, not capability: the header reports whether an application
     * has connected to the command bridge. In this phase none has, so the
     * editor reads as read-only wherever it runs - and says which reason. */
    const commands = settings.commands || null;
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());

    const header = element(doc, "header", "station-editor__header");
    const heading = element(doc, "div", "station-editor__heading");
    heading.appendChild(text(doc, "h2", "station-editor__title", `Layer ${blend.layer.id}`));
    heading.appendChild(text(doc, "p", "station-editor__role", String(blend.layer.roleLabel || "")));
    header.appendChild(heading);
    header.appendChild(text(doc, "span", "station-editor__mode", "Read-only", {
      title: connected
        ? "The application is connected to Station commands, but editing from this view is not wired up yet."
        : "No application is connected to Station commands; the state bridge is a one-way window onto the application."
    }));
    rootEl.appendChild(header);

    const list = element(doc, "ol", "station-editor__list", { "aria-label": `Layer ${blend.layer.id} hoppers` });
    const rows = blend.rows.map(entry => buildRow(doc, entry, state, deps));
    for (const row of rows) list.appendChild(row.item);

    /* Arrow keys move between hoppers, staying in the same slot: down from
     * D1's percentage lands on D2's. Not while a search is open - its list
     * owns the arrows then. */
    list.addEventListener("keydown", event => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target;
      const slot = target && target.getAttribute ? target.getAttribute("data-slot") : null;
      if (!slot) return;
      const at = rows.findIndex(row => row.item === (target.closest ? target.closest("[data-hopper]") : null));
      if (at < 0 || rows[at].search) return;
      const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      const focusable = focusableFor(next, slot);
      if (focusable && typeof focusable.focus === "function") {
        event.preventDefault();
        focusable.focus();
      }
    });
    /* Leaving a row by any route settles it: a shape change held back
     * while a button in it had focus is applied once focus is elsewhere. */
    list.addEventListener("focusout", event => {
      const target = event.target;
      const row = rows.find(entry => entry.item === (target && target.closest ? target.closest("[data-hopper]") : null));
      if (!row || row.search) return;
      const to = event.relatedTarget;
      if (to && row.item.contains && row.item.contains(to)) return;
      if (row.pending) settleRow(doc, row, state, deps);
    });
    rootEl.appendChild(list);

    /* The total: persistent, integrated, and flagged only when it is wrong.
     * A valid 100% is the normal state and is not dressed up. */
    const total = element(doc, "footer", "station-editor__total");
    writeTotal(doc, total, blend);
    rootEl.appendChild(total);
    rootEl.appendChild(note);

    /* Apply new canonical values to the rows that exist. See the header:
     * the active control keeps its live value, and a row whose shape must
     * change under an active control waits until the control is left. */
    function update(next) {
      const fresh = blendFor(state.layer, next && next.hopperState);
      if (!fresh) return null;
      state.blend = fresh;
      fresh.rows.forEach((entry, index) => { if (rows[index]) refreshRow(doc, rows[index], entry, state, deps); });
      writeTotal(doc, total, fresh);
      return fresh;
    }

    return { element: rootEl, blend, note: deps.note, update };
  }

  return { RESULT_LIMIT, SLOTS, blendFor, filterResins, placeResults, create };
});
