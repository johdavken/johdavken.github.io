/* Workspaces: the lines this project holds, and the administrator's way
 * to put a reset device back on one.
 *
 * WHAT IT IS
 *
 * The RT Sync workspaces - the production lines - and the devices linked
 * to each. Which lines exist, who is on them, and the procedures around
 * them: add this device to a line; create one or rename one; reassign a
 * line's ownership or disconnect a device; and, kept folded away, merge a
 * duplicate line into another or delete one. The same procedures the
 * floor UI's own Workspace Management panel offers, over the same admin
 * session, in Slate's centre pane: the lines on the left, the chosen one
 * on the right.
 *
 * WHY IT EXISTS
 *
 * An RT Sync identity is an anonymous Supabase user kept in one browser's
 * storage. Clearing that storage destroys it for good, and the membership
 * row that linked it to a line is left pointing at nobody - while the
 * line itself, its job, its recipes and its weight profiles sit untouched
 * on the server. Add This Device attaches the browser's CURRENT identity
 * to that line as an ordinary member. It never restores the old identity,
 * never deletes it, and never hands over ownership: that is a separate,
 * separately confirmed act, for the case where the device that was lost
 * was the line's owner.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything through slate-admin-actions.js, one request each. The list
 * is one answer, a line's devices another; every change is a request the
 * application answers with its own admin procedure, and the list is read
 * again after. Nothing here knows a table, a procedure or a session; a
 * line's identity is an opaque id the bridge handed over, and a device's
 * is the same. What is shown is what the application last answered: read
 * again on Refresh, after every change, and when the section is opened -
 * and dropped the moment the administrator session ends.
 *
 * ASKING FIRST
 *
 * A change that reaches other devices is confirmed in place, on the right,
 * with the floor UI's own words: what it will do, and what it will not.
 * Nothing is asked in a dialog over Slate.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(pick("PolynSlateAdminActions", "./slate-admin-actions.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateWorkspaces = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (actionsModule) {
  "use strict";

  /* A row tapped while a request is out is turned away (the race it would
   * lose); said, so a finger on a slow line does not read it as a dead screen. */
  const BUSY_WAIT = "Still working on the last request - try again in a moment.";

  const TITLE = "Workspaces";
  const LEAD = "Every line this project holds, and the devices on each.";
  const SIGNED_OUT = "No administrator is signed in. Sign in under Administrator access in Settings.";
  const NO_BRIDGE = "No application is connected to Slate's administrator tools.";
  const NOT_READY = "RT Sync identity not ready. Wait for RT Sync to connect, then try again.";
  const DEVICE_NOTE = "Disconnect revokes that identity's RT Sync access on its next read or write.";

  const ACTION = "slate-book__action";
  const PRIMARY = `${ACTION} slate-book__action--primary`;
  const QUIET = `${ACTION} slate-book__action--quiet`;
  const DANGER = `${ACTION} slate-book__action--danger`;

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

  function formatWhen(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (error) {
      return date.toISOString().slice(0, 16).replace("T", " ");
    }
  }

  /** One line under a line's name: its members, recipes, profiles. */
  function rowMeta(workspace) {
    return [
      plural(workspace.memberCount, "member"),
      plural(workspace.recipeCount, "recipe"),
      plural(workspace.profileCount, "profile")
    ].join(" · ");
  }

  /** The chosen line's summary: when it was created, and the same counts. */
  function detailMeta(workspace) {
    const parts = [];
    const created = formatDate(workspace.createdAt);
    if (created) parts.push(`Created ${created}`);
    parts.push(plural(workspace.memberCount, "member"), plural(workspace.recipeCount, "recipe"),
      plural(workspace.profileCount, "weight profile"));
    return parts.join(" · ");
  }

  /** This device's own line, for the bar. */
  function deviceStatus(device, workspaces) {
    const label = (device && device.label) || "This device";
    if (!device || !device.ready) return `${label} · RT Sync identity not ready`;
    const on = (workspaces || []).filter(workspace => workspace.thisDevice).map(workspace => workspace.name);
    return on.length ? `${label} · RT Sync ready · on ${on.join(", ")}` : `${label} · RT Sync ready · on no line`;
  }

  /* --------------------------------------------------------------------
   *   The words a confirmation says - the floor UI's own, unchanged
   * ------------------------------------------------------------------ */

  function addDeviceLines(workspace, deviceLabel) {
    return [
      `Workspace: ${workspace.name}`,
      `Device: ${deviceLabel || "This device"}`,
      "",
      "This will:",
      `• add this browser's current RT Sync identity to ${workspace.name};`,
      "• restore access to the workspace and its shared configurations.",
      "",
      "This will not:",
      "• delete the previous device membership;",
      "• delete recipes or weight profiles;",
      "• change another device's access;",
      "• transfer workspace ownership."
    ];
  }

  function ownershipLines(workspace, newOwnerLabel) {
    return [
      `Workspace: ${workspace.name}`,
      `New owner: ${newOwnerLabel}`,
      "",
      "This will:",
      `• make ${newOwnerLabel} the owner of ${workspace.name};`,
      "• demote the previous owner's membership row to an ordinary member (it is not deleted).",
      "",
      "This will not:",
      "• delete any membership, recipes, or weight profiles;",
      "• change other devices' access.",
      "",
      "Only do this if the previous owner's device is genuinely gone — Resin.Tools cannot verify that from here. If the previous owner is actually still active elsewhere, it will be demoted to an ordinary member."
    ];
  }

  function disconnectLines(device) {
    const label = device.label || "this device";
    const ownerWarning = device.role === "owner"
      ? " This is the workspace owner; disconnecting it can leave the workspace without an owner."
      : "";
    return [device.thisDevice
      ? `${label} is the device you just recovered. Disconnect it anyway?${ownerWarning}`
      : `Disconnect ${label} from this workspace?${ownerWarning}`];
  }

  function deleteLines(workspace) {
    return [`Permanently delete “${workspace.name}”? This deletes its active job, recipes, weight profiles, and every linked-device membership. This cannot be undone.`];
  }

  function mergeLines(source, target) {
    return [`Merge “${source.name}” into “${target.name}”? Recipes and receiver-weight profiles will be copied. Existing same-name items in the target are preserved; imported duplicates are renamed with “(from ${source.name})”. “${source.name}”, its active job, and its linked-device memberships will then be permanently deleted.`];
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.admin  the admin bridge, handed in
   * @param {function} [ctx.say]     a line for the operator
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const admin = settings.admin || null;
    const say = typeof settings.say === "function" ? settings.say : () => {};

    const state = {
      workspaces: [],
      devices: [],
      devicesFor: null,      // the line id the devices were read for
      focusId: null,         // the chosen line
      loaded: false,
      loading: false,
      pending: null,         // the request in flight, by action
      view: null,            // null (the line) | {kind:"entry"} | {kind:"confirm"}
      maintenanceOpen: false,
      diagnosticsOpen: false,
      mergeTargetId: null,
      note: "",
      noteKind: "",
      shown: false
    };

    const able = () => actionsModule.can(admin);
    const why = control => actionsModule.reason(admin, control);
    const open = () => actionsModule.signedIn(admin);
    const device = () => actionsModule.deviceOf(admin);
    const busy = () => !!state.pending || state.loading;
    const chosen = () => state.workspaces.find(workspace => workspace.id === state.focusId) || null;

    const rootEl = element(doc, "div", "slate-admin", { "data-admin": "workspaces" });

    /* ---- The bar: this device, and what acts on the whole list ---- */

    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", LEAD);
    bar.appendChild(subtitle);
    const diagnosticsButton = text(doc, "button", QUIET, "Diagnostics", {
      type: "button", "data-action": "diagnostics", "aria-pressed": "false", title: "This device's RT Sync identity"
    });
    const createButton = text(doc, "button", ACTION, "Create Line", { type: "button", "data-action": "create-line" });
    const refreshButton = text(doc, "button", ACTION, "Refresh", { type: "button", "data-action": "refresh" });
    for (const node of [diagnosticsButton, createButton, refreshButton]) bar.appendChild(node);
    rootEl.appendChild(bar);

    const diagnostics = text(doc, "p", "slate-admin__diagnostics", "", { hidden: "" });
    rootEl.appendChild(diagnostics);

    const note = element(doc, "p", "slate-book__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    const gate = text(doc, "p", "slate-admin__gate", SIGNED_OUT, { role: "status" });
    rootEl.appendChild(gate);

    /* ---- The two panes ---- */

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

    /* A control that is offered but not now (a request in flight) is
     * disabled; one the session does not offer at all keeps `data-able`
     * and explains when pressed, as the Book's controls do. */
    function withhold(button, control, extra) {
      const can = !!able()[control] && !(extra && extra.unable);
      button.setAttribute("data-able", can ? "true" : "false");
      const reason = extra && extra.reason ? extra.reason : why(control);
      button.setAttribute("title", can ? (extra && extra.title) || "" : `Unavailable: ${reason}`);
      if (busy()) button.setAttribute("disabled", "");
      else button.removeAttribute("disabled");
    }

    /* ---- Drawing ---- */

    function drawBar() {
      const current = device();
      subtitle.textContent = open() ? deviceStatus(current, state.workspaces) : LEAD;
      diagnostics.textContent = `RT Sync user: ${current.userIdShort || "—"} · Device: ${current.deviceIdShort || "—"}`;
      diagnosticsButton.setAttribute("aria-pressed", state.diagnosticsOpen ? "true" : "false");
      show(diagnostics, state.diagnosticsOpen && open());
      show(diagnosticsButton, open());
      show(createButton, open());
      show(refreshButton, open());
      withhold(createButton, "createLine", {
        unable: !current.ready,
        reason: current.ready ? why("createLine") : "this device's RT Sync identity is not ready.",
        title: "Create a new line and connect this device to it"
      });
      withhold(refreshButton, "listWorkspaces", { title: "Read the lines again" });
      refreshButton.classList.toggle("is-busy", state.loading);
    }

    function drawList() {
      clearChildren(list);
      if (!state.workspaces.length) {
        list.appendChild(text(doc, "li", "slate-book__empty",
          state.loading ? "Reading lines…" : (state.loaded ? "No lines found." : "")));
        return;
      }
      for (const workspace of state.workspaces) {
        const item = element(doc, "li");
        const row = element(doc, "button", "slate-book__row", {
          type: "button", "data-workspace": workspace.id,
          "aria-pressed": workspace.id === state.focusId ? "true" : "false",
          title: workspace.thisDevice ? `${workspace.name} — this device is on this line` : workspace.name
        });
        if (workspace.thisDevice) {
          row.classList.add("is-connected");
          row.setAttribute("aria-label", `${workspace.name}, this device is on this line`);
        }
        row.appendChild(text(doc, "span", "slate-book__star", workspace.thisDevice ? "●" : "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "slate-book__row-name", workspace.name));
        row.appendChild(text(doc, "span", "slate-book__row-meta", rowMeta(workspace)));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawEntry(view) {
      const renaming = view.action === "rename";
      const entry = element(doc, "div", "slate-book__entry", { "data-entry": view.action });
      entry.appendChild(text(doc, "span", "slate-book__entry-label", renaming
        ? "The line's name, as every connected device will see it"
        : "A new line, created with this device's current setup and connected to it"));
      const input = element(doc, "input", "slate-book__name", {
        type: "text", autocomplete: "off", spellcheck: "false", enterkeyhint: "done", maxlength: "80",
        placeholder: "Line name", "aria-label": "Line name", "data-field": "name"
      });
      input.value = view.value || "";
      const save = text(doc, "button", PRIMARY, renaming ? "Save Name" : "Create Line", { type: "button", "data-action": "confirm-entry" });
      const cancel = text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-view" });
      if (busy()) save.setAttribute("disabled", "");
      for (const node of [input, save, cancel]) entry.appendChild(node);
      input.addEventListener("keydown", event => {
        if (!event) return;
        if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); void confirmEntry(); }
        else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeView(); }
      });
      return entry;
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

    function drawDevices(workspace) {
      const section = element(doc, "section", "slate-admin__devices", { "aria-label": "Linked devices" });
      const head = element(doc, "div", "slate-admin__section-head");
      const reading = state.devicesFor === workspace.id;
      head.appendChild(text(doc, "h4", "slate-admin__section-title", reading
        ? `Linked devices · ${state.devices.length}`
        : "Linked devices"));
      const again = text(doc, "button", QUIET, "Refresh", { type: "button", "data-action": "refresh-devices" });
      withhold(again, "devices", { title: "Read this line's devices again" });
      head.appendChild(again);
      section.appendChild(head);
      section.appendChild(text(doc, "p", "slate-admin__section-note", DEVICE_NOTE));

      const rows = element(doc, "ol", "slate-admin__device-list");
      if (!reading) {
        rows.appendChild(text(doc, "li", "slate-book__empty", state.pending === "workspaceDevices" ? "Reading linked devices…" : ""));
      } else if (!state.devices.length) {
        rows.appendChild(text(doc, "li", "slate-book__empty", "No linked devices."));
      }
      for (const linked of (reading ? state.devices : [])) {
        const row = element(doc, "li", "slate-admin__device-row", {
          "data-member": linked.memberId, "data-role-of": linked.role
        });
        if (linked.thisDevice) row.classList.add("is-this-device");
        row.appendChild(text(doc, "span", "slate-admin__device-name", linked.label || "Unnamed device"));
        row.appendChild(text(doc, "span", "slate-admin__device-role", linked.role));
        const seen = formatWhen(linked.lastSeenAt);
        row.appendChild(text(doc, "span", "slate-admin__device-seen", seen ? `seen ${seen}` : "never seen"));
        row.appendChild(text(doc, "span", "slate-admin__device-self", linked.thisDevice ? "this device" : ""));
        const actions = element(doc, "span", "slate-admin__device-actions");
        if (linked.role === "member") {
          const owner = text(doc, "button", ACTION, "Make Owner", { type: "button", "data-action": "make-owner", "data-member": linked.memberId });
          withhold(owner, "transferOwnership");
          actions.appendChild(owner);
        }
        const disconnect = text(doc, "button", DANGER, "Disconnect", { type: "button", "data-action": "disconnect", "data-member": linked.memberId });
        withhold(disconnect, "disconnectDevice");
        actions.appendChild(disconnect);
        row.appendChild(actions);
        rows.appendChild(row);
      }
      section.appendChild(rows);
      return section;
    }

    function drawMaintenance(workspace) {
      const section = element(doc, "section", "slate-admin__maintenance", { "aria-label": "Line maintenance" });
      const toggle = element(doc, "button", "slate-admin__fold", {
        type: "button", "data-action": "toggle-maintenance", "aria-expanded": state.maintenanceOpen ? "true" : "false"
      });
      toggle.appendChild(text(doc, "span", "slate-admin__fold-mark", state.maintenanceOpen ? "▾" : "▸", { "aria-hidden": "true" }));
      toggle.appendChild(text(doc, "span", "slate-admin__fold-title", "Line maintenance"));
      toggle.appendChild(text(doc, "span", "slate-admin__fold-note", "Reassign ownership, merge, delete"));
      section.appendChild(toggle);
      const body = element(doc, "div", "slate-admin__maintenance-body", { hidden: state.maintenanceOpen ? null : "" });

      // Reassign ownership to this device: offered only for a device that
      // is already on the line and is not already its owner.
      const mine = state.devicesFor === workspace.id ? state.devices.find(linked => linked.thisDevice) || null : null;
      const ownership = element(doc, "div", "slate-admin__maintenance-item");
      ownership.appendChild(text(doc, "h4", "slate-admin__maintenance-title", "Reassign ownership to this device"));
      ownership.appendChild(text(doc, "p", "slate-admin__maintenance-copy",
        "Use only when the current owner's device is genuinely gone. The previous owner is demoted, not disconnected."));
      const transfer = text(doc, "button", ACTION, "Reassign Ownership to This Device", { type: "button", "data-action": "transfer-to-this-device" });
      withhold(transfer, "transferOwnership", {
        unable: !device().ready || !mine || mine.role === "owner",
        reason: !device().ready ? "this device's RT Sync identity is not ready."
          : (!mine ? "this device is not on this line yet: add it first."
            : (mine.role === "owner" ? "this device already owns this line." : why("transferOwnership")))
      });
      ownership.appendChild(transfer);
      body.appendChild(ownership);

      // Merge: the target is one of the other lines.
      const targets = state.workspaces.filter(other => other.id !== workspace.id);
      if (!targets.some(other => other.id === state.mergeTargetId)) state.mergeTargetId = null;
      const mergeItem = element(doc, "div", "slate-admin__maintenance-item");
      mergeItem.appendChild(text(doc, "h4", "slate-admin__maintenance-title", "Merge into another line"));
      mergeItem.appendChild(text(doc, "p", "slate-admin__maintenance-copy",
        "The target keeps its active job and linked devices. Existing same-name configurations are preserved."));
      const chips = element(doc, "div", "slate-admin__targets", { role: "radiogroup", "aria-label": "Merge into" });
      chips.appendChild(text(doc, "span", "slate-admin__targets-label", "Merge into"));
      if (!targets.length) chips.appendChild(text(doc, "span", "slate-admin__targets-none", "no other line"));
      for (const other of targets) {
        const chip = text(doc, "button", "slate-admin__chip", other.name, {
          type: "button", role: "radio", "data-target": other.id,
          "aria-checked": other.id === state.mergeTargetId ? "true" : "false"
        });
        if (busy()) chip.setAttribute("disabled", "");
        chips.appendChild(chip);
      }
      mergeItem.appendChild(chips);
      const merge = text(doc, "button", DANGER, "Merge & Delete This Line", { type: "button", "data-action": "merge" });
      withhold(merge, "merge", {
        unable: !state.mergeTargetId,
        reason: state.mergeTargetId ? why("merge") : "choose the line to merge into first."
      });
      mergeItem.appendChild(merge);
      body.appendChild(mergeItem);

      const removal = element(doc, "div", "slate-admin__maintenance-item is-danger");
      removal.appendChild(text(doc, "h4", "slate-admin__maintenance-title", "Delete line"));
      removal.appendChild(text(doc, "p", "slate-admin__maintenance-copy", "This cannot be undone."));
      const remove = text(doc, "button", DANGER, "Delete Line", { type: "button", "data-action": "delete" });
      withhold(remove, "deleteWorkspace");
      removal.appendChild(remove);
      body.appendChild(removal);

      section.appendChild(body);
      return section;
    }

    function drawDetail() {
      clearChildren(detailPane);
      if (state.view && state.view.kind === "entry") { detailPane.appendChild(drawEntry(state.view)); return; }
      if (state.view && state.view.kind === "confirm") { detailPane.appendChild(drawConfirm(state.view)); return; }
      const workspace = chosen();
      if (!workspace) {
        detailPane.appendChild(text(doc, "p", "slate-book__hint", state.workspaces.length
          ? "Select a line to see its linked devices and what can be done to it."
          : ""));
        return;
      }
      const head = element(doc, "div", "slate-admin__detail-head");
      head.appendChild(text(doc, "h3", "slate-book__detail-name", workspace.name));
      head.appendChild(text(doc, "p", "slate-admin__detail-meta", detailMeta(workspace)));
      detailPane.appendChild(head);

      const actions = element(doc, "div", "slate-book__actions");
      if (workspace.thisDevice) {
        actions.appendChild(text(doc, "span", "slate-admin__connected", "This device is on this line"));
      } else {
        const add = text(doc, "button", PRIMARY, "Add This Device", { type: "button", "data-action": "add-this-device" });
        withhold(add, "addDevice", {
          unable: !device().ready,
          reason: device().ready ? why("addDevice") : "this device's RT Sync identity is not ready.",
          title: "Put this device back on the line"
        });
        actions.appendChild(add);
      }
      const rename = text(doc, "button", ACTION, "Rename Line", { type: "button", "data-action": "rename-line" });
      withhold(rename, "renameLine");
      actions.appendChild(rename);
      detailPane.appendChild(actions);

      detailPane.appendChild(drawDevices(workspace));
      detailPane.appendChild(drawMaintenance(workspace));
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

    /* One request at a time, the pane redrawn before and after, and the
     * bridge's own answer handed back. */
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

    /** A refusal: the session ending drops everything, anything else is said. */
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
        result = await run("listWorkspaces", () => actionsModule.listWorkspaces(admin));
      } finally {
        state.loading = false;
      }
      if (!result.ok) return failed(result, "The lines could not be read.");
      state.workspaces = result.workspaces.slice();
      state.loaded = true;
      if (state.focusId && !chosen()) { state.focusId = null; state.devices = []; state.devicesFor = null; }
      setNote(`${plural(state.workspaces.length, "line")} loaded.`, "ok");
      paint();
      return result;
    }

    async function readDevices(id) {
      setNote("Loading the line's devices…");
      const result = await run("workspaceDevices", () => actionsModule.workspaceDevices(admin, id));
      if (!result.ok) return failed(result, "The line's devices could not be read.");
      // The operator may have moved on while the application answered.
      if (state.focusId === id) {
        state.devices = result.devices.slice();
        state.devicesFor = id;
        setNote("");
      }
      paint();
      return result;
    }

    /* A row click while a request is in flight is refused: the request's
     * own answer writes the chosen line and its devices when it lands,
     * and it would land on whatever had been chosen meanwhile. The
     * buttons disable themselves for the same moment; a row cannot, so
     * it is turned away here. (reload() reaches this after its request
     * has finished, so nothing is in flight and it passes through.) */
    async function choose(id) {
      if (busy()) { say(BUSY_WAIT); return null; }
      state.focusId = id || null;
      state.view = null;
      state.mergeTargetId = null;
      if (state.devicesFor !== id) { state.devices = []; state.devicesFor = null; }
      paint();
      if (!id) return null;
      return readDevices(id);
    }

    /** After a change: the list again, then the line again. */
    async function reload(id) {
      await load();
      if (id && state.workspaces.some(workspace => workspace.id === id)) await choose(id);
    }

    /* ---- The right pane's other faces ---- */

    function focusIn(selector) {
      const node = detailPane.querySelector(selector);
      if (node && typeof node.focus === "function") node.focus();
      return node;
    }

    function openEntry(action) {
      const workspace = chosen();
      if (action === "rename" && !workspace) return;
      if (action === "create" && !device().ready) { setNote(NOT_READY, "error"); paint(); return; }
      state.view = { kind: "entry", action, value: action === "rename" ? workspace.name : "" };
      setNote("");
      paint();
      const input = focusIn("[data-field='name']");
      if (input && action === "rename" && typeof input.select === "function") input.select();
    }

    function ask(view) {
      state.view = Object.assign({ kind: "confirm" }, view);
      setNote("");
      paint();
      focusIn("[data-action='confirm-view']");
    }

    function closeView() {
      if (!state.view) return;
      state.view = null;
      paint();
    }

    async function confirmEntry() {
      const view = state.view;
      if (!view || view.kind !== "entry" || busy()) return null;
      const input = detailPane.querySelector("[data-field='name']");
      const name = actionsModule.cleanName(input && input.value);
      if (!name) {
        if (input) input.setAttribute("aria-invalid", "true");
        setNote("Enter a line name.", "error");
        return null;
      }
      if (view.action === "rename") {
        const workspace = chosen();
        if (!workspace) return null;
        setNote("Renaming line…");
        const result = await run("renameLine", () => actionsModule.renameLine(admin, workspace.id, name));
        if (!result.ok) return failed(result, "The line could not be renamed.");
        state.view = null;
        await reload(workspace.id);
        setNote(`Renamed the line to ${name}.`, "ok");
        paint();
        return result;
      }
      setNote("Creating line…");
      const result = await run("createLine", () => actionsModule.createLine(admin, name));
      if (!result.ok) return failed(result, "The line could not be created. Nothing was changed.");
      state.view = null;
      await reload(result.id || null);
      setNote(`Created ${name} and connected this device.`, "ok");
      paint();
      return result;
    }

    function confirmView() {
      const view = state.view;
      if (!view || view.kind !== "confirm" || typeof view.run !== "function" || busy()) return null;
      return view.run();
    }

    /* ---- The procedures, each asked first ---- */

    function askAddThisDevice() {
      const workspace = chosen();
      if (!workspace) return;
      if (!device().ready) { setNote(NOT_READY, "error"); paint(); return; }
      ask({
        action: "addThisDevice", title: "Put This Device Back On The Line", label: "Add This Device", danger: false,
        lines: addDeviceLines(workspace, device().label),
        run: async () => {
          setNote("Connecting this device…");
          const result = await run("addThisDevice", () => actionsModule.addThisDevice(admin, workspace.id));
          if (!result.ok) return failed(result, "This device could not be added.");
          state.view = null;
          await reload(workspace.id);
          setNote(result.alreadyMember
            ? `This device was already on ${workspace.name}.`
            : `This device is now on ${workspace.name}.`, "ok");
          paint();
          return result;
        }
      });
    }

    function askOwnership(memberId, newOwnerLabel) {
      const workspace = chosen();
      if (!workspace || !memberId) return;
      ask({
        action: "transferOwnership", title: "Reassign Ownership", label: "Reassign Ownership", danger: false,
        lines: ownershipLines(workspace, newOwnerLabel),
        run: async () => {
          setNote("Reassigning ownership…");
          const result = await run("transferOwnership", () => actionsModule.transferOwnership(admin, workspace.id, memberId));
          if (!result.ok) return failed(result, "Ownership could not be reassigned.");
          state.view = null;
          await reload(workspace.id);
          setNote(`${newOwnerLabel} owns ${workspace.name} now.`, "ok");
          paint();
          return result;
        }
      });
    }

    function askDisconnect(memberId) {
      const workspace = chosen();
      const linked = state.devices.find(entry => entry.memberId === memberId);
      if (!workspace || !linked) return;
      ask({
        action: "disconnectDevice", title: "Disconnect Device", label: "Disconnect", danger: true,
        lines: disconnectLines(linked),
        run: async () => {
          setNote("Disconnecting the device…");
          const result = await run("disconnectDevice", () => actionsModule.disconnectDevice(admin, workspace.id, memberId));
          if (!result.ok) return failed(result, "The device could not be disconnected.");
          state.view = null;
          await reload(workspace.id);
          setNote("Device disconnected. Its next RT Sync request will be denied.", "ok");
          paint();
          return result;
        }
      });
    }

    function askMerge() {
      const workspace = chosen();
      const target = state.workspaces.find(other => other.id === state.mergeTargetId) || null;
      if (!workspace || !target || target.id === workspace.id) return;
      ask({
        action: "mergeWorkspace", title: "Merge & Delete Line", label: "Merge & Delete", danger: true,
        lines: mergeLines(workspace, target),
        run: async () => {
          setNote("Merging the line…");
          const result = await run("mergeWorkspace", () => actionsModule.mergeWorkspace(admin, workspace.id, target.id));
          if (!result.ok) return failed(result, "The lines could not be merged.");
          state.view = null;
          state.focusId = null; state.devices = []; state.devicesFor = null; state.mergeTargetId = null;
          await load();
          setNote(`Merged ${plural(result.recipesMerged, "recipe")} and ${plural(result.profilesMerged, "weight profile")} into ${target.name}; deleted ${workspace.name}.`, "ok");
          paint();
          return result;
        }
      });
    }

    function askDelete() {
      const workspace = chosen();
      if (!workspace) return;
      ask({
        action: "deleteWorkspace", title: "Delete Line", label: "Delete Line", danger: true,
        lines: deleteLines(workspace),
        run: async () => {
          setNote("Deleting the line…");
          const result = await run("deleteWorkspace", () => actionsModule.deleteWorkspace(admin, workspace.id));
          if (!result.ok) return failed(result, "The line could not be deleted.");
          state.view = null;
          state.focusId = null; state.devices = []; state.devicesFor = null;
          await load();
          setNote(`Deleted ${workspace.name}.`, "ok");
          paint();
          return result;
        }
      });
    }

    /* ---- Access ---- */

    /** Drop everything read under a session: none of it survives one. */
    function reset() {
      state.workspaces = [];
      state.devices = [];
      state.devicesFor = null;
      state.focusId = null;
      state.loaded = false;
      state.view = null;
      state.maintenanceOpen = false;
      state.mergeTargetId = null;
      setNote("");
      paint();
    }

    /* The section's word on every admin publish and on being shown: read
     * once per session, and only for a section an operator can see. */
    function update() {
      if (!open()) {
        if (state.loaded || state.workspaces.length) reset();
        else paint();
        return;
      }
      if (!state.loaded && !state.loading && state.shown) { void load(); return; }
      paint();
    }

    rootEl.addEventListener("click", event => {
      const target = event && event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-action], [data-workspace], [data-target]")
        : null;
      if (!target || target.hasAttribute("disabled")) return;

      const workspaceId = target.getAttribute("data-workspace");
      if (workspaceId) { void choose(workspaceId === state.focusId ? null : workspaceId); return; }
      const targetId = target.getAttribute("data-target");
      if (targetId) { state.mergeTargetId = state.mergeTargetId === targetId ? null : targetId; paint(); return; }

      const action = target.getAttribute("data-action");
      if (action === "diagnostics") { state.diagnosticsOpen = !state.diagnosticsOpen; drawBar(); return; }
      if (action === "toggle-maintenance") { state.maintenanceOpen = !state.maintenanceOpen; paint(); return; }
      if (action === "cancel-view") { closeView(); return; }
      if (action === "confirm-entry") { void confirmEntry(); return; }
      if (action === "confirm-view") { void confirmView(); return; }
      // Everything below is a control the session may withhold.
      if (target.getAttribute("data-able") === "false") {
        say(`${target.textContent} is unavailable: ${(target.getAttribute("title") || "").replace(/^Unavailable: /, "")}`);
        return;
      }
      if (action === "refresh") { void load(); return; }
      if (action === "refresh-devices") { if (state.focusId) void readDevices(state.focusId); return; }
      if (action === "create-line") { openEntry("create"); return; }
      if (action === "rename-line") { openEntry("rename"); return; }
      if (action === "add-this-device") { askAddThisDevice(); return; }
      if (action === "make-owner") {
        const memberId = target.getAttribute("data-member");
        const linked = state.devices.find(entry => entry.memberId === memberId);
        if (linked) askOwnership(memberId, linked.label || "that device");
        return;
      }
      if (action === "transfer-to-this-device") {
        const mine = state.devices.find(entry => entry.thisDevice);
        if (mine) askOwnership(mine.memberId, device().label || "This device");
        return;
      }
      if (action === "disconnect") { askDisconnect(target.getAttribute("data-member")); return; }
      if (action === "merge") { askMerge(); return; }
      if (action === "delete") { askDelete(); return; }
    });

    rootEl.addEventListener("keydown", event => {
      if (!event || event.key !== "Escape" || !state.view) return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      closeView();
    });

    if (admin && typeof admin.subscribe === "function") admin.subscribe(update);
    paint();

    return Object.freeze({
      element: rootEl,
      refresh: update,
      onShow() { state.shown = true; update(); },
      onHide() { state.shown = false; state.view = null; state.maintenanceOpen = false; paint(); },
      load,
      choose,
      getState: () => ({
        focusId: state.focusId, loaded: state.loaded, loading: state.loading, pending: state.pending,
        view: state.view ? { kind: state.view.kind, action: state.view.action } : null,
        maintenanceOpen: state.maintenanceOpen, diagnosticsOpen: state.diagnosticsOpen,
        mergeTargetId: state.mergeTargetId, workspaces: state.workspaces.length,
        devices: state.devices.length, note: state.note, noteKind: state.noteKind
      })
    });
  }

  return Object.freeze({
    TITLE, LEAD, SIGNED_OUT, NO_BRIDGE, NOT_READY, DEVICE_NOTE,
    plural, formatDate, formatWhen, rowMeta, detailMeta, deviceStatus,
    addDeviceLines, ownershipLines, disconnectLines, deleteLines, mergeLines, create
  });
});
