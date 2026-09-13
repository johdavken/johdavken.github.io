/* The Recipe Book: the Operator Handbook's first section.
 *
 * WHAT IT IS
 *
 * The saved recipes of the production line this desktop is on, as a
 * compact list; the blend of whichever one is selected; and Save Current,
 * to add the running recipe to them. That is all of it. Loading a saved
 * recipe onto the line is not here yet: selecting one shows it and
 * changes nothing.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything listed comes from ONE object: the book the application
 * publishes through station-recipes-bridge.js - the workspace's shared
 * recipes as the application's own service caches them. This file keeps
 * no recipe list, no cache and no payload of its own; a publish replaces
 * the book and the list is redrawn from it. Save Current asks the
 * application, through that bridge's request(), to save the running
 * recipe under a name - the application builds the payload from its own
 * state, with its own helper, and saves it along its own path, exactly as
 * its Save Current Recipe dialog does; a name already taken comes back as
 * the service's own duplicate_name, and the offer to replace goes back the
 * same way. Nothing here knows what a recipe payload looks like on the
 * wire, where it is stored, or how a name is normalized there.
 *
 * BLEND EDIT IS NOT HERE
 *
 * Blend Edit - the stage's mode under which each layer's hopper cluster
 * turns over to a compact blend editor - is switched on and off from the
 * machine utility rail beside the far-right cluster
 * (station-machine-rail.js), not from this book. The two are independent:
 * the book opens, lists and previews saved recipes exactly the same with
 * the mode on, and nothing the book does enters or leaves it.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only, and only for this screen: which saved recipe
 * is selected, whether the name entry is open, a request in flight, the
 * last message a request produced.
 */
