/* The job's cards over the working pane: changeover, line rate,
 * production and scrap pounds.
 *
 * Each card states its value and opens an editor when clicked; Enter or
 * blur commits, Escape cancels. Every write is one of the application's
 * own job commands - setChangeover, setLineRate, setProductionPounds,
 * setScrapPounds - dispatched on the command bridge the boot hands in.
 * A refusal keeps the editor open and shows the application's own words.
 * This is the second of the two files that may say `.dispatch(`.
 *
 * The changeover is entered as a clock time and sent as an instant,
 * parsed by scheduling.js's own parser so Slate and the application
 * agree on which day a clock time means. The application refuses an
 * instant more than a minute in the past or more than a day away.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("../station/station-rundown.js")
    : (root && root.PolynStationRundown);
  const scheduling = typeof require === "function"
    ? (function () { try { return require("../scheduling.js"); } catch (error) { return null; } })()
    : (root && root.PolynScheduling);
  const api = factory(rundown, scheduling);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateStatCards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rundownModule, schedulingModule) {
  "use strict";

  const FIELDS = Object.freeze(["changeover", "rate", "production", "scrap"]);
  const COMMAND = Object.freeze({
    changeover: "setChangeover",
    rate: "setLineRate",
    production: "setProductionPounds",
    scrap: "setScrapPounds"
  });
  const LABEL = Object.freeze({ changeover: "Changeover", rate: "Line rate", production: "Production", scrap: "Scrap" });
  const UNIT = Object.freeze({ changeover: "", rate: "lb/hr", production: "lb", scrap: "lb" });
  const NOT_SET = "Not set";
  const EMPTY = "—";
  const CHANGED_ELSEWHERE = "Changed on another device";
  const BAD_TIME = "Enter a time as hours and minutes.";

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

  const READ_ONLY_REASON = "Slate is read-only on this line. Turn Read-only off in Settings to make changes.";

  function able(commands, field, options) {
    if (options && options.readOnly) return false;
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable()
      && typeof commands.capabilities === "function" && commands.capabilities().includes(COMMAND[field]));
  }

  function reason(commands, field, options) {
    if (options && options.readOnly) return READ_ONLY_REASON;
    if (!commands || typeof commands.isAvailable !== "function" || !commands.isAvailable()) return "no application is connected to Slate commands.";
    if (!able(commands, field)) return `the application does not offer ${COMMAND[field]} from Slate.`;
    return "";
  }

  function pounds(value) {
    const number = Number(value);
    if (value === "" || value === null || value === undefined || !Number.isFinite(number) || number <= 0) return null;
    return number;
  }

  /* What each card shows for a job at `now`: the value line and the line
   * under it. Pure, so the formatting is tested rather than watched. */
  function display(field, job, now) {
    const state = job || {};
    if (field === "changeover") {
      const resolved = rundownModule.resolveChangeover(state, { now });
      if (resolved.at === null) return { value: NOT_SET, sub: "", stale: false, at: null };
      const remaining = resolved.at - now;
      return {
        value: rundownModule.formatClock(resolved.at),
        sub: resolved.stale ? "Confirm: set a while ago" : (remaining < 0 ? "Passed" : `in ${rundownModule.formatRemaining(remaining)}`),
        stale: resolved.stale,
        at: resolved.at
      };
    }
    if (field === "rate") {
      const rate = Number.isFinite(state.lineRate) && state.lineRate > 0 ? state.lineRate : 0;
      return { value: rate > 0 ? `${rate.toLocaleString("en-US", { maximumFractionDigits: 2 })} lb/hr` : NOT_SET, sub: rate > 0 ? "" : "Output per hour", stale: false, at: null };
    }
    const amount = pounds(field === "production" ? state.prodResinLb : state.scrapResinLb);
    return { value: amount === null ? EMPTY : `${amount.toLocaleString("en-US", { maximumFractionDigits: 1 })} lb`, sub: amount === null ? "Not entered" : "", stale: false, at: null };
  }

  /* The raw text an editor opens with. */
  function draftFor(field, job, now) {
    const state = job || {};
    if (field === "changeover") {
      const resolved = rundownModule.resolveChangeover(state, { now });
      if (resolved.at === null) return "";
      const date = new Date(resolved.at);
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }
    if (field === "rate") return Number.isFinite(state.lineRate) && state.lineRate > 0 ? String(state.lineRate) : "";
    const amount = pounds(field === "production" ? state.prodResinLb : state.scrapResinLb);
    return amount === null ? "" : String(amount);
  }

  /* The request a field's text becomes. Empty clears - a zero output, no
   * changeover, no pounds - as the floor UI's own fields read an emptied
   * value. Numbers go as the text entered: the contract accepts a string
   * with separators and normalises it. */
  function requestFor(field, raw, now) {
    const value = String(raw == null ? "" : raw).trim();
    if (field === "changeover") {
      if (value === "") return { command: COMMAND.changeover, args: { at: null } };
      const date = schedulingModule && typeof schedulingModule.parseChangeoverDate === "function"
        ? schedulingModule.parseChangeoverDate(value, new Date(now))
        : null;
      if (!date) return { error: BAD_TIME };
      return { command: COMMAND.changeover, args: { at: date.getTime() } };
    }
    if (field === "rate") return { command: COMMAND.rate, args: { lineRate: value === "" ? 0 : value } };
    return { command: COMMAND[field], args: { pounds: value === "" ? 0 : value } };
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {function} ctx.commands      () -> the command bridge, or null
   * @param {function} [ctx.onCommitted]
   * @param {function} [ctx.now]
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const readOnly = typeof settings.readOnly === "function" ? settings.readOnly : () => false;
    const guard = () => ({ readOnly: !!readOnly() });

    const rootEl = element(doc, "div", "slate-cards");
    const cards = {};
    let job = null;
    let editing = null;

    for (const field of FIELDS) {
      const card = element(doc, "div", `slate-card slate-card--${field}`, { "data-field": field });
      const trigger = element(doc, "button", "slate-card__trigger", { type: "button", "aria-expanded": "false" });
      trigger.appendChild(text(doc, "span", "slate-card__label", LABEL[field]));
      const value = text(doc, "span", "slate-card__value", EMPTY);
      const sub = text(doc, "span", "slate-card__sub", "");
      trigger.appendChild(value);
      trigger.appendChild(sub);
      card.appendChild(trigger);

      const editor = element(doc, "div", "slate-card__editor", { hidden: "" });
      const input = element(doc, "input", "slate-card__input", {
        type: field === "changeover" ? "time" : "text",
        inputmode: field === "changeover" ? "numeric" : "decimal",
        "aria-label": LABEL[field]
      });
      editor.appendChild(input);
      if (UNIT[field]) editor.appendChild(text(doc, "span", "slate-card__unit", UNIT[field]));
      card.appendChild(editor);
      const note = element(doc, "p", "slate-card__note", { role: "status", hidden: "" });
      card.appendChild(note);
      rootEl.appendChild(card);
      cards[field] = { card, trigger, value, sub, editor, input, note };
    }

    function say(field, message, invalid) {
      const c = cards[field];
      c.note.textContent = message || "";
      show(c.note, !!message);
      if (invalid) c.input.setAttribute("aria-invalid", "true");
      else c.input.removeAttribute("aria-invalid");
    }

    function paint() {
      const commands = commandsFor();
      for (const field of FIELDS) {
        const c = cards[field];
        const shown = display(field, job, now());
        c.value.textContent = shown.value;
        c.sub.textContent = shown.sub;
        c.card.classList.toggle("is-stale", !!shown.stale);
        c.card.classList.toggle("is-unset", shown.value === NOT_SET || shown.value === EMPTY);
        const can = able(commands, field, guard());
        c.card.classList.toggle("is-readonly", !can);
        c.trigger.setAttribute("aria-disabled", can ? "false" : "true");
        c.trigger.setAttribute("title", can ? `Change the ${LABEL[field].toLowerCase()}` : `${LABEL[field]} cannot be changed here: ${reason(commands, field, guard())}`);
      }
    }

    function open(field) {
      if (editing === field) return;
      if (editing) close();
      const commands = commandsFor();
      if (!able(commands, field, guard())) {
        say(field, `${LABEL[field]} cannot be changed here: ${reason(commands, field, guard())}`, false);
        return;
      }
      editing = field;
      const c = cards[field];
      c.input.value = draftFor(field, job, now());
      c.card.classList.add("is-editing");
      c.trigger.setAttribute("aria-expanded", "true");
      show(c.editor, true);
      say(field, "", false);
      if (typeof c.input.focus === "function") c.input.focus();
      if (typeof c.input.select === "function") c.input.select();
    }

    function close(options) {
      const field = editing;
      if (!field) return;
      editing = null;
      const c = cards[field];
      c.card.classList.remove("is-editing");
      c.trigger.setAttribute("aria-expanded", "false");
      show(c.editor, false);
      say(field, "", false);
      if (options && options.refocus && typeof c.trigger.focus === "function") c.trigger.focus();
    }

    function commit() {
      const field = editing;
      if (!field) return null;
      const c = cards[field];
      if (!able(commandsFor(), field, guard())) {
        say(field, `${LABEL[field]} cannot be changed here: ${reason(commandsFor(), field, guard())}`, true);
        return { ok: false, code: "unavailable", message: READ_ONLY_REASON };
      }
      const request = requestFor(field, c.input.value, now());
      if (request.error) {
        say(field, request.error, true);
        return { ok: false, code: "bad_argument", message: request.error };
      }
      const commands = commandsFor();
      const result = commands && typeof commands.dispatch === "function"
        ? commands.dispatch(request.command, request.args)
        : { ok: false, code: "unavailable", message: "No application is connected to Slate commands." };
      if (result && result.ok) {
        if (result.changed) onCommitted(result);
        close({ refocus: true });
      } else {
        say(field, (result && result.message) || "The application refused the change.", true);
      }
      return result;
    }

    for (const field of FIELDS) {
      const c = cards[field];
      c.trigger.addEventListener("click", () => open(field));
      c.input.addEventListener("keydown", event => {
        if (!event) return;
        if (event.key === "Enter") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          close({ refocus: true });
        }
      });
      c.input.addEventListener("blur", () => { if (editing === field) commit(); });
    }

    /** New job state. A card being edited keeps its draft; if the change
     * came from elsewhere it is told so. */
    function update(resolved, meta) {
      const options = meta || {};
      job = resolved ? resolved.job : null;
      paint();
      if (editing && !options.own) say(editing, CHANGED_ELSEWHERE, false);
    }

    /** The clock moved: the changeover's "in 2h 26m" walks. */
    function refresh() {
      paint();
    }

    return Object.freeze({
      element: rootEl,
      update,
      refresh,
      open,
      close,
      commit,
      editing: () => editing,
      card: field => cards[field] || null
    });
  }

  return Object.freeze({ FIELDS, COMMAND, LABEL, UNIT, NOT_SET, EMPTY, CHANGED_ELSEWHERE, BAD_TIME, READ_ONLY_REASON, able, reason, display, draftFor, requestFor, create });
});
