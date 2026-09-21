/* The Track mode's seam to the application: a hopper's tracking and
 * pump-off toggles, and the reset over the whole job.
 *
 * Slate's recipe section builds the toggles; this is the one file that
 * hands them to the command bridge, as small as the seam it is. It never
 * reads the bridge global - it dispatches on the bridge it is handed -
 * and slate-isolation.test.js names it as one of the two files that may
 * say `.dispatch(`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateTracking = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTROLS = Object.freeze(["tracking", "pump"]);
  const COMMAND = Object.freeze({ tracking: "setHopperTracking", pump: "setPumpOff" });
  const RESET_COMMAND = "resetTracking";
  const FLAG = Object.freeze({ tracking: "track", pump: "pumpOff" });
  const LABEL = Object.freeze({ tracking: "tracking", pump: "pump-off" });

  /* The floor UI's own words. */
  const STATE = Object.freeze({
    tracking: Object.freeze({ on: "Tracked", off: "Not tracked" }),
    pump: Object.freeze({ on: "Pump off", off: "Pump running" })
  });

  function stateLabel(control, on) {
    const names = STATE[control];
    return names ? (on ? names.on : names.off) : "";
  }

  function actionLabel(control, on) {
    if (control === "tracking") return on ? "stop tracking" : "track in the timeline";
    if (control === "pump") return on ? "mark the pump running" : "mark the pump off";
    return "";
  }

  function connected(commands) {
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
  }

  function offered(commands) {
    const usable = connected(commands) && typeof commands.dispatch === "function" && typeof commands.capabilities === "function";
    const list = usable ? commands.capabilities() : [];
    return Array.isArray(list) ? list : [];
  }

  /* Slate's read-only promise (slate-display.js): with it on, nothing is
   * offered, whatever the bridge would answer. */
  const READ_ONLY_REASON = "Slate is read-only on this line. Turn Read-only off in Settings to make changes.";

  /* Which controls the bridge offers. Asked once per render: the
   * application declares its commands when it connects. */
  function abilities(commands, options) {
    if (options && options.readOnly) return Object.freeze({ tracking: false, pump: false, reset: false });
    const list = offered(commands);
    return Object.freeze({
      tracking: list.includes(COMMAND.tracking),
      pump: list.includes(COMMAND.pump),
      reset: list.includes(RESET_COMMAND)
    });
  }

  function reason(commands, control, options) {
    if (options && options.readOnly) return READ_ONLY_REASON;
    if (!connected(commands)) return "no application is connected to Slate commands.";
    if (control === "reset") return "the application does not offer a tracking reset from Slate.";
    return `the application does not offer ${LABEL[control] || "this"} from Slate.`;
  }

  /* The request a toggle's element describes: the recipe section writes
   * the hopper's address and the state as drawn onto the button. */
  function requestFrom(element) {
    if (!element || typeof element.getAttribute !== "function") return null;
    const control = element.getAttribute("data-slate-control");
    if (!CONTROLS.includes(control)) return null;
    const layer = element.getAttribute("data-layer");
    const indexText = element.getAttribute("data-index");
    const index = typeof indexText === "string" && indexText.trim() !== "" ? Number(indexText) : NaN;
    if (!layer || !Number.isInteger(index)) return null;
    return Object.freeze({
      control,
      layer,
      index,
      on: element.getAttribute("aria-pressed") === "true",
      able: element.getAttribute("data-able") === "true"
    });
  }

  function unavailable(message) {
    return Object.freeze({ ok: false, code: "unavailable", message });
  }

  /**
   * Hand one toggle to the application and return its answer.
   *
   * @param {object|null} commands  the command bridge the caller was handed
   * @param {object} request        { control, layer, index, next } - `next`
   *        is the state wanted, not a parity.
   */
  function toggle(commands, request) {
    const r = request || {};
    if (!CONTROLS.includes(r.control)) return unavailable(`"${String(r.control)}" is not a hopper control.`);
    if (!commands || typeof commands.dispatch !== "function") {
      return unavailable("No application is connected to Slate commands.");
    }
    const args = { recipe: "current", layer: r.layer, index: r.index };
    args[FLAG[r.control]] = !!r.next;
    return commands.dispatch(COMMAND[r.control], args);
  }

  /** One resetTracking, addressed to Current. */
  function resetTracking(commands) {
    if (!commands || typeof commands.dispatch !== "function") {
      return unavailable("No application is connected to Slate commands.");
    }
    return commands.dispatch(RESET_COMMAND, { recipe: "current" });
  }

  return Object.freeze({
    CONTROLS, COMMAND, RESET_COMMAND, FLAG, LABEL, STATE, READ_ONLY_REASON,
    stateLabel, actionLabel, abilities, reason, requestFrom, toggle, resetTracking
  });
});
