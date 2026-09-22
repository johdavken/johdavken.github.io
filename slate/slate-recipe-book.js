/* The Recipe Book: the line's shared recipes, from the recipes bridge.
 *
 * A list of the workspace's saved recipes (favourites first, as the
 * application orders them) and, for the one selected, its blend and what
 * can be done with it: Load into the running recipe or the plan, Update
 * it with the running recipe, Rename, Duplicate, Delete. Every load and
 * update is confirmed in place with the application's own words on what
 * changes and what does not, and a preview of how many hoppers and layer
 * shares would move. Save Current / Save Next add the running recipe or
 * the plan under a name.
 *
 * Selecting a recipe changes nothing on the line. Every action is one
 * request through slate-book-actions.js; the book redraws from the
 * bridge's own publishes, and the compatibility and preview follow the
 * state bridge through update(). The name-entry row is built once and
 * never rebuilt, so a publish while typing keeps the field.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(
    pick("PolynSlateBookActions", "./slate-book-actions.js"),
    pick("PolynSlateSource", "./slate-source.js"),
    pick("PolynSlateLine", "./slate-line.js")
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipeBook = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (actionsModule, sourceModule, lineModule) {
  "use strict";

  /* What a load changes and what it does not - the application's own
   * words (its load dialog), said before the operator confirms. */
  const LOAD_CURRENT_TEXT = "Load into Current changes the line type, hopper naming mode, layer percentages and resin assignments of the RUNNING recipe, and the line is told at once. Receiver weights, tracking, pump-off state, timeline and runtime state, workspace, RT Sync identity and appearance are not changed.";
  const LOAD_NEXT_TEXT = "Load into Next replaces only the planned Next Recipe. The running recipe is untouched.";
  const SELECT_HINT = "Select a saved recipe to see its blend. Selecting changes nothing on the line.";
  const NOTHING_PLANNED = "nothing is planned; this becomes the plan";
  const NOTHING_CHANGES = "nothing would change";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function clear(node) {
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

  /** One line per row: the recipe's layer count and when it was updated. */
  function rowMeta(recipe) {
    const layers = Array.isArray(recipe.layers) ? recipe.layers.length : 0;
    const parts = [`${layers} layer${layers === 1 ? "" : "s"}`];
    const when = formatWhen(recipe.updatedAt);
    if (when) parts.push(when);
    return parts.join(" · ");
  }

  /** What the list says when it has nothing to list. */
  function emptyText(book, connected) {
    if (!connected) return "No application is connected to Slate: saved recipes are not available here.";
    if (!book || !book.assigned) return "This device is not on a production line. Connect it through RT Sync to see the line's saved recipes.";
    if (book.refreshing && !book.count) return "Reading the line's saved recipes…";
    return "No recipes are saved for this line yet. Save Current adds the running recipe.";
  }

  function subtitleFor(book, connected) {
    if (!connected) return "Not connected";
    if (!book || !book.assigned) return "No line";
    const name = (book.workspace && book.workspace.displayName) || "Connected line";
    return `${name} · ${book.count} saved`;
  }

  /**
   * Whether a saved recipe fits the line, by the one rule the application
   * applies to a load into Current: the layer count. With no line model
   * the question is the application's alone.
   */
  function compatibility(recipe, model) {
    const layers = model && Array.isArray(model.layers) ? model.layers.length : 0;
    const lineType = recipe ? Number(recipe.lineType) : 0;
    if (!layers || !(lineType > 0) || lineType === layers) return { ok: true, message: "", lineType, layerCount: layers };
    return {
      ok: false,
      message: `This recipe is set up for ${lineType} layers, but this line runs ${layers}. It can be loaded into Next, not into Current.`,
      lineType,
      layerCount: layers
    };
  }

  /**
   * How much a load would move, as Slate estimates it against the recipe
   * shown now: every slot of the line is the universe; a recipe layer is
   * matched by name (absent means empty); a hopper beyond the line's
   * count is ignored. The application's apply is the judge - it also
   * clears lots and keeps weights, tracking and pump-off by position,
   * which are not counted here.
   */
  function previewFor(recipe, resolved, destination) {
    const model = resolved && resolved.line;
    if (!recipe || !model) return null;
    const planned = !!(resolved.plan && resolved.plan.planned);
    const state = sourceModule.stateFor(resolved, destination);
    const byName = new Map((Array.isArray(recipe.layers) ? recipe.layers : []).map(layer => [String(layer.name || ""), layer]));
    let hoppersChanged = 0;
    let hoppersTotal = 0;
    let layersChanged = 0;
    for (const layer of model.layers) {
      const incoming = byName.get(layer.id) || { layerPct: 0, hoppers: [] };
      const shareNow = state.layers[layer.id] ? Number(state.layers[layer.id].layerPct) || 0 : 0;
      if ((Number(incoming.layerPct) || 0) !== shareNow) layersChanged += 1;
      const incomingHoppers = new Map((Array.isArray(incoming.hoppers) ? incoming.hoppers : []).map(hopper => [Number(hopper.index), hopper]));
      for (const hopper of layer.hoppers) {
        hoppersTotal += 1;
        const before = state.hoppers[`${layer.id}:${hopper.index}`] || { resinName: "", pct: 0 };
        const after = incomingHoppers.get(hopper.index) || { resinName: "", pct: 0 };
        if (!sourceModule.sameResin(before.resinName, after.resinName) || (Number(before.pct) || 0) !== (Number(after.pct) || 0)) hoppersChanged += 1;
      }
    }
    const same = hoppersChanged === 0 && layersChanged === 0;
    let textOut;
    if (destination === "next" && !planned) textOut = NOTHING_PLANNED;
    else if (same) textOut = NOTHING_CHANGES;
    else {
      const hoppers = `${hoppersChanged} of ${hoppersTotal} hopper${hoppersTotal === 1 ? "" : "s"} change`;
      const layers = layersChanged === 0 ? "no layer shares change" : `${layersChanged} layer share${layersChanged === 1 ? "" : "s"} change`;
      textOut = `${hoppers}, ${layers}`;
    }
    return { destination, planned, hoppers: { changed: hoppersChanged, total: hoppersTotal }, layers: { changed: layersChanged, total: model.layers.length }, same, text: textOut };
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.recipes   the recipes bridge
   * @param {function} [ctx.readOnly]
   * @param {function} [ctx.say]
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const recipes = settings.recipes || null;
    const readOnly = typeof settings.readOnly === "function" ? settings.readOnly : () => false;
    const say = typeof settings.say === "function" ? settings.say : () => {};

    const rootEl = element(doc, "div", "slate-book");

    // The bar.
    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", "");
    bar.appendChild(subtitle);
    const barButtons = {};
    for (const [action, label, className] of [["save-current", "Save Current", "slate-book__action--primary"], ["save-next", "Save Next", ""], ["refresh", "Refresh", "slate-book__action--quiet"]]) {
      const button = text(doc, "button", `slate-book__action ${className}`.trim(), label, { type: "button", "data-book-action": action, "data-able": "false" });
      barButtons[action] = button;
      bar.appendChild(button);
    }
    rootEl.appendChild(bar);

    // The name entry, built once.
    const entry = element(doc, "div", "slate-book__entry", { hidden: "" });
    const entryLabel = text(doc, "span", "slate-book__entry-label", "");
    const nameInput = element(doc, "input", "slate-book__name", { type: "text", "aria-label": "Recipe name", maxlength: "120", autocomplete: "off" });
    const entryConfirm = text(doc, "button", "slate-book__action slate-book__action--primary", "Save", { type: "button", "data-book-action": "confirm-entry" });
    const entryReplace = text(doc, "button", "slate-book__action", "Replace existing", { type: "button", "data-book-action": "replace", hidden: "" });
    const entryCancel = text(doc, "button", "slate-book__action slate-book__action--quiet", "Cancel", { type: "button", "data-book-action": "cancel-entry" });
    for (const node of [entryLabel, nameInput, entryConfirm, entryReplace, entryCancel]) entry.appendChild(node);
    rootEl.appendChild(entry);

    const note = element(doc, "p", "slate-book__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    const columns = element(doc, "div", "slate-book__columns");
    const list = element(doc, "ol", "slate-book__list", { "aria-label": "Saved recipes" });
    const detail = element(doc, "div", "slate-book__detail", { "aria-live": "polite" });
    columns.appendChild(list);
    columns.appendChild(detail);
    rootEl.appendChild(columns);

    const state = { book: null, resolved: null, selectedId: null, entry: null, confirm: null, moreOpen: false, pending: null, note: "", noteKind: "", duplicate: null };

    const connected = () => actionsModule.connected(recipes);
    const planned = () => !!(state.resolved && state.resolved.plan && state.resolved.plan.planned);
    const options = () => ({ readOnly: !!readOnly(), planned: planned() });
    const able = () => actionsModule.can(recipes, options());
    const why = control => actionsModule.reason(recipes, control, options());
    const selected = () => actionsModule.findById(state.book, state.selectedId);

    function setNote(kind, message) {
      state.noteKind = kind;
      state.note = message || "";
      note.textContent = state.note;
      note.classList.toggle("is-error", kind === "error");
      note.classList.toggle("is-ok", kind === "ok");
      show(note, !!state.note);
    }

    /* ---- Requests ---- */

    async function ask(action, run) {
      if (state.pending) return null;
      state.pending = action;
      setNote("", "");
      paintAll();
      let result;
      try {
        result = await run();
      } finally {
        state.pending = null;
      }
      paintAll();
      return result || { ok: false, code: "failed", message: actionsModule.WORDING.noAnswer };
    }

    /* ---- Entry (save / rename / duplicate) ---- */

    function openEntry(mode, which, id) {
      const recipe = id ? actionsModule.findById(state.book, id) : null;
      state.entry = { mode, which: which || "current", id: id || null };
      state.duplicate = null;
      state.confirm = null;
      state.moreOpen = false;
      if (mode === "save") entryLabel.textContent = which === "next" ? "Save the planned recipe as" : "Save the running recipe as";
      else if (mode === "rename") entryLabel.textContent = `Rename “${recipe ? recipe.name : ""}” to`;
      else entryLabel.textContent = `Duplicate “${recipe ? recipe.name : ""}” as`;
      entryConfirm.textContent = mode === "save" ? "Save" : (mode === "rename" ? "Rename" : "Duplicate");
      nameInput.value = mode === "rename" ? (recipe ? recipe.name : "") : (mode === "duplicate" && recipe ? `${recipe.name} copy` : "");
      nameInput.removeAttribute("aria-invalid");
      show(entryReplace, false);
      show(entry, true);
      paintAll();
      if (typeof nameInput.focus === "function") nameInput.focus();
      if (typeof nameInput.select === "function") nameInput.select();
    }

    function closeEntry() {
      state.entry = null;
      state.duplicate = null;
      nameInput.value = "";
      nameInput.removeAttribute("aria-invalid");
      show(entryReplace, false);
      show(entry, false);
    }

    async function confirmEntry() {
      const current = state.entry;
      if (!current) return;
      const name = actionsModule.cleanName(nameInput.value);
      if (!name) { nameInput.setAttribute("aria-invalid", "true"); setNote("error", actionsModule.WORDING.nameNeeded); return; }
      const before = current;
      let result;
      if (current.mode === "save") result = await ask("save", () => actionsModule.save(recipes, current.which, name));
      else if (current.mode === "rename") result = await ask("rename", () => actionsModule.rename(recipes, current.id, name));
      else result = await ask("duplicate", () => actionsModule.duplicate(recipes, current.id, name));
      if (!result || state.entry !== before) return;
      if (result.ok) {
        const wording = current.mode === "save" ? actionsModule.WORDING.saved : (current.mode === "rename" ? actionsModule.WORDING.renamed : actionsModule.WORDING.duplicated);
        if (result.id) state.selectedId = result.id;
        closeEntry();
        setNote("ok", wording(name));
        paintAll();
        return;
      }
      nameInput.setAttribute("aria-invalid", "true");
      if (result.code === "duplicate_name" && result.existing) {
        state.duplicate = result.existing;
        state.selectedId = result.existing.id;
        show(entryReplace, true);
        setNote("error", actionsModule.WORDING.duplicateOffer(result.existing.name));
      } else if (result.code === "duplicate_name") {
        setNote("error", actionsModule.WORDING.duplicateOther);
      } else {
        setNote("error", result.message || "The application refused the change.");
      }
      paintAll();
    }

    async function replaceExisting() {
      const existing = state.duplicate;
      if (!existing) return;
      const result = await ask("replace", () => actionsModule.replace(recipes, existing.id));
      if (!result) return;
      if (result.ok) {
        closeEntry();
        state.selectedId = existing.id;
        setNote("ok", actionsModule.WORDING.replaced(existing.name));
      } else {
        setNote("error", result.message || "The recipe could not be replaced.");
      }
      paintAll();
    }

    /* ---- Confirms (load / update / delete) ---- */

    function openConfirm(kind, id) {
      state.confirm = { kind, id };
      state.moreOpen = false;
      paintDetail();
    }

    function closeConfirm() {
      state.confirm = null;
      paintDetail();
    }

    async function confirmAction(destination) {
      const confirm = state.confirm;
      const recipe = selected();
      if (!confirm || !recipe || confirm.id !== recipe.id) return;
      let result;
      if (confirm.kind === "load") result = await ask("load", () => actionsModule.load(recipes, recipe.id, destination));
      else if (confirm.kind === "update") result = await ask("update", () => actionsModule.replace(recipes, recipe.id));
      else result = await ask("remove", () => actionsModule.remove(recipes, recipe.id));
      if (!result) return;
      // The operator may have moved on while the request was out (rows
      // stay clickable): only the recipe this answer is about is touched.
      const still = state.selectedId === recipe.id;
      if (state.confirm === confirm) state.confirm = null;
      if (result.ok) {
        if (confirm.kind === "load") setNote("ok", destination === "next" ? actionsModule.WORDING.loadedNext(recipe.name) : actionsModule.WORDING.loadedCurrent(recipe.name));
        else if (confirm.kind === "update") setNote("ok", actionsModule.WORDING.updated(recipe.name));
        else { setNote("ok", actionsModule.WORDING.deleted(recipe.name)); if (still) state.selectedId = null; }
      } else {
        setNote("error", result.message || "The application refused the change.");
        if (result.code === "not_found" && still) state.selectedId = null;
      }
      paintAll();
    }

    async function refreshBook() {
      const result = await ask("refresh", () => actionsModule.refreshBook(recipes));
      if (result && !result.ok) { setNote("error", result.message || "The line's recipes could not be refreshed."); paintAll(); }
    }

    /* ---- Painting ---- */

    function withhold(button, control) {
      const can = able()[control];
      button.setAttribute("data-able", can ? "true" : "false");
      button.setAttribute("title", can ? "" : `Unavailable: ${why(control)}`);
      if (state.pending) button.setAttribute("disabled", "");
      else button.removeAttribute("disabled");
    }

    function paintBar() {
      subtitle.textContent = subtitleFor(state.book, connected());
      withhold(barButtons["save-current"], "saveCurrent");
      withhold(barButtons["save-next"], "saveNext");
      withhold(barButtons.refresh, "refresh");
      const refreshing = !!(state.book && state.book.refreshing);
      barButtons.refresh.classList.toggle("is-busy", refreshing);
      barButtons.refresh.textContent = refreshing ? "Refreshing…" : "Refresh";
      if (refreshing) barButtons.refresh.setAttribute("disabled", "");
      for (const button of [entryConfirm, entryReplace, entryCancel]) {
        if (state.pending) button.setAttribute("disabled", "");
        else button.removeAttribute("disabled");
      }
    }

    function paintList() {
      clear(list);
      const book = state.book;
      const items = connected() && book && Array.isArray(book.recipes) ? book.recipes : [];
      if (items.length === 0) {
        list.appendChild(text(doc, "li", "slate-book__empty", emptyText(book, connected())));
        return;
      }
      for (const recipe of items) {
        const item = element(doc, "li", "slate-book__item");
        const row = element(doc, "button", "slate-book__row", { type: "button", "data-recipe": recipe.id, "aria-pressed": recipe.id === state.selectedId ? "true" : "false" });
        if (recipe.favorite) { row.classList.add("is-favorite"); row.setAttribute("aria-label", `${recipe.name}, favourite`); }
        row.appendChild(text(doc, "span", "slate-book__star", recipe.favorite ? "★" : "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "slate-book__row-name", recipe.name));
        row.appendChild(text(doc, "span", "slate-book__row-meta", rowMeta(recipe)));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function toneFor(layerName, index, count) {
      const model = state.resolved && state.resolved.line;
      const known = model ? model.layers.find(layer => layer.id === layerName) : null;
      if (known) return known.tone;
      return lineModule.roleTone(lineModule.roleForStackIndex(index, count));
    }

    /* A button of the detail card; every one waits while a request is out. */
    function actionButton(label, action, className, extra) {
      const button = text(doc, "button", `slate-book__action ${className || ""}`.trim(), label, Object.assign({ type: "button", "data-book-action": action }, extra || {}));
      if (state.pending) button.setAttribute("disabled", "");
      return button;
    }

    function paintDetail() {
      clear(detail);
      const recipe = selected();
      if (!recipe) {
        detail.appendChild(text(doc, "p", "slate-book__hint", SELECT_HINT));
        return;
      }
      const can = able();
      const model = state.resolved && state.resolved.line;
      const compat = compatibility(recipe, model);
      detail.appendChild(text(doc, "h2", "slate-book__detail-name", recipe.name));
      if (!compat.ok) detail.appendChild(text(doc, "p", "slate-book__compat", compat.message, { "data-kind": "incompatible" }));

      const actions = element(doc, "div", "slate-book__actions");
      const load = actionButton("Load", "load", state.confirm ? "" : "slate-book__action--primary");
      const update = actionButton("Update", "update", "");
      const more = actionButton("More…", "more", "slate-book__action--quiet", { "aria-expanded": state.moreOpen ? "true" : "false" });
      for (const [button, control] of [[load, "load"], [update, "update"]]) withhold(button, control);
      actions.appendChild(load);
      actions.appendChild(update);
      actions.appendChild(more);
      detail.appendChild(actions);

      const overflow = element(doc, "div", "slate-book__overflow", state.moreOpen ? {} : { hidden: "" });
      for (const [label, action, control, className] of [["Rename", "rename", "rename", ""], ["Duplicate", "duplicate", "duplicate", ""], ["Delete", "delete", "remove", "slate-book__action--danger"]]) {
        const button = actionButton(label, action, className);
        withhold(button, control);
        overflow.appendChild(button);
      }
      detail.appendChild(overflow);

      if (state.confirm && state.confirm.id === recipe.id) {
        const box = element(doc, "div", "slate-book__confirm", { role: "group", "data-kind": state.confirm.kind });
        if (state.confirm.kind === "load") {
          let wording = `${recipe.name}. ${LOAD_CURRENT_TEXT} ${LOAD_NEXT_TEXT}`;
          if (compat.lineType > 0 && compat.layerCount > 0 && compat.lineType !== compat.layerCount) wording += ` This recipe changes the line type from ${compat.layerCount} to ${compat.lineType}.`;
          box.appendChild(text(doc, "p", "slate-book__confirm-text", wording));
          const current = compat.ok ? previewFor(recipe, state.resolved, "current") : null;
          box.appendChild(text(doc, "p", "slate-book__preview", `Into Current: ${compat.ok ? (current ? current.text : "no line to compare with") : compat.message}`, { "data-destination": "current" }));
          const next = previewFor(recipe, state.resolved, "next");
          box.appendChild(text(doc, "p", "slate-book__preview", `Into Next: ${next ? (next.planned ? `replaces the plan — ${next.text}` : next.text) : "no line to compare with"}`, { "data-destination": "next" }));
          const buttons = element(doc, "div", "slate-book__confirm-actions");
          const intoCurrent = actionButton("Load into Current", "confirm-load", "slate-book__action--primary", { "data-destination": "current" });
          withhold(intoCurrent, "load");
          if (!compat.ok) { intoCurrent.setAttribute("disabled", ""); intoCurrent.setAttribute("title", compat.message); }
          const intoNext = actionButton("Load into Next", "confirm-load", "", { "data-destination": "next" });
          withhold(intoNext, "load");
          buttons.appendChild(intoCurrent);
          buttons.appendChild(intoNext);
          buttons.appendChild(actionButton("Cancel", "cancel-confirm", "slate-book__action--quiet"));
          box.appendChild(buttons);
        } else {
          const wording = state.confirm.kind === "update"
            ? `Replace “${recipe.name}” with the running recipe? This will save line type, layer percentages, resin assignments and hopper percentages. It will not save receiver weights, tracking, pump-off, timeline or runtime state.`
            : `Delete “${recipe.name}” from this line's shared recipes?`;
          box.appendChild(text(doc, "p", "slate-book__confirm-text", wording));
          const buttons = element(doc, "div", "slate-book__confirm-actions");
          const go = actionButton(state.confirm.kind === "update" ? "Update" : "Delete", "confirm", state.confirm.kind === "update" ? "slate-book__action--primary" : "slate-book__action--danger");
          withhold(go, state.confirm.kind === "update" ? "update" : "remove");
          buttons.appendChild(go);
          buttons.appendChild(actionButton("Cancel", "cancel-confirm", "slate-book__action--quiet"));
          box.appendChild(buttons);
        }
        detail.appendChild(box);
      }

      // The blend: the recipe's own layers, A, B, C...
      const layersEl = element(doc, "div", "slate-book__layers");
      const layers = (Array.isArray(recipe.layers) ? recipe.layers : []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      layers.forEach((layer, index) => {
        const row = element(doc, "div", "slate-book__layer", { "data-layer": layer.name, "data-tone": toneFor(layer.name, index, layers.length) });
        row.appendChild(text(doc, "span", "slate-book__layer-id", layer.name));
        row.appendChild(text(doc, "span", "slate-book__layer-share", layer.layerPct > 0 ? `${round(layer.layerPct)}%` : "—"));
        const hoppers = element(doc, "span", "slate-book__hoppers");
        const assigned = (Array.isArray(layer.hoppers) ? layer.hoppers : []).filter(hopper => hopper.resinName || hopper.pct > 0);
        if (!assigned.length) hoppers.appendChild(text(doc, "span", "slate-book__hopper slate-book__hopper--none", "no hoppers assigned"));
        for (const hopper of assigned) {
          const chip = element(doc, "span", "slate-book__hopper");
          chip.appendChild(text(doc, "span", "slate-book__hopper-id", lineModule.hopperId(layer.name, hopper.index, recipe.hopperNamingMode)));
          chip.appendChild(text(doc, "span", "slate-book__hopper-resin", hopper.resinName || "no resin"));
          chip.appendChild(text(doc, "span", "slate-book__hopper-pct", `${round(hopper.pct)}%`));
          hoppers.appendChild(chip);
        }
        row.appendChild(hoppers);
        layersEl.appendChild(row);
      });
      detail.appendChild(layersEl);
    }

    function paintAll() {
      paintBar();
      paintList();
      paintDetail();
    }

    /* ---- Inputs ---- */

    function updateBook() {
      state.book = recipes && typeof recipes.getBook === "function" ? recipes.getBook() : null;
      if (state.selectedId && !selected()) {
        state.selectedId = null;
        state.confirm = null;
        state.moreOpen = false;
        if (state.entry && state.entry.mode !== "save") closeEntry();
      }
      paintAll();
    }

    function update(resolved) {
      state.resolved = resolved;
      paintBar();
      paintDetail();
    }

    /* A read-only flip: an entry or a confirm whose ability is gone closes. */
    function refresh() {
      const can = able();
      if (state.entry && !(state.entry.mode === "save" ? (state.entry.which === "next" ? can.saveNext : can.saveCurrent) : can[state.entry.mode])) closeEntry();
      if (state.confirm && !can.load && !can.update && !can.remove) state.confirm = null;
      paintAll();
    }

    /* ---- Clicks ---- */

    rootEl.addEventListener("click", event => {
      const target = event && event.target;
      if (!target || typeof target.closest !== "function") return;
      const row = target.closest("[data-recipe]");
      if (row && list.contains(row)) {
        const id = row.getAttribute("data-recipe");
        state.selectedId = state.selectedId === id ? null : id;
        state.confirm = null;
        state.moreOpen = false;
        if (state.entry && state.entry.mode !== "save") closeEntry();
        paintList();
        paintDetail();
        return;
      }
      const button = target.closest("[data-book-action]");
      if (!button || !rootEl.contains(button) || button.hasAttribute("disabled")) return;
      const action = button.getAttribute("data-book-action");
      const control = { "save-current": "saveCurrent", "save-next": "saveNext", refresh: "refresh", load: "load", update: "update", rename: "rename", duplicate: "duplicate", delete: "remove", "confirm-load": "load", replace: "replace" }[action];
      if (control && button.getAttribute("data-able") === "false") { say(`${button.textContent} is unavailable: ${why(control)}`); return; }
      const recipe = selected();
      switch (action) {
        case "save-current": openEntry("save", "current", null); break;
        case "save-next": openEntry("save", "next", null); break;
        case "refresh": refreshBook(); break;
        case "confirm-entry": confirmEntry(); break;
        case "replace": replaceExisting(); break;
        case "cancel-entry": closeEntry(); paintAll(); break;
        case "load": if (recipe) openConfirm("load", recipe.id); break;
        case "update": if (recipe) openConfirm("update", recipe.id); break;
        case "more": state.moreOpen = !state.moreOpen; paintDetail(); break;
        case "rename": if (recipe) openEntry("rename", null, recipe.id); break;
        case "duplicate": if (recipe) openEntry("duplicate", null, recipe.id); break;
        case "delete": if (recipe) openConfirm("delete", recipe.id); break;
        case "confirm-load": confirmAction(button.getAttribute("data-destination") === "next" ? "next" : "current"); break;
        case "confirm": confirmAction(); break;
        case "cancel-confirm": closeConfirm(); break;
        default: break;
      }
    });

    nameInput.addEventListener("keydown", event => {
      if (!event) return;
      if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); confirmEntry(); }
      else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeEntry(); paintAll(); }
    });
    rootEl.addEventListener("keydown", event => {
      if (!event || event.key !== "Escape") return;
      if (state.confirm || state.moreOpen) { state.confirm = null; state.moreOpen = false; paintDetail(); if (typeof event.stopPropagation === "function") event.stopPropagation(); }
    });

    if (recipes && typeof recipes.subscribe === "function") recipes.subscribe(updateBook);
    updateBook();

    return Object.freeze({
      element: rootEl,
      update,
      refresh,
      updateBook,
      select(id) { state.selectedId = id; state.confirm = null; paintList(); paintDetail(); },
      getState: () => ({ selectedId: state.selectedId, entry: state.entry, confirm: state.confirm, pending: state.pending, note: state.note, noteKind: state.noteKind }),
      onHide() { closeEntry(); state.confirm = null; state.moreOpen = false; paintAll(); }
    });
  }

  return Object.freeze({ LOAD_CURRENT_TEXT, LOAD_NEXT_TEXT, SELECT_HINT, NOTHING_PLANNED, NOTHING_CHANGES, formatWhen, rowMeta, emptyText, subtitleFor, compatibility, previewFor, create });
});
