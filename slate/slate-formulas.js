/* Formulas: the floor's arithmetic, in the Timeline's place.
 *
 * At the top, pounds per thousand feet, worked out the floor's two ways -
 * from the rolls (max roll weight x rolls per set / thousands of feet,
 * the footage typed in feet) and from the film (layflat width x mil x
 * 12 / 15) - each with its own answer, so one checks the other. A "?"
 * beside the first opens what the two formulas are and what the 12 and
 * the 15 mean.
 *
 * The film's way takes an optional product density; left empty it is the
 * floor's 15. Under the entry, one press fills it from Traveler (the last
 * product density given the line rate calculator), Current or Next (the
 * recipe's own, worked out from the catalog). A recipe offers one only
 * when every resin in it has a density; the resins it lacks are named.
 * The figures come from ctx.densities(), read as the panel is shown and
 * as the state changes.
 *
 * Under them, Conversions, folded until it is opened: one row per
 * quantity - pressure, temperature, film thickness, width, length,
 * weight, output - each an entry, the unit it was typed in, and the same
 * figure read in the quantity's other units. Click the unit to say the
 * reading was in another unit instead, and the entry is read again.
 *
 * The arithmetic is the application's own (unit-conversions.js,
 * PolynUnitConversions, which takes pressure from pressure-conversion.js
 * whole), handed in by the boot so this panel cannot work anything out
 * differently. Nothing is computed here, nothing is dispatched, nothing
 * is stored: the entries are the operator's scratch and live as long as
 * the page. The head's close hands the aside back to the Timeline
 * (ctx.back).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateFormulas = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* A press outside, by the shared rule - a finger closes on a still
   * release, a mouse on the press - and the Back key's stack
   * (slate-dismiss.js). */
  function dismissal(target, inside, close) {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.outside === "function" ? shared.outside(target, inside, close) : Object.freeze({ start() {}, stop() {}, isOn: () => false });
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  /* The rail's chevron (slate-rail.js), pointing down; turned to point
   * right while Conversions is folded. */
  const CHEVRON = "M6 8l4 4 4-4";

  const TITLE = "Formulas";
  const CLOSE_LABEL = "Back to the Timeline";
  const UNAVAILABLE = "Formulas are unavailable: the shared arithmetic did not load.";
  const EMPTY = "—";
  const PER_THOUSAND_TITLE = "Pounds per 1,000 ft";
  const PER_THOUSAND_UNIT = "lb / 1,000 ft";
  const CONVERSIONS_TITLE = "Conversions";
  const CONVERSIONS_CAPTION = "Type in one unit, read the others. The unit button changes the unit you type in.";
  const INFO_LABEL = "How these are worked out";
  const FILM_FORMULA = "Width × mil × 12 ÷ 15";
  /* The film's formula for a density: its own divisor in the 15's place. */
  const filmFormula = (divisor, density) => `Width × mil × 12 ÷ ${divisor.toFixed(2)} (at ${density.toFixed(3)} g/cc)`;
  /* The places a density can be filled from, in the order offered. */
  const DENSITY_SOURCES = Object.freeze([
    Object.freeze({ key: "traveler", label: "Traveler" }),
    Object.freeze({ key: "current", label: "Current" }),
    Object.freeze({ key: "next", label: "Next" })
  ]);
  const METHODS = Object.freeze([
    Object.freeze({ key: "rolls", label: "From the rolls", formula: "Roll weight × rolls ÷ (footage ÷ 1,000)" }),
    Object.freeze({ key: "width", label: "From the film", formula: FILM_FORMULA })
  ]);
  /* What the "?" says: a heading and its lines, in order. */
  const INFO = Object.freeze([
    Object.freeze({ heading: "From the rolls", lines: Object.freeze([
      "What the line actually made: the set's weight (the heaviest roll × the rolls wound together) over its length in thousands of feet.",
      "Type the footage in feet; it is divided by 1,000 for you."
    ]) }),
    Object.freeze({ heading: "From the film", lines: Object.freeze([
      "What the film should weigh: width × mil × 12 ÷ 15.",
      "12: a thousand feet is 12,000 inches, and a mil is 0.001 inch, so every inch of width and every mil is 12 cubic inches of film per 1,000 ft.",
      "15: polyethylene near 0.92 density is about 30 cubic inches to the pound. A tube has two walls, so each inch of layflat is two inches of film: 30 ÷ 2 = 15.",
      "12 ÷ 15 is the 0.8 often used as a shortcut."
    ]) }),
    Object.freeze({ heading: "Density", lines: Object.freeze([
      "Leave Density empty for the floor's 12 ÷ 15, which is film at about 0.92.",
      "With a density, the 15 is worked out for it: 13.84 ÷ density - 15.04 at 0.92, 14.57 at 0.95.",
      "Traveler is the last product density given the Line rate calculator. Current and Next are the recipe's own: each resin's density from the resin database, weighted by its share of the film.",
      "A recipe's density is offered only when every resin in it has a density in the database."
    ]) }),
    Object.freeze({ heading: "What it assumes", lines: Object.freeze([
      "Layflat tubing at about 0.92 density - LDPE and LLDPE. A single web (slit sheet) is ÷ 30 instead.",
      "Denser film - HDPE near 0.95, or filled or pigmented film - weighs a few percent more than the formula says."
    ]) })
  ]);

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

  /* The unit after this one, round the quantity's list. */
  function nextOf(quantity, from) {
    const units = quantity.units;
    const at = units.findIndex(one => one.key === from);
    return units[(at + 1) % units.length].key;
  }

  /**
   * What a conversion row reads for an entry: the figure in each other
   * unit, or the application's own refusal. Pure, so the wording is
   * tested.
   *
   * @returns {{answer: string, error: string, result: object|null}}
   */
  function readingFor(conversions, quantityKey, value, from) {
    if (!conversions) return { answer: EMPTY, error: UNAVAILABLE, result: null };
    if (typeof value !== "string" || !value.trim()) return { answer: EMPTY, error: "", result: null };
    const result = conversions.convert({ quantity: quantityKey, value, from });
    if (!result.valid) return { answer: EMPTY, error: result.errors[0] || "", result: null };
    const quantity = conversions.quantityOf(quantityKey);
    const answer = quantity.units
      .filter(one => one.key !== from)
      .map(one => `${conversions.format(result.values[one.key], quantityKey, one.key)} ${one.label}`)
      .join(" · ");
    return { answer, error: "", result };
  }

  /**
   * What one way of working out pounds per thousand feet reads: nothing
   * until every entry is in, then the answer or the application's
   * refusal. Pure.
   *
   * @returns {{answer: string, error: string, result: object|null}}
   */
  function perThousandFor(conversions, method, entries, sourceLabel) {
    if (!conversions) return { answer: EMPTY, error: UNAVAILABLE, result: null };
    const fields = conversions.PER_THOUSAND[method] || [];
    const values = entries || {};
    if (fields.some(field => !field.optional && (typeof values[field.key] !== "string" || !values[field.key].trim()))) return { answer: EMPTY, error: "", result: null };
    const result = conversions.poundsPerThousand(method, values);
    if (!result.valid) return { answer: EMPTY, error: result.errors[0] || "", result: null };
    let answer = `${conversions.formatPerThousand(result.lbPerThousand)} ${PER_THOUSAND_UNIT}`;
    if (typeof result.density === "number") answer += ` at ${result.density.toFixed(3)} g/cc${sourceLabel ? ` (${sourceLabel})` : ""}`;
    return { answer, error: "", result };
  }

  /* "0.923": a density as it is written, three places. */
  function format(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(3) : EMPTY;
  }

  /* Why a source offers nothing: none entered, nothing planned, or the
   * resins with no density - named, so the database can be filled in. */
  const NO_CATALOG = "The resin database has not loaded, so no recipe density.";
  function reasonFor(key, offered) {
    if (!offered || offered.density !== null) return "";
    if (offered.noCatalog) return NO_CATALOG;
    if (Array.isArray(offered.missing) && offered.missing.length) {
      return `${key === "next" ? "Next" : "Current"}: no density for ${offered.missing.join(", ")}.`;
    }
    return "";
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.conversions   PolynUnitConversions, or null when it did not load
   * @param {function} [ctx.back]           hands the aside back to the Timeline
   * @param {function} [ctx.densities]      () -> { traveler, current, next }, each
   *        { density: number|null, missing?: string[], noCatalog?: boolean } - the densities
   *        the film's entry can be filled from
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const conversions = settings.conversions || null;
    const back = typeof settings.back === "function" ? settings.back : () => {};
    // Under a finger nothing pops the keyboard unasked (slate/slate-tier.js).
    const touch = () => {
      try { return typeof settings.tier === "function" && settings.tier().input === "touch"; } catch (error) { return false; }
    };

    const rootEl = element(doc, "section", "slate-panel slate-formulas", { "aria-label": TITLE });
    const head = element(doc, "div", "slate-panel__head");
    head.appendChild(text(doc, "h2", "slate-panel__title", TITLE));
    const close = element(doc, "button", "slate-panel__close", { type: "button", "aria-label": CLOSE_LABEL, title: CLOSE_LABEL, "data-slate-back": "" });
    close.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    head.appendChild(close);
    rootEl.appendChild(head);
    // Between the head and the foot, the part that scrolls on a short
    // screen or with Conversions open, as the other tools' bodies do.
    const scroller = element(doc, "div", "slate-formulas__body");
    rootEl.appendChild(scroller);

    /* ---- Pounds per thousand feet ---- */
    const methods = [];
    let info = null;
    if (conversions) {
      const block = element(doc, "div", "slate-formulas__per-thousand", { "data-calc": "per-thousand" });
      block.appendChild(text(doc, "span", "slate-formulas__label", PER_THOUSAND_TITLE));
      for (const method of METHODS) {
        const group = element(doc, "div", "slate-formulas__method", { "data-method": method.key });
        const titleRow = element(doc, "div", "slate-formulas__method-head");
        titleRow.appendChild(text(doc, "span", "slate-formulas__method-title", method.label));
        if (!info) {
          info = buildInfo();
          titleRow.appendChild(info.wrap);
        }
        group.appendChild(titleRow);
        group.appendChild(text(doc, "p", "slate-formulas__formula", method.formula));
        const inputs = {};
        for (const field of conversions.PER_THOUSAND[method.key]) {
          const row = element(doc, "div", "slate-formulas__field", { "data-field": field.key });
          row.appendChild(text(doc, "span", "slate-formulas__field-label", field.label));
          const input = element(doc, "input", "slate-formulas__field-input", {
            type: "text", inputmode: field.whole ? "numeric" : "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
            "data-method": method.key, "data-field": field.key, "aria-label": field.unit ? `${field.label} (${field.unit})` : field.label
          });
          if (field.optional) input.setAttribute("placeholder", "optional");
          row.appendChild(input);
          row.appendChild(text(doc, "span", "slate-formulas__field-unit", field.unit));
          group.appendChild(row);
          inputs[field.key] = input;
        }
        const formula = group.querySelector(".slate-formulas__formula");
        // The density's sources: a press fills the entry.
        let sources = null;
        if (inputs.density) {
          sources = { row: element(doc, "div", "slate-formulas__sources", { role: "group", "aria-label": "Fill the density from" }), chips: {}, note: null };
          for (const one of DENSITY_SOURCES) {
            const chip = element(doc, "button", "slate-formulas__source", { type: "button", "data-source": one.key });
            chip.appendChild(text(doc, "span", "slate-formulas__source-label", one.label));
            chip.appendChild(text(doc, "span", "slate-formulas__source-value", EMPTY));
            sources.row.appendChild(chip);
            sources.chips[one.key] = chip;
          }
          group.appendChild(sources.row);
          sources.note = element(doc, "p", "slate-formulas__sources-note", { hidden: "" });
          group.appendChild(sources.note);
        }
        const answer = text(doc, "p", "slate-formulas__answer", EMPTY, { "aria-live": "polite" });
        group.appendChild(answer);
        const note = element(doc, "p", "slate-formulas__note", { role: "status", hidden: "" });
        group.appendChild(note);
        block.appendChild(group);
        const state = { method, group, inputs, answer, note, formula, sources, source: null, result: null };
        methods.push(state);
        for (const key of Object.keys(inputs)) {
          inputs[key].addEventListener("input", () => {
            // A density typed over a filled one is the operator's own.
            if (key === "density") state.source = null;
            computeMethod(state);
          });
        }
        if (sources) {
          for (const one of DENSITY_SOURCES) {
            sources.chips[one.key].addEventListener("click", () => {
              const offered = densityOf(one.key);
              if (!offered || offered.density === null) return;
              inputs.density.value = format(offered.density);
              state.source = one.key;
              computeMethod(state);
            });
          }
        }
      }
      scroller.appendChild(block);
    }

    /* ---- The "?": what the formulas are, opening left and down ----
     * The note hangs from the panel, not from the button: inside the
     * scrolling body it would be cut at the body's edge. It spans the
     * panel's inner width and drops from just under the button, measured
     * as it opens; the body scrolling under it closes it. */
    function buildInfo() {
      const wrap = element(doc, "div", "slate-formulas__info");
      const button = element(doc, "button", "slate-formulas__info-button", {
        type: "button", "aria-expanded": "false", "aria-label": INFO_LABEL, title: INFO_LABEL, "data-slate-info": ""
      });
      button.appendChild(text(doc, "span", "slate-formulas__info-glyph", "?", { "aria-hidden": "true" }));
      wrap.appendChild(button);
      const pop = element(doc, "div", "slate-formulas__info-pop", { role: "note", "aria-label": INFO_LABEL, hidden: "" });
      for (const part of INFO) {
        pop.appendChild(text(doc, "h3", "slate-formulas__info-heading", part.heading));
        for (const line of part.lines) pop.appendChild(text(doc, "p", "slate-formulas__info-line", line));
      }
      rootEl.appendChild(pop);
      let open = false;
      const outside = dismissal(doc, node => wrap.contains(node) || pop.contains(node), () => hide());
      // Measured against what the note is laid out from: the sticky panel,
      // or on a tablet's drawer, where the panel is static, the aside.
      function place() {
        const anchor = pop.offsetParent;
        if (!anchor || typeof button.getBoundingClientRect !== "function" || typeof anchor.getBoundingClientRect !== "function") return;
        pop.style.top = `${Math.round(button.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top + 4)}px`;
      }
      function reveal() {
        if (open) return;
        open = true;
        show(pop, true);
        place();
        button.setAttribute("aria-expanded", "true");
        outside.start();
      }
      function hide() {
        if (!open) return;
        open = false;
        show(pop, false);
        button.setAttribute("aria-expanded", "false");
        outside.stop();
      }
      button.addEventListener("click", () => { if (open) hide(); else reveal(); });
      const escape = event => {
        if (event && event.key === "Escape" && open) {
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          hide();
          if (typeof button.focus === "function") button.focus();
        }
      };
      wrap.addEventListener("keydown", escape);
      pop.addEventListener("keydown", escape);
      scroller.addEventListener("scroll", () => hide());
      return { wrap, button, pop, reveal, hide, isOpen: () => open };
    }

    /* ---- Conversions, folded until opened ---- */
    const fold = element(doc, "div", "slate-formulas__fold", { "data-fold": "conversions" });
    const toggle = element(doc, "button", "slate-formulas__toggle", { type: "button", "aria-expanded": "false", "data-slate-fold": "" });
    toggle.appendChild(text(doc, "span", "slate-formulas__toggle-label", CONVERSIONS_TITLE));
    const chevron = doc.createElementNS(SVG_NS, "svg");
    chevron.setAttribute("class", "slate-formulas__toggle-chevron");
    chevron.setAttribute("viewBox", "0 0 20 20");
    chevron.setAttribute("aria-hidden", "true");
    chevron.setAttribute("focusable", "false");
    const chevronPath = doc.createElementNS(SVG_NS, "path");
    chevronPath.setAttribute("d", CHEVRON);
    chevronPath.setAttribute("fill", "none");
    chevronPath.setAttribute("stroke", "currentColor");
    chevronPath.setAttribute("stroke-width", "1.6");
    chevronPath.setAttribute("stroke-linecap", "round");
    chevronPath.setAttribute("stroke-linejoin", "round");
    chevron.appendChild(chevronPath);
    toggle.appendChild(chevron);
    fold.appendChild(toggle);
    const body = element(doc, "div", "slate-formulas__fold-body", { hidden: "" });
    body.appendChild(text(doc, "p", "slate-formulas__caption", CONVERSIONS_CAPTION));
    const list = element(doc, "div", "slate-formulas__list");
    body.appendChild(list);
    fold.appendChild(body);
    scroller.appendChild(fold);
    let unfolded = false;
    function setFolded(folded) {
      unfolded = !folded;
      show(body, unfolded);
      toggle.setAttribute("aria-expanded", unfolded ? "true" : "false");
      fold.classList.toggle("is-open", unfolded);
    }
    toggle.addEventListener("click", () => setFolded(unfolded));

    const rows = [];
    // A row is a div, not a label: the host's legacy sheet styles bare
    // labels. The input carries its own name.
    for (const quantity of conversions ? conversions.QUANTITIES : []) {
      const row = element(doc, "div", "slate-formulas__row", { "data-quantity": quantity.key });
      row.appendChild(text(doc, "span", "slate-formulas__label", quantity.label));
      const entry = element(doc, "div", "slate-formulas__entry");
      const input = element(doc, "input", "slate-formulas__input", {
        type: "text", inputmode: quantity.signed ? "text" : "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
        "data-quantity": quantity.key
      });
      entry.appendChild(input);
      const chip = element(doc, "button", "slate-formulas__unit", { type: "button", "data-slate-unit": "" });
      entry.appendChild(chip);
      row.appendChild(entry);
      const answer = text(doc, "p", "slate-formulas__answer", EMPTY, { "aria-live": "polite" });
      row.appendChild(answer);
      const note = element(doc, "p", "slate-formulas__note", { role: "status", hidden: "" });
      row.appendChild(note);
      list.appendChild(row);

      const state = { quantity, row, input, chip, answer, note, from: quantity.units[0].key, result: null };
      rows.push(state);
      input.addEventListener("input", () => compute(state));
      chip.addEventListener("click", () => {
        state.from = nextOf(quantity, state.from);
        paintUnit(state);
        compute(state);
        if (!touch() && typeof input.focus === "function") input.focus();
      });
      if (!conversions.available(quantity.key)) input.setAttribute("disabled", "");
    }

    const status = element(doc, "p", "slate-formulas__note", { role: "status", hidden: "" });
    scroller.appendChild(status);
    const foot = element(doc, "div", "slate-formulas__foot");
    const clear = text(doc, "button", "slate-formulas__clear", "Clear", { type: "button", "data-slate-clear": "" });
    foot.appendChild(clear);
    rootEl.appendChild(foot);

    function paintUnit(state) {
      const typed = conversions.unitOf(state.quantity, state.from);
      const next = conversions.unitOf(state.quantity, nextOf(state.quantity, state.from));
      state.row.setAttribute("data-from", state.from);
      state.chip.textContent = typed.label;
      const words = `Typed in ${typed.label}. Click to type in ${next.label}.`;
      state.chip.setAttribute("aria-label", words);
      state.chip.setAttribute("title", words);
      state.input.setAttribute("aria-label", `${state.quantity.label} in ${typed.label}`);
    }

    function compute(state) {
      const reading = readingFor(conversions, state.quantity.key, state.input.value, state.from);
      state.result = reading.result;
      state.answer.textContent = reading.answer;
      state.row.classList.toggle("is-answered", !!reading.result);
      state.note.textContent = reading.error;
      show(state.note, !!reading.error);
      if (reading.error) state.input.setAttribute("aria-invalid", "true");
      else state.input.removeAttribute("aria-invalid");
      return reading;
    }

    function computeMethod(state) {
      const entries = {};
      for (const key of Object.keys(state.inputs)) entries[key] = state.inputs[key].value;
      const label = state.source ? (DENSITY_SOURCES.find(one => one.key === state.source) || {}).label : "";
      const reading = perThousandFor(conversions, state.method.key, entries, label);
      if (state.formula && state.method.key === "width") {
        const r = reading.result;
        state.formula.textContent = r && typeof r.density === "number" ? filmFormula(r.divisor, r.density) : FILM_FORMULA;
      }
      state.result = reading.result;
      state.answer.textContent = reading.answer;
      state.group.classList.toggle("is-answered", !!reading.result);
      state.note.textContent = reading.error;
      show(state.note, !!reading.error);
      return reading;
    }

    /* ---- The density's sources ---- */
    let offered = {};
    function densityOf(key) {
      return offered[key] || null;
    }
    function paintSources() {
      try { offered = typeof settings.densities === "function" ? (settings.densities() || {}) : {}; } catch (error) { offered = {}; }
      for (const state of methods) {
        if (!state.sources) continue;
        const reasons = [];
        for (const one of DENSITY_SOURCES) {
          const chip = state.sources.chips[one.key];
          const source = densityOf(one.key);
          const has = !!source && typeof source.density === "number";
          chip.querySelector(".slate-formulas__source-value").textContent = has ? format(source.density) : EMPTY;
          if (has) chip.removeAttribute("disabled");
          else chip.setAttribute("disabled", "");
          const reason = reasonFor(one.key, source);
          if (reason && !reasons.includes(reason)) reasons.push(reason);
          const words = has
            ? `Use ${format(source.density)} g/cc, the ${one.key === "traveler" ? "traveler's density" : `${one.label} recipe's density`}`
            : (reason || (one.key === "traveler" ? "No traveler density given the Line rate calculator yet" : one.key === "next" ? "Nothing planned" : "No current recipe"));
          chip.setAttribute("title", words);
          chip.setAttribute("aria-label", `${one.label}: ${words}`);
        }
        state.sources.note.textContent = reasons.join(" ");
        show(state.sources.note, reasons.length > 0);
      }
    }

    function focusFirst() {
      const first = methods.length ? methods[0].inputs[Object.keys(methods[0].inputs)[0]] : null;
      if (first && !touch() && typeof first.focus === "function") first.focus();
    }

    function reset() {
      for (const state of methods) {
        for (const key of Object.keys(state.inputs)) state.inputs[key].value = "";
        state.source = null;
        computeMethod(state);
      }
      for (const state of rows) {
        state.input.value = "";
        state.from = state.quantity.units[0].key;
        paintUnit(state);
        compute(state);
      }
      focusFirst();
    }

    clear.addEventListener("click", reset);
    close.addEventListener("click", () => { if (info) info.hide(); back(); });

    if (!conversions) {
      status.textContent = UNAVAILABLE;
      show(status, true);
      clear.setAttribute("disabled", "");
      toggle.setAttribute("disabled", "");
    }
    for (const state of rows) { paintUnit(state); compute(state); }
    for (const state of methods) computeMethod(state);
    paintSources();

    const find = key => rows.find(state => state.quantity.key === key) || null;
    return Object.freeze({
      element: rootEl,
      onShow() { paintSources(); focusFirst(); },
      // A new state: the recipes' densities may have moved.
      update() { paintSources(); },
      reset,
      from: key => (find(key) ? find(key).from : null),
      result: key => (find(key) ? find(key).result : null),
      perThousand: method => { const state = methods.find(one => one.method.key === method); return state ? state.result : null; },
      isFolded: () => !unfolded,
      setFolded,
      isInfoOpen: () => !!(info && info.isOpen())
    });
  }

  return Object.freeze({
    TITLE, CLOSE_LABEL, UNAVAILABLE, EMPTY, PER_THOUSAND_TITLE, PER_THOUSAND_UNIT, CONVERSIONS_TITLE, CONVERSIONS_CAPTION,
    INFO_LABEL, INFO, METHODS, FILM_FORMULA, DENSITY_SOURCES, NO_CATALOG, nextOf, readingFor, perThousandFor, reasonFor, create
  });
});
