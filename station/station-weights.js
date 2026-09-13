/* Weights: the Operator Handbook's page for the line's shared Receiver
 * Weight Profiles.
 *
 * WHAT IT IS
 *
 * The list of profiles, a selected profile's weights against the line's,
 * and Load, Save Current Weights, Update, Rename, Duplicate and Delete.
 * The floor UI's Weight Profiles block, on the bench. The weights
 * themselves are not entered here: the machine rail's Weights face turns
 * every layer to a weight card on the stage (station-weight-cards.js),
 * which is where a receiver weight - and, with Smart Hoppers on, a
 * hopper's geometry - is set. This page reads the line's weights only to
 * show a profile against them.
 *
 * A receiver weight is a fact about the physical hopper, not about the
 * recipe running in it: Hopper 1 has one like any other, an empty hopper
 * has one, and the planned recipe has none. So this page edits the
 * running line only, and a profile changes receiver weights only - never
 * a resin, a blend, a layer share, tracking or pump state.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * The line's weights come from the boot file's resolved source
 * (station-source.js: hopperState[layer:index].weight, the application's
 * own entered value off the state bridge) and the hoppers from its line
 * model; a publish replaces both and the page is redrawn from them.
 * Nothing here writes a weight: this page dispatches no command. The
 * profiles come from the book the application publishes through
 * station-weight-profiles-bridge.js, and every profile action goes back
 * through that bridge's request() to the application's own save, update,
 * load, rename, duplicate, delete and refresh - the same closures the
 * floor UI's Weight Profiles block runs. This file keeps no weight, no
 * profile list, no cache and no payload of its own, and knows nothing of
 * how a profile is stored or applied.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only, and only for this screen: which profile is
 * selected, which entry or confirmation is open, a request in flight, the
 * last message.
 */
