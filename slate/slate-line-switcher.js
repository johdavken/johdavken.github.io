/* Lines: a phone's sheet of the lines this device has joined, raised by a
 * tap on Home's mark (slate-home.js).
 *
 * One row per line the device remembers - cloud-sync's own list, through
 * the connection bridge's status - the line's number large, its name
 * beside it, and this device's line marked. A tap on another line makes
 * it this device's line (the sync module's selectLine); a tap on this
 * device's line while it is disconnected reconnects it, as the RT Sync
 * panel's Reconnect does (reconnectLine). slate-sync.js stays the one file
 * that requests a connection action. The sheet closes on success. A refusal keeps the sheet up
 * with the reason, and nothing changes.
 *
 * Switching changes which line this device shows and edits, nothing else:
 * neither line's job is touched, and the way back is the same tap.
 *
 * At its foot the full RT Sync panel (join codes, devices, leaving) and
 * joining another line - the panel opened on its join form. With no line
 * remembered those two are all it holds.
 *
 * It reads the status and asks through the hooks it is handed; it holds
 * no state of the line's. Opening it changes nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateLineSwitcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* A press outside, by the shared rule, and the Back key's stack
   * (slate-dismiss.js). */
  function dismissal(target, inside, close) {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.outside === "function" ? shared.outside(target, inside, close) : Object.freeze({ start() {}, stop() {}, isOn: () => false });
  }

  const TITLE = "Lines";
  const WORDING = Object.freeze({
    unavailable: "RT Sync is not available on this build.",
    none: "This device has not joined a line yet.",
    current: "This device's line",
    disconnected: "Disconnected · tap to reconnect",
    switching: "Switching…",
    failed: "The line could not be selected.",
    panel: "RT Sync…",
    join: "Join another line",
    joinFirst: "Join a line"
  });

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
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

  /**
   * The rows the sheet shows, from the connection bridge's status. Pure.
   * Each: { id, number (string, "" without one), name, current, linked, action }
   * where action is "select" (another line), "reconnect" (this device's
   * line, disconnected) or null (this device's line, connected).
   */
  function rowsFor(status) {
    if (!status || !status.enabled) return [];
    const currentId = status.line && status.line.workspaceId ? String(status.line.workspaceId) : "";
    const linked = !!status.linked;
    return (Array.isArray(status.workspaces) ? status.workspaces : [])
      .filter(one => one && one.id)
      .map(one => {
        const id = String(one.id);
        const current = id === currentId;
        return {
          id,
          number: Number.isInteger(one.lineNumber) ? String(one.lineNumber) : "",
          name: String(one.displayName || one.name || "Unnamed line"),
          current,
          linked: current && linked,
          action: current ? (linked ? null : "reconnect") : "select"
        };
      })
      .sort((a, b) => {
        // Numbered lines in number order, then the rest by name.
        if (a.number && b.number) return Number(a.number) - Number(b.number);
        if (a.number || b.number) return a.number ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {function} options.status      () => the connection bridge's status, or null
   * @param {function} options.select      (id) => Promise<{ok, message?}> - slate-sync.js selectLine
   * @param {function} [options.reconnect] () => Promise<{ok, message?}> - slate-sync.js reconnectLine
   * @param {function} [options.openSync]  ({ join }) - the full RT Sync panel; join opens its form
   * @param {function} [options.onToggle]  (open) - the boot's scrim
   */
  function create(doc, options) {
    const settings = options || {};
    const readStatus = typeof settings.status === "function" ? settings.status : () => null;
    const select = typeof settings.select === "function" ? settings.select : () => Promise.resolve({ ok: false, message: WORDING.failed });
    const reconnect = typeof settings.reconnect === "function" ? settings.reconnect : () => select(currentId());
    const currentId = () => { const status = readStatus(); return status && status.line && status.line.workspaceId ? String(status.line.workspaceId) : ""; };
    const openSync = typeof settings.openSync === "function" ? settings.openSync : null;
    const onToggle = typeof settings.onToggle === "function" ? settings.onToggle : () => {};

    const sheet = element(doc, "div", "slate-lines", { role: "dialog", "aria-label": TITLE, hidden: "" });
    const head = element(doc, "div", "slate-lines__head");
    head.appendChild(text(doc, "h2", "slate-lines__title", TITLE));
    sheet.appendChild(head);
    const note = element(doc, "p", "slate-lines__note", { role: "status", hidden: "" });
    sheet.appendChild(note);
    const list = element(doc, "ul", "slate-lines__list");
    sheet.appendChild(list);
    const foot = element(doc, "div", "slate-lines__foot");
    const panelButton = text(doc, "button", "slate-lines__action", WORDING.panel, { type: "button", "data-lines-do": "panel" });
    const joinButton = text(doc, "button", "slate-lines__action", WORDING.join, { type: "button", "data-lines-do": "join" });
    foot.appendChild(panelButton);
    foot.appendChild(joinButton);
    sheet.appendChild(foot);

    const state = { open: false, pending: null, note: "", error: false };

    function setNote(message, error) {
      state.note = message || "";
      state.error = !!error;
    }

    function render() {
      const status = readStatus();
      const rows = rowsFor(status);
      const can = status && status.can ? status.can : {};
      clear(list);
      for (const row of rows) {
        const li = element(doc, "li", "slate-lines__item");
        const button = element(doc, "button", "slate-lines__line", { type: "button", "data-line-id": row.id });
        if (row.current) button.classList.add("is-current");
        if (row.current) button.setAttribute("aria-current", "true");
        button.appendChild(text(doc, "span", "slate-lines__number", row.number || "–", { "aria-hidden": "true" }));
        const words = element(doc, "span", "slate-lines__words");
        words.appendChild(text(doc, "span", "slate-lines__name", row.name));
        let sub = "";
        if (state.pending === row.id) sub = WORDING.switching;
        else if (row.current) sub = row.linked ? `${WORDING.current} · ${status.status && status.status.label ? status.status.label : ""}`.replace(/ · $/, "") : WORDING.disconnected;
        if (sub) words.appendChild(text(doc, "span", "slate-lines__sub", sub));
        button.appendChild(words);
        if (row.current && row.linked) button.appendChild(text(doc, "span", "slate-lines__check", "✓", { "aria-hidden": "true" }));
        const allowed = row.action === "reconnect" ? can.reconnect !== false : !!can.select;
        const able = !!row.action && allowed && !state.pending;
        if (!able) button.setAttribute("disabled", "");
        if (row.action) button.addEventListener("click", () => choose(row.id, row.action));
        li.appendChild(button);
        list.appendChild(li);
      }
      if (!status || !status.enabled) setNoteShown(WORDING.unavailable, false);
      else if (!rows.length && !state.note) setNoteShown(WORDING.none, false);
      else setNoteShown(state.note, state.error);
      const syncable = !!openSync && !!(status && status.enabled);
      for (const node of [panelButton, joinButton]) {
        if (syncable && !state.pending) node.removeAttribute("disabled");
        else node.setAttribute("disabled", "");
      }
      if (status && status.enabled && can.join === false) joinButton.setAttribute("disabled", "");
      const joinWords = rows.length ? WORDING.join : WORDING.joinFirst;
      if (joinButton.textContent !== joinWords) joinButton.textContent = joinWords;
    }

    function setNoteShown(message, error) {
      note.textContent = message || "";
      note.classList.toggle("is-error", !!error);
      if (message) note.removeAttribute("hidden");
      else note.setAttribute("hidden", "");
    }

    async function choose(id, action) {
      if (state.pending) return;
      state.pending = id;
      setNote("", false);
      render();
      let result;
      try {
        result = await (action === "reconnect" ? reconnect() : select(id));
      } catch (error) {
        result = { ok: false, message: error && error.message ? error.message : WORDING.failed };
      }
      state.pending = null;
      if (result && result.ok) { setNote("", false); close(); return; }
      setNote((result && result.message) || WORDING.failed, true);
      if (state.open) render();
    }

    const outsideCloser = dismissal(doc, node => typeof sheet.contains === "function" && sheet.contains(node), () => close());

    function open() {
      if (state.open) return;
      state.open = true;
      setNote("", false);
      render();
      sheet.removeAttribute("hidden");
      outsideCloser.start();
      onToggle(true);
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      sheet.setAttribute("hidden", "");
      outsideCloser.stop();
      onToggle(false);
    }

    function toFull(join) {
      close();
      if (openSync) openSync({ join });
    }
    panelButton.addEventListener("click", () => toFull(false));
    joinButton.addEventListener("click", () => toFull(true));
    sheet.addEventListener("keydown", event => {
      if (event && event.key === "Escape" && state.open) {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        close();
      }
    });

    /* The status moved (a switch landed, a device joined): an open sheet
     * follows it. */
    function update() {
      if (state.open) render();
    }

    return Object.freeze({ element: sheet, open, close, update, isOpen: () => state.open, pending: () => state.pending });
  }

  return Object.freeze({ TITLE, WORDING, rowsFor, create });
});
