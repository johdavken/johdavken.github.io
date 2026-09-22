/* The Weights section's seam to the application's shared Weight
 * Profiles: the workspace's receiver-weight profiles, read through the
 * weight-profiles bridge and asked for through it.
 *
 * The one Slate file that calls the weight-profiles bridge's request() -
 * every profile action the Weights section takes goes through here as
 * one request each, with the bridge's own answer handed back. It never
 * reads the bridge global: it acts on the bridge it is handed, and
 * answers "unavailable" itself when there is none. The shape is the
 * Recipe Book's seam (slate-book-actions.js) over the other bridge: a
 * profile has no destination, since weights belong to the physical
 * hoppers and load into them alone.
 *
 * One decoration: a save that collides with a saved name (duplicate_name)
 * is handed back with the profile it collided with, so the caller can
 * offer to replace it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateProfileActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTIONS = Object.freeze(["saveCurrentWeights", "replaceWeightProfile", "loadWeightProfile", "renameWeightProfile", "duplicateWeightProfile", "deleteWeightProfile", "refresh"]);
  const READ_ONLY_REASON = "Slate is read-only on this line. Turn Read-only off in Settings to make changes.";
  const NO_BRIDGE = "No application is connected to Slate's weight profiles.";

  /* The controls, and the request each one is. */
  const CONTROL_ACTION = Object.freeze({
    save: "saveCurrentWeights",
    replace: "replaceWeightProfile",
    load: "loadWeightProfile",
    update: "replaceWeightProfile",
    rename: "renameWeightProfile",
    duplicate: "duplicateWeightProfile",
    remove: "deleteWeightProfile",
    refresh: "refresh"
  });

  /* The confirmation before a profile is loaded: the floor UI's own words,
   * which say what changes and what does not. */
  const LOAD_TEXT = "This will change receiver hopper weights only. It will not change line type, layer percentages, resin assignments, hopper blend percentages, tracking, pump-off state, timeline/runtime state, workspace, or RT Sync state.";
  const GEOMETRY_TEXT = "This profile also carries hopper geometry (usable heights), which will change too.";

  /* What the section says when a request is answered, and asks before one. */
  const WORDING = Object.freeze({
    saved: name => `Saved “${name}” to this line's weight profiles.`,
    replaced: name => `Replaced “${name}” with the line's current weights.`,
    loaded: name => `Loaded “${name}”: the line's receiver weights are set from it.`,
    updated: name => `Updated “${name}” with the line's current weights.`,
    deleted: name => `Deleted “${name}”.`,
    renamed: name => `Renamed to “${name}”.`,
    duplicated: name => `Duplicated as “${name}”.`,
    confirmUpdate: name => `Replace “${name}” with this line's current weights? This will save receiver hopper weights. It will not save recipe assignments, percentages, or runtime state.`,
    confirmDelete: name => `Delete “${name}” from this line's shared profiles?`,
    duplicateOffer: name => `A profile named “${name}” already exists. Replace it with the line's current weights, or choose another name.`,
    duplicateOther: "A profile with that name already exists. Choose another name.",
    nameNeeded: "Give the profile a name.",
    noAnswer: "The application did not answer.",
    loadFailed: "The profile could not be loaded.",
    updateFailed: "The profile could not be updated.",
    deleteFailed: "The profile could not be deleted."
  });

  /* A name as the bridge will send it: trimmed, whitespace collapsed. */
  function cleanName(name) {
    return String(name == null ? "" : name).trim().replace(/\s+/g, " ");
  }

  /* The rule the service compares two names by: lower-cased as well. Used
   * only to find which saved profile a duplicate_name refers to; the
   * server decides the collision. */
  function normalizedName(name) {
    return cleanName(name).toLocaleLowerCase();
  }

  function findByName(book, name) {
    const wanted = normalizedName(name);
    if (!wanted || !book || !Array.isArray(book.profiles)) return null;
    return book.profiles.find(profile => normalizedName(profile.name) === wanted) || null;
  }

  function findById(book, id) {
    if (!book || !Array.isArray(book.profiles)) return null;
    return book.profiles.find(profile => profile.id === id) || null;
  }

  function connected(profiles) {
    return !!(profiles && typeof profiles.isConnected === "function" && profiles.isConnected());
  }

  function offered(profiles) {
    const list = connected(profiles) && typeof profiles.capabilities === "function" ? profiles.capabilities() : [];
    return Array.isArray(list) ? list : [];
  }

  function bookOf(profiles) {
    return profiles && typeof profiles.getBook === "function" ? profiles.getBook() : null;
  }

  /**
   * Which controls are on offer. Read-only withholds every write and keeps
   * Refresh; a device off any line, or no application, withholds all.
   *
   * @param {object|null} profiles
   * @param {object} [options]  { readOnly }
   */
  function can(profiles, options) {
    const settings = options || {};
    const book = bookOf(profiles);
    const live = connected(profiles) && !!(book && book.assigned);
    const list = live ? offered(profiles) : [];
    const able = {};
    for (const control of Object.keys(CONTROL_ACTION)) {
      able[control] = list.includes(CONTROL_ACTION[control]);
      if (settings.readOnly && control !== "refresh") able[control] = false;
    }
    if (book && book.refreshing) able.refresh = false;
    return Object.freeze(able);
  }

  function reason(profiles, control, options) {
    const settings = options || {};
    if (settings.readOnly && control !== "refresh") return READ_ONLY_REASON;
    if (!connected(profiles)) return "no application is connected to Slate's weight profiles.";
    const book = bookOf(profiles);
    if (!book || !book.assigned) return "this device is not on a production line.";
    if (control === "refresh" && book.refreshing) return "the line's profiles are being read.";
    if (!offered(profiles).includes(CONTROL_ACTION[control])) return `the application does not offer ${CONTROL_ACTION[control] || "this"} from Slate.`;
    return "";
  }

  function failure(code, message, extra) {
    return Object.freeze(Object.assign({ ok: false, code, message }, extra || {}));
  }

  /* The transport: one request, never a throw. */
  async function ask(profiles, action, args) {
    if (!profiles || typeof profiles.request !== "function") return failure("unavailable", NO_BRIDGE);
    try {
      const result = args === undefined ? await profiles.request(action) : await profiles.request(action, args);
      return result || failure("failed", WORDING.noAnswer);
    } catch (error) {
      return failure("failed", (error && error.message) || "The request failed.");
    }
  }

  /**
   * Save the line's current receiver weights under a name. A name
   * collision comes back with `existing`, the saved profile it collided
   * with, for the caller to offer replacing.
   */
  async function save(profiles, name) {
    const clean = cleanName(name);
    const result = await ask(profiles, "saveCurrentWeights", { name: clean });
    if (result.ok || result.code !== "duplicate_name") return result;
    const existing = findByName(bookOf(profiles), clean);
    return failure(result.code, result.message, { field: result.field, existing: existing ? { id: existing.id, name: existing.name } : null });
  }

  function replace(profiles, id) {
    return ask(profiles, "replaceWeightProfile", { id });
  }

  function load(profiles, id) {
    return ask(profiles, "loadWeightProfile", { id });
  }

  function rename(profiles, id, name) {
    return ask(profiles, "renameWeightProfile", { id, name: cleanName(name) });
  }

  function duplicate(profiles, id, name) {
    return ask(profiles, "duplicateWeightProfile", { id, name: cleanName(name) });
  }

  function remove(profiles, id) {
    return ask(profiles, "deleteWeightProfile", { id });
  }

  function refreshBook(profiles) {
    return ask(profiles, "refresh");
  }

  return Object.freeze({
    ACTIONS, CONTROL_ACTION, READ_ONLY_REASON, NO_BRIDGE, LOAD_TEXT, GEOMETRY_TEXT, WORDING,
    cleanName, normalizedName, findByName, findById, connected, bookOf, can, reason,
    save, replace, load, rename, duplicate, remove, refreshBook
  });
});
