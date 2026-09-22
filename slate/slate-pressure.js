/* PSI ⇄ bar: the pressure converter, in the Scrap card's place.
 *
 * The one tool small enough for a card: an entry, the unit it was typed
 * in, and the same pressure read in the other unit. Type a gauge reading,
 * read it across; click the unit to say the reading was in bar instead,
 * and the entry is read again as bar and answered in psi.
 *
 * The arithmetic is the application's own (pressure-conversion.js,
 * PolynPressureConversion: the one factor, both roundings), handed in by
 * the boot so this card cannot convert differently. Nothing is computed
 * here, nothing is dispatched, nothing is stored: the entry lives as long
 * as the page.
 *
 * The card wears the job's card chrome (stat-cards.css) so it sits in the
 * row as one of them, and the panel's close (panel.css) so it leaves the
 * way a tool in the aside does: ctx.back hands the slot back to Scrap.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlatePressure = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE = "PSI ⇄ bar";
  const CLOSE_LABEL = "Back to Scrap";
  const UNAVAILABLE = "PSI ⇄ bar is unavailable: the shared conversion did not load.";
  const EMPTY = "—";

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

  /* The unit the entry is typed in, and the one it is read in. */
  function unitOf(pressure, key) {
    return (pressure ? pressure.UNITS : []).find(unit => unit.key === key) || { key, label: key };
  }

  function otherOf(from) {
    return from === "psi" ? "bar" : "psi";
  }

  /**
   * What the card reads for an entry: the answer in the other unit, or
   * the application's own refusal. Pure, so the wording is tested.
   *
   * @returns {{answer: string, error: string, result: object|null}}
   */
  function readingFor(pressure, value, from) {
    if (!pressure) return { answer: EMPTY, error: UNAVAILABLE, result: null };
    if (typeof value !== "string" || !value.trim()) return { answer: EMPTY, error: "", result: null };
    const result = pressure.convert({ value, from });
    if (!result.valid) return { answer: EMPTY, error: result.errors[0] || "", result: null };
    const other = otherOf(from);
    return { answer: `${pressure.format(result[other], other)} ${unitOf(pressure, other).label}`, error: "", result };
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.pressure   PolynPressureConversion, or null when it did not load
   * @param {function} [ctx.back]        hands the slot back to the Scrap card
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const pressure = settings.pressure || null;
    const back = typeof settings.back === "function" ? settings.back : () => {};

    let from = "psi";

    const rootEl = element(doc, "div", "slate-card slate-card--pressure slate-pressure", { "aria-label": TITLE, "data-from": from });
    const head = element(doc, "div", "slate-pressure__head");
    head.appendChild(text(doc, "span", "slate-card__label", TITLE));
    const close = element(doc, "button", "slate-panel__close", { type: "button", "aria-label": CLOSE_LABEL, title: CLOSE_LABEL, "data-slate-back": "" });
    close.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    head.appendChild(close);
    rootEl.appendChild(head);

    const row = element(doc, "div", "slate-pressure__row");
    const input = element(doc, "input", "slate-pressure__input", {
      type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0"
    });
    row.appendChild(input);
    const unit = element(doc, "button", "slate-pressure__unit", { type: "button", "data-slate-unit": "" });
    row.appendChild(unit);
    rootEl.appendChild(row);

    const answer = text(doc, "p", "slate-pressure__answer", EMPTY, { "aria-live": "polite" });
    rootEl.appendChild(answer);
    const note = element(doc, "p", "slate-card__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    let last = null;

    function paintUnit() {
      const typed = unitOf(pressure, from);
      const other = unitOf(pressure, otherOf(from));
      rootEl.setAttribute("data-from", from);
      unit.textContent = typed.label;
      const words = `Typed in ${typed.label}. Click to type in ${other.label}.`;
      unit.setAttribute("aria-label", words);
      unit.setAttribute("title", words);
      input.setAttribute("aria-label", `Pressure in ${typed.label}`);
    }

    function compute() {
      const reading = readingFor(pressure, input.value, from);
      last = reading.result;
      answer.textContent = reading.answer;
      rootEl.classList.toggle("is-answered", !!reading.result);
      note.textContent = reading.error;
      show(note, !!reading.error);
      if (reading.error && reading.error !== UNAVAILABLE) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      return reading;
    }

    function flip() {
      from = otherOf(from);
      paintUnit();
      compute();
      if (typeof input.focus === "function") input.focus();
    }

    input.addEventListener("input", compute);
    unit.addEventListener("click", flip);
    close.addEventListener("click", () => back());

    if (!pressure) input.setAttribute("disabled", "");
    paintUnit();
    compute();

    return Object.freeze({
      element: rootEl,
      onShow() { if (pressure && typeof input.focus === "function") input.focus(); },
      flip,
      from: () => from,
      entry: () => input.value,
      result: () => last
    });
  }

  return Object.freeze({ TITLE, CLOSE_LABEL, UNAVAILABLE, EMPTY, otherOf, readingFor, create });
});
