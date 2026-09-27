/* RT Sync in Slate's header: the trigger at the right and the panel it
 * drops.
 *
 * The panel leads with the Line Identity - the line's number, large, with
 * LINE up its side; under the line's name the line's maker and layers
 * (line-identity.js, handed in), the device's role and its own label, and
 * the sync status beside the logo's turning streams - then
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
  const logo = typeof require === "function"
    ? require("./slate-logo.js")
    : (root && root.PolynSlateLogo);
  const api = factory(logo);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (logoModule) {
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

  /* Whether a join code's time is up. Pure, and exported. */
  function isExpired(expiresAt, at) {
    if (!expiresAt) return false;
    const when = new Date(expiresAt).getTime();
    return Number.isFinite(when) && when <= at;
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

  /* The trigger's ring: the live mark's ring in miniature (slate-logo.js),
   * the line's number in the middle, twenty ticks round it, one lit per
   * device from the top - this device first, in the accent - and an arc
   * that runs round while changes move. */
  const GAUGE_TICKS = 20;
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* Which ticks are lit, from the top: "this" for this device, "other"
   * for the rest. Pure, and exported. */
  function gaugeTicks(status) {
    if (!status || !status.assigned) return [];
    const devices = Array.isArray(status.devices) ? status.devices : [];
    const count = Math.min(GAUGE_TICKS, Math.max(Number.isInteger(status.deviceCount) ? status.deviceCount : 0, devices.length));
    const here = devices.some(one => one && one.thisDevice);
    return Array.from({ length: count }, (_, index) => (here && index === 0 ? "this" : "other"));
  }

  function svgNode(doc, name, attributes) {
    const node = doc.createElementNS(SVG_NS, name);
    for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function createGauge(doc) {
    const box = element(doc, "span", "slate-sync__gauge", { "aria-hidden": "true" });
    const svg = svgNode(doc, "svg", { class: "slate-sync__ring", viewBox: "0 0 28 28", focusable: "false" });
    const ticks = [];
    for (let index = 0; index < GAUGE_TICKS; index += 1) {
      const angle = (index / GAUGE_TICKS) * 2 * Math.PI - Math.PI / 2;
      const at = radius => [(14 + Math.cos(angle) * radius).toFixed(2), (14 + Math.sin(angle) * radius).toFixed(2)];
      const [x1, y1] = at(10.5);
      const [x2, y2] = at(13.5);
      const tick = svgNode(doc, "line", { class: "slate-sync__tick", x1, y1, x2, y2 });
      svg.appendChild(tick);
      ticks.push(tick);
    }
    svg.appendChild(svgNode(doc, "circle", { class: "slate-sync__arc", cx: "14", cy: "14", r: "12", fill: "none" }));
    box.appendChild(svg);
    const number = text(doc, "span", "slate-sync__gauge-number", "");
    box.appendChild(number);

    function update(mark) {
      const value = mark.lineNumber === null ? "–" : String(mark.lineNumber);
      if (number.textContent !== value) number.textContent = value;
      box.classList.toggle("is-wide", value.length > 1);
      ticks.forEach((tick, index) => {
        const lit = mark.lit[index];
        tick.setAttribute("class", lit ? `slate-sync__tick is-lit${lit === "this" ? " is-this-device" : ""}` : "slate-sync__tick");
      });
    }
    return Object.freeze({ element: box, update });
  }

  function administrator(admin) {
    if (!admin || typeof admin.getAccess !== "function") return false;
    const access = admin.getAccess();
    return !!(access && access.access && access.access.signedIn);
  }

  /* The words under the numeral: the line's own name when it is not just
   * "Line N", who built the line, and how many layers it runs. Pure, and
   * exported. */
  function lineFacts(line, identity) {
    if (!line) return [];
    const facts = [];
    const number = Number.isInteger(line.lineNumber) ? line.lineNumber : null;
    const plain = number !== null && line.displayName === `Line ${number}`;
    if (!plain && line.displayName) facts.push(line.displayName);
    if (line.name && line.name !== line.displayName && !(number !== null && line.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === `line ${number}`)) facts.push(line.name);
    if (identity && number !== null) {
      const maker = typeof identity.lineManufacturer === "function" ? identity.lineManufacturer(number) : null;
      if (maker) facts.push(maker.name);
      const definition = typeof identity.definitionForLine === "function" ? identity.definitionForLine(number) : null;
      if (definition && Number.isInteger(definition.layerCount)) facts.push(definition.layerCount === 1 ? "Mono-layer" : `${definition.layerCount}-layer`);
    }
    return facts;
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
   * @param {object|null} [ctx.lineIdentity] line-identity.js, for the line's
   *        maker and layer count under its number
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const connection = settings.connection || null;
    const admin = settings.admin || null;
    const identityModule = settings.lineIdentity || null;
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    // A timer that redraws the open panel when the shown code runs out, so
    // "Expires" turns to "Expired" without a status to prompt it.
    const timers = settings.timers || (typeof globalThis !== "undefined" ? globalThis : null);
    let expiryTimer = null;
    function scheduleExpiry(expiresAt) {
      if (expiryTimer !== null && timers && typeof timers.clearTimeout === "function") timers.clearTimeout(expiryTimer);
      expiryTimer = null;
      if (!expiresAt || !state.open || !timers || typeof timers.setTimeout !== "function") return;
      const wait = new Date(expiresAt).getTime() - now();
      if (!Number.isFinite(wait) || wait <= 0 || wait > 24 * 3600e3) return;
      expiryTimer = timers.setTimeout(() => { expiryTimer = null; if (state.open) renderPanel(); }, wait + 250);
    }
    // The conflict question (slate-conflict.js): registered with the
    // bridge here, since this is the one file that speaks to it.
    const conflict = settings.conflict && typeof settings.conflict.ask === "function" ? settings.conflict : null;
    // Told when the panel opens and closes: on a phone the trigger stands
    // in the menu's sheet, and the panel takes the sheet's place (slate.js).
    const onToggle = typeof settings.onToggle === "function" ? settings.onToggle : () => {};
    if (conflict && connection && typeof connection.answer === "function") connection.answer("conflict", details => conflict.ask(details));

    const rootEl = element(doc, "div", "slate-sync", { hidden: "" });
    const trigger = element(doc, "button", "slate-sync__trigger", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" });
    const gauge = createGauge(doc);
    const triggerText = text(doc, "span", "slate-sync__summary", "");
    trigger.appendChild(gauge.element);
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
      scheduleExpiry("");
      const status = state.status;
      if (!status) return;
      const busy = !!state.pending || !!(status.busy && status.busy.active);
      const can = status.can || {};

      // 1. Line Identity: the number large, LINE up its side; then the
      // line's facts, the role and this device, and the status.
      const assignedLine = status.assigned && status.line ? status.line : null;
      const number = assignedLine && Number.isInteger(assignedLine.lineNumber) ? assignedLine.lineNumber : null;
      const identity = element(doc, "section", "slate-sync__identity", { "aria-label": "Line identity" });
      if (number !== null) {
        identity.classList.add("is-numbered");
        const numeral = element(doc, "div", "slate-sync__numeral", { "aria-hidden": "true" });
        numeral.appendChild(text(doc, "span", "slate-sync__numeral-word", "LINE"));
        numeral.appendChild(text(doc, "span", "slate-sync__numeral-value", String(number)));
        identity.appendChild(numeral);
      }
      const about = element(doc, "div", "slate-sync__about");
      about.appendChild(text(doc, "h2", "slate-sync__line", assignedLine ? assignedLine.displayName : NO_LINE));
      const facts = element(doc, "p", "slate-sync__facts");
      if (assignedLine) {
        for (const fact of lineFacts(assignedLine, identityModule)) facts.appendChild(text(doc, "span", "slate-sync__fact", fact));
      } else {
        facts.appendChild(text(doc, "span", "slate-sync__fact", guidance(status) || "Not assigned"));
      }
      if (facts.children.length > 0) about.appendChild(facts);
      const device = element(doc, "p", "slate-sync__device");
      if (assignedLine && assignedLine.role) device.appendChild(text(doc, "span", "slate-sync__role", assignedLine.role, { "data-role": assignedLine.role }));
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
      about.appendChild(device);

      // 2. Status, beside the logo's streams: they turn slowly while the
      // line is in step, quickly while changes move, and stand still off it.
      const statusKey = state.pending ? "syncing" : (status.status ? status.status.key : "");
      const statusEl = element(doc, "div", "slate-sync__status", { role: "group", "aria-label": "Sync status", "data-state": statusKey });
      if (logoModule && typeof logoModule.rotor === "function") {
        const turning = logoModule.rotor(doc, { className: "slate-sync__rotor" });
        turning.setAttribute("data-state", statusKey);
        // The panel is rebuilt on every status; a phase from the clock
        // keeps the streams turning on through it rather than restarting.
        const period = statusKey === "syncing" || statusKey === "connecting" || statusKey === "pending" ? 2.2 : 22;
        if (turning.style && typeof turning.style.setProperty === "function") turning.style.setProperty("--slate-sync-phase", `${(-((Date.now() / 1000) % period)).toFixed(2)}s`);
        statusEl.appendChild(turning);
      }
      const words = element(doc, "div", "slate-sync__status-words");
      const label = state.pending ? "Working…" : (status.status ? status.status.label : "");
      words.appendChild(text(doc, "p", "slate-sync__state", label));
      if (status.status && status.status.message) words.appendChild(text(doc, "p", "slate-sync__message", status.status.message));
      if (status.status && status.status.pendingCount > 0) words.appendChild(text(doc, "p", "slate-sync__pending", `${status.status.pendingCount} change${status.status.pendingCount === 1 ? "" : "s"} waiting to sync`));
      const last = status.status ? formatWhen(status.status.lastSyncAt) : "";
      if (last) words.appendChild(text(doc, "p", "slate-sync__last", `Last sync ${last}`));
      const advice = status.assigned ? guidance(status) : "";
      if (advice) words.appendChild(text(doc, "p", "slate-sync__guidance", advice));
      statusEl.appendChild(words);
      about.appendChild(statusEl);
      identity.appendChild(about);
      panel.appendChild(identity);

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
        // A code is good for a while, then refused: said here, rather than
        // left looking live, and a new one is one press away.
        const expiresAt = status.joinCode && status.joinCode.expiresAt ? status.joinCode.expiresAt : "";
        const expired = isExpired(expiresAt, now());
        if (expired) code.setAttribute("data-expired", "");
        const foot = element(doc, "div", "slate-sync__code-foot");
        if (expiresAt) foot.appendChild(text(doc, "p", "slate-sync__expires", expired ? `Expired ${formatWhen(expiresAt)} · make a new code to try again` : `Expires ${formatWhen(expiresAt)}`));
        foot.appendChild(button("New code", expired ? "slate-sync__button--primary" : "", addDevice, { enabled: !!can.addDevice && !busy, action: "newJoinCode" }));
        code.appendChild(foot);
        scheduleExpiry(expired ? "" : expiresAt);
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
      if (status.assigned && !state.joining && can.join) actions.appendChild(button("Join another line…", "slate-sync__button--quiet", () => { state.joining = true; render(); }, { enabled: !busy, action: "join" }));
      if (status.assigned) {
        const leave = button(state.leaving ? "Confirm leave" : "Leave line", "slate-sync__button--danger", async () => {
          if (!state.leaving) { state.leaving = true; render(); return; }
          state.leaving = false;
          const result = await ask("leaveWorkspace");
          if (result && !result.ok) { setNote("error", result.message || "The line could not be left."); render(); }
        }, { enabled: !!can.leave && !busy, action: "leaveWorkspace" });
        if (state.leaving) leave.setAttribute("data-armed", "");
        leave.classList.add("slate-sync__button--end");
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
      const status = state.status;
      const number = status.assigned && status.line && Number.isInteger(status.line.lineNumber) ? status.line.lineNumber : null;
      trigger.setAttribute("data-state", status.status ? status.status.key : "");
      gauge.update({ lineNumber: number, lit: status.assigned ? gaugeTicks(status) : [] });
      // The number stands in the ring; a line without one is named.
      triggerText.textContent = number === null && status.assigned ? `${summary.line} · ${summary.state}` : summary.state;
      trigger.setAttribute("title", `RT Sync — ${summary.text}`);
      trigger.setAttribute("aria-label", `RT Sync — ${summary.text}`);
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
      onToggle(true);
    }

    function close(refocus) {
      if (!state.open) return;
      state.open = false;
      scheduleExpiry("");
      state.leaving = false;
      state.joining = false;
      state.relabelling = false;
      show(panel, false);
      trigger.setAttribute("aria-expanded", "false");
      rootEl.classList.remove("is-open");
      outsideCloser.stop();
      onToggle(false);
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

  return Object.freeze({ ACTIONS, CODE_PATTERN, LABEL_MAX, NO_LINE, summarize, gaugeTicks, lineFacts, isExpired, offersLines, guidance, formatWhen, create });
});
