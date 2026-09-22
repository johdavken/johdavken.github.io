/* The recipe's seam to the application: every edit a row, a layer head or
 * the bar can ask for, as one command each.
 *
 * The Recipe section builds the editors, the drag and the menus; this is
 * the file that hands their results to the command bridge, and the third
 * Slate file allowed to say `.dispatch(` (slate-isolation.test.js). It
 * never reads the bridge global - it dispatches on the bridge it is
 * handed - and it answers "unavailable" itself when there is none.
 *
 * Every command names its recipe explicitly ("current" | "next"): the
 * contract has no default, and neither does this.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipeActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RECIPES = Object.freeze(["current", "next"]);
  const COMMAND = Object.freeze({
    resin: "setHopperResin",
    clear: "clearHopper",
    blend: "setHopperBlend",
    share: "setLayerShare",
    move: "moveHopper",
    assign: "setHopperAssignments",
    copyLayer: "copyLayer",
    clearLayer: "clearLayer",
    undo: "undo",
    redo: "redo"
  });
  const READ_ONLY_REASON = "Slate is read-only on this line. Turn Read-only off in Settings to make changes.";
  const NO_BRIDGE = "No application is connected to Slate commands.";

  function connected(commands) {
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
  }

  function offered(commands) {
    const usable = connected(commands) && typeof commands.dispatch === "function" && typeof commands.capabilities === "function";
    const list = usable ? commands.capabilities() : [];
    return Array.isArray(list) ? list : [];
  }

  /* What the bridge offers, by the name each control uses. Read-only
   * withholds everything, whatever the bridge would answer. */
  function abilities(commands, options) {
    const readOnly = !!(options && options.readOnly);
    const list = readOnly ? [] : offered(commands);
    const able = {};
    for (const key of Object.keys(COMMAND)) able[key] = list.includes(COMMAND[key]);
    // A resin edit needs both the set and the clear: an emptied field clears.
    able.resin = able.resin && able.clear;
    return Object.freeze(able);
  }

  function reason(commands, control, options) {
    if (options && options.readOnly) return READ_ONLY_REASON;
    if (!connected(commands)) return "no application is connected to Slate commands.";
    return `the application does not offer ${COMMAND[control] || "this"} from Slate.`;
  }

  function unavailable(message) {
    return Object.freeze({ ok: false, code: "unavailable", message: message || NO_BRIDGE });
  }

  function send(commands, command, args) {
    if (!commands || typeof commands.dispatch !== "function") return unavailable();
    if (!RECIPES.includes(args.recipe)) return unavailable(`"${String(args.recipe)}" is not a recipe.`);
    return commands.dispatch(command, args);
  }

  /** A hopper's resin: a code sets it, an empty string clears the hopper. */
  function setResin(commands, recipe, layer, index, resin) {
    const code = String(resin == null ? "" : resin).trim();
    if (code === "") return send(commands, COMMAND.clear, { recipe, layer, index });
    return send(commands, COMMAND.resin, { recipe, layer, index, resin: code });
  }

  /** A hopper's blend, as typed: the contract normalises the text. */
  function setBlend(commands, recipe, layer, index, pct) {
    return send(commands, COMMAND.blend, { recipe, layer, index, pct });
  }

  function setShare(commands, recipe, layer, pct) {
    return send(commands, COMMAND.share, { recipe, layer, pct });
  }

  /** One assignment onto another slot: the application swaps or moves. */
  function move(commands, recipe, from, to) {
    return send(commands, COMMAND.move, { recipe, layer: from.layer, index: from.index, toLayer: to.layer, toIndex: to.index });
  }

  /** The bulk edit's Apply: every changed hopper's resin and/or blend as
   * ONE command - the contract shapes each entry, the executor checks
   * every position and layer total before writing any of it. */
  function applyAssignments(commands, recipe, hoppers) {
    return send(commands, COMMAND.assign, { recipe, hoppers });
  }

  function copyLayer(commands, recipe, layer, toLayer) {
    return send(commands, COMMAND.copyLayer, { recipe, layer, toLayer });
  }

  function clearLayer(commands, recipe, layer) {
    return send(commands, COMMAND.clearLayer, { recipe, layer });
  }

  function undo(commands, recipe) {
    return send(commands, COMMAND.undo, { recipe });
  }

  function redo(commands, recipe) {
    return send(commands, COMMAND.redo, { recipe });
  }

  return Object.freeze({
    RECIPES, COMMAND, READ_ONLY_REASON, NO_BRIDGE,
    abilities, reason, setResin, setBlend, setShare, move, applyAssignments, copyLayer, clearLayer, undo, redo
  });
});
