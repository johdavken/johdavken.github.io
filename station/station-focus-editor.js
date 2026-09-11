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
 * onto the application, and there is no write contract. So the structure
 * here is the structure we intend to keep - the fields, their semantics,
 * their focus order, the search - but nothing commits: a resin chosen from
 * the search, or a key pressed on a percentage, is answered with a note
 * saying it was not applied, and the row keeps showing what the bridge
 * says. There is no pending state held anywhere, because a value that looks
 * saved and is not is worse than no field at all. When the write contract
 * exists it plugs in at the two places marked WRITE CONTRACT below.
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
      closeSearch(row);
      /* WRITE CONTRACT: this is where a chosen resin would be handed to the
       * application. There is no such hand-off yet, and nothing is held
       * back here as if there were; the row keeps showing what the bridge
       * says, and the note says why. */
      deps.note(`${entry.resin_code} for ${row.id} was not applied: Station is read-only in this phase.`);
    }

    input.addEventListener("input", () => { search.active = 0; renderResults(); position(); });
    input.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") { event.preventDefault(); move(1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); move(-1); return; }
      if (event.key === "Enter") {
        event.preventDefault();
        if (search.active >= 0 && search.matches[search.active]) choose(search.matches[search.active]);
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(row); }
    });
    // Leaving the search by any other means (Tab, a click elsewhere) closes
    // it; the listbox options refuse focus, so a click on one stays inside.
    input.addEventListener("blur", event => {
      const to = event.relatedTarget;
      if (to && results.contains && results.contains(to)) return;
      closeSearch(row, { keepFocus: true });
    });

    search.active = 0;
    renderResults();
    position();
    if (typeof input.focus === "function") input.focus();
    if (typeof input.select === "function") input.select();
  }

  function closeSearch(row, options) {
    const search = row.search;
    if (!search) return;
    row.search = null;
    row.item.classList.remove("is-searching");
    row.resinBlock.removeChild(search.input);
    row.resinBlock.removeChild(search.results);
    row.resinButton.removeAttribute("hidden");
    row.resinButton.setAttribute("aria-expanded", "false");
    if (!(options && options.keepFocus) && typeof row.resinButton.focus === "function") row.resinButton.focus();
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

  function buildRow(doc, entry, state, deps) {
    const item = element(doc, "li", "station-editor__item", {
      "data-hopper": entry.id,
      "data-layer": state.layer.id,
      "data-hopper-index": entry.index
    });
    if (!entry.assigned) item.classList.add("is-empty");
    if (deps.selected === entry.id) item.classList.add("is-selected");

    const row = { id: entry.id, index: entry.index, resin: entry.resin, item, search: null };

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
      "aria-expanded": "false",
      "aria-label": entry.resin ? `${entry.id} resin, ${entry.resin}` : `Add resin to ${entry.id}`
    });
    if (entry.resin) {
      resinButton.textContent = entry.resin;
    } else {
      resinButton.classList.add("is-placeholder");
      resinButton.appendChild(text(doc, "span", "station-editor__glyph", "+", { "aria-hidden": "true" }));
      resinButton.appendChild(text(doc, "span", null, "Add resin"));
    }
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
        "data-slot": "source",
        "aria-label": entry.source ? `${entry.id} source, ${entry.source}` : `Add source for ${entry.id}`
      });
      if (entry.source) {
        sourceButton.textContent = entry.source;
      } else {
        sourceButton.classList.add("is-placeholder");
        sourceButton.textContent = "Add source";
      }
      sourceButton.addEventListener("click", () => {
        /* WRITE CONTRACT: setting a source. Hookup sources are the
         * application's; this reports that they cannot be set from here. */
        deps.note(`The source for ${entry.id} is set in the application: Station is read-only in this phase.`);
      });
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
      pct.appendChild(input);
      pct.appendChild(text(doc, "span", "station-editor__unit", "%", { "aria-hidden": "true" }));
    }
    item.appendChild(pct);

    // Any click in the row selects its hopper - including the clicks that
    // also open a control, since selecting is what the operator means too.
    item.addEventListener("click", () => { if (deps.onSelect) deps.onSelect(entry.id); });

    return row;
  }

  /* --------------------------------------------------------------------
   *   The editor
   * ------------------------------------------------------------------ */

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
   * @param {function} [options.measure]   (element) => client rect, for the
   *        result list's placement; defaults to getBoundingClientRect
   * @param {function} [options.bounds]    (row) => the rect the list must
   *        stay inside; defaults to the <foreignObject> the row is drawn in
   * @returns {{ element: Element, blend: object, note: function }}
   */
  function create(doc, options) {
    const settings = options || {};
    const blend = blendFor(settings.layer, settings.hopperState);
    if (!blend) return null;
    const state = { layer: blend.layer };

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
      measure: typeof settings.measure === "function" ? settings.measure : measureRect,
      bounds: typeof settings.bounds === "function" ? settings.bounds : workspaceBounds,
      note: message => { note.textContent = message; }
    };

    const header = element(doc, "header", "station-editor__header");
    const heading = element(doc, "div", "station-editor__heading");
    heading.appendChild(text(doc, "h2", "station-editor__title", `Layer ${blend.layer.id}`));
    heading.appendChild(text(doc, "p", "station-editor__role", String(blend.layer.roleLabel || "")));
    header.appendChild(heading);
    header.appendChild(text(doc, "span", "station-editor__mode", "Read-only", {
      title: "The Station state bridge is a one-way window onto the application; nothing here can be written back yet."
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
    rootEl.appendChild(list);

    /* The total: persistent, integrated, and flagged only when it is wrong.
     * A valid 100% is the normal state and is not dressed up. */
    const total = element(doc, "footer", "station-editor__total");
    /* A layer with nothing in it is unconfigured, not wrong: its total is
     * shown as none rather than flagged as a bad blend. */
    const empty = blend.assigned.length === 0;
    if (empty) total.classList.add("is-empty");
    else if (!blend.valid) total.classList.add("is-invalid");
    const label = element(doc, "span", "station-editor__total-label");
    label.appendChild(text(doc, "span", null, "Blend total"));
    // The flag sits by the label, so the number stays under its column.
    if (!empty && !blend.valid) {
      label.appendChild(text(doc, "span", "station-editor__total-flag", "≠ 100%", { role: "img", "aria-label": "does not total 100 percent" }));
    }
    total.appendChild(label);
    total.appendChild(text(doc, "span", "station-editor__total-value", empty ? "—" : `${Math.round(blend.total)}%`));
    rootEl.appendChild(total);
    rootEl.appendChild(note);

    return { element: rootEl, blend, note: deps.note };
  }

  return { RESULT_LIMIT, SLOTS, blendFor, filterResins, placeResults, create };
});
