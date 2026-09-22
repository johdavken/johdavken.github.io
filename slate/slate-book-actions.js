/* The Recipe Book's seam to the application: the workspace's shared
 * recipes, read through the recipes bridge and asked for through it.
 *
 * The one Slate file that calls the recipes bridge's request() - every
 * action the Book section and the Recipe tab's "Save as recipe" take goes
 * through here as one request each, with the bridge's own answer handed
 * back. It never reads the bridge global: it acts on the bridge it is
 * handed, and answers "unavailable" itself when there is none.
 *
 * One decoration: a save of the running recipe that collides with a saved
 * name (duplicate_name) is handed back with the recipe it collided with,
 * so the caller can offer to replace it. A plan's save is not: replacing
 * always writes the running recipe, so there is nothing to offer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateBookActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTIONS = Object.freeze(["saveCurrentRecipe", "saveNextRecipe", "replaceRecipe", "loadRecipe", "renameRecipe", "duplicateRecipe", "deleteRecipe", "refresh"]);
  const DESTINATIONS = Object.freeze(["current", "next"]);
  const READ_ONLY_REASON = "Slate is read-only on this line. Turn Read-only off in Settings to make changes.";
  const NO_BRIDGE = "No application is connected to Slate's saved recipes.";

  /* The controls, and the request each one is. */
  const CONTROL_ACTION = Object.freeze({
    saveCurrent: "saveCurrentRecipe",
    saveNext: "saveNextRecipe",
    replace: "replaceRecipe",
    load: "loadRecipe",
    update: "replaceRecipe",
    rename: "renameRecipe",
    duplicate: "duplicateRecipe",
    remove: "deleteRecipe",
    refresh: "refresh"
  });

  /* What the section says when a request is answered. */
  const WORDING = Object.freeze({
    saved: name => `Saved “${name}” to this line's recipes.`,
    replaced: name => `Replaced “${name}” with the running recipe.`,
    loadedCurrent: name => `Loaded “${name}” into Current: it is the running recipe now.`,
    loadedNext: name => `Loaded “${name}” into Next: it is the planned recipe now. The running recipe is untouched.`,
    updated: name => `Updated “${name}” with the running recipe.`,
    deleted: name => `Deleted “${name}”.`,
    renamed: name => `Renamed to “${name}”.`,
    duplicated: name => `Duplicated as “${name}”.`,
    duplicateOffer: name => `A recipe named “${name}” already exists. Replace it with the running recipe, or choose another name.`,
    duplicateOther: "A recipe with that name already exists. Choose another name.",
    nameNeeded: "Give the recipe a name.",
    noAnswer: "The application did not answer."
  });

  /* A name as the bridge will send it: trimmed, whitespace collapsed. */
  function cleanName(name) {
    return String(name == null ? "" : name).trim().replace(/\s+/g, " ");
  }

  /* The rule the service compares two names by: lower-cased as well. Used
   * only to find which saved recipe a duplicate_name refers to; the
   * server decides the collision. */
  function normalizedName(name) {
    return cleanName(name).toLocaleLowerCase();
  }

  function findByName(book, name) {
    const wanted = normalizedName(name);
    if (!wanted || !book || !Array.isArray(book.recipes)) return null;
    return book.recipes.find(recipe => normalizedName(recipe.name) === wanted) || null;
  }

  function findById(book, id) {
    if (!book || !Array.isArray(book.recipes)) return null;
    return book.recipes.find(recipe => recipe.id === id) || null;
  }

  function connected(recipes) {
    return !!(recipes && typeof recipes.isConnected === "function" && recipes.isConnected());
  }

  function offered(recipes) {
    const list = connected(recipes) && typeof recipes.capabilities === "function" ? recipes.capabilities() : [];
    return Array.isArray(list) ? list : [];
  }

  function bookOf(recipes) {
    return recipes && typeof recipes.getBook === "function" ? recipes.getBook() : null;
  }

  /**
   * Which controls are on offer. Read-only withholds every write and keeps
   * Refresh; a device off any line, or no application, withholds all.
   *
   * @param {object|null} recipes
   * @param {object} [options]  { readOnly, planned }
   */
  function can(recipes, options) {
    const settings = options || {};
    const book = bookOf(recipes);
    const live = connected(recipes) && !!(book && book.assigned);
    const list = live ? offered(recipes) : [];
    const able = {};
    for (const control of Object.keys(CONTROL_ACTION)) {
      able[control] = list.includes(CONTROL_ACTION[control]);
      if (settings.readOnly && control !== "refresh") able[control] = false;
    }
    if (settings.planned === false) able.saveNext = false;
    if (book && book.refreshing) able.refresh = false;
    return Object.freeze(able);
  }

  function reason(recipes, control, options) {
    const settings = options || {};
    if (settings.readOnly && control !== "refresh") return READ_ONLY_REASON;
    if (!connected(recipes)) return "no application is connected to Slate's saved recipes.";
    const book = bookOf(recipes);
    if (!book || !book.assigned) return "this device is not on a production line.";
    if (control === "saveNext" && settings.planned === false) return "nothing is planned.";
    if (control === "refresh" && book.refreshing) return "the line's recipes are being read.";
    if (!offered(recipes).includes(CONTROL_ACTION[control])) return `the application does not offer ${CONTROL_ACTION[control] || "this"} from Slate.`;
    return "";
  }

  function failure(code, message, extra) {
    return Object.freeze(Object.assign({ ok: false, code, message }, extra || {}));
  }

  /* The transport: one request, never a throw. */
  async function ask(recipes, action, args) {
    if (!recipes || typeof recipes.request !== "function") return failure("unavailable", NO_BRIDGE);
    try {
      const result = args === undefined ? await recipes.request(action) : await recipes.request(action, args);
      return result || failure("failed", WORDING.noAnswer);
    } catch (error) {
      return failure("failed", (error && error.message) || "The request failed.");
    }
  }

  /**
   * Save the running recipe ("current") or the plan ("next") under a name.
   * A name collision on the running recipe comes back with `existing`,
   * the saved recipe it collided with, for the caller to offer replacing.
   */
  async function save(recipes, which, name) {
    const clean = cleanName(name);
    const action = which === "next" ? "saveNextRecipe" : "saveCurrentRecipe";
    const result = await ask(recipes, action, { name: clean });
    if (result.ok || result.code !== "duplicate_name") return result;
    const existing = which === "next" ? null : findByName(bookOf(recipes), clean);
    return failure(result.code, result.message, { field: result.field, existing: existing ? { id: existing.id, name: existing.name } : null });
  }

  function replace(recipes, id) {
    return ask(recipes, "replaceRecipe", { id });
  }

  function load(recipes, id, destination) {
    return ask(recipes, "loadRecipe", { id, destination: DESTINATIONS.includes(destination) ? destination : "current" });
  }

  function rename(recipes, id, name) {
    return ask(recipes, "renameRecipe", { id, name: cleanName(name) });
  }

  function duplicate(recipes, id, name) {
    return ask(recipes, "duplicateRecipe", { id, name: cleanName(name) });
  }

  function remove(recipes, id) {
    return ask(recipes, "deleteRecipe", { id });
  }

  function refreshBook(recipes) {
    return ask(recipes, "refresh");
  }

  return Object.freeze({
    ACTIONS, DESTINATIONS, CONTROL_ACTION, READ_ONLY_REASON, NO_BRIDGE, WORDING,
    cleanName, normalizedName, findByName, findById, connected, bookOf, can, reason,
    save, replace, load, rename, duplicate, remove, refreshBook
  });
});
