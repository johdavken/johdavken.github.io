/* Weights: the Operator Handbook's page for the physical hoppers.
 *
 * WHAT IT IS
 *
 * The receiver weight of every hopper on the line, by layer, each in a
 * field the operator can set; a bulk apply - pick hoppers, type one
 * weight, apply it to all of them at once; and the line's shared
 * Receiver Weight Profiles: the list, a selected profile's weights
 * against the line's, and Load, Save Current Weights, Update, Rename,
 * Duplicate and Delete. The floor UI's Weights page, on the bench.
 *
 * A receiver weight is a fact about the physical hopper, not about the
 * recipe running in it: Hopper 1 has one like any other, an empty hopper
 * has one, and the planned recipe has none. So this page edits the
 * running line only, and a profile changes receiver weights only - never
 * a resin, a blend, a layer share, tracking or pump state.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * The weights come from the boot file's resolved source (station-source.js:
 * hopperState[layer:index].weight, the application's own entered value
 * off the state bridge) and the hoppers from its line model; a publish
 * replaces both and the page is redrawn from them. A weight is written by
 * ONE command each - setHopperWeight, or setHopperWeights for the bulk
 * apply - dispatched on the command bridge this page is handed, which is
 * the application's own field tail: validated, saved, synced. The
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
 * Presentation state only, and only for this screen: the field being
 * edited and the value it started from, which hoppers are picked for the
 * bulk apply, which profile is selected, which entry or confirmation is
 * open, a request in flight, the last message.
 *
 * A REMOTE CHANGE UNDER AN OPEN FIELD
 *
 * The Handbook redraws this page on every publish - the run-down clock's
 * included - so update() patches values in place and never writes into
 * the field the operator is typing in. If that field's own value moved
 * underneath (another device set it), the field is marked and the page
 * says so; what the operator is entering is theirs until they commit or
 * cancel it. The focus editor's rule, kept here for the same reason.
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
  const CHIP = "station-handbook__chip";

  const COMMAND = Object.freeze({ one: "setHopperWeight", many: "setHopperWeights" });

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

  function pressed(node, on) {
    node.setAttribute("aria-pressed", on ? "true" : "false");
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

  /* A weight as the field shows it: the number as entered, blank for none.
   * No separator - the field is for typing, the readouts are for reading. */
  function fieldText(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(number) : "";
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

  /* Whether a command is on offer from the bridge this page was handed -
   * the same question Resin Totals asks, asked the same way. */
  function able(commands, name) {
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable()
      && typeof commands.capabilities === "function" && commands.capabilities().includes(name));
  }

  function reason(commands, name) {
    if (!commands || typeof commands.isAvailable !== "function" || !commands.isAvailable()) return "no application is connected to Station commands.";
    if (!able(commands, name)) return `the application does not support ${name}.`;
    return "";
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
   * @param {function} [context.commands]  () => the command bridge for what
   *        is on screen, or null when nothing may be written
   * @param {function} [context.onCommitted]  (result) => void, told of every
   *        command that changed something
   * @param {function} [context.layerRole]  (name) => the role of that layer
   *        on the shown line, for the accents
   */
  function create(doc, context) {
    const settings = context || {};
    const weightProfiles = settings.weightProfiles || null;
    const resolved = typeof settings.resolved === "function" ? settings.resolved : () => null;
    const modelOf = typeof settings.model === "function" ? settings.model : () => null;
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const layerRole = typeof settings.layerRole === "function" ? settings.layerRole : null;
    const lineModel = settings.lineModel || lineModelModule;

    const state = {
      shape: null,         // the hoppers drawn, as a key; a change rebuilds the grid
      editing: null,       // { key, base } while a field has focus
      committing: null,    // the key whose value the operator just sent
      picked: new Set(),   // hopper keys picked for the bulk apply
      selectedId: null,
      entry: null,         // { mode: "save" | "rename" | "duplicate", id }
      confirm: null,       // { kind: "load" | "update" | "delete", id }
      moreOpen: false,
      pending: null,
      note: "",
      noteKind: "",
      duplicate: null      // { name, id } after a duplicate_name on save
    };
    const fields = new Map();   // key -> { input, pick, layer, index, id }
    const layerPicks = new Map();

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

    /* ---- The scrolling body: the grid, the bulk bar, the profiles ---- */
    const body = element(doc, "div", "station-weights__body");
    rootEl.appendChild(body);

    const grid = element(doc, "section", "station-weights__grid", { "aria-label": "Receiver weights" });
    body.appendChild(grid);

    const bulk = element(doc, "div", "station-weights__bulk", { role: "group", "aria-label": "Bulk apply" });
    const allPick = text(doc, "button", CHIP, "All", { type: "button", "data-action": "pick-all", "aria-pressed": "false", title: "Pick every hopper" });
    const bulkCount = text(doc, "span", "station-weights__bulk-count", "Pick hoppers to set them together");
    const bulkWrap = element(doc, "span", "station-weights__field-wrap");
    const bulkInput = element(doc, "input", "station-weights__bulk-field", {
      type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
      "aria-label": "Weight to apply to the picked hoppers, pounds"
    });
    bulkWrap.appendChild(bulkInput);
    bulkWrap.appendChild(text(doc, "span", "station-weights__unit", "lb"));
    const applyButton = text(doc, "button", ACTION, "Apply", { type: "button", "data-action": "apply-bulk" });
    const clearPicksButton = text(doc, "button", QUIET, "Clear", { type: "button", "data-action": "clear-picks", hidden: "" });
    bulk.appendChild(allPick); bulk.appendChild(bulkCount); bulk.appendChild(bulkWrap);
    bulk.appendChild(applyButton); bulk.appendChild(clearPicksButton);
    body.appendChild(bulk);

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

    /* ---- The grid ---- */

    function shapeOf(model) {
      if (!model || !Array.isArray(model.layers)) return "";
      return model.layers.map(layer => `${layer.id}:${layer.hoppers.map(h => h.id).join(",")}`).join("|");
    }

    function buildGrid(model) {
      clearChildren(grid);
      fields.clear();
      layerPicks.clear();
      state.picked.clear();
      if (state.editing) state.editing = null;
      if (!model || !Array.isArray(model.layers) || !model.layers.length) {
        grid.appendChild(text(doc, "p", "station-weights__empty", "No line is shown: there are no hoppers to weigh."));
        return;
      }
      for (const layer of model.layers) {
        const row = element(doc, "div", "station-weights__layer", { "data-layer": layer.id, "data-layer-role": roleOf(layer) });
        const layerPick = text(doc, "button", `${CHIP} station-weights__layer-id`, layer.id, {
          type: "button", "data-pick-layer": layer.id, "aria-pressed": "false", title: `Pick every hopper of layer ${layer.id}`
        });
        row.appendChild(layerPick);
        layerPicks.set(layer.id, layerPick);
        const hoppers = element(doc, "div", "station-weights__hoppers");
        for (const hopper of layer.hoppers) {
          const key = `${layer.id}:${hopper.index}`;
          const cell = element(doc, "div", "station-weights__hopper", { "data-key": key });
          const pick = text(doc, "button", `${CHIP} station-weights__pick`, hopper.id, {
            type: "button", "data-pick": key, "aria-pressed": "false", title: `Pick ${hopper.id} for the bulk apply`
          });
          const wrap = element(doc, "span", "station-weights__field-wrap");
          const input = element(doc, "input", "station-weights__field", {
            type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
            "data-layer": layer.id, "data-index": hopper.index, "data-key": key,
            "aria-label": `${hopper.id} receiver weight, pounds`
          });
          input.value = fieldText(weightOf(key));
          wrap.appendChild(input);
          wrap.appendChild(text(doc, "span", "station-weights__unit", "lb"));
          cell.appendChild(pick); cell.appendChild(wrap);
          hoppers.appendChild(cell);
          fields.set(key, { input, pick, cell, layer: layer.id, index: hopper.index, id: hopper.id });
          wireField(input, key);
        }
        row.appendChild(hoppers);
        grid.appendChild(row);
      }
    }

    function wireField(input, key) {
      input.addEventListener("focus", () => {
        if (input.readOnly) return;
        state.editing = { key, base: fieldText(weightOf(key)) };
        input.classList.remove("is-changed-underneath");
      });
      input.addEventListener("input", () => {
        input.removeAttribute("aria-invalid");
      });
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          commitField(key);
        } else if (event.key === "Escape") {
          // The draft is the operator's to discard; the Handbook's own
          // Escape (close) is not what a field's Escape means.
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          if (typeof event.preventDefault === "function") event.preventDefault();
          cancelField(key);
        }
      });
      input.addEventListener("blur", () => {
        if (state.editing && state.editing.key === key) {
          commitField(key);
          state.editing = null;
          input.classList.remove("is-changed-underneath");
        }
      });
    }

    /* ---- Writing a weight ---- */

    function send(command, args) {
      const commands = commandsFor();
      const result = commands && typeof commands.dispatch === "function"
        ? commands.dispatch(command, Object.assign({ recipe: "current" }, args))
        : { ok: false, code: "unavailable", message: "No application is connected to Station commands." };
      return result || { ok: false, code: "failed", message: "The application did not answer." };
    }

    /* One field's value to the application, on Enter or on leaving it: the
     * same text unchanged is nothing to send; blank is 0, as the floor
     * UI's own field reads an emptied value; a refusal keeps the draft. */
    function commitField(key) {
      const field = fields.get(key);
      if (!field || field.input.readOnly) return null;
      const draft = String(field.input.value || "").trim();
      const resting = fieldText(weightOf(key));
      if (draft === resting) {
        field.input.removeAttribute("aria-invalid");
        return null;
      }
      const result = send(COMMAND.one, { layer: field.layer, index: field.index, weight: draft === "" ? 0 : draft });
      if (!result.ok) {
        field.input.setAttribute("aria-invalid", "true");
        say(result.message || "The weight could not be set.", "error");
        return result;
      }
      field.input.removeAttribute("aria-invalid");
      field.input.classList.remove("is-changed-underneath");
      if (result.changed) {
        state.committing = key;
        say("");
        onCommitted(result);
        state.committing = null;
        // Whether or not a publish came back through update(), the field
        // now shows the line's value and the draft starts from it.
        field.input.value = fieldText(weightOf(key));
        if (state.editing && state.editing.key === key) state.editing.base = field.input.value;
      } else {
        field.input.value = resting;
      }
      return result;
    }

    function cancelField(key) {
      const field = fields.get(key);
      if (!field) return;
      const base = state.editing && state.editing.key === key ? state.editing.base : fieldText(weightOf(key));
      const hadDraft = String(field.input.value || "").trim() !== base;
      field.input.value = fieldText(weightOf(key));
      if (state.editing && state.editing.key === key) state.editing.base = field.input.value;
      field.input.removeAttribute("aria-invalid");
      field.input.classList.remove("is-changed-underneath");
      if (!hadDraft && typeof field.input.blur === "function") field.input.blur();
    }

    /* ---- The bulk apply ---- */

    function pickedKeys() {
      return [...fields.keys()].filter(key => state.picked.has(key));
    }

    function togglePick(key) {
      if (!fields.has(key)) return;
      if (state.picked.has(key)) state.picked.delete(key);
      else state.picked.add(key);
      refresh();
    }

    function pickLayer(layerId) {
      const keys = [...fields.values()].filter(field => field.layer === layerId).map(field => `${field.layer}:${field.index}`);
      const every = keys.length > 0 && keys.every(key => state.picked.has(key));
      for (const key of keys) {
        if (every) state.picked.delete(key);
        else state.picked.add(key);
      }
      refresh();
    }

    function pickAll() {
      const keys = [...fields.keys()];
      const every = keys.length > 0 && keys.every(key => state.picked.has(key));
      state.picked.clear();
      if (!every) for (const key of keys) state.picked.add(key);
      refresh();
    }

    function clearPicks() {
      state.picked.clear();
      refresh();
    }

    function applyBulk() {
      const keys = pickedKeys();
      if (!keys.length) {
        say("Pick the hoppers to set first.", "error");
        return null;
      }
      const draft = String(bulkInput.value || "").trim();
      if (draft === "") {
        bulkInput.setAttribute("aria-invalid", "true");
        say("Enter the weight to apply to the picked hoppers (0 clears them).", "error");
        return null;
      }
      const weights = keys.map(key => {
        const field = fields.get(key);
        return { layer: field.layer, index: field.index, weight: draft };
      });
      const result = send(COMMAND.many, { weights });
      if (!result.ok) {
        bulkInput.setAttribute("aria-invalid", "true");
        say(result.message || "The weights could not be set.", "error");
        return result;
      }
      bulkInput.removeAttribute("aria-invalid");
      const count = keys.length;
      const applied = Number(draft.replace(/,/g, ""));
      if (result.changed) onCommitted(result);
      state.picked.clear();
      bulkInput.value = "";
      say(result.changed
        ? `Applied ${applied > 0 ? formatPounds(applied) : "0"} lb to ${count} hopper${count === 1 ? "" : "s"}.`
        : `The picked hopper${count === 1 ? " already has" : "s already have"} that weight.`, result.changed ? "ok" : "");
      refresh();
      return result;
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
      const commands = commandsFor();
      const canEdit = able(commands, COMMAND.one);
      const canBulk = able(commands, COMMAND.many);

      const shape = shapeOf(model);
      if (shape !== state.shape) {
        state.shape = shape;
        buildGrid(model);
      }

      // Values in place: every field but the one being typed in.
      for (const [key, field] of fields) {
        const canonical = fieldText(weightOf(key));
        const active = state.editing && state.editing.key === key;
        if (!active) {
          if (field.input.value !== canonical) field.input.value = canonical;
          field.input.classList.remove("is-changed-underneath");
        } else if (state.committing === key) {
          field.input.value = canonical;
          state.editing.base = canonical;
          field.input.classList.remove("is-changed-underneath");
        } else if (canonical !== state.editing.base) {
          if (!field.input.classList.contains("is-changed-underneath")) {
            field.input.classList.add("is-changed-underneath");
            say(`${field.id}'s weight is now ${formatPounds(canonical)} lb in the application; what you are entering has not been applied.`, "");
          }
        }
        field.input.readOnly = !canEdit;
        field.input.setAttribute("aria-disabled", canEdit ? "false" : "true");
        field.input.setAttribute("title", canEdit ? `${field.id} receiver weight, pounds` : `Weights are read-only here: ${reason(commands, COMMAND.one)}`);
        const picked = state.picked.has(key);
        pressed(field.pick, picked);
        field.pick.disabled = !canBulk;
        field.cell.classList.toggle("is-picked", picked);
      }
      for (const [layerId, pick] of layerPicks) {
        const keys = [...fields.values()].filter(field => field.layer === layerId).map(field => `${field.layer}:${field.index}`);
        pressed(pick, keys.length > 0 && keys.every(key => state.picked.has(key)));
        pick.disabled = !canBulk;
      }
      const pickedCount = state.picked.size;
      const total = fields.size;
      pressed(allPick, total > 0 && pickedCount === total);
      allPick.disabled = !canBulk || !total;
      bulkCount.textContent = !canBulk
        ? `Bulk apply is not available: ${reason(commands, COMMAND.many)}`
        : (pickedCount ? `${pickedCount} of ${total} picked` : "Pick hoppers to set them together");
      bulkInput.readOnly = !canBulk;
      applyButton.disabled = !canBulk || !pickedCount || !!state.pending;
      applyButton.classList.toggle("is-primary", canBulk && pickedCount > 0 && !state.entry && !state.confirm);
      show(clearPicksButton, pickedCount > 0);

      contextLabel.textContent = assigned && current.workspace
        ? `${current.workspace.displayName} · ${current.count} profile${current.count === 1 ? "" : "s"}`
        : (on ? "No line" : "Not connected");
      saveButton.disabled = !on || !assigned || !!state.pending;
      saveButton.classList.toggle("is-primary", !state.entry && !state.confirm && !(canBulk && pickedCount > 0));
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
      const target = event.target && event.target.closest ? event.target.closest("[data-action], [data-profile], [data-pick], [data-pick-layer]") : null;
      if (!target || target.disabled) return;
      const pick = target.getAttribute("data-pick");
      if (pick) { togglePick(pick); return; }
      const pickLayerId = target.getAttribute("data-pick-layer");
      if (pickLayerId) { pickLayer(pickLayerId); return; }
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
        case "pick-all": pickAll(); return;
        case "clear-picks": clearPicks(); return;
        case "apply-bulk": applyBulk(); return;
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
    bulkInput.addEventListener("keydown", event => {
      if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); applyBulk(); }
      else if (event.key === "Escape") {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        bulkInput.value = ""; bulkInput.removeAttribute("aria-invalid");
      }
    });
    bulkInput.addEventListener("input", () => bulkInput.removeAttribute("aria-invalid"));
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
        let target = null;
        if (state.entry) target = nameInput;
        else {
          const first = fields.values().next();
          target = first && !first.done && !first.value.input.readOnly ? first.value.input : saveButton;
        }
        if (target && typeof target.focus === "function" && !target.disabled) target.focus();
      },
      /* A page of a grid and two lists, all of which scroll: the Handbook
       * may be raised for it. */
      grows: () => true,
      commitField,
      applyBulk,
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
        picked: [...state.picked],
        editing: state.editing ? Object.assign({}, state.editing) : null,
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
