/* Station admin bridge - administrator access and Workspace Management as
 * Station is allowed to see them, and the things it is allowed to ask.
 *
 * THE FIFTH BRIDGE
 *
 *   station-state-bridge.js        application -> Station   the job
 *   station-command-bridge.js      Station -> application   recipe edits
 *   station-connection-bridge.js   both ways, narrowly      the LINE CONNECTION
 *   station-recipes-bridge.js      both ways, narrowly      SAVED RECIPES
 *   station-admin-bridge.js        both ways, narrowly      ADMIN ACCESS and
 *                                                           WORKSPACE MANAGEMENT
 *
 * The application already has one administrator identity (resin-admin.js:
 * an email-and-password sign-in verified against the admin table, held by
 * the one admin client and shared by every admin panel on the floor UI)
 * and one Workspace Management service (workspace-recovery.js: the admin
 * procedures for listing workspaces, their linked devices, adding this
 * device, renaming, creating, reassigning ownership, disconnecting a
 * device, merging and deleting). None of it may be re-implemented in
 * Station: Station must never hold a second admin session, a second
 * client, a second copy of a procedure or a second list of workspaces
 * that outlives the page it draws.
 *
 * So this module is a window and a letterbox, and nothing else:
 *
 *   Producer (app.js, once):  connect({ read, actions }) -> { publish, disconnect }
 *   Consumer (Station):       getAccess(), subscribe(fn), isConnected(),
 *                             capabilities(), request(action, args)
 *
 * The window is the state bridge's own machinery (create()): a lazy read,
 * deep-cloned and deeply frozen, one coalesced notification per tick. What
 * it carries is small (project()): whether the admin check has run, whether
 * an administrator is signed in and under what email, and this device's
 * own RT Sync identity as a label and two short diagnostic ids. The
 * letterbox carries a fixed vocabulary of ACTIONS to functions the
 * application hands over at connect time - the application's OWN sign-in,
 * sign-out and Workspace Management procedures, the same ones the floor
 * UI's Sudo panel runs - and returns a frozen result value, never a throw.
 *
 * WHAT CROSSES, AND WHAT DOES NOT
 *
 * A request's answer is rebuilt here by allow-list (normalize()): a
 * workspace is its id, name, counts and dates; a linked device is its
 * membership id, label, role, last-seen time and whether it is this
 * device. Station never learns a table, a procedure name, a session, a
 * token, a full anonymous identity of its own, or a client. A password
 * crosses the letterbox once, inward, on signIn, and is held nowhere.
 */