(function (root, factory) {
  const lineModel = typeof require === "function"
    ? require("./station-line-model.js")
    : (root && root.PolynStationLineModel);
  const api = factory(lineModel);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationWeights = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (lineModelModule) {
  "use strict";

  const ID = "weights";
  const TITLE = "Weights";
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* The Handbook's control language (handbook.css): action (is-primary,
   * is-quiet, is-danger), utility, chip. Nothing else here decides how a
   * button looks. */
  const ACTION = "station-handbook__action";
  const PRIMARY = `${ACTION} is-primary`;
  const QUIET = `${ACTION} is-quiet`;
  const DANGER = `${ACTION} is-danger`;

  /* The confirmation before a profile is loaded: the floor UI's own words,
   * which say what changes and what does not. */
  const LOAD_TEXT = "This will change receiver hopper weights only. It will not change line type, layer percentages, resin assignments, hopper blend percentages, tracking, pump-off state, timeline/runtime state, workspace, or RT Sync state.";
  const GEOMETRY_TEXT = "This profile also carries hopper geometry (usable heights), which will change too.";

  /* ---- DOM helpers ---- */

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

  /* The refresh arrow, as the Recipe Book draws it. */
  function glyph(doc) {
    const svg = svgNode(doc, "svg", "station-handbook__glyph", {
      viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.2 8.6 A 5.2 5.2 0 1 1 11.9 4.3" }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.4 2.6 L 13.4 5.8 L 10.2 5.8" }));
    return svg;
  }

  /* ---- Words and numbers ---- */

  /** Pounds for reading: whole, grouped; "—" for none. */
  function formatPounds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number).toLocaleString("en-US") : "—";
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

  /* The same rule the service applies to a name before comparing two. Used
   * only to find which profile a duplicate_name refers to. */
  function normalizedName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  /** One line per row: the profile's layer count and when it was updated. */
  function rowMeta(profile) {
    const layers = Array.isArray(profile.layers) ? profile.layers.length : 0;
    const parts = [`${layers} layer${layers === 1 ? "" : "s"}`];
    const when = formatWhen(profile.updatedAt);
    if (when) parts.push(when);
    return parts.join(" · ");
  }

  /* What the profile list says when it has nothing to list. */
  function emptyText(book, connected) {
    if (!connected) return "No application is connected to Station: weight profiles are not available here.";
    if (!book || !book.assigned) return "This desktop is not on a production line. Connect it through RT Sync to see the line's weight profiles.";
    if (book.refreshing && !book.count) return "Reading the line's weight profiles…";
    return "No weight profiles are saved for this line yet. Save Current Weights adds this line's receiver weights.";
  }

  /**
   * Whether a saved profile can be loaded onto the line the model
   * describes: the application refuses a profile saved for another line
   * type or layer layout before touching anything, and this says so
   * before the operator asks. Pure.
   *
   * @returns {{ ok: boolean, message: string }}
   */
  function compatibility(profile, model) {
    if (!profile) return { ok: false, message: "" };
    if (!model || !model.line || !Array.isArray(model.layers)) {
      return { ok: false, message: "No line is shown, so this profile cannot be loaded here." };
    }
    const lineType = Number(profile.lineType) || 0;
    const layerCount = Number(model.line.layerCount) || 0;
    if (lineType !== layerCount) {
      return { ok: false, message: `This profile is for a ${lineType}-layer line; this line runs ${layerCount}. It cannot be loaded here.` };
    }
    const saved = (Array.isArray(profile.layers) ? profile.layers : []).map(layer => String(layer.name || "")).sort();
    const shown = model.layers.map(layer => String(layer.id)).sort();
    if (saved.join(",") !== shown.join(",")) {
      return { ok: false, message: `This profile's layers (${saved.join(", ") || "none"}) are not this line's (${shown.join(", ")}). It cannot be loaded here.` };
    }
    return { ok: true, message: "" };
  }

  /**
   * Build the page.
   *
   * @param {Document} doc
   * @param {object} context
   * @param {object|null} context.weightProfiles  the weight-profiles bridge
   *        (getBook, isConnected, request). Handed in, never reached for.
   * @param {function} context.resolved  () => the boot file's resolved source
   *        (station-source.js): { live, hopperState }
   * @param {function} context.model     () => the boot file's line model
   *        (station-line-model.js), or null
   * @param {function} [context.layerRole]  (name) => the role of that layer
   *        on the shown line, for the accents
   */
  function create(doc, context) {
    const settings = context || {};
    const weightProfiles = settings.weightProfiles || null;
    const resolved = typeof settings.resolved === "function" ? settings.resolved : () => null;
    const modelOf = typeof settings.model === "function" ? settings.model : () => null;
    const layerRole = typeof settings.layerRole === "function" ? settings.layerRole : null;
    const lineModel = settings.lineModel || lineModelModule;

    const state = {
      selectedId: null,
      entry: null,         // { mode: "save" | "rename" | "duplicate", id }
      confirm: null,       // { kind: "load" | "update" | "delete", id }
      moreOpen: false,
      pending: null,
      note: "",
      noteKind: "",
      duplicate: null      // { name, id } after a duplicate_name on save
    };
    const rootEl = element(doc, "div", "station-weights", { "data-role": "weights" });

    /* ---- Toolbar ---- */
    const toolbar = element(doc, "div", "station-weights__toolbar");
    const saveButton = text(doc, "button", PRIMARY, "Save Current Weights", { type: "button", "data-action": "save-current" });
    const refreshButton = element(doc, "button", "station-handbook__utility", {
      type: "button", "data-action": "refresh", "aria-label": "Refresh", title: "Refresh the line's weight profiles"
    });
    refreshButton.appendChild(glyph(doc));
    const contextLabel = element(doc, "span", "station-weights__context");
    toolbar.appendChild(saveButton); toolbar.appendChild(refreshButton); toolbar.appendChild(contextLabel);
    rootEl.appendChild(toolbar);

    /* ---- A name, asked for in place: Save Current / Rename / Duplicate ---- */
    const entry = element(doc, "div", "station-weights__entry", { hidden: "" });
    const entryLabel = element(doc, "span", "station-weights__entry-label");
    const nameInput = element(doc, "input", "station-weights__name", {
      type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Profile name", "aria-label": "Profile name"
    });
    const confirmEntryButton = text(doc, "button", PRIMARY, "Save", { type: "button", "data-action": "confirm-entry" });
    const replaceButton = text(doc, "button", ACTION, "Replace existing", { type: "button", "data-action": "replace", hidden: "" });
    const cancelEntryButton = text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-entry" });
    entry.appendChild(entryLabel); entry.appendChild(nameInput); entry.appendChild(confirmEntryButton);
    entry.appendChild(replaceButton); entry.appendChild(cancelEntryButton);
    rootEl.appendChild(entry);

    const note = element(doc, "p", "station-weights__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    /* ---- The scrolling body: the profiles ---- */
    const body = element(doc, "div", "station-weights__body");
    rootEl.appendChild(body);

    const profiles = element(doc, "section", "station-weights__profiles", { "aria-label": "Weight profiles" });
    profiles.appendChild(text(doc, "h3", "station-weights__heading", "Weight Profiles"));
    const columns = element(doc, "div", "station-weights__columns");
    const list = element(doc, "ol", "station-weights__list", { "aria-label": "Saved weight profiles" });
    const detail = element(doc, "div", "station-weights__detail", { "aria-live": "polite" });
    columns.appendChild(list); columns.appendChild(detail);
    profiles.appendChild(columns);
    body.appendChild(profiles);

    /* ---- Reading ---- */

    function connected() {
      return !!(weightProfiles && typeof weightProfiles.isConnected === "function" && weightProfiles.isConnected());
    }

    function book() {
      return weightProfiles && typeof weightProfiles.getBook === "function" ? weightProfiles.getBook() : null;
    }

    function say(message, kind) {
      state.note = message || "";
      state.noteKind = state.note ? (kind || "") : "";
      note.textContent = state.note;
      note.setAttribute("data-kind", state.noteKind);
      show(note, !!state.note);
    }

    function hopperState() {
      const current = resolved();
      return current && current.hopperState ? current.hopperState : {};
    }

    function weightOf(key) {
      const runtime = hopperState()[key];
      const value = runtime ? Number(runtime.weight) : 0;
      return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function selectedProfile(current) {
      const items = current && Array.isArray(current.profiles) ? current.profiles : [];
      return items.find(profile => profile.id === state.selectedId) || null;
    }

    /* The layer's role for its accent: the line's own reading when the
     * boot file handed one in, else the model's own. */
    function roleOf(layer) {
      if (layerRole) {
        try {
          const role = layerRole(layer.id);
          if (typeof role === "string" && role) return role;
        } catch (error) { /* fall through */ }
      }
      return layer.role || "";
    }

    function roleOfName(name, index, count) {
      if (layerRole) {
        try {
          const role = layerRole(name);
          if (typeof role === "string" && role) return role;
        } catch (error) { /* fall through */ }
      }
      if (lineModel && typeof lineModel.roleForStackIndex === "function") {
        try { return lineModel.roleForStackIndex(index, count); } catch (error) { return ""; }
      }
      return "";
    }

    /* ---- The profiles ---- */

    function drawList(current) {
      clearChildren(list);
      const items = current && Array.isArray(current.profiles) ? current.profiles : [];
      if (!items.length) {
        list.appendChild(text(doc, "li", "station-weights__empty", emptyText(current, connected())));
        return;
      }
      for (const profile of items) {
        const item = element(doc, "li");
        const row = element(doc, "button", "station-weights__row", {
          type: "button", "data-profile": profile.id, "aria-pressed": profile.id === state.selectedId ? "true" : "false"
        });
        row.appendChild(text(doc, "span", "station-weights__row-name", profile.name));
        row.appendChild(text(doc, "span", "station-weights__row-meta", rowMeta(profile)));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawDetail(current, model) {
      clearChildren(detail);
      const profile = selectedProfile(current);
      if (!profile) {
        const items = current && Array.isArray(current.profiles) ? current.profiles : [];
        detail.appendChild(text(doc, "p", "station-weights__empty", items.length
          ? "Select a profile to see its weights against the line's. Selecting changes nothing on the line."
          : ""));
        return;
      }
      const busy = !!state.pending;
      const on = connected();
      detail.appendChild(text(doc, "h4", "station-weights__detail-name", profile.name));

      const compat = compatibility(profile, model);
      if (!compat.ok && compat.message) {
        detail.appendChild(text(doc, "p", "station-weights__compat", compat.message, { "data-kind": "incompatible" }));
      }
      if (profile.hasGeometry) {
        detail.appendChild(text(doc, "p", "station-weights__compat", GEOMETRY_TEXT, { "data-kind": "geometry" }));
      }

      /* Load leads; Update is the secondary; the rest wait behind More. */
      const actions = element(doc, "div", "station-weights__actions");
      const loadButton = text(doc, "button", PRIMARY, "Load", { type: "button", "data-action": "load" });
      loadButton.disabled = busy || !on || !compat.ok;
      loadButton.setAttribute("title", compat.ok ? "Set the line's receiver weights from this profile" : compat.message);
      const updateButton = text(doc, "button", ACTION, "Update", { type: "button", "data-action": "update", title: "Replace this profile with the line's current weights" });
      updateButton.disabled = busy || !on;
      const moreButton = text(doc, "button", QUIET, "More…", { type: "button", "data-action": "more", "aria-expanded": state.moreOpen ? "true" : "false" });
      moreButton.disabled = busy || !on;
      actions.appendChild(loadButton); actions.appendChild(updateButton); actions.appendChild(moreButton);
      detail.appendChild(actions);

      const overflow = element(doc, "div", "station-weights__overflow", { hidden: state.moreOpen ? null : "" });
      const renameButton = text(doc, "button", QUIET, "Rename", { type: "button", "data-action": "rename" });
      const duplicateButton = text(doc, "button", QUIET, "Duplicate", { type: "button", "data-action": "duplicate" });
      const deleteButton = text(doc, "button", DANGER, "Delete", { type: "button", "data-action": "delete" });
      renameButton.disabled = busy; duplicateButton.disabled = busy; deleteButton.disabled = busy;
      overflow.appendChild(renameButton); overflow.appendChild(duplicateButton); overflow.appendChild(deleteButton);
      detail.appendChild(overflow);

      /* The confirmation, in place, for the one action that is pending. */
      if (state.confirm && state.confirm.id === profile.id) {
        const confirm = element(doc, "div", "station-weights__confirm", { role: "group", "data-kind": state.confirm.kind });
        const words = state.confirm.kind === "load"
          ? `${profile.name}. ${LOAD_TEXT}${profile.hasGeometry ? ` ${GEOMETRY_TEXT}` : ""}`
          : state.confirm.kind === "update"
            ? `Replace “${profile.name}” with this line's current weights? This will save receiver hopper weights. It will not save recipe assignments, percentages, or runtime state.`
            : `Delete “${profile.name}” from this line's shared profiles?`;
        confirm.appendChild(text(doc, "p", "station-weights__confirm-text", words));
        const buttons = element(doc, "div", "station-weights__confirm-actions");
        const go = text(doc, "button", state.confirm.kind === "delete" ? DANGER : PRIMARY,
          state.confirm.kind === "load" ? "Load Weights" : state.confirm.kind === "update" ? "Update" : "Delete",
          { type: "button", "data-action": "confirm" });
        go.disabled = busy;
        const back = text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-confirm" });
        buttons.appendChild(go); buttons.appendChild(back);
        confirm.appendChild(buttons);
        detail.appendChild(confirm);
        // The primary of the page while the question is open.
        loadButton.classList.remove("is-primary");
      }

      /* The profile's weights against the line's, hopper by hopper, for
       * the hoppers this line has. A position that would change is marked
       * and shows both: the line's, then the profile's. */
      const layers = (Array.isArray(profile.layers) ? profile.layers : []).slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      const modelLayers = model && Array.isArray(model.layers) ? model.layers : [];
      const legend = element(doc, "p", "station-weights__legend");
      legend.textContent = compat.ok
        ? "Each hopper: the profile's weight; where the line's differs, the line's → the profile's."
        : "Each hopper: the profile's weight.";
      detail.appendChild(legend);
      layers.forEach((layer, index) => {
        const modelLayer = modelLayers.find(entry => entry.id === layer.name) || null;
        const row = element(doc, "div", "station-weights__profile-layer", {
          "data-layer": layer.name,
          "data-layer-role": modelLayer ? roleOf(modelLayer) : roleOfName(layer.name, index, layers.length)
        });
        row.appendChild(text(doc, "span", "station-weights__profile-layer-id", layer.name));
        const cells = element(doc, "span", "station-weights__profile-hoppers");
        const positions = modelLayer ? modelLayer.hoppers : (Array.isArray(layer.weights) ? layer.weights : []).map((_, i) => ({ index: i, id: `${layer.name}${i + 1}` }));
        for (const position of positions) {
          const saved = Array.isArray(layer.weights) ? Number(layer.weights[position.index]) || 0 : 0;
          const key = `${layer.name}:${position.index}`;
          const live = modelLayer ? weightOf(key) : saved;
          const cell = element(doc, "span", "station-weights__profile-hopper", { "data-changed": modelLayer && live !== saved ? "true" : "false" });
          cell.appendChild(text(doc, "span", "station-weights__profile-hopper-id", position.id));
          if (modelLayer && live !== saved) {
            cell.appendChild(text(doc, "span", "station-weights__profile-from", formatPounds(live)));
            cell.appendChild(text(doc, "span", "station-weights__profile-arrow", "→", { "aria-hidden": "true" }));
          }
          cell.appendChild(text(doc, "span", "station-weights__profile-to", formatPounds(saved)));
          cells.appendChild(cell);
        }
        row.appendChild(cells);
        detail.appendChild(row);
      });
      const stored = layers.reduce((sum, layer) => sum + (Array.isArray(layer.weights) ? layer.weights.length : 0), 0);
      const shown = modelLayers.reduce((sum, layer) => sum + layer.hoppers.length, 0);
      if (compat.ok && stored > shown) {
        detail.appendChild(text(doc, "p", "station-weights__legend", "Weights for positions not on this line are stored with the profile but not shown."));
      }
    }

    /* ---- Redraw ---- */

    function refresh() {
      const model = modelOf();
      const current = book();
      const on = connected();
      const assigned = !!(current && current.assigned);
      contextLabel.textContent = assigned && current.workspace
        ? `${current.workspace.displayName} · ${current.count} profile${current.count === 1 ? "" : "s"}`
        : (on ? "No line" : "Not connected");
      saveButton.disabled = !on || !assigned || !!state.pending;
      saveButton.classList.toggle("is-primary", !state.entry && !state.confirm && !selectedProfile(current));
      saveButton.setAttribute("title", !on
        ? "Saving is not available: no application is connected to Station."
        : (!assigned ? "Connect this desktop to a production line to save shared weight profiles." : "Save the line's receiver weights to this line's shared profiles."));
      const refreshing = !!(current && current.refreshing);
      refreshButton.disabled = !on || !assigned || !!state.pending || refreshing;
      refreshButton.setAttribute("aria-label", refreshing ? "Refreshing…" : "Refresh");
      refreshButton.setAttribute("title", refreshing ? "Refreshing the line's weight profiles…" : "Refresh the line's weight profiles");
      refreshButton.classList.toggle("is-busy", refreshing);

      show(entry, !!state.entry);
      confirmEntryButton.disabled = !!state.pending;
      replaceButton.disabled = !!state.pending;
      show(replaceButton, !!state.duplicate);

      if (state.selectedId && !selectedProfile(current)) {
        state.selectedId = null;
        state.confirm = null;
        state.moreOpen = false;
        if (state.entry && state.entry.mode !== "save") state.entry = null;
      }
      drawList(current);
      drawDetail(current, model);
    }

    /* ---- Entries and confirmations ---- */

    function openEntry(mode, profile) {
      state.entry = { mode, id: profile ? profile.id : null };
      state.confirm = null;
      state.duplicate = null;
      entryLabel.textContent = mode === "save" ? "Save the line's receiver weights as"
        : mode === "rename" ? `Rename “${profile.name}” to` : `Duplicate “${profile.name}” as`;
      confirmEntryButton.textContent = mode === "save" ? "Save" : mode === "rename" ? "Rename" : "Duplicate";
      nameInput.value = mode === "rename" ? profile.name : (mode === "duplicate" ? `${profile.name} copy` : "");
      nameInput.removeAttribute("aria-invalid");
      say("");
      refresh();
      if (typeof nameInput.focus === "function") nameInput.focus();
      if (typeof nameInput.select === "function") nameInput.select();
    }

    function closeEntry() {
      state.entry = null;
      state.duplicate = null;
      refresh();
    }

    function openConfirm(kind, profile) {
      state.confirm = { kind, id: profile.id };
      state.entry = null;
      state.duplicate = null;
      state.moreOpen = false;
      say("");
      refresh();
      const go = detail.querySelector ? detail.querySelector('[data-action="confirm"]') : null;
      if (go && typeof go.focus === "function") go.focus();
    }

    function closeConfirm() {
      state.confirm = null;
      refresh();
    }

    async function request(action, args) {
      if (!weightProfiles || typeof weightProfiles.request !== "function") {
        return { ok: false, code: "unavailable", message: "No application is connected to Station's weight profiles." };
      }
      state.pending = action;
      refresh();
      let result;
      try {
        result = await weightProfiles.request(action, args);
      } finally {
        state.pending = null;
      }
      return result || { ok: false, code: "failed", message: "The application did not answer." };
    }

    async function confirmEntry() {
      const pending = state.entry;
      if (!pending) return null;
      const name = String(nameInput.value || "").trim().replace(/\s+/g, " ");
      if (!name) {
        nameInput.setAttribute("aria-invalid", "true");
        say("Give the profile a name.", "error");
        return null;
      }
      nameInput.removeAttribute("aria-invalid");
      if (pending.mode === "save") return confirmSave(name);
      const action = pending.mode === "rename" ? "renameWeightProfile" : "duplicateWeightProfile";
      const result = await request(action, { id: pending.id, name });
      if (result.ok) {
        state.entry = null;
        if (pending.mode === "duplicate" && result.id) state.selectedId = result.id;
        say(pending.mode === "rename" ? `Renamed to “${name}”.` : `Duplicated as “${name}”.`, "ok");
      } else {
        if (result.code === "duplicate_name") nameInput.setAttribute("aria-invalid", "true");
        say(result.message || (pending.mode === "rename" ? "The profile could not be renamed." : "The profile could not be duplicated."), "error");
      }
      refresh();
      return result;
    }

    /* Save Current Weights: the name goes to the application as
     * saveCurrentWeights. A duplicate is the service's own answer; the
     * offer to replace the profile it collides with is made here and goes
     * back as replaceWeightProfile, by that profile's id. */
    async function confirmSave(name) {
      const result = await request("saveCurrentWeights", { name });
      if (result.ok) {
        state.selectedId = result.id || state.selectedId;
        state.entry = null;
        state.duplicate = null;
        say(`Saved “${name}” to this line's weight profiles.`, "ok");
        refresh();
        return result;
      }
      if (result.code === "duplicate_name") {
        const current = book();
        const existing = ((current && current.profiles) || []).find(profile => normalizedName(profile.name) === normalizedName(name)) || null;
        state.duplicate = { name, id: existing ? existing.id : null };
        if (existing) state.selectedId = existing.id;
        say(existing
          ? `A profile named “${existing.name}” already exists. Replace it with the line's current weights, or choose another name.`
          : "A profile with that name already exists. Choose another name.", "error");
        nameInput.setAttribute("aria-invalid", "true");
        refresh();
        return result;
      }
      say(result.message || "The weights could not be saved.", "error");
      refresh();
      return result;
    }

    async function replaceExisting() {
      const duplicate = state.duplicate;
      if (!duplicate || !duplicate.id) return null;
      const result = await request("replaceWeightProfile", { id: duplicate.id });
      if (result.ok) {
        state.selectedId = duplicate.id;
        state.entry = null;
        state.duplicate = null;
        say(`Replaced “${duplicate.name}” with the line's current weights.`, "ok");
      } else {
        say(result.message || "The profile could not be replaced.", "error");
      }
      refresh();
      return result;
    }

    /* The confirmed action: Load, Update or Delete, by the selected
     * profile's id. */
    async function confirmAction() {
      const pending = state.confirm;
      if (!pending) return null;
      const profile = selectedProfile(book());
      if (!profile || profile.id !== pending.id) { state.confirm = null; refresh(); return null; }
      const action = pending.kind === "load" ? "loadWeightProfile" : pending.kind === "update" ? "replaceWeightProfile" : "deleteWeightProfile";
      const result = await request(action, { id: profile.id });
      state.confirm = null;
      if (result.ok) {
        if (pending.kind === "delete") state.selectedId = null;
        say(pending.kind === "load" ? `Loaded “${profile.name}”: the line's receiver weights are set from it.`
          : pending.kind === "update" ? `Updated “${profile.name}” with the line's current weights.`
            : `Deleted “${profile.name}”.`, "ok");
      } else {
        say(result.message || (pending.kind === "load" ? "The profile could not be loaded."
          : pending.kind === "update" ? "The profile could not be updated." : "The profile could not be deleted."), "error");
      }
      refresh();
      return result;
    }

    async function refreshBook() {
      const result = await request("refresh");
      if (!result.ok) say(result.message || "The weight profiles could not be refreshed.", "error");
      else say("");
      refresh();
      return result;
    }

    /* ---- Events ---- */

    rootEl.addEventListener("click", event => {
      const target = event.target && event.target.closest ? event.target.closest("[data-action], [data-profile]") : null;
      if (!target || target.disabled) return;
      const profileId = target.getAttribute("data-profile");
      if (profileId) {
        // Selecting shows the profile and changes nothing on the line.
        state.selectedId = state.selectedId === profileId ? null : profileId;
        state.confirm = null;
        state.moreOpen = false;
        if (state.entry && state.entry.mode !== "save") state.entry = null;
        refresh();
        return;
      }
      const action = target.getAttribute("data-action");
      const profile = selectedProfile(book());
      switch (action) {
        case "save-current": openEntry("save", null); return;
        case "confirm-entry": void confirmEntry(); return;
        case "replace": void replaceExisting(); return;
        case "cancel-entry": closeEntry(); return;
        case "refresh": void refreshBook(); return;
        case "load": if (profile) openConfirm("load", profile); return;
        case "update": if (profile) openConfirm("update", profile); return;
        case "delete": if (profile) openConfirm("delete", profile); return;
        case "rename": if (profile) openEntry("rename", profile); return;
        case "duplicate": if (profile) openEntry("duplicate", profile); return;
        case "more": state.moreOpen = !state.moreOpen; refresh(); return;
        case "confirm": void confirmAction(); return;
        case "cancel-confirm": closeConfirm(); return;
        default: return;
      }
    });
    nameInput.addEventListener("keydown", event => {
      if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); void confirmEntry(); }
      else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeEntry(); }
    });
    detail.addEventListener("keydown", event => {
      if (event.key === "Escape" && state.confirm) {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        closeConfirm();
      }
    });

    refresh();

    return {
      element: rootEl,
      update: refresh,
      focus() {
        const target = state.entry ? nameInput : saveButton;
        if (target && typeof target.focus === "function" && !target.disabled) target.focus();
      },
      /* A page of two lists, both of which scroll: the Handbook may be
       * raised for it. */
      grows: () => true,
      confirmEntry,
      confirmAction,
      replaceExisting,
      refreshBook,
      select(id) { state.selectedId = id || null; state.confirm = null; refresh(); },
      getState: () => ({
        selectedId: state.selectedId,
        entry: state.entry ? Object.assign({}, state.entry) : null,
        confirm: state.confirm ? Object.assign({}, state.confirm) : null,
        moreOpen: state.moreOpen,
        pending: state.pending,
        note: state.note,
        noteKind: state.noteKind,
        duplicate: state.duplicate ? Object.assign({}, state.duplicate) : null
      })
    };
  }

  /* The section as the Handbook takes it. */
  const section = Object.freeze({ id: ID, title: TITLE, create });

  return Object.freeze({ ID, TITLE, section, create, compatibility, formatPounds, rowMeta, emptyText, normalizedName, LOAD_TEXT, GEOMETRY_TEXT });
});
