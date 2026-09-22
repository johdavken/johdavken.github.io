/* A prompt popover: one question at a time, then an answer to use.
 *
 * The shape of the floor UI's changeover wizard, made general so the
 * Changeover and Line rate cards can each run their own prompts through
 * it: a head with the title and "2 of 6", one prompt - a number with its
 * unit, a choice of tiles, or the two time fields - Back and Next, then
 * the estimate page with "Adjust answers" and "Use ...". What the prompts
 * are, how an answer is checked, what the estimate is and says, and what
 * Use does are all the caller's (slate-changeover.js, slate-line-rate.js);
 * this file draws and walks.
 *
 * It dispatches nothing and keeps nothing: Use hands the estimate to the
 * caller's `apply`, and only an accepted answer is told to `accept`.
 * Escape, the close, or a press outside close it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateWizard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NEXT = "Next";
  const BACK = "Back";
  const ADJUST = "Adjust answers";
  const CLOSE = "Close";
  const UNAVAILABLE = "This calculator is not available on this page.";
  const NO_ESTIMATE = "Those answers do not add up. Start again.";

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

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** The calculator's mark: a small pad, for a card's button. */
  function glyph(doc) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "slate-wizard__glyph");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M5 2h10a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 15 18H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 2zm0 1.5v13h10v-13H5zm1.5 1.5h7v3h-7V5zm0 4.5h2v2h-2V9.5zm2.5 0h2v2H9V9.5zm2.5 0h2v2h-2V9.5zm-5 2.5h2v2h-2V12zm2.5 0h2v2H9v-2zm2.5 0h2v2h-2v-2z");
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    return svg;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {string} options.title
   * @param {object[]} options.steps      [{ field, kind: "number"|"choice"|"time", question, unit?, label?, choices?, hint?, suggest? }]
   *   hint(answers) -> a line under the prompt; suggest(answers) -> a value for an empty number field
   * @param {function} options.read       () -> the answers to start from
   * @param {function} [options.save]     (answers) told after every step, as the wizard saves
   * @param {function} options.validate   (field, raw) -> { ok, message }
   * @param {function} options.estimate   (answers) -> the result, or null
   * @param {function} options.page       (result, answers) -> { headline, lead, summary, useLabel, said }
   * @param {function} options.apply      (result, answers) -> the card's result
   * @param {function} [options.accept]   (answers, result) told after an accepted Use
   * @param {function} [options.able]     () -> { ok, reason } for Use
   * @param {function} [options.say]
   * @param {function} [options.onChange] told (open) whenever it opens or closes
   * @param {Element} [options.anchor]
   * @param {object} [options.view]
   * @param {string} [options.unavailable] the line shown with nothing to calculate with (`ready: false`)
   * @param {boolean} [options.ready]
   */
  function create(doc, options) {
    const settings = options || {};
    const steps = Array.isArray(settings.steps) ? settings.steps : [];
    const ESTIMATE_STEP = steps.length;
    const ready = settings.ready !== false;
    const read = typeof settings.read === "function" ? settings.read : () => ({});
    const save = typeof settings.save === "function" ? settings.save : () => {};
    const validate = typeof settings.validate === "function" ? settings.validate : () => ({ ok: true, message: "" });
    const estimate = typeof settings.estimate === "function" ? settings.estimate : () => null;
    const page = typeof settings.page === "function" ? settings.page : () => ({ headline: "", lead: "", summary: "", useLabel: "Use", said: "" });
    const apply = typeof settings.apply === "function" ? settings.apply : () => ({ ok: false, code: "unavailable", message: UNAVAILABLE });
    const accept = typeof settings.accept === "function" ? settings.accept : () => {};
    const ableFor = typeof settings.able === "function" ? settings.able : () => ({ ok: true, reason: "" });
    const say = typeof settings.say === "function" ? settings.say : () => {};
    const onChange = typeof settings.onChange === "function" ? settings.onChange : () => {};
    const view = settings.view || doc;
    const unavailable = settings.unavailable || UNAVAILABLE;
    const noEstimate = settings.noEstimate || NO_ESTIMATE;

    const rootEl = element(doc, "div", "slate-wizard", { role: "dialog", "aria-label": settings.title || "", hidden: "" });
    const head = element(doc, "div", "slate-wizard__head");
    head.appendChild(text(doc, "span", "slate-wizard__title", settings.title || ""));
    const progress = text(doc, "span", "slate-wizard__progress", "");
    head.appendChild(progress);
    const closeButton = element(doc, "button", "slate-panel__close slate-wizard__close", { type: "button", "aria-label": CLOSE, title: CLOSE });
    closeButton.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    head.appendChild(closeButton);
    rootEl.appendChild(head);
    const body = element(doc, "div", "slate-wizard__body");
    rootEl.appendChild(body);

    const state = { open: false, step: 0, answers: null, controls: {}, useButton: null, result: null };

    function note(message) {
      const line = body.querySelector(".slate-wizard__error");
      if (!line) return;
      line.textContent = message || "";
      show(line, !!message);
    }

    function actions(first) {
      const row = element(doc, "div", "slate-wizard__actions");
      if (!first) row.appendChild(text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet", BACK, { type: "button", "data-wizard": "back" }));
      row.appendChild(text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--promote", NEXT, { type: "button", "data-wizard": "next" }));
      return row;
    }

    function numberField(step) {
      const wrap = element(doc, "div", "slate-wizard__field");
      const input = element(doc, "input", "slate-wizard__input", {
        type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": step.question, "data-wizard-field": step.field
      });
      const current = state.answers[step.field];
      const empty = current == null || String(current).trim() === "";
      const suggested = empty && typeof step.suggest === "function" ? step.suggest(state.answers) : "";
      input.value = empty ? String(suggested == null ? "" : suggested) : String(current);
      wrap.appendChild(input);
      if (step.unit) wrap.appendChild(text(doc, "span", "slate-wizard__unit", step.unit));
      state.controls = { [step.field]: input };
      return wrap;
    }

    function tiles(step) {
      const choices = typeof step.choices === "function" ? step.choices(state.answers) : (step.choices || []);
      const group = element(doc, "div", `slate-wizard__choices${choices.length === 2 ? " is-binary" : ""}`, { role: "radiogroup", "aria-label": step.label || step.question });
      for (const choice of choices) {
        const on = state.answers[step.field] === choice.value;
        const tile = text(doc, "button", "slate-wizard__choice", choice.label, {
          type: "button", role: "radio", "aria-checked": on ? "true" : "false", "data-wizard-choice": String(choice.value)
        });
        tile.classList.toggle("is-selected", on);
        group.appendChild(tile);
      }
      return group;
    }

    function timeFields(step) {
      const wrap = element(doc, "div", "slate-wizard__time");
      const controls = {};
      for (const [field, label] of step.fields || [["hours", "Hours"], ["minutes", "Minutes"]]) {
        const box = element(doc, "div", "slate-wizard__time-field");
        const input = element(doc, "input", "slate-wizard__input slate-wizard__input--short", {
          type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": `${label} ${step.suffix || ""}`.trim(), "data-wizard-field": field
        });
        input.value = String(state.answers[field] == null ? "0" : state.answers[field]);
        box.appendChild(input);
        box.appendChild(text(doc, "span", "slate-wizard__unit", label));
        wrap.appendChild(box);
        controls[field] = input;
      }
      state.controls = controls;
      return wrap;
    }

    function renderEstimate() {
      const result = estimate(state.answers);
      state.result = result;
      if (!result) { state.step = 0; say(noEstimate); render(); return; }
      const words = page(result, state.answers) || {};
      body.appendChild(text(doc, "h3", "slate-wizard__question", words.title || "Estimate"));
      body.appendChild(text(doc, "p", "slate-wizard__result", words.headline || ""));
      if (words.lead) body.appendChild(text(doc, "p", "slate-wizard__lead", words.lead));
      if (words.summary) body.appendChild(text(doc, "p", "slate-wizard__summary", words.summary));
      body.appendChild(element(doc, "p", "slate-wizard__error", { role: "alert", hidden: "" }));
      const row = element(doc, "div", "slate-wizard__actions");
      row.appendChild(text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet", ADJUST, { type: "button", "data-wizard": "adjust" }));
      const able = ableFor();
      const use = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--promote", words.useLabel || "Use", {
        type: "button", "data-wizard": "use", "data-able": able.ok ? "true" : "false", title: able.ok ? (words.useTitle || words.useLabel || "Use") : `Cannot use it here: ${able.reason}`
      });
      row.appendChild(use);
      body.appendChild(row);
      state.useButton = use;
      if (typeof use.focus === "function") use.focus();
    }

    function render() {
      clear(body);
      state.controls = {};
      state.useButton = null;
      if (!ready) {
        progress.textContent = "";
        body.appendChild(text(doc, "p", "slate-wizard__unavailable", unavailable));
        return;
      }
      if (state.step >= ESTIMATE_STEP) { progress.textContent = "Estimate"; renderEstimate(); return; }
      const step = steps[state.step];
      progress.textContent = `${state.step + 1} of ${steps.length}`;
      body.appendChild(text(doc, "h3", "slate-wizard__question", step.question));
      if (step.kind === "number") body.appendChild(numberField(step));
      else if (step.kind === "choice") body.appendChild(tiles(step));
      else body.appendChild(timeFields(step));
      const hint = typeof step.hint === "function" ? step.hint(state.answers) : "";
      if (hint) body.appendChild(text(doc, "p", "slate-wizard__hint", hint));
      body.appendChild(element(doc, "p", "slate-wizard__error", { role: "alert", hidden: "" }));
      body.appendChild(actions(state.step === 0));
      const first = step.kind === "time" ? state.controls[(step.fields || [["hours"]])[0][0]] : state.controls[step.field];
      if (first && typeof first.focus === "function") { first.focus(); if (typeof first.select === "function") first.select(); }
    }

    /* ---- Moving through the steps ---- */

    function take() {
      const step = steps[state.step];
      if (!step) return true;
      if (step.kind === "number") {
        const control = state.controls[step.field];
        const raw = control ? String(control.value) : "";
        const check = validate(step.field, raw);
        if (!check.ok) { note(check.message); if (control && typeof control.focus === "function") control.focus(); return false; }
        state.answers[step.field] = raw;
        return true;
      }
      if (step.kind === "time") {
        for (const [field] of step.fields || [["hours"], ["minutes"]]) {
          const control = state.controls[field];
          const raw = control ? String(control.value).trim() : "";
          const value = raw === "" ? 0 : Number(raw);
          const check = validate(field, value);
          if (!check.ok) { note(check.message); if (control && typeof control.focus === "function") control.focus(); return false; }
          state.answers[field] = value;
        }
        return true;
      }
      const check = validate(step.field, state.answers[step.field]);
      if (!check.ok) { note(check.message); return false; }
      return true;
    }

    function advance() {
      if (!take()) return;
      save(Object.assign({}, state.answers));
      state.step = Math.min(ESTIMATE_STEP, state.step + 1);
      render();
    }

    function back() {
      state.step = Math.max(0, state.step - 1);
      render();
    }

    function choose(raw) {
      const step = steps[state.step];
      if (!step || step.kind !== "choice") return;
      const choices = typeof step.choices === "function" ? step.choices(state.answers) : (step.choices || []);
      const choice = choices.find(one => String(one.value) === String(raw));
      if (!choice) return;
      state.answers[step.field] = choice.value;
      advance();
    }

    function use() {
      if (!state.result || !state.useButton) return null;
      if (state.useButton.getAttribute("data-able") !== "true") { note(state.useButton.getAttribute("title") || unavailable); return { ok: false, code: "unavailable", message: ableFor().reason }; }
      const result = apply(state.result, Object.assign({}, state.answers));
      if (result && result.ok) {
        const words = page(state.result, state.answers) || {};
        accept(Object.assign({}, state.answers), state.result);
        close();
        if (words.said) say(words.said);
        return result;
      }
      note((result && result.message) || "The application refused the change.");
      return result;
    }

    /* ---- Open and close ---- */

    function outside(event) {
      if (event && event.target && (rootEl.contains(event.target) || (settings.anchor && settings.anchor.contains(event.target)))) return;
      close();
    }

    function open() {
      if (state.open) return;
      state.open = true;
      state.step = 0;
      state.answers = Object.assign({}, read() || {});
      show(rootEl, true);
      render();
      if (typeof view.addEventListener === "function") view.addEventListener("pointerdown", outside, true);
      onChange(true);
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      show(rootEl, false);
      clear(body);
      state.controls = {};
      state.useButton = null;
      state.result = null;
      if (typeof view.removeEventListener === "function") view.removeEventListener("pointerdown", outside, true);
      onChange(false);
      if (settings.anchor && typeof settings.anchor.focus === "function") settings.anchor.focus();
    }

    function toggle() {
      if (state.open) close();
      else open();
    }

    closeButton.addEventListener("click", () => close());
    body.addEventListener("click", event => {
      const target = event && event.target;
      if (!target || typeof target.closest !== "function") return;
      const choice = target.closest("[data-wizard-choice]");
      if (choice && body.contains(choice)) { choose(choice.getAttribute("data-wizard-choice")); return; }
      const button = target.closest("[data-wizard]");
      if (!button || !body.contains(button)) return;
      const what = button.getAttribute("data-wizard");
      if (what === "next") advance();
      else if (what === "back") back();
      else if (what === "adjust") { state.step = 0; render(); }
      else if (what === "use") use();
    });
    rootEl.addEventListener("keydown", event => {
      if (!event) return;
      if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); close(); return; }
      if (event.key !== "Enter") return;
      const target = event.target;
      if (target && typeof target.hasAttribute === "function" && target.hasAttribute("data-wizard-field")) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        advance();
      }
    });

    return Object.freeze({
      element: rootEl,
      open,
      close,
      toggle,
      isOpen: () => state.open,
      step: () => state.step,
      answers: () => (state.answers ? Object.assign({}, state.answers) : null),
      result: () => state.result,
      next: advance,
      back,
      choose,
      use
    });
  }

  return Object.freeze({ NEXT, BACK, ADJUST, UNAVAILABLE, NO_ESTIMATE, glyph, create });
});
