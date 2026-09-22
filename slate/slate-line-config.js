/* Line Configuration: what each production line IS.
 *
 * WHAT IT IS
 *
 * The lines' definitions, for an administrator: which lines the plant
 * has, and for each its number and names, how many layers it runs, which
 * side of the film Layer A is on, how many hoppers each layer has, how
 * they are named, how they are measured, and who built them. The same
 * definitions the floor UI's own Line Configuration panel edits, over
 * the same admin session.
 *
 * A definition is not a workspace. Adding a line here describes a line
 * the plant has; it does not create anywhere for a device to sync.
 * Creating that is Workspaces' Create Line.
 *
 * WHAT A LINE IS MADE OF
 *
 * A definition holds ONE orientation fact - Layer A's side, inside or
 * outside - and a layer count. Every layer's physical role follows from
 * those two: the layers are a stack, so once A's side is known the far
 * end is the other side and what lies between is core and subskins. The
 * roles are derived by slate-line.js, the same module the recipe reads
 * its layer roles from, so this editor and the running recipe can never
 * disagree. The letters are the operator's stable identifiers and are
 * always listed A, B, C…: a line whose A is the inside still lists A
 * first, because the side is a fact on the row, not the row's position.
 * Choosing a side on either end row sets that one fact; the rows between
 * are read, not set.
 *
 * Hoppers are six a layer unless a layer says otherwise - most lines run
 * six on every layer, several run four on the core - so each layer row
 * asks for its own count. What the line chooses besides is how they are
 * named, and the editor shows the ids that follow.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything through slate-admin-actions.js: the list is one request, a
 * save is one carrying the definition, and the list is read again after.
 * The application answers with its own Line Configuration service, whose
 * save validates through line-identity.js and re-reads the shared
 * definitions - which is how the change reaches the running application.
 * Before asking, the editor validates by those same line-identity rules
 * against the other lines it has read, so a refusal is said here first
 * and nothing invalid is sent.
 *
 * A definition is never deleted. A line that is no longer run is
 * deactivated: its names stop matching workspaces, and nothing is lost.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(
    pick("PolynSlateAdminActions", "./slate-admin-actions.js"),
    pick("PolynSlateLine", "./slate-line.js")
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateLineConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (actionsModule, lineModule) {
  "use strict";

  const TITLE = "Line Configuration";
  const LEAD = "Every line definition: layers, orientation, hoppers and naming.";
  const SIGNED_OUT = "No administrator is signed in. Sign in under Administrator access in Settings.";
  const NO_BRIDGE = "No application is connected to Slate's administrator tools.";
  const ADD_HINT = "A line definition: number, names and structure. Creating its RT Sync workspace is Workspaces' Create Line.";

  const ACTION = "slate-book__action";
  const PRIMARY = `${ACTION} slate-book__action--primary`;
  const QUIET = `${ACTION} slate-book__action--quiet`;
  const DANGER = `${ACTION} slate-book__action--danger`;

  /* The choices a definition offers, in the floor UI's own words. The
   * layer counts are the three the application runs recipes for; a line
   * already defined with another count keeps it (layerCountChoices). */
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
  /* Who built the hopper system: Plast-Control on every line unless the
   * line says TSM. The words are line-identity's HOPPER_MANUFACTURERS. */
  const MANUFACTURERS = Object.freeze([
    Object.freeze({ value: "plast-control", label: "Plast-Control" }),
    Object.freeze({ value: "tsm", label: "TSM" })
  ]);
  const DEFAULT_MANUFACTURER = "plast-control";
  const DEFAULT_HOPPERS_PER_LAYER = 6;

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
      labelFor(GEOMETRIES, line.hopperGeometry) || line.hopperGeometry,
      labelFor(NAMING_MODES, line.hopperNamingMode) || line.hopperNamingMode];
    // Plast-Control is every line's norm; only the exception is spelled out.
    if (line.hopperManufacturer && line.hopperManufacturer !== DEFAULT_MANUFACTURER) {
      parts.push(labelFor(MANUFACTURERS, line.hopperManufacturer) || line.hopperManufacturer);
    }
    if (!line.isActive) parts.push("Inactive");
    return parts.join(" · ");
  }

  /** The chosen line's summary: its number, when it last changed, its aliases. */
  function detailMeta(line) {
    const parts = [`Line number ${line.lineNumber}`];
    const updated = formatDate(line.updatedAt);
    if (updated) parts.push(`Updated ${updated}`);
    if (line.aliases && line.aliases.length) parts.push(`Also ${line.aliases.join(", ")}`);
    return parts.join(" · ");
  }

  /** The letters, A upward: a definition's layers are always listed A first. */
  function layerNames(layerCount) {
    const count = Number(layerCount);
    if (!Number.isInteger(count) || count < 1) return [];
    return Array.from({ length: count }, (unused, index) => String.fromCharCode(65 + index));
  }

  function roleFor(stackIndex, layerCount) {
    return lineModule && typeof lineModule.roleForStackIndex === "function"
      ? lineModule.roleForStackIndex(stackIndex, layerCount) : "";
  }

  function roleLabel(role) {
    return lineModule && typeof lineModule.roleLabel === "function" ? lineModule.roleLabel(role) : role;
  }

  /**
   * The layer rows for a definition, in recipe order (A first, always),
   * each with the physical role that follows from Layer A's side. The
   * stack index is the recipe order reversed when A is the inside - the
   * same derivation slate-line.js makes for the running recipe.
   *
   * @returns {Array<{id, role, roleLabel, end, known}>} `end` marks the
   *          two rows whose side can be chosen.
   */
  function layerRows(layerCount, layerAPosition) {
    const count = Number(layerCount);
    if (!Number.isInteger(count) || count < 1) return [];
    const names = layerNames(count);
    if (count === 1) return [{ id: names[0], role: "single", roleLabel: "Single layer", end: false, known: true }];
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

  /* The side of one end row: A's is the definition's, the far end's is
   * the opposite. */
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

  /* The hopper ids a layer gets, compactly: "A1–A6", "B1–B4", "AM, A1–A5".
   * A count that is not a whole number yet reads as a question mark. */
  function hopperRange(layerName, namingMode, hopperCount) {
    const count = hopperCount === undefined ? DEFAULT_HOPPERS_PER_LAYER : Number(hopperCount);
    if (!Number.isInteger(count) || count < 1) return `${layerName}?`;
    if (namingMode === "main-plus-five") {
      if (count === 1) return `${layerName}M`;
      return `${layerName}M, ${layerName}1${count > 2 ? `–${layerName}${count - 1}` : ""}`;
    }
    return count === 1 ? `${layerName}1` : `${layerName}1–${layerName}${count}`;
  }

  function hopperSummary(layerCount, namingMode, hopperCounts) {
    const counts = Array.isArray(hopperCounts) ? hopperCounts : [];
    return layerNames(layerCount)
      .map((name, index) => hopperRange(name, namingMode, counts[index] === undefined ? DEFAULT_HOPPERS_PER_LAYER : counts[index]))
      .join(" · ");
  }

  /* The draft's counts sized to a layer count: what was typed is kept, a
   * new layer starts at six, a dropped layer's count goes with it. */
  function hopperCountsFor(layerCount, hopperCounts) {
    const count = Number(layerCount);
    if (!Number.isInteger(count) || count < 1) return [];
    const given = Array.isArray(hopperCounts) ? hopperCounts : [];
    return Array.from({ length: count }, (unused, index) =>
      (given[index] === undefined || given[index] === null ? String(DEFAULT_HOPPERS_PER_LAYER) : String(given[index])));
  }

  /* The layer counts the editor offers: the three, plus the line's own
   * when it is another - kept and shown rather than quietly rewritten. */
  function layerCountChoices(current) {
    const out = LAYER_COUNTS.slice();
    if (Number.isInteger(current) && current > 0 && !out.includes(current)) out.push(current);
    return out.sort((a, b) => a - b);
  }

  /** A working copy of a line, with the fields the editor sets. */
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
      hopperManufacturer: line && line.hopperManufacturer ? line.hopperManufacturer : DEFAULT_MANUFACTURER,
      isActive: line ? line.isActive : true,
      metadata: line ? line.metadata : {}
    };
  }

  /* The draft as a definition - the shape the bridge and line-identity
   * take: numbers as numbers, aliases as a list, N/A as null. */
  function definitionOf(draft) {
    const number = String(draft.lineNumber || "").trim();
    return {
      id: draft.id || null,
      lineNumber: number === "" ? NaN : Number(number),
      displayName: String(draft.displayName || "").trim().replace(/\s+/g, " "),
      aliases: String(draft.aliases || "").split(/[\n,]+/).map(value => value.trim()).filter(Boolean),
      layerCount: Number(draft.layerCount),
      hopperCounts: hopperCountsFor(draft.layerCount, draft.hopperCounts)
        .map(count => (String(count).trim() === "" ? NaN : Number(count))),
      layerAPosition: Number(draft.layerCount) === 1 ? null : (draft.layerAPosition || null),
      hopperGeometry: draft.hopperGeometry,
      hopperNamingMode: draft.hopperNamingMode,
      hopperManufacturer: draft.hopperManufacturer || DEFAULT_MANUFACTURER,
      isActive: draft.isActive !== false,
      metadata: draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {}
    };
  }

  function sameDefinition(a, b) {
    return JSON.stringify(definitionOf(a)) === JSON.stringify(definitionOf(b));
  }

  /**
   * Validate a definition against the others, by line-identity's rules -
   * the same check the floor UI makes before it asks, and the service
   * makes again. Without the module, the application decides alone.
   */
  function validateDefinition(identity, definition, others) {
    if (!identity || typeof identity.validateLineConfigurations !== "function") return { valid: true };
    return identity.validateLineConfigurations((others || []).concat([definition]));
  }

  function maxHoppersPerLayer(identity) {
    const declared = identity && identity.MAX_HOPPERS_PER_LAYER;
    return Number.isInteger(declared) && declared > 0 ? declared : DEFAULT_HOPPERS_PER_LAYER;
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
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.admin         the admin bridge, handed in
   * @param {object|null} [ctx.connection]  the connection bridge, read for
   *        the line this device follows; never asked to act
   * @param {object|null} [ctx.lineIdentity] the application's line-identity
   *        module, for the same validation the service makes
   * @param {function} [ctx.say]            a line for the operator
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const admin = settings.admin || null;
    const connection = settings.connection || null;
    const identity = settings.lineIdentity || null;
    const say = typeof settings.say === "function" ? settings.say : () => {};

    const state = {
      lines: [],
      focusId: null,     // a line's id, or "new" for one being added
      draft: null,       // the working copy of the chosen line
      loaded: false,
      loading: false,
      pending: null,
      view: null,        // null (the line) | { kind: "confirm", … }
      maintenanceOpen: false,
      note: "",
      noteKind: "",
      shown: false
    };

    const able = () => actionsModule.can(admin);
    const why = control => actionsModule.reason(admin, control);
    const open = () => actionsModule.signedIn(admin);
    const busy = () => !!state.pending || state.loading;
    const adding = () => state.focusId === "new";
    const chosen = () => (adding() ? null : state.lines.find(line => line.id === state.focusId) || null);

    function dirty() {
      if (!state.draft) return false;
      if (adding()) return true;
      const line = chosen();
      return !!line && !sameDefinition(state.draft, draftOf(line));
    }

    const rootEl = element(doc, "div", "slate-admin", { "data-admin": "line-config" });

    /* ---- The bar ---- */

    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", LEAD);
    bar.appendChild(subtitle);
    const addButton = text(doc, "button", ACTION, "Add Line", { type: "button", "data-action": "add-line" });
    const refreshButton = text(doc, "button", ACTION, "Refresh", { type: "button", "data-action": "refresh" });
    bar.appendChild(addButton);
    bar.appendChild(refreshButton);
    rootEl.appendChild(bar);

    const note = element(doc, "p", "slate-book__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    const gate = text(doc, "p", "slate-admin__gate", SIGNED_OUT, { role: "status" });
    rootEl.appendChild(gate);

    const columns = element(doc, "div", "slate-book__columns", { hidden: "" });
    const list = element(doc, "ol", "slate-book__list", { "aria-label": "Lines" });
    const detailPane = element(doc, "div", "slate-book__detail", { "aria-live": "polite" });
    columns.appendChild(list);
    columns.appendChild(detailPane);
    rootEl.appendChild(columns);

    /* ---- Saying ---- */

    function setNote(message, kind) {
      state.note = message || "";
      state.noteKind = state.note ? (kind || "") : "";
      note.textContent = state.note;
      note.classList.toggle("is-ok", state.noteKind === "ok");
      note.classList.toggle("is-error", state.noteKind === "error");
      show(note, !!state.note);
    }

    function withhold(button, control, extra) {
      const can = !!able()[control] && !(extra && extra.unable);
      button.setAttribute("data-able", can ? "true" : "false");
      const reason = extra && extra.reason ? extra.reason : why(control);
      button.setAttribute("title", can ? (extra && extra.title) || "" : `Unavailable: ${reason}`);
      if (busy()) button.setAttribute("disabled", "");
      else button.removeAttribute("disabled");
    }

    /* The line this device follows, by number, from the connection
     * bridge: null when unlinked, unassigned or unmapped. */
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

    function drawBar() {
      const signedIn = open();
      if (signedIn) {
        const number = currentLineNumber();
        const line = number !== null ? state.lines.find(item => item.lineNumber === number) || null : null;
        subtitle.textContent = number === null
          ? "This device is on no line"
          : `This device is on ${line ? line.displayName : `Line ${number}`}`;
      } else {
        subtitle.textContent = LEAD;
      }
      show(addButton, signedIn);
      show(refreshButton, signedIn);
      withhold(addButton, "saveLine", { title: ADD_HINT });
      withhold(refreshButton, "listLines", { title: "Read the definitions again" });
      refreshButton.classList.toggle("is-busy", state.loading);
    }

    function drawList() {
      clearChildren(list);
      if (!state.lines.length && !adding()) {
        list.appendChild(text(doc, "li", "slate-book__empty",
          state.loading ? "Reading lines…" : (state.loaded ? "No lines defined." : "")));
        return;
      }
      for (const line of state.lines) {
        const item = element(doc, "li");
        const current = isCurrent(line);
        const row = element(doc, "button", "slate-book__row", {
          type: "button", "data-line": line.id,
          "aria-pressed": line.id === state.focusId ? "true" : "false",
          title: current ? `${line.displayName} — this device is on it` : line.displayName
        });
        if (current) {
          row.classList.add("is-connected");
          row.setAttribute("aria-label", `${line.displayName}, this device is on it`);
        }
        if (!line.isActive) row.classList.add("is-inactive");
        row.appendChild(text(doc, "span", "slate-book__star", current ? "●" : "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "slate-book__row-name", line.displayName));
        row.appendChild(text(doc, "span", "slate-book__row-meta", rowMeta(line)));
        item.appendChild(row);
        list.appendChild(item);
      }
      if (adding()) {
        const item = element(doc, "li");
        const row = element(doc, "button", "slate-book__row is-new", { type: "button", "data-line": "new", "aria-pressed": "true" });
        row.appendChild(text(doc, "span", "slate-book__star", "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "slate-book__row-name", state.draft && state.draft.displayName ? state.draft.displayName : "New line"));
        row.appendChild(text(doc, "span", "slate-book__row-meta", "Not saved yet"));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawConfirm(view) {
      const confirm = element(doc, "div", "slate-book__confirm", {
        "data-confirm": view.action, "data-kind": view.danger ? "delete" : "load"
      });
      confirm.appendChild(text(doc, "h3", "slate-admin__confirm-title", view.title));
      for (const line of view.lines) confirm.appendChild(text(doc, "p", "slate-admin__confirm-line", line));
      const row = element(doc, "div", "slate-book__confirm-actions");
      const go = text(doc, "button", view.danger ? DANGER : PRIMARY, view.label, { type: "button", "data-action": "confirm-view" });
      if (busy()) go.setAttribute("disabled", "");
      row.appendChild(go);
      row.appendChild(text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-view" }));
      confirm.appendChild(row);
      return confirm;
    }

    /* A field row: its name on the left, its control on the right. */
    function fieldRow(label, control, attributes) {
      const row = element(doc, "div", "slate-lines__field", attributes);
      row.appendChild(text(doc, "span", "slate-lines__label", label));
      const value = element(doc, "span", "slate-lines__value");
      value.appendChild(control);
      row.appendChild(value);
      return row;
    }

    function textField(field, value, attributes) {
      const input = element(doc, "input", "slate-lines__input", Object.assign({
        type: "text", autocomplete: "off", spellcheck: "false", "data-field": field
      }, attributes || {}));
      input.value = value === null || value === undefined ? "" : String(value);
      if (busy()) input.setAttribute("disabled", "");
      return input;
    }

    /* A row of chips, one chosen. */
    function chipGroup(field, choices, current, extra) {
      const group = element(doc, "span", "slate-lines__chips", Object.assign({ role: "radiogroup", "data-field": field }, extra || {}));
      for (const choice of choices) {
        const on = choice.value === current;
        const chip = text(doc, "button", "slate-admin__chip", choice.label, {
          type: "button", role: "radio", "data-choice": field, "data-value": String(choice.value),
          "aria-checked": on ? "true" : "false"
        });
        if (busy()) chip.setAttribute("disabled", "");
        group.appendChild(chip);
      }
      return group;
    }

    function drawLayers(draft) {
      const block = element(doc, "div", "slate-lines__layers", { role: "group", "aria-label": "Layer roles" });
      const rows = layerRows(draft.layerCount, draft.layerAPosition);
      const counts = hopperCountsFor(draft.layerCount, draft.hopperCounts);
      rows.forEach((row, recipeIndex) => {
        const line = element(doc, "div", "slate-lines__layer", { "data-layer": row.id, "data-layer-role": row.role || "unknown" });
        line.appendChild(text(doc, "span", "slate-lines__layer-key", row.id));
        const count = element(doc, "span", "slate-lines__layer-count");
        count.appendChild(textField(`hopperCount:${recipeIndex}`, counts[recipeIndex], {
          inputmode: "numeric", pattern: "[0-9]*", maxlength: "1", "data-width": "short",
          "data-role": "hopper-count", "aria-label": `Layer ${row.id} hoppers`
        }));
        count.appendChild(text(doc, "span", "slate-lines__layer-unit", "hoppers"));
        line.appendChild(count);
        if (row.end && Number(draft.layerCount) > 1) {
          line.appendChild(chipGroup(`side:${recipeIndex}`, SIDES,
            sideOfRow(recipeIndex, Number(draft.layerCount), draft.layerAPosition), { "aria-label": `Layer ${row.id} side` }));
        } else {
          line.appendChild(text(doc, "span", "slate-lines__layer-role", row.roleLabel));
        }
        block.appendChild(line);
      });
      return block;
    }

    function drawMaintenance(line) {
      const section = element(doc, "section", "slate-admin__maintenance", { "aria-label": "Line maintenance" });
      const toggle = element(doc, "button", "slate-admin__fold", {
        type: "button", "data-action": "toggle-maintenance", "aria-expanded": state.maintenanceOpen ? "true" : "false"
      });
      toggle.appendChild(text(doc, "span", "slate-admin__fold-mark", state.maintenanceOpen ? "▾" : "▸", { "aria-hidden": "true" }));
      toggle.appendChild(text(doc, "span", "slate-admin__fold-title", "Line maintenance"));
      toggle.appendChild(text(doc, "span", "slate-admin__fold-note", line.isActive ? "Deactivate" : "Reactivate"));
      section.appendChild(toggle);
      const body = element(doc, "div", "slate-admin__maintenance-body", { hidden: state.maintenanceOpen ? null : "" });
      const item = element(doc, "div", `slate-admin__maintenance-item${line.isActive ? " is-danger" : ""}`);
      item.appendChild(text(doc, "h4", "slate-admin__maintenance-title", line.isActive ? "Deactivate line" : "Reactivate line"));
      item.appendChild(text(doc, "p", "slate-admin__maintenance-copy", line.isActive
        ? "Its names and aliases stop matching workspaces. Nothing is deleted; a line is never deleted."
        : "Its names and aliases match workspaces again."));
      const button = text(doc, "button", line.isActive ? DANGER : ACTION,
        line.isActive ? "Deactivate Line" : "Reactivate Line",
        { type: "button", "data-action": line.isActive ? "deactivate" : "reactivate" });
      withhold(button, "saveLine", {
        unable: dirty(),
        reason: dirty() ? "save or discard the changes first." : why("saveLine")
      });
      item.appendChild(button);
      body.appendChild(item);
      section.appendChild(body);
      return section;
    }

    function drawEditor() {
      const draft = state.draft;
      const line = chosen();
      const isNew = adding();
      const detail = element(doc, "div", "slate-lines__detail", { "data-dirty": dirty() ? "true" : "false" });

      const nameRow = element(doc, "div", "slate-lines__name-row");
      nameRow.appendChild(text(doc, "h3", "slate-book__detail-name", isNew ? "New Line" : line.displayName));
      if (line && isCurrent(line)) nameRow.appendChild(text(doc, "span", "slate-lines__tag", "Current line", { "data-tag": "current" }));
      if (line && !line.isActive) nameRow.appendChild(text(doc, "span", "slate-lines__tag", "Inactive", { "data-tag": "inactive" }));
      if (dirty()) nameRow.appendChild(text(doc, "span", "slate-lines__tag", "Unsaved changes", { "data-tag": "dirty" }));
      detail.appendChild(nameRow);
      detail.appendChild(text(doc, "p", "slate-admin__detail-meta", isNew ? ADD_HINT : detailMeta(line)));

      const actions = element(doc, "div", "slate-book__actions");
      const save = text(doc, "button", PRIMARY, isNew ? "Add Line" : "Save Changes", { type: "button", "data-action": "save" });
      withhold(save, "saveLine", { unable: !dirty(), reason: dirty() ? why("saveLine") : "nothing has changed." });
      actions.appendChild(save);
      const discardButton = text(doc, "button", QUIET, isNew ? "Cancel" : "Discard", { type: "button", "data-action": "discard" });
      discardButton.setAttribute("data-able", dirty() ? "true" : "false");
      if (busy() || !dirty()) discardButton.setAttribute("disabled", "");
      actions.appendChild(discardButton);
      detail.appendChild(actions);

      const fields = element(doc, "div", "slate-lines__fields");
      fields.appendChild(fieldRow("Line number", textField("lineNumber", draft.lineNumber, {
        inputmode: "numeric", pattern: "[0-9]*", maxlength: "3", "aria-label": "Line number", "data-width": "short"
      })));
      fields.appendChild(fieldRow("Display name", textField("displayName", draft.displayName, { maxlength: "80", "aria-label": "Display name" })));
      fields.appendChild(fieldRow("Also known as", textField("aliases", draft.aliases, {
        maxlength: "400", "aria-label": "Additional names, comma-separated", placeholder: "Comma-separated"
      })));
      fields.appendChild(fieldRow("Layers", chipGroup("layerCount",
        layerCountChoices(Number(draft.layerCount)).map(count => ({ value: count, label: String(count) })),
        Number(draft.layerCount), { "aria-label": "Layer count" })));
      fields.appendChild(fieldRow("Layer roles", drawLayers(draft), { "data-field-row": "layers" }));
      fields.appendChild(fieldRow("Hopper naming", chipGroup("hopperNamingMode", NAMING_MODES, draft.hopperNamingMode, { "aria-label": "Hopper naming mode" })));
      fields.appendChild(fieldRow("Hoppers", text(doc, "span", "slate-lines__hoppers",
        hopperSummary(draft.layerCount, draft.hopperNamingMode, draft.hopperCounts), { "data-role": "hoppers" })));
      fields.appendChild(fieldRow("Hopper geometry", chipGroup("hopperGeometry", GEOMETRIES, draft.hopperGeometry, { "aria-label": "Hopper geometry" })));
      fields.appendChild(fieldRow("Hopper manufacturer", chipGroup("hopperManufacturer", MANUFACTURERS, draft.hopperManufacturer, { "aria-label": "Hopper manufacturer" })));
      detail.appendChild(fields);

      detail.appendChild(text(doc, "p", "slate-lines__reach", line && isCurrent(line)
        ? "A saved change reaches this device now, and other devices on the line when they next reload."
        : "A saved change reaches devices on the line when they next reload."));

      if (line) detail.appendChild(drawMaintenance(line));
      return detail;
    }

    function drawDetail() {
      clearChildren(detailPane);
      if (state.view && state.view.kind === "confirm") { detailPane.appendChild(drawConfirm(state.view)); return; }
      if (!state.draft) {
        detailPane.appendChild(text(doc, "p", "slate-book__hint", state.lines.length ? "Select a line to see its structure." : ""));
        return;
      }
      detailPane.appendChild(drawEditor());
    }

    function paint() {
      const signedIn = open();
      const connected = !!(admin && typeof admin.isConnected === "function" && admin.isConnected());
      gate.textContent = connected ? SIGNED_OUT : NO_BRIDGE;
      show(gate, !signedIn);
      show(columns, signedIn);
      drawBar();
      if (!signedIn) return;
      drawList();
      drawDetail();
    }

    /* ---- Requests ---- */

    async function run(action, call) {
      state.pending = action;
      paint();
      let result;
      try {
        result = await call();
      } finally {
        state.pending = null;
      }
      return result || { ok: false, code: "failed", message: actionsModule.WORDING.noAnswer };
    }

    function failed(result, fallback) {
      if (actionsModule.accessLost(result)) { reset(); setNote(actionsModule.WORDING.accessEnded, "error"); return result; }
      setNote(result.message || fallback, "error");
      paint();
      return result;
    }

    async function load() {
      if (state.loading) return null;
      state.loading = true;
      setNote("Loading lines…");
      paint();
      let result;
      try {
        result = await run("listLineConfigurations", () => actionsModule.listLineConfigurations(admin));
      } finally {
        state.loading = false;
      }
      if (!result.ok) return failed(result, "The lines could not be read.");
      // In line order, whatever order they were answered in.
      state.lines = result.lines.slice().sort((a, b) => a.lineNumber - b.lineNumber);
      state.loaded = true;
      // The chosen line as re-read - unless it is being edited: a draft in
      // hand is the operator's and is not replaced under them.
      if (state.focusId && !adding()) {
        const line = chosen();
        if (!line) { state.focusId = null; state.draft = null; }
        else if (!dirty()) state.draft = draftOf(line);
      }
      setNote(`${plural(state.lines.length, "line")} loaded.`, "ok");
      paint();
      return result;
    }

    /* ---- Choosing ---- */

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
      setNote("");
      paint();
      if (id === "new") {
        const input = detailPane.querySelector("[data-field='lineNumber']");
        if (input && typeof input.focus === "function") input.focus();
      }
    }

    /** Choose a line - or, with unsaved changes in hand, ask first. */
    /* A row click while a request is in flight is refused: the request's
     * own answer writes the chosen record and the editor's baseline when
     * it lands, and it would land on whatever had been chosen meanwhile.
     * The buttons disable themselves for the same moment; a row cannot,
     * so it is turned away here. */
    function choose(id) {
      if (busy()) return;
      if (id === state.focusId) return;
      if (dirty()) {
        const line = chosen() || { displayName: state.draft && state.draft.displayName };
        ask({
          action: "discard", title: "Unsaved Changes", label: "Discard Changes", danger: false,
          lines: discardLines(line),
          run: () => { chooseNow(id); return { ok: true }; }
        });
        return;
      }
      chooseNow(id);
    }

    /* ---- Editing the draft ---- */

    /* A typed field is never redrawn under the operator - that would take
     * the caret with it - so what follows from it is written in place. */
    function setField(field, value) {
      if (!state.draft) return;
      if (field === "lineNumber") {
        const number = String(value || "").replace(/[^0-9]/g, "");
        state.draft.lineNumber = number;
        // A new line's name follows its number until it is given one of
        // its own - the floor UI panel's own convenience.
        if (adding() && (!state.draft.displayName || /^Line \d*$/.test(state.draft.displayName))) {
          state.draft.displayName = number ? `Line ${number}` : "";
          const name = detailPane.querySelector("[data-field='displayName']");
          if (name) name.value = state.draft.displayName;
        }
      } else if (field === "displayName" || field === "aliases") {
        state.draft[field] = String(value || "");
      } else if (field.indexOf("hopperCount:") === 0) {
        const recipeIndex = Number(field.slice(12));
        const counts = hopperCountsFor(state.draft.layerCount, state.draft.hopperCounts);
        if (!Number.isInteger(recipeIndex) || recipeIndex < 0 || recipeIndex >= counts.length) return;
        // One digit: the last one typed wins, so typing over a count that
        // is already there needs no selecting or deleting first.
        counts[recipeIndex] = String(value || "").replace(/[^0-9]/g, "").slice(-1);
        state.draft.hopperCounts = counts;
        const input = detailPane.querySelector(`[data-field='${field}']`);
        if (input && input.value !== counts[recipeIndex]) input.value = counts[recipeIndex];
        const summary = detailPane.querySelector("[data-role='hoppers']");
        if (summary) summary.textContent = hopperSummary(state.draft.layerCount, state.draft.hopperNamingMode, counts);
      } else {
        return;
      }
      setNote("");
      // A line being added stands in the list under its name as typed.
      if (adding() && (field === "lineNumber" || field === "displayName")) drawList();
      syncDirty();
    }

    /* What the dirty state shows, written in place for the same reason. */
    function syncDirty() {
      const detail = detailPane.querySelector(".slate-lines__detail");
      if (detail) detail.setAttribute("data-dirty", dirty() ? "true" : "false");
      const save = detailPane.querySelector("[data-action='save']");
      if (save) withhold(save, "saveLine", { unable: !dirty(), reason: dirty() ? why("saveLine") : "nothing has changed." });
      const discardButton = detailPane.querySelector("[data-action='discard']");
      if (discardButton) {
        discardButton.setAttribute("data-able", dirty() ? "true" : "false");
        if (busy() || !dirty()) discardButton.setAttribute("disabled", "");
        else discardButton.removeAttribute("disabled");
      }
      const row = detailPane.querySelector(".slate-lines__name-row");
      if (!row) return;
      const existing = row.querySelector("[data-tag='dirty']");
      if (dirty() && !existing) row.appendChild(text(doc, "span", "slate-lines__tag", "Unsaved changes", { "data-tag": "dirty" }));
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
      } else if (field.indexOf("side:") === 0) {
        const recipeIndex = Number(field.slice(5));
        if (value !== "inside" && value !== "outside") return;
        state.draft.layerAPosition = layerAPositionFor(recipeIndex, value);
      } else if (field === "hopperGeometry" || field === "hopperNamingMode" || field === "hopperManufacturer") {
        state.draft[field] = String(value);
      } else {
        return;
      }
      setNote("");
      // A chip changes what the rows below it read, so the editor is
      // redrawn - no field is being typed into while one is pressed.
      drawList();
      drawDetail();
    }

    function discard() {
      if (adding()) { state.focusId = null; state.draft = null; setNote(""); paint(); return; }
      const line = chosen();
      state.draft = line ? draftOf(line) : null;
      setNote("");
      paint();
    }

    /* ---- Saving ---- */

    /* The application's refusal names a field by its words, not its id;
     * these are the words it uses. The counts are one rule for every
     * layer, so every count that breaks it is marked. */
    function markInvalid(message) {
      const fields = { lineNumber: /line number/i, displayName: /display name/i, aliases: /additional names/i };
      for (const field of Object.keys(fields)) {
        const input = detailPane.querySelector(`[data-field='${field}']`);
        if (!input) continue;
        if (fields[field].test(message)) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
      const max = maxHoppersPerLayer(identity);
      for (const input of detailPane.querySelectorAll("[data-role='hopper-count']")) {
        const number = Number(input.value);
        const bad = /hoppers per layer/i.test(message) && !(Number.isInteger(number) && number >= 1 && number <= max);
        if (bad) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
    }

    async function save() {
      if (!state.draft || busy()) return null;
      const definition = definitionOf(state.draft);
      // The bridge freezes what it answers with, and the validator runs
      // over the others beside this one: they are copied so nothing it
      // does could ever be a write to a frozen object.
      const others = state.lines.filter(line => line.id !== definition.id).map(line => Object.assign({}, line));
      const checked = validateDefinition(identity, definition, others);
      if (!checked.valid) {
        setNote(checked.message || "The line configuration is not valid.", "error");
        markInvalid(checked.message || "");
        return { ok: false, code: "invalid", message: checked.message };
      }
      const wasNew = adding();
      setNote(wasNew ? "Adding line…" : "Saving changes…");
      const result = await run("saveLineConfiguration", () => actionsModule.saveLineConfiguration(admin, definition.id || "", definition));
      if (!result.ok) {
        const answer = failed(result, "The line could not be saved. Nothing was changed.");
        if (!actionsModule.accessLost(result)) markInvalid(result.message || "");
        return answer;
      }
      const saved = result.line;
      // The line as the application returned it becomes the baseline, so
      // the editor reads clean before the list is read again.
      state.focusId = saved.id || state.focusId;
      state.lines = state.lines.filter(line => line.id !== saved.id).concat([saved]).sort((a, b) => a.lineNumber - b.lineNumber);
      state.draft = draftOf(saved);
      await load();
      const current = isCurrent(saved);
      setNote(`${saved.displayName} saved. ${current ? "This device follows it now; other devices" : "Devices"} on the line use it when they next reload.`, "ok");
      paint();
      return result;
    }

    /* ---- The right pane's other face ---- */

    function ask(view) {
      state.view = Object.assign({ kind: "confirm" }, view);
      setNote("");
      paint();
      const go = detailPane.querySelector("[data-action='confirm-view']");
      if (go && typeof go.focus === "function") go.focus();
    }

    function closeView() {
      if (!state.view) return;
      state.view = null;
      paint();
    }

    function confirmView() {
      const view = state.view;
      if (!view || view.kind !== "confirm" || typeof view.run !== "function" || busy()) return null;
      return view.run();
    }

    /* Deactivate and reactivate are the same save with one field turned,
     * asked first and kept under the fold so neither rides along with an
     * edit. A definition is never deleted. */
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
          setNote(nextActive ? "Reactivating line…" : "Deactivating line…");
          const result = await run("saveLineConfiguration", () => actionsModule.saveLineConfiguration(admin, line.id, definition));
          if (!result.ok) {
            if (actionsModule.accessLost(result)) return failed(result, "");
            state.view = null;
            return failed(result, "The line could not be changed.");
          }
          state.view = null;
          state.draft = draftOf(result.line);
          await load();
          setNote(`${line.displayName} ${nextActive ? "reactivated" : "deactivated"}.`, "ok");
          paint();
          return result;
        }
      });
    }

    /* ---- Access ---- */

    /** Drop everything read under a session: none of it survives one. */
    function reset() {
      state.lines = [];
      state.focusId = null;
      state.draft = null;
      state.loaded = false;
      state.view = null;
      state.maintenanceOpen = false;
      setNote("");
      paint();
    }

    function update() {
      if (!open()) {
        if (state.loaded || state.lines.length) reset();
        else paint();
        return;
      }
      if (!state.loaded && !state.loading && state.shown) { void load(); return; }
      paint();
    }

    rootEl.addEventListener("click", event => {
      const target = event && event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-action], [data-line], [data-choice]")
        : null;
      if (!target || target.hasAttribute("disabled")) return;

      const lineId = target.getAttribute("data-line");
      if (lineId) { choose(lineId); return; }
      const choice = target.getAttribute("data-choice");
      if (choice) { setChoice(choice, target.getAttribute("data-value")); return; }

      const action = target.getAttribute("data-action");
      if (action === "toggle-maintenance") { state.maintenanceOpen = !state.maintenanceOpen; paint(); return; }
      if (action === "cancel-view") { closeView(); return; }
      if (action === "confirm-view") { void confirmView(); return; }
      if (action === "discard") { discard(); return; }
      if (target.getAttribute("data-able") === "false") {
        say(`${target.textContent} is unavailable: ${(target.getAttribute("title") || "").replace(/^Unavailable: /, "")}`);
        return;
      }
      if (action === "refresh") { void load(); return; }
      if (action === "add-line") { choose("new"); return; }
      if (action === "save") { void save(); return; }
      if (action === "deactivate") { askActive(false); return; }
      if (action === "reactivate") { askActive(true); return; }
    });

    rootEl.addEventListener("input", event => {
      const target = event && event.target;
      const field = target && typeof target.getAttribute === "function" ? target.getAttribute("data-field") : null;
      if (field) setField(field, target.value);
    });

    /* A count field offers its digit up on focus, so the next digit typed
     * replaces it - the way a one-character field is used. */
    rootEl.addEventListener("focusin", event => {
      const target = event && event.target;
      if (!target || typeof target.getAttribute !== "function" || target.getAttribute("data-role") !== "hopper-count") return;
      if (typeof target.select === "function") target.select();
    });

    rootEl.addEventListener("keydown", event => {
      if (!event) return;
      if (event.key === "Escape" && state.view) {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        closeView();
        return;
      }
      if (event.key !== "Enter") return;
      const target = event.target;
      const field = target && typeof target.getAttribute === "function" ? target.getAttribute("data-field") : null;
      if (!field) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (dirty()) void save();
    });

    /* The line this device follows moves with the connection; the mark
     * and the bar follow it. The list is not read again for it. */
    if (connection && typeof connection.subscribe === "function") {
      connection.subscribe(() => { if (state.loaded) paint(); else drawBar(); });
    }
    if (admin && typeof admin.subscribe === "function") admin.subscribe(update);
    paint();

    return Object.freeze({
      element: rootEl,
      refresh: update,
      onShow() { state.shown = true; update(); },
      onHide() { state.shown = false; state.view = null; state.maintenanceOpen = false; paint(); },
      load,
      choose,
      save,
      getState: () => ({
        focusId: state.focusId, loaded: state.loaded, loading: state.loading, pending: state.pending,
        dirty: dirty(), view: state.view ? { kind: state.view.kind, action: state.view.action } : null,
        maintenanceOpen: state.maintenanceOpen, lines: state.lines.length,
        note: state.note, noteKind: state.noteKind,
        draft: state.draft ? definitionOf(state.draft) : null
      })
    });
  }

  return Object.freeze({
    TITLE, LEAD, SIGNED_OUT, NO_BRIDGE, ADD_HINT,
    LAYER_COUNTS, SIDES, GEOMETRIES, NAMING_MODES, MANUFACTURERS, DEFAULT_MANUFACTURER, DEFAULT_HOPPERS_PER_LAYER,
    plural, formatDate, layerNames, layerRows, sideOfRow, layerAPositionFor,
    hopperRange, hopperSummary, hopperCountsFor, layerCountChoices,
    rowMeta, detailMeta, draftOf, definitionOf, sameDefinition, validateDefinition,
    deactivateLines, reactivateLines, discardLines, create
  });
});
