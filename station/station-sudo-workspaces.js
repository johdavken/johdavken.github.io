/* Workspace Management: Sudo's first tool (station-sudo.js).
 *
 * WHAT IT IS
 *
 * The RT Sync workspaces - the production lines - and their linked
 * devices, for an administrator: which lines exist, who is on each, and
 * the procedures around them. Add this device to a line; rename or create
 * one; reassign a line's ownership, disconnect a device; and, kept folded
 * away, merge a duplicate line into another or delete one. The same
 * procedures the floor UI's Workspace Management panel offers, in the
 * Handbook's fixed bench: a narrow list of lines on the left, the chosen
 * line on the right, each scrolling on its own.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything comes through station-admin-bridge.js. The list is the
 * answer to one request (listWorkspaces), the devices to another
 * (workspaceDevices); every change is a request the application answers
 * with its own admin procedure, and the list is re-read after. Nothing
 * here knows a table, a procedure or a session; a workspace's identity is
 * an opaque id the bridge handed over, and a device's is the same. What
 * the list shows is what the application last answered - it is read
 * again on Refresh, after every change, and when access is regained, and
 * it is dropped the moment access is lost.
 *
 * ASKING FIRST
 *
 * A change that reaches other devices - adding this one, reassigning an
 * owner, disconnecting, merging, deleting - is confirmed in place, on the
 * right pane, with the same words the floor UI's dialogs use: what it
 * will do, what it will not. Nothing is asked in a window over Station.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: the last answered list and devices, which line
 * is chosen, what the right pane is showing (the line, a name entry, a
 * confirmation), whether maintenance is unfolded, a request in flight,
 * the last message.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationSudoWorkspaces = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ID = "workspaces";
  const TITLE = "Workspace Management";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const ACTION = "station-handbook__action";
  const PRIMARY = `${ACTION} is-primary`;
  const QUIET = `${ACTION} is-quiet`;
  const DANGER = `${ACTION} is-danger`;
  const UTILITY = "station-handbook__utility";

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

  /* The two glyphs this tool draws, 16 by 16, stroked in the current
   * colour (handbook.css): a refresh arrow, and an "i" for diagnostics. */
  function refreshGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-handbook__glyph", {
      viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.2 8.6 A 5.2 5.2 0 1 1 11.9 4.3" }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 13.4 2.6 L 13.4 5.8 L 10.2 5.8" }));
    return svg;
  }

  function infoGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-handbook__glyph", {
      viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "circle", "station-handbook__glyph-stroke", { cx: 8, cy: 8, r: 6.2 }));
    svg.appendChild(svgNode(doc, "path", "station-handbook__glyph-stroke", { d: "M 8 7.2 L 8 11.4" }));
    svg.appendChild(svgNode(doc, "circle", "station-handbook__glyph-fill", { cx: 8, cy: 4.9, r: 0.9 }));
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

  /** One line under a workspace's name: its members, recipes, profiles. */
  function rowMeta(workspace) {
    return [
      plural(workspace.memberCount, "member"),
      plural(workspace.recipeCount, "recipe"),
      plural(workspace.profileCount, "profile")
    ].join(" · ");
  }

  /** The chosen workspace's summary line: created, and the same counts. */
  function detailMeta(workspace) {
    const parts = [];
    const created = formatDate(workspace.createdAt);
    if (created) parts.push(`Created ${created}`);
    parts.push(plural(workspace.memberCount, "member"), plural(workspace.recipeCount, "recipe"),
      plural(workspace.profileCount, "weight profile"));
    return parts.join(" · ");
  }

  /** This device's status line for the strip. */
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
   * Build the tool.
   *
   * @param {Document} doc
   * @param {object} context
   * @param {object|null} context.admin      the admin bridge (getAccess,
   *        request). Handed in, never reached for.
   * @param {Element} [context.statusSlot]   where this device's status
   *        line goes - the strip above the tool (station-sudo.js)
   * @param {function} [context.visible]     () => whether the tool is on
   *        screen; the list is read only for a page an operator can see
   */
  function create(doc, context) {
    const settings = context || {};
    const admin = settings.admin || null;
    const visible = typeof settings.visible === "function" ? settings.visible : () => true;

    const state = {
      workspaces: [],
      devices: [],
      devicesFor: null,     // the workspace id the devices were read for
      focusId: null,        // the chosen workspace
      loaded: false,
      loading: false,
      pending: null,        // the request in flight, by action
      view: null,           // null (the line) | { kind: "entry", action } | { kind: "confirm", ... }
      maintenanceOpen: false,
      diagnosticsOpen: false,
      mergeTargetId: null,
      note: "",
      noteKind: ""
    };
    let access = null;      // the last access the bridge published, as handed to update()

    const rootEl = element(doc, "div", "station-sudo-ws", { "data-role": "workspace-management" });

    /* ---- This device, in the strip; its diagnostics, under it ---- */
    const status = element(doc, "span", "station-sudo-ws__device");
    const statusText = element(doc, "span", "station-sudo-ws__device-text");
    const diagnosticsButton = element(doc, "button", UTILITY, {
      type: "button", "data-action": "diagnostics", "aria-label": "Diagnostic details", title: "Diagnostic details", "aria-pressed": "false"
    });
    diagnosticsButton.appendChild(infoGlyph(doc));
    status.appendChild(statusText); status.appendChild(diagnosticsButton);
    if (settings.statusSlot && typeof settings.statusSlot.appendChild === "function") settings.statusSlot.appendChild(status);
    else rootEl.appendChild(status);
    const diagnostics = element(doc, "p", "station-sudo-ws__diagnostics", { hidden: "" });
    rootEl.appendChild(diagnostics);

    const note = element(doc, "p", "station-sudo-ws__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    /* ---- The two panes ---- */
    const columns = element(doc, "div", "station-sudo-ws__columns");
    rootEl.appendChild(columns);

    const listPane = element(doc, "section", "station-sudo-ws__list-pane", { "aria-label": "Workspaces" });
    const listHead = element(doc, "div", "station-sudo-ws__pane-head");
    const listTitle = element(doc, "span", "station-sudo-ws__eyebrow");
    listTitle.appendChild(text(doc, "span", "", "Workspaces"));
    const listCount = text(doc, "span", "station-sudo-ws__count", "", { "aria-label": "Workspace count" });
    listTitle.appendChild(listCount);
    listHead.appendChild(listTitle);
    const createButton = text(doc, "button", ACTION, "Create Line", { type: "button", "data-action": "create-line" });
    const refreshButton = element(doc, "button", UTILITY, {
      type: "button", "data-action": "refresh", "aria-label": "Refresh", title: "Refresh the workspace list"
    });
    refreshButton.appendChild(refreshGlyph(doc));
    const listActions = element(doc, "span", "station-sudo-ws__pane-actions");
    listActions.appendChild(createButton); listActions.appendChild(refreshButton);
    listHead.appendChild(listActions);
    listPane.appendChild(listHead);
    const list = element(doc, "ol", "station-sudo-ws__list", { "aria-label": "Workspaces" });
    listPane.appendChild(list);
    columns.appendChild(listPane);

    const detailPane = element(doc, "section", "station-sudo-ws__detail-pane", { "aria-label": "Selected workspace", "aria-live": "polite" });
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
      return state.workspaces.find(workspace => workspace.id === state.focusId) || null;
    }

    function device() {
      return access && access.device ? access.device : { ready: false, label: "", userIdShort: "", deviceIdShort: "" };
    }

    function busy() {
      return !!state.pending || state.loading;
    }

    /* ---- Drawing ---- */

    function drawStrip() {
      const current = device();
      statusText.textContent = deviceStatus(current, state.workspaces);
      status.setAttribute("data-ready", current.ready ? "true" : "false");
      diagnostics.textContent = `RT Sync user: ${current.userIdShort || "—"} · Device: ${current.deviceIdShort || "—"}`;
      diagnosticsButton.setAttribute("aria-pressed", state.diagnosticsOpen ? "true" : "false");
      show(diagnostics, state.diagnosticsOpen);
    }

    function drawList() {
      clearChildren(list);
      listCount.textContent = state.loaded ? String(state.workspaces.length) : "";
      createButton.disabled = busy() || !device().ready;
      createButton.setAttribute("title", device().ready
        ? "Create a new line and connect this desktop to it"
        : "RT Sync identity not ready: wait for RT Sync to connect, then create a line");
      refreshButton.disabled = busy();
      refreshButton.classList.toggle("is-busy", state.loading);
      if (!state.workspaces.length) {
        list.appendChild(text(doc, "li", "station-sudo-ws__empty",
          state.loading ? "Reading workspaces…" : (state.loaded ? "No workspaces found." : "")));
        return;
      }
      for (const workspace of state.workspaces) {
        const item = element(doc, "li");
        const row = element(doc, "button", `station-sudo-ws__row${workspace.thisDevice ? " is-connected" : ""}`, {
          type: "button", "data-workspace": workspace.id, "aria-pressed": workspace.id === state.focusId ? "true" : "false",
          title: workspace.thisDevice ? `${workspace.name} — this device is connected` : workspace.name
        });
        row.appendChild(text(doc, "span", "station-sudo-ws__row-name", workspace.name));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-mark", workspace.thisDevice ? "●" : "", { "aria-hidden": "true" }));
        row.appendChild(text(doc, "span", "station-sudo-ws__row-meta", rowMeta(workspace)));
        if (workspace.thisDevice) row.setAttribute("aria-label", `${workspace.name}, this device is connected`);
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function drawEntry(view) {
      const entry = element(doc, "div", "station-sudo-ws__entry", { "data-entry": view.action });
      const renaming = view.action === "rename";
      entry.appendChild(text(doc, "h3", "station-sudo-ws__entry-title", renaming ? "Rename Line" : "Create Line"));
      entry.appendChild(text(doc, "p", "station-sudo-ws__entry-copy", renaming
        ? "The line's name, as every connected device will see it."
        : "A new RT Sync line, created with this desktop's current setup and connected to it."));
      const row = element(doc, "div", "station-sudo-ws__entry-row");
      const input = element(doc, "input", "station-sudo-ws__name", {
        type: "text", autocomplete: "off", spellcheck: "false", maxlength: "80", placeholder: "Line name", "aria-label": "Line name", "data-field": "name"
      });
      input.value = view.value || "";
      const save = text(doc, "button", PRIMARY, renaming ? "Save Name" : "Create Line", { type: "button", "data-action": "confirm-entry" });
      const cancel = text(doc, "button", QUIET, "Cancel", { type: "button", "data-action": "cancel-view" });
      save.disabled = busy();
      row.appendChild(input); row.appendChild(save); row.appendChild(cancel);
      entry.appendChild(row);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); void confirmEntry(); }
        else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeView(); }
      });
      return entry;
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

    function drawDevices(workspace) {
      const section = element(doc, "section", "station-sudo-ws__devices", { "aria-label": "Linked devices" });
      const head = element(doc, "div", "station-sudo-ws__section-head");
      const title = element(doc, "span", "station-sudo-ws__eyebrow");
      title.appendChild(text(doc, "span", "", "Linked devices"));
      const reading = state.devicesFor === workspace.id;
      title.appendChild(text(doc, "span", "station-sudo-ws__count", reading ? String(state.devices.length) : "", { "aria-label": "Linked device count" }));
      head.appendChild(title);
      head.appendChild(text(doc, "span", "station-sudo-ws__section-note", "Disconnect revokes that identity's RT Sync access on its next read or write."));
      const refresh = element(doc, "button", UTILITY, {
        type: "button", "data-action": "refresh-devices", "aria-label": "Refresh linked devices", title: "Refresh linked devices"
      });
      refresh.appendChild(refreshGlyph(doc));
      refresh.disabled = busy();
      head.appendChild(refresh);
      section.appendChild(head);
      const rows = element(doc, "ol", "station-sudo-ws__device-list");
      if (!reading) {
        rows.appendChild(text(doc, "li", "station-sudo-ws__empty", state.pending === "workspaceDevices" ? "Reading linked devices…" : ""));
      } else if (!state.devices.length) {
        rows.appendChild(text(doc, "li", "station-sudo-ws__empty", "No linked devices."));
      }
      for (const linked of (reading ? state.devices : [])) {
        const row = element(doc, "li", `station-sudo-ws__device-row${linked.thisDevice ? " is-this-device" : ""}`, {
          "data-member": linked.memberId, "data-role-of": linked.role, title: `RT Sync user ${linked.memberId.slice(0, 8)}`
        });
        row.appendChild(text(doc, "span", "station-sudo-ws__device-name", linked.label || "Unnamed device"));
        row.appendChild(text(doc, "span", "station-sudo-ws__device-role", linked.role));
        const seen = formatWhen(linked.lastSeenAt);
        row.appendChild(text(doc, "span", "station-sudo-ws__device-seen", seen ? `seen ${seen}` : "never seen"));
        row.appendChild(text(doc, "span", "station-sudo-ws__device-self", linked.thisDevice ? "this device" : ""));
        const actions = element(doc, "span", "station-sudo-ws__device-actions");
        if (linked.role === "member") {
          const owner = text(doc, "button", ACTION, "Make Owner", { type: "button", "data-action": "make-owner", "data-member": linked.memberId });
          owner.disabled = busy();
          actions.appendChild(owner);
        }
        const disconnect = text(doc, "button", DANGER, "Disconnect", { type: "button", "data-action": "disconnect", "data-member": linked.memberId });
        disconnect.disabled = busy();
        actions.appendChild(disconnect);
        row.appendChild(actions);
        rows.appendChild(row);
      }
      section.appendChild(rows);
      return section;
    }

    function drawMaintenance(workspace) {
      const section = element(doc, "section", "station-sudo-ws__maintenance", { "aria-label": "Workspace maintenance" });
      const toggle = element(doc, "button", "station-sudo-ws__fold", {
        type: "button", "data-action": "toggle-maintenance", "aria-expanded": state.maintenanceOpen ? "true" : "false"
      });
      toggle.appendChild(text(doc, "span", "station-sudo-ws__fold-mark", state.maintenanceOpen ? "▾" : "▸", { "aria-hidden": "true" }));
      toggle.appendChild(text(doc, "span", "station-sudo-ws__eyebrow", "Workspace maintenance"));
      toggle.appendChild(text(doc, "span", "station-sudo-ws__fold-note", "Reassign ownership, merge, delete"));
      section.appendChild(toggle);
      const body = element(doc, "div", "station-sudo-ws__maintenance-body", { hidden: state.maintenanceOpen ? null : "" });

      // Reassign ownership to this device: only for a device that is on
      // the line and not already its owner - the floor UI's own rule.
      const mine = state.devicesFor === workspace.id ? state.devices.find(linked => linked.thisDevice) || null : null;
      const item1 = element(doc, "div", "station-sudo-ws__maintenance-item");
      item1.appendChild(text(doc, "h4", "station-sudo-ws__maintenance-title", "Reassign ownership to this device"));
      item1.appendChild(text(doc, "p", "station-sudo-ws__maintenance-copy",
        "Use only when the current owner's device is genuinely gone. The previous owner is demoted, not disconnected."));
      const transfer = text(doc, "button", ACTION, "Reassign Ownership to This Device", { type: "button", "data-action": "transfer-to-this-device" });
      transfer.disabled = busy() || !device().ready || !mine || mine.role === "owner";
      item1.appendChild(transfer);
      body.appendChild(item1);

      // Merge: the target is chosen from the other lines, as chips.
      const targets = state.workspaces.filter(other => other.id !== workspace.id);
      const item2 = element(doc, "div", "station-sudo-ws__maintenance-item");
      item2.appendChild(text(doc, "h4", "station-sudo-ws__maintenance-title", "Merge into another workspace"));
      item2.appendChild(text(doc, "p", "station-sudo-ws__maintenance-copy",
        "The target keeps its active job and linked devices. Existing same-name configurations are preserved."));
      const chips = element(doc, "div", "station-sudo-ws__targets", { role: "radiogroup", "aria-label": "Merge into" });
      chips.appendChild(text(doc, "span", "station-sudo-ws__targets-label", "Merge into"));
      if (!targets.length) chips.appendChild(text(doc, "span", "station-sudo-ws__targets-none", "no other workspace"));
      if (!targets.some(other => other.id === state.mergeTargetId)) state.mergeTargetId = null;
      for (const other of targets) {
        const chip = text(doc, "button", "station-handbook__chip", other.name, {
          type: "button", role: "radio", "data-target": other.id, "aria-pressed": other.id === state.mergeTargetId ? "true" : "false",
          "aria-checked": other.id === state.mergeTargetId ? "true" : "false"
        });
        chip.disabled = busy();
        chips.appendChild(chip);
      }
      item2.appendChild(chips);
      const merge = text(doc, "button", DANGER, "Merge & Delete This Workspace", { type: "button", "data-action": "merge" });
      merge.disabled = busy() || !state.mergeTargetId;
      item2.appendChild(merge);
      body.appendChild(item2);

      const item3 = element(doc, "div", "station-sudo-ws__maintenance-item is-danger");
      item3.appendChild(text(doc, "h4", "station-sudo-ws__maintenance-title", "Delete workspace"));
      item3.appendChild(text(doc, "p", "station-sudo-ws__maintenance-copy", "This cannot be undone."));
      const remove = text(doc, "button", DANGER, "Delete Workspace", { type: "button", "data-action": "delete" });
      remove.disabled = busy();
      item3.appendChild(remove);
      body.appendChild(item3);

      section.appendChild(body);
      return section;
    }

    function drawDetail() {
      clearChildren(detailPane);
      const workspace = chosen();
      if (state.view && state.view.kind === "entry") { detailPane.appendChild(drawEntry(state.view)); return; }
      if (state.view && state.view.kind === "confirm") { detailPane.appendChild(drawConfirm(state.view)); return; }
      if (!workspace) {
        detailPane.appendChild(text(doc, "p", "station-sudo-ws__empty", state.workspaces.length
          ? "Select a workspace to see its linked devices and actions."
          : ""));
        return;
      }
      const detail = element(doc, "div", "station-sudo-ws__detail");
      const head = element(doc, "div", "station-sudo-ws__detail-head");
      const identity = element(doc, "div", "station-sudo-ws__identity");
      identity.appendChild(text(doc, "h3", "station-sudo-ws__detail-name", workspace.name));
      identity.appendChild(text(doc, "p", "station-sudo-ws__detail-meta", detailMeta(workspace)));
      head.appendChild(identity);
      const actions = element(doc, "div", "station-sudo-ws__detail-actions");
      if (workspace.thisDevice) {
        actions.appendChild(text(doc, "span", "station-sudo-ws__connected", "This device is connected"));
      } else {
        const add = text(doc, "button", PRIMARY, "Add This Device", { type: "button", "data-action": "add-this-device" });
        add.disabled = busy() || !device().ready;
        add.setAttribute("title", device().ready ? "Connect this desktop to the line" : "RT Sync identity not ready: wait for RT Sync to connect, then try again");
        actions.appendChild(add);
      }
      const rename = text(doc, "button", ACTION, "Rename Line", { type: "button", "data-action": "rename-line" });
      rename.disabled = busy();
      actions.appendChild(rename);
      head.appendChild(actions);
      detail.appendChild(head);
      detail.appendChild(drawDevices(workspace));
      detail.appendChild(drawMaintenance(workspace));
      detailPane.appendChild(detail);
    }

    function refresh() {
      drawStrip();
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

    /* A lost session is the bridge's two codes; the page above this tool
     * follows the window, so here the list is simply dropped. */
    function accessLost(result) {
      return !!result && (result.code === "not_authenticated" || result.code === "access_denied");
    }

    async function load() {
      if (state.loading) return null;
      state.loading = true;
      say("Loading workspaces…");
      refresh();
      let result;
      try {
        result = await request("listWorkspaces");
      } finally {
        state.loading = false;
      }
      if (!result.ok) {
        if (accessLost(result)) { reset(); return result; }
        say(result.message || "Could not load workspaces.", "error");
        refresh();
        return result;
      }
      state.workspaces = result.workspaces.slice();
      state.loaded = true;
      if (state.focusId && !chosen()) { state.focusId = null; state.devices = []; state.devicesFor = null; }
      say(`${plural(state.workspaces.length, "workspace")} loaded.`, "ok");
      refresh();
      return result;
    }

    async function choose(id) {
      state.focusId = id || null;
      state.view = null;
      state.mergeTargetId = null;
      if (state.devicesFor !== id) { state.devices = []; state.devicesFor = null; }
      refresh();
      if (!id) return null;
      return readDevices(id);
    }

    async function readDevices(id) {
      say("Loading workspace details…");
      const result = await request("workspaceDevices", { id });
      if (!result.ok) {
        if (accessLost(result)) { reset(); return result; }
        say(result.message || "Could not load the workspace's devices.", "error");
        refresh();
        return result;
      }
      if (state.focusId === id) {
        state.devices = result.devices.slice();
        state.devicesFor = id;
        say("");
      }
      refresh();
      return result;
    }

    /* After a change: the list again, then the line again. */
    async function reload(id) {
      await load();
      if (id && state.workspaces.some(workspace => workspace.id === id)) await choose(id);
    }

    /* ---- The right pane's other faces ---- */

    function openEntry(action) {
      const workspace = chosen();
      if (action === "rename" && !workspace) return;
      if (action === "create" && !device().ready) {
        say("RT Sync identity not ready. Wait for RT Sync to connect, then try again.", "error");
        return;
      }
      state.view = { kind: "entry", action, value: action === "rename" ? workspace.name : "" };
      say("");
      refresh();
      const input = detailPane.querySelector ? detailPane.querySelector("[data-field='name']") : null;
      if (input && typeof input.focus === "function") input.focus();
      if (input && action === "rename" && typeof input.select === "function") input.select();
    }

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

    async function confirmEntry() {
      const view = state.view;
      if (!view || view.kind !== "entry") return null;
      const input = detailPane.querySelector ? detailPane.querySelector("[data-field='name']") : null;
      const name = String((input && input.value) || "").trim().replace(/\s+/g, " ");
      if (!name) {
        if (input) input.setAttribute("aria-invalid", "true");
        say("Enter a line name.", "error");
        return null;
      }
      if (view.action === "rename") {
        const workspace = chosen();
        if (!workspace) return null;
        say("Renaming line…");
        const result = await request("renameLine", { id: workspace.id, name });
        if (!result.ok) return failed(result, "The line could not be renamed.");
        state.view = null;
        await reload(workspace.id);
        say(`Renamed line to ${name}.`, "ok");
        refresh();
        return result;
      }
      say("Creating line…");
      const result = await request("createLine", { name });
      if (!result.ok) return failed(result, "Could not create the line. No changes were applied.");
      state.view = null;
      await reload(result.id || null);
      say(`Created ${name} and connected this desktop.`, "ok");
      refresh();
      return result;
    }

    async function confirmView() {
      const view = state.view;
      if (!view || view.kind !== "confirm" || typeof view.run !== "function") return null;
      return view.run();
    }

    function failed(result, fallback) {
      if (accessLost(result)) { reset(); return result; }
      say(result.message || fallback, "error");
      refresh();
      return result;
    }

    /* ---- The procedures, each asked first ---- */

    function askAddThisDevice() {
      const workspace = chosen();
      if (!workspace) return;
      if (!device().ready) { say("RT Sync identity not ready. Wait for RT Sync to connect, then try again.", "error"); return; }
      ask({
        action: "addThisDevice", title: "Reconnect This Device", label: "Add This Device", danger: false,
        lines: addDeviceLines(workspace, device().label),
        run: async () => {
          say("Connecting this device…");
          const result = await request("addThisDevice", { id: workspace.id });
          if (!result.ok) return failed(result, "This device could not be added.");
          state.view = null;
          await reload(workspace.id);
          say(`This device is now connected to ${workspace.name}.`, "ok");
          refresh();
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
          say("Reassigning ownership…");
          const result = await request("transferOwnership", { id: workspace.id, memberId });
          if (!result.ok) return failed(result, "Ownership could not be reassigned.");
          state.view = null;
          await reload(workspace.id);
          say(`${newOwnerLabel} is now the owner of ${workspace.name}.`, "ok");
          refresh();
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
          const result = await request("disconnectDevice", { id: workspace.id, memberId });
          if (!result.ok) return failed(result, "The device could not be disconnected.");
          state.view = null;
          await reload(workspace.id);
          say("Device disconnected. Its next RT Sync request will be denied.", "ok");
          refresh();
          return result;
        }
      });
    }

    function askDelete() {
      const workspace = chosen();
      if (!workspace) return;
      ask({
        action: "deleteWorkspace", title: "Delete Workspace", label: "Delete Workspace", danger: true,
        lines: deleteLines(workspace),
        run: async () => {
          say("Deleting workspace…");
          const result = await request("deleteWorkspace", { id: workspace.id });
          if (!result.ok) return failed(result, "The workspace could not be deleted.");
          state.view = null;
          state.focusId = null; state.devices = []; state.devicesFor = null;
          await load();
          say(`Deleted ${workspace.name}.`, "ok");
          refresh();
          return result;
        }
      });
    }

    function askMerge() {
      const workspace = chosen();
      const target = state.workspaces.find(other => other.id === state.mergeTargetId) || null;
      if (!workspace || !target || target.id === workspace.id) return;
      ask({
        action: "mergeWorkspace", title: "Merge & Delete Workspace", label: "Merge & Delete", danger: true,
        lines: mergeLines(workspace, target),
        run: async () => {
          say("Merging workspace…");
          const result = await request("mergeWorkspace", { id: workspace.id, targetId: target.id });
          if (!result.ok) return failed(result, "The workspaces could not be merged.");
          state.view = null;
          state.focusId = null; state.devices = []; state.devicesFor = null; state.mergeTargetId = null;
          await load();
          say(`Merged ${plural(result.recipesMerged, "recipe")} and ${plural(result.profilesMerged, "weight profile")} into ${target.name}; deleted ${workspace.name}.`, "ok");
          refresh();
          return result;
        }
      });
    }

    /* ---- Access ---- */

    /** Drop everything read under a session: nothing of it survives one. */
    function reset() {
      state.workspaces = [];
      state.devices = [];
      state.devicesFor = null;
      state.focusId = null;
      state.loaded = false;
      state.view = null;
      state.maintenanceOpen = false;
      state.mergeTargetId = null;
      say("");
      refresh();
    }

    /** The page's word on every publish, and on showing: read once per session. */
    function update(current) {
      access = current || access;
      const signedIn = !!(access && access.access && access.access.signedIn);
      if (!signedIn) { if (state.loaded || state.workspaces.length) reset(); else refresh(); return; }
      if (!state.loaded && !state.loading && visible()) { void load(); return; }
      refresh();
    }

    rootEl.addEventListener("click", event => {
      const target = event.target && event.target.closest
        ? event.target.closest("[data-action], [data-workspace], [data-target]")
        : null;
      if (!target || target.disabled) return;
      const workspaceId = target.getAttribute("data-workspace");
      if (workspaceId) { void choose(workspaceId); return; }
      const targetId = target.getAttribute("data-target");
      if (targetId) { state.mergeTargetId = state.mergeTargetId === targetId ? null : targetId; refresh(); return; }
      const action = target.getAttribute("data-action");
      if (action === "refresh") { void load(); return; }
      if (action === "refresh-devices") { if (state.focusId) void readDevices(state.focusId); return; }
      if (action === "create-line") { openEntry("create"); return; }
      if (action === "rename-line") { openEntry("rename"); return; }
      if (action === "confirm-entry") { void confirmEntry(); return; }
      if (action === "confirm-view") { void confirmView(); return; }
      if (action === "cancel-view") { closeView(); return; }
      if (action === "add-this-device") { askAddThisDevice(); return; }
      if (action === "make-owner") {
        const memberId = target.getAttribute("data-member");
        const linked = state.devices.find(entry => entry.memberId === memberId);
        if (linked) askOwnership(memberId, linked.label || "this device");
        return;
      }
      if (action === "transfer-to-this-device") {
        const mine = state.devices.find(entry => entry.thisDevice);
        if (mine) askOwnership(mine.memberId, device().label || "This device");
        return;
      }
      if (action === "disconnect") { askDisconnect(target.getAttribute("data-member")); return; }
      if (action === "toggle-maintenance") { state.maintenanceOpen = !state.maintenanceOpen; refresh(); return; }
      if (action === "merge") { askMerge(); return; }
      if (action === "delete") { askDelete(); return; }
    });
    diagnosticsButton.addEventListener("click", () => { state.diagnosticsOpen = !state.diagnosticsOpen; drawStrip(); });

    refresh();

    return {
      element: rootEl,
      update,
      reset,
      focus() {
        const first = list.querySelector ? list.querySelector("[data-workspace][aria-pressed='true'], [data-workspace]") : null;
        const target = first || createButton;
        if (target && typeof target.focus === "function" && !target.disabled) target.focus();
      },
      load,
      choose,
      getState: () => ({
        focusId: state.focusId, loaded: state.loaded, loading: state.loading, pending: state.pending,
        view: state.view ? { kind: state.view.kind, action: state.view.action } : null,
        maintenanceOpen: state.maintenanceOpen, diagnosticsOpen: state.diagnosticsOpen, mergeTargetId: state.mergeTargetId,
        workspaces: state.workspaces.length, devices: state.devices.length, note: state.note, noteKind: state.noteKind
      })
    };
  }

  /* The tool as Sudo takes it. */
  const tool = Object.freeze({ id: ID, title: TITLE, create });

  return Object.freeze({ ID, TITLE, tool, create, rowMeta, detailMeta, deviceStatus });
});
