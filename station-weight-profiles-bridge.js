/* Station weight-profiles bridge - the workspace's Receiver Weight Profiles
 * as Station is allowed to see them, and the things it is allowed to ask
 * of them.
 *
 * THE SIXTH BRIDGE
 *
 *   station-state-bridge.js           application -> Station   the job
 *   station-command-bridge.js         Station -> application   recipe and
 *                                                              equipment edits
 *   station-connection-bridge.js      both ways, narrowly      the LINE CONNECTION
 *   station-recipes-bridge.js         both ways, narrowly      SAVED RECIPES
 *   station-admin-bridge.js           both ways, narrowly      ADMIN TOOLS
 *   station-weight-profiles-bridge.js both ways, narrowly      WEIGHT PROFILES
 *
 * A Receiver Weight Profile is a reusable record of physical equipment
 * values - a Workspace Configuration of type `receiver_weight_profile`,
 * shared by the members of an RT Sync workspace: the receiver weight at
 * each hopper position, and (when measured) the hopper geometry. It is not
 * live job state, so it does not travel on the state bridge; and loading
 * one is not a command, because the application already has the one
 * validated, atomic way of applying a profile to the line (the
 * workspace-configuration payload helpers, driven from app.js), with its
 * own tail - the weights grid rebuilt, the session saved, RT Sync told at
 * once. None of it may be re-implemented in Station: Station must never
 * keep a second profile list, a second cache, a second payload format or
 * a second apply path.
 *
 * So, like the recipes bridge, this module is a window and a letterbox:
 *
 *   Producer (app.js, once):  connect({ read, actions }) -> { publish, disconnect }
 *   Consumer (Station):       getBook(), subscribe(fn), isConnected(),
 *                             capabilities(), request(action, args)
 *
 * The window is the state bridge's own machinery (create()): a lazy read,
 * deep-cloned and deeply frozen, one coalesced notification per tick. The
 * letterbox carries a fixed vocabulary of ACTIONS to functions the
 * application hands over at connect time - the application's OWN save,
 * update, load, rename, duplicate, delete and refresh, the same closures
 * the floor UI's Weight Profiles block runs - and returns a frozen result
 * value, never a throw.
 *
 * WHAT CROSSES, AND WHAT DOES NOT
 *
 * project() below is the allow-list. It reads the service's cached
 * envelope for one workspace and keeps: each profile's id, name, when it
 * was last updated, the line type and naming mode it was saved for, its
 * receiver weights as layers of six positions, and whether it also
 * carries geometry (usable heights, circumferences, gallons) - because
 * loading such a profile changes the drawn hopper's shape, and the
 * operator is told so before confirming. It drops: the geometry's values
 * (Station does not edit geometry), the normalized name, the author and
 * editor ids, the schema version, every recipe (the recipes bridge's).
 * Station never learns a table, an RPC, a cache key or a credential.
 */
