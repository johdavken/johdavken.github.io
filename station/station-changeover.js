/* The Station Changeover Calculator: the header's CHANGEOVER readout,
 * opened out into a utility surface below the header.
 *
 * WHAT IT IS
 *
 * The application's "Determine Changeover Time" calculator, as the desktop
 * console presents it - the same arithmetic, the same answers, the same
 * running estimate afterwards (changeover-estimate.js, which restates
 * app.js's wizard line for line and keeps the wizard's own device-local
 * records) - and beside it the changeover deadline itself, the value the
 * header shows, edited in place. The readout in the header is the closed
 * form; this is the open one. There is no second launcher: the readout is
 * clicked, the surface opens; Close, Escape or the readout again, and the
 * readout is all that is left.
 *
 * A UTILITY SURFACE, NOT A HANDBOOK SECTION
 *
 * The Operator Handbook is the large work surface across the stage's
 * lower part; this is a smaller, focused one across its upper part, and
 * the two are built to stand open together. Same glass (glass.css: the
 * one material, on the theme's glass tokens), same control vocabulary
 * (the Handbook's action / chip / utility / close classes, handbook.css),
 * a different box: fixed capacity, centred under the header, bounded
 * above the Handbook's share of the stage (changeover.css) so the two can
 * never overlap. Nothing is shared with the Handbook but the stylesheet:
 * neither holds the other's state, and closing one leaves the other
 * exactly as it was.
 *
 * WHERE IT WRITES
 *
 * Nowhere, itself. The one job value here - the deadline - goes out
 * through the header's job controls (station-job-controls.js), which
 * this surface is handed as one function, `apply(at)`: the same
 * setChangeover command the readout's field used to issue, executed by
 * the application, whose answer the header then shows. The calculator's
 * own records - answers, the running estimate - are the device's, kept
 * by changeover-estimate.js under the application's own keys; this file
 * never touches storage, sync or the network, and never dispatches.
 *
 * WHAT IT HOLDS
 *
 * Presentation state: whether it is open, the flight in progress, the
 * answers as typed (which changeover-estimate.js saves as the wizard
 * does), and the job's changeover as last fed in.
 */
