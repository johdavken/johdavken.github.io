/* Station recipes bridge - the workspace's saved recipes as Station is
 * allowed to see them, and the three things it is allowed to ask of them.
 *
 * THE FOURTH BRIDGE
 *
 *   station-state-bridge.js        application -> Station   the job
 *   station-command-bridge.js      Station -> application   recipe edits
 *   station-connection-bridge.js   both ways, narrowly      the LINE CONNECTION
 *   station-recipes-bridge.js      both ways, narrowly      SAVED RECIPES
 *
 * Saved recipes are reusable records - Workspace Configurations of type
 * `recipe`, shared by the members of an RT Sync workspace - and not live
 * job state, which is why they do not travel on the state bridge and why
 * saving one is not a command: a command changes the running job and is
 * answered at once; a save is a cloud write that is answered when the
 * server has. All of it already exists in the application (the
 * workspace-configurations service, driven from app.js). None of it may be
 * re-implemented in Station: Station must never keep a second recipe list,
 * a second cache, a second payload format or a second save path.
 *
 * So this module is a window and a letterbox, and nothing else:
 *
 *   Producer (app.js, once):  connect({ read, actions }) -> { publish, disconnect }
 *   Consumer (Station):       getBook(), subscribe(fn), isConnected(),
 *                             capabilities(), request(action, args)
 *
 * The window is the state bridge's own machinery (create()): a lazy read,
 * deep-cloned and deeply frozen, one coalesced notification per tick. The
 * letterbox carries a fixed vocabulary of ACTIONS to functions the
 * application hands over at connect time - the application's OWN save,
 * update and refresh, the same closures the floor UI's Recipe Book runs -
 * and returns a frozen result value, never a throw.
 *
 * WHAT CROSSES, AND WHAT DOES NOT
 *
 * project() below is the allow-list. It reads the service's cached envelope
 * for one workspace and keeps: each recipe's id, name, favourite flag,
 * when it was last updated, and its blend as layers of hoppers - the same
 * shape the state bridge gives the planned recipe, so Station reads a saved
 * recipe exactly as it reads a plan. It drops: the normalized name, the
 * author and editor ids, the schema version, every receiver-weight profile
 * (a different record, and nothing in Station reads one yet). Station
 * never learns a table, an RPC, a cache key or a credential.
 */
(function (root, factory) {
  const stateBridge = typeof require === "function"
    ? require("./station-state-bridge.js")
    : (root && root.PolynStationStateBridge);
  const api = factory(stateBridge);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationRecipesBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (stateBridge) {
  "use strict";

  /* The letterbox's whole vocabulary. Each one is an application-level
   * operation the floor UI's Recipe Book already has a button for; a name
   * outside this list is refused at connect time and at request time. */
  const ACTIONS = Object.freeze([
    "saveCurrentRecipe",  // { name }  save the running recipe under a new name
    "replaceRecipe",      // { id }    overwrite a saved recipe with the running one
    "refresh"             //           re-read the workspace's recipes from the cloud
  ]);

  /* The arguments each action takes, and nothing else crosses. */
  const ARGUMENTS = Object.freeze({
    saveCurrentRecipe: Object.freeze(["name"]),
    replaceRecipe: Object.freeze(["id"]),
    refresh: Object.freeze([])
  });

  /* The service's own failure codes, so Station can tell a duplicate name
   * (offer to replace) from everything else (say why). */
  const ERROR_CODES = Object.freeze([
    "unknown_action", "unavailable", "bad_argument", "duplicate_name", "invalid_name",
    "access_denied", "not_authenticated", "network_error", "failed"
  ]);

  const NONE = Object.freeze([]);

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

  /* One saved recipe's blend, from the stored payload's shape
   * (workspace-configuration-payloads.js: line_type, layers[].layer_pct,
   * hoppers[].resin_name) into the shape the state bridge gives a plan. */
  function projectRecipe(item) {
    const payload = item && item.payload && typeof item.payload === "object" ? item.payload : {};
    const layers = Array.isArray(payload.layers) ? payload.layers : [];
    return {
      id: String(item.id),
      name: stringOr(item.name, ""),
      favorite: !!item.favorite,
      updatedAt: stringOr(item.updatedAt, ""),
      lineType: finite(payload.line_type),
      hopperNamingMode: payload.hopper_naming_mode === "main" ? "main" : "standard",
      layers: layers.map(layer => ({
        name: String((layer && layer.name) || ""),
        layerPct: finite(layer && layer.layer_pct),
        hoppers: (Array.isArray(layer && layer.hoppers) ? layer.hoppers : []).map((hopper, index) => ({
          index,
          pct: finite(hopper && hopper.pct),
          resinName: hopper && hopper.resin_name ? String(hopper.resin_name) : ""
        }))
      }))
    };
  }

  /**
   * The workspace's saved recipes as Station sees them. Pure over the
   * service's cached envelope (getCached(workspaceId)) and a few facts the
   * application resolves beside it; returns a fresh plain object every
   * call. A null envelope, or one for another workspace, reads as no
   * recipes - never as someone else's.
   *
   * @param {object|null} cache  the service's envelope: { workspaceId,
   *        cachedAt, items: { recipe: [...] } }
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
    const items = envelope && envelope.items && Array.isArray(envelope.items.recipe) ? envelope.items.recipe : [];
    const recipes = items
      .filter(item => item && typeof item === "object" && item.id && item.type === "recipe")
      .map(projectRecipe);
    return {
      assigned: !!workspaceId,
      workspace: workspaceId ? {
        id: workspaceId,
        displayName: stringOr(settings.displayName, "Connected line")
      } : null,
      cachedAt: envelope && Number.isFinite(envelope.cachedAt) ? envelope.cachedAt : 0,
      refreshing: !!settings.refreshing,
      recipes,
      count: recipes.length
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
   * saved recipe. A service result carries the whole stored item, author
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
        return failure("bad_argument", field === "name" ? "A recipe name is required." : "The recipe must be named by id.", { field });
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
      throw new Error("station-recipes-bridge: the state bridge is not loaded");
    }
    const inner = stateBridge.create(options);
    let actions = null;   // the producer's action functions, or null

    function capabilities() {
      return actions ? Object.freeze(Object.keys(actions)) : NONE;
    }

    /* Ask the application to do one of the ACTIONS. Never throws. */
    async function request(name, args) {
      if (!ACTIONS.includes(name)) return failure("unknown_action", `"${name}" is not a saved-recipe action.`);
      if (!actions) return failure("unavailable", "No application is connected to Station's saved recipes.");
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
        throw new TypeError(`station-recipes-bridge: unknown action "${unknown[0]}"`);
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
