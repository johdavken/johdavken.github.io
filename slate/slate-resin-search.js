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
 * Dispatches nothing: the caller is told what was chosen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateResinSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RESULT_LIMIT = 8;
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
      maxlength: String(CODE_MAX)
    });
    input.value = normalize(settings.value);
    const list = element(doc, "ul", "slate-combobox__list", { role: "listbox", id: `${base}-list` });
    wrapper.appendChild(input);
    wrapper.appendChild(list);
    // Placed before the input takes focus: moving a focused field afterwards
    // blurs it, and the blur would close the search it just opened.
    if (settings.before && typeof host.insertBefore === "function") host.insertBefore(wrapper, settings.before);
    else host.appendChild(wrapper);

    let options2 = [];
    let active = -1;
    let closed = false;
    let catalog = null;

    function catalogNow() {
      if (catalog === null) {
        let list2;
        try { list2 = resins(); } catch (error) { list2 = []; }
        catalog = Array.isArray(list2) ? list2 : [];
      }
      return catalog;
    }

    function render() {
      while (list.firstChild) list.removeChild(list.firstChild);
      options2 = optionsFor(catalogNow(), input.value);
      if (options2.length === 0) {
        list.appendChild(text(doc, "li", "slate-combobox__empty", catalogNow().length === 0 ? NO_CATALOG : "No matching resin", { role: "presentation" }));
        active = -1;
        input.removeAttribute("aria-activedescendant");
        return;
      }
      if (active < 0 || active >= options2.length) active = 0;
      options2.forEach((option, index) => {
        const item = element(doc, "li", `slate-combobox__option${option.custom ? " is-custom" : ""}`, {
          role: "option", id: `${base}-option-${index}`, "data-resin": option.code, "aria-selected": index === active ? "true" : "false"
        });
        if (index === active) item.classList.add("is-active");
        item.appendChild(text(doc, "span", "slate-combobox__code", option.custom ? `Use ‘${option.code}’ as typed` : option.code));
        if (option.note && !option.custom) item.appendChild(text(doc, "span", "slate-combobox__note", option.note));
        // Keep the input's focus through the press, so blur cannot close
        // the list before the click chooses.
        item.addEventListener("mousedown", event => { if (event && typeof event.preventDefault === "function") event.preventDefault(); });
        item.addEventListener("click", () => choose(option.code));
        list.appendChild(item);
      });
      input.setAttribute("aria-activedescendant", `${base}-option-${active}`);
    }

    function close() {
      if (closed) return;
      closed = true;
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
      const related = event && event.relatedTarget;
      if (related && typeof list.contains === "function" && list.contains(related)) return;
      cancel();
    });

    render();
    if (typeof input.focus === "function") input.focus();
    if (typeof input.select === "function") input.select();

    return Object.freeze({
      element: wrapper,
      input,
      list,
      close,
      isOpen: () => !closed,
      options: () => options2.slice(),
      active: () => active
    });
  }

  return Object.freeze({ RESULT_LIMIT, CODE_MAX, NO_CATALOG, normalize, filterResins, optionsFor, densityNote, open });
});
