/* Sudo: the Operator Handbook's administrator page.
 *
 * WHAT IT IS
 *
 * The one place on the Station desktop for administrator work, held to
 * the same bench as the Recipe Book: a section of the Handbook, on its
 * tabs, in its frame. This file is the gate and the frame's inside; the
 * tools stand behind it. Signed out, the page is a compact sign-in.
 * Signed in, it is one of its tools - Workspace Management
 * (station-sudo-workspaces.js) or Line Configuration
 * (station-sudo-lines.js) - with one quiet strip above saying who is
 * signed in, and Sign out, and under the strip a row of the tools' names
 * to turn between them. The row is inside Sudo, not another Handbook tab:
 * administrator work is one page of the book.
 *
 * WHERE ACCESS COMES FROM
 *
 * There is one administrator session in the application, and this page
 * neither holds nor checks one of its own. It reads the access the
 * application publishes through station-admin-bridge.js - has the check
 * run, is an administrator signed in, under what email - and asks for
 * sign-in and sign-out through the same bridge's request(). The
 * application answers with its own admin service; a sign-in made here
 * shows in the floor UI's Sudo panel, and a sign-out made there closes
 * this page, because there is one state and two views of it. When the
 * session goes while this page is open, the next publish reads as signed
 * out and the page returns to the sign-in in place - no reload, and no
 * control left enabled on a session that is gone.
 *
 * A TOOL
 *
 *   { id, title, label, create(doc, context) -> { element, update(access), focus(), reset() } }
 *
 * The same shape as a Handbook section, one level down: create() once
 * with the bridge and a slot in the strip for its own status; update()
 * with the current access on every publish and on showing; reset() when
 * access is lost. `label` is the short word the row uses; `title` the
 * tool's full name. One tool shows at a time; the others are hidden with
 * their slot contents, and a tool that loads only when on screen (both
 * do) reads its list when it is turned to. Signing out turns the page
 * back to the first tool.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: the sign-in form's values while it is being
 * filled, a request in flight, the last message a request produced.
 * A password is read from its field on submit and handed over once; it
 * is kept nowhere.
 */
