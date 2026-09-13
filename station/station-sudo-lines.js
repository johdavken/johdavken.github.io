/* Line Configuration: Sudo's second tool (station-sudo.js).
 *
 * WHAT IT IS
 *
 * The production lines' definitions, for an administrator: which lines
 * the plant has, and for each its number and names, how many layers it
 * runs, which side of the film Layer A is on, how its hoppers are named
 * and how they are measured. The same definitions the floor UI's Line
 * Configuration panel edits (line-configurations-ui.js), in the
 * Handbook's fixed bench: a narrow list of lines on the left, the chosen
 * line on the right as short aligned rows, each pane scrolling on its own.
 *
 * WHAT A LINE IS MADE OF
 *
 * A definition holds ONE orientation fact - Layer A's side, inside or
 * outside - and a layer count. Every layer's physical role follows from
 * those two: the layers are a stack, so once A's side is known the far
 * end is the other side and what lies between is core and subskins. The
 * roles here are drawn from the same derivation the stage draws its
 * banks from (station-line-model.js: roleForStackIndex) so the editor
 * and the machine can never disagree. The letters are the operator's
 * stable identifiers and are always listed A, B, C...; a line where A is
 * the inside lists A first all the same - the side is a fact on the
 * row, never the row's position. Choosing a side on either end row sets
 * that one fact; the rows between are read, not set.
 *
 * Hoppers are six a layer unless a layer says otherwise - most lines run
 * six on every layer, several run four on the core - so each layer row
 * asks for its count (1 to 6; six is the ceiling, line-identity's rule).
 * What a line chooses besides is how they are named - 1 to 6, or Main and
 * 1 to 5 - and the editor shows the ids that follow.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything comes through station-admin-bridge.js: the list is one
 * request (listLineConfigurations), a save is one (saveLineConfiguration)
 * carrying the definition, and the list is re-read after. The
 * application answers with its own Line Configuration service, whose
 * save validates through line-identity.js and re-reads the shared
 * definitions, which is how the change reaches the running application
 * and Station's own stage. Before asking, the editor validates the
 * definition by the same line-identity rules, against the other lines
 * it has read, so a refusal is said here first and nothing invalid is
 * sent; the service and the server say it again in their own words if
 * it slips past.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: the last answered list, which line is chosen,
 * the working copy of it while it is being edited (dirty until saved or
 * discarded), what the right pane is showing (the line, a confirmation),
 * whether maintenance is unfolded, a request in flight, the last
 * message. Nothing survives a lost session.
 */