(function (root, factory) {
  const stateBridge = typeof require === "function"
    ? require("./station-state-bridge.js")
    : (root && root.PolynStationStateBridge);
  const api = factory(stateBridge);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationWeightProfilesBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (stateBridge) {
  "use strict";

  /* The letterbox's whole vocabulary. Each one is an application-level
   * operation the floor UI's Weight Profiles block already has a button
   * for; a name outside this list is refused at connect time and at
   * request time. */
  const ACTIONS = Object.freeze([
    "saveCurrentWeights",     // { name }      save the line's receiver weights under a new name
    "replaceWeightProfile",   // { id }        overwrite a saved profile with the line's weights
    "loadWeightProfile",      // { id }        apply a saved profile's weights to the line
    "renameWeightProfile",    // { id, name }
    "duplicateWeightProfile", // { id, name }  a copy under a new name
    "deleteWeightProfile",    // { id }
    "refresh"                 //               re-read the workspace's profiles from the cloud
  ]);

  /* The arguments each action takes, and nothing else crosses. */
  const ARGUMENTS = Object.freeze({
    saveCurrentWeights: Object.freeze(["name"]),
    replaceWeightProfile: Object.freeze(["id"]),
    loadWeightProfile: Object.freeze(["id"]),
    renameWeightProfile: Object.freeze(["id", "name"]),
    duplicateWeightProfile: Object.freeze(["id", "name"]),
    deleteWeightProfile: Object.freeze(["id"]),
    refresh: Object.freeze([])
  });

  /* The service's own failure codes, so Station can tell a duplicate name
   * (offer to replace) from everything else (say why); plus the two the
   * load adds - the profile is gone from the workspace, or it was saved
   * for a different line type or layer layout than the one running. */
  const ERROR_CODES = Object.freeze([
    "unknown_action", "unavailable", "bad_argument", "duplicate_name", "invalid_name",
    "not_found", "incompatible",
    "access_denied", "not_authenticated", "network_error", "failed"
  ]);

  const NONE = Object.freeze([]);
  const POSITIONS = 6;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function stringOr(value, fallback) {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  /* --------------------------------------------------------------------
   *   Projection
   * ------------------------------------------------------------------ */

  /* Whether a stored profile carries hopper geometry beside its weights.
   * The application's apply writes a geometry array whenever it is
   * PRESENT (workspace-configuration-payloads.js), an all-zero one
   * included - so presence, not value, is what changes the line. */
  function carriesGeometry(payload, layers) {
    if (finite(payload.hopper_circumference_in) > 0) return true;
    return layers.some(layer => layer && typeof layer === "object" && (
      Array.isArray(layer.usable_heights_in) || Array.isArray(layer.circumferences_in) || Array.isArray(layer.usable_gallons)
    ));
  }

  /* One saved profile, from the stored payload's shape
   * (workspace-configuration-payloads.js: line_type, layers[].name,
   * receiver_weights_lb[6]) into what the Weights page shows. */
  function projectProfile(item) {
    const payload = item && item.payload && typeof item.payload === "object" ? item.payload : {};
    const layers = Array.isArray(payload.layers) ? payload.layers : [];
    return {
      id: String(item.id),
      name: stringOr(item.name, ""),
      updatedAt: stringOr(item.updatedAt, ""),
      lineType: finite(payload.line_type),
      hopperNamingMode: payload.hopper_naming_mode === "main" ? "main" : "standard",
      hasGeometry: carriesGeometry(payload, layers),
      layers: layers.map(layer => {
        const weights = Array.isArray(layer && layer.receiver_weights_lb) ? layer.receiver_weights_lb : [];
        return {
          name: String((layer && layer.name) || ""),
          weights: Array.from({ length: POSITIONS }, (_, index) => finite(weights[index]))
        };
      })
    };
  }

  /**
   * The workspace's saved weight profiles as Station sees them. Pure over
   * the service's cached envelope (getCached(workspaceId)) and a few facts
   * the application resolves beside it; returns a fresh plain object every
   * call. A null envelope, or one for another workspace, reads as no
   * profiles - never as someone else's.
   *
   * @param {object|null} cache  the service's envelope: { workspaceId,
   *        cachedAt, items: { receiver_weight_profile: [...] } }
   * @param {object} [options]
   * @param {string} [options.workspaceId]  the connected workspace's id
   * @param {string} [options.displayName]  the line's name, as the
   *        application resolves it for the workspace
   * @param {boolean} [options.refreshing]  a refresh is in flight
   */
  function project(cache, options) {
    const settings = options || {};
    const workspaceId = settings.workspaceId ? String(settings.workspaceId) : "";
    const envelope = cache && typeof cache === "object" && workspaceId && String(cache.workspaceId) === workspaceId ? cache : null;
    const items = envelope && envelope.items && Array.isArray(envelope.items.receiver_weight_profile) ? envelope.items.receiver_weight_profile : [];
    const profiles = items
      .filter(item => item && typeof item === "object" && item.id && item.type === "receiver_weight_profile")
      .map(projectProfile);
    return {
      assigned: !!workspaceId,
      workspace: workspaceId ? {
        id: workspaceId,
        displayName: stringOr(settings.displayName, "Connected line")
      } : null,
      cachedAt: envelope && Number.isFinite(envelope.cachedAt) ? envelope.cachedAt : 0,
      refreshing: !!settings.refreshing,
      profiles,
      count: profiles.length
    };
  }

  /* --------------------------------------------------------------------
   *   Results and arguments
   * ------------------------------------------------------------------ */

  function failure(code, message, extra) {
    const known = ERROR_CODES.includes(code) ? code : "failed";
    const out = { ok: false, code: known, message: message || "" };
    if (extra && typeof extra.field === "string") out.field = extra.field;
    return Object.freeze(out);
  }

  /* Whatever an action returned, as a frozen result carrying only what
   * Station may read: ok, the code and message of a failure, the id of a
   * saved profile. A service result carries the whole stored item, author
   * ids included; none of that crosses. */
  function normalize(value) {
    if (value && typeof value === "object" && typeof value.ok === "boolean") {
      if (value.ok) {
        const out = { ok: true };
        const id = value.item && value.item.id ? value.item.id : value.id;
        if (id) out.id = String(id);
        return Object.freeze(out);
      }
      return failure(value.code, value.message);
    }
    return value ? Object.freeze({ ok: true }) : failure("failed", "The application did not complete the action.");
  }

  /* The request's arguments, checked and rebuilt: a name is text with its
   * whitespace collapsed (the server normalizes it again, by its own rule),
   * an id is text. Anything else that was passed is dropped. */
  function normalizeArguments(name, args) {
    const given = args && typeof args === "object" ? args : {};
    const out = {};
    for (const field of ARGUMENTS[name]) {
      const value = given[field];
      if (typeof value !== "string" || !value.trim()) {
        return failure("bad_argument", field === "name" ? "A profile name is required." : "The profile must be named by id.", { field });
      }
      out[field] = field === "name" ? value.trim().replace(/\s+/g, " ") : value.trim();
    }
    return { ok: true, args: Object.freeze(out) };
  }

  /* --------------------------------------------------------------------
   *   The bridge
   * ------------------------------------------------------------------ */

  function createBridge(options) {
    if (!stateBridge || typeof stateBridge.create !== "function") {
      throw new Error("station-weight-profiles-bridge: the state bridge is not loaded");
    }
    const inner = stateBridge.create(options);
    let actions = null;   // the producer's action functions, or null

    function capabilities() {
      return actions ? Object.freeze(Object.keys(actions)) : NONE;
    }

    /* Ask the application to do one of the ACTIONS. Never throws. */
    async function request(name, args) {
      if (!ACTIONS.includes(name)) return failure("unknown_action", `"${name}" is not a weight-profile action.`);
      if (!actions) return failure("unavailable", "No application is connected to Station's weight profiles.");
      const action = actions[name];
      if (typeof action !== "function") return failure("unavailable", `The application does not offer "${name}".`);
      const checked = normalizeArguments(name, args);
      if (!checked.ok) return checked;
      try {
        return normalize(await action(checked.args));
      } catch (error) {
        const message = error && error.message ? String(error.message) : "The action failed.";
        return failure("failed", message);
      }
    }

    /**
     * Register the application. `read` returns the projected book (see
     * project()); `actions` maps ACTIONS names to the application's own
     * async functions. Returns the ONLY handle that can publish or
     * disconnect.
     */
    function connect(source) {
      const declared = source && source.actions && typeof source.actions === "object" ? source.actions : {};
      const unknown = Object.keys(declared).filter(name => !ACTIONS.includes(name));
      if (unknown.length) {
        throw new TypeError(`station-weight-profiles-bridge: unknown action "${unknown[0]}"`);
      }
      const handle = inner.connect({ read: source && source.read });
      const picked = {};
      for (const name of ACTIONS) {
        if (typeof declared[name] === "function") picked[name] = declared[name];
      }
      actions = picked;
      return Object.freeze({
        publish: handle.publish,
        disconnect() {
          if (!handle.isActive()) return false;
          actions = null;
          return handle.disconnect();
        },
        isActive: handle.isActive
      });
    }

    return Object.freeze({
      connect,
      getBook: inner.getSnapshot,
      subscribe: inner.subscribe,
      isConnected: inner.isConnected,
      getRevision: inner.getRevision,
      capabilities,
      request
    });
  }

  const shared = createBridge();

  return Object.freeze({
    ACTIONS,
    ARGUMENTS,
    ERROR_CODES,
    project,
    normalizeArguments,
    connect: shared.connect,
    getBook: shared.getBook,
    subscribe: shared.subscribe,
    isConnected: shared.isConnected,
    getRevision: shared.getRevision,
    capabilities: shared.capabilities,
    request: shared.request,
    // A fresh, isolated bridge for tests; production has one.
    create: createBridge
  });
});