(function (root, factory) {
  const lineModel = typeof require === "function"
    ? require("./station-line-model.js")
    : (root && root.PolynStationLineModel);
  const api = factory(lineModel);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationRecipeBook = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (lineModelModule) {
  "use strict";

  const ID = "recipe-book";
  const TITLE = "Recipe Book";
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* The Handbook's control language (handbook.css), which every section
   * draws its controls in and this one does not extend:
   *
   *   station-handbook__action               a command; `is-primary` for the
   *                                          one that completes the work at
   *                                          hand, `is-quiet` for one that
   *                                          only steps back
   *   station-handbook__utility              a small icon-only command
   *   station-handbook__chip                 a compact stateful selector
   *
   * Which of these a control is says what it is FOR; nothing else here
   * decides how a button looks. */
  const ACTION = "station-handbook__action";
  const PRIMARY = `${ACTION} is-primary`;
  const QUIET = `${ACTION} is-quiet`;

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  /* The one glyph this section draws, 16 by 16, stroked in the current
   * colour by the stylesheet (handbook.css) so it follows the control it
   * sits in: a refresh arrow. */
  function glyph(doc) {
    const svg = svgNode(doc, "svg", "station-handbook__glyph", {
      viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.2 8.6 A 5.2 5.2 0 1 1 11.9 4.3" }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.4 2.6 L 13.4 5.8 L 10.2 5.8" }));
    return svg;
  }

  function round(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function formatWhen(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch (error) {
      return date.toISOString().slice(0, 10);
    }
  }

  /* The same rule the service applies to a name before comparing two:
   * lower-cased, whitespace collapsed. Used only to find which saved
   * recipe a duplicate_name refers to; the server's own normalization is
   * what decides the collision. */
  function normalizedName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  /* A saved recipe's hopper, named as the line names it, through the same
   * helper the line model uses for the drawn hoppers. */
  function hopperId(layerName, index, namingMode, lineModel) {
    if (lineModel && typeof lineModel.hopperId === "function") return lineModel.hopperId(layerName, index, namingMode);
    return `${layerName}${index + 1}`;
  }

  /** One line per row: the recipe's layer count and when it was updated. */
  function rowMeta(recipe) {
    const layers = Array.isArray(recipe.layers) ? recipe.layers.length : 0;
    const parts = [`${layers} layer${layers === 1 ? "" : "s"}`];
    const when = formatWhen(recipe.updatedAt);
    if (when) parts.push(when);
    return parts.join(" · ");
  }

  /* The book's lines, from the bridge, as words: what the list says when
   * it has nothing to list. */
  function emptyText(book, connected) {
    if (!connected) return "No application is connected to Station: saved recipes are not available here.";
    if (!book || !book.assigned) return "This desktop is not on a production line. Connect it through RT Sync to see the line's saved recipes.";
    if (book.refreshing && !book.count) return "Reading the line's saved recipes…";
    return "No recipes are saved for this line yet. Save Current adds the running recipe.";
  }

  /**
   * Build the section.
   *
   * @param {Document} doc
   * @param {object} context
   * @param {object|null} context.recipes   the recipes bridge (getBook,
   *        subscribe, isConnected, request). Handed in, never reached for.
   * @param {object} [context.lineModel]    for hopper naming; defaults to
   *        the line model module
   * @param {function} [context.layerRole]  (name) => the role of that layer
   *        on the line the stage shows ("outside", "core", ...), or "" - the
   *        boot file's reading of its line model. A saved recipe's layers
   *        are listed A, B, C... and accented by the side each sits on for
   *        THIS line; without the reader, position in the list is read as
   *        the physical stack, outside first.
   */
  function create(doc, context) {
    const settings = context || {};
    const recipes = settings.recipes || null;
    const lineModel = settings.lineModel || lineModelModule;
    const layerRole = typeof settings.layerRole === "function" ? settings.layerRole : null;

    const state = {
      selectedId: null,
      entryOpen: false,
      pending: null,      // the request in flight, by action
      note: "",
      noteKind: "",
      duplicate: null     // { name, id } after a duplicate_name: the id it collides with
    };

    const rootEl = element(doc, "div", "station-book", { "data-role": "recipe-book" });

    /* ---- Toolbar ----
     * Save Current leads; Refresh is a utility, an icon that says what it
     * is on hover and to a reader. */
    const toolbar = element(doc, "div", "station-book__toolbar");
    const saveButton = text(doc, "button", PRIMARY, "Save Current", { type: "button", "data-action": "save-current" });
    const refreshButton = element(doc, "button", "station-handbook__utility", {
      type: "button", "data-action": "refresh", "aria-label": "Refresh", title: "Refresh the line's saved recipes"
    });
    refreshButton.appendChild(glyph(doc));
    const contextLabel = element(doc, "span", "station-book__context");
    toolbar.appendChild(saveButton); toolbar.appendChild(refreshButton); toolbar.appendChild(contextLabel);
    rootEl.appendChild(toolbar);

    /* ---- Save Current: the name, asked for in place ---- */
    const entry = element(doc, "div", "station-book__entry", { hidden: "" });
    entry.appendChild(text(doc, "span", "station-book__entry-label", "Save the running recipe as"));
    const nameInput = element(doc, "input", "station-book__name", {
      type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Recipe name", "aria-label": "Recipe name"
    });
    const confirmButton = text(doc, "button", PRIMARY, "Save", { type: "button", "data-action": "confirm-save" });
    const replaceButton = text(doc, "button", ACTION, "Replace existing", { type: "button", "data-action": "replace", hidden: "" });
    const cancelButton = text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-save" });
    entry.appendChild(nameInput); entry.appendChild(confirmButton); entry.appendChild(replaceButton); entry.appendChild(cancelButton);
    rootEl.appendChild(entry);

    const note = element(doc, "p", "station-book__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    /* ---- List and detail ---- */
    const columns = element(doc, "div", "station-book__columns");
    const list = element(doc, "ol", "station-book__list", { "aria-label": "Saved recipes" });
    const detail = element(doc, "div", "station-book__detail", { "aria-live": "polite" });
    columns.appendChild(list); columns.appendChild(detail);
    rootEl.appendChild(columns);

    /* ---- Reading ---- */

    function connected() {
      return !!(recipes && typeof recipes.isConnected === "function" && recipes.isConnected());
    }

    function book() {
      return recipes && typeof recipes.getBook === "function" ? recipes.getBook() : null;
    }

    function say(message, kind) {
      state.note = message || "";
      state.noteKind = state.note ? (kind || "") : "";
      note.textContent = state.note;
      note.setAttribute("data-kind", state.noteKind);
      show(note, !!state.note);
    }

    function selected(current) {
      const items = current && Array.isArray(current.recipes) ? current.recipes : [];
      return items.find(recipe => recipe.id === state.selectedId) || null;
    }

    /* ---- Drawing ---- */

    function drawList(current) {
      clearChildren(list);
      const items = current && Array.isArray(current.recipes) ? current.recipes : [];
      if (!items.length) {
        list.appendChild(text(doc, "li", "station-book__empty", emptyText(current, connected())));
        return;
      }
      for (const recipe of items) {
        const item = element(doc, "li");
        const row = element(doc, "button", `station-book__row${recipe.favorite ? " is-favorite" : ""}`, {
          type: "button", "data-recipe": recipe.id, "aria-pressed": recipe.id === state.selectedId ? "true" : "false"
        });
        row.appendChild(text(doc, "span", "station-book__star", recipe.favorite ? "★" : "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "station-book__row-name", recipe.name));
        row.appendChild(text(doc, "span", "station-book__row-meta", rowMeta(recipe)));
        if (recipe.favorite) row.setAttribute("aria-label", `${recipe.name}, favourite`);
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawDetail(current) {
      clearChildren(detail);
      const recipe = selected(current);
      if (!recipe) {
        const items = current && Array.isArray(current.recipes) ? current.recipes : [];
        detail.appendChild(text(doc, "p", "station-book__empty", items.length
          ? "Select a saved recipe to see its blend. Selecting changes nothing on the line."
          : ""));
        return;
      }
      detail.appendChild(text(doc, "h3", "station-book__detail-name", recipe.name));
      // The recipe's own order - A, B, C... - as the stage lists its banks.
      const layers = (Array.isArray(recipe.layers) ? recipe.layers : []).slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      layers.forEach((layer, index) => {
        const row = element(doc, "div", "station-book__layer", {
          "data-layer": layer.name,
          "data-layer-role": roleOf(layer.name, index, layers.length)
        });
        row.appendChild(text(doc, "span", "station-book__layer-id", layer.name));
        row.appendChild(text(doc, "span", "station-book__layer-share", layer.layerPct > 0 ? `${round(layer.layerPct)}%` : "—"));
        const hoppers = element(doc, "span", "station-book__hoppers");
        const assigned = (Array.isArray(layer.hoppers) ? layer.hoppers : []).filter(hopper => hopper.resinName || hopper.pct > 0);
        if (!assigned.length) hoppers.appendChild(text(doc, "span", "station-book__hopper-id", "no hoppers assigned"));
        for (const hopper of assigned) {
          const cell = element(doc, "span", "station-book__hopper");
          cell.appendChild(text(doc, "span", "station-book__hopper-id", `${hopperId(layer.name, hopper.index, recipe.hopperNamingMode, lineModel)} `));
          cell.appendChild(text(doc, "span", "station-book__hopper-resin", hopper.resinName || "no resin"));
          cell.appendChild(text(doc, "span", "station-book__hopper-pct", ` ${round(hopper.pct)}%`));
          hoppers.appendChild(cell);
        }
        row.appendChild(hoppers);
        detail.appendChild(row);
      });
    }

    /* The layer's role for its accent: the line's own reading of that
     * letter when the boot file handed one in (Layer A is the inside on
     * some lines and the outside on others), else by position in the
     * recipe read as the physical stack, outside first. */
    function roleOf(name, index, count) {
      if (layerRole) {
        try {
          const role = layerRole(name);
          if (typeof role === "string" && role) return role;
        } catch (error) { /* fall through to the positional reading */ }
      }
      if (lineModel && typeof lineModel.roleForStackIndex === "function") {
        try { return lineModel.roleForStackIndex(index, count); } catch (error) { return ""; }
      }
      return "";
    }

    function refresh() {
      const current = book();
      const on = connected();
      const assigned = !!(current && current.assigned);
      contextLabel.textContent = assigned && current.workspace
        ? `${current.workspace.displayName} · ${current.count} saved`
        : (on ? "No line" : "Not connected");
      saveButton.disabled = !on || !assigned || !!state.pending;
      // One primary at a time: while the name is being asked for, the
      // entry's own Save is the action that completes the work.
      saveButton.classList.toggle("is-primary", !state.entryOpen);
      saveButton.setAttribute("title", !on
        ? "Saving is not available: no application is connected to Station."
        : (!assigned ? "Connect this desktop to a production line to save shared recipes." : "Save the running recipe to this line's shared recipes."));
      refreshButton.disabled = !on || !assigned || !!state.pending || !!(current && current.refreshing);
      const refreshing = !!(current && current.refreshing);
      refreshButton.setAttribute("aria-label", refreshing ? "Refreshing…" : "Refresh");
      refreshButton.setAttribute("title", refreshing ? "Refreshing the line's saved recipes…" : "Refresh the line's saved recipes");
      refreshButton.classList.toggle("is-busy", refreshing);
      confirmButton.disabled = !!state.pending;
      replaceButton.disabled = !!state.pending;
      show(replaceButton, !!state.duplicate);
      show(entry, state.entryOpen);
      // A selection that is no longer in the book is dropped, not kept as a ghost.
      if (state.selectedId && !selected(current)) state.selectedId = null;
      drawList(current);
      drawDetail(current);
    }

    /* ---- Actions ---- */

    function openEntry(prefill) {
      state.entryOpen = true;
      state.duplicate = null;
      nameInput.value = prefill || "";
      nameInput.removeAttribute("aria-invalid");
      say("");
      refresh();
      if (typeof nameInput.focus === "function") nameInput.focus();
      if (typeof nameInput.select === "function") nameInput.select();
    }

    function closeEntry() {
      state.entryOpen = false;
      state.duplicate = null;
      refresh();
    }

    async function request(action, args) {
      if (!recipes || typeof recipes.request !== "function") {
        return { ok: false, code: "unavailable", message: "No application is connected to Station's saved recipes." };
      }
      state.pending = action;
      refresh();
      let result;
      try {
        result = await recipes.request(action, args);
      } finally {
        state.pending = null;
      }
      return result || { ok: false, code: "failed", message: "The application did not answer." };
    }

    /* Save Current: the name goes to the application as saveCurrentRecipe.
     * A duplicate is the service's own answer; the offer to replace the
     * recipe it collides with is made here and goes back as replaceRecipe,
     * by that recipe's id - which the book already carries. */
    async function confirmSave() {
      const name = String(nameInput.value || "").trim().replace(/\s+/g, " ");
      if (!name) {
        nameInput.setAttribute("aria-invalid", "true");
        say("Give the recipe a name.", "error");
        return null;
      }
      nameInput.removeAttribute("aria-invalid");
      const result = await request("saveCurrentRecipe", { name });
      if (result.ok) {
        state.selectedId = result.id || state.selectedId;
        state.entryOpen = false;
        state.duplicate = null;
        say(`Saved “${name}” to this line's recipes.`, "ok");
        refresh();
        return result;
      }
      if (result.code === "duplicate_name") {
        const current = book();
        const existing = ((current && current.recipes) || []).find(recipe => normalizedName(recipe.name) === normalizedName(name)) || null;
        state.duplicate = { name, id: existing ? existing.id : null };
        if (existing) state.selectedId = existing.id;
        say(existing
          ? `A recipe named “${existing.name}” already exists. Replace it with the running recipe, or choose another name.`
          : "A recipe with that name already exists. Choose another name.", "error");
        nameInput.setAttribute("aria-invalid", "true");
        refresh();
        return result;
      }
      say(result.message || "The recipe could not be saved.", "error");
      refresh();
      return result;
    }

    async function replaceExisting() {
      const duplicate = state.duplicate;
      if (!duplicate || !duplicate.id) return null;
      const result = await request("replaceRecipe", { id: duplicate.id });
      if (result.ok) {
        state.selectedId = duplicate.id;
        state.entryOpen = false;
        state.duplicate = null;
        say(`Replaced “${duplicate.name}” with the running recipe.`, "ok");
      } else {
        say(result.message || "The recipe could not be replaced.", "error");
      }
      refresh();
      return result;
    }

    async function refreshBook() {
      const result = await request("refresh");
      if (!result.ok) say(result.message || "The saved recipes could not be refreshed.", "error");
      else say("");
      refresh();
      return result;
    }

    rootEl.addEventListener("click", event => {
      const target = event.target && event.target.closest ? event.target.closest("[data-action], [data-recipe]") : null;
      if (!target) return;
      const recipeId = target.getAttribute("data-recipe");
      if (recipeId) {
        // Selecting shows the recipe and changes nothing on the line.
        state.selectedId = state.selectedId === recipeId ? null : recipeId;
        refresh();
        return;
      }
      const action = target.getAttribute("data-action");
      if (action === "save-current") { openEntry(""); return; }
      if (action === "confirm-save") { void confirmSave(); return; }
      if (action === "replace") { void replaceExisting(); return; }
      if (action === "cancel-save") { closeEntry(); return; }
      if (action === "refresh") { void refreshBook(); return; }
    });
    nameInput.addEventListener("keydown", event => {
      if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); void confirmSave(); }
      else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeEntry(); }
    });

    refresh();

    return {
      element: rootEl,
      update: refresh,
      focus() {
        const target = state.entryOpen ? nameInput : saveButton;
        if (target && typeof target.focus === "function" && !target.disabled) target.focus();
      },
      /* A page of lists - the book on the left, a recipe's blend on the
       * right - both of which scroll: the Handbook may be raised for it. */
      grows: () => true,
      confirmSave,
      replaceExisting,
      refreshBook,
      select(id) { state.selectedId = id || null; refresh(); },
      getState: () => ({
        selectedId: state.selectedId, entryOpen: state.entryOpen, pending: state.pending,
        note: state.note, noteKind: state.noteKind, duplicate: state.duplicate ? Object.assign({}, state.duplicate) : null
      })
    };
  }

  /* The section as the Handbook takes it. */
  const section = Object.freeze({ id: ID, title: TITLE, create });

  return Object.freeze({ ID, TITLE, section, create, rowMeta, emptyText, normalizedName });
});