(function (root, factory) {
  const lineModel = typeof require === "function"
    ? require("./station-line-model.js")
    : (root && root.PolynStationLineModel);
  // The validation rules and the layer names: shared modules the harness
  // and the host both load, taken as the line model takes them.
  const lineIdentity = typeof require === "function"
    ? safeRequire("../line-identity.js")
    : (root && root.PolynLineIdentity);
  const payloads = typeof require === "function"
    ? safeRequire("../workspace-configuration-payloads.js")
    : (root && root.PolynWorkspaceConfigurationPayloads);
  function safeRequire(id) { try { return require(id); } catch (error) { return null; } }
  const api = factory(lineModel, lineIdentity, payloads);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationSudoLines = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (lineModelModule, lineIdentityModule, payloadsModule) {
  "use strict";

  const ID = "lines";
  const TITLE = "Line Configuration";
  const LABEL = "Line Configuration";   // the word in Sudo's row of tools
  const SVG_NS = "http://www.w3.org/2000/svg";

  const ACTION = "station-handbook__action";
  const PRIMARY = `${ACTION} is-primary`;
  const QUIET = `${ACTION} is-quiet`;
  const DANGER = `${ACTION} is-danger`;
  const UTILITY = "station-handbook__utility";
  const CHIP = "station-handbook__chip";

  /* The choices a definition offers, in the words the floor UI's panel
   * uses. Layer counts are the three the application runs recipes for;
   * a line already defined with another count keeps it (see
   * layerCountChoices) rather than being quietly rewritten. */
  const LAYER_COUNTS = Object.freeze([1, 3, 5]);
  const SIDES = Object.freeze([
    Object.freeze({ value: "inside", label: "Inside" }),
    Object.freeze({ value: "outside", label: "Outside" })
  ]);
  const GEOMETRIES = Object.freeze([
    Object.freeze({ value: "cylindrical", label: "Cylindrical" }),
    Object.freeze({ value: "volume", label: "Volume" })
  ]);
  const NAMING_MODES = Object.freeze([
    Object.freeze({ value: "standard", label: "Standard" }),
    Object.freeze({ value: "main-plus-five", label: "Main + 1–5" })
  ]);
  /* Six per layer unless the line says otherwise; the ceiling is
   * line-identity's (MAX_HOPPERS_PER_LAYER), read from there when loaded. */
  const DEFAULT_HOPPERS_PER_LAYER = 6;
  function maxHoppersPerLayer() {
    const declared = lineIdentityModule && lineIdentityModule.MAX_HOPPERS_PER_LAYER;
    return Number.isInteger(declared) && declared > 0 ? declared : DEFAULT_HOPPERS_PER_LAYER;
  }

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

  function refreshGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-handbook__glyph", {
      viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.2 8.6 A 5.2 5.2 0 1 1 11.9 4.3" }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.4 2.6 L 13.4 5.8 L 10.2 5.8" }));
    return svg;
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  }

  function formatDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    } catch (error) {
      return date.toISOString().slice(0, 10);
    }
  }

  /* --------------------------------------------------------------------
   *   The definition: the fields, and what follows from them
   * ------------------------------------------------------------------ */

  function labelFor(choices, value) {
    const found = choices.find(choice => choice.value === value);
    return found ? found.label : "";
  }

  function positionLabel(value) {
    return value === "inside" ? "A Inside" : value === "outside" ? "A Outside" : "A N/A";
  }

  /** One line under a line's name in the list. */
  function rowMeta(line) {
    const parts = [plural(line.layerCount, "layer"), positionLabel(line.layerAPosition),
      labelFor(GEOMETRIES, line.hopperGeometry) || line.hopperGeometry, labelFor(NAMING_MODES, line.hopperNamingMode) || line.hopperNamingMode];
    if (!line.isActive) parts.push("Inactive");
    return parts.join(" · ");
  }

  /** The chosen line's summary: its number, when it last changed, aliases. */
  function detailMeta(line) {
    const parts = [`Line number ${line.lineNumber}`];
    const updated = formatDate(line.updatedAt);
    if (updated) parts.push(`Updated ${updated}`);
    if (line.aliases && line.aliases.length) parts.push(`Also ${line.aliases.join(", ")}`);
    return parts.join(" · ");
  }

  /* The letters, A upward, for a count: the payload module's names via
   * the line model, so the editor and a saved recipe agree. */
  function layerNames(layerCount) {
    if (lineModelModule && typeof lineModelModule.layerNames === "function") {
      return lineModelModule.layerNames(layerCount, payloadsModule);
    }
    return Array.from({ length: layerCount }, (_, index) => String.fromCharCode(65 + index));
  }

  function roleFor(stackIndex, layerCount) {
    if (lineModelModule && typeof lineModelModule.roleForStackIndex === "function") {
      return lineModelModule.roleForStackIndex(stackIndex, layerCount);
    }
    return "";
  }

  function roleLabel(role) {
    if (lineModelModule && typeof lineModelModule.roleLabel === "function") return lineModelModule.roleLabel(role);
    return role;
  }

  /**
   * The layer rows for a definition, in recipe order (A first, always),
   * each with the physical role that follows from Layer A's side. The
   * stack index is the same derivation station-line-model.js makes for
   * the banks: the recipe order reversed when A is the inside.
   *
   * @returns {Array<{ id, role, roleLabel, end }>}  `end` marks the two
   *          rows whose side can be chosen; null with no orientation.
   */
  function layerRows(layerCount, layerAPosition) {
    const count = Number(layerCount);
    if (!Number.isInteger(count) || count < 1) return [];
    const names = layerNames(count);
    if (count === 1) {
      return [{ id: names[0], role: "single", roleLabel: "Single layer", end: false, known: true }];
    }
    const known = layerAPosition === "inside" || layerAPosition === "outside";
    const reversed = layerAPosition === "inside";
    return names.map((name, recipeIndex) => {
      const stackIndex = reversed ? count - 1 - recipeIndex : recipeIndex;
      const role = known ? roleFor(stackIndex, count) : "";
      return {
        id: name,
        role,
        roleLabel: known ? roleLabel(role) : "Choose a side",
        end: recipeIndex === 0 || recipeIndex === count - 1,
        known
      };
    });
  }

  /* The side of one end row, as the chips on it read: A's side is the
   * definition's; the far end's is the opposite. */
  function sideOfRow(recipeIndex, layerCount, layerAPosition) {
    if (layerAPosition !== "inside" && layerAPosition !== "outside") return null;
    if (recipeIndex === 0) return layerAPosition;
    return layerAPosition === "inside" ? "outside" : "inside";
  }

  /* And the reverse: choosing a side on an end row sets Layer A's. */
  function layerAPositionFor(recipeIndex, side) {
    if (recipeIndex === 0) return side;
    return side === "inside" ? "outside" : "inside";
  }

  /* The hopper ids a layer gets, compactly: "A1–A6", "B1–B4", or
   * "AM, A1–A5". A count that is not a whole number yet (mid-typing)
   * reads as a question mark rather than as a range. */
  function hopperRange(layerName, namingMode, hopperCount) {
    const count = hopperCount === undefined ? DEFAULT_HOPPERS_PER_LAYER : Number(hopperCount);
    if (!Number.isInteger(count) || count < 1) return `${layerName}?`;
    if (namingMode === "main-plus-five") {
      if (count === 1) return `${layerName}M`;
      return `${layerName}M, ${layerName}1${count > 2 ? `–${layerName}${count - 1}` : ""}`;
    }
    return count === 1 ? `${layerName}1` : `${layerName}1–${layerName}${count}`;
  }

  /* `hopperCounts` is the draft's - one entry per layer, as typed. */
  function hopperSummary(layerCount, namingMode, hopperCounts) {
    const counts = Array.isArray(hopperCounts) ? hopperCounts : [];
    return layerNames(Number(layerCount) || 0).map((name, index) => hopperRange(name, namingMode, counts[index] === undefined ? DEFAULT_HOPPERS_PER_LAYER : counts[index])).join(" · ");
  }

  /* The draft's counts sized to a layer count: what was typed is kept,
   * a new layer starts at six, a dropped layer's count goes with it. */
  function hopperCountsFor(layerCount, hopperCounts) {
    const count = Number(layerCount);
    if (!Number.isInteger(count) || count < 1) return [];
    const given = Array.isArray(hopperCounts) ? hopperCounts : [];
    return Array.from({ length: count }, (_, index) => (given[index] === undefined || given[index] === null ? String(DEFAULT_HOPPERS_PER_LAYER) : String(given[index])));
  }

  /* The layer counts the editor offers: the three, plus the line's own
   * when it is another - kept, and shown, rather than rewritten. */
  function layerCountChoices(current) {
    const out = LAYER_COUNTS.slice();
    if (Number.isInteger(current) && current > 0 && !out.includes(current)) out.push(current);
    return out.sort((a, b) => a - b);
  }

  /* A working copy of a line, with the fields the editor sets. */
  function draftOf(line) {
    return {
      id: line ? line.id : "",
      lineNumber: line && line.lineNumber !== null ? String(line.lineNumber) : "",
      displayName: line ? line.displayName : "",
      aliases: line ? line.aliases.join(", ") : "",
      layerCount: line ? line.layerCount : 3,
      hopperCounts: hopperCountsFor(line ? line.layerCount : 3, line ? line.hopperCounts : null),
      layerAPosition: line ? line.layerAPosition : "outside",
      hopperGeometry: line ? line.hopperGeometry : "cylindrical",
      hopperNamingMode: line ? line.hopperNamingMode : "standard",
      isActive: line ? line.isActive : true,
      metadata: line ? line.metadata : {}
    };
  }

  /* The draft as a definition, the shape the bridge and line-identity
   * take: numbers as numbers, aliases as a list, N/A as null. */
  function definitionOf(draft) {
    const number = String(draft.lineNumber || "").trim();
    return {
      id: draft.id || null,
      lineNumber: number === "" ? NaN : Number(number),
      displayName: String(draft.displayName || "").trim().replace(/\s+/g, " "),
      aliases: String(draft.aliases || "").split(/[\n,]+/).map(value => value.trim()).filter(Boolean),
      layerCount: Number(draft.layerCount),
      hopperCounts: hopperCountsFor(draft.layerCount, draft.hopperCounts).map(count => (String(count).trim() === "" ? NaN : Number(count))),
      layerAPosition: Number(draft.layerCount) === 1 ? null : (draft.layerAPosition || null),
      hopperGeometry: draft.hopperGeometry,
      hopperNamingMode: draft.hopperNamingMode,
      isActive: draft.isActive !== false,
      metadata: draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {}
    };
  }

  function sameDefinition(a, b) {
    return JSON.stringify(definitionOf(a)) === JSON.stringify(definitionOf(b));
  }

  /**
   * Validate a definition against the others, by line-identity's rules -
   * the same check the floor UI's panel makes before it asks, and the
   * service makes again. `others` are the lines as read, less the one
   * being edited.
   */
  function validateDefinition(definition, others) {
    if (!lineIdentityModule || typeof lineIdentityModule.validateLineConfigurations !== "function") return { valid: true };
    const combined = (others || []).concat([definition]);
    return lineIdentityModule.validateLineConfigurations(combined);
  }

  /* --------------------------------------------------------------------
   *   The words a confirmation says - the floor UI's own, unchanged
   * ------------------------------------------------------------------ */

  function deactivateLines(line) {
    return [`Deactivate ${line.displayName}? Structured workspace identities will still resolve, but names and aliases will no longer match this line.`];
  }

  function reactivateLines(line) {
    return [`Reactivate ${line.displayName}? Its display name and aliases will match this line again.`];
  }

  function discardLines(line) {
    return [`Discard the unsaved changes to ${line.displayName || "this line"}? The line stays as it was last saved.`];
  }

  /**
   * Build the tool.
   *
   * @param {Document} doc
   * @param {object} context
   * @param {object|null} context.admin        the admin bridge (request).
   *        Handed in, never reached for.
   * @param {object|null} [context.connection] the connection bridge
   *        (getStatus, subscribe): which line this desktop is on, so the
   *        list can mark it and the editor can say the stage follows.
   * @param {Element} [context.statusSlot]     where the current line's
   *        status line goes - the strip above the tool (station-sudo.js)
   * @param {function} [context.visible]       () => whether the tool is
   *        on screen; the list is read only for a page an operator can see
   */
  function create(doc, context) {
    const settings = context || {};
    const admin = settings.admin || null;
    const connection = settings.connection || null;
    const visible = typeof settings.visible === "function" ? settings.visible : () => true;

    const state = {
      lines: [],
      focusId: null,        // the chosen line's id, or "new" for one being added
      draft: null,          // the working copy of the chosen line
      loaded: false,
      loading: false,
      pending: null,        // the request in flight, by action
      view: null,           // null (the line) | { kind: "confirm", ... }
      maintenanceOpen: false,
      note: "",
      noteKind: ""
    };
    let access = null;

    const rootEl = element(doc, "div", "station-sudo-lines", { "data-role": "line-configuration" });

    /* ---- The current line, in the strip ---- */
    const status = element(doc, "span", "station-sudo-lines__current");
    const statusText = element(doc, "span", "station-sudo-lines__current-text");
    status.appendChild(statusText);
    if (settings.statusSlot && typeof settings.statusSlot.appendChild === "function") settings.statusSlot.appendChild(status);
    else rootEl.appendChild(status);

    const note = element(doc, "p", "station-sudo-ws__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    /* ---- The two panes: the shapes Workspace Management drew ---- */
    const columns = element(doc, "div", "station-sudo-ws__columns");
    rootEl.appendChild(columns);

    const listPane = element(doc, "section", "station-sudo-ws__list-pane", { "aria-label": "Lines" });
    const listHead = element(doc, "div", "station-sudo-ws__pane-head");
    const listTitle = element(doc, "span", "station-sudo-ws__eyebrow");
    listTitle.appendChild(text(doc, "span", "", "Lines"));
    const listCount = text(doc, "span", "station-sudo-ws__count", "", { "aria-label": "Line count" });
    listTitle.appendChild(listCount);
    listHead.appendChild(listTitle);
    const addButton = text(doc, "button", ACTION, "Add Line", {
      type: "button", "data-action": "add-line", title: "Define a line: its number, names and structure. Creating its RT Sync workspace is Workspaces' Create Line."
    });
    const refreshButton = element(doc, "button", UTILITY, {
      type: "button", "data-action": "refresh", "aria-label": "Refresh", title: "Refresh the line list"
    });
    refreshButton.appendChild(refreshGlyph(doc));
    const listActions = element(doc, "span", "station-sudo-ws__pane-actions");
    listActions.appendChild(addButton); listActions.appendChild(refreshButton);
    listHead.appendChild(listActions);
    listPane.appendChild(listHead);
    const list = element(doc, "ol", "station-sudo-ws__list", { "aria-label": "Lines" });
    listPane.appendChild(list);
    columns.appendChild(listPane);

    const detailPane = element(doc, "section", "station-sudo-ws__detail-pane", { "aria-label": "Selected line", "aria-live": "polite" });
    columns.appendChild(detailPane);

    /* ---- Reading ---- */

    function say(message, kind) {
      state.note = message || "";
      state.noteKind = state.note ? (kind || "") : "";
      note.textContent = state.note;
      note.setAttribute("data-kind", state.noteKind);
      show(note, !!state.note);
    }

    function chosen() {
      if (state.focusId === "new") return null;
      return state.lines.find(line => line.id === state.focusId) || null;
    }

    function adding() {
      return state.focusId === "new";
    }

    function dirty() {
      if (!state.draft) return false;
      if (adding()) return true;
      const line = chosen();
      return !!line && !sameDefinition(state.draft, draftOf(line));
    }

    function busy() {
      return !!state.pending || state.loading;
    }

    /* The line this desktop is on, by number, from the connection bridge:
     * null when unlinked, unassigned, or unmapped. */
    function currentLineNumber() {
      if (!connection || typeof connection.getStatus !== "function") return null;
      const current = connection.getStatus();
      if (!current || !current.linked || !current.line) return null;
      return Number.isInteger(current.line.lineNumber) ? current.line.lineNumber : null;
    }

    function isCurrent(line) {
      const number = currentLineNumber();
      return number !== null && !!line && line.lineNumber === number;
    }

    /* ---- Drawing ---- */

    function drawStrip() {
      const number = currentLineNumber();
      const line = number !== null ? state.lines.find(item => item.lineNumber === number) || null : null;
      statusText.textContent = number === null
        ? "This desktop is on no line"
        : `This desktop is on ${line ? line.displayName : `Line ${number}`}`;
      status.setAttribute("data-linked", number === null ? "false" : "true");
    }

    function drawList() {
      clearChildren(list);
      listCount.textContent = state.loaded ? String(state.lines.length) : "";
      addButton.disabled = busy();
      refreshButton.disabled = busy();
      refreshButton.classList.toggle("is-busy", state.loading);
      if (!state.lines.length && !adding()) {
        list.appendChild(text(doc, "li", "station-sudo-ws__empty",
          state.loading ? "Reading lines…" : (state.loaded ? "No lines defined." : "")));
        return;
      }
      for (const line of state.lines) {
        const item = element(doc, "li");
        const current = isCurrent(line);
        const row = element(doc, "button", `station-sudo-ws__row${current ? " is-connected" : ""}${line.isActive ? "" : " is-inactive"}`, {
          type: "button", "data-line": line.id, "aria-pressed": line.id === state.focusId ? "true" : "false",
          title: current ? `${line.displayName} — this desktop is on it` : line.displayName
        });
        row.appendChild(text(doc, "span", "station-sudo-ws__row-name", line.displayName));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-mark", current ? "●" : "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-meta", rowMeta(line)));
        if (current) row.setAttribute("aria-label", `${line.displayName}, this desktop is on it`);
        item.appendChild(row);
        list.appendChild(item);
      }
      if (adding()) {
        const item = element(doc, "li");
        const row = element(doc, "button", "station-sudo-ws__row is-new", { type: "button", "data-line": "new", "aria-pressed": "true" });
        row.appendChild(text(doc, "span", "station-sudo-ws__row-name", state.draft && state.draft.displayName ? state.draft.displayName : "New line"));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-mark", "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-meta", "Not saved yet"));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawConfirm(view) {
      const confirm = element(doc, "div", "station-sudo-ws__confirm", { "data-confirm": view.action, "data-danger": view.danger ? "true" : "false" });
      confirm.appendChild(text(doc, "h3", "station-sudo-ws__confirm-title", view.title));
      const lines = element(doc, "div", "station-sudo-ws__confirm-lines");
      for (const line of view.lines) lines.appendChild(text(doc, "p", "station-sudo-ws__confirm-line", line));
      confirm.appendChild(lines);
      const row = element(doc, "div", "station-sudo-ws__confirm-actions");
      const go = text(doc, "button", view.danger ? DANGER : PRIMARY, view.label, { type: "button", "data-action": "confirm-view" });
      go.disabled = busy();
      const cancel = text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-view" });
      row.appendChild(go); row.appendChild(cancel);
      confirm.appendChild(row);
      return confirm;
    }

    /* A field row: a label in the left track, the control in the right. */
    function fieldRow(label, control, attributes) {
      const row = element(doc, "div", "station-sudo-lines__field", attributes);
      row.appendChild(text(doc, "span", "station-sudo-lines__label", label));
      const value = element(doc, "span", "station-sudo-lines__value");
      value.appendChild(control);
      row.appendChild(value);
      return row;
    }

    function textField(field, value, attributes) {
      const input = element(doc, "input", "station-sudo-lines__input", Object.assign({
        type: "text", autocomplete: "off", spellcheck: "false", "data-field": field
      }, attributes || {}));
      input.value = value === null || value === undefined ? "" : String(value);
      input.disabled = busy();
      return input;
    }

    /* A row of chips, one pressed: the Handbook's own selector. */
    function chipGroup(field, choices, current, extra) {
      const group = element(doc, "span", "station-sudo-lines__chips", Object.assign({ role: "radiogroup", "data-field": field }, extra || {}));
      for (const choice of choices) {
        const on = choice.value === current;
        const chip = text(doc, "button", CHIP, choice.label, {
          type: "button", role: "radio", "data-choice": field, "data-value": String(choice.value),
          "aria-pressed": on ? "true" : "false", "aria-checked": on ? "true" : "false"
        });
        chip.disabled = busy();
        group.appendChild(chip);
      }
      return group;
    }

    function drawLayers(draft) {
      const block = element(doc, "div", "station-sudo-lines__layers", { role: "group", "aria-label": "Layer roles" });
      const rows = layerRows(draft.layerCount, draft.layerAPosition);
      rows.forEach((row, recipeIndex) => {
        const line = element(doc, "div", "station-sudo-lines__layer", { "data-layer": row.id, "data-layer-role": row.role || "unknown" });
        line.appendChild(text(doc, "span", "station-sudo-lines__layer-key", row.id));
        const counts = hopperCountsFor(draft.layerCount, draft.hopperCounts);
        const count = element(doc, "span", "station-sudo-lines__layer-count");
        count.appendChild(textField(`hopperCount:${recipeIndex}`, counts[recipeIndex], {
          inputmode: "numeric", pattern: "[0-9]*", "data-width": "short", "data-role": "hopper-count", "aria-label": `Layer ${row.id} hoppers`
        }));
        count.appendChild(text(doc, "span", "station-sudo-lines__layer-count-unit", "hoppers"));
        line.appendChild(count);
        if (row.end && Number(draft.layerCount) > 1) {
          const side = sideOfRow(recipeIndex, Number(draft.layerCount), draft.layerAPosition);
          const chips = chipGroup(`side:${recipeIndex}`, SIDES, side, { "aria-label": `Layer ${row.id} side` });
          line.appendChild(chips);
        } else {
          line.appendChild(text(doc, "span", "station-sudo-lines__layer-role", row.roleLabel));
        }
        block.appendChild(line);
      });
      return block;
    }

    function drawMaintenance(line) {
      const section = element(doc, "section", "station-sudo-ws__maintenance", { "aria-label": "Line maintenance" });
      const toggle = element(doc, "button", "station-sudo-ws__fold", {
        type: "button", "data-action": "toggle-maintenance", "aria-expanded": state.maintenanceOpen ? "true" : "false"
      });
      toggle.appendChild(text(doc, "span", "station-sudo-ws__fold-mark", state.maintenanceOpen ? "▾" : "▸", { "aria-hidden": "true" }));
      toggle.appendChild(text(doc, "span", "station-sudo-ws__eyebrow", "Line maintenance"));
      toggle.appendChild(text(doc, "span", "station-sudo-ws__fold-note", line.isActive ? "Deactivate" : "Reactivate"));
      section.appendChild(toggle);
      const body = element(doc, "div", "station-sudo-ws__maintenance-body", { hidden: state.maintenanceOpen ? null : "" });
      const item = element(doc, "div", `station-sudo-ws__maintenance-item${line.isActive ? " is-danger" : ""}`);
      item.appendChild(text(doc, "h4", "station-sudo-ws__maintenance-title", line.isActive ? "Deactivate line" : "Reactivate line"));
      item.appendChild(text(doc, "p", "station-sudo-ws__maintenance-copy", line.isActive
        ? "Its names and aliases stop matching workspaces. Nothing is deleted; a line is never deleted."
        : "Its names and aliases match workspaces again."));
      const button = text(doc, "button", line.isActive ? DANGER : ACTION, line.isActive ? "Deactivate Line" : "Reactivate Line", {
        type: "button", "data-action": line.isActive ? "deactivate" : "reactivate"
      });
      button.disabled = busy() || dirty();
      button.setAttribute("title", dirty() ? "Save or discard the changes first" : "");
      item.appendChild(button);
      body.appendChild(item);
      section.appendChild(body);
      return section;
    }

    function drawEditor() {
      const draft = state.draft;
      const line = chosen();
      const isNew = adding();
      const detail = element(doc, "div", "station-sudo-lines__detail", { "data-dirty": dirty() ? "true" : "false" });

      const head = element(doc, "div", "station-sudo-ws__detail-head");
      const identity = element(doc, "div", "station-sudo-ws__identity");
      const nameRow = element(doc, "div", "station-sudo-lines__name-row");
      nameRow.appendChild(text(doc, "h3", "station-sudo-ws__detail-name", isNew ? "New Line" : line.displayName));
      if (line && isCurrent(line)) nameRow.appendChild(text(doc, "span", "station-sudo-lines__tag", "Current line", { "data-tag": "current" }));
      if (line && !line.isActive) nameRow.appendChild(text(doc, "span", "station-sudo-lines__tag", "Inactive", { "data-tag": "inactive" }));
      if (dirty()) nameRow.appendChild(text(doc, "span", "station-sudo-lines__tag", "Unsaved changes", { "data-tag": "dirty" }));
      identity.appendChild(nameRow);
      identity.appendChild(text(doc, "p", "station-sudo-ws__detail-meta", isNew
        ? "A line definition: number, names and structure. Its RT Sync workspace is Workspaces' Create Line."
        : detailMeta(line)));
      head.appendChild(identity);
      const actions = element(doc, "div", "station-sudo-ws__detail-actions");
      const save = text(doc, "button", PRIMARY, isNew ? "Add Line" : "Save Changes", { type: "button", "data-action": "save" });
      save.disabled = busy() || !dirty();
      actions.appendChild(save);
      const discard = text(doc, "button", QUIET, isNew ? "Cancel" : "Discard", { type: "button", "data-action": "discard" });
      discard.disabled = busy() || !dirty();
      actions.appendChild(discard);
      head.appendChild(actions);
      detail.appendChild(head);

      const fields = element(doc, "div", "station-sudo-lines__fields");
      fields.appendChild(fieldRow("Line number", textField("lineNumber", draft.lineNumber, {
        inputmode: "numeric", pattern: "[0-9]*", maxlength: "3", "aria-label": "Line number", "data-width": "short"
      })));
      fields.appendChild(fieldRow("Display name", textField("displayName", draft.displayName, { maxlength: "80", "aria-label": "Display name" })));
      fields.appendChild(fieldRow("Also known as", textField("aliases", draft.aliases, {
        maxlength: "400", "aria-label": "Additional names, comma-separated", placeholder: "Comma-separated"
      })));
      fields.appendChild(fieldRow("Layers", chipGroup("layerCount", layerCountChoices(Number(draft.layerCount)).map(count => ({ value: count, label: String(count) })), Number(draft.layerCount), { "aria-label": "Layer count" })));
      const layersRow = fieldRow("Layer roles", drawLayers(draft), { "data-field-row": "layers" });
      fields.appendChild(layersRow);
      fields.appendChild(fieldRow("Hopper naming", chipGroup("hopperNamingMode", NAMING_MODES, draft.hopperNamingMode, { "aria-label": "Hopper naming mode" })));
      fields.appendChild(fieldRow("Hoppers", text(doc, "span", "station-sudo-lines__hoppers", hopperSummary(draft.layerCount, draft.hopperNamingMode, draft.hopperCounts), { "data-role": "hoppers" })));
      fields.appendChild(fieldRow("Hopper geometry", chipGroup("hopperGeometry", GEOMETRIES, draft.hopperGeometry, { "aria-label": "Hopper geometry" })));
      detail.appendChild(fields);

      detail.appendChild(text(doc, "p", "station-sudo-lines__reach", line && isCurrent(line)
        ? "A saved change reaches this Station now, and other devices on the line when they next reload."
        : "A saved change reaches devices on the line when they next reload."));

      if (line) detail.appendChild(drawMaintenance(line));
      return detail;
    }

    function drawDetail() {
      clearChildren(detailPane);
      if (state.view && state.view.kind === "confirm") { detailPane.appendChild(drawConfirm(state.view)); return; }
      if (!state.draft) {
        detailPane.appendChild(text(doc, "p", "station-sudo-ws__empty", state.lines.length
          ? "Select a line to see its structure."
          : ""));
        return;
      }
      detailPane.appendChild(drawEditor());
    }

    function refresh() {
      drawStrip();
      drawList();
      drawDetail();
    }

    /* Redraw the list and the editor after a chip: the rows that follow
     * from it, the dirty state, the save button. Never called while the
     * operator is typing - a typed field is updated in place (setField),
     * since redrawing it would take the caret with it. */
    function refreshEditor() {
      drawList();
      drawDetail();
    }

    /* ---- Requests ---- */

    async function request(action, args) {
      if (!admin || typeof admin.request !== "function") {
        return { ok: false, code: "unavailable", message: "No application is connected to Station's administrator tools." };
      }
      state.pending = action;
      refresh();
      let result;
      try {
        result = await admin.request(action, args);
      } finally {
        state.pending = null;
      }
      return result || { ok: false, code: "failed", message: "The application did not answer." };
    }

    function accessLost(result) {
      return !!result && (result.code === "not_authenticated" || result.code === "access_denied");
    }

    async function load() {
      if (state.loading) return null;
      state.loading = true;
      say("Loading lines…");
      refresh();
      let result;
      try {
        result = await request("listLineConfigurations");
      } finally {
        state.loading = false;
      }
      if (!result.ok) {
        if (accessLost(result)) { reset(); return result; }
        say(result.message || "Could not load the lines.", "error");
        refresh();
        return result;
      }
      // In line order, whatever order they were answered in.
      state.lines = result.lines.slice().sort((a, b) => a.lineNumber - b.lineNumber);
      state.loaded = true;
      // The chosen line as re-read, unless it is being edited: a draft in
      // hand is the operator's and is not replaced under them.
      if (state.focusId && !adding()) {
        const line = chosen();
        if (!line) { state.focusId = null; state.draft = null; }
        else if (!dirty()) state.draft = draftOf(line);
      }
      say(`${plural(state.lines.length, "line")} loaded.`, "ok");
      refresh();
      return result;
    }

    function chooseNow(id) {
      state.view = null;
      state.maintenanceOpen = false;
      if (id === "new") {
        state.focusId = "new";
        state.draft = draftOf(null);
      } else {
        state.focusId = id || null;
        const line = chosen();
        state.draft = line ? draftOf(line) : null;
      }
      say("");
      refresh();
      if (id === "new") {
        const input = detailPane.querySelector ? detailPane.querySelector("[data-field='lineNumber']") : null;
        if (input && typeof input.focus === "function") input.focus();
      }
    }

    /* Choose a line - or, with unsaved changes in hand, ask first. */
    function choose(id) {
      if (id === state.focusId) return;
      if (dirty()) {
        const line = chosen() || { displayName: state.draft && state.draft.displayName };
        ask({
          action: "discard", title: "Unsaved Changes", label: "Discard Changes", danger: false,
          lines: discardLines(line),
          run: async () => { chooseNow(id); return { ok: true }; }
        });
        return;
      }
      chooseNow(id);
    }

    /* ---- Editing the draft ---- */

    function setField(field, value) {
      if (!state.draft) return;
      if (field === "lineNumber") {
        const number = String(value || "").replace(/[^0-9]/g, "");
        state.draft.lineNumber = number;
        // A new line's name follows its number until it is given one of
        // its own - the floor UI's panel's own convenience.
        if (adding() && (!state.draft.displayName || /^Line \d*$/.test(state.draft.displayName))) {
          state.draft.displayName = number ? `Line ${number}` : "";
          const name = detailPane.querySelector ? detailPane.querySelector("[data-field='displayName']") : null;
          if (name) name.value = state.draft.displayName;
        }
      } else if (field === "displayName" || field === "aliases") {
        state.draft[field] = String(value || "");
      } else if (field.startsWith("hopperCount:")) {
        const recipeIndex = Number(field.slice(12));
        const counts = hopperCountsFor(state.draft.layerCount, state.draft.hopperCounts);
        if (!Number.isInteger(recipeIndex) || recipeIndex < 0 || recipeIndex >= counts.length) return;
        // One digit: the last one typed wins, so typing over a count that
        // is already there needs no selecting or deleting first.
        counts[recipeIndex] = String(value || "").replace(/[^0-9]/g, "").slice(-1);
        state.draft.hopperCounts = counts;
        const input = detailPane.querySelector ? detailPane.querySelector(`[data-field='${field}']`) : null;
        if (input && input.value !== counts[recipeIndex]) input.value = counts[recipeIndex];
        // The ids that follow, in place - the input keeps what was typed.
        const summary = detailPane.querySelector ? detailPane.querySelector("[data-role='hoppers']") : null;
        if (summary) summary.textContent = hopperSummary(state.draft.layerCount, state.draft.hopperNamingMode, counts);
      }
      say("");
      // A line being added stands in the list under its name as typed.
      if (adding() && (field === "lineNumber" || field === "displayName")) drawList();
      // The inputs keep their own values; only what reads from the draft
      // is redrawn, and not while the operator is in a field.
      const head = detailPane.querySelector ? detailPane.querySelector(".station-sudo-lines__detail") : null;
      if (head) head.setAttribute("data-dirty", dirty() ? "true" : "false");
      const save = detailPane.querySelector ? detailPane.querySelector("[data-action='save']") : null;
      if (save) save.disabled = busy() || !dirty();
      const discard = detailPane.querySelector ? detailPane.querySelector("[data-action='discard']") : null;
      if (discard) discard.disabled = busy() || !dirty();
      syncDirtyTag();
    }

    function syncDirtyTag() {
      const row = detailPane.querySelector ? detailPane.querySelector(".station-sudo-lines__name-row") : null;
      if (!row) return;
      const existing = row.querySelector ? row.querySelector("[data-tag='dirty']") : null;
      if (dirty() && !existing) row.appendChild(text(doc, "span", "station-sudo-lines__tag", "Unsaved changes", { "data-tag": "dirty" }));
      else if (!dirty() && existing) row.removeChild(existing);
    }

    function setChoice(field, value) {
      if (!state.draft) return;
      if (field === "layerCount") {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) return;
        state.draft.layerCount = count;
        state.draft.hopperCounts = hopperCountsFor(count, state.draft.hopperCounts);
        // A single-layer line has no side; a multilayer one needs one, and
        // the last chosen side (or Outside) stands until it is changed.
        if (count === 1) state.draft.layerAPosition = null;
        else if (state.draft.layerAPosition !== "inside" && state.draft.layerAPosition !== "outside") state.draft.layerAPosition = "outside";
      } else if (field.startsWith("side:")) {
        const recipeIndex = Number(field.slice(5));
        if (value !== "inside" && value !== "outside") return;
        state.draft.layerAPosition = layerAPositionFor(recipeIndex, value);
      } else if (field === "hopperGeometry") {
        state.draft.hopperGeometry = String(value);
      } else if (field === "hopperNamingMode") {
        state.draft.hopperNamingMode = String(value);
      } else {
        return;
      }
      say("");
      refreshEditor();
    }

    function discard() {
      if (adding()) { state.focusId = null; state.draft = null; say(""); refresh(); return; }
      const line = chosen();
      state.draft = line ? draftOf(line) : null;
      say("");
      refresh();
    }

    /* ---- Saving ---- */

    function markInvalid(message) {
      const fields = { lineNumber: /line number/i, displayName: /display name/i, aliases: /additional names/i };
      for (const field of Object.keys(fields)) {
        const input = detailPane.querySelector ? detailPane.querySelector(`[data-field='${field}']`) : null;
        if (!input) continue;
        if (fields[field].test(message)) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
      // The counts are one rule for every layer, so every count input is
      // marked, or none - the message does not say which layer.
      const countInputs = detailPane.querySelectorAll ? detailPane.querySelectorAll("[data-role='hopper-count']") : [];
      const max = maxHoppersPerLayer();
      for (const input of countInputs) {
        const number = Number(input.value);
        const bad = /hoppers per layer/i.test(message) && !(Number.isInteger(number) && number >= 1 && number <= max);
        if (bad) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
    }

    async function save() {
      if (!state.draft || busy()) return null;
      const definition = definitionOf(state.draft);
      const others = state.lines.filter(line => line.id !== definition.id);
      const checked = validateDefinition(definition, others);
      if (!checked.valid) {
        say(checked.message || "The line configuration is not valid.", "error");
        markInvalid(checked.message || "");
        return { ok: false, code: "invalid", message: checked.message };
      }
      const wasNew = adding();
      say(wasNew ? "Adding line…" : "Saving changes…");
      const result = await request("saveLineConfiguration", { id: definition.id || "", line: definition });
      if (!result.ok) {
        if (accessLost(result)) { reset(); return result; }
        say(result.message || "Could not save the line. No changes were applied.", "error");
        refresh();
        markInvalid(result.message || "");
        return result;
      }
      const saved = result.line;
      // The saved line as the server returned it becomes the chosen line's
      // baseline, so the editor reads clean before the list is re-read.
      state.focusId = saved.id || state.focusId;
      state.lines = state.lines.filter(line => line.id !== saved.id).concat([saved]).sort((a, b) => a.lineNumber - b.lineNumber);
      state.draft = draftOf(saved);
      await load();
      const current = isCurrent(saved);
      say(`${saved.displayName} saved.${current ? " This Station follows it now;" : ""} ${current ? "other devices" : "Devices"} on the line use it when they next reload.`, "ok");
      refresh();
      return result;
    }

    /* ---- The right pane's other face: a confirmation ---- */

    function ask(view) {
      state.view = Object.assign({ kind: "confirm" }, view);
      say("");
      refresh();
      const go = detailPane.querySelector ? detailPane.querySelector("[data-action='confirm-view']") : null;
      if (go && typeof go.focus === "function") go.focus();
    }

    function closeView() {
      state.view = null;
      refresh();
    }

    async function confirmView() {
      const view = state.view;
      if (!view || view.kind !== "confirm" || typeof view.run !== "function") return null;
      return view.run();
    }

    /* Deactivate and reactivate: the same save, with one field turned,
     * asked first in the floor UI's words and kept under the fold. */
    function askActive(nextActive) {
      const line = chosen();
      if (!line || dirty()) return;
      ask({
        action: nextActive ? "reactivate" : "deactivate",
        title: nextActive ? "Reactivate Line" : "Deactivate Line",
        label: nextActive ? "Reactivate Line" : "Deactivate Line",
        danger: !nextActive,
        lines: nextActive ? reactivateLines(line) : deactivateLines(line),
        run: async () => {
          const definition = Object.assign(definitionOf(draftOf(line)), { isActive: nextActive });
          say(nextActive ? "Reactivating line…" : "Deactivating line…");
          const result = await request("saveLineConfiguration", { id: line.id, line: definition });
          if (!result.ok) {
            if (accessLost(result)) { reset(); return result; }
            state.view = null;
            say(result.message || "The line could not be changed.", "error");
            refresh();
            return result;
          }
          state.view = null;
          state.draft = draftOf(result.line);
          await load();
          say(`${line.displayName} ${nextActive ? "reactivated" : "deactivated"}.`, "ok");
          refresh();
          return result;
        }
      });
    }

    /* ---- Access ---- */

    /** Drop everything read under a session: nothing of it survives one. */
    function reset() {
      state.lines = [];
      state.focusId = null;
      state.draft = null;
      state.loaded = false;
      state.view = null;
      state.maintenanceOpen = false;
      say("");
      refresh();
    }

    /** The page's word on every publish, and on showing: read once per session. */
    function update(current) {
      access = current || access;
      const signedIn = !!(access && access.access && access.access.signedIn);
      if (!signedIn) { if (state.loaded || state.lines.length) reset(); else refresh(); return; }
      if (!state.loaded && !state.loading && visible()) { void load(); return; }
      refresh();
    }

    rootEl.addEventListener("click", event => {
      const target = event.target && event.target.closest
        ? event.target.closest("[data-action], [data-line], [data-choice]")
        : null;
      if (!target || target.disabled) return;
      const lineId = target.getAttribute("data-line");
      if (lineId) { choose(lineId); return; }
      const choice = target.getAttribute("data-choice");
      if (choice) { setChoice(choice, target.getAttribute("data-value")); return; }
      const action = target.getAttribute("data-action");
      if (action === "refresh") { void load(); return; }
      if (action === "add-line") { choose("new"); return; }
      if (action === "save") { void save(); return; }
      if (action === "discard") { discard(); return; }
      if (action === "confirm-view") { void confirmView(); return; }
      if (action === "cancel-view") { closeView(); return; }
      if (action === "toggle-maintenance") { state.maintenanceOpen = !state.maintenanceOpen; refresh(); return; }
      if (action === "deactivate") { askActive(false); return; }
      if (action === "reactivate") { askActive(true); return; }
    });
    rootEl.addEventListener("input", event => {
      const target = event.target;
      const field = target && typeof target.getAttribute === "function" ? target.getAttribute("data-field") : null;
      if (!field) return;
      setField(field, target.value);
    });
    // A count field offers its digit up on focus, so the next digit typed
    // replaces it - the way a one-character field is used.
    rootEl.addEventListener("focusin", event => {
      const target = event && event.target;
      if (!target || typeof target.getAttribute !== "function" || target.getAttribute("data-role") !== "hopper-count") return;
      if (typeof target.select === "function") target.select();
    });
    rootEl.addEventListener("keydown", event => {
      if (!event || event.key !== "Enter") return;
      const target = event.target;
      const field = target && typeof target.getAttribute === "function" ? target.getAttribute("data-field") : null;
      if (!field) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (dirty()) void save();
    });

    /* The current line moves with the connection; the mark and the
     * strip follow it. The list is not re-read for it. */
    if (connection && typeof connection.subscribe === "function") {
      connection.subscribe(() => { if (state.loaded) refresh(); else drawStrip(); });
    }

    refresh();

    return {
      element: rootEl,
      update,
      reset,
      focus() {
        const first = list.querySelector ? list.querySelector("[data-line][aria-pressed='true'], [data-line]") : null;
        const target = first || addButton;
        if (target && typeof target.focus === "function" && !target.disabled) target.focus();
      },
      load,
      choose,
      save,
      getState: () => ({
        focusId: state.focusId, loaded: state.loaded, loading: state.loading, pending: state.pending,
        dirty: dirty(), view: state.view ? { kind: state.view.kind, action: state.view.action } : null,
        maintenanceOpen: state.maintenanceOpen, lines: state.lines.length, note: state.note, noteKind: state.noteKind,
        draft: state.draft ? definitionOf(state.draft) : null
      })
    };
  }

  /* The tool as Sudo takes it. */
  const tool = Object.freeze({ id: ID, title: TITLE, label: LABEL, create });

  return Object.freeze({
    ID, TITLE, LABEL, tool, create,
    LAYER_COUNTS, SIDES, GEOMETRIES, NAMING_MODES,
    layerRows, sideOfRow, layerAPositionFor, hopperRange, hopperSummary, hopperCountsFor, layerCountChoices,
    rowMeta, detailMeta, draftOf, definitionOf, validateDefinition
  });
});
