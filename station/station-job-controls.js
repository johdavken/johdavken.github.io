/* The Station job controls: the running job's two line-wide settings, and
 * the timeline's scale, as three compact items in the header.
 *
 *   OUTPUT 850 lb/hr     the line's output, edited in place
 *   CHANGEOVER 3:28 AM   the changeover deadline, edited in place
 *   6H | 12H             the run-down timeline's window
 *
 * A temporary home. The header is where these can sit without a layout of
 * their own while the timeline is new; they are visually subordinate to
 * the line console beside them and to the stage below.
 *
 * WHERE THEY WRITE
 *
 * Output and changeover are the application's own job state - the same
 * two fields the floor UI's gauge tiles and status bar edit - and reach it
 * the way every Station edit does: one command through the command bridge
 * this module is handed (setLineRate, setChangeover), executed by the
 * application, which saves, syncs and publishes; the header then shows
 * what the application holds, never what was typed. This is the THIRD
 * Station file that dispatches (station-isolation.test.js names it), and
 * it dispatches only on the bridge it was given.
 *
 * The changeover is stated to the application as an instant. The operator
 * enters a clock time; the same reading the application makes of a clock
 * time - today, or tomorrow once it has passed, scheduling.js's own
 * parseChangeoverDate - turns it into the instant, so what Station asks
 * for is what the floor UI's field would have stored.
 *
 * The window is not job state. It is a scale for this screen, held here
 * and told to the timeline; it goes nowhere else.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("./station-rundown.js")
    : (root && root.PolynStationRundown);
  const scheduling = typeof require === "function"
    ? (function () { try { return require("../scheduling.js"); } catch (error) { return null; } })()
    : (root && root.PolynScheduling);
  const api = factory(rundown, scheduling);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationJobControls = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rundownModule, schedulingModule) {
  "use strict";

  const COMMAND = Object.freeze({ output: "setLineRate", changeover: "setChangeover" });
  const LABEL = Object.freeze({ output: "Output", changeover: "Changeover" });

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
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

  /* Whether a command is on offer from the bridge Station was handed - the
   * same question the hopper controls ask, asked the same way. */
  function able(commands, field) {
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable()
      && typeof commands.capabilities === "function" && commands.capabilities().includes(COMMAND[field]));
  }

  function reason(commands, field) {
    if (!commands || typeof commands.isAvailable !== "function" || !commands.isAvailable()) return "no application is connected to Station commands.";
    if (!able(commands, field)) return `the application does not support ${COMMAND[field]}.`;
    return "";
  }

  /** The output as the header states it. */
  function outputText(job) {
    const rate = job && Number.isFinite(job.lineRate) ? job.lineRate : 0;
    return rate > 0 ? `${rate.toLocaleString([], { maximumFractionDigits: 2 })} lb/hr` : "Not set";
  }

  /** The changeover as the header states it, at `now`. */
  function changeoverText(job, now, rundown) {
    const resolved = rundown.resolveChangeover(job, { now });
    if (resolved.at === null) return { text: "Not set", stale: false, set: false };
    const clock = rundown.formatClock(resolved.at);
    if (resolved.stale) return { text: `${clock} · confirm`, stale: true, set: true };
    const remaining = resolved.at - now;
    return { text: `${clock} · in ${rundown.formatRemaining(remaining)}`, stale: false, set: true };
  }

  /* "HH:MM" from an instant, for the time field's value. */
  function clockValue(at) {
    if (!Number.isFinite(at)) return "";
    const date = new Date(at);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  /**
   * Build the controls.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {function} options.commands   () => the command bridge, or null
   *        when Station is not showing live state. Asked at each edit, as
   *        the hopper controls are, so a source change is honoured.
   * @param {function} [options.now]      () => epoch ms
   * @param {number}   [options.window]   the timeline's initial window
   * @param {function} [options.onWindow] told the hours when the scale is
   *        chosen; the timeline is the one that changes
   * @param {function} [options.onCommitted]  told a changed result, so the
   *        boot file can run its publish policy as it does for the editor
   */
  function create(doc, options) {
    const settings = options || {};
    const rundown = settings.rundown || rundownModule;
    const scheduling = settings.scheduling || schedulingModule;
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const onWindow = typeof settings.onWindow === "function" ? settings.onWindow : () => {};
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};

    const state = {
      job: null,
      window: rundown.WINDOWS.includes(settings.window) ? settings.window : rundown.DEFAULT_WINDOW,
      editing: null,     // "output" | "changeover" | null
      note: ""
    };

    const rootEl = element(doc, "div", "station-job", { role: "group", "aria-label": "Job settings" });

    function item(field, unit, inputAttributes) {
      const wrap = element(doc, "div", "station-job__item", { "data-field": field });
      const trigger = element(doc, "button", "station-job__trigger", { type: "button", "data-field": field });
      trigger.appendChild(text(doc, "span", "station-job__key", LABEL[field]));
      trigger.appendChild(text(doc, "span", "station-job__value", "Not set"));
      const editor = element(doc, "div", "station-job__editor", { hidden: "" });
      const input = element(doc, "input", "station-job__input", Object.assign({
        "aria-label": field === "output" ? "Line output, pounds per hour" : "Changeover time"
      }, inputAttributes));
      editor.appendChild(input);
      if (unit) editor.appendChild(text(doc, "span", "station-job__unit", unit));
      wrap.append(trigger, editor);
      return { wrap, trigger, editor, input, value: trigger.querySelector(".station-job__value") };
    }

    const output = item("output", "lb/hr", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false" });
    const changeover = item("changeover", "", { type: "time" });
    const fields = { output, changeover };
    rootEl.append(output.wrap, changeover.wrap);

    const windowGroup = element(doc, "div", "station-job__window", { role: "group", "aria-label": "Timeline window" });
    const windowButtons = {};
    for (const hours of rundown.WINDOWS) {
      const button = text(doc, "button", "station-job__scale", `${hours}H`, {
        type: "button", "data-window": String(hours), "aria-pressed": String(hours === state.window)
      });
      windowButtons[hours] = button;
      windowGroup.appendChild(button);
    }
    rootEl.appendChild(windowGroup);

    const note = element(doc, "p", "station-job__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    /* ---- Display ---- */

    function say(message, kind) {
      state.note = message || "";
      note.textContent = state.note;
      note.setAttribute("data-kind", kind || "");
      show(note, !!state.note);
    }

    function refresh() {
      const job = state.job;
      const t = now();
      output.value.textContent = outputText(job);
      output.wrap.classList.toggle("is-unset", !(job && job.lineRate > 0));
      const co = changeoverText(job, t, rundown);
      changeover.value.textContent = co.text;
      changeover.wrap.classList.toggle("is-unset", !co.set);
      changeover.wrap.classList.toggle("is-stale", co.stale);
      const commands = commandsFor();
      for (const field of Object.keys(fields)) {
        const can = able(commands, field);
        fields[field].wrap.classList.toggle("is-readonly", !can);
        fields[field].trigger.setAttribute("aria-disabled", String(!can));
        fields[field].trigger.setAttribute("title", can
          ? `Edit the ${LABEL[field].toLowerCase()}`
          : `${LABEL[field]} is read-only here: ${reason(commands, field)}`);
      }
      for (const hours of rundown.WINDOWS) {
        windowButtons[hours].setAttribute("aria-pressed", String(hours === state.window));
      }
      rootEl.setAttribute("data-window", String(state.window));
    }

    /* ---- Editing ---- */

    function open(field) {
      const commands = commandsFor();
      if (!able(commands, field)) {
        say(`${LABEL[field]} cannot be changed here: ${reason(commands, field)}`, "error");
        return;
      }
      close();
      state.editing = field;
      const f = fields[field];
      if (field === "output") {
        f.input.value = state.job && state.job.lineRate > 0 ? String(state.job.lineRate) : "";
      } else {
        const resolved = rundown.resolveChangeover(state.job, { now: now() });
        f.input.value = resolved.at !== null ? clockValue(resolved.at) : "";
      }
      f.input.removeAttribute("aria-invalid");
      f.wrap.classList.add("is-editing");
      f.trigger.setAttribute("aria-expanded", "true");
      show(f.editor, true);
      say("");
      if (typeof f.input.focus === "function") f.input.focus();
      if (field === "output" && typeof f.input.select === "function") f.input.select();
    }

    function close() {
      const field = state.editing;
      if (!field) return;
      state.editing = null;
      const f = fields[field];
      f.wrap.classList.remove("is-editing");
      f.trigger.setAttribute("aria-expanded", "false");
      show(f.editor, false);
    }

    /* The request for a field's current text: what the command is asked
     * for. Empty clears - a zero output, no changeover - as the floor UI's
     * own fields read an emptied value. */
    function requestFor(field, raw) {
      const value = String(raw == null ? "" : raw).trim();
      if (field === "output") {
        return { command: COMMAND.output, args: { lineRate: value === "" ? 0 : value } };
      }
      if (value === "") return { command: COMMAND.changeover, args: { at: null } };
      const date = scheduling && typeof scheduling.parseChangeoverDate === "function"
        ? scheduling.parseChangeoverDate(value, new Date(now()))
        : null;
      if (!date) return { error: "Enter a time as hours and minutes." };
      return { command: COMMAND.changeover, args: { at: date.getTime() } };
    }

    function commit(field) {
      if (state.editing !== field) return null;
      const f = fields[field];
      const commands = commandsFor();
      const request = requestFor(field, f.input.value);
      if (request.error) {
        f.input.setAttribute("aria-invalid", "true");
        say(request.error, "error");
        return null;
      }
      const result = commands && typeof commands.dispatch === "function"
        ? commands.dispatch(request.command, request.args)
        : { ok: false, code: "unavailable", message: "No application is connected to Station commands." };
      if (!result || !result.ok) {
        f.input.setAttribute("aria-invalid", "true");
        say(result && result.message ? result.message : "The change could not be applied.", "error");
        return result;
      }
      f.input.removeAttribute("aria-invalid");
      close();
      say("");
      if (result.changed) onCommitted(result);
      if (typeof f.trigger.focus === "function") f.trigger.focus();
      return result;
    }

    function cancel(field) {
      if (state.editing !== field) return;
      const f = fields[field];
      close();
      say("");
      if (typeof f.trigger.focus === "function") f.trigger.focus();
    }

    for (const field of Object.keys(fields)) {
      const f = fields[field];
      f.trigger.addEventListener("click", () => {
        if (state.editing === field) { cancel(field); return; }
        open(field);
      });
      f.input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          commit(field);
        } else if (event.key === "Escape") {
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          cancel(field);
        }
      });
      /* Leaving the field commits it, as the editor's blend field does; a
       * refused value keeps the editor open and marked, so what was typed
       * is not lost, and says why. */
      f.input.addEventListener("blur", () => {
        if (state.editing !== field) return;
        commit(field);
      });
    }

    windowGroup.addEventListener("click", event => {
      const button = event.target && event.target.closest ? event.target.closest("[data-window]") : null;
      if (!button) return;
      const hours = Number(button.getAttribute("data-window"));
      if (!rundown.WINDOWS.includes(hours) || hours === state.window) return;
      state.window = hours;
      refresh();
      onWindow(hours);
    });

    /* ---- The surface ---- */

    function update(inputs) {
      state.job = inputs && inputs.job ? inputs.job : null;
      refresh();
    }

    refresh();

    return {
      element: rootEl,
      update,
      refresh,
      open,
      commit,
      cancel,
      getWindow: () => state.window,
      setWindow(hours) {
        if (!rundown.WINDOWS.includes(hours) || hours === state.window) return false;
        state.window = hours;
        refresh();
        return true;
      },
      isEditing: () => state.editing
    };
  }

  return Object.freeze({ COMMAND, LABEL, able, outputText, changeoverText, clockValue, create });
});
