/* The Station line console: which production line this desktop is, whether
 * it is in step with the other devices on it, and the few things an
 * operator ever needs to do about that.
 *
 * WHAT IT IS
 *
 * One compact trigger in the header - "LINE 9 · SYNCED · 3 DEVICES" - and a
 * small panel it opens. The panel names the line, states the connection as
 * the application states it, lists the devices the line knows about, and
 * offers Refresh (or Reconnect, when the line is remembered but not
 * attached), and Add device, which mints a join code and shows it as a QR
 * only once asked for. That is the whole of it: operational status, kept
 * subordinate to the production workspace beside it.
 *
 * WHERE IT READS FROM, AND WHERE IT WRITES
 *
 * Everything shown comes from ONE object: the connection descriptor the
 * application publishes through station-connection-bridge.js. This file
 * holds no workspace, no device list, no status of its own; a publish
 * replaces the descriptor and the console is redrawn from it. The two
 * things the console asks the application to do - refresh, mint a join
 * code (and draw it) - go through that same bridge's request(), which
 * carries them to the application's own RT Sync actions. Nothing here
 * knows how a join code is made, what a refresh reconciles, or where the
 * devices are recorded; it knows the words on the descriptor.
 *
 * THE ONE THING AN ADMINISTRATOR MAY DO HERE
 *
 * A desktop belongs to its production line, and an operator is offered no
 * way to change that. An ADMINISTRATOR is: when the admin bridge
 * (station-admin-bridge.js, handed in beside the connection bridge) says
 * an administrator is signed in, and the descriptor lists more than one
 * line this device remembers, the panel adds a section naming those lines
 * and lets the administrator make one of them this desktop's line. That is
 * the floor UI's own line selector, with the floor UI's own action behind
 * it (selectWorkspace, through the same letterbox), gated on this screen
 * to the administrator because a production console is not the place for
 * an operator to wander between lines. The gate is presentation: it is the
 * application that decides what the selection does, and the application
 * that refuses a line this device does not remember.
 *
 * WHAT IT NEVER DOES
 *
 * It reloads nothing: Refresh is the application's reconcile, never the
 * page. It holds no line of its own: the lines it lists are the
 * descriptor's, and the line it marks current is the descriptor's. And it
 * does not decorate: a device is "joined", because that is what the
 * application knows; nothing here calls a device online.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only, and only for this screen: whether the panel is
 * open, whether the QR view is showing and for which code, whether a
 * request is in flight (and, for a line change, which line was asked
 * for), and the last message a request produced.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationSyncConsole = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
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

  function formatWhen(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (error) {
      return date.toISOString();
    }
  }

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (error) {
      return date.toISOString();
    }
  }

  /* The trigger's three words, from the descriptor. Pure, and exported, so
   * the closed state can be tested as text. */
  function summarize(status) {
    if (!status) return null;
    const line = status.assigned && status.line ? status.line.displayName : "No line";
    const pending = status.status.pendingCount > 0 ? ` (${status.status.pendingCount})` : "";
    const state = `${status.status.label}${pending}`;
    const devices = status.assigned && status.deviceCount > 0
      ? `${status.deviceCount} device${status.deviceCount === 1 ? "" : "s"}`
      : "";
    return { line, state, devices, text: [line, state, devices].filter(Boolean).join(" · ") };
  }

  /* What the panel says under the status when there is nothing to offer,
   * or something the operator should know before pressing anything. */
  /* Whether the admin bridge, if one was handed in, says an administrator
   * is signed in on this device. Read, never cached: the bridge's window
   * is the only copy of that fact. */
  function administrator(admin) {
    if (!admin || typeof admin.getAccess !== "function") return false;
    const access = admin.getAccess();
    return !!(access && access.access && access.access.signedIn);
  }

  /* Whether the line section is on offer: an administrator, and more than
   * one line to choose between. One remembered line is not a choice, and
   * an operator is never offered one. Pure, and exported, so the gate can
   * be tested apart from the DOM. */
  function offersLines(status, admin) {
    if (!status || !status.enabled) return false;
    const lines = Array.isArray(status.workspaces) ? status.workspaces : [];
    return lines.length > 1 && administrator(admin);
  }

  function guidance(status) {
    if (!status.enabled) return "RT Sync is not available on this build. Station is showing this device's local job.";
    if (!status.assigned) return "This desktop is not assigned to a production line. Connect it through Resin.Tools RT Sync, then reopen Station.";
    if (status.status.adminRequired) return "This line is no longer available to this desktop. Ask an administrator to restore access.";
    if (!status.linked) return "This desktop is disconnected from the line on this device. Reconnect to resume shared state.";
    return "";
  }

  /**
   * Build the console.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {object} options.connection  The connection bridge (getStatus,
   *        subscribe, request). Handed in, never reached for globally.
   * @param {object} [options.admin]  The admin bridge (getAccess, subscribe),
   *        read only to learn whether an administrator is signed in. Without
   *        it the console offers no line choice, ever.
   * @param {function} [options.onOpenChange]  Told when the panel opens or
   *        closes, so the host can keep its own keyboard handling out of
   *        the way while it is open.
   */
  function create(doc, options) {
    const settings = options || {};
    const connection = settings.connection || null;
    const admin = settings.admin || null;

    const state = {
      status: null,
      open: false,
      qr: null,          // { code, svg } while the QR view is showing
      pending: null,     // the request in flight, by action name
      pendingLine: "",   // the line asked for while pending is "select-line"
      note: "",          // the last request's message, shown until the next
      noteKind: ""       // "error" | "info"
    };

    const rootEl = element(doc, "div", "station-sync", { "data-state": "none" });
    rootEl.setAttribute("hidden", "");

    /* ---- Trigger ---- */
    const trigger = element(doc, "button", "station-sync__trigger", {
      type: "button", "aria-haspopup": "dialog", "aria-expanded": "false"
    });
    const dot = element(doc, "span", "station-sync__dot", { "aria-hidden": "true" });
    const lineWord = element(doc, "span", "station-sync__line");
    const stateWord = element(doc, "span", "station-sync__state");
    const devicesWord = element(doc, "span", "station-sync__devices");
    const devicesSep = text(doc, "span", "station-sync__sep", "·", { "aria-hidden": "true" });
    for (const part of [dot, lineWord, text(doc, "span", "station-sync__sep", "·", { "aria-hidden": "true" }), stateWord, devicesSep, devicesWord]) {
      trigger.appendChild(part);
    }
    rootEl.appendChild(trigger);

    /* ---- Panel ---- */
    const panel = element(doc, "div", "station-sync__panel", { role: "dialog", "aria-label": "Line connection", tabindex: "-1" });
    panel.setAttribute("hidden", "");

    const head = element(doc, "div", "station-sync__head");
    const title = element(doc, "h3", "station-sync__title");
    const subtitle = element(doc, "p", "station-sync__subtitle");
    const close = text(doc, "button", "station-sync__close", "Close", { type: "button" });
    for (const part of [title, subtitle, close]) head.appendChild(part);
    panel.appendChild(head);

    const statusRow = element(doc, "p", "station-sync__status");
    const statusDot = element(doc, "span", "station-sync__dot", { "aria-hidden": "true" });
    const statusLabel = element(doc, "span", "station-sync__status-label");
    statusRow.appendChild(statusDot);
    statusRow.appendChild(statusLabel);
    panel.appendChild(statusRow);
    const message = element(doc, "p", "station-sync__message");
    panel.appendChild(message);
    const meta = element(doc, "p", "station-sync__meta");
    panel.appendChild(meta);

    const actions = element(doc, "div", "station-sync__actions");
    const refreshButton = text(doc, "button", "station-sync__action", "Refresh", { type: "button", "data-action": "refresh" });
    const reconnectButton = text(doc, "button", "station-sync__action is-primary", "Reconnect", { type: "button", "data-action": "reconnect" });
    const addDeviceButton = text(doc, "button", "station-sync__action", "Add device", { type: "button", "data-action": "add-device" });
    for (const part of [reconnectButton, refreshButton, addDeviceButton]) actions.appendChild(part);
    panel.appendChild(actions);

    const note = element(doc, "p", "station-sync__note", { role: "status" });
    note.setAttribute("hidden", "");
    panel.appendChild(note);

    /* The administrator's line section: built once, shown only while an
     * administrator is signed in and there is more than one line to name. */
    const linesSection = element(doc, "section", "station-sync__lines", { "aria-label": "Lines on this desktop" });
    linesSection.setAttribute("hidden", "");
    const linesHeading = element(doc, "h4", "station-sync__lines-heading");
    const linesHint = text(doc, "p", "station-sync__lines-hint",
      "Administrator: choose the line this desktop follows. Other devices keep their own line.");
    const linesList = element(doc, "ul", "station-sync__lines-items");
    for (const part of [linesHeading, linesHint, linesList]) linesSection.appendChild(part);
    panel.appendChild(linesSection);

    /* QR view: built once, shown only while a code is on offer. */
    const qrSection = element(doc, "section", "station-sync__qr", { "aria-label": "Join code" });
    qrSection.setAttribute("hidden", "");
    qrSection.appendChild(text(doc, "h4", "station-sync__heading", "Add a device"));
    const qrImage = element(doc, "div", "station-sync__qr-image", { role: "img", "aria-label": "Join QR code" });
    const qrCode = element(doc, "p", "station-sync__code");
    const qrHint = element(doc, "p", "station-sync__hint");
    const qrDone = text(doc, "button", "station-sync__action", "Done", { type: "button", "data-action": "qr-done" });
    for (const part of [qrImage, qrCode, qrHint, qrDone]) qrSection.appendChild(part);
    panel.appendChild(qrSection);

    const devicesSection = element(doc, "section", "station-sync__device-list", { "aria-label": "Joined devices" });
    const devicesHeading = element(doc, "h4", "station-sync__heading");
    const devicesList = element(doc, "ul", "station-sync__devices-items");
    const devicesEmpty = element(doc, "p", "station-sync__hint");
    for (const part of [devicesHeading, devicesList, devicesEmpty]) devicesSection.appendChild(part);
    panel.appendChild(devicesSection);

    rootEl.appendChild(panel);

    /* ---- Rendering ---- */

    function setNote(kind, value) {
      state.noteKind = value ? kind : "";
      state.note = value || "";
      note.textContent = state.note;
      note.setAttribute("data-kind", state.noteKind);
      show(note, !!state.note);
    }

    function renderTrigger(status) {
      const summary = summarize(status);
      lineWord.textContent = summary.line;
      stateWord.textContent = summary.state;
      devicesWord.textContent = summary.devices;
      show(devicesWord, !!summary.devices);
      show(devicesSep, !!summary.devices);
      trigger.setAttribute("aria-label", `Line connection: ${summary.text}`);
      trigger.setAttribute("title", status.status.message || summary.text);
    }

    function renderDevices(status) {
      clearChildren(devicesList);
      const count = status.devices.length;
      devicesHeading.textContent = count ? `Joined devices (${count})` : "Joined devices";
      show(devicesSection, status.assigned);
      show(devicesEmpty, count === 0);
      devicesEmpty.textContent = status.linked
        ? "No device details are available yet. Refresh to load them."
        : "Device details load once the line is connected.";
      for (const device of status.devices) {
        const item = element(doc, "li", "station-sync__device");
        if (device.thisDevice) item.classList.add("is-this-device");
        const name = text(doc, "span", "station-sync__device-name", device.label);
        const facts = [];
        if (device.thisDevice) facts.push("This desktop");
        if (device.role === "owner") facts.push("Owner");
        const joined = formatWhen(device.joinedAt);
        if (joined) facts.push(`Joined ${joined}`);
        const detail = text(doc, "span", "station-sync__device-detail", facts.join(" · ") || "Joined device");
        item.appendChild(name);
        item.appendChild(detail);
        devicesList.appendChild(item);
      }
    }

    function renderLines(status) {
      clearChildren(linesList);
      const offer = offersLines(status, admin);
      show(linesSection, offer);
      if (!offer) return;
      const lines = status.workspaces;
      linesHeading.textContent = `Lines on this desktop (${lines.length})`;
      const busy = state.pending !== null || status.busy.active;
      const currentId = status.assigned && status.line ? status.line.workspaceId : "";
      for (const line of lines) {
        const item = element(doc, "li", "station-sync__line-item");
        const current = !!currentId && line.id === currentId;
        const asked = state.pending === "select-line" && state.pendingLine === line.id;
        const button = element(doc, "button", "station-sync__line-option", {
          type: "button", "data-action": "select-line", "data-id": line.id,
          "aria-pressed": current ? "true" : "false"
        });
        if (current) button.classList.add("is-current");
        // The current line is named, not offered: pressing it would ask
        // the application for the line it already has.
        button.disabled = busy || !status.can.select || current;
        const name = text(doc, "span", "station-sync__line-name", line.displayName);
        const facts = [];
        if (current) facts.push("This desktop's line");
        if (line.name && line.name !== line.displayName) facts.push(line.name);
        if (asked) facts.push("Connecting…");
        const detail = text(doc, "span", "station-sync__line-detail", facts.join(" · "));
        show(detail, facts.length > 0);
        button.appendChild(name);
        button.appendChild(detail);
        button.addEventListener("click", () => { void selectLine(line.id); });
        item.appendChild(button);
        linesList.appendChild(item);
      }
    }

    function renderQr(status) {
      /* The QR view shows the code it was opened for and no other. A newer
       * code on the descriptor, a line that is no longer linked, or no
       * code at all means what is on screen would be stale, and it goes. */
      if (state.qr) {
        const current = status.joinCode ? status.joinCode.code : null;
        if (!status.linked || (current !== null && current !== state.qr.code)) state.qr = null;
      }
      show(qrSection, !!state.qr);
      if (!state.qr) {
        qrImage.innerHTML = "";
        qrCode.textContent = "";
        qrHint.textContent = "";
        return;
      }
      qrImage.innerHTML = state.qr.svg;
      qrCode.textContent = state.qr.code;
      const expires = status.joinCode && status.joinCode.code === state.qr.code ? formatTime(status.joinCode.expiresAt) : "";
      qrHint.textContent = `Scan with the device's camera, or open Resin.Tools RT Sync on it and enter the code.${expires ? ` One-time use; expires at ${expires}.` : " One-time use."}`;
    }

    function renderPanel(status) {
      title.textContent = status.assigned && status.line ? status.line.displayName : "No line assigned";
      const workspaceName = status.assigned && status.line ? status.line.name : "";
      const showSubtitle = !!workspaceName && workspaceName !== title.textContent;
      subtitle.textContent = showSubtitle ? workspaceName : "";
      show(subtitle, showSubtitle);

      statusLabel.textContent = status.busy.active
        ? (status.busy.action === "refresh" ? "Refreshing…" : status.busy.action === "generate-code" ? "Generating join code…" : "Working…")
        : status.status.label;
      message.textContent = status.status.message;
      show(message, !!status.status.message);

      const metaParts = [];
      const last = formatWhen(status.status.lastSyncAt);
      if (last) metaParts.push(`Last sync ${last}`);
      if (status.status.pendingCount > 0) metaParts.push(`${status.status.pendingCount} change${status.status.pendingCount === 1 ? "" : "s"} waiting to sync`);
      meta.textContent = metaParts.join(" · ");
      show(meta, metaParts.length > 0);

      const busy = state.pending !== null || status.busy.active;
      show(reconnectButton, status.can.reconnect || (!!status.line && !status.linked && !status.status.adminRequired));
      show(refreshButton, status.enabled && status.linked);
      show(addDeviceButton, status.enabled && status.linked);
      reconnectButton.disabled = busy || !status.can.reconnect;
      refreshButton.disabled = busy || !status.can.refresh;
      addDeviceButton.disabled = busy || !status.can.addDevice;
      refreshButton.textContent = state.pending === "refresh" ? "Refreshing…" : "Refresh";
      reconnectButton.textContent = state.pending === "reconnect" ? "Reconnecting…" : "Reconnect";
      addDeviceButton.textContent = state.pending === "add-device" ? "Preparing code…" : "Add device";
      show(actions, status.enabled && status.assigned);

      const help = guidance(status);
      // A request's own message outranks the standing guidance while it
      // stands; the guidance returns when the note is cleared.
      if (!state.note && help) {
        note.textContent = help;
        note.setAttribute("data-kind", "info");
        show(note, true);
      } else if (!state.note) {
        show(note, false);
      }

      renderLines(status);
      renderQr(status);
      renderDevices(status);
    }

    function render() {
      const status = state.status;
      if (!status) {
        rootEl.setAttribute("hidden", "");
        rootEl.setAttribute("data-state", "none");
        if (state.open) closePanel();
        return;
      }
      rootEl.removeAttribute("hidden");
      rootEl.setAttribute("data-state", status.status.known ? status.status.key : "unknown");
      rootEl.setAttribute("data-linked", status.linked ? "true" : "false");
      renderTrigger(status);
      renderPanel(status);
    }

    /* ---- Open / close ---- */

    function onDocumentPointerDown(event) {
      if (!state.open) return;
      const target = event.target;
      if (target && rootEl.contains && rootEl.contains(target)) return;
      closePanel();
    }

    function openPanel() {
      if (state.open || !state.status) return;
      state.open = true;
      show(panel, true);
      trigger.setAttribute("aria-expanded", "true");
      rootEl.classList.add("is-open");
      doc.addEventListener("pointerdown", onDocumentPointerDown, true);
      if (typeof panel.focus === "function") panel.focus();
      if (typeof settings.onOpenChange === "function") settings.onOpenChange(true);
    }

    function closePanel() {
      if (!state.open) return;
      state.open = false;
      // Closing the panel clears the QR view with it: a code is shown only
      // while it was asked for, never left behind on the next open.
      state.qr = null;
      setNote("", "");
      show(panel, false);
      trigger.setAttribute("aria-expanded", "false");
      rootEl.classList.remove("is-open");
      doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      if (state.status) renderPanel(state.status);
      if (typeof trigger.focus === "function") trigger.focus();
      if (typeof settings.onOpenChange === "function") settings.onOpenChange(false);
    }

    /* ---- Requests ---- */

    /* Focus is parked on the panel for the duration of a request. The
     * buttons disable while one runs, and a disabled button drops the
     * focus it held to the body - which would put Escape out of the
     * panel's reach and the next Tab at the top of the page. */
    function parkFocus() {
      const active = doc.activeElement;
      const held = active && panel.contains && panel.contains(active) ? active : null;
      if (held && typeof panel.focus === "function") panel.focus();
      return held;
    }

    function restoreFocus(held) {
      if (!held || !state.open || held.disabled || typeof held.focus !== "function") return;
      if (held.hasAttribute && held.hasAttribute("hidden")) return;
      // A line button is rebuilt on every render; the one that was pressed
      // is gone by now, and focus stays parked on the panel.
      if (panel.contains && !panel.contains(held)) return;
      held.focus();
    }

    async function ask(name, actionKey, args) {
      if (!connection || state.pending) return null;
      state.pending = actionKey;
      setNote("", "");
      const held = parkFocus();
      render();
      let result;
      try {
        result = args ? await connection.request(name, args) : await connection.request(name);
      } finally {
        state.pending = null;
        state.pendingLine = "";
      }
      render();
      restoreFocus(held);
      return result || { ok: false, code: "internal", message: "No answer from the application." };
    }

    async function refresh(actionKey) {
      const result = await ask(actionKey === "reconnect" ? "reconnect" : "refresh", actionKey);
      if (!result) return;
      if (!result.ok) setNote("error", result.message || "The line could not be refreshed.");
      render();
    }

    async function addDevice() {
      const minted = await ask("generateJoinCode", "add-device");
      if (!minted) return;
      if (!minted.ok) { setNote("error", minted.message || "A join code could not be generated."); render(); return; }
      state.pending = "add-device";
      let drawn;
      try {
        drawn = await connection.request("renderJoinQr");
      } finally {
        state.pending = null;
      }
      if (drawn && drawn.ok && drawn.svg && drawn.code) {
        state.qr = { code: String(drawn.code), svg: String(drawn.svg) };
      } else {
        setNote("error", (drawn && drawn.message) || "The QR code could not be drawn.");
      }
      render();
    }

    /* Make one of the remembered lines this desktop's line. Offered only
     * while offersLines() holds (the buttons exist only then), and asked
     * of the application by id alone: the bridge checks the id, the
     * application refuses one this device does not remember, and the new
     * line - if it is new - arrives on the next descriptor like any other
     * connection change. Nothing is chosen here. */
    async function selectLine(id) {
      if (!offersLines(state.status, admin)) return;
      state.pendingLine = id;
      const result = await ask("selectWorkspace", "select-line", { id });
      if (!result) return;
      if (!result.ok) setNote("error", result.message || "That line could not be selected.");
      render();
    }

    trigger.addEventListener("click", () => { if (state.open) closePanel(); else openPanel(); });
    close.addEventListener("click", closePanel);
    refreshButton.addEventListener("click", () => { void refresh("refresh"); });
    reconnectButton.addEventListener("click", () => { void refresh("reconnect"); });
    addDeviceButton.addEventListener("click", () => { void addDevice(); });
    qrDone.addEventListener("click", () => { state.qr = null; render(); });
    /* Escape anywhere in the console while the panel is open - the panel
     * itself, or the trigger - is the panel's: it closes the QR view first,
     * then the panel, and is not passed on to close the open layer. */
    rootEl.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !state.open) return;
      event.stopPropagation();
      if (event.preventDefault) event.preventDefault();
      if (state.qr) { state.qr = null; render(); return; }
      closePanel();
    });

    /* ---- Subscription ---- */

    function update(status) {
      state.status = status || null;
      render();
    }

    let unsubscribe = () => {};
    if (connection && typeof connection.subscribe === "function") {
      unsubscribe = connection.subscribe(update);
      update(typeof connection.getStatus === "function" ? connection.getStatus() : null);
    } else {
      render();
    }
    /* An administrator signing in or out changes what the panel offers
     * and nothing else; the descriptor is redrawn as it stands. */
    let unsubscribeAdmin = () => {};
    if (admin && typeof admin.subscribe === "function") {
      unsubscribeAdmin = admin.subscribe(() => { if (state.status) render(); });
    }

    return Object.freeze({
      element: rootEl,
      update,
      open: openPanel,
      close: closePanel,
      isOpen: () => state.open,
      showingQr: () => !!state.qr,
      destroy() {
        unsubscribe();
        unsubscribeAdmin();
        if (state.open) closePanel();
      }
    });
  }

  return Object.freeze({ create, summarize, guidance, offersLines });
});
