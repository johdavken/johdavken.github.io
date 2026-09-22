/* The plan's two moves: the running recipe copied into the plan, and the
 * plan promoted into the running recipe (the changeover itself).
 *
 * The fourth Slate file allowed to say `.dispatch(`. Neither command
 * names a recipe - each is about both - and the application decides what
 * is promotable (no_plan) or already the same (ok, unchanged).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlatePlanActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMMAND = Object.freeze({ copy: "copyCurrentToNext", promote: "promoteNextRecipe" });
  const LABEL = Object.freeze({ copy: "Copy current → Next", promote: "Promote Next → Current" });
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

  /**
   * @param {object|null} commands
   * @param {object} [options]  { readOnly, planned } - promote needs a plan
   */
  function can(commands, options) {
    const settings = options || {};
    const list = settings.readOnly ? [] : offered(commands);
    return Object.freeze({
      copy: list.includes(COMMAND.copy),
      promote: list.includes(COMMAND.promote) && settings.planned !== false
    });
  }

  function reason(commands, action, options) {
    const settings = options || {};
    if (settings.readOnly) return READ_ONLY_REASON;
    if (!connected(commands)) return "no application is connected to Slate commands.";
    if (action === "promote" && settings.planned === false) return "nothing is planned.";
    return `the application does not offer ${COMMAND[action] || "this"} from Slate.`;
  }

  function send(commands, command) {
    if (!commands || typeof commands.dispatch !== "function") return Object.freeze({ ok: false, code: "unavailable", message: NO_BRIDGE });
    return commands.dispatch(command, {});
  }

  function copy(commands) {
    return send(commands, COMMAND.copy);
  }

  function promote(commands) {
    return send(commands, COMMAND.promote);
  }

  return Object.freeze({ COMMAND, LABEL, READ_ONLY_REASON, NO_BRIDGE, can, reason, copy, promote });
});
