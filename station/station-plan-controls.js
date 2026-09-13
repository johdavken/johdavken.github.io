/* Station plan controls - the two moves between the running recipe and
 * the planned one, as the machine utility rail asks for them on the Next
 * face (station-machine-rail.js).
 *
 * WHAT IT IS
 *
 * The write seam for the plan's lifecycle, as station-hopper-controls.js is
 * the seam for the cluster's toggles and its reset. A click on the rail's
 * Load Next (confirmed there) or Copy Current becomes ONE command through
 * the command bridge the caller was handed - promoteNextRecipe or
 * copyCurrentToNext, which name nothing: the direction is the command -
 * and the answer goes back untouched. The application carries the move
 * out along its own path (the floor UI's Load Next Recipe / Load Current
 * Recipe), saves, syncs and publishes; the caller runs the publish policy
 * over the answer.
 *
 * Editing the plan itself is not here: the Next face's cards are the
 * focus editor turned to the plan (station-focus-editor.js, recipe
 * "next"), the same seam the Blend face uses.
 *
 * WHAT IT HOLDS
 *
 * Nothing. Two readers (what the bridge offers, and why not) plus one pure
 * description of what a promotion would change - counts, read off the two
 * recipes as Station resolves them, for the rail's arming text - and two
 * dispatchers. It never reaches for the global bridge; it is handed one,
 * or null, and answers `unavailable` for null exactly as the bridge does
 * for no producer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationPlanControls = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The two moves and the command each rides on. */
  const MOVES = Object.freeze(["promote", "copy"]);
  const COMMAND = Object.freeze({ promote: "promoteNextRecipe", copy: "copyCurrentToNext" });
  const LABEL = Object.freeze({ promote: "Load Next into Current", copy: "Copy Current into Next" });

  function usableBridge(commands) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    return connected && typeof commands.dispatch === "function" && typeof commands.capabilities === "function";
  }

  /* Whether a move is on offer: a connected bridge whose producer declared
   * the command. Whether there is anything to move is the application's
   * answer at the time (no_plan, or ok/unchanged). */
  function can(commands, move) {
    if (!MOVES.includes(move) || !usableBridge(commands)) return false;
    const offered = commands.capabilities();
    return Array.isArray(offered) && offered.includes(COMMAND[move]);
  }

  function reason(commands, move) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    if (!connected) return "no application is connected to Station commands.";
    return `the application does not offer ${LABEL[move] || "this"} from Station.`;
  }

  function unavailable(message) {
    return Object.freeze({ ok: false, code: "unavailable", message });
  }

  /**
   * Hand one move to the application and return its answer.
   *
   * @param {object|null} commands  the command bridge the caller was handed
   * @param {string} move           "promote" | "copy"
   */
  function dispatch(commands, move) {
    if (!MOVES.includes(move)) return unavailable(`"${String(move)}" is not a plan move.`);
    if (!commands || typeof commands.dispatch !== "function") {
      return unavailable("No application is connected to Station commands.");
    }
    return commands.dispatch(COMMAND[move], {});
  }

  function promote(commands) { return dispatch(commands, "promote"); }
  function copy(commands) { return dispatch(commands, "copy"); }

  /**
   * What promoting the plan would change, as counts: layers whose share
   * differs, hoppers whose resin differs, hoppers whose blend differs -
   * read off the two slot maps Station already resolves (hopperState and
   * nextHopperState, keyed "<layer>:<index>") and the two layer-share
   * maps. The application's own summary (next-recipe.js) decides what a
   * promotion does; this only words the rail's confirmation. Null when
   * nothing is planned.
   */
  function summarize(resolved) {
    const r = resolved || {};
    if (!r.plan || !r.plan.planned) return null;
    const current = r.hopperState || {};
    const next = r.nextHopperState || {};
    const shares = r.layerState || {};
    const nextShares = r.nextLayerState || {};
    let layers = 0;
    let resins = 0;
    let blends = 0;
    for (const name of Object.keys(nextShares)) {
      const before = shares[name] ? Number(shares[name].layerPct) || 0 : null;
      const after = Number(nextShares[name].layerPct) || 0;
      if (before === null || before !== after) layers += 1;
    }
    for (const key of Object.keys(next)) {
      const before = current[key] || null;
      const after = next[key];
      if ((before ? before.resinName || "" : "") !== (after.resinName || "")) resins += 1;
      if ((before ? Number(before.pct) || 0 : -1) !== (Number(after.pct) || 0)) blends += 1;
    }
    return Object.freeze({ layers, resins, blends, unchanged: layers === 0 && resins === 0 && blends === 0 });
  }

  /* The summary as words for the rail's armed control. */
  function summaryText(summary) {
    if (!summary) return "nothing is planned";
    if (summary.unchanged) return "the plan matches the running recipe";
    const parts = [];
    if (summary.resins) parts.push(`${summary.resins} resin change${summary.resins === 1 ? "" : "s"}`);
    if (summary.blends) parts.push(`${summary.blends} percentage change${summary.blends === 1 ? "" : "s"}`);
    if (summary.layers) parts.push(`${summary.layers} layer share${summary.layers === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }

  return Object.freeze({ MOVES, COMMAND, LABEL, can, reason, promote, copy, dispatch, summarize, summaryText });
});
