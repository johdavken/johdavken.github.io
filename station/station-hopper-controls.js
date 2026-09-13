/* Station hopper controls - the two operational toggles a drawn hopper
 * carries: pump-off, on its receiver, and tracking, on its body.
 *
 * WHAT IT IS
 *
 * The write seam for the hopper cluster, as station-focus-editor.js is the
 * write seam for the open layer's rows. A click on a control in the
 * cluster (station.js delegates it here) becomes ONE command through the
 * command bridge the caller was handed - setHopperTracking or setPumpOff,
 * addressed to the Current recipe, one layer, one hopper, stating the
 * flag it wants - and the answer goes back to the caller untouched. The
 * application carries the toggle out along its own paths (the grid's
 * clock button's and the Timeline's I/O toggle's), saves, syncs, and
 * publishes; the caller runs the publish policy over the answer, so what
 * the hopper then shows is what the application holds, never what was
 * asked for.
 *
 * WHAT IT HOLDS
 *
 * Nothing. No state, no DOM, no timers: two pure readers (what a control's
 * element says, what the bridge offers) and one dispatcher. It never
 * reaches for the global bridge; it is handed one, or null, and answers
 * `unavailable` for null exactly as the bridge itself answers for no
 * producer - so the standalone harness and a pinned demo are read-only
 * here by the same rule that makes them read-only everywhere else.
 *
 * WHY A SEPARATE FILE
 *
 * station.js is a reader that hands bridges over; it does not dispatch
 * (station-isolation.test.js). The editor dispatches for its rows. The
 * cluster's controls are neither: they live on the drawing, outside any
 * editor, and work with no layer open. So they get a module of their own,
 * as small as the seam it is, and the isolation test names it as the
 * second file that may say `.dispatch(`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationHopperControls = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The two controls, the command each rides on, and the hopper flag each
   * command sets. The only mapping in this file; whether a command is on
   * offer is the bridge's answer. */
  const CONTROLS = Object.freeze(["tracking", "pump"]);
  const COMMAND = Object.freeze({ tracking: "setHopperTracking", pump: "setPumpOff" });
  const FLAG = Object.freeze({ tracking: "track", pump: "pumpOff" });
  const LABEL = Object.freeze({ tracking: "tracking", pump: "pump-off" });

  /* What each state is called, on the drawing's tooltips and in the
   * inspector: the floor UI's own words (the grid's "Track in timeline",
   * the Timeline's "Pump off" / "Pump running"). */
  const STATE = Object.freeze({
    tracking: Object.freeze({ on: "Tracked", off: "Not tracked" }),
    pump: Object.freeze({ on: "Pump off", off: "Pump running" })
  });

  function stateLabel(control, on) {
    const names = STATE[control];
    return names ? (on ? names.on : names.off) : "";
  }

  /* What a click would do, said as the tooltip says it. */
  function actionLabel(control, on) {
    if (control === "tracking") return on ? "stop tracking" : "track in the timeline";
    if (control === "pump") return on ? "mark the pump running" : "mark the pump off";
    return "";
  }

  /* Which controls the bridge offers, and why one is not offered when it
   * is not. Asked once per render: the application declares its commands
   * when it connects. Only the Current recipe carries runtime state, so
   * any other recipe makes both unavailable. */
  function abilities(commands, recipe) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    const usable = connected && typeof commands.dispatch === "function" && typeof commands.capabilities === "function";
    const offered = usable ? commands.capabilities() : [];
    const able = {};
    for (const control of CONTROLS) {
      able[control] = recipe === "current" && usable && Array.isArray(offered) && offered.includes(COMMAND[control]);
    }
    return Object.freeze(able);
  }

  function reason(commands, recipe, control) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    if (!connected) return "no application is connected to Station commands.";
    if (recipe !== "current") return "only the running job carries tracking and pump-off.";
    return `the application does not offer ${LABEL[control] || "this"} from Station.`;
  }

  /* The request a drawn control's element describes. The renderer writes
   * the hopper's address and the state as drawn onto the control group
   * (station-machine-parts.js); this reads them back, so the click needs
   * nothing but the element it landed on. Null for anything that is not a
   * control. */
  function requestFrom(element) {
    if (!element || typeof element.getAttribute !== "function") return null;
    const control = element.getAttribute("data-station-target");
    if (!CONTROLS.includes(control)) return null;
    const layer = element.getAttribute("data-layer");
    const indexText = element.getAttribute("data-hopper-index");
    const index = typeof indexText === "string" && indexText.trim() !== "" ? Number(indexText) : NaN;
    if (!layer || !Number.isInteger(index)) return null;
    return Object.freeze({
      control,
      layer,
      index,
      hopper: element.getAttribute("data-hopper") || null,
      on: element.getAttribute("data-on") === "true",
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
   *        is the state wanted, not a parity: two devices toggling at once
   *        land on a state.
   * @returns the contract's result: ok/changed/snapshot, or ok:false/code
   */
  function toggle(commands, request) {
    const r = request || {};
    if (!CONTROLS.includes(r.control)) return unavailable(`"${String(r.control)}" is not a hopper control.`);
    if (!commands || typeof commands.dispatch !== "function") {
      return unavailable("No application is connected to Station commands.");
    }
    const args = { recipe: "current", layer: r.layer, index: r.index };
    args[FLAG[r.control]] = !!r.next;
    return commands.dispatch(COMMAND[r.control], args);
  }

  return Object.freeze({ CONTROLS, COMMAND, FLAG, LABEL, STATE, stateLabel, actionLabel, abilities, reason, requestFrom, toggle });
});
