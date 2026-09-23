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
 *
 * The Changeover card is different: its value opens no typed field but a
 * picker under the card (slate-time-picker.js) - hour and minute tiles,
 * AM or PM - whose Set hands a clock time to this file's own setChangeover
 * path, read as the field's text always was. Beside its value stands the
 * changeover calculator - the floor UI's wizard as another popover
 * (slate-changeover.js) - whose Use hands an estimate to the same path;
 * the Line rate card carries its own calculator the same way
 * (slate-line-rate.js), whose Use hands pounds per hour to setLineRate.
 * The picker, the calculators and the cards' editors never stand open
 * together.
 *
 * Each card stands in a slot of the row. A slot is a mount: the boot runs
 * a swap in the Scrap card's (slate-sections.js), so a tool small enough
 * for a card - the pressure converter - takes its place and hands it
 * back. This file knows nothing of the tool; it only leaves the slot.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("../station/station-rundown.js")
    : (root && root.PolynStationRundown);
  const scheduling = typeof require === "function"
    ? (function () { try { return require("../scheduling.js"); } catch (error) { return null; } })()
    : (root && root.PolynScheduling);
  const changeover = typeof require === "function"
    ? require("./slate-changeover.js")
    : (root && root.PolynSlateChangeover);
  const timePicker = typeof require === "function"
    ? require("./slate-time-picker.js")
    : (root && root.PolynSlateTimePicker);
  const lineRate = typeof require === "function"
    ? require("./slate-line-rate.js")
    : (root && root.PolynSlateLineRate);
  const api = factory(rundown, scheduling, changeover, timePicker, lineRate);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateStatCards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rundownModule, schedulingModule, changeoverModule, timePickerModule, lineRateModule) {
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
   * @param {object} [ctx.estimate]          changeover-estimate.js, for the changeover calculator
   * @param {object} [ctx.estimateStorage]   where its answers live
   * @param {object} [ctx.lineRate]          line-rate-estimate.js, for the line rate calculator
   * @param {object} [ctx.lineRateStorage]   where its answers live
   * @param {function} [ctx.resins]          () -> the resin catalog, for the blend average
   * @param {function} [ctx.say]
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const readOnly = typeof settings.readOnly === "function" ? settings.readOnly : () => false;
    const guard = () => ({ readOnly: !!readOnly() });
    const sayOut = typeof settings.say === "function" ? settings.say : () => {};

    const rootEl = element(doc, "div", "slate-cards");
    const cards = {};
    const slots = {};
    let job = null;
    let editing = null;
    let picker = null;
    let current = null;
    const calculators = {};
    const resins = typeof settings.resins === "function" ? settings.resins : () => [];

    for (const field of FIELDS) {
      const slot = element(doc, "div", "slate-cards__slot", { "data-slot": field });
      slots[field] = slot;
      const card = element(doc, "div", `slate-card slate-card--${field}`, { "data-field": field });
      const trigger = element(doc, "button", "slate-card__trigger", { type: "button", "aria-expanded": "false" });
      trigger.appendChild(text(doc, "span", "slate-card__label", LABEL[field]));
      const value = text(doc, "span", "slate-card__value", EMPTY);
      const sub = text(doc, "span", "slate-card__sub", "");
      trigger.appendChild(value);
      trigger.appendChild(sub);
      card.appendChild(trigger);

      // The typed editor, for every card but the changeover's when the
      // picker is here to take its place.
      const typed = !(field === "changeover" && timePickerModule);
      let editor = null;
      let input = null;
      if (typed) {
        editor = element(doc, "div", "slate-card__editor", { hidden: "" });
        input = element(doc, "input", "slate-card__input", {
          type: field === "changeover" ? "time" : "text",
          inputmode: field === "changeover" ? "numeric" : "decimal",
          "aria-label": LABEL[field]
        });
        editor.appendChild(input);
        if (UNIT[field]) editor.appendChild(text(doc, "span", "slate-card__unit", UNIT[field]));
        // Save and Cancel, shown only under a finger (components/stat-cards.css):
        // there Escape is out of reach and a blur commits, so the way out
        // without a change has to be a button that wins over the blur.
        const actions = element(doc, "div", "slate-card__actions");
        actions.appendChild(text(doc, "button", "slate-card__action slate-card__action--cancel", "Cancel", { type: "button", "data-slate-card-action": "cancel" }));
        actions.appendChild(text(doc, "button", "slate-card__action slate-card__action--save", "Save", { type: "button", "data-slate-card-action": "save" }));
        editor.appendChild(actions);
        card.appendChild(editor);
      }
      const note = element(doc, "p", "slate-card__note", { role: "status", hidden: "" });
      card.appendChild(note);
      slot.appendChild(card);
      rootEl.appendChild(slot);
      cards[field] = { card, trigger, value, sub, editor, input, note, calc: null };
    }

    // The picker, under the Changeover card, in the typed field's place.
    if (timePickerModule) {
      const c = cards.changeover;
      picker = timePickerModule.create(doc, {
        now,
        clock: at => rundownModule.formatClock(at),
        remaining: ms => rundownModule.formatRemaining(ms),
        preview: clockTime => { const request = requestFor("changeover", clockTime, now()); return request.error || request.args.at === null ? null : request.args.at; },
        able: () => ({ ok: able(commandsFor(), "changeover", guard()), reason: reason(commandsFor(), "changeover", guard()) }),
        apply: clockTime => {
          const request = requestFor("changeover", clockTime, now());
          if (request.error) return { ok: false, code: "bad_argument", message: request.error };
          return apply("changeover", request);
        },
        anchor: c.trigger,
        view: doc,
        onChange: on => {
          c.card.classList.toggle("is-picking", on);
          c.trigger.setAttribute("aria-expanded", on ? "true" : "false");
          if (!on) say("changeover", "", false);
        }
      });
      c.card.appendChild(picker.element);
    }

    /* A calculator on a card: a button beside the value and the popover
     * under the card, built by the module handed in. Use goes through
     * apply(), the same command the card's editor sends. Whatever else
     * is open - an editor, the picker, the other calculator - closes
     * first: one thing open at a time. */
    function attachCalculator(field, module, build) {
      const c = cards[field];
      const button = element(doc, "button", "slate-card__calc", { type: "button", "aria-label": module.OPEN_LABEL, title: module.OPEN_LABEL, "aria-haspopup": "dialog", "aria-expanded": "false" });
      button.appendChild(module.glyph(doc));
      c.card.appendChild(button);
      c.card.classList.add("has-calc");
      const popover = build(button);
      c.card.appendChild(popover.element);
      c.calc = button;
      calculators[field] = popover;
      button.addEventListener("click", () => {
        // A refused draft stays with its words: the blur that came before
        // this tap already tried it, and closing would lose both.
        if (editing && refused === editing) return;
        if (editing) close();
        if (picker) picker.close();
        for (const other of Object.keys(calculators)) if (other !== field) calculators[other].close();
        popover.toggle();
      });
      return popover;
    }

    if (changeoverModule && settings.estimate) {
      attachCalculator("changeover", changeoverModule, button => changeoverModule.create(doc, {
        estimate: settings.estimate,
        storage: settings.estimateStorage || null,
        now,
        clock: at => rundownModule.formatClock(at),
        able: () => ({ ok: able(commandsFor(), "changeover", guard()), reason: reason(commandsFor(), "changeover", guard()) }),
        apply: at => apply("changeover", { command: COMMAND.changeover, args: { at } }),
        say: sayOut,
        anchor: button,
        view: doc,
        onChange: on => button.setAttribute("aria-expanded", on ? "true" : "false")
      }));
    }

    if (lineRateModule && settings.lineRate) {
      attachCalculator("rate", lineRateModule, button => lineRateModule.create(doc, {
        estimate: settings.lineRate,
        storage: settings.lineRateStorage || null,
        blendDensity: () => settings.lineRate.blendDensity(lineRateModule.blendItems(current, resins())),
        able: () => ({ ok: able(commandsFor(), "rate", guard()), reason: reason(commandsFor(), "rate", guard()) }),
        apply: lbPerHour => apply("rate", { command: COMMAND.rate, args: { lineRate: lbPerHour } }),
        say: sayOut,
        anchor: button,
        view: doc,
        onChange: on => button.setAttribute("aria-expanded", on ? "true" : "false")
      }));
    }

    function say(field, message, invalid) {
      const c = cards[field];
      c.note.textContent = message || "";
      show(c.note, !!message);
      if (!c.input) return;
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

    // The field whose last commit was refused, while its editor stays open.
    let refused = null;
    // Cancel was pressed: the blur its press causes must not commit.
    let cancelling = false;

    function open(field) {
      if (editing === field) return;
      if (editing) close();
      for (const popover of Object.values(calculators)) if (popover.isOpen()) popover.close();
      const commands = commandsFor();
      if (!able(commands, field, guard())) {
        say(field, `${LABEL[field]} cannot be changed here: ${reason(commands, field, guard())}`, false);
        return;
      }
      // The changeover opens its picker, marked with the time as it stands.
      if (field === "changeover" && picker) {
        say(field, "", false);
        picker.open(draftFor(field, job, now()));
        return;
      }
      if (picker && picker.isOpen()) picker.close();
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
      refused = null;
      cancelling = false;
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
        refused = field;
        say(field, request.error, true);
        return { ok: false, code: "bad_argument", message: request.error };
      }
      const result = apply(field, request);
      if (result && result.ok) close({ refocus: true });
      else { refused = field; say(field, (result && result.message) || "The application refused the change.", true); }
      return result;
    }

    /* One request to the application, told to the boot when it changed
     * something. The editors and the calculator both come through here. */
    function apply(field, request) {
      if (!able(commandsFor(), field, guard())) return { ok: false, code: "unavailable", message: reason(commandsFor(), field, guard()) };
      const commands = commandsFor();
      const result = commands && typeof commands.dispatch === "function"
        ? commands.dispatch(request.command, request.args)
        : { ok: false, code: "unavailable", message: "No application is connected to Slate commands." };
      if (result && result.ok && result.changed) onCommitted(result);
      return result;
    }

    for (const field of FIELDS) {
      const c = cards[field];
      c.trigger.addEventListener("click", () => { if (field === "changeover" && picker && picker.isOpen()) { picker.close(); return; } open(field); });
      if (!c.input) continue;
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
      c.input.addEventListener("blur", () => { if (editing === field && !cancelling) commit(); });
      // A Cancel press abandoned before its click (the finger slid off)
      // must not leave the blur unable to commit: the field taken again
      // clears it.
      c.input.addEventListener("focus", () => { cancelling = false; });
      const cancelButton = c.editor.querySelector("[data-slate-card-action='cancel']");
      const saveButton = c.editor.querySelector("[data-slate-card-action='save']");
      const hold = event => { cancelling = true; if (event && typeof event.preventDefault === "function") event.preventDefault(); };
      cancelButton.addEventListener("pointerdown", hold);
      cancelButton.addEventListener("mousedown", hold);
      cancelButton.addEventListener("click", () => { if (editing === field) close({ refocus: true }); });
      // Save's press keeps the field's focus too, so its click is the one commit.
      const keep = event => { if (event && typeof event.preventDefault === "function") event.preventDefault(); };
      saveButton.addEventListener("pointerdown", keep);
      saveButton.addEventListener("mousedown", keep);
      saveButton.addEventListener("click", () => { if (editing === field) commit(); });
    }

    /** New job state. A card being edited keeps its draft - and the
     * picker its choice; if the change came from elsewhere it is told so. */
    function update(resolved, meta) {
      const options = meta || {};
      current = resolved || null;
      job = resolved ? resolved.job : null;
      paint();
      if (editing && !options.own) say(editing, CHANGED_ELSEWHERE, false);
      if (picker && picker.isOpen() && !options.own) say("changeover", CHANGED_ELSEWHERE, false);
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
      card: field => cards[field] || null,
      slot: field => slots[field] || null,
      calculator: field => calculators[field || "changeover"] || null,
      picker: () => picker
    });
  }

  return Object.freeze({ FIELDS, COMMAND, LABEL, UNIT, NOT_SET, EMPTY, CHANGED_ELSEWHERE, BAD_TIME, READ_ONLY_REASON, able, reason, display, draftFor, requestFor, create });
});
