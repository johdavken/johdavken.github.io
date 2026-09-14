/* Arm-and-confirm for a control that is easy to click by accident and slow
 * to undo by hand: a tracking reset, a plan promoted into the running
 * recipe. Two clicks in place, no dialog. The first ARMS the control - the
 * owner redraws it to say so and waits; the second confirms. A pause, a
 * click anywhere else, Escape on the control or the focus leaving it all
 * disarm it. One control is armed at a time, whichever was clicked last.
 *
 * Shared by the machine rail (station-machine-rail.js: Load Next, Copy
 * Current) and the run-down timeline (station-rundown-timeline.js: Reset),
 * so they all behave the same. This module draws nothing and dispatches nothing:
 * it keeps which control is armed and the timer and the click-away
 * listener that disarm it, and tells its owner (onChange) whenever that
 * changes, so the owner draws the word, the colour and the title.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationArmed = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* How long an armed control waits for its confirming click. */
  const ARM_DURATION = 5000;

  /**
   * @param {object} options
   * @param {Document} options.doc         for the click-away listener
   * @param {object}   options.controls    { name: button } - the controls
   *        that can be armed; Escape and blur on each disarm it
   * @param {function} [options.onChange]  () => void; after every arm and disarm
   * @param {function} [options.setTimeout]   the host's by default
   * @param {function} [options.clearTimeout]
   * @param {number}   [options.armDuration]  ms an armed control waits; 0 waits forever
   * @returns {{ arm: function, disarm: function, armed: function, control: function }}
   */
  function create(options) {
    const settings = options || {};
    const doc = settings.doc || null;
    const controls = settings.controls && typeof settings.controls === "object" ? settings.controls : {};
    const onChange = typeof settings.onChange === "function" ? settings.onChange : () => {};
    const timers = {
      set: typeof settings.setTimeout === "function" ? settings.setTimeout : (typeof setTimeout === "function" ? setTimeout : null),
      clear: typeof settings.clearTimeout === "function" ? settings.clearTimeout : (typeof clearTimeout === "function" ? clearTimeout : null)
    };
    const armDuration = typeof settings.armDuration === "number" && Number.isFinite(settings.armDuration) && settings.armDuration >= 0
      ? settings.armDuration : ARM_DURATION;

    const state = { armed: null, timer: null };

    function control(name) {
      return name && controls[name] ? controls[name] : null;
    }

    function onDocumentPointerDown(event) {
      const target = event && event.target;
      const button = control(state.armed);
      if (target && button && typeof button.contains === "function" && button.contains(target)) return;
      disarm();
    }

    /** Disarm whatever is armed. True when something was. */
    function disarm() {
      if (!state.armed) return false;
      state.armed = null;
      if (state.timer !== null && timers.clear) timers.clear(state.timer);
      state.timer = null;
      if (doc && typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      onChange();
      return true;
    }

    /** Arm one control by name. False when it already was. */
    function arm(which) {
      if (!control(which)) return false;
      if (state.armed === which) return false;
      if (state.armed) disarm();
      state.armed = which;
      if (timers.set && armDuration > 0) state.timer = timers.set(() => { state.timer = null; disarm(); }, armDuration);
      if (doc && typeof doc.addEventListener === "function") doc.addEventListener("pointerdown", onDocumentPointerDown, true);
      onChange();
      return true;
    }

    for (const name of Object.keys(controls)) {
      const button = controls[name];
      if (!button || typeof button.addEventListener !== "function") continue;
      button.addEventListener("keydown", event => {
        if (!event || event.key !== "Escape" || state.armed !== name) return;
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof event.preventDefault === "function") event.preventDefault();
        disarm();
      });
      button.addEventListener("blur", () => { if (state.armed === name) disarm(); });
    }

    return Object.freeze({
      arm,
      disarm,
      /** Which control is armed, or null. */
      armed: () => state.armed,
      control
    });
  }

  return Object.freeze({ ARM_DURATION, create });
});
