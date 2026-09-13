/* The Station job controls: the running job's two line-wide settings, as
 * two compact readouts in the header.
 *
 *   OUTPUT 850 lb/hr     the line's output, edited in place
 *   CHANGEOVER 3:28 AM   the changeover deadline, edited in place
 *
 * They are the machine status the header carries beside Station's name;
 * visually subordinate to the line console beside them and to the stage
 * below. (The run-down timeline's 6H | 12H scale sat here too while the
 * timeline was new; it is the timeline's own now, in its Now column.)
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
 * THE CHANGEOVER READOUT IS A LAUNCHER
 *
 * Given `onChangeover`, a click on the CHANGEOVER readout does not open
 * a field in the header: it opens the Changeover Calculator (station-
 * changeover.js), the surface where the deadline is edited and estimated,
 * and the readout stays as it is - the calculator's closed form. The
 * calculator sets the deadline back through this module's `apply`, so
 * setChangeover is still issued from here and nowhere else. Without a
 * launcher (a page without the calculator) the readout keeps its field.
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
   * @param {function} [options.onCommitted]  told a changed result, so the
   *        boot file can run its publish policy as it does for the editor
   * @param {function} [options.onChangeover] the launcher: called on a
   *        click on the CHANGEOVER readout instead of opening its field
   */
  function create(doc, options) {
    const settings = options || {};
    const rundown = settings.rundown || rundownModule;
    const scheduling = settings.scheduling || schedulingModule;
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const onChangeover = typeof settings.onChangeover === "function" ? settings.onChangeover : null;

    const state = {
      job: null,
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
        /* The changeover readout with a launcher is always a control: the
         * calculator opens whether or not the deadline may be set from
         * here, and says itself when it may not. */
        const launches = field === "changeover" && !!onChangeover;
        fields[field].wrap.classList.toggle("is-readonly", !can && !launches);
        fields[field].wrap.classList.toggle("is-launcher", launches);
        fields[field].trigger.setAttribute("aria-disabled", String(!can && !launches));
        fields[field].trigger.setAttribute("title", launches
          ? "Changeover Calculator"
          : (can ? `Edit the ${LABEL[field].toLowerCase()}` : `${LABEL[field]} is read-only here: ${reason(commands, field)}`));
      }
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

    /* One request to the application, and the boot file told of a
     * change: the one path every write from this module takes. */
    function send(request) {
      const commands = commandsFor();
      const result = commands && typeof commands.dispatch === "function"
        ? commands.dispatch(request.command, request.args)
        : { ok: false, code: "unavailable", message: "No application is connected to Station commands." };
      if (result && result.ok && result.changed) onCommitted(result);
      return result;
    }

    /**
     * Set a field from a value already resolved - the calculator's
     * estimate, or its deadline field - through the same command the
     * header's own field issues. `value` is an instant (epoch ms) or null
     * for the changeover, a number for the output. Returns the result.
     */
    function apply(field, value) {
      if (!fields[field]) return { ok: false, code: "invalid", message: `Unknown field ${field}.` };
      if (!able(commandsFor(), field)) {
        return { ok: false, code: "unavailable", message: `${LABEL[field]} cannot be changed here: ${reason(commandsFor(), field)}` };
      }
      const request = field === "output"
        ? requestFor("output", value)
        : (value === null || value === undefined
          ? { command: COMMAND.changeover, args: { at: null } }
          : (Number.isFinite(value) ? { command: COMMAND.changeover, args: { at: value } } : { error: "The changeover must be an instant." }));
      if (request.error) return { ok: false, code: "invalid", message: request.error };
      return send(request);
    }

    function commit(field) {
      if (state.editing !== field) return null;
      const f = fields[field];
      const request = requestFor(field, f.input.value);
      if (request.error) {
        f.input.setAttribute("aria-invalid", "true");
        say(request.error, "error");
        return null;
      }
      const result = send(request);
      if (!result || !result.ok) {
        f.input.setAttribute("aria-invalid", "true");
        say(result && result.message ? result.message : "The change could not be applied.", "error");
        return result;
      }
      f.input.removeAttribute("aria-invalid");
      close();
      say("");
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
        if (field === "changeover" && onChangeover) { say(""); onChangeover(); return; }
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

    /* ---- The surface ---- */

    function update(inputs) {
      state.job = inputs && inputs.job ? inputs.job : null;
      refresh();
    }

    refresh();

    /* The launcher's own state, mirrored on the readout: the calculator
     * says when it opens and closes. */
    function setLaunched(on) {
      changeover.trigger.setAttribute("aria-expanded", on ? "true" : "false");
      changeover.wrap.classList.toggle("is-launched", !!on);
    }

    return {
      element: rootEl,
      trigger: field => (fields[field] ? fields[field].trigger : null),
      update,
      refresh,
      open,
      apply,
      commit,
      cancel,
      setLaunched,
      isEditing: () => state.editing
    };
  }

  return Object.freeze({ COMMAND, LABEL, able, outputText, changeoverText, clockValue, create });
});
