/* Winding Tension: a starting tension, in the Timeline's place.
 *
 * Film thickness, roll width and the number of ups go in; the tension
 * the winder starts at comes out - the target in pounds with the PLI it
 * came from, the band's minimum and maximum at this width, and the wind
 * type and taper the band recommends. The arithmetic is the application's
 * own (winding-tension.js, PolynWindingTension: the bands, the
 * interpolation, the clamp above 20 mil), handed in by the boot so this
 * panel cannot recommend differently. Nothing is computed here.
 *
 * Nothing is dispatched, nothing is stored: the entries are the
 * operator's scratch and live as long as the page. The head's close hands
 * the aside back to the Timeline (ctx.back).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateWindingTension = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE = "Winding Tension";
  const CLOSE_LABEL = "Back to the Timeline";
  const UNAVAILABLE = "Winding Tension is unavailable: the shared calculation did not load.";
  const PROMPT = "Enter film thickness and roll width.";
  const CAPTION = "A starting tension from film thickness and roll width.";
  const EMPTY = "—";

  /* The entries, in the order they are asked. */
  const FIELDS = Object.freeze([
    Object.freeze({ key: "thickness", arg: "filmThicknessMil", label: "Film thickness", unit: "mil", initial: "", inputmode: "decimal" }),
    Object.freeze({ key: "width", arg: "rollWidthIn", label: "Roll width", unit: "in", initial: "", inputmode: "decimal" }),
    Object.freeze({ key: "ups", arg: "ups", label: "Ups", unit: "", initial: "1", inputmode: "numeric" })
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

  function blank(value) {
    return typeof value !== "string" || !value.trim();
  }

  /**
   * What the panel says for a set of entries: the calculation's result,
   * or why there is none - the prompt while a required entry is still
   * blank, the application's own refusal otherwise. Pure.
   *
   * @returns {{result: object|null, message: string, invalid: boolean}}
   */
  function readingFor(calc, entries) {
    if (!calc) return { result: null, message: UNAVAILABLE, invalid: false };
    const values = entries || {};
    if (blank(values.thickness) || blank(values.width)) return { result: null, message: PROMPT, invalid: false };
    const result = calc.calculate({ filmThicknessMil: values.thickness, rollWidthIn: values.width, ups: values.ups });
    if (!result.valid) return { result: null, message: result.errors[0] || "", invalid: true };
    return { result, message: "", invalid: false };
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.winding   PolynWindingTension, or null when it did not load
   * @param {function} [ctx.back]       hands the aside back to the Timeline
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const calc = settings.winding || null;
    const back = typeof settings.back === "function" ? settings.back : () => {};

    const rootEl = element(doc, "section", "slate-panel slate-winding", { "aria-label": TITLE });
    const head = element(doc, "div", "slate-panel__head");
    head.appendChild(text(doc, "h2", "slate-panel__title", TITLE));
    const close = element(doc, "button", "slate-panel__close", { type: "button", "aria-label": CLOSE_LABEL, title: CLOSE_LABEL, "data-slate-back": "" });
    close.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    head.appendChild(close);
    rootEl.appendChild(head);
    rootEl.appendChild(text(doc, "p", "slate-winding__caption", CAPTION));

    /* ---- The entries ---- */
    const form = element(doc, "div", "slate-winding__form");
    const inputs = {};
    // A row is a div, not a label: the host's legacy sheet styles bare
    // labels (muted, small, a margin) and the entry would inherit it. The
    // input carries its own name.
    for (const field of FIELDS) {
      const row = element(doc, "div", "slate-winding__field", { "data-field": field.key });
      row.appendChild(text(doc, "span", "slate-winding__label", field.label));
      const input = element(doc, "input", "slate-winding__input", {
        type: "text", inputmode: field.inputmode, autocomplete: "off", spellcheck: "false", placeholder: "0",
        "data-field": field.key, "aria-label": field.unit ? `${field.label} (${field.unit})` : field.label
      });
      input.value = field.initial;
      row.appendChild(input);
      row.appendChild(text(doc, "span", "slate-winding__unit", field.unit));
      form.appendChild(row);
      inputs[field.key] = input;
    }
    rootEl.appendChild(form);

    /* ---- The answer ---- */
    const result = element(doc, "div", "slate-winding__result", { hidden: "", "aria-live": "polite" });
    const figure = element(doc, "div", "slate-winding__figure");
    const target = text(doc, "span", "slate-winding__target", EMPTY);
    figure.appendChild(target);
    figure.appendChild(text(doc, "span", "slate-winding__target-unit", "lb"));
    result.appendChild(figure);
    const pli = text(doc, "p", "slate-winding__pli", "");
    result.appendChild(pli);

    const range = element(doc, "div", "slate-winding__range");
    const ends = {};
    for (const [key, label] of [["min", "Min"], ["target", "Target"], ["max", "Max"]]) {
      const end = element(doc, "div", "slate-winding__end", { "data-end": key });
      end.appendChild(text(doc, "span", "slate-winding__end-label", label));
      ends[key] = text(doc, "span", "slate-winding__end-value", EMPTY);
      end.appendChild(ends[key]);
      range.appendChild(end);
    }
    result.appendChild(range);

    const advice = element(doc, "dl", "slate-winding__advice");
    advice.appendChild(text(doc, "dt", "slate-winding__advice-label", "Wind type"));
    const wind = text(doc, "dd", "slate-winding__advice-value", EMPTY, { "data-advice": "wind" });
    advice.appendChild(wind);
    advice.appendChild(text(doc, "dt", "slate-winding__advice-label", "Taper"));
    const taper = text(doc, "dd", "slate-winding__advice-value", EMPTY, { "data-advice": "taper" });
    advice.appendChild(taper);
    result.appendChild(advice);
    result.appendChild(text(doc, "p", "slate-winding__notice", calc ? calc.NOTICE : ""));
    rootEl.appendChild(result);

    const note = element(doc, "p", "slate-winding__note", { role: "status" });
    rootEl.appendChild(note);

    const foot = element(doc, "div", "slate-winding__foot");
    const clear = text(doc, "button", "slate-winding__clear", "Clear", { type: "button", "data-slate-clear": "" });
    foot.appendChild(clear);
    rootEl.appendChild(foot);

    let last = null;

    function entries() {
      const values = {};
      for (const field of FIELDS) values[field.key] = inputs[field.key].value;
      return values;
    }

    function compute() {
      const reading = readingFor(calc, entries());
      last = reading.result;
      rootEl.classList.toggle("is-answered", !!reading.result);
      if (reading.result) {
        const answer = reading.result;
        target.textContent = calc.formatTension(answer.target);
        pli.textContent = `${calc.formatPli(answer.pli)} PLI`;
        ends.min.textContent = calc.formatTension(answer.min);
        ends.target.textContent = calc.formatTension(answer.target);
        ends.max.textContent = calc.formatTension(answer.max);
        wind.textContent = answer.wind;
        taper.textContent = answer.taper;
      }
      show(result, !!reading.result);
      note.textContent = reading.message;
      note.classList.toggle("is-invalid", reading.invalid);
      show(note, !!reading.message);
      return reading;
    }

    // Under a finger nothing pops the keyboard unasked (slate/slate-tier.js):
    // the operator taps the field they want.
    function focusFirst() {
      let touch = false;
      try { touch = typeof settings.tier === "function" && settings.tier().input === "touch"; } catch (error) { touch = false; }
      const first = inputs[FIELDS[0].key];
      if (calc && !touch && typeof first.focus === "function") first.focus();
    }

    function reset() {
      for (const field of FIELDS) inputs[field.key].value = field.initial;
      compute();
      focusFirst();
    }

    for (const field of FIELDS) inputs[field.key].addEventListener("input", compute);
    clear.addEventListener("click", reset);
    close.addEventListener("click", () => back());

    if (!calc) for (const field of FIELDS) inputs[field.key].setAttribute("disabled", "");
    compute();

    return Object.freeze({
      element: rootEl,
      onShow: focusFirst,
      reset,
      entries,
      result: () => last
    });
  }

  return Object.freeze({ TITLE, CLOSE_LABEL, UNAVAILABLE, PROMPT, CAPTION, EMPTY, FIELDS, readingFor, create });
});
