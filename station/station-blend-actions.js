/* Station blend actions - the layer-wide edits a Blend Edit card and the
 * machine rail ask for: a layer pasted onto another, a layer emptied, one
 * resin written onto a selection of hoppers.
 *
 * WHAT IT IS
 *
 * The write seam for the three layer commands, as station-plan-controls.js
 * is the seam for the plan's two moves. A choice on a card's menu
 * (station-layer-menu.js) or the rail's Confirm (station-machine-rail.js)
 * becomes ONE command through the command bridge the caller was handed -
 * copyLayer, clearLayer or setHopperResins - addressed to the recipe the
 * face shows, and the answer goes back untouched. The application carries
 * the edit out along its own path (the Recipe grid's paste, its Reset all
 * for one layer, its Bulk edit apply), records one history entry, saves and
 * syncs once, and publishes; the caller runs the publish policy over the
 * answer.
 *
 * WHAT IT HOLDS
 *
 * Nothing. Two readers (what the bridge offers, and why not), three
 * dispatchers, and one pure description of the grid's paste exception -
 * for the menu's wording only; the application enforces it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationBlendActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTIONS = Object.freeze(["copy", "clear", "resins"]);
  const COMMAND = Object.freeze({ copy: "copyLayer", clear: "clearLayer", resins: "setHopperResins" });
  const LABEL = Object.freeze({ copy: "pasting a layer", clear: "resetting a layer", resins: "bulk resin editing" });
  const RECIPES = Object.freeze(["current", "next"]);

  function usableBridge(commands) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    return connected && typeof commands.dispatch === "function" && typeof commands.capabilities === "function";
  }

  /* Whether an action is on offer: a connected bridge whose producer
   * declared the command. Whether it changes anything is the application's
   * answer at the time. */
  function can(commands, action) {
    if (!ACTIONS.includes(action) || !usableBridge(commands)) return false;
    const offered = commands.capabilities();
    return Array.isArray(offered) && offered.includes(COMMAND[action]);
  }

  function reason(commands, action) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    if (!connected) return "no application is connected to Station commands.";
    return `the application does not offer ${LABEL[action] || "this"} from Station.`;
  }

  function unavailable(message) {
    return Object.freeze({ ok: false, code: "unavailable", message });
  }

  function dispatch(commands, action, args) {
    if (!ACTIONS.includes(action)) return unavailable(`"${String(action)}" is not a blend action.`);
    if (!commands || typeof commands.dispatch !== "function") {
      return unavailable("No application is connected to Station commands.");
    }
    if (!RECIPES.includes(args.recipe)) return unavailable("This view does not address a recipe.");
    return commands.dispatch(COMMAND[action], args);
  }

  /** The source layer's assignment written onto the destination. */
  function copyLayer(commands, recipe, from, to) {
    return dispatch(commands, "copy", { recipe, layer: from, toLayer: to });
  }

  /** Every hopper on the layer emptied. */
  function clearLayer(commands, recipe, layer) {
    return dispatch(commands, "clear", { recipe, layer });
  }

  /**
   * One resin written onto every listed position.
   *
   * @param {Array<{layer: string, index: number}|string>} positions  entries,
   *        or "<layer>:<index>" keys as the boot file keeps a selection
   */
  function applyResins(commands, recipe, positions, resin) {
    const entries = [];
    for (const position of Array.isArray(positions) ? positions : []) {
      const entry = typeof position === "string" ? parseKey(position) : position;
      if (entry && typeof entry.layer === "string" && Number.isInteger(entry.index)) {
        entries.push({ layer: entry.layer, index: entry.index, resin });
      }
    }
    if (!entries.length) return unavailable("Select at least one hopper first.");
    return dispatch(commands, "resins", { recipe, resins: entries });
  }

  /* "<layer>:<index>" - the key the state bridge and the boot file's
   * selection use - as a position; null for anything else. */
  function parseKey(key) {
    const at = typeof key === "string" ? key.lastIndexOf(":") : -1;
    if (at <= 0) return null;
    const index = Number(key.slice(at + 1));
    if (!Number.isInteger(index)) return null;
    return { layer: key.slice(0, at), index };
  }

  /* The Recipe grid's one paste exception, for the menu's wording: on a
   * 3-layer line the core layer B takes a pasted layer's resins only,
   * never its blend - B's own split is set independently. The
   * application applies the rule; this only says it. */
  function resinOnlyTarget(layerCount, layerId) {
    return layerCount === 3 && layerId === "B";
  }

  return Object.freeze({ ACTIONS, COMMAND, LABEL, can, reason, dispatch, copyLayer, clearLayer, applyResins, parseKey, resinOnlyTarget });
});
