/* RT Sync in Slate's header: the trigger at the right and the panel it
 * drops.
 *
 * The panel leads with the Line Identity - what line this device is, its
 * number, its workspace, the device's own label - then the sync status,
 * the devices on the line, a join code when one is minted, the lines an
 * administrator may choose between, joining another line, and the
 * actions. Every action is one of the connection bridge's eight; this is
 * the one Slate file that calls connection.request(), and the bridge's
 * `can` flags say which buttons are live.
 *
 * The admin bridge, when handed in, is read for one boolean (whether an
 * administrator is signed in) and never asked for anything.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* A press outside, by the shared rule - a finger closes on a still
   * release, a mouse on the press - and the Back key's stack
   * (slate-dismiss.js). */
  function dismissal(target, inside, close) {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.outside === "function" ? shared.outside(target, inside, close) : Object.freeze({ start() {}, stop() {}, isOn: () => false });
  }

  const ACTIONS = Object.freeze(["refresh", "reconnect", "generateJoinCode", "renderJoinQr", "joinWorkspace", "selectWorkspace", "leaveWorkspace", "relabelDevice"]);
  const CODE_PATTERN = /^[A-Z0-9]{4}$/;
  const LABEL_MAX = 80;
  const NO_LINE = "No line assigned";

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

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function formatWhen(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (error) {
      return date.toISOString();
    }
  }

  /* The trigger's words. Pure, and exported. */
  function summarize(status) {
    if (!status) return null;
    const line = status.assigned && status.line ? status.line.displayName : "No line";
    const pending = status.status && status.status.pendingCount > 0 ? ` (${status.status.pendingCount})` : "";
    const state = `${status.status ? status.status.label : ""}${pending}`;
    const devices = status.assigned && status.deviceCount > 0
      ? `${status.deviceCount} device${status.deviceCount === 1 ? "" : "s"}`
      : "";
    return { line, state, devices, text: [line, state, devices].filter(Boolean).join(" · ") };
  }

  function administrator(admin) {
    if (!admin || typeof admin.getAccess !== "function") return false;
    const access = admin.getAccess();
    return !!(access && access.access && access.access.signedIn);
  }

  /* The lines section is on offer to an administrator with more than one
   * line to choose between. */
  function offersLines(status, admin) {
    if (!status || !status.enabled) return false;
    const lines = Array.isArray(status.workspaces) ? status.workspaces : [];
    return lines.length > 1 && administrator(admin);
  }

  function guidance(status) {
    if (!status.enabled) return "RT Sync is not available on this build. Slate is showing this device's local job.";
    if (!status.assigned) return "This device is not assigned to a production line. Join one with a code from another device.";
    if (status.status && status.status.adminRequired) return "This line is no longer available to this device. Ask an administrator to restore access.";
    if (!status.linked) return "This device is disconnected from its line. Reconnect to resume shared state.";
    return "";
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.connection  the connection bridge
   * @param {object|null} [ctx.admin]     the admin bridge, read-only
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const connection = settings.connection || null;
    const admin = settings.admin || null;
    // The conflict question (slate-conflict.js): registered with the
    // bridge here, since this is the one file that speaks to it.
    const conflict = settings.conflict && typeof settings.conflict.ask === "function" ? settings.conflict : null;
    if (conflict && connection && typeof connection.answer === "function") connection.answer("conflict", details => conflict.ask(details));

    const rootEl = element(doc, "div", "slate-sync", { hidden: "" });
    const trigger = element(doc, "button", "slate-sync__trigger", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" });
    const dot = element(doc, "span", "slate-sync__dot", { "aria-hidden": "true" });
    const triggerText = text(doc, "span", "slate-sync__summary", "");
    trigger.appendChild(dot);
    trigger.appendChild(triggerText);
    rootEl.appendChild(trigger);

    const panel = element(doc, "div", "slate-sync__panel", { role: "dialog", "aria-label": "RT Sync", hidden: "" });
    rootEl.appendChild(panel);

    const state = { status: null, open: false, pending: null, qr: null, note: "", noteKind: "", joining: false, relabelling: false };

    /* ---- Requests ---- */

    async function ask(name, args) {
      if (!connection || state.pending) return null;
      state.pending = name;
      setNote("", "");
      render();
      let result;
      try {
        result = args ? await connection.request(name, args) : await connection.request(name);
      } finally {
        state.pending = null;
      }
      render();
      return result || { ok: false, code: "internal", message: "No answer from the application." };
    }

    function setNote(kind, message) {
      state.noteKind = kind;
      state.note = message || "";
    }

    async function simple(name, failure) {
      const result = await ask(name);
      if (result && !result.ok) { setNote("error", result.message || failure); render(); }
      return result;
    }

    async function addDevice() {
      const minted = await ask("generateJoinCode");
      if (!minted) return;
      if (!minted.ok) { setNote("error", minted.message || "A join code could not be generated."); render(); return; }
      const drawn = await ask("renderJoinQr");
      if (drawn && drawn.ok && drawn.svg && drawn.code) state.qr = { code: String(drawn.code), svg: String(drawn.svg) };
      else if (drawn) setNote("error", drawn.message || "The QR code could not be drawn.");
      render();
    }

    async function join(code, label) {
      const cleaned = String(code || "").trim().toUpperCase();
      if (!CODE_PATTERN.test(cleaned)) { setNote("error", "A join code is four letters or digits."); render(); return null; }
      const args = { code: cleaned };
      const trimmed = String(label || "").trim();
      if (trimmed) args.label = trimmed.slice(0, LABEL_MAX);
      const result = await ask("joinWorkspace", args);
      if (result && result.ok) state.joining = false;
      else if (result) setNote("error", result.message || "The line could not be joined.");
      render();
      return result;
    }

    async function relabel(label) {
      const trimmed = String(label || "").trim().slice(0, LABEL_MAX);
      if (!trimmed) { setNote("error", "A device label cannot be empty."); render(); return null; }
      const result = await ask("relabelDevice", { label: trimmed });
      if (result && result.ok) state.relabelling = false;
      else if (result) setNote("error", result.message || "The device could not be renamed.");
      render();
      return result;
    }

    /* ---- Panel ---- */

    function button(label, className, onClick, options) {
      const settingsFor = options || {};
      const node = text(doc, "button", `slate-sync__button ${className || ""}`.trim(), label, { type: "button" });
      if (settingsFor.action) node.setAttribute("data-action", settingsFor.action);
      if (!settingsFor.enabled) node.setAttribute("disabled", "");
      node.addEventListener("click", onClick);
      return node;
    }

    function renderPanel() {
      clear(panel);
      const status = state.status;
      if (!status) return;
      const busy = !!state.pending || !!(status.busy && status.busy.active);
      const can = status.can || {};

      // 1. Line Identity.
      const identity = element(doc, "section", "slate-sync__identity", { "aria-label": "Line identity" });
      identity.appendChild(text(doc, "h2", "slate-sync__line", status.assigned && status.line ? status.line.displayName : NO_LINE));
      const facts = element(doc, "p", "slate-sync__facts");
      if (status.assigned && status.line) {
        if (status.line.lineNumber !== null && status.line.lineNumber !== undefined) facts.appendChild(text(doc, "span", "slate-sync__fact", `Line ${status.line.lineNumber}`));
        if (status.line.name && status.line.name !== status.line.displayName) facts.appendChild(text(doc, "span", "slate-sync__fact", status.line.name));
        if (status.line.role) facts.appendChild(text(doc, "span", "slate-sync__role", status.line.role, { "data-role": status.line.role }));
      } else {
        facts.appendChild(text(doc, "span", "slate-sync__fact", guidance(status) || "Not assigned"));
      }
      identity.appendChild(facts);
      const device = element(doc, "p", "slate-sync__device");
      device.appendChild(text(doc, "span", "slate-sync__device-label", `This device: ${status.deviceLabel || "unnamed"}`));
      if (state.relabelling) {
        const form = element(doc, "span", "slate-sync__inline");
        const input = element(doc, "input", "slate-sync__input", { type: "text", maxlength: String(LABEL_MAX), "aria-label": "Device label", value: status.deviceLabel || "" });
        input.value = status.deviceLabel || "";
        form.appendChild(input);
        form.appendChild(button("Save", "slate-sync__button--primary", () => relabel(input.value), { enabled: !!can.relabel && !busy, action: "relabelDevice" }));
        form.appendChild(button("Cancel", "", () => { state.relabelling = false; render(); }, { enabled: true }));
        input.addEventListener("keydown", event => {
          if (!event) return;
          if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); relabel(input.value); }
          if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); state.relabelling = false; render(); }
        });
        device.appendChild(form);
      } else {
        device.appendChild(button("Rename", "slate-sync__button--quiet", () => { state.relabelling = true; render(); }, { enabled: !!can.relabel && !busy, action: "relabel" }));
      }
      identity.appendChild(device);
      panel.appendChild(identity);

      // 2. Status.
      const statusEl = element(doc, "section", "slate-sync__status", { "aria-label": "Sync status", "data-state": status.status ? status.status.key : "" });
      const label = state.pending ? "Working…" : (status.status ? status.status.label : "");
      statusEl.appendChild(text(doc, "p", "slate-sync__state", label));
      if (status.status && status.status.message) statusEl.appendChild(text(doc, "p", "slate-sync__message", status.status.message));
      if (status.status && status.status.pendingCount > 0) statusEl.appendChild(text(doc, "p", "slate-sync__pending", `${status.status.pendingCount} change${status.status.pendingCount === 1 ? "" : "s"} waiting to sync`));
      const last = status.status ? formatWhen(status.status.lastSyncAt) : "";
      if (last) statusEl.appendChild(text(doc, "p", "slate-sync__last", `Last sync ${last}`));
      const advice = status.assigned ? guidance(status) : "";
      if (advice) statusEl.appendChild(text(doc, "p", "slate-sync__guidance", advice));
      panel.appendChild(statusEl);

      // 3. Devices.
      if (status.assigned) {
        const devices = element(doc, "section", "slate-sync__devices", { "aria-label": "Devices" });
        devices.appendChild(text(doc, "h3", "slate-sync__heading", "Devices"));
        const list = element(doc, "ul", "slate-sync__list");
        for (const one of (Array.isArray(status.devices) ? status.devices : [])) {
          const item = element(doc, "li", "slate-sync__item");
          if (one.thisDevice) item.classList.add("is-this-device");
          item.appendChild(text(doc, "span", "slate-sync__item-label", one.label || "unnamed"));
          const bits = [one.role, one.thisDevice ? "this device" : "", one.lastSeenAt ? `seen ${formatWhen(one.lastSeenAt)}` : ""].filter(Boolean);
          item.appendChild(text(doc, "span", "slate-sync__item-meta", bits.join(" · ")));
          list.appendChild(item);
        }
        if (list.children.length === 0) list.appendChild(text(doc, "li", "slate-sync__item slate-sync__item--empty", status.linked ? "No other devices yet." : "Devices are listed once this device reconnects."));
        devices.appendChild(list);
        panel.appendChild(devices);
      }

      // 4. Join code.
      if (status.joinCode || state.qr) {
        const code = element(doc, "section", "slate-sync__join-code", { "aria-label": "Join code" });
        code.appendChild(text(doc, "h3", "slate-sync__heading", "Add a device"));
        const value = state.qr ? state.qr.code : status.joinCode.code;
        code.appendChild(text(doc, "p", "slate-sync__code", value));
        if (status.joinCode && status.joinCode.expiresAt) code.appendChild(text(doc, "p", "slate-sync__expires", `Expires ${formatWhen(status.joinCode.expiresAt)}`));
        if (state.qr) {
          const image = element(doc, "div", "slate-sync__qr-image", { "aria-label": `QR code for ${state.qr.code}`, role: "img" });
          // The bridge's SVG is the application's own drawing of a code it minted.
          image.innerHTML = state.qr.svg;
          code.appendChild(image);
        }
        panel.appendChild(code);
      }

      // 5. Lines, for an administrator with a choice.
      if (offersLines(status, admin)) {
        const lines = element(doc, "section", "slate-sync__lines", { "aria-label": "Lines" });
        lines.appendChild(text(doc, "h3", "slate-sync__heading", "Lines"));
        const list = element(doc, "ul", "slate-sync__list");
        for (const one of status.workspaces) {
          const item = element(doc, "li", "slate-sync__item");
          const current = !!(status.line && status.line.workspaceId === one.id);
          if (current) item.classList.add("is-current");
          item.appendChild(text(doc, "span", "slate-sync__item-label", one.displayName || one.name));
          if (current) {
            item.appendChild(text(doc, "span", "slate-sync__item-meta", "current"));
          } else {
            item.appendChild(button("Use this line", "slate-sync__button--quiet", async () => {
              const result = await ask("selectWorkspace", { id: one.id });
              if (result && !result.ok) { setNote("error", result.message || "The line could not be selected."); render(); }
            }, { enabled: !!can.select && !busy, action: "selectWorkspace" }));
          }
          list.appendChild(item);
        }
        lines.appendChild(list);
        panel.appendChild(lines);
      }

      // 6. Join a line.
      const joinSection = element(doc, "section", "slate-sync__join", { "aria-label": "Join a line" });
      if (!status.assigned || state.joining) {
        joinSection.appendChild(text(doc, "h3", "slate-sync__heading", status.assigned ? "Join another line" : "Join a line"));
        const form = element(doc, "div", "slate-sync__form");
        const codeInput = element(doc, "input", "slate-sync__input slate-sync__input--code", { type: "text", maxlength: "4", autocapitalize: "characters", autocorrect: "off", spellcheck: "false", enterkeyhint: "go", "aria-label": "Join code", placeholder: "CODE" });
        const labelInput = element(doc, "input", "slate-sync__input", { type: "text", maxlength: String(LABEL_MAX), enterkeyhint: "go", "aria-label": "Device label (optional)", placeholder: "Device label (optional)" });
        form.appendChild(codeInput);
        form.appendChild(labelInput);
        form.appendChild(button("Join", "slate-sync__button--primary", () => join(codeInput.value, labelInput.value), { enabled: !!can.join && !busy, action: "joinWorkspace" }));
        if (status.assigned) form.appendChild(button("Cancel", "", () => { state.joining = false; render(); }, { enabled: true }));
        codeInput.addEventListener("keydown", event => {
          if (event && event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); join(codeInput.value, labelInput.value); }
        });
        joinSection.appendChild(form);
      } else if (can.join) {
        joinSection.appendChild(button("Join another line…", "slate-sync__button--quiet", () => { state.joining = true; render(); }, { enabled: !busy, action: "join" }));
      }
      if (joinSection.children.length > 0) panel.appendChild(joinSection);

      // 7. Actions.
      const actions = element(doc, "div", "slate-sync__actions");
      const showReconnect = !!can.reconnect || (status.line && !status.linked && !(status.status && status.status.adminRequired));
      if (showReconnect) actions.appendChild(button("Reconnect", "slate-sync__button--primary", () => simple("reconnect", "The line could not be reconnected."), { enabled: !!can.reconnect && !busy, action: "reconnect" }));
      if (status.enabled && status.linked) {
        actions.appendChild(button("Refresh", "", () => simple("refresh", "The line could not be refreshed."), { enabled: !!can.refresh && !busy, action: "refresh" }));
        actions.appendChild(button("Add device", "", addDevice, { enabled: !!can.addDevice && !busy, action: "generateJoinCode" }));
      }
      if (status.assigned) {
        const leave = button(state.leaving ? "Confirm leave" : "Leave line", "slate-sync__button--danger", async () => {
          if (!state.leaving) { state.leaving = true; render(); return; }
          state.leaving = false;
          const result = await ask("leaveWorkspace");
          if (result && !result.ok) { setNote("error", result.message || "The line could not be left."); render(); }
        }, { enabled: !!can.leave && !busy, action: "leaveWorkspace" });
        if (state.leaving) leave.setAttribute("data-armed", "");
        actions.appendChild(leave);
      }
      actions.appendChild(button("Close", "slate-sync__button--quiet", () => close(true), { enabled: true, action: "close" }));
      panel.appendChild(actions);

      if (state.note) {
        panel.appendChild(text(doc, "p", `slate-sync__note is-${state.noteKind || "info"}`, state.note, { role: "status" }));
      }
    }

    function renderTrigger() {
      const summary = summarize(state.status);
      show(rootEl, !!summary);
      if (!summary) return;
      triggerText.textContent = summary.text;
      dot.setAttribute("data-state", state.status.status ? state.status.status.key : "");
      trigger.setAttribute("title", `RT Sync — ${summary.text}`);
    }

    function render() {
      renderTrigger();
      if (state.open) renderPanel();
    }

    /* ---- Open / close ---- */

    const outsideCloser = dismissal(doc, node => typeof rootEl.contains === "function" && rootEl.contains(node), () => close(false));

    function open() {
      if (state.open) return;
      state.open = true;
      state.leaving = false;
      show(panel, true);
      trigger.setAttribute("aria-expanded", "true");
      rootEl.classList.add("is-open");
      renderPanel();
      outsideCloser.start();
    }

    function close(refocus) {
      if (!state.open) return;
      state.open = false;
      state.leaving = false;
      state.joining = false;
      state.relabelling = false;
      show(panel, false);
      trigger.setAttribute("aria-expanded", "false");
      rootEl.classList.remove("is-open");
      outsideCloser.stop();
      if (refocus && typeof trigger.focus === "function") trigger.focus();
    }

    trigger.addEventListener("click", () => { if (state.open) close(true); else open(); });
    rootEl.addEventListener("keydown", event => {
      if (event && event.key === "Escape" && state.open) {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        close(true);
      }
    });

    /* ---- Subscription ---- */

    function update() {
      state.status = connection && typeof connection.getStatus === "function" ? connection.getStatus() : null;
      if (state.status && !state.status.joinCode) state.qr = null;
      // A form being typed into is not rebuilt under the operator: the
      // trigger follows the status, the panel waits for the form to close.
      if (state.open && (state.joining || state.relabelling) && !state.pending) { renderTrigger(); return; }
      render();
    }

    if (connection && typeof connection.subscribe === "function") connection.subscribe(update);
    if (admin && typeof admin.subscribe === "function") admin.subscribe(() => { if (state.open) renderPanel(); });
    update();

    return Object.freeze({ element: rootEl, panel, trigger, open, close, update, isOpen: () => state.open, status: () => state.status });
  }

  return Object.freeze({ ACTIONS, CODE_PATTERN, LABEL_MAX, NO_LINE, summarize, offersLines, guidance, formatWhen, create });
});