(function (root, factory) {
  const transition = typeof require === "function"
    ? require("./station-transition.js")
    : (root && root.PolynStationTransition);
  const rundown = typeof require === "function"
    ? require("./station-rundown.js")
    : (root && root.PolynStationRundown);
  const estimate = typeof require === "function"
    ? (function () { try { return require("../changeover-estimate.js"); } catch (error) { return null; } })()
    : (root && root.PolynChangeoverEstimate);
  const scheduling = typeof require === "function"
    ? (function () { try { return require("../scheduling.js"); } catch (error) { return null; } })()
    : (root && root.PolynScheduling);
  const api = factory(transition, rundown, estimate, scheduling);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationChangeover = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (transitionModule, rundownModule, estimateModule, schedulingModule) {
  "use strict";

  const DEFAULT_TIMING = transitionModule && transitionModule.DEFAULT_TIMING
    ? transitionModule.DEFAULT_TIMING
    : Object.freeze({ ack: 80, move: 300, lead: 40, settle: 120, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" });

  /* The control vocabulary is the Handbook's (handbook.css): one set of
   * flat controls for every glass surface on the console. */
  const ACTION = "station-handbook__action";
  const CHIP = "station-handbook__chip";
  const CLOSE = "station-handbook__close";

  /* The typed answers, in the order the wizard asks them, with the
   * wizard's own units. */
  const TYPED = Object.freeze([
    { field: "lineSpeed", label: "Line speed", unit: "ft/min" },
    { field: "footagePerRoll", label: "Footage per roll", unit: "ft" },
    { field: "rollsLeft", label: "Rolls left", unit: "rolls" }
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

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /* "2 hr 55 min remaining" - the wizard's own wording for the estimate. */
  function remainingText(minutes) {
    const rounded = Math.max(0, Math.round(minutes));
    return `${Math.floor(rounded / 60) ? `${Math.floor(rounded / 60)} hr ` : ""}${rounded % 60} min remaining`;
  }

  /**
   * Build the calculator.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {function} options.apply       (at: epoch ms | null) => the
   *        command's result, through the job controls; the one way the
   *        deadline is set
   * @param {function} [options.canApply]  () => boolean: whether the
   *        application offers setChangeover for what is on screen
   * @param {object}   [options.storage]   where the answers and the running
   *        estimate live (changeover-estimate.js's storageFrom); none in tests
   * @param {function} [options.now]       () => epoch ms
   * @param {Element}  [options.anchor]    the header readout the surface
   *        opens out of and returns to
   * @param {Element}  [options.mount]     the element the motion tokens are read off
   * @param {function} [options.reducedMotion]  () => boolean
   * @param {function} [options.animate]   (element, keyframes, options) => Animation
   * @param {function} [options.measure]   (element) => client rect
   * @param {function} [options.computedStyle]
   * @param {object}   [options.timing]
   * @param {function} [options.onOpenChange]  (open) => void
   * @param {object}   [options.estimate]  changeover-estimate.js, when not global
   * @param {object}   [options.rundown]   station-rundown.js, when not global
   * @param {object}   [options.scheduling]
   */
  function create(doc, options) {
    const settings = options || {};
    const calc = settings.estimate || estimateModule;
    const rundown = settings.rundown || rundownModule;
    const scheduling = settings.scheduling || schedulingModule;
    if (!calc || !rundown) return null;
    const apply = typeof settings.apply === "function" ? settings.apply : () => ({ ok: false, code: "unavailable", message: "No application is connected to Station commands." });
    const canApply = typeof settings.canApply === "function" ? settings.canApply : () => false;
    const storage = settings.storage || null;
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const reducedMotion = typeof settings.reducedMotion === "function" ? settings.reducedMotion : () => false;
    const animate = typeof settings.animate === "function"
      ? settings.animate
      : (el, keyframes, opts) => (transitionModule && typeof transitionModule.play === "function" ? transitionModule.play(el, keyframes, opts) : null);
    const measure = typeof settings.measure === "function"
      ? settings.measure
      : el => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);
    const computedStyle = settings.computedStyle
      || (typeof getComputedStyle === "function" ? el => getComputedStyle(el) : null);
    const timing = Object.assign({},
      transitionModule && typeof transitionModule.readTiming === "function" && settings.mount
        ? transitionModule.readTiming(settings.mount, computedStyle)
        : DEFAULT_TIMING,
      settings.timing || {});
    const onOpenChange = typeof settings.onOpenChange === "function" ? settings.onOpenChange : () => {};
    const anchor = settings.anchor || null;

    const state = {
      open: false,
      flight: null,          // { animations, closing }
      answers: calc.readAnswers(storage),
      job: null,
      deadlineEditing: false
    };

    const rootEl = element(doc, "div", "station-changeover", { "data-role": "changeover" });

    /* ---- The surface ---- */
    const panel = element(doc, "section", "station-changeover__panel station-glass", {
      role: "region", "aria-label": "Changeover Calculator", hidden: ""
    });
    const head = element(doc, "header", "station-changeover__head");
    head.appendChild(text(doc, "h2", "station-changeover__title", "Changeover"));
    const readout = text(doc, "span", "station-changeover__readout", "");
    head.appendChild(readout);
    const closeButton = text(doc, "button", `${CLOSE} station-changeover__close`, "Close", {
      type: "button", "data-action": "close-changeover", title: "Close the calculator (Esc)"
    });
    head.appendChild(closeButton);
    panel.appendChild(head);

    const body = element(doc, "div", "station-changeover__body");
    panel.appendChild(body);

    /* ---- The deadline: the job's changeover, edited here ---- */
    const deadline = element(doc, "div", "station-changeover__deadline");
    deadline.appendChild(text(doc, "label", "station-changeover__label", "Deadline", { for: "station-changeover-deadline" }));
    const deadlineInput = element(doc, "input", "station-changeover__time", {
      id: "station-changeover-deadline", type: "time", "aria-label": "Changeover time", "data-field": "deadline"
    });
    deadline.appendChild(deadlineInput);
    const setButton = text(doc, "button", `${ACTION} station-changeover__set`, "Set", { type: "button", "data-action": "set-deadline" });
    deadline.appendChild(setButton);
    const clearButton = text(doc, "button", `${ACTION} is-quiet station-changeover__clear`, "Clear", { type: "button", "data-action": "clear-deadline" });
    deadline.appendChild(clearButton);
    const running = text(doc, "span", "station-changeover__running", "", { "data-role": "production-estimate", hidden: "" });
    deadline.appendChild(running);
    body.appendChild(deadline);

    /* ---- The answers, in three groups ---- */
    const form = element(doc, "form", "station-changeover__form", { id: "station-changeover-form", "data-role": "answers" });
    const fields = {};

    function fieldRow(field, labelText, unit, attributes) {
      const row = element(doc, "div", "station-changeover__field", { "data-field": field });
      const id = `station-changeover-${field}`;
      row.appendChild(text(doc, "label", "station-changeover__label", labelText, { for: id }));
      const input = element(doc, "input", "station-changeover__input", Object.assign({
        id, type: "text", inputmode: "numeric", autocomplete: "off", spellcheck: "false", "data-field": field
      }, attributes || {}));
      row.appendChild(input);
      if (unit) row.appendChild(text(doc, "span", "station-changeover__unit", unit));
      fields[field] = { row, input };
      return row;
    }

    function chipGroup(field, labelText, choices, ariaLabel) {
      const row = element(doc, "div", "station-changeover__field station-changeover__field--chips", { "data-field": field });
      row.appendChild(text(doc, "span", "station-changeover__label", labelText));
      const chips = element(doc, "div", "station-changeover__chips", { role: "radiogroup", "aria-label": ariaLabel });
      const buttons = choices.map(choice => {
        const chip = text(doc, "button", CHIP, choice.label, {
          type: "button", role: "radio", "data-field": field, "data-value": String(choice.value),
          "aria-checked": "false", "aria-pressed": "false", title: choice.title || null
        });
        chips.appendChild(chip);
        return { value: choice.value, chip };
      });
      row.appendChild(chips);
      fields[field] = { row, chips: buttons };
      return row;
    }

    const groupLine = element(doc, "fieldset", "station-changeover__group");
    groupLine.appendChild(text(doc, "legend", "station-changeover__legend", "Line"));
    groupLine.appendChild(fieldRow("lineSpeed", "Line speed", "ft/min"));
    groupLine.appendChild(fieldRow("footagePerRoll", "Footage per roll", "ft"));
    form.appendChild(groupLine);

    const groupWinders = element(doc, "fieldset", "station-changeover__group");
    groupWinders.appendChild(text(doc, "legend", "station-changeover__legend", "Winders"));
    groupWinders.appendChild(chipGroup("numberUp", "Up",
      Array.from({ length: calc.NUMBER_UP_MAX }, (_, i) => ({ value: i + 1, label: String(i + 1) })), "Rolls per winder"));
    groupWinders.appendChild(chipGroup("bothWinders", "Winders",
      [{ value: false, label: "1", title: "One winder" }, { value: true, label: "2", title: "Both winders" }], "Winders in use"));
    form.appendChild(groupWinders);

    const groupOrder = element(doc, "fieldset", "station-changeover__group");
    groupOrder.appendChild(text(doc, "legend", "station-changeover__legend", "Order"));
    const setRow = element(doc, "div", "station-changeover__field station-changeover__field--time", { "data-field": "currentSet" });
    setRow.appendChild(text(doc, "label", "station-changeover__label", "Current set left", { for: "station-changeover-hours" }));
    const hoursInput = element(doc, "input", "station-changeover__input station-changeover__input--short", {
      id: "station-changeover-hours", type: "text", inputmode: "numeric", autocomplete: "off", "data-field": "hours", "aria-label": "Hours left on the current set"
    });
    const minutesInput = element(doc, "input", "station-changeover__input station-changeover__input--short", {
      id: "station-changeover-minutes", type: "text", inputmode: "numeric", autocomplete: "off", "data-field": "minutes", "aria-label": "Minutes left on the current set"
    });
    setRow.appendChild(hoursInput);
    setRow.appendChild(text(doc, "span", "station-changeover__unit", "h"));
    setRow.appendChild(minutesInput);
    setRow.appendChild(text(doc, "span", "station-changeover__unit", "m"));
    fields.hours = { row: setRow, input: hoursInput };
    fields.minutes = { row: setRow, input: minutesInput };
    groupOrder.appendChild(setRow);
    groupOrder.appendChild(fieldRow("rollsLeft", "Rolls left", "rolls"));
    form.appendChild(groupOrder);
    body.appendChild(form);

    /* ---- The estimate, and the one action that uses it ---- */
    const result = element(doc, "div", "station-changeover__result", { "data-role": "estimate" });
    const resultTime = text(doc, "span", "station-changeover__result-time", "—");
    const resultDetail = text(doc, "span", "station-changeover__result-detail", "");
    /* Use submits the form it stands beside (Enter in any answer does the
     * same), so the estimate is used the way a form is sent. */
    const useButton = text(doc, "button", `${ACTION} is-primary station-changeover__use`, "Use", {
      type: "submit", form: "station-changeover-form", "data-action": "use-estimate", disabled: ""
    });
    result.append(resultTime, resultDetail, useButton);
    body.appendChild(result);

    const note = element(doc, "p", "station-changeover__note", { role: "status", hidden: "" });
    body.appendChild(note);

    rootEl.appendChild(panel);

    /* ---- Display ---- */

    function say(message, kind) {
      note.textContent = message || "";
      note.setAttribute("data-kind", kind || "");
      show(note, !!message);
    }

    function offer() {
      const can = !!canApply();
      const readonly = !can;
      panel.classList.toggle("is-readonly", readonly);
      deadlineInput.disabled = readonly;
      if (readonly) deadlineInput.setAttribute("disabled", ""); else deadlineInput.removeAttribute("disabled");
      for (const button of [setButton, clearButton]) {
        button.disabled = readonly;
        if (readonly) button.setAttribute("disabled", ""); else button.removeAttribute("disabled");
      }
      return can;
    }

    /* The job's changeover as the field would show it, "" when unset. */
    function jobClock() {
      const resolved = rundown.resolveChangeover(state.job, { now: now() });
      return resolved.at !== null ? calc.clockValue(resolved.at) : "";
    }

    /* The header's own words for the deadline, and the deadline's field. */
    function refreshDeadline() {
      const t = now();
      const resolved = rundown.resolveChangeover(state.job, { now: t });
      let words = "Not set";
      if (resolved.at !== null) {
        const clock = rundown.formatClock(resolved.at);
        words = resolved.stale ? `${clock} · confirm` : `${clock} · in ${rundown.formatRemaining(resolved.at - t)}`;
      }
      readout.textContent = words;
      readout.classList.toggle("is-stale", !!resolved.stale);
      readout.classList.toggle("is-unset", resolved.at === null);
      if (!state.deadlineEditing) {
        deadlineInput.value = resolved.at !== null ? calc.clockValue(resolved.at) : "";
        deadlineInput.removeAttribute("aria-invalid");
      }
    }

    /* The running estimate an accepted calculation left: re-derived from
     * the clock, gone once the changeover point has passed - the
     * application's own reading (changeover-estimate.js). */
    function refreshRunning() {
      const record = calc.readProductionEstimate(storage);
      const current = calc.currentProductionEstimate(record, now());
      if (!current) {
        if (record) calc.clearProductionEstimate(storage);
        running.textContent = "";
        show(running, false);
        return;
      }
      running.textContent = calc.formatProductionEstimate(current);
      show(running, true);
    }

    function currentEstimate() {
      return calc.estimate(state.answers, now());
    }

    /* Every answer checked, as the wizard checks each at its step; the
     * first failing one is what the note says. */
    function validation() {
      const problems = [];
      for (const field of ["lineSpeed", "footagePerRoll", "numberUp", "bothWinders", "hours", "minutes", "rollsLeft"]) {
        const verdict = calc.validateAnswer(field, state.answers[field]);
        const owner = fields[field];
        const input = owner && owner.input;
        if (input) {
          // A field not yet filled in is not a wrong one: only an entry
          // the wizard would refuse is marked.
          const blank = String(state.answers[field] == null ? "" : state.answers[field]).trim() === "";
          if (verdict.ok || blank) input.removeAttribute("aria-invalid");
          else input.setAttribute("aria-invalid", "true");
        }
        if (!verdict.ok) problems.push({ field, message: verdict.message });
      }
      return problems;
    }

    function refreshEstimate() {
      const problems = validation();
      const estimated = problems.length ? null : currentEstimate();
      const untouched = ["lineSpeed", "footagePerRoll", "rollsLeft"].every(field => String(state.answers[field] == null ? "" : state.answers[field]).trim() === "");
      result.classList.toggle("is-ready", !!estimated);
      if (!estimated) {
        resultTime.textContent = "—";
        resultDetail.textContent = untouched
          ? "Enter the line speed, the footage per roll and the rolls left."
          : (problems.length ? problems[0].message : "The answers do not add up to an estimate.");
        useButton.textContent = "Use";
        useButton.disabled = true;
        useButton.setAttribute("disabled", "");
        return null;
      }
      const clock = rundown.formatClock(estimated.estimatedAt);
      resultTime.textContent = clock;
      resultDetail.textContent = `${remainingText(estimated.remainingMinutes)} · ${state.answers.rollsLeft} rolls · ${estimated.rollsPerSet} rolls/set · ${estimated.futureSets} future ${estimated.futureSets === 1 ? "set" : "sets"}`;
      useButton.textContent = `Use ${clock}`;
      const can = !!canApply();
      useButton.disabled = !can;
      if (can) useButton.removeAttribute("disabled"); else useButton.setAttribute("disabled", "");
      useButton.setAttribute("title", can ? `Set the changeover to ${clock}` : "Read-only here: no application is connected to Station commands.");
      return estimated;
    }

    function refreshAnswers() {
      for (const { field } of TYPED) {
        fields[field].input.value = String(state.answers[field] == null ? "" : state.answers[field]);
      }
      hoursInput.value = String(state.answers.hours == null ? "" : state.answers.hours);
      minutesInput.value = String(state.answers.minutes == null ? "" : state.answers.minutes);
      for (const field of ["numberUp", "bothWinders"]) {
        for (const { value, chip } of fields[field].chips) {
          const on = state.answers[field] === value;
          chip.setAttribute("aria-checked", on ? "true" : "false");
          chip.setAttribute("aria-pressed", on ? "true" : "false");
        }
      }
    }

    function refresh() {
      offer();
      refreshDeadline();
      refreshRunning();
      refreshEstimate();
    }

    /* ---- Answers ---- */

    function setAnswer(field, value) {
      state.answers = Object.assign({}, state.answers, { [field]: value });
      calc.saveAnswers(storage, state.answers);
      refreshEstimate();
      say("");
    }

    form.addEventListener("input", event => {
      const input = event.target;
      const field = input && input.getAttribute ? input.getAttribute("data-field") : null;
      if (!field || !fields[field] || !fields[field].input) return;
      const raw = String(input.value == null ? "" : input.value);
      if (field === "hours" || field === "minutes") {
        // The wizard's selects hold whole numbers; the field does the same.
        const n = raw.trim() === "" ? 0 : Number(raw);
        setAnswer(field, Number.isFinite(n) ? n : raw);
        return;
      }
      setAnswer(field, raw);
    });
    form.addEventListener("click", event => {
      const chip = event.target && event.target.closest ? event.target.closest("[data-value]") : null;
      if (!chip) return;
      const field = chip.getAttribute("data-field");
      if (field === "numberUp") setAnswer(field, Number(chip.getAttribute("data-value")));
      if (field === "bothWinders") setAnswer(field, chip.getAttribute("data-value") === "true");
      refreshAnswers();
    });
    form.addEventListener("submit", event => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      use();
    });
    /* A click on Use is the form's submission in a browser (the button is
     * its submit button); a document without that wiring - the test
     * harness - reaches use() by the click alone. */
    useButton.addEventListener("click", event => {
      if (event && event.defaultPrevented) return;
      if (typeof useButton.form === "object" && useButton.form) return;
      use();
    });

    /* ---- The deadline ---- */

    function submitDeadline(at) {
      const result = apply(at);
      if (!result || !result.ok) {
        deadlineInput.setAttribute("aria-invalid", "true");
        say(result && result.message ? result.message : "The change could not be applied.", "error");
        return result;
      }
      deadlineInput.removeAttribute("aria-invalid");
      state.deadlineEditing = false;
      say(at === null ? "Changeover cleared." : `Changeover set to ${rundown.formatClock(at)}.`, "ok");
      return result;
    }

    function setDeadline() {
      if (!canApply()) { say("Changeover cannot be changed here: no application is connected to Station commands.", "error"); return null; }
      const value = String(deadlineInput.value || "").trim();
      if (value === "") return submitDeadline(null);
      const date = scheduling && typeof scheduling.parseChangeoverDate === "function"
        ? scheduling.parseChangeoverDate(value, new Date(now()))
        : null;
      if (!date) {
        deadlineInput.setAttribute("aria-invalid", "true");
        say("Enter a time as hours and minutes.", "error");
        return null;
      }
      return submitDeadline(date.getTime());
    }

    setButton.addEventListener("click", () => { setDeadline(); });
    clearButton.addEventListener("click", () => {
      if (!canApply()) { say("Changeover cannot be changed here: no application is connected to Station commands.", "error"); return; }
      deadlineInput.value = "";
      submitDeadline(null);
    });
    deadlineInput.addEventListener("input", () => { state.deadlineEditing = true; });
    deadlineInput.addEventListener("focus", () => { state.deadlineEditing = true; });
    /* Leaving the field keeps what was typed: the pointer moving to Set
     * blurs the field first, and a typed time thrown away on blur would
     * make Set clear the changeover instead. The field goes back to
     * following the job once it is empty, agrees with the job, or is
     * submitted. */
    deadlineInput.addEventListener("blur", () => {
      const value = String(deadlineInput.value || "").trim();
      if (value !== "" && value !== jobClock()) return;
      state.deadlineEditing = false;
      refreshDeadline();
    });
    deadlineInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      setDeadline();
    });

    /* ---- Use: the wizard's "Use HH:MM" ----
     * The estimated time goes to the application as the deadline; when it
     * is applied, the running production estimate is replaced by one
     * started now from these answers (or cleared, as the wizard does). */
    function use() {
      const estimated = refreshEstimate();
      if (!estimated) { say(validation()[0] ? validation()[0].message : "The answers do not add up to an estimate.", "error"); return null; }
      if (!canApply()) { say("Changeover cannot be changed here: no application is connected to Station commands.", "error"); return null; }
      const result = apply(estimated.estimatedAt);
      if (!result || !result.ok) {
        say(result && result.message ? result.message : "The change could not be applied.", "error");
        return result;
      }
      calc.accept(storage, state.answers, now());
      state.deadlineEditing = false;
      refreshRunning();
      say(`Changeover set to ${rundown.formatClock(estimated.estimatedAt)}.`, "ok");
      return result;
    }

    /* ---- Opening and closing ---- */

    function announce() {
      rootEl.classList.toggle("is-open", state.open);
      if (anchor && typeof anchor.setAttribute === "function") anchor.setAttribute("aria-expanded", state.open ? "true" : "false");
      onOpenChange(state.open);
    }

    function cancelFlight() {
      const flight = state.flight;
      state.flight = null;
      if (!flight) return;
      for (const animation of flight.animations) { try { animation.cancel(); } catch (error) { /* gone */ } }
    }

    function settled(animations) {
      return Promise.all(animations.filter(Boolean).map(a => (a.finished ? a.finished.catch(() => {}) : Promise.resolve())));
    }

    /* The flight: the surface is rendered where it stands and placed over
     * the readout - the transform that lays its box over the readout's, a
     * translate and one uniform scale from its top-left corner - then
     * released; the same arithmetic the Handbook uses out of its
     * launcher, on the same tokens. */
    function flightTransform() {
      if (!anchor || !transitionModule || typeof transitionModule.overlayTransform !== "function") return null;
      return transitionModule.overlayTransform(measure(anchor), measure(panel));
    }

    function firstField() {
      const empty = TYPED.find(({ field }) => String(state.answers[field] == null ? "" : state.answers[field]).trim() === "");
      return fields[empty ? empty.field : "lineSpeed"].input;
    }

    function open() {
      if (state.open && !(state.flight && state.flight.closing)) return false;
      const wasClosing = !!(state.flight && state.flight.closing);
      state.open = true;
      show(panel, true);
      refreshAnswers();
      refresh();
      say("");
      announce();
      if (wasClosing) {
        const flight = state.flight;
        flight.closing = false;
        for (const animation of flight.animations) { try { animation.reverse(); } catch (error) { /* ok */ } }
        settled(flight.animations).then(() => { if (state.flight === flight) state.flight = null; });
        return true;
      }
      cancelFlight();
      const transform = reducedMotion() ? null : flightTransform();
      if (transform) {
        const move = { duration: timing.move, easing: timing.ease, fill: "both" };
        const animations = [
          animate(panel, [{ transform, opacity: 0.3 }, { transform: "none", opacity: 1 }], move),
          animate(body, [{ opacity: 0 }, { opacity: 1 }],
            { duration: timing.settle, delay: Math.max(0, timing.move - timing.settle), easing: "ease-out", fill: "both" })
        ].filter(Boolean);
        const flight = { animations, closing: false };
        state.flight = flight;
        settled(animations).then(() => { if (state.flight === flight) state.flight = null; });
      }
      const target = firstField();
      if (target && typeof target.focus === "function") target.focus();
      return true;
    }

    function hideNow() {
      show(panel, false);
      cancelFlight();
    }

    function returnFocus() {
      if (anchor && typeof anchor.focus === "function") anchor.focus();
    }

    function close() {
      if (!state.open) return false;
      state.open = false;
      state.deadlineEditing = false;
      announce();
      if (reducedMotion() || !state.flight) {
        const transform = reducedMotion() ? null : flightTransform();
        if (!transform) { hideNow(); returnFocus(); return true; }
        const animations = [
          animate(panel, [{ transform: "none", opacity: 1 }, { transform, opacity: 0.3 }],
            { duration: timing.move, easing: timing.ease, fill: "both" })
        ].filter(Boolean);
        const flight = { animations, closing: true };
        state.flight = flight;
        settled(animations).then(() => { if (!state.open) hideNow(); });
        returnFocus();
        return true;
      }
      const flight = state.flight;
      flight.closing = true;
      for (const animation of flight.animations) { try { animation.reverse(); } catch (error) { /* ok */ } }
      settled(flight.animations).then(() => { if (!state.open) hideNow(); });
      returnFocus();
      return true;
    }

    function toggle() {
      return state.open ? close() : open();
    }

    closeButton.addEventListener("click", () => { close(); });
    panel.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      if (typeof event.preventDefault === "function") event.preventDefault();
      close();
    });

    /* ---- The surface ---- */

    /* Fed the same job the header is; redraws what depends on it. */
    function update(inputs) {
      state.job = inputs && inputs.job ? inputs.job : null;
      if (state.open) refresh();
    }

    refreshAnswers();
    refresh();
    // The readout is the launcher from the start: closed, and said so.
    if (anchor && typeof anchor.setAttribute === "function") anchor.setAttribute("aria-expanded", "false");

    return {
      element: rootEl,
      panel,
      open,
      close,
      toggle,
      update,
      refresh,
      use,
      setDeadline,
      isOpen: () => state.open,
      answers: () => Object.assign({}, state.answers),
      estimate: currentEstimate,
      getTiming: () => Object.assign({}, timing)
    };
  }

  return Object.freeze({ DEFAULT_TIMING, TYPED, remainingText, create });
});
