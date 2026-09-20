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
 *                                                           the ADMIN TOOLS
 *
 * The application already has one administrator identity (resin-admin.js:
 * an email-and-password sign-in verified against the admin table, held by
 * the one admin client and shared by every admin panel on the floor UI)
 * and one Workspace Management service (workspace-recovery.js: the admin
 * procedures for listing workspaces, their linked devices, adding this
 * device, renaming, creating, reassigning ownership, disconnecting a
 * device, merging and deleting) and one Line Configuration service
 * (line-configurations-service.js: the admin procedures for listing the
 * production lines' definitions and saving one, validated by
 * line-identity.js) and one Resin Database (resin-admin.js: the admin
 * procedures for listing the catalog's records, active and inactive,
 * saving one and deleting one - the same instance that holds the
 * sign-in). None of it may be re-implemented in
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
 * device; a line configuration is its definition's fields and its id; a
 * resin is its code, its two densities, whether it is active, and its id.
 * Station never learns a table, a procedure name, a session, a
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
    "deleteWorkspace",    // { id }
    "listLineConfigurations",  //                  -> { lines }
    "saveLineConfiguration",   // { id?, line }    -> { line }   create when id is empty
    "listResins",         //                       -> { resins }  active and inactive
    "saveResin",          // { id?, resin }        -> { resin }   create when id is empty
    "deleteResin"         // { id }                permanent; Inactive is the usual choice
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
    deleteWorkspace: Object.freeze(["id"]),
    listLineConfigurations: Object.freeze([]),
    // `id` is optional here - empty means create - and `line` is an object,
    // rebuilt field by field by normalizeLineConfiguration().
    saveLineConfiguration: Object.freeze(["id", "line"]),
    listResins: Object.freeze([]),
    // As above: an optional id and one object, rebuilt by normalizeResin().
    saveResin: Object.freeze(["id", "resin"]),
    deleteResin: Object.freeze(["id"])
  });

  /* A line configuration's fields, as they cross in both directions: the
   * definition line-identity.js validates and the service saves, and
   * nothing else the row carries. */
  const LINE_FIELDS = Object.freeze([
    "lineNumber", "displayName", "aliases", "layerCount", "hopperCounts", "layerAPosition",
    "hopperGeometry", "hopperNamingMode", "hopperManufacturer", "isActive", "metadata"
  ]);

  /* A resin's fields, as they cross in both directions: the record
   * resin-admin.js validates and saves, and nothing else the row carries.
   * The unit is in the name so a number never crosses without one. */
  const RESIN_FIELDS = Object.freeze([
    "resinCode", "densityGCm3", "bulkDensityLbFt3", "isActive"
  ]);

  /* Failure codes Station may read. `not_authenticated` and `access_denied`
   * are the two that mean the administrator session is gone: the producer
   * re-checks access when it answers with either, and the window follows.
   * `duplicate_code` is a resin save refused for a code the catalog already
   * holds, so the tool can keep the draft and point at the field. */
  const ERROR_CODES = Object.freeze([
    "unknown_action", "unavailable", "bad_argument", "not_authenticated", "access_denied",
    "not_ready", "not_found", "invalid_name", "duplicate_code", "failed"
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

  function nullableInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
  }

  /* A number or null: blank is null, a numeric string is its number (the
   * database's numeric columns may arrive as text), anything else is null. */
  function nullableNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(number) ? number : null;
  }

  function plainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return {};
    }
  }

  /* Hoppers per layer as a list of integers - one per layer, in recipe
   * order. Anything that is not a whole number is dropped here; how many
   * there must be and what range they may hold is line-identity's rule. */
  function integerList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(nullableInteger).filter(number => number !== null);
  }

  function aliasList(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const entry of value) {
      const alias = typeof entry === "string" ? entry.trim().replace(/\s+/g, " ") : "";
      if (alias && !out.includes(alias)) out.push(alias);
    }
    return out;
  }

  /* A line configuration as Station may read it: the definition's fields,
   * the row's id and when it last changed. Orientation is one of the two
   * sides or null - a single-layer line has no side, and an unknown value
   * is not a side. Metadata crosses as an opaque plain object so a save
   * from Station carries it back unchanged, as the floor UI's editor does. */
  function projectLineConfiguration(row) {
    const item = row && typeof row === "object" ? row : {};
    const position = item.layerAPosition === "inside" || item.layerAPosition === "outside" ? item.layerAPosition : null;
    return Object.freeze({
      id: stringOr(item.id, ""),
      lineNumber: nullableInteger(item.lineNumber),
      displayName: stringOr(item.displayName, ""),
      aliases: Object.freeze(aliasList(item.aliases)),
      layerCount: nullableInteger(item.layerCount),
      hopperCounts: Object.freeze(integerList(item.hopperCounts)),
      layerAPosition: position,
      hopperGeometry: stringOr(item.hopperGeometry, ""),
      hopperNamingMode: stringOr(item.hopperNamingMode, ""),
      hopperManufacturer: stringOr(item.hopperManufacturer, ""),
      isActive: item.isActive !== false,
      metadata: Object.freeze(plainObject(item.metadata)),
      updatedAt: stringOr(item.updatedAt, "")
    });
  }

  /* A resin as Station may read it: its code, its two densities (a number
   * or null - unknown is null, never zero), whether it is active, the
   * row's id and when it last changed. */
  function projectResin(row) {
    const item = row && typeof row === "object" ? row : {};
    return Object.freeze({
      id: stringOr(item.id, ""),
      resinCode: stringOr(item.resinCode, ""),
      densityGCm3: nullableNumber(item.densityGCm3),
      bulkDensityLbFt3: nullableNumber(item.bulkDensityLbFt3),
      isActive: item.isActive !== false,
      updatedAt: stringOr(item.updatedAt, "")
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
      case "listLineConfigurations":
        out.lines = Object.freeze((Array.isArray(value.lines) ? value.lines : [])
          .map(projectLineConfiguration).filter(line => line.id));
        break;
      case "saveLineConfiguration":
        out.line = projectLineConfiguration(value.line);
        break;
      case "listResins":
        out.resins = Object.freeze((Array.isArray(value.resins) ? value.resins : [])
          .map(projectResin).filter(resin => resin.id));
        break;
      case "saveResin":
        out.resin = projectResin(value.resin);
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
    memberId: "A linked device is required.",
    line: "A line configuration is required.",
    resin: "A resin is required."
  });

  /* Where an action's field means something other than the shared word
   * above (`id` is a workspace's, unless the action is about a resin). */
  const ACTION_ARGUMENT_MESSAGES = Object.freeze({
    deleteResin: Object.freeze({ id: "A resin is required." })
  });

  const RESIN_FIELD_MESSAGES = Object.freeze({
    resinCode: "A resin code is required.",
    densityGCm3: "Density must be blank or a number.",
    bulkDensityLbFt3: "Bulk density must be blank or a number."
  });

  const LINE_FIELD_MESSAGES = Object.freeze({
    lineNumber: "A line number is required.",
    displayName: "A display name is required.",
    layerCount: "A layer count is required.",
    hopperCounts: "Hoppers per layer must be whole numbers.",
    layerAPosition: "Layer A must be Inside, Outside, or N/A.",
    hopperGeometry: "A hopper geometry is required.",
    hopperNamingMode: "A hopper naming mode is required.",
    hopperManufacturer: "The hopper manufacturer must be a word."
  });

  /* The configuration to save, rebuilt field by field from LINE_FIELDS:
   * numbers as integers, names as collapsed text, aliases as a list of
   * them, orientation as a side or null (N/A crosses as null), the two
   * modes and the manufacturer as text, active as a boolean, metadata as a plain object.
   * What the VALUES may be - the ranges, the orientation-versus-count
   * rule, the name conflicts, the manufacturers - is line-identity's to say, in the service,
   * and is not repeated here; this only refuses a field that is not the
   * kind of thing the definition holds. Anything else passed is dropped. */
  function normalizeLineConfiguration(value) {
    const given = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    if (!given) return failure("bad_argument", ARGUMENT_MESSAGES.line, { field: "line" });
    const out = {};
    const lineNumber = nullableInteger(given.lineNumber);
    if (lineNumber === null) return failure("bad_argument", LINE_FIELD_MESSAGES.lineNumber, { field: "lineNumber" });
    out.lineNumber = lineNumber;
    const displayName = typeof given.displayName === "string" ? given.displayName.trim().replace(/\s+/g, " ") : "";
    if (!displayName) return failure("bad_argument", LINE_FIELD_MESSAGES.displayName, { field: "displayName" });
    out.displayName = displayName;
    out.aliases = aliasList(given.aliases);
    const layerCount = nullableInteger(given.layerCount);
    if (layerCount === null) return failure("bad_argument", LINE_FIELD_MESSAGES.layerCount, { field: "layerCount" });
    out.layerCount = layerCount;
    if (given.hopperCounts !== undefined && given.hopperCounts !== null) {
      const counts = Array.isArray(given.hopperCounts) ? given.hopperCounts.map(nullableInteger) : null;
      if (!counts || counts.some(count => count === null)) return failure("bad_argument", LINE_FIELD_MESSAGES.hopperCounts, { field: "hopperCounts" });
      out.hopperCounts = counts;
    }
    const position = given.layerAPosition === null || given.layerAPosition === undefined || given.layerAPosition === "" || given.layerAPosition === "n/a"
      ? null
      : given.layerAPosition;
    if (position !== null && position !== "inside" && position !== "outside") {
      return failure("bad_argument", LINE_FIELD_MESSAGES.layerAPosition, { field: "layerAPosition" });
    }
    out.layerAPosition = position;
    for (const field of ["hopperGeometry", "hopperNamingMode"]) {
      const text = typeof given[field] === "string" ? given[field].trim() : "";
      if (!text) return failure("bad_argument", LINE_FIELD_MESSAGES[field], { field });
      out[field] = text;
    }
    // The manufacturer may be left unsaid - line-identity then takes the
    // floor's default (Plast-Control) - but not be something other than a word.
    if (given.hopperManufacturer !== undefined && given.hopperManufacturer !== null && given.hopperManufacturer !== "") {
      if (typeof given.hopperManufacturer !== "string") return failure("bad_argument", LINE_FIELD_MESSAGES.hopperManufacturer, { field: "hopperManufacturer" });
      out.hopperManufacturer = given.hopperManufacturer.trim();
    }
    out.isActive = given.isActive !== false;
    out.metadata = plainObject(given.metadata);
    return { ok: true, line: Object.freeze(out) };
  }

  /* The resin to save, rebuilt field by field from RESIN_FIELDS: the code
   * as trimmed text (trimmed only - the service and the database keep the
   * case, and compare codes without it), each density as a number or null
   * (blank is null: unknown), active as a boolean. What the VALUES may be
   * - the density ranges, a code the catalog already holds - is
   * resin-admin.js's to say, in the service, and is not repeated here;
   * this only refuses a field that is not the kind of thing the record
   * holds. Anything else passed is dropped. */
  function normalizeResin(value) {
    const given = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    if (!given) return failure("bad_argument", ARGUMENT_MESSAGES.resin, { field: "resin" });
    const out = {};
    const resinCode = typeof given.resinCode === "string" ? given.resinCode.trim() : "";
    if (!resinCode) return failure("bad_argument", RESIN_FIELD_MESSAGES.resinCode, { field: "resinCode" });
    out.resinCode = resinCode;
    for (const field of ["densityGCm3", "bulkDensityLbFt3"]) {
      const raw = given[field];
      const blank = raw === null || raw === undefined || (typeof raw === "string" && !raw.trim());
      const number = blank ? null : nullableNumber(raw);
      if (!blank && number === null) return failure("bad_argument", RESIN_FIELD_MESSAGES[field], { field });
      out[field] = number;
    }
    out.isActive = given.isActive !== false;
    return { ok: true, resin: Object.freeze(out) };
  }

  /* The actions whose arguments are not all text: an optional id (empty
   * means create) and one object, rebuilt field by field by its own
   * normalizer, which answers { ok, [key] } or a bad_argument failure. */
  const STRUCTURED = Object.freeze({
    saveLineConfiguration: Object.freeze({ key: "line", rebuild: normalizeLineConfiguration }),
    saveResin: Object.freeze({ key: "resin", rebuild: normalizeResin })
  });

  /* The request's arguments, checked and rebuilt: a name is text with its
   * whitespace collapsed (the server normalizes it again, by its own rule),
   * an email is trimmed, a password is taken as typed, an id is text.
   * Anything else that was passed is dropped. */
  function normalizeArguments(name, args) {
    const given = args && typeof args === "object" ? args : {};
    const out = {};
    const structured = STRUCTURED[name];
    if (structured) {
      const id = given.id === null || given.id === undefined ? "" : String(given.id).trim();
      const built = structured.rebuild(given[structured.key]);
      if (!built.ok) return built;
      return { ok: true, args: Object.freeze({ id, [structured.key]: built[structured.key] }) };
    }
    const messages = ACTION_ARGUMENT_MESSAGES[name] || null;
    for (const field of ARGUMENTS[name]) {
      const value = given[field];
      const usable = field === "password" ? typeof value === "string" && value.length > 0 : typeof value === "string" && value.trim();
      if (!usable) return failure("bad_argument", (messages && messages[field]) || ARGUMENT_MESSAGES[field], { field });
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
    LINE_FIELDS,
    RESIN_FIELDS,
    project,
    normalize,
    normalizeArguments,
    normalizeLineConfiguration,
    projectLineConfiguration,
    normalizeResin,
    projectResin,
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
