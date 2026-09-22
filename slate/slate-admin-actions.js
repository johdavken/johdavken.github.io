/* Slate's seam to the administrator tools: the shared admin session and
 * the sixteen operations the admin bridge offers over it.
 *
 * The one Slate file that calls the admin bridge's request() - the sign-in
 * block in Settings and the three administrator sections all come through
 * here, one request each, with the bridge's own answer handed back. It
 * never reads the bridge global: it acts on the bridge it is handed, and
 * answers "unavailable" itself when there is none. The shape is the
 * Recipe Book's seam (slate-book-actions.js) over a fifth bridge.
 *
 * Two things are different from the other seams:
 *
 * Read-only does not withhold anything here. Read-only is Slate's promise
 * about the LINE'S JOB - the recipe, the plan, tracking, the changeover -
 * and administration is not that job, any more than joining a line is.
 *
 * Every action but the two that open and close the session needs an
 * administrator signed in. That is one boolean on the bridge's window
 * (`access.access.signedIn`), and the producer only sets it once the
 * account has been verified against the admin table - so Slate reads a
 * fact the server established and never decides for itself who is an
 * administrator. The email the window carries is for display alone.
 *
 * A failure carrying `not_authenticated` or `access_denied` means that
 * session has ended, whatever this device believed: `accessLost` names
 * those two so every section can drop what it read and say so.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateAdminActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTIONS = Object.freeze([
    "signIn", "signOut",
    "listWorkspaces", "workspaceDevices", "addThisDevice", "createLine", "renameLine",
    "transferOwnership", "disconnectDevice", "mergeWorkspace", "deleteWorkspace",
    "listLineConfigurations", "saveLineConfiguration",
    "listResins", "saveResin", "deleteResin"
  ]);

  const NO_BRIDGE = "No application is connected to Slate's administrator tools.";

  /* The controls the sections offer, and the request each one is. The two
   * at the top are the session itself; everything below it needs one. */
  const CONTROL_ACTION = Object.freeze({
    signIn: "signIn",
    signOut: "signOut",
    listWorkspaces: "listWorkspaces",
    devices: "workspaceDevices",
    addDevice: "addThisDevice",
    createLine: "createLine",
    renameLine: "renameLine",
    transferOwnership: "transferOwnership",
    disconnectDevice: "disconnectDevice",
    merge: "mergeWorkspace",
    deleteWorkspace: "deleteWorkspace",
    listLines: "listLineConfigurations",
    saveLine: "saveLineConfiguration",
    listResins: "listResins",
    saveResin: "saveResin",
    deleteResin: "deleteResin"
  });

  /* The two that are offered to anyone: one opens the session, the other
   * ends it. Every other control is withheld until one is open. */
  const SESSION_CONTROLS = Object.freeze(["signIn", "signOut"]);

  /* The codes that mean the administrator session has ended. */
  const LOST_CODES = Object.freeze(["not_authenticated", "access_denied"]);

  /* Everything the sign-in block and the three sections say. */
  const WORDING = Object.freeze({
    emailNeeded: "Enter the administrator email.",
    passwordNeeded: "Enter the password.",
    signedIn: email => (email ? `Signed in as ${email}.` : "Signed in."),
    signedOut: "Signed out.",
    signInFailed: "That sign-in was refused.",
    accessEnded: "Administrator access has ended. Sign in again to continue.",
    noAnswer: "The application did not answer.",
    // What signing in opens up, said where an operator meets the form.
    opens: "Workspaces, Line Configuration and Resin Database appear in the rail while an administrator is signed in, and the RT Sync panel offers the line to follow."
  });

  function accessWindow(admin) {
    if (!admin || typeof admin.getAccess !== "function") return null;
    const access = admin.getAccess();
    return access && typeof access === "object" ? access : null;
  }

  /** The window's access half, or a signed-out stand-in. */
  function accessOf(admin) {
    const access = accessWindow(admin);
    const half = access && access.access && typeof access.access === "object" ? access.access : null;
    return Object.freeze({
      ready: !!(half && half.ready),
      signedIn: !!(half && half.signedIn),
      email: half && half.signedIn ? String(half.email || "") : ""
    });
  }

  /** The window's device half: what this browser is, for the diagnostics line. */
  function deviceOf(admin) {
    const access = accessWindow(admin);
    const half = access && access.device && typeof access.device === "object" ? access.device : null;
    return Object.freeze({
      ready: !!(half && half.ready),
      label: half ? String(half.label || "") : "",
      userIdShort: half ? String(half.userIdShort || "") : "",
      deviceIdShort: half ? String(half.deviceIdShort || "") : ""
    });
  }

  function connected(admin) {
    return !!(admin && typeof admin.isConnected === "function" && admin.isConnected());
  }

  function offered(admin) {
    const list = connected(admin) && typeof admin.capabilities === "function" ? admin.capabilities() : [];
    return Array.isArray(list) ? list : [];
  }

  /** Whether an administrator is signed in - the one boolean everything turns on. */
  function signedIn(admin) {
    return connected(admin) && accessOf(admin).signedIn;
  }

  /** Whether the application has finished checking for a session. */
  function ready(admin) {
    return connected(admin) && accessOf(admin).ready;
  }

  /* What the bridge offers, by the name each control uses: the action
   * must be one the producer supplied, and - unless it is the session
   * itself - an administrator must be signed in. Sign-out is the mirror
   * of sign-in: offered only while there is a session to end. */
  function can(admin) {
    const list = offered(admin);
    const open = signedIn(admin);
    const able = {};
    for (const control of Object.keys(CONTROL_ACTION)) {
      let allowed = list.includes(CONTROL_ACTION[control]);
      if (control === "signIn") allowed = allowed && !open;
      else if (control === "signOut") allowed = allowed && open;
      else allowed = allowed && open;
      able[control] = allowed;
    }
    return Object.freeze(able);
  }

  /* Why a control is withheld, most general first, as a fragment the
   * caller prefixes ("Rename is unavailable: …"). "" when it is offered. */
  function reason(admin, control) {
    if (!connected(admin)) return "no application is connected to Slate's administrator tools.";
    const access = accessOf(admin);
    if (control === "signIn" && access.signedIn) return "an administrator is already signed in.";
    if (!SESSION_CONTROLS.includes(control) && !access.signedIn) {
      return access.ready ? "no administrator is signed in." : "administrator access has not been checked yet.";
    }
    if (control === "signOut" && !access.signedIn) return "no administrator is signed in.";
    if (!offered(admin).includes(CONTROL_ACTION[control])) {
      return `the application does not offer ${CONTROL_ACTION[control] || "this"} from Slate.`;
    }
    return "";
  }

  function failure(code, message, extra) {
    return Object.freeze(Object.assign({ ok: false, code, message }, extra || {}));
  }

  /** Whether a result means the administrator session has ended. */
  function accessLost(result) {
    return !!(result && result.ok === false && LOST_CODES.includes(result.code));
  }

  /* One request, and never a throw. The bridge rebuilds every answer by
   * allow-list already, so what it returns is handed straight back. */
  async function ask(admin, action, args) {
    if (!admin || typeof admin.request !== "function") return failure("unavailable", NO_BRIDGE);
    try {
      const result = args === undefined ? await admin.request(action) : await admin.request(action, args);
      return result || failure("failed", WORDING.noAnswer);
    } catch (error) {
      return failure("failed", (error && error.message) || "The request failed.");
    }
  }

  /* ---- The session ---- */

  /* The email is trimmed here so a stray space cannot fail a sign-in; the
   * password crosses exactly as typed and is held nowhere. */
  function signIn(admin, email, password) {
    return ask(admin, "signIn", { email: String(email == null ? "" : email).trim(), password: String(password == null ? "" : password) });
  }

  function signOut(admin) {
    return ask(admin, "signOut");
  }

  /* ---- Workspace Management ---- */

  function listWorkspaces(admin) {
    return ask(admin, "listWorkspaces");
  }

  function workspaceDevices(admin, id) {
    return ask(admin, "workspaceDevices", { id });
  }

  function addThisDevice(admin, id) {
    return ask(admin, "addThisDevice", { id });
  }

  function createLine(admin, name) {
    return ask(admin, "createLine", { name: cleanName(name) });
  }

  function renameLine(admin, id, name) {
    return ask(admin, "renameLine", { id, name: cleanName(name) });
  }

  function transferOwnership(admin, id, memberId) {
    return ask(admin, "transferOwnership", { id, memberId });
  }

  function disconnectDevice(admin, id, memberId) {
    return ask(admin, "disconnectDevice", { id, memberId });
  }

  function mergeWorkspace(admin, id, targetId) {
    return ask(admin, "mergeWorkspace", { id, targetId });
  }

  function deleteWorkspace(admin, id) {
    return ask(admin, "deleteWorkspace", { id });
  }

  /* ---- Line Configuration ---- */

  function listLineConfigurations(admin) {
    return ask(admin, "listLineConfigurations");
  }

  /** A definition saved: an empty id creates, the bridge rebuilds the fields. */
  function saveLineConfiguration(admin, id, line) {
    return ask(admin, "saveLineConfiguration", { id: id || "", line });
  }

  /* ---- Resin Database ---- */

  function listResins(admin) {
    return ask(admin, "listResins");
  }

  /* A resin saved. One decoration, as the Book's seam has: a code the
   * catalog already holds comes back with the record it collided with,
   * found in the list the section last read, so the section can point at
   * it instead of only saying no. */
  async function saveResin(admin, id, resin, known) {
    const result = await ask(admin, "saveResin", { id: id || "", resin });
    if (result.ok || result.code !== "duplicate_code") return result;
    const existing = findByCode(known, resin && resin.resinCode, id);
    return failure(result.code, result.message, { field: result.field || "resinCode", existing: existing ? { id: existing.id, resinCode: existing.resinCode } : null });
  }

  function deleteResin(admin, id) {
    return ask(admin, "deleteResin", { id });
  }

  /* ---- Names and codes ---- */

  /** A name as the bridge will send it: trimmed, whitespace collapsed. */
  function cleanName(name) {
    return String(name == null ? "" : name).trim().replace(/\s+/g, " ");
  }

  /* The rule the catalog compares two codes by: trimmed and case-folded,
   * whitespace left alone (a resin code is stored as typed). Used only to
   * find which record a duplicate_code refers to; the server decides the
   * collision. */
  function sameCode(a, b) {
    return String(a == null ? "" : a).trim().toLocaleLowerCase() === String(b == null ? "" : b).trim().toLocaleLowerCase();
  }

  function findByCode(resins, code, exceptId) {
    if (!Array.isArray(resins)) return null;
    return resins.find(resin => resin && resin.id !== exceptId && sameCode(resin.resinCode, code)) || null;
  }

  return Object.freeze({
    ACTIONS, CONTROL_ACTION, SESSION_CONTROLS, LOST_CODES, NO_BRIDGE, WORDING,
    accessOf, deviceOf, signedIn, ready, can, reason, accessLost, cleanName, sameCode, findByCode,
    signIn, signOut,
    listWorkspaces, workspaceDevices, addThisDevice, createLine, renameLine,
    transferOwnership, disconnectDevice, mergeWorkspace, deleteWorkspace,
    listLineConfigurations, saveLineConfiguration,
    listResins, saveResin, deleteResin
  });
});
