/* The Recipe Book: the Operator Handbook's first section.
 *
 * WHAT IT IS
 *
 * The saved recipes of the production line this desktop is on, as a
 * compact list; the blend of whichever one is selected; Save Current, to
 * add the running recipe to them; and the way into Blend Edit, with the
 * mode's own controls while it is on. That is all of it. Loading a saved
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
 * BLEND EDIT
 *
 * A mode of the stage, not of this panel: while it is on, each layer's
 * hopper cluster can be turned over to a compact blend editor in its own
 * footprint (station.js, station-machine-parts.js). This section is where
 * the mode is entered and left, and where the operator sees which layers
 * are turned over and can turn them all. The editing itself happens on
 * the hoppers above; the controls here go through the surface the boot
 * file handed in (`context.blend`) and hold nothing of their own.
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
   * @param {object|null} context.blend     Blend Edit's surface, from the
   *        boot file: { available(), isActive(), layers(), enter(), exit(),
   *        flip(id, on), flipAll(on) }
   * @param {object} [context.lineModel]    for hopper naming; defaults to
   *        the line model module
   */
  function create(doc, context) {
    const settings = context || {};
    const recipes = settings.recipes || null;
    const blend = settings.blend || null;
    const lineModel = settings.lineModel || lineModelModule;

    const state = {
      selectedId: null,
      entryOpen: false,
      pending: null,      // the request in flight, by action
      note: "",
      noteKind: "",
      duplicate: null     // { name, id } after a duplicate_name: the id it collides with
    };

    const rootEl = element(doc, "div", "station-book", { "data-role": "recipe-book" });

    /* ---- Toolbar ---- */
    const toolbar = element(doc, "div", "station-book__toolbar");
    const saveButton = text(doc, "button", "station-book__action is-primary", "Save Current", { type: "button", "data-action": "save-current" });
    const blendButton = text(doc, "button", "station-book__action", "Blend Edit", { type: "button", "data-action": "blend-edit" });
    const refreshButton = text(doc, "button", "station-book__action is-quiet", "Refresh", { type: "button", "data-action": "refresh" });
    const contextLabel = element(doc, "span", "station-book__context");
    toolbar.appendChild(saveButton); toolbar.appendChild(blendButton); toolbar.appendChild(refreshButton); toolbar.appendChild(contextLabel);
    rootEl.appendChild(toolbar);

    /* ---- Save Current: the name, asked for in place ---- */
    const entry = element(doc, "div", "station-book__entry", { hidden: "" });
    entry.appendChild(text(doc, "span", "station-book__entry-label", "Save the running recipe as"));
    const nameInput = element(doc, "input", "station-book__name", {
      type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Recipe name", "aria-label": "Recipe name"
    });
    const confirmButton = text(doc, "button", "station-book__action is-primary", "Save", { type: "button", "data-action": "confirm-save" });
    const replaceButton = text(doc, "button", "station-book__action", "Replace existing", { type: "button", "data-action": "replace", hidden: "" });
    const cancelButton = text(doc, "button", "station-book__action is-quiet", "Cancel", { type: "button", "data-action": "cancel-save" });
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

    /* ---- Blend Edit's controls ---- */
    const blendPanel = element(doc, "div", "station-book__blend", { hidden: "", "data-role": "blend-controls" });
    const blendHint = text(doc, "p", "station-book__blend-hint", "");
    const layerChips = element(doc, "div", "station-book__layers", { role: "group", "aria-label": "Layers in Blend Edit" });
    const blendActions = element(doc, "div", "station-book__blend-actions");
    const editAllButton = text(doc, "button", "station-book__action", "Edit all layers", { type: "button", "data-action": "edit-all" });
    const showAllButton = text(doc, "button", "station-book__action is-quiet", "Show all hoppers", { type: "button", "data-action": "show-all" });
    const doneButton = text(doc, "button", "station-book__action is-primary", "Done", { type: "button", "data-action": "done" });
    blendActions.appendChild(editAllButton); blendActions.appendChild(showAllButton); blendActions.appendChild(doneButton);
    blendPanel.appendChild(blendHint); blendPanel.appendChild(layerChips); blendPanel.appendChild(blendActions);
    rootEl.appendChild(blendPanel);

    /* ---- Reading ---- */

    function connected() {
      return !!(recipes && typeof recipes.isConnected === "function" && recipes.isConnected());
    }

    function book() {
      return recipes && typeof recipes.getBook === "function" ? recipes.getBook() : null;
    }

    function blendActive() {
      return !!(blend && typeof blend.isActive === "function" && blend.isActive());
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
      const layers = Array.isArray(recipe.layers) ? recipe.layers : [];
      layers.forEach((layer, index) => {
        const row = element(doc, "div", "station-book__layer", {
          "data-layer": layer.name,
          "data-layer-role": roleOf(index, layers.length)
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

    /* The layer's role for its accent, by position in the recipe - the
     * same reading the line model makes (outside first). */
    function roleOf(index, count) {
      if (lineModel && typeof lineModel.roleForStackIndex === "function") {
        try { return lineModel.roleForStackIndex(index, count); } catch (error) { return ""; }
      }
      return "";
    }

    function drawBlend() {
      const active = blendActive();
      show(blendPanel, active);
      show(columns, !active);
      show(toolbar, !active);
      show(entry, !active && state.entryOpen);
      if (!active) return;
      clearChildren(layerChips);
      const layers = blend && typeof blend.layers === "function" ? blend.layers() : [];
      for (const layer of layers) {
        const chip = element(doc, "button", "station-book__layer-chip", {
          type: "button", "data-layer": layer.id, "aria-pressed": layer.flipped ? "true" : "false",
          title: layer.flipped ? `Layer ${layer.id}: editing its blend in place; click to show its hoppers` : `Layer ${layer.id}: click to edit its blend in place`
        });
        chip.appendChild(text(doc, "span", "station-book__chip-id", layer.id));
        chip.appendChild(text(doc, "span", "station-book__chip-state", layer.flipped ? "editing" : "hoppers"));
        layerChips.appendChild(chip);
      }
      const flipped = layers.filter(layer => layer.flipped).length;
      blendHint.textContent = blend && typeof blend.available === "function" && !blend.available()
        ? "Blend Edit is read-only here: no application is connected to Station commands. Turn a layer over to see its blend as a list."
        : (flipped
          ? `${flipped} of ${layers.length} layer${layers.length === 1 ? "" : "s"} turned over. Each change is applied to the running recipe as it is made; Done turns the hoppers back.`
          : "Turn a layer over - here, or with the chip under its name on the stage - to edit its blend in place. The hoppers stay where they are.");
      editAllButton.disabled = flipped === layers.length;
      showAllButton.disabled = flipped === 0;
    }

    function refresh() {
      const current = book();
      const on = connected();
      const assigned = !!(current && current.assigned);
      contextLabel.textContent = assigned && current.workspace
        ? `${current.workspace.displayName} · ${current.count} saved`
        : (on ? "No line" : "Not connected");
      saveButton.disabled = !on || !assigned || !!state.pending;
      saveButton.setAttribute("title", !on
        ? "Saving is not available: no application is connected to Station."
        : (!assigned ? "Connect this desktop to a production line to save shared recipes." : "Save the running recipe to this line's shared recipes."));
      refreshButton.disabled = !on || !assigned || !!state.pending || !!(current && current.refreshing);
      refreshButton.textContent = current && current.refreshing ? "Refreshing…" : "Refresh";
      blendButton.disabled = !(blend && typeof blend.enter === "function" && (typeof blend.canEnter !== "function" || blend.canEnter()));
      blendButton.setAttribute("title", blendButton.disabled
        ? "Blend Edit needs a line with layers on the stage."
        : "Turn the layers on the stage over to edit their blends in place.");
      confirmButton.disabled = !!state.pending;
      replaceButton.disabled = !!state.pending;
      show(replaceButton, !!state.duplicate);
      // A selection that is no longer in the book is dropped, not kept as a ghost.
      if (state.selectedId && !selected(current)) state.selectedId = null;
      drawList(current);
      drawDetail(current);
      drawBlend();
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
      const target = event.target && event.target.closest ? event.target.closest("[data-action], [data-recipe], [data-layer]") : null;
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
      if (action === "blend-edit") { if (blend && typeof blend.enter === "function") blend.enter(); refresh(); return; }
      if (action === "edit-all") { if (blend && typeof blend.flipAll === "function") blend.flipAll(true); refresh(); return; }
      if (action === "show-all") { if (blend && typeof blend.flipAll === "function") blend.flipAll(false); refresh(); return; }
      if (action === "done") { if (blend && typeof blend.exit === "function") blend.exit(); refresh(); return; }
      const layerId = target.getAttribute("data-layer");
      if (layerId && blendActive() && blend && typeof blend.flip === "function") {
        blend.flip(layerId, target.getAttribute("aria-pressed") !== "true");
        refresh();
      }
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
        const target = state.entryOpen ? nameInput : (blendActive() ? doneButton : saveButton);
        if (target && typeof target.focus === "function" && !target.disabled) target.focus();
      },
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
