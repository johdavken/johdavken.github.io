/* Station connection bridge - the line connection as Station is allowed to
 * see it, and the eight things it is allowed to ask of it.
 *
 * THE THIRD OF THREE
 *
 *   station-state-bridge.js        application -> Station   the job
 *   station-command-bridge.js      Station -> application   recipe edits
 *   station-connection-bridge.js   both ways, narrowly      the LINE CONNECTION
 *
 * Station has to say which production line this device is, whether it is
 * in step with the other devices on that line, how many of them there are,
 * and offer the operator a join code for a new one and a way to reconcile
 * now. A phone console must also be able to do what the floor UI's own
 * RT Sync panel does on a phone: join a line by its code, choose among the
 * lines this device remembers, leave one, and name itself. All of that
 * already exists in the application's RT Sync layer (cloud-sync.js, driven
 * from app.js). None of it may be re-implemented in Station: Station must
 * never hold a second workspace selection, open a second live feed, keep a
 * second queue of unsent changes or mint a second join code of its own.
 * Every action here is one of the application's OWN closures, run through
 * the application's own action runner, and the arguments a console may
 * pass are checked and rebuilt here before that closure sees them.
 *
 * So this module is a window and a letterbox, and nothing else:
 *
 *   Producer (app.js, once):  connect({ read, actions }) -> { publish, disconnect }
 *   Consumer (Station):       getStatus(), subscribe(fn), isConnected(),
 *                             capabilities(), request(action, args)
 *
 * The window is the state bridge's own machinery (create()): a lazy read,
 * deep-cloned and deeply frozen, one coalesced notification per tick. The
 * letterbox carries a fixed vocabulary of ACTIONS to functions the
 * application hands over at connect time - which are the application's OWN
 * RT Sync actions, the same closures the floor UI's buttons call - and
 * returns a frozen result value, never a throw.
 *
 * WHAT CROSSES, AND WHAT DOES NOT
 *
 * project() below is the allow-list. It reads cloud-sync's public state
 * object and keeps: the remembered line, the status word and message, the
 * pending count, the joined devices as display facts, the current join
 * code, this device's own label, and the lines this device remembers - as
 * display facts only (an id to name them by, a name, a line number, a
 * display name), because a phone has to be able to choose its line. It
 * drops: the RT user id, the device id (it is only USED, to mark this
 * device), the member rows' user ids, revisions, the pending-change
 * summary. Station never learns a table, a feed, an RPC, a credential or a
 * storage key - it learns "Line 9, synced, three devices".
 *
 * WHY THE LINE IS PROJECTED EVEN WHEN NOT CONNECTED
 *
 * A desktop that remembers Line 9 but is locally disconnected, offline or
 * errored is still the Line 9 desktop. The state bridge's `line.linked`
 * (which follows PolynLineIdentity) rightly says "not linked" then, because
 * the JOB shown may not be the line's. The connection descriptor keeps the
 * identity and says the connection is down, so Station can read
 * "LINE 9 · OFFLINE" rather than losing the line name exactly when the
 * operator most needs it.
 */
