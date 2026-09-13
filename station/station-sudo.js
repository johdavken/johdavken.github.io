/* Sudo: the Operator Handbook's administrator page.
 *
 * WHAT IT IS
 *
 * The one place on the Station desktop for administrator work, held to
 * the same bench as the Recipe Book: a section of the Handbook, on its
 * tabs, in its frame. This file is the gate and the frame's inside; the
 * tools stand behind it. Signed out, the page is a compact sign-in.
 * Signed in, it is the first tool - Workspace Management
 * (station-sudo-workspaces.js) - with one quiet strip above it saying who
 * is signed in, and Sign out.
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
 *   { id, title, create(doc, context) -> { element, update(access), focus(), reset() } }
 *
 * The same shape as a Handbook section, one level down: create() once
 * with the bridge and a slot in the strip for its own status; update()
 * with the current access on every publish and on showing; reset() when
 * access is lost. The page is built to hold several - Line Configuration
 * is the next - but shows the first and only one for now; there is no
 * switcher until there is something to switch to.
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
  const api = factory(workspaces);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationSudo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (workspacesModule) {
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
   * @param {Array} [context.sudoTools]   the tools, in order; defaults to
   *        Workspace Management alone
   */
  function create(doc, context) {
    const settings = context || {};
    const admin = settings.admin || null;
    const toolList = Array.isArray(settings.sudoTools) && settings.sudoTools.length
      ? settings.sudoTools
      : (workspacesModule && workspacesModule.tool ? [workspacesModule.tool] : []);

    const state = {
      pending: null,   // "signIn" | "signOut" while one is in flight
      leaving: false,  // a sign-out asked for here, until it is answered
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

    /* ---- The tools ---- */
    const toolHost = element(doc, "div", "station-sudo__tools", { hidden: "" });
    rootEl.appendChild(toolHost);
    const tools = [];
    for (const tool of toolList) {
      if (!tool || typeof tool.create !== "function") continue;
      let instance = null;
      try {
        instance = tool.create(doc, { admin, statusSlot: slot, visible: () => visible(rootEl) }) || null;
      } catch (error) {
        instance = null;
      }
      if (!instance || !instance.element) continue;
      const host = element(doc, "div", "station-sudo__tool", { "data-tool": tool.id, hidden: "" });
      host.appendChild(instance.element);
      toolHost.appendChild(host);
      tools.push({ tool, host, instance });
    }
    // The first tool is the page for now; showing another is an edit here.
    if (tools.length) show(tools[0].host, true);

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
          // The session went while the page was open: nothing of it stays.
          for (const entry of tools) { if (typeof entry.instance.reset === "function") entry.instance.reset(); }
          say(state.leaving ? "Signed out." : "Administrator access has ended. Sign in again to continue.", "");
        }
        wasSignedIn = false;
        return;
      }
      if (!wasSignedIn) { passwordInput.value = ""; say(""); }
      wasSignedIn = true;
      email.textContent = current.access.email || "";
      signOutButton.disabled = !!state.pending;
      for (const entry of tools) {
        if (typeof entry.instance.update === "function") entry.instance.update(current);
      }
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
      const target = event.target && event.target.closest ? event.target.closest("[data-action='sign-out']") : null;
      if (!target) return;
      void signOut();
    });

    refresh();

    return {
      element: rootEl,
      update: refresh,
      focus() {
        const current = access();
        if (current && current.access.signedIn) {
          const first = tools[0];
          if (first && typeof first.instance.focus === "function") first.instance.focus();
        } else if (typeof emailInput.focus === "function" && !emailInput.disabled) {
          emailInput.focus();
        }
      },
      signIn,
      signOut,
      tool: id => { const found = tools.find(entry => entry.tool.id === id); return found ? found.instance : null; },
      tools: () => tools.map(entry => entry.tool.id),
      getState: () => ({ pending: state.pending, note: state.note, noteKind: state.noteKind, gate: gate.getAttribute("data-state") })
    };
  }

  /* The section as the Handbook takes it. */
  const section = Object.freeze({ id: ID, title: TITLE, create });

  return Object.freeze({ ID, TITLE, section, create, visible });
});
