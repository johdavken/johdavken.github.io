/* Work Alarm: a wake-up alarm before every shift, in the Timeline's place.
 *
 * The operator says which crew they are on (A-D) and how long before a
 * shift to ring; the tool lists the next shifts of that crew with the
 * alarm each gets, and any one of them can be skipped - a vacation day, a
 * traded shift. The rotation, the settings and the arming are the
 * device's own (work-rotation.js, work-alarm.js), handed in by the boot:
 * this panel reads and asks, and stores nothing itself.
 *
 * The alarm belongs to this device, not to the line: nothing here goes
 * through the command bridge or RT Sync. In a browser there is nothing to
 * ring, and the panel says so while still showing the schedule.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateWorkAlarm = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE = "Work Alarm";
  const CLOSE_LABEL = "Back to the Timeline";
  const CAPTION = "A wake-up alarm before every shift of your crew, on this phone.";
  const UNAVAILABLE = "Work Alarm is unavailable: the shift rotation did not load.";
  const CREWS = Object.freeze(["A", "B", "C", "D"]);
  const SHOWN = 8;

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

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function dayLabel(date) {
    try { return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch (error) { return date.toDateString().slice(0, 10); }
  }

  /**
   * What the status line says for a state of the settings and the device.
   * Pure.
   *
   * @param {object} state  { settings, native, permissions, next, lastSync, format }
   * @returns {{ message: string, kind: "info"|"ok"|"warn" }}
   */
  function statusFor(state) {
    const s = state || {};
    const settings = s.settings || {};
    if (!settings.crew) return { message: "Choose your crew to see your shifts.", kind: "info" };
    if (!s.native) return { message: "This browser can't ring an alarm. Turn it on in the Resin.Tools app on your Android phone; the shifts below are yours either way.", kind: "info" };
    if (!settings.enabled) return { message: "The alarm is off. Your shifts are below.", kind: "info" };
    if (s.lastSync && s.lastSync.error) return { message: `The alarms could not be set: ${s.lastSync.error}`, kind: "warn" };
    const p = s.permissions;
    if (p && p.native && !p.notifications) return { message: "Notifications are off for Resin.Tools, so the alarm can't show. Turn them on in Android's app settings.", kind: "warn" };
    if (p && p.native && !p.exact) return { message: "Android may ring these late: allow exact alarms for Resin.Tools.", kind: "warn" };
    if (p && p.native && !p.fullScreen) return { message: "The alarm will only be a notification: allow full-screen alarms for Resin.Tools.", kind: "warn" };
    const next = s.next;
    const clock = s.format && typeof s.format.formatClock === "function" ? s.format.formatClock : d => d.toLocaleTimeString();
    if (!next) return { message: "On. No shift in the next four weeks needs an alarm.", kind: "ok" };
    return { message: `On. Next alarm ${dayLabel(next.at)} at ${clock(next.at)}.`, kind: "ok" };
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.workAlarm  { device, format }: the device's work alarm
   *        (work-alarm.js create()/shared()) and the module itself for its
   *        pure helpers, or null when they did not load
   * @param {function} [ctx.back]         hands the aside back to the Timeline
   */
  function create(doc, ctx) {
    const settingsIn = ctx || {};
    const bundle = settingsIn.workAlarm || null;
    const device = bundle && bundle.device ? bundle.device : null;
    const format = bundle && bundle.format ? bundle.format : null;
    const back = typeof settingsIn.back === "function" ? settingsIn.back : () => {};

    const rootEl = element(doc, "section", "slate-panel slate-alarm", { "aria-label": TITLE });
    const head = element(doc, "div", "slate-panel__head");
    head.appendChild(text(doc, "h2", "slate-panel__title", TITLE));
    const close = element(doc, "button", "slate-panel__close", { type: "button", "aria-label": CLOSE_LABEL, title: CLOSE_LABEL, "data-slate-back": "" });
    close.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    head.appendChild(close);
    rootEl.appendChild(head);
    rootEl.appendChild(text(doc, "p", "slate-alarm__caption", CAPTION));

    if (!device) {
      rootEl.appendChild(text(doc, "p", "slate-alarm__status", UNAVAILABLE, { "data-kind": "warn", role: "status" }));
      close.addEventListener("click", () => back());
      return Object.freeze({ element: rootEl, onShow() {}, refresh() {} });
    }

    /* ---- The settings ---- */
    const form = element(doc, "div", "slate-alarm__form");

    const switchRow = element(doc, "div", "slate-alarm__row");
    switchRow.appendChild(text(doc, "span", "slate-alarm__label", "Alarm"));
    const toggle = element(doc, "button", "slate-alarm__switch", { type: "button", role: "switch", "aria-checked": "false", "aria-label": "Work alarm", "data-action": "toggle" });
    toggle.appendChild(element(doc, "span", "slate-alarm__knob", { "aria-hidden": "true" }));
    switchRow.appendChild(toggle);
    form.appendChild(switchRow);

    const crewRow = element(doc, "div", "slate-alarm__row");
    crewRow.appendChild(text(doc, "span", "slate-alarm__label", "My crew"));
    const crewGroup = element(doc, "div", "slate-alarm__crews", { role: "radiogroup", "aria-label": "My crew" });
    const crewButtons = new Map();
    for (const crew of CREWS) {
      const button = text(doc, "button", "slate-alarm__crew", crew, { type: "button", role: "radio", "aria-checked": "false", "data-crew": crew });
      button.addEventListener("click", () => change({ crew }));
      crewButtons.set(crew, button);
      crewGroup.appendChild(button);
    }
    crewRow.appendChild(crewGroup);
    form.appendChild(crewRow);

    const leadRow = element(doc, "div", "slate-alarm__row");
    leadRow.appendChild(text(doc, "span", "slate-alarm__label", "Wake me"));
    const lead = element(doc, "select", "slate-alarm__lead", { "aria-label": "How long before my shift", "data-field": "lead" });
    const choices = format && typeof format.leadChoices === "function" ? format.leadChoices() : [120];
    for (const minutes of choices) {
      const option = text(doc, "option", "", `${format ? format.formatLead(minutes) : minutes + " min"} before`, { value: String(minutes) });
      option.value = String(minutes);
      lead.appendChild(option);
    }
    lead.addEventListener("change", () => change({ leadMinutes: Number(lead.value) }));
    leadRow.appendChild(lead);
    form.appendChild(leadRow);
    rootEl.appendChild(form);

    const status = element(doc, "p", "slate-alarm__status", { role: "status", "aria-live": "polite" });
    rootEl.appendChild(status);
    const fixes = element(doc, "div", "slate-alarm__fixes", { hidden: "" });
    const allowExact = text(doc, "button", "slate-alarm__fix", "Allow exact alarms", { type: "button", "data-action": "allow-exact" });
    const allowFull = text(doc, "button", "slate-alarm__fix", "Allow full-screen alarms", { type: "button", "data-action": "allow-full-screen" });
    fixes.appendChild(allowExact);
    fixes.appendChild(allowFull);
    rootEl.appendChild(fixes);

    /* ---- The shifts ---- */
    const listHead = text(doc, "h3", "slate-alarm__heading", "Next shifts");
    rootEl.appendChild(listHead);
    const list = element(doc, "ol", "slate-alarm__list");
    rootEl.appendChild(list);
    rootEl.appendChild(text(doc, "p", "slate-alarm__foot", "Shifts follow the plant's 2-2-3 rotation for your crew. Skip one for a vacation day or a traded shift."));

    const state = { permissions: null, busy: false };

    async function change(patch) {
      if (state.busy) return;
      state.busy = true;
      paint();
      try { await device.update(patch); } finally { state.busy = false; }
      paint();
    }

    async function checkPermissions() {
      try { state.permissions = await device.permissions(); } catch (error) { state.permissions = null; }
      paint();
    }

    function paint() {
      const settings = device.getSettings();
      toggle.setAttribute("aria-checked", settings.enabled ? "true" : "false");
      rootEl.classList.toggle("is-on", settings.enabled);
      if (!settings.crew) toggle.setAttribute("disabled", "");
      else if (state.busy) toggle.setAttribute("disabled", "");
      else toggle.removeAttribute("disabled");
      for (const [crew, button] of crewButtons) {
        button.setAttribute("aria-checked", settings.crew === crew ? "true" : "false");
        if (state.busy) button.setAttribute("disabled", "");
        else button.removeAttribute("disabled");
      }
      lead.value = String(settings.leadMinutes);
      if (state.busy) lead.setAttribute("disabled", "");
      else lead.removeAttribute("disabled");

      const shifts = settings.crew ? device.upcoming(SHOWN) : [];
      const next = settings.enabled ? shifts.find(shift => !shift.skipped && !shift.passed) || null : null;
      const said = statusFor({ settings, native: device.native, permissions: state.permissions, next, lastSync: device.lastSync(), format });
      status.textContent = said.message;
      status.setAttribute("data-kind", said.kind);
      const p = state.permissions;
      const needExact = !!(settings.enabled && p && p.native && !p.exact);
      const needFull = !!(settings.enabled && p && p.native && !p.fullScreen);
      show(allowExact, needExact);
      show(allowFull, needFull);
      show(fixes, needExact || needFull);

      clear(list);
      show(listHead, shifts.length > 0);
      for (const shift of shifts) {
        const item = element(doc, "li", "slate-alarm__shift", { "data-date": shift.date, "data-kind": shift.kind });
        if (shift.skipped) item.setAttribute("data-skipped", "");
        const when = element(doc, "div", "slate-alarm__when");
        when.appendChild(text(doc, "span", "slate-alarm__day", dayLabel(shift.start)));
        when.appendChild(text(doc, "span", "slate-alarm__kind", `${shift.kind === "day" ? "Day" : "Night"} · ${format ? format.formatClock(shift.start) : ""}`));
        item.appendChild(when);
        const ring = shift.skipped ? "Skipped" : (shift.passed ? "Passed" : (format ? format.formatClock(shift.at) : ""));
        item.appendChild(text(doc, "span", "slate-alarm__ring", ring, { "aria-label": shift.skipped ? "No alarm" : `Alarm at ${ring}` }));
        const skip = text(doc, "button", "slate-alarm__skip", shift.skipped ? "Undo" : "Skip", {
          type: "button", "data-action": "skip", "aria-pressed": shift.skipped ? "true" : "false",
          "aria-label": `${shift.skipped ? "Ring again for" : "Skip the alarm for"} ${dayLabel(shift.start)}`
        });
        if (state.busy || shift.passed) skip.setAttribute("disabled", "");
        skip.addEventListener("click", async () => {
          if (state.busy) return;
          state.busy = true;
          paint();
          try { await device.toggleSkip(shift.date); } finally { state.busy = false; }
          paint();
        });
        item.appendChild(skip);
        list.appendChild(item);
      }
    }

    toggle.addEventListener("click", () => {
      const settings = device.getSettings();
      if (!settings.crew) return;
      change({ enabled: !settings.enabled });
    });
    allowExact.addEventListener("click", async () => { await device.requestExact(); });
    allowFull.addEventListener("click", async () => { await device.requestFullScreen(); });
    close.addEventListener("click", () => back());
    if (typeof device.subscribe === "function") device.subscribe(() => { if (!state.busy) paint(); });

    paint();

    return Object.freeze({
      element: rootEl,
      // Coming back from Android's settings, the answers may have changed.
      onShow: checkPermissions,
      refresh: paint
    });
  }

  return Object.freeze({ TITLE, CLOSE_LABEL, CAPTION, UNAVAILABLE, CREWS, statusFor, create });
});