(function (root, factory) {
  const stateBridge = typeof require === "function"
    ? require("./station-state-bridge.js")
    : (root && root.PolynStationStateBridge);
  const api = factory(stateBridge);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationAdminBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (stateBridge) {
  "use strict";

  /* The letterbox's whole vocabulary. Each one is an application-level
   * operation the floor UI's Sudo panel already has a control for; a name
   * outside this list is refused at connect time and at request time. */
  const ACTIONS = Object.freeze([
    "signIn",             // { email, password }   verify administrator access
    "signOut",            //                       end it on this device
    "listWorkspaces",     //                       -> { workspaces }
    "workspaceDevices",   // { id }                -> { devices }
    "addThisDevice",      // { id }                -> { alreadyMember, role }
    "createLine",         // { name }              -> { id, name }
    "renameLine",         // { id, name }          -> { id, name }
    "transferOwnership",  // { id, memberId }
    "disconnectDevice",   // { id, memberId }
    "mergeWorkspace",     // { id, targetId }      -> { recipesMerged, profilesMerged }
    "deleteWorkspace"     // { id }
  ]);

  /* The arguments each action takes, and nothing else crosses. */
  const ARGUMENTS = Object.freeze({
    signIn: Object.freeze(["email", "password"]),
    signOut: Object.freeze([]),
    listWorkspaces: Object.freeze([]),
    workspaceDevices: Object.freeze(["id"]),
    addThisDevice: Object.freeze(["id"]),
    createLine: Object.freeze(["name"]),
    renameLine: Object.freeze(["id", "name"]),
    transferOwnership: Object.freeze(["id", "memberId"]),
    disconnectDevice: Object.freeze(["id", "memberId"]),
    mergeWorkspace: Object.freeze(["id", "targetId"]),
    deleteWorkspace: Object.freeze(["id"])
  });

  /* Failure codes Station may read. `not_authenticated` and `access_denied`
   * are the two that mean the administrator session is gone: the producer
   * re-checks access when it answers with either, and the window follows. */
  const ERROR_CODES = Object.freeze([
    "unknown_action", "unavailable", "bad_argument", "not_authenticated", "access_denied",
    "not_ready", "not_found", "invalid_name", "failed"
  ]);

  const NONE = Object.freeze([]);
  const SHORT_ID = 8;

  function stringOr(value, fallback) {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function shortId(value) {
    return value ? String(value).slice(0, SHORT_ID) : "";
  }

  /* --------------------------------------------------------------------
   *   Projection
   * ------------------------------------------------------------------ */

  /**
   * Administrator access and this device, as Station sees them. Pure over
   * the admin service's public state and RT Sync's recovery descriptor;
   * returns a fresh plain object every call.
   *
   * @param {object|null} adminState  { ready, signedIn, isAdmin, email }
   * @param {object|null} device      { ready, userId, deviceId, deviceLabel }
   */
  function project(adminState, device) {
    const access = adminState && typeof adminState === "object" ? adminState : null;
    const descriptor = device && typeof device === "object" ? device : null;
    const signedIn = !!(access && access.ready && access.signedIn && access.isAdmin);
    return {
      access: {
        ready: !!(access && access.ready),
        signedIn,
        email: signedIn ? stringOr(access.email, "") : ""
      },
      device: {
        ready: !!(descriptor && descriptor.ready),
        label: descriptor ? stringOr(descriptor.deviceLabel, "") : "",
        userIdShort: descriptor ? shortId(descriptor.userId) : "",
        deviceIdShort: descriptor ? shortId(descriptor.deviceId) : ""
      }
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

  function projectWorkspace(row) {
    const item = row && typeof row === "object" ? row : {};
    return Object.freeze({
      id: stringOr(item.id, ""),
      name: stringOr(item.name, ""),
      memberCount: count(item.memberCount),
      recipeCount: count(item.recipeCount),
      profileCount: count(item.profileCount),
      createdAt: stringOr(item.createdAt, ""),
      lastActivityAt: stringOr(item.lastActivityAt, ""),
      thisDevice: !!item.thisDevice
    });
  }

  function projectDevice(row) {
    const item = row && typeof row === "object" ? row : {};
    return Object.freeze({
      memberId: stringOr(item.memberId, ""),
      label: stringOr(item.label, ""),
      role: item.role === "owner" ? "owner" : "member",
      lastSeenAt: stringOr(item.lastSeenAt, ""),
      thisDevice: !!item.thisDevice
    });
  }

  /* Whatever an action returned, as a frozen result carrying only what
   * Station may read for THAT action. The producer answers in the shapes
   * named beside ACTIONS; anything else it put in the answer is dropped. */
  function normalize(name, value) {
    if (!value || typeof value !== "object" || typeof value.ok !== "boolean") {
      return value ? Object.freeze({ ok: true }) : failure("failed", "The application did not complete the action.");
    }
    if (!value.ok) return failure(value.code, value.message);
    const out = { ok: true };
    switch (name) {
      case "listWorkspaces":
        out.workspaces = Object.freeze((Array.isArray(value.workspaces) ? value.workspaces : [])
          .map(projectWorkspace).filter(workspace => workspace.id));
        break;
      case "workspaceDevices":
        out.devices = Object.freeze((Array.isArray(value.devices) ? value.devices : [])
          .map(projectDevice).filter(device => device.memberId));
        break;
      case "addThisDevice":
        out.alreadyMember = !!value.alreadyMember;
        out.role = value.role === "owner" ? "owner" : "member";
        break;
      case "createLine":
      case "renameLine":
        if (value.id) out.id = String(value.id);
        if (value.name) out.name = String(value.name);
        break;
      case "mergeWorkspace":
        out.recipesMerged = count(value.recipesMerged);
        out.profilesMerged = count(value.profilesMerged);
        break;
      default:
        break;
    }
    return Object.freeze(out);
  }

  const ARGUMENT_MESSAGES = Object.freeze({
    email: "An email address is required.",
    password: "A password is required.",
    name: "A line name is required.",
    id: "A workspace is required.",
    targetId: "A target workspace is required.",
    memberId: "A linked device is required."
  });

  /* The request's arguments, checked and rebuilt: a name is text with its
   * whitespace collapsed (the server normalizes it again, by its own rule),
   * an email is trimmed, a password is taken as typed, an id is text.
   * Anything else that was passed is dropped. */
  function normalizeArguments(name, args) {
    const given = args && typeof args === "object" ? args : {};
    const out = {};
    for (const field of ARGUMENTS[name]) {
      const value = given[field];
      const usable = field === "password" ? typeof value === "string" && value.length > 0 : typeof value === "string" && value.trim();
      if (!usable) return failure("bad_argument", ARGUMENT_MESSAGES[field], { field });
      if (field === "password") out[field] = value;
      else if (field === "name") out[field] = value.trim().replace(/\s+/g, " ");
      else out[field] = value.trim();
    }
    if (name === "mergeWorkspace" && out.id === out.targetId) {
      return failure("bad_argument", "Choose a different target workspace.", { field: "targetId" });
    }
    return { ok: true, args: Object.freeze(out) };
  }

  /* --------------------------------------------------------------------
   *   The bridge
   * ------------------------------------------------------------------ */

  function createBridge(options) {
    if (!stateBridge || typeof stateBridge.create !== "function") {
      throw new Error("station-admin-bridge: the state bridge is not loaded");
    }
    const inner = stateBridge.create(options);
    let actions = null;   // the producer's action functions, or null

    function capabilities() {
      return actions ? Object.freeze(Object.keys(actions)) : NONE;
    }

    /* Ask the application to do one of the ACTIONS. Never throws. */
    async function request(name, args) {
      if (!ACTIONS.includes(name)) return failure("unknown_action", `"${name}" is not an administrator action.`);
      if (!actions) return failure("unavailable", "No application is connected to Station's administrator tools.");
      const action = actions[name];
      if (typeof action !== "function") return failure("unavailable", `The application does not offer "${name}".`);
      const checked = normalizeArguments(name, args);
      if (!checked.ok) return checked;
      try {
        return normalize(name, await action(checked.args));
      } catch (error) {
        const message = error && error.message ? String(error.message) : "The action failed.";
        return failure("failed", message);
      }
    }

    /**
     * Register the application. `read` returns the projected access (see
     * project()); `actions` maps ACTIONS names to the application's own
     * async functions. Returns the ONLY handle that can publish or
     * disconnect.
     */
    function connect(source) {
      const declared = source && source.actions && typeof source.actions === "object" ? source.actions : {};
      const unknown = Object.keys(declared).filter(name => !ACTIONS.includes(name));
      if (unknown.length) {
        throw new TypeError(`station-admin-bridge: unknown action "${unknown[0]}"`);
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
      getAccess: inner.getSnapshot,
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
    normalize,
    normalizeArguments,
    connect: shared.connect,
    getAccess: shared.getAccess,
    subscribe: shared.subscribe,
    isConnected: shared.isConnected,
    getRevision: shared.getRevision,
    capabilities: shared.capabilities,
    request: shared.request,
    // A fresh, isolated bridge for tests; production has one.
    create: createBridge
  });
});