(function (root, factory) {
  const stateBridge = typeof require === "function"
    ? require("./station-state-bridge.js")
    : (root && root.PolynStationStateBridge);
  const api = factory(stateBridge);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationConnectionBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (stateBridge) {
  "use strict";

  /* The letterbox's whole vocabulary. Each one is an application-level
   * operation the floor UI already has a button for; a name outside this
   * list is refused at connect time and at request time. */
  const ACTIONS = Object.freeze([
    "refresh",          // reconcile this line with RT Sync now (the existing refresh)
    "reconnect",        // re-attach a remembered but locally disconnected line
    "generateJoinCode", // mint a one-time join code for another device
    "renderJoinQr",     // the current join code drawn as an SVG string
    "joinWorkspace",    // join a line by its four-character code (the phone panel's Join)
    "selectWorkspace",  // make one of the remembered lines this device's line
    "leaveWorkspace",   // leave the line on this device (server membership ends; local data stays)
    "relabelDevice"     // name this device as the other devices see it
  ]);

  /* What each action may be handed, by field. A request's arguments are
   * checked and rebuilt against this before the application's closure
   * sees them; anything else that was passed is dropped. The zero-argument
   * actions receive an empty object. */
  const ARGUMENTS = Object.freeze({
    refresh: Object.freeze([]),
    reconnect: Object.freeze([]),
    generateJoinCode: Object.freeze([]),
    renderJoinQr: Object.freeze([]),
    joinWorkspace: Object.freeze(["code", "label"]),
    selectWorkspace: Object.freeze(["id"]),
    leaveWorkspace: Object.freeze([]),
    relabelDevice: Object.freeze(["label"])
  });

  /* The floor UI's own join-code rule (app.js, updateLineSyncJoinAvailability):
   * four characters, letters and digits, upper case. cloud-sync uppercases
   * and trims again for itself; the check here refuses early, by field. */
  const CODE = /^[A-Z0-9]{4}$/;
  /* The device label field's own maxlength (index.html, #lineSyncDeviceLabel). */
  const LABEL_MAX = 80;

  /* cloud-sync's status words, as it spells them. Anything else is passed
   * through under its own key rather than mapped to an invented state. */
  const STATUS_WORDS = Object.freeze([
    "Connecting", "Local only", "Syncing", "Synced", "Pending", "Offline", "Conflict", "Error"
  ]);

  const NONE = Object.freeze([]);

  function nullableInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function stringOr(value, fallback) {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  /* --------------------------------------------------------------------
   *   Projection
   * ------------------------------------------------------------------ */

  /**
   * The line connection as Station sees it. Pure over cloud-sync's public
   * state object (getState()) and a few facts the application resolves
   * beside it; returns a fresh plain object every call.
   *
   * @param {object} syncState  cloud-sync's getState() result.
   * @param {object} [options]
   * @param {number|null} [options.lineNumber]  PolynLineIdentity's number
   *        for the selected workspace, or null when it cannot be mapped.
   * @param {string} [options.displayName]  The line's configured display
   *        name, when the application has one.
   * @param {boolean} [options.busy]  An RT Sync action is in flight.
   * @param {string} [options.busyAction]  Which one, by the app's own name.
   * @param {string} [options.joinUrl]  The join link for the current code.
   * @param {Array}  [options.workspaces]  Facts the application resolves for
   *        the remembered lines: `{ id, lineNumber, displayName }` per
   *        workspace id. Only ids cloud-sync itself lists ever cross.
   */
  function project(syncState, options) {
    if (!syncState || typeof syncState !== "object") return null;
    const settings = options || {};

    const selectedId = syncState.selectedWorkspaceId ? String(syncState.selectedWorkspaceId) : "";
    const workspace = selectedId && syncState.selectedWorkspace && syncState.selectedWorkspace.id === selectedId
      ? syncState.selectedWorkspace
      : null;
    const lineNumber = nullableInteger(settings.lineNumber);
    const workspaceName = workspace ? stringOr(workspace.name, "") : "";
    const line = workspace ? {
      workspaceId: selectedId,
      name: workspaceName,
      lineNumber,
      displayName: settings.displayName
        ? String(settings.displayName)
        : (lineNumber !== null ? `Line ${lineNumber}` : (workspaceName || "Unnamed line")),
      /* This device's standing on the line: an owner cannot leave it
       * (cloud-sync refuses with transfer_ownership_before_leaving), so
       * the console withdraws Leave rather than offering a refusal. The
       * word is all that crosses; the membership row does not. */
      role: workspace.membership && workspace.membership.role === "owner" ? "owner" : "member"
    } : null;

    /* The lines this device remembers, as display facts: cloud-sync's own
     * list gives the ids and names; the application resolves a line number
     * and a display name per id the way it does for the selected line. */
    const facts = new Map();
    for (const fact of Array.isArray(settings.workspaces) ? settings.workspaces : []) {
      if (fact && fact.id) facts.set(String(fact.id), fact);
    }
    const workspaces = (Array.isArray(syncState.workspaces) ? syncState.workspaces : [])
      .filter(item => item && item.id)
      .map(item => {
        const id = String(item.id);
        const name = stringOr(item.name, "");
        const fact = facts.get(id) || {};
        const number = nullableInteger(fact.lineNumber);
        return {
          id,
          name,
          lineNumber: number,
          displayName: fact.displayName
            ? String(fact.displayName)
            : (number !== null ? `Line ${number}` : (name || "Unnamed line"))
        };
      });

    // cloud-sync's `connected`: the operator has not unlinked this line on
    // this device. Not network reachability - that is what the status word
    // is for.
    const linked = !!line && !!syncState.connected;
    const enabled = !!syncState.enabled;
    const available = !!syncState.available;

    const statusWord = stringOr(syncState.status, "Local only");
    const message = stringOr(syncState.message, "");
    // The same reading the floor UI's recovery card makes of an Error: the
    // line is gone or this device's access is, and only an administrator can
    // put it back. Kept identical so the two views agree on when to stop
    // offering a reconnect.
    const adminRequired = statusWord === "Error" && /access|revoked|deleted|no longer/i.test(message);

    const busy = !!settings.busy;

    const deviceId = syncState.deviceId ? String(syncState.deviceId) : "";
    const devices = (Array.isArray(syncState.members) ? syncState.members : [])
      .filter(member => member && typeof member === "object")
      .map(member => ({
        label: stringOr(member.device_label, "Unnamed device"),
        role: member.role === "owner" ? "owner" : "member",
        joinedAt: stringOr(member.joined_at, ""),
        /* Updated by the server when a device joins or renames itself - a
         * membership fact, not a heartbeat. Carried under its own name so a
         * reader cannot mistake it for presence. */
        lastSeenAt: stringOr(member.last_seen_at, ""),
        thisDevice: !!(deviceId && member.device_id && String(member.device_id) === deviceId)
      }));

    const joinCode = linked && syncState.generatedCode ? {
      code: String(syncState.generatedCode),
      expiresAt: stringOr(syncState.generatedCodeExpiresAt, ""),
      url: stringOr(settings.joinUrl, "")
    } : null;

    return {
      enabled,
      available,
      assigned: !!line,
      line,
      linked,
      workspaces,
      /* This device's own name, as the other devices see it: what the
       * relabel action changes. */
      deviceLabel: stringOr(syncState.deviceLabel, ""),
      status: {
        key: statusWord.toLowerCase().replace(/\s+/g, "-"),
        label: statusWord,
        known: STATUS_WORDS.includes(statusWord),
        message,
        pendingCount: Math.max(0, Number(syncState.pendingCount) || 0),
        lastSyncAt: stringOr(syncState.lastSyncAt, ""),
        adminRequired
      },
      devices,
      deviceCount: devices.length,
      joinCode,
      busy: { active: busy, action: busy ? stringOr(settings.busyAction, "") : "" },
      /* What may be offered right now. Computed here, once, so the console
       * never shows a control the application would refuse: nothing while
       * an action runs, no refresh on an unlinked line (that is a
       * reconnect), no reconnect where only an administrator can help, no
       * join code without a live connection to put the device on. */
      can: {
        refresh: enabled && linked && !busy,
        reconnect: enabled && !!line && !linked && !busy && !adminRequired,
        addDevice: enabled && available && linked && !busy,
        /* Joining needs the RT Sync client; choosing a line needs lines to
         * choose from; leaving is for members, not the owner; a device can
         * name itself whenever RT Sync is on (the label is local-first). */
        join: enabled && available && !busy,
        select: enabled && !busy && workspaces.length > 0,
        leave: enabled && available && !!line && !busy && line.role !== "owner",
        relabel: enabled && !busy
      }
    };
  }

  /* --------------------------------------------------------------------
   *   Results
   * ------------------------------------------------------------------ */

  function failure(code, message, extra) {
    const out = { ok: false, code, message: message || "" };
    if (extra && typeof extra.field === "string") out.field = extra.field;
    return Object.freeze(out);
  }

  /* The request's arguments, checked and rebuilt: a join code is four
   * characters, upper-cased for the operator who typed it small; a label
   * is text with its whitespace collapsed, no longer than the floor UI's
   * own field allows; an id is text. Anything else that was passed is
   * dropped. The first field that fails names itself in the answer. */
  function normalizeArguments(name, args) {
    const given = args && typeof args === "object" ? args : {};
    const out = {};
    for (const field of ARGUMENTS[name] || []) {
      const value = given[field];
      if (field === "code") {
        const code = typeof value === "string" ? value.trim().toUpperCase() : "";
        if (!CODE.test(code)) return failure("bad_argument", "Enter the four-character link code.", { field });
        out.code = code;
        continue;
      }
      if (field === "label") {
        const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, LABEL_MAX) : "";
        if (name === "relabelDevice" && !label) return failure("bad_argument", "Give this device a name.", { field });
        if (label) out.label = label;
        continue;
      }
      if (field === "id") {
        if (typeof value !== "string" || !value.trim()) return failure("bad_argument", "The line must be named by id.", { field });
        out.id = value.trim();
      }
    }
    return { ok: true, args: Object.freeze(out) };
  }

  /* Whatever an action returned, as a frozen result. An object with `ok`
   * is taken as is (and frozen); a bare truthy/falsy value is read as
   * succeeded/failed, which is what the application's own action runner
   * returns. */
  function normalize(value) {
    if (value && typeof value === "object" && typeof value.ok === "boolean") {
      return Object.isFrozen(value) ? value : Object.freeze(Object.assign({}, value));
    }
    return value ? Object.freeze({ ok: true }) : failure("failed", "The application did not complete the action.");
  }

  /* --------------------------------------------------------------------
   *   The bridge
   * ------------------------------------------------------------------ */

  function createBridge(options) {
    if (!stateBridge || typeof stateBridge.create !== "function") {
      throw new Error("station-connection-bridge: the state bridge is not loaded");
    }
    // The window half is the state bridge's own: lazy read, clone, freeze,
    // one notification per tick. Nothing about that is connection-specific.
    const inner = stateBridge.create(options);
    let actions = null;   // the producer's action functions, or null

    function capabilities() {
      return actions ? Object.freeze(Object.keys(actions)) : NONE;
    }

    /* Ask the application to do one of the ACTIONS. Never throws. The
     * arguments are checked against ARGUMENTS first; a refused argument
     * comes back as a failure naming its field, and the closure is never
     * called. */
    async function request(name, args) {
      if (!ACTIONS.includes(name)) return failure("unknown_action", `"${name}" is not a line connection action.`);
      if (!actions) return failure("unavailable", "No application is connected to the Station line connection.");
      const action = actions[name];
      if (typeof action !== "function") return failure("unavailable", `The application does not offer "${name}".`);
      const checked = normalizeArguments(name, args);
      if (!checked.ok) return checked;
      try {
        return normalize(await action(checked.args));
      } catch (error) {
        // The application's own failure text is what the operator would
        // have seen on the floor UI; anything without one gets a plain
        // statement rather than a stack.
        const message = error && error.message ? String(error.message) : "The action failed.";
        return failure("failed", message);
      }
    }

    /**
     * Register the application. `read` returns the projected descriptor
     * (see project()); `actions` maps ACTIONS names to the application's
     * own async functions. Returns the ONLY handle that can publish or
     * disconnect.
     */
    function connect(source) {
      const declared = source && source.actions && typeof source.actions === "object" ? source.actions : {};
      const unknown = Object.keys(declared).filter(name => !ACTIONS.includes(name));
      if (unknown.length) {
        throw new TypeError(`station-connection-bridge: unknown action "${unknown[0]}"`);
      }
      // Throws on a missing read or a second producer, exactly as the state
      // bridge does - and before this module has changed anything.
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
      getStatus: inner.getSnapshot,
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
    STATUS_WORDS,
    project,
    normalizeArguments,
    connect: shared.connect,
    getStatus: shared.getStatus,
    subscribe: shared.subscribe,
    isConnected: shared.isConnected,
    getRevision: shared.getRevision,
    capabilities: shared.capabilities,
    request: shared.request,
    // A fresh, isolated bridge for tests; production has one.
    create: createBridge
  });
});