(function (root, factory) {
  const workspaces = typeof require === "function"
    ? require("./station-sudo-workspaces.js")
    : (root && root.PolynStationSudoWorkspaces);
  const lines = typeof require === "function"
    ? require("./station-sudo-lines.js")
    : (root && root.PolynStationSudoLines);
  const api = factory(workspaces, lines);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationSudo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (workspacesModule, linesModule) {
  "use strict";

  const ID = "sudo";
  const TITLE = "Sudo";

  const ACTION = "station-handbook__action";
  const PRIMARY = `${ACTION} is-primary`;
  const QUIET = `${ACTION} is-quiet`;

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

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /* Whether the page is on screen: no ancestor hidden, up to the document.
   * The Handbook hides the sections it is not showing and the panel it
   * has closed; a tool loads only for a page an operator can see. */
  function visible(node) {
    let current = node;
    while (current) {
      if (typeof current.hasAttribute === "function" && current.hasAttribute("hidden")) return false;
      current = current.parentNode || current.parent || null;
    }
    return true;
  }

  /**
   * Build the section.
   *
   * @param {Document} doc
   * @param {object} context
   * @param {object|null} context.admin   the admin bridge (getAccess,
   *        isConnected, request). Handed in, never reached for.
   * @param {object|null} [context.connection]  the connection bridge
   *        (getStatus, subscribe), for the tools that mark the current line
   * @param {Array} [context.sudoTools]   the tools, in order; defaults to
   *        Workspace Management, then Line Configuration
   */
  function create(doc, context) {
    const settings = context || {};
    const admin = settings.admin || null;
    const connection = settings.connection || null;
    const defaultTools = [];
    if (workspacesModule && workspacesModule.tool) defaultTools.push(workspacesModule.tool);
    if (linesModule && linesModule.tool) defaultTools.push(linesModule.tool);
    const toolList = Array.isArray(settings.sudoTools) && settings.sudoTools.length
      ? settings.sudoTools
      : defaultTools;

    const state = {
      pending: null,   // "signIn" | "signOut" while one is in flight
      leaving: false,  // a sign-out asked for here, until it is answered
      toolId: null,    // the tool showing
      note: "",
      noteKind: ""
    };

    const rootEl = element(doc, "div", "station-sudo", { "data-role": "sudo" });

    /* ---- The gate: sign-in, or why there is none ---- */
    const gate = element(doc, "div", "station-sudo__gate", { "data-state": "" });
    const gateHead = element(doc, "div", "station-sudo__gate-head");
    gateHead.appendChild(text(doc, "h3", "station-sudo__gate-title", "Admin Login"));
    const gateCopy = text(doc, "p", "station-sudo__gate-copy", "Verify administrator access.");
    gateHead.appendChild(gateCopy);
    gate.appendChild(gateHead);

    const form = element(doc, "form", "station-sudo__form", { "aria-label": "Administrator sign-in" });
    const emailInput = element(doc, "input", "station-sudo__field", {
      type: "email", name: "email", autocomplete: "email", spellcheck: "false", placeholder: "Email", "aria-label": "Email", required: ""
    });
    const passwordInput = element(doc, "input", "station-sudo__field", {
      type: "password", name: "password", autocomplete: "current-password", placeholder: "Password", "aria-label": "Password", required: ""
    });
    const signInButton = text(doc, "button", PRIMARY, "Sign in", { type: "submit", "data-action": "sign-in" });
    form.appendChild(emailInput); form.appendChild(passwordInput); form.appendChild(signInButton);
    gate.appendChild(form);
    const gateNote = element(doc, "p", "station-sudo__note", { role: "status", hidden: "" });
    gate.appendChild(gateNote);
    rootEl.appendChild(gate);

    /* ---- The strip: who is signed in, Sign out, and the tool's status ---- */
    const strip = element(doc, "div", "station-sudo__strip", { hidden: "" });
    const identity = element(doc, "span", "station-sudo__identity");
    identity.appendChild(text(doc, "span", "station-sudo__identity-label", "Administrator"));
    const email = element(doc, "span", "station-sudo__email");
    identity.appendChild(email);
    strip.appendChild(identity);
    const signOutButton = text(doc, "button", QUIET, "Sign out", { type: "button", "data-action": "sign-out" });
    strip.appendChild(signOutButton);
    const slot = element(doc, "span", "station-sudo__slot");
    strip.appendChild(slot);
    rootEl.appendChild(strip);

    /* ---- The row of tools: their names, one pressed ---- */
    const nav = element(doc, "div", "station-sudo__nav", { role: "tablist", "aria-label": "Administrator tools", hidden: "" });
    rootEl.appendChild(nav);

    /* ---- The tools ---- */
    const toolHost = element(doc, "div", "station-sudo__tools", { hidden: "" });
    rootEl.appendChild(toolHost);
    const tools = [];
    for (const tool of toolList) {
      if (!tool || typeof tool.create !== "function") continue;
      // Each tool's status in the strip: its own span in the slot, shown
      // with the tool.
      const toolSlot = element(doc, "span", "station-sudo__slot-item", { "data-tool": tool.id, hidden: "" });
      slot.appendChild(toolSlot);
      // The tool's pane, hidden until it is turned to: a tool is on screen
      // only when its pane is, so `visible` walks up from there.
      const host = element(doc, "div", "station-sudo__tool", { "data-tool": tool.id, hidden: "" });
      toolHost.appendChild(host);
      let instance = null;
      try {
        instance = tool.create(doc, { admin, connection, statusSlot: toolSlot, visible: () => visible(host) }) || null;
      } catch (error) {
        instance = null;
      }
      if (!instance || !instance.element) { slot.removeChild(toolSlot); toolHost.removeChild(host); continue; }
      host.appendChild(instance.element);
      const tab = text(doc, "button", "station-sudo__nav-tab", tool.label || tool.title, {
        type: "button", role: "tab", "data-tool-tab": tool.id, "aria-pressed": "false", "aria-selected": "false", title: tool.title
      });
      nav.appendChild(tab);
      tools.push({ tool, host, instance, slot: toolSlot, tab });
    }
    if (tools.length) state.toolId = tools[0].tool.id;

    function currentTool() {
      return tools.find(entry => entry.tool.id === state.toolId) || tools[0] || null;
    }

    /* Show the chosen tool and no other: its pane, its slot in the strip,
     * its name pressed in the row. The row itself is drawn only when there
     * is something to turn between. */
    function drawTools() {
      const current = currentTool();
      for (const entry of tools) {
        const on = entry === current;
        show(entry.host, on);
        show(entry.slot, on);
        entry.tab.setAttribute("aria-pressed", on ? "true" : "false");
        entry.tab.setAttribute("aria-selected", on ? "true" : "false");
        entry.tab.setAttribute("tabindex", on ? "0" : "-1");
      }
    }
    drawTools();

    /* ---- Reading ---- */

    function connected() {
      return !!(admin && typeof admin.isConnected === "function" && admin.isConnected());
    }

    function access() {
      return admin && typeof admin.getAccess === "function" ? admin.getAccess() : null;
    }

    function say(message, kind) {
      state.note = message || "";
      state.noteKind = state.note ? (kind || "") : "";
      gateNote.textContent = state.note;
      gateNote.setAttribute("data-kind", state.noteKind);
      show(gateNote, !!state.note);
    }

    let wasSignedIn = false;

    function refresh() {
      const current = access();
      const on = connected() && !!current;
      const signedIn = !!(on && current.access.signedIn);
      const gateState = !on ? "unavailable" : (!current.access.ready ? "checking" : "signed-out");
      gate.setAttribute("data-state", gateState);
      show(gate, !signedIn);
      show(strip, signedIn);
      show(nav, signedIn && tools.length > 1);
      show(toolHost, signedIn);
      if (!signedIn) {
        gateCopy.textContent = gateState === "unavailable"
          ? "No application is connected to Station: administrator tools are not available here."
          : (gateState === "checking" ? "Checking administrator access…" : "Verify administrator access.");
        show(form, gateState === "signed-out");
        signInButton.disabled = !!state.pending;
        emailInput.disabled = !!state.pending;
        passwordInput.disabled = !!state.pending;
        if (wasSignedIn) {
          // The session went while the page was open: nothing of it stays,
          // and the next sign-in opens on the first tool.
          for (const entry of tools) { if (typeof entry.instance.reset === "function") entry.instance.reset(); }
          state.toolId = tools.length ? tools[0].tool.id : null;
          drawTools();
          say(state.leaving ? "Signed out." : "Administrator access has ended. Sign in again to continue.", "");
        }
        wasSignedIn = false;
        return;
      }
      if (!wasSignedIn) { passwordInput.value = ""; say(""); }
      wasSignedIn = true;
      email.textContent = current.access.email || "";
      signOutButton.disabled = !!state.pending;
      drawTools();
      for (const entry of tools) {
        if (typeof entry.instance.update === "function") entry.instance.update(current);
      }
    }

    /* Turn to a tool. It is told the current access as it is shown, so a
     * tool that reads only for a page on screen reads now. */
    function open(id) {
      const entry = tools.find(item => item.tool.id === id);
      if (!entry || entry.tool.id === state.toolId) return false;
      state.toolId = entry.tool.id;
      drawTools();
      const current = access();
      if (current && current.access.signedIn && typeof entry.instance.update === "function") entry.instance.update(current);
      if (typeof entry.instance.focus === "function") entry.instance.focus();
      return true;
    }

    /* ---- Actions ---- */

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

    async function signIn() {
      const emailValue = String(emailInput.value || "").trim();
      const passwordValue = String(passwordInput.value || "");
      if (!emailValue || !passwordValue) {
        say("Enter the administrator email and password.", "error");
        return null;
      }
      say("Signing in…");
      const result = await request("signIn", { email: emailValue, password: passwordValue });
      passwordInput.value = "";
      if (!result.ok) {
        say(result.message || "Could not sign in. Check the email and password.", "error");
        refresh();
        if (typeof passwordInput.focus === "function") passwordInput.focus();
        return result;
      }
      say("");
      refresh();
      return result;
    }

    async function signOut() {
      state.leaving = true;
      let result;
      try {
        result = await request("signOut");
        refresh();
      } finally {
        state.leaving = false;
      }
      return result;
    }

    form.addEventListener("submit", event => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      void signIn();
    });
    rootEl.addEventListener("click", event => {
      const target = event.target && event.target.closest ? event.target.closest("[data-action='sign-out'], [data-tool-tab]") : null;
      if (!target || target.disabled) return;
      const toolId = target.getAttribute("data-tool-tab");
      if (toolId) { open(toolId); return; }
      void signOut();
    });
    nav.addEventListener("keydown", event => {
      if (!event || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const at = tools.findIndex(entry => entry.tool.id === state.toolId);
      if (at < 0 || tools.length < 2) return;
      const next = tools[(at + (event.key === "ArrowRight" ? 1 : tools.length - 1)) % tools.length];
      if (typeof event.preventDefault === "function") event.preventDefault();
      open(next.tool.id);
      if (typeof next.tab.focus === "function") next.tab.focus();
    });

    refresh();

    return {
      element: rootEl,
      update: refresh,
      /* The gate is a form with air around it and wants no more bench; the
       * tools behind it are lists, and do. Asked again on every update,
       * so the Handbook's grip comes with the sign-in and goes with the
       * sign-out. */
      grows() {
        const current = access();
        return !!(current && current.access.signedIn);
      },
      focus() {
        const current = access();
        if (current && current.access.signedIn) {
          const shown = currentTool();
          if (shown && typeof shown.instance.focus === "function") shown.instance.focus();
        } else if (typeof emailInput.focus === "function" && !emailInput.disabled) {
          emailInput.focus();
        }
      },
      signIn,
      signOut,
      open,
      tool: id => { const found = tools.find(entry => entry.tool.id === id); return found ? found.instance : null; },
      tools: () => tools.map(entry => entry.tool.id),
      getState: () => ({ pending: state.pending, note: state.note, noteKind: state.noteKind, gate: gate.getAttribute("data-state"), tool: state.toolId })
    };
  }

  /* The section as the Handbook takes it. */
  const section = Object.freeze({ id: ID, title: TITLE, create });

  return Object.freeze({ ID, TITLE, section, create, visible });
});
