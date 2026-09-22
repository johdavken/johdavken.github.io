/* The resin cell's editor: a combobox over the resin catalog.
 *
 * The search itself is pure (filterResins, optionsFor): codes that start
 * with what was typed, then codes that contain it, catalog order, a few
 * at a time. The application accepts any code the operator types (the
 * contract has no catalog check, so a resin the catalog does not know
 * yet still loads), so a query that matches nothing exactly is offered
 * back as its own last option - "Use 'XYZ' as typed". An emptied field
 * chooses "" and the caller clears the hopper.
 *
 * Two ways in. `open` is the inline editor's: a combobox that stands in
 * for a cell, chooses once and leaves (a blur cancels). `attach` is the
 * bulk edit's: a list under a field that stays - it shows while typing,
 * a blur only hides it and the text stands, so a form of many fields
 * can be tabbed through without losing what was typed.
 *
 * Dispatches nothing: the caller is told what was chosen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateResinSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RESULT_LIMIT = 8;
  /* Under a finger the list is shorter, so it fits above the keyboard. */
  const TOUCH_LIMIT = 5;
  const CANCEL_LABEL = "Cancel";
  const CODE_MAX = 100;
  const NO_CATALOG = "No catalog on this page";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function normalize(value) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  }

  function codeOf(resin) {
    return normalize(resin && (resin.resin_code || resin.code || resin));
  }

  /** Codes starting with the query first, then codes containing it. */
  function filterResins(catalog, query, limit) {
    const list = Array.isArray(catalog) ? catalog : [];
    const needle = normalize(query).toLowerCase();
    const max = Number.isInteger(limit) && limit > 0 ? limit : RESULT_LIMIT;
    if (!needle) return list.slice(0, max);
    const starts = [];
    const contains = [];
    for (const resin of list) {
      const code = codeOf(resin).toLowerCase();
      if (!code) continue;
      if (code.startsWith(needle)) starts.push(resin);
      else if (code.includes(needle)) contains.push(resin);
    }
    return starts.concat(contains).slice(0, max);
  }

  function densityNote(resin) {
    const density = resin && Number(resin.density_g_cm3);
    return Number.isFinite(density) && density > 0 ? `${density.toFixed(3)} g/cm³` : "";
  }

  /** The options a query earns: the matches, then the typed code itself
   * when nothing matches it exactly. */
  function optionsFor(catalog, query, limit) {
    const typed = normalize(query);
    const options = filterResins(catalog, typed, limit).map(resin => ({ code: codeOf(resin), note: densityNote(resin), custom: false }));
    if (typed && typed.length <= CODE_MAX && !options.some(option => option.code.toLowerCase() === typed.toLowerCase())) {
      options.push({ code: typed, note: "Use as typed", custom: true });
    }
    return options;
  }

  /* The list's items for a query's options, the active one marked and
   * named on the input; the empty line when there are none. Shared by
   * the inline combobox and the attached list. Returns the active index
   * as painted (-1 when nothing is listed). */
  function paint(doc, list, input, base, options2, active, noCatalog, choose) {
    while (list.firstChild) list.removeChild(list.firstChild);
    if (options2.length === 0) {
      list.appendChild(text(doc, "li", "slate-combobox__empty", noCatalog ? NO_CATALOG : "No matching resin", { role: "presentation" }));
      input.removeAttribute("aria-activedescendant");
      return -1;
    }
    const at = active < 0 || active >= options2.length ? 0 : active;
    options2.forEach((option, index) => {
      const item = element(doc, "li", `slate-combobox__option${option.custom ? " is-custom" : ""}`, {
        role: "option", id: `${base}-option-${index}`, "data-resin": option.code, "aria-selected": index === at ? "true" : "false"
      });
      if (index === at) item.classList.add("is-active");
      item.appendChild(text(doc, "span", "slate-combobox__code", option.custom ? `Use ‘${option.code}’ as typed` : option.code));
      if (option.note && !option.custom) item.appendChild(text(doc, "span", "slate-combobox__note", option.note));
      // Keep the input's focus through the press, so blur cannot close
      // the list before the click chooses.
      item.addEventListener("mousedown", event => { if (event && typeof event.preventDefault === "function") event.preventDefault(); });
      // A finger or a pen chooses on release, so the choice never depends
      // on the compatibility mouse events a touch may not produce. The
      // click that follows is then spent, not a second choice.
      let taken = false;
      item.addEventListener("pointerup", event => {
        if (!event || !event.pointerType || event.pointerType === "mouse") return;
        taken = true;
        choose(option.code);
      });
      item.addEventListener("click", () => {
        if (taken) { taken = false; return; }
        choose(option.code);
      });
      list.appendChild(item);
    });
    input.setAttribute("aria-activedescendant", `${base}-option-${at}`);
    return at;
  }

  /* Under a finger, a list with no room below its field - the keyboard
   * up, the page's end - stands above it (is-above). Measured against the
   * visual viewport, which the keyboard shrinks; the layout viewport does
   * not move. Returns the re-place and the stop for its listener. */
  function keepInView(view, input, list) {
    const viewport = view && view.visualViewport ? view.visualViewport : null;
    function place() {
      try {
        if (typeof input.getBoundingClientRect !== "function" || typeof list.getBoundingClientRect !== "function") return;
        const bottom = viewport ? viewport.offsetTop + viewport.height : Number(view && view.innerHeight);
        if (!Number.isFinite(bottom) || bottom <= 0) return;
        const field = input.getBoundingClientRect();
        const height = list.getBoundingClientRect().height;
        const top = viewport ? viewport.offsetTop : 0;
        list.classList.toggle("is-above", field.bottom + height > bottom && field.top - height >= top);
      } catch (error) {
        /* placement is a courtesy */
      }
    }
    place();
    if (viewport && typeof viewport.addEventListener === "function") {
      viewport.addEventListener("resize", place);
      return { place, stop: () => viewport.removeEventListener("resize", place) };
    }
    return { place, stop: () => {} };
  }

  /**
   * Open the combobox inside `host`.
   *
   * @param {Document} doc
   * @param {Element} host
   * @param {object} options
   * @param {string} [options.value]       the current code
   * @param {function} options.resins      () => the catalog
   * @param {function} options.onChoose    (code) - "" for an emptied field
   * @param {function} options.onCancel
   * @param {string} [options.label]
   * @param {string} [options.id]          the listbox id base
   * @param {Node} [options.before]        where in `host` the combobox stands (appended by default)
   * @param {boolean} [options.touch]      drawn for a finger: a shorter list kept in view, a
   *                                       Cancel button, and a blur that does NOT cancel - the
   *                                       keyboard's own hide key blurs the field
   * @param {Window} [options.view]        the window, for keeping the list in view
   */
  function open(doc, host, options) {
    const settings = options || {};
    const resins = typeof settings.resins === "function" ? settings.resins : () => [];
    const onChoose = typeof settings.onChoose === "function" ? settings.onChoose : () => {};
    const onCancel = typeof settings.onCancel === "function" ? settings.onCancel : () => {};
    const base = settings.id || "slate-resin";

    const wrapper = element(doc, "div", "slate-combobox");
    const input = element(doc, "input", "slate-combobox__input", {
      type: "text",
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": "true",
      "aria-controls": `${base}-list`,
      "aria-label": settings.label || "Resin",
      autocomplete: "off",
      spellcheck: "false",
      autocapitalize: "characters",
      enterkeyhint: "done",
      maxlength: String(CODE_MAX)
    });
    input.value = normalize(settings.value);
    const touch = !!settings.touch;
    const limit = touch ? TOUCH_LIMIT : RESULT_LIMIT;
    const list = element(doc, "ul", "slate-combobox__list", { role: "listbox", id: `${base}-list` });
    wrapper.appendChild(input);
    let cancelButton = null;
    if (touch) {
      cancelButton = text(doc, "button", "slate-editor-cancel", "×", { type: "button", "aria-label": CANCEL_LABEL, title: CANCEL_LABEL, "data-slate-cancel": "" });
      // The press keeps the field's focus, as an option's does.
      cancelButton.addEventListener("pointerdown", event => { if (event && typeof event.preventDefault === "function") event.preventDefault(); });
      cancelButton.addEventListener("mousedown", event => { if (event && typeof event.preventDefault === "function") event.preventDefault(); });
      cancelButton.addEventListener("click", () => cancel());
      wrapper.appendChild(cancelButton);
    }
    wrapper.appendChild(list);
    // Placed before the input takes focus: moving a focused field afterwards
    // blurs it, and the blur would close the search it just opened.
    if (settings.before && typeof host.insertBefore === "function") host.insertBefore(wrapper, settings.before);
    else host.appendChild(wrapper);

    let options2 = [];
    let active = -1;
    let closed = false;
    let catalog = null;
    let placement = null;

    function catalogNow() {
      if (catalog === null) {
        let list2;
        try { list2 = resins(); } catch (error) { list2 = []; }
        catalog = Array.isArray(list2) ? list2 : [];
      }
      return catalog;
    }

    function render() {
      options2 = optionsFor(catalogNow(), input.value, limit);
      active = paint(doc, list, input, base, options2, active, catalogNow().length === 0, choose);
      if (placement) placement.place();
    }

    function close() {
      if (closed) return;
      closed = true;
      if (placement) placement.stop();
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    }

    function choose(code) {
      if (closed) return;
      close();
      onChoose(normalize(code));
    }

    function cancel() {
      if (closed) return;
      close();
      onCancel();
    }

    input.addEventListener("input", () => { active = 0; render(); });
    input.addEventListener("keydown", event => {
      if (!event) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (options2.length === 0) return;
        active = event.key === "ArrowDown" ? (active + 1) % options2.length : (active - 1 + options2.length) % options2.length;
        render();
      } else if (event.key === "Enter") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (normalize(input.value) === "") choose("");
        else if (active >= 0 && options2[active]) choose(options2[active].code);
      } else if (event.key === "Escape") {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        cancel();
      }
    });
    input.addEventListener("blur", event => {
      // Under a finger a blur is the keyboard going down, an app switch, a
      // notification: the editor stays; Cancel, Escape or a choice end it.
      if (touch) return;
      const related = event && event.relatedTarget;
      if (related && typeof list.contains === "function" && list.contains(related)) return;
      cancel();
    });

    render();
    if (touch) placement = keepInView(settings.view || null, input, list);
    if (typeof input.focus === "function") input.focus();
    if (typeof input.select === "function") input.select();

    return Object.freeze({
      element: wrapper,
      input,
      list,
      close,
      isOpen: () => !closed,
      options: () => options2.slice(),
      active: () => active,
      cancelButton
    });
  }

  /**
   * A suggestion list under a field that stays: the bulk edit's.
   *
   * The list shows on typing (and on ArrowDown), never on focus alone, so
   * a form can be tabbed through quietly. ↑/↓ move; Enter with the list
   * open takes the active option into the field, hides the list, tells
   * the caller, and is spent (the key never reaches the form's own
   * handler); Escape hides the list and is spent; a blur hides it and
   * the text stands. Tab is never taken - what was typed is the code.
   * An emptied field with the list open chooses "" as `open` does.
   *
   * @param {Document} doc
   * @param {Element} input             the field, already in the page
   * @param {object} options
   * @param {function} options.resins   () => the catalog
   * @param {function} [options.onChoose]  (code) after the field took it
   * @param {Element} [options.host]    where the list stands (the field's parent by default)
   * @param {string} [options.id]       the listbox id base
   * @param {boolean} [options.touch]   a shorter list, kept in view above the keyboard
   * @param {Window} [options.view]     the window, for keeping the list in view
   */
  function attach(doc, input, options) {
    const settings = options || {};
    const touch = !!settings.touch;
    const limit = touch ? TOUCH_LIMIT : RESULT_LIMIT;
    let placement = null;
    const resins = typeof settings.resins === "function" ? settings.resins : () => [];
    const onChoose = typeof settings.onChoose === "function" ? settings.onChoose : () => {};
    const base = settings.id || "slate-resin";
    const host = settings.host || input.parentNode;
    const list = element(doc, "ul", "slate-combobox__list", { role: "listbox", id: `${base}-list`, hidden: "" });
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", `${base}-list`);
    if (host) host.appendChild(list);

    let options2 = [];
    let active = -1;
    let shown = false;
    let catalog = null;
    let detached = false;

    function catalogNow() {
      if (catalog === null) {
        let list2;
        try { list2 = resins(); } catch (error) { list2 = []; }
        catalog = Array.isArray(list2) ? list2 : [];
      }
      return catalog;
    }

    function render() {
      options2 = optionsFor(catalogNow(), input.value, limit);
      active = paint(doc, list, input, base, options2, active, catalogNow().length === 0, choose);
      if (placement) placement.place();
    }

    function show() {
      if (detached) return;
      render();
      if (shown) return;
      shown = true;
      list.removeAttribute("hidden");
      input.setAttribute("aria-expanded", "true");
      if (touch) placement = keepInView(settings.view || null, input, list);
    }

    function hide() {
      if (!shown) return;
      shown = false;
      if (placement) { placement.stop(); placement = null; }
      list.setAttribute("hidden", "");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function choose(code) {
      if (detached) return;
      input.value = normalize(code);
      hide();
      onChoose(input.value);
    }

    const onInput = () => { active = 0; show(); };
    const onKeydown = event => {
      if (!event || detached) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (!shown) { active = 0; show(); return; }
        if (options2.length === 0) return;
        active = event.key === "ArrowDown" ? (active + 1) % options2.length : (active - 1 + options2.length) % options2.length;
        render();
      } else if (event.key === "Enter") {
        if (!shown) return;
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (normalize(input.value) === "") choose("");
        else if (active >= 0 && options2[active]) choose(options2[active].code);
        else hide();
      } else if (event.key === "Escape") {
        if (!shown) return;
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        hide();
      }
    };
    const onBlur = event => {
      const related = event && event.relatedTarget;
      if (related && typeof list.contains === "function" && list.contains(related)) return;
      hide();
    };
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown);
    input.addEventListener("blur", onBlur);

    function destroy() {
      if (detached) return;
      detached = true;
      hide();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown);
      input.removeEventListener("blur", onBlur);
      if (list.parentNode) list.parentNode.removeChild(list);
    }

    return Object.freeze({
      list,
      show,
      hide,
      destroy,
      isOpen: () => shown && !detached,
      options: () => options2.slice(),
      active: () => active
    });
  }

  return Object.freeze({ RESULT_LIMIT, TOUCH_LIMIT, CODE_MAX, NO_CATALOG, normalize, filterResins, optionsFor, densityNote, open, attach });
});
