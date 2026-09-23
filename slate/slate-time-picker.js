/* The changeover time picker: a popover under the Changeover card in
 * place of a typed field.
 *
 * Twelve hour tiles, twelve minute tiles in fives with a field for the
 * exact minute, AM and PM, a line that says what the choice means ("5:20
 * PM · in 4h 10m", read the way the card reads a clock time, so a time
 * already passed today means tomorrow), then Set, Clear and Cancel. It
 * opens marked with the changeover as it stands, or with the next five
 * minutes when none is set.
 *
 * It dispatches nothing. Set hands "HH:MM" - and Clear "" - to `apply`,
 * the card's own setChangeover path (slate-stat-cards.js), which reads
 * the clock time as it always has. Escape, Cancel, the close or a press
 * outside close it with nothing sent.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateTimePicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* A press outside, by the shared rule - a finger closes on a still
   * release, a mouse on the press - and the Back key's stack
   * (slate-dismiss.js). */
  function dismissal(target, inside, close) {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.outside === "function" ? shared.outside(target, inside, close) : Object.freeze({ start() {}, stop() {}, isOn: () => false });
  }

  const TITLE = "Changeover time";
  const SET = "Set";
  const CLEAR = "Clear";
  const CANCEL = "Cancel";
  const CALCULATE = "Calculate";
  const CLOSE = "Close";
  const BAD_MINUTE = "Minutes must be 0 to 59.";
  const UNAVAILABLE = "The changeover cannot be set on this page.";
  const STEP = 5;

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

  const pad = value => String(value).padStart(2, "0");

  /** "HH:MM" (24-hour) from a twelve-hour choice. */
  function toClock(hour12, minute, period) {
    const hour = period === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
    return `${pad(hour)}:${pad(minute)}`;
  }

  /** The twelve-hour choice "HH:MM" names, or null for anything else. */
  function fromClock(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? "" : value).trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour12: hour % 12 || 12, minute, period: hour >= 12 ? "PM" : "AM" };
  }

  /** The next five minutes after `at`, as a twelve-hour choice. */
  function nextStep(at) {
    const date = new Date(at);
    const rounded = new Date(at + (STEP - (date.getMinutes() % STEP)) * 60000);
    rounded.setSeconds(0, 0);
    return fromClock(`${pad(rounded.getHours())}:${pad(rounded.getMinutes())}`);
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {function} [options.now]
   * @param {function} options.apply       ("HH:MM" | "") -> the card's result for setChangeover
   * @param {function} [options.preview]   ("HH:MM") -> the instant it means, or null
   * @param {function} [options.clock]     (at) -> "5:20 PM"
   * @param {function} [options.remaining] (ms) -> "4h 10m"
   * @param {function} [options.able]      () -> { ok, reason } for Set and Clear
   * @param {function} [options.onChange]  told (open) whenever it opens or closes
   * @param {Element} [options.anchor]     what opens it: a press there is not "outside", and focus returns to it
   * @param {function} [options.calculate] opens the changeover's calculator: offered as a key on
   *        a phone, whose card has no room for the calculator's own button (time-picker.css)
   * @param {object} [options.view]        the document, for a press outside
   */
  function create(doc, options) {
    const settings = options || {};
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const apply = typeof settings.apply === "function" ? settings.apply : () => ({ ok: false, code: "unavailable", message: UNAVAILABLE });
    const preview = typeof settings.preview === "function" ? settings.preview : () => null;
    const clock = typeof settings.clock === "function" ? settings.clock : at => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const remaining = typeof settings.remaining === "function" ? settings.remaining : ms => `${Math.round(ms / 60000)}m`;
    const ableFor = typeof settings.able === "function" ? settings.able : () => ({ ok: true, reason: "" });
    const onChange = typeof settings.onChange === "function" ? settings.onChange : () => {};
    const view = settings.view || doc;

    const rootEl = element(doc, "div", "slate-time", { role: "dialog", "aria-label": TITLE, hidden: "" });
    const head = element(doc, "div", "slate-time__head");
    head.appendChild(text(doc, "span", "slate-time__title", TITLE));
    const previewLine = text(doc, "span", "slate-time__preview", "");
    head.appendChild(previewLine);
    const closeButton = element(doc, "button", "slate-panel__close slate-time__close", { type: "button", "aria-label": CLOSE, title: CLOSE });
    closeButton.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    head.appendChild(closeButton);
    rootEl.appendChild(head);

    const hours = element(doc, "div", "slate-time__tiles slate-time__hours", { role: "radiogroup", "aria-label": "Hour" });
    const hourTiles = new Map();
    for (let hour = 1; hour <= 12; hour += 1) {
      const tile = text(doc, "button", "slate-time__tile", String(hour), { type: "button", role: "radio", "aria-checked": "false", "data-time-hour": String(hour) });
      hourTiles.set(hour, tile);
      hours.appendChild(tile);
    }
    rootEl.appendChild(hours);

    const minutes = element(doc, "div", "slate-time__tiles slate-time__minutes", { role: "radiogroup", "aria-label": "Minute" });
    const minuteTiles = new Map();
    for (let minute = 0; minute < 60; minute += STEP) {
      const tile = text(doc, "button", "slate-time__tile", pad(minute), { type: "button", role: "radio", "aria-checked": "false", "data-time-minute": String(minute) });
      minuteTiles.set(minute, tile);
      minutes.appendChild(tile);
    }
    rootEl.appendChild(minutes);

    const row = element(doc, "div", "slate-time__row");
    const periods = element(doc, "div", "slate-time__tiles slate-time__periods", { role: "radiogroup", "aria-label": "AM or PM" });
    const periodTiles = new Map();
    for (const period of ["AM", "PM"]) {
      const tile = text(doc, "button", "slate-time__tile", period, { type: "button", role: "radio", "aria-checked": "false", "data-time-period": period });
      periodTiles.set(period, tile);
      periods.appendChild(tile);
    }
    row.appendChild(periods);
    const exact = element(doc, "div", "slate-time__exact");
    exact.appendChild(text(doc, "span", "slate-time__exact-label", "Exact minute"));
    const minuteField = element(doc, "input", "slate-time__minute", { type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": "Exact minute", "data-time-field": "minute" });
    exact.appendChild(minuteField);
    row.appendChild(exact);
    rootEl.appendChild(row);

    const errorLine = element(doc, "p", "slate-time__error", { role: "alert", hidden: "" });
    rootEl.appendChild(errorLine);
    const actions = element(doc, "div", "slate-time__actions");
    const clearButton = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet slate-time__clear", CLEAR, { type: "button", "data-time": "clear" });
    const cancelButton = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet", CANCEL, { type: "button", "data-time": "cancel" });
    const setButton = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--promote", SET, { type: "button", "data-time": "set" });
    if (typeof settings.calculate === "function") {
      const calcButton = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet slate-time__calc", CALCULATE, { type: "button", "data-time-calc": "" });
      calcButton.addEventListener("click", () => { close(); settings.calculate(); });
      actions.appendChild(calcButton);
    }
    actions.appendChild(clearButton);
    actions.appendChild(cancelButton);
    actions.appendChild(setButton);
    rootEl.appendChild(actions);

    const state = { open: false, hour12: 12, minute: 0, period: "PM", hadValue: false };

    function note(message) {
      errorLine.textContent = message || "";
      show(errorLine, !!message);
    }

    function value() {
      return toClock(state.hour12, state.minute, state.period);
    }

    function paint() {
      for (const [hour, tile] of hourTiles) { const on = hour === state.hour12; tile.setAttribute("aria-checked", on ? "true" : "false"); tile.classList.toggle("is-selected", on); }
      for (const [minute, tile] of minuteTiles) { const on = minute === state.minute; tile.setAttribute("aria-checked", on ? "true" : "false"); tile.classList.toggle("is-selected", on); }
      for (const [period, tile] of periodTiles) { const on = period === state.period; tile.setAttribute("aria-checked", on ? "true" : "false"); tile.classList.toggle("is-selected", on); }
      if (String(minuteField.value) !== pad(state.minute)) minuteField.value = pad(state.minute);
      const at = preview(value());
      const until = at === null ? null : at - now();
      previewLine.textContent = at === null ? "" : `${clock(at)} · ${until < 0 ? "passed" : `in ${remaining(until)}`}`;
      const able = ableFor();
      for (const [button, what] of [[setButton, "set"], [clearButton, "clear"]]) {
        button.setAttribute("data-able", able.ok ? "true" : "false");
        button.setAttribute("title", able.ok ? (what === "set" ? `Set the changeover to ${at === null ? value() : clock(at)}` : "Clear the changeover") : `Cannot change the changeover here: ${able.reason}`);
      }
      show(clearButton, state.hadValue);
    }

    // The exact minute: taken when it is a whole number of minutes,
    // refused with the wizard's kind of words otherwise.
    function takeMinute() {
      const raw = String(minuteField.value).trim();
      const minute = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) { note(BAD_MINUTE); if (typeof minuteField.focus === "function") minuteField.focus(); return false; }
      state.minute = minute;
      note("");
      return true;
    }

    function send(what) {
      const button = what === "clear" ? clearButton : setButton;
      if (button.getAttribute("data-able") !== "true") { note(button.getAttribute("title") || UNAVAILABLE); return { ok: false, code: "unavailable", message: ableFor().reason }; }
      if (what === "set" && !takeMinute()) return null;
      const result = apply(what === "clear" ? "" : value());
      if (result && result.ok) { close(); return result; }
      note((result && result.message) || "The application refused the change.");
      return result;
    }

    const outsideCloser = dismissal(view, node => rootEl.contains(node) || !!(settings.anchor && settings.anchor.contains(node)), () => close());

    /** Open marked with "HH:MM", or the next five minutes for anything else. */
    function open(current) {
      const choice = fromClock(current) || nextStep(now());
      state.hour12 = choice.hour12;
      state.minute = choice.minute;
      state.period = choice.period;
      state.hadValue = !!fromClock(current);
      if (state.open) { paint(); return; }
      state.open = true;
      note("");
      show(rootEl, true);
      paint();
      outsideCloser.start();
      onChange(true);
      const focused = hourTiles.get(state.hour12);
      if (focused && typeof focused.focus === "function") focused.focus();
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      show(rootEl, false);
      note("");
      outsideCloser.stop();
      onChange(false);
      if (settings.anchor && typeof settings.anchor.focus === "function") settings.anchor.focus();
    }

    rootEl.addEventListener("click", event => {
      const target = event && event.target;
      if (!target || typeof target.closest !== "function") return;
      const hour = target.closest("[data-time-hour]");
      if (hour && rootEl.contains(hour)) { state.hour12 = Number(hour.getAttribute("data-time-hour")); note(""); paint(); return; }
      const minute = target.closest("[data-time-minute]");
      if (minute && rootEl.contains(minute)) { state.minute = Number(minute.getAttribute("data-time-minute")); note(""); paint(); return; }
      const period = target.closest("[data-time-period]");
      if (period && rootEl.contains(period)) { state.period = period.getAttribute("data-time-period"); note(""); paint(); return; }
      const action = target.closest("[data-time]");
      if (!action || !rootEl.contains(action)) return;
      const what = action.getAttribute("data-time");
      if (what === "cancel") close();
      else send(what);
    });
    closeButton.addEventListener("click", () => close());
    minuteField.addEventListener("input", () => { const raw = String(minuteField.value).trim(); const minute = Number(raw); if (raw !== "" && Number.isInteger(minute) && minute >= 0 && minute <= 59) { state.minute = minute; paint(); } });
    rootEl.addEventListener("keydown", event => {
      if (!event) return;
      if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); close(); return; }
      if (event.key === "Enter" && event.target === minuteField) { if (typeof event.preventDefault === "function") event.preventDefault(); send("set"); }
    });

    return Object.freeze({
      element: rootEl,
      open,
      close,
      isOpen: () => state.open,
      value,
      choice: () => ({ hour12: state.hour12, minute: state.minute, period: state.period }),
      set: () => send("set"),
      clear: () => send("clear")
    });
  }

  return Object.freeze({ TITLE, SET, CLEAR, CANCEL, BAD_MINUTE, UNAVAILABLE, STEP, toClock, fromClock, nextStep, create });
});
