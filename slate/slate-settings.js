/* The Settings section: the theme, read-only, the tracking mode, and
 * room for what comes after them - with the administrator's way in at
 * the very bottom.
 *
 * The theme picker drives the controller slate-host.js (or the harness)
 * created on the root; the controller writes the attribute and the
 * preference, this only asks. Later preferences take their place beside
 * it as further groups.
 *
 * Administrator access is last and closed: a single row an operator can
 * pass over, which opens on a press into the email and password the
 * application's own admin session takes. Slate holds neither - the
 * password goes to the seam and is forgotten the moment the answer comes
 * back, and whether an administrator is signed in is the bridge's
 * boolean, never this page's judgement. Signed in, the row says who and
 * offers the way out; a sign-out anywhere else - the floor UI, Station -
 * closes it here too, since all three read the one session.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(pick("PolynSlateAdminActions", "./slate-admin-actions.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (adminModule) {
  "use strict";

  const ADMIN_TITLE = "Administrator access";
  const ADMIN_LEAD = "Administrator tools run on the application's own admin session, the same one the floor UI and Station use. Nothing here is stored by Slate.";

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

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.theme    the theme controller {getTheme, setTheme, subscribe}
   * @param {object[]} [ctx.themes]    the registry (PolynSlateTheme.THEMES)
   * @param {object|null} [ctx.display] the display controller {getReadOnlyMode, setReadOnly, getTrackingMode, setTrackingMode, subscribe}
   * @param {object|null} [ctx.admin]  the admin bridge, for the sign-in block
   * @param {function} [ctx.say]       a line for the operator
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const controller = settings.theme || null;
    const themes = Array.isArray(settings.themes) ? settings.themes : [];
    const admin = settings.admin || null;
    const say = typeof settings.say === "function" ? settings.say : () => {};

    const rootEl = element(doc, "div", "slate-settings");

    const bar = element(doc, "div", "slate-section__bar");
    bar.appendChild(text(doc, "p", "slate-section__subtitle", "Preferences for this device. Nothing here is shared."));
    rootEl.appendChild(bar);

    // Appearance.
    const appearance = element(doc, "section", "slate-settings__group", { "aria-label": "Appearance" });
    appearance.appendChild(text(doc, "h2", "slate-settings__heading", "Appearance"));
    const gallery = element(doc, "div", "slate-settings__themes", { role: "radiogroup", "aria-label": "Theme" });
    const tiles = new Map();
    for (const item of themes) {
      const tile = element(doc, "button", "slate-theme-tile", { type: "button", role: "radio", "aria-checked": "false", "data-theme-choice": item.id });
      const swatch = element(doc, "span", "slate-theme-tile__swatch slate-theme-scope", { "data-theme": item.id, "aria-hidden": "true" });
      swatch.appendChild(element(doc, "span", "slate-theme-tile__swatch-bar"));
      swatch.appendChild(element(doc, "span", "slate-theme-tile__swatch-accent"));
      const preview = element(doc, "span", "slate-theme-tile__preview");
      preview.appendChild(element(doc, "span", "slate-theme-tile__preview-title"));
      preview.appendChild(element(doc, "span", "slate-theme-tile__preview-copy"));
      const previewStatus = element(doc, "span", "slate-theme-tile__preview-status");
      previewStatus.appendChild(element(doc, "span", "slate-theme-tile__preview-status-dot"));
      previewStatus.appendChild(element(doc, "span", "slate-theme-tile__preview-status-label"));
      preview.appendChild(previewStatus);
      preview.appendChild(element(doc, "span", "slate-theme-tile__preview-action"));
      swatch.appendChild(preview);
      tile.appendChild(text(doc, "span", "slate-theme-tile__selected-mark", "✓", { "aria-hidden": "true" }));
      tile.appendChild(swatch);
      tile.appendChild(text(doc, "span", "slate-theme-tile__name", item.label));
      tile.appendChild(text(doc, "span", "slate-theme-tile__description", item.description || ""));
      tile.addEventListener("click", () => { if (controller) controller.setTheme(item.id); });
      tiles.set(item.id, tile);
      gallery.appendChild(tile);
    }
    appearance.appendChild(gallery);
    if (!controller) appearance.appendChild(text(doc, "p", "slate-settings__note", "The theme cannot be changed on this page."));
    rootEl.appendChild(appearance);

    // Safety: read-only mode.
    const display = settings.display || null;
    const safety = element(doc, "section", "slate-settings__group", { "aria-label": "Safety" });
    safety.appendChild(text(doc, "h2", "slate-settings__heading", "Safety"));
    safety.appendChild(text(doc, "p", "slate-settings__lead", "Read-only keeps Slate from changing the line's job: the recipe, the plan, tracking, pump-off, the changeover and the output stay as they are. Connecting to and leaving lines is not affected."));
    const modes = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Read-only" });
    const modeButtons = new Map();
    for (const [mode, label, note] of [["auto", "Automatic", "Read-only whenever a line is linked; writable on this device's own session."], ["on", "On", "Always read-only."], ["off", "Off", "Always writable."]]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-readonly-mode": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display) display.setReadOnly(mode); });
      modeButtons.set(mode, button);
      modes.appendChild(button);
    }
    safety.appendChild(modes);
    if (!display) safety.appendChild(text(doc, "p", "slate-settings__note", "Read-only cannot be changed on this page."));
    rootEl.appendChild(safety);

    // Tracking: how the Track toggle is offered.
    const tracking = element(doc, "section", "slate-settings__group", { "aria-label": "Tracking" });
    tracking.appendChild(text(doc, "h2", "slate-settings__heading", "Tracking"));
    tracking.appendChild(text(doc, "p", "slate-settings__lead", "How the recipe offers Track on each hopper. Automatic tracks hoppers whose resin changes at the changeover for you and only ever turns tracking on; it needs Slate writable (Read-only Off) and changes nothing otherwise."));
    const trackingModes = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Tracking" });
    const trackingButtons = new Map();
    for (const [mode, label, note] of [
      ["automatic", "Automatic", "No Track toggles. Once a Next Recipe swaps or empties a hopper's resin, that hopper is tracked at once. Reset tracking clears pump-off; those hoppers are tracked again."],
      ["assisted", "Assisted", "Track is offered where a Next Recipe swaps or empties the resin, and everywhere without a plan."],
      ["manual", "Manual", "Track is offered on every hopper, whatever is planned."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-tracking-mode": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setTrackingMode === "function") display.setTrackingMode(mode); });
      trackingButtons.set(mode, button);
      trackingModes.appendChild(button);
    }
    tracking.appendChild(trackingModes);
    if (!display) tracking.appendChild(text(doc, "p", "slate-settings__note", "Tracking cannot be changed on this page."));
    rootEl.appendChild(tracking);

    // What comes next.
    const later = element(doc, "section", "slate-settings__group", { "aria-label": "More settings" });
    later.appendChild(text(doc, "h2", "slate-settings__heading", "More"));
    later.appendChild(text(doc, "p", "slate-stub", "Display and workflow preferences arrive in later phases."));
    rootEl.appendChild(later);

    // Administrator access: last, and closed until it is wanted.
    const adminGroup = element(doc, "section", "slate-settings__group slate-settings__admin", { "aria-label": ADMIN_TITLE });
    const adminToggle = element(doc, "button", "slate-settings__admin-toggle", { type: "button", "aria-expanded": "false", "data-slate-admin": "disclosure" });
    adminToggle.appendChild(text(doc, "span", "slate-settings__admin-mark", "›", { "aria-hidden": "true" }));
    const adminTitle = text(doc, "span", "slate-settings__admin-title", ADMIN_TITLE);
    adminToggle.appendChild(adminTitle);
    const adminWho = text(doc, "span", "slate-settings__admin-who", "", { hidden: "" });
    adminToggle.appendChild(adminWho);
    adminGroup.appendChild(adminToggle);

    const adminBody = element(doc, "div", "slate-settings__admin-body", { hidden: "" });
    adminBody.appendChild(text(doc, "p", "slate-settings__lead", ADMIN_LEAD));

    // Signed out: the two fields and the way in.
    const adminForm = element(doc, "div", "slate-settings__admin-form");
    const emailField = element(doc, "input", "slate-settings__admin-field", {
      type: "email", autocomplete: "username", spellcheck: "false", "aria-label": "Administrator email", placeholder: "Email", "data-slate-admin": "email"
    });
    const passwordField = element(doc, "input", "slate-settings__admin-field", {
      type: "password", autocomplete: "current-password", "aria-label": "Administrator password", placeholder: "Password", "data-slate-admin": "password"
    });
    const signInButton = text(doc, "button", "slate-settings__admin-action slate-settings__admin-action--primary", "Sign in", { type: "button", "data-slate-admin": "sign-in" });
    for (const node of [emailField, passwordField, signInButton]) adminForm.appendChild(node);
    adminBody.appendChild(adminForm);
    adminBody.appendChild(text(doc, "p", "slate-settings__admin-opens", adminModule ? adminModule.WORDING.opens : ""));

    // Signed in: who, and the way out.
    const adminSession = element(doc, "div", "slate-settings__admin-form", { hidden: "" });
    const adminEmail = text(doc, "span", "slate-settings__admin-email", "");
    const signOutButton = text(doc, "button", "slate-settings__admin-action", "Sign out", { type: "button", "data-slate-admin": "sign-out" });
    adminSession.appendChild(adminEmail);
    adminSession.appendChild(signOutButton);
    adminBody.appendChild(adminSession);

    const adminNote = element(doc, "p", "slate-settings__admin-note", { role: "status", hidden: "" });
    adminBody.appendChild(adminNote);
    adminGroup.appendChild(adminBody);
    rootEl.appendChild(adminGroup);

    let adminOpen = false;
    let adminPending = false;

    function setAdminNote(message, kind) {
      adminNote.textContent = message || "";
      adminNote.classList.toggle("is-error", kind === "error");
      show(adminNote, !!message);
    }

    function openAdmin(on) {
      adminOpen = !!on;
      adminToggle.setAttribute("aria-expanded", adminOpen ? "true" : "false");
      adminGroup.classList.toggle("is-open", adminOpen);
      show(adminBody, adminOpen);
      if (!adminOpen) { passwordField.value = ""; setAdminNote(""); }
    }

    /* The block follows the one session: signed in it says who and offers
     * the way out; signed out it takes the two fields. A sign-out from
     * anywhere else arrives here as a publish. */
    function paintAdmin() {
      const access = adminModule ? adminModule.accessOf(admin) : { ready: false, signedIn: false, email: "" };
      const able = adminModule ? adminModule.can(admin) : { signIn: false, signOut: false };
      const on = access.signedIn;
      adminGroup.classList.toggle("is-signed-in", on);
      adminWho.textContent = on ? (access.email || "Signed in") : "";
      show(adminWho, on);
      show(adminForm, !on);
      show(adminSession, on);
      adminEmail.textContent = access.email ? `Signed in as ${access.email}` : "Signed in";
      for (const [button, control] of [[signInButton, "signIn"], [signOutButton, "signOut"]]) {
        const can = !!able[control];
        button.setAttribute("data-able", can ? "true" : "false");
        button.setAttribute("title", can ? "" : `Unavailable: ${adminModule ? adminModule.reason(admin, control) : "no administrator tools on this page."}`);
        if (adminPending) button.setAttribute("disabled", "");
        else button.removeAttribute("disabled");
      }
      for (const field of [emailField, passwordField]) {
        if (adminPending) field.setAttribute("disabled", "");
        else field.removeAttribute("disabled");
      }
    }

    async function signIn() {
      if (adminPending || !adminModule) return;
      if (signInButton.getAttribute("data-able") !== "true") { say(`Sign in is unavailable: ${adminModule.reason(admin, "signIn")}`); return; }
      const email = String(emailField.value || "").trim();
      const password = String(passwordField.value || "");
      if (!email) { setAdminNote(adminModule.WORDING.emailNeeded, "error"); emailField.focus(); return; }
      if (!password) { setAdminNote(adminModule.WORDING.passwordNeeded, "error"); passwordField.focus(); return; }
      adminPending = true;
      setAdminNote("");
      paintAdmin();
      let result;
      try {
        result = await adminModule.signIn(admin, email, password);
      } finally {
        // The password is gone from the page as soon as it has been asked
        // with, whatever the answer was.
        passwordField.value = "";
        adminPending = false;
        paintAdmin();
      }
      if (result && result.ok) {
        emailField.value = "";
        setAdminNote("");
        say(adminModule.WORDING.signedIn(adminModule.accessOf(admin).email || email));
        return;
      }
      setAdminNote((result && result.message) || adminModule.WORDING.signInFailed, "error");
      passwordField.focus();
    }

    async function signOut() {
      if (adminPending || !adminModule) return;
      if (signOutButton.getAttribute("data-able") !== "true") { say(`Sign out is unavailable: ${adminModule.reason(admin, "signOut")}`); return; }
      adminPending = true;
      setAdminNote("");
      paintAdmin();
      let result;
      try {
        result = await adminModule.signOut(admin);
      } finally {
        adminPending = false;
        paintAdmin();
      }
      if (result && result.ok) { setAdminNote(""); say(adminModule.WORDING.signedOut); return; }
      setAdminNote((result && result.message) || "Signing out was refused.", "error");
    }

    adminToggle.addEventListener("click", () => openAdmin(!adminOpen));
    signInButton.addEventListener("click", () => signIn());
    signOutButton.addEventListener("click", () => signOut());
    for (const field of [emailField, passwordField]) {
      field.addEventListener("keydown", event => {
        if (!event || event.key !== "Enter") return;
        if (typeof event.preventDefault === "function") event.preventDefault();
        signIn();
      });
    }

    function paint() {
      const selected = controller ? controller.getTheme() : null;
      for (const [id, tile] of tiles) {
        const on = id === selected;
        tile.setAttribute("aria-checked", on ? "true" : "false");
        tile.classList.toggle("is-selected", on);
      }
      const mode = display ? display.getReadOnlyMode() : null;
      for (const [id, button] of modeButtons) {
        const on = id === mode;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const trackingMode = display && typeof display.getTrackingMode === "function" ? display.getTrackingMode() : null;
      for (const [id, button] of trackingButtons) {
        const on = id === trackingMode;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      paintAdmin();
    }

    if (controller && typeof controller.subscribe === "function") controller.subscribe(paint);
    if (display && typeof display.subscribe === "function") display.subscribe(paint);
    if (admin && typeof admin.subscribe === "function") admin.subscribe(paintAdmin);
    paint();

    return Object.freeze({
      element: rootEl,
      paint,
      tile: id => tiles.get(id) || null,
      mode: id => modeButtons.get(id) || null,
      trackingMode: id => trackingButtons.get(id) || null,
      admin: () => ({ open: adminOpen, pending: adminPending, note: adminNote.textContent, signedIn: adminGroup.classList.contains("is-signed-in") }),
      // Left behind, the block closes and the password goes with it.
      onHide() { openAdmin(false); }
    });
  }

  return Object.freeze({ create });
});
