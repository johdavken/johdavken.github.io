/* The Settings section: the theme, the background, the tracking mode, the
 * layout, the handling of a drag, the layer order, the timeline's view, and room for what
 * comes after them - with the administrator's way in at the very bottom.
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

  /* The switch's sun and moon, drawn in the text's colour (a glyph falls
   * back to a colour emoji on some systems). */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SUN = "M10 6.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8Z M10 2v1.8 M10 16.2V18 M2 10h1.8 M16.2 10H18 M4.3 4.3l1.3 1.3 M14.4 14.4l1.3 1.3 M4.3 15.7l1.3-1.3 M14.4 5.6l1.3-1.3";
  const MOON = "M16 12.6A6.6 6.6 0 0 1 7.4 4a6.6 6.6 0 1 0 8.6 8.6Z";

  function icon(doc, className, d) {
    const holder = element(doc, "span", className, { "aria-hidden": "true" });
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("focusable", "false");
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    holder.appendChild(svg);
    return holder;
  }

  /* The registry's themes grouped into families by name: `<family>-light`
   * and `<family>-dark` are one family's two halves, in the registry's
   * order. A theme without its other half is a family of one. */
  function familiesOf(themes) {
    const families = [];
    const byId = new Map();
    for (const item of themes) {
      const id = String(item.id).replace(/-(light|dark)$/, "");
      let family = byId.get(id);
      if (!family) {
        family = { id, light: null, dark: null, only: null };
        byId.set(id, family);
        families.push(family);
      }
      if (item.scheme === "dark" && !family.dark) family.dark = item;
      else if (item.scheme === "light" && !family.light) family.light = item;
      else family.only = family.only || item;
    }
    return families;
  }

  /* The half a tile shows: its chosen scheme's, or the only one it has. */
  function shown(entry) {
    const family = entry.family;
    return (entry.scheme === "dark" ? family.dark : family.light) || family.light || family.dark || family.only;
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.theme    the theme controller {getTheme, setTheme, subscribe}
   * @param {object[]} [ctx.themes]    the registry (PolynSlateTheme.THEMES)
   * @param {object|null} [ctx.display] the display controller {getBackground, setBackground, getHandling, setHandling, getTrackingMode, setTrackingMode, getLayout, setLayout, getLayerOrder, setLayerOrder, getTimelineView, setTimelineView, subscribe}
   * @param {object|null} [ctx.admin]  the admin bridge, for the sign-in block
   * @param {function} [ctx.say]       a line for the operator
   * @param {function} [ctx.legacy]    () => the floor UI's address, for the way back at the foot
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
    // One tile per family - a theme's light and dark halves - with a day /
    // night switch in its corner. The tile shows one half at a time: the
    // live theme's in its own family, elsewhere the half matching the live
    // theme's scheme - until its own switch is turned, which it then keeps. Choosing the tile chooses
    // the half it shows; turning the switch of the live family changes the
    // theme at once.
    const gallery = element(doc, "div", "slate-settings__themes", { role: "radiogroup", "aria-label": "Theme" });
    const families = familiesOf(themes);
    const tiles = new Map();
    const liveScheme = () => {
      const live = controller ? themes.find(item => item.id === controller.getTheme()) : null;
      return live ? live.scheme : "light";
    };
    for (const family of families) {
      const box = element(doc, "div", "slate-theme-tile", { "data-theme-family": family.id });
      const choose = element(doc, "button", "slate-theme-tile__choose", { type: "button", role: "radio", "aria-checked": "false" });
      const swatch = element(doc, "span", "slate-theme-tile__swatch slate-theme-scope", { "aria-hidden": "true" });
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
      choose.appendChild(text(doc, "span", "slate-theme-tile__selected-mark", "✓", { "aria-hidden": "true" }));
      choose.appendChild(swatch);
      const name = text(doc, "span", "slate-theme-tile__name", "");
      const description = text(doc, "span", "slate-theme-tile__description", "");
      choose.appendChild(name);
      choose.appendChild(description);
      box.appendChild(choose);
      const entry = { family, box, choose, swatch, name, description, toggle: null, scheme: null, turned: false };
      choose.addEventListener("click", () => { if (controller) controller.setTheme(shown(entry).id); });
      if (family.light && family.dark) {
        const toggle = element(doc, "button", "slate-theme-tile__toggle", { type: "button", role: "switch", "aria-checked": "false" });
        toggle.appendChild(icon(doc, "slate-theme-tile__toggle-day", SUN));
        toggle.appendChild(icon(doc, "slate-theme-tile__toggle-night", MOON));
        toggle.appendChild(element(doc, "span", "slate-theme-tile__toggle-knob", { "aria-hidden": "true" }));
        toggle.addEventListener("click", () => {
          const live = controller ? controller.getTheme() : null;
          const was = shown(entry).id;
          entry.scheme = entry.scheme === "dark" ? "light" : "dark";
          // The live family's switch is the theme's own: it changes at once.
          if (controller && live === was) controller.setTheme(shown(entry).id);
          else { entry.turned = true; paint(); }
        });
        box.appendChild(toggle);
        entry.toggle = toggle;
      }
      tiles.set(family.id, entry);
      gallery.appendChild(box);
    }
    appearance.appendChild(gallery);
    if (!controller) appearance.appendChild(text(doc, "p", "slate-settings__note", "The theme cannot be changed on this page."));
    rootEl.appendChild(appearance);

    const display = settings.display || null;

    // Background: a soft picture behind the page, as a translucent window
    // shows the wallpaper (components/background.css). None leads.
    const background = element(doc, "section", "slate-settings__group", { "aria-label": "Background" });
    background.appendChild(text(doc, "h2", "slate-settings__heading", "Background"));
    background.appendChild(text(doc, "p", "slate-settings__lead", "A soft picture behind Slate, faint enough to read through. Any of them suits any theme."));
    const backdrops = element(doc, "div", "slate-settings__modes slate-settings__backgrounds", { role: "radiogroup", "aria-label": "Background" });
    const backgroundButtons = new Map();
    for (const [choice, label, note] of [
      ["none", "None", "The theme's own background."],
      ["smoke", "Smoke", "Grey smoke drifting across."],
      ["ember", "Ember", "Warm amber smoke."],
      ["tide", "Tide", "Cool blue-green smoke."],
      ["aurora", "Aurora", "Ribbons of green and violet."],
      ["dunes", "Dunes", "Soft sand ridges."],
      ["hearth", "Hearth", "Made for Gruvbox: warm lights out of focus."],
      ["horizon", "Horizon", "Made for Retro 82: a striped sun behind a grid."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode slate-settings__background", { type: "button", role: "radio", "aria-checked": "false", "data-background-choice": choice });
      button.appendChild(element(doc, "span", "slate-settings__background-preview", { "aria-hidden": "true", "data-background": choice }));
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setBackground === "function") display.setBackground(choice); });
      backgroundButtons.set(choice, button);
      backdrops.appendChild(button);
    }
    background.appendChild(backdrops);
    if (!display) background.appendChild(text(doc, "p", "slate-settings__note", "The background cannot be changed on this page."));
    rootEl.appendChild(background);

    // Tracking: how the Track toggle is offered.
    const tracking = element(doc, "section", "slate-settings__group", { "aria-label": "Tracking" });
    tracking.appendChild(text(doc, "h2", "slate-settings__heading", "Tracking"));
    tracking.appendChild(text(doc, "p", "slate-settings__lead", "How the recipe offers Track on each hopper. Automatic tracks hoppers whose resin changes at the changeover for you and only ever turns tracking on."));
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

    // Layout: where a layer's head stands in the Recipe's and the Weights
    // page's Grid. A phone keeps its own layout (slate.js), so there the
    // group is withheld (settings.css).
    const layout = element(doc, "section", "slate-settings__group slate-settings__group--layout", { "aria-label": "Layout" });
    layout.appendChild(text(doc, "h2", "slate-settings__heading", "Layout"));
    layout.appendChild(text(doc, "p", "slate-settings__lead", "Where each layer's name, role and share stand on the Recipe and Weights pages. Nothing about the recipe or the weights changes."));
    const layouts = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Layout" });
    const layoutButtons = new Map();
    for (const [mode, label, note] of [
      ["grid", "Grid", "Every layer a row of cells, its name at the start, positions lined up down the page."],
      ["grid-top", "Grid Top", "Every layer a column of cells, its name on top, positions lined up across. The cells keep their size and the columns sit centred."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-layout": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setLayout === "function") display.setLayout(mode); });
      layoutButtons.set(mode, button);
      layouts.appendChild(button);
    }
    layout.appendChild(layouts);
    if (!display) layout.appendChild(text(doc, "p", "slate-settings__note", "Layout cannot be changed on this page."));
    rootEl.appendChild(layout);

    // Handling: how a hopper's card moves while it is dragged. A phone
    // has no drag, so there the group is withheld with Layout (settings.css).
    const handling = element(doc, "section", "slate-settings__group slate-settings__group--layout", { "aria-label": "Handling" });
    handling.appendChild(text(doc, "h2", "slate-settings__heading", "Handling"));
    handling.appendChild(text(doc, "p", "slate-settings__lead", "How a hopper's card moves while you drag it to another hopper."));
    const handlings = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Handling" });
    const handlingButtons = new Map();
    for (const [mode, label, note] of [
      ["lift", "Lift", "The card rises off the page; the hopper it would land on swells to meet it."],
      ["tilt", "Tilt", "Lifted, and it leans the way you carry it, settling upright when you pause."],
      ["float", "Float", "It bobs gently as you carry it and settles over a hopper."],
      ["glow", "Glow", "The card stays flat and its edge breathes; the hopper under it answers."],
      ["glass", "Glass", "A frosted card, the page blurred through it."],
      ["stamp", "Stamp", "Made for Gruvbox: flat, a hard offset shadow, pressed down over a hopper."],
      ["neon", "Neon", "Made for Retro 82: a lit edge, scan lines and a flicker as it switches on."],
      ["still", "Still", "No movement: the card follows the pointer as it is."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-handling": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setHandling === "function") display.setHandling(mode); });
      handlingButtons.set(mode, button);
      handlings.appendChild(button);
    }
    handling.appendChild(handlings);
    if (!display) handling.appendChild(text(doc, "p", "slate-settings__note", "Handling cannot be changed on this page."));
    rootEl.appendChild(handling);

    // Layer order: which way the same pages run the layers.
    const ordering = element(doc, "section", "slate-settings__group", { "aria-label": "Layer order" });
    ordering.appendChild(text(doc, "h2", "slate-settings__heading", "Layer order"));
    ordering.appendChild(text(doc, "p", "slate-settings__lead", "Which way the Recipe and Weights pages list the layers."));
    const orders = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Layer order" });
    const orderButtons = new Map();
    for (const [mode, label, note] of [
      ["forward", "A \u2192 E", "Layer A first, as the line numbers them."],
      ["reversed", "E \u2192 A", "The last layer first; layer A at the end."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-layer-order": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setLayerOrder === "function") display.setLayerOrder(mode); });
      orderButtons.set(mode, button);
      orders.appendChild(button);
    }
    ordering.appendChild(orders);
    if (!display) ordering.appendChild(text(doc, "p", "slate-settings__note", "Layer order cannot be changed on this page."));
    rootEl.appendChild(ordering);

    // Timeline: the run-down on a clock, or as a list.
    const timeline = element(doc, "section", "slate-settings__group", { "aria-label": "Timeline" });
    timeline.appendChild(text(doc, "h2", "slate-settings__heading", "Timeline"));
    timeline.appendChild(text(doc, "p", "slate-settings__lead", "How the aside shows the run-down of the tracked hoppers."));
    const views = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Timeline view" });
    const viewButtons = new Map();
    for (const [mode, label, note] of [
      ["realtime", "Realtime", "On a clock: Now at the top, each hopper at its mark, the changeover below."],
      ["list", "List", "Rows in time order, without the clock. Pumped off stays at the foot."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-timeline-view": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setTimelineView === "function") display.setTimelineView(mode); });
      viewButtons.set(mode, button);
      views.appendChild(button);
    }
    timeline.appendChild(views);
    if (!display) timeline.appendChild(text(doc, "p", "slate-settings__note", "The timeline's view cannot be changed on this page."));
    rootEl.appendChild(timeline);

    // What this device opens when the address names no view (slate-host.js).
    const opening = element(doc, "section", "slate-settings__group", { "aria-label": "This device opens" });
    opening.appendChild(text(doc, "h2", "slate-settings__heading", "This device opens"));
    opening.appendChild(text(doc, "p", "slate-settings__lead", "What Resin.Tools shows when it starts on this device - in the Android app, which has no address bar, this is the way to choose. It takes effect the next time the page or the app opens."));
    const hosts = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "This device opens" });
    const hostButtons = new Map();
    for (const [choice, label, note] of [
      ["auto", "Automatic", "Slate on a desktop and a tablet; the floor UI on a phone."],
      ["slate", "Slate", "Always Slate, a phone included."],
      ["legacy", "Legacy", "Always the floor UI. Slate stays one visit away at ?view=slate."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-host-choice": choice });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setHostChoice === "function") display.setHostChoice(choice); });
      hostButtons.set(choice, button);
      hosts.appendChild(button);
    }
    opening.appendChild(hosts);
    if (!display) opening.appendChild(text(doc, "p", "slate-settings__note", "What this device opens cannot be changed on this page."));
    rootEl.appendChild(opening);

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
      type: "email", autocomplete: "username", spellcheck: "false", autocapitalize: "none", enterkeyhint: "next", "aria-label": "Administrator email", placeholder: "Email", "data-slate-admin": "email"
    });
    const passwordField = element(doc, "input", "slate-settings__admin-field", {
      type: "password", autocomplete: "current-password", enterkeyhint: "go", "aria-label": "Administrator password", placeholder: "Password", "data-slate-admin": "password"
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

    // The way back to the floor UI, at the very foot: a phone's header has
    // no room for it (settings.css shows it there only).
    const legacyHref = typeof settings.legacy === "function" ? settings.legacy() : "?view=legacy";
    const legacyFoot = element(doc, "p", "slate-settings__legacy");
    const legacyLink = text(doc, "a", "slate-settings__legacy-link", "Open Resin.Tools (Legacy)", { href: legacyHref || "?view=legacy" });
    legacyFoot.appendChild(legacyLink);
    rootEl.appendChild(legacyFoot);

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
      for (const entry of tiles.values()) {
        const family = entry.family;
        const live = [family.light, family.dark, family.only].find(item => item && item.id === selected);
        // The live family shows the live half; the others keep a turned
        // switch, or start on the live theme's scheme.
        if (live) { entry.scheme = live.scheme; entry.turned = false; }
        else if (!entry.turned) entry.scheme = liveScheme();
        const item = shown(entry);
        const on = !!live;
        entry.choose.setAttribute("data-theme-choice", item.id);
        entry.choose.setAttribute("aria-checked", on ? "true" : "false");
        entry.box.classList.toggle("is-selected", on);
        entry.swatch.setAttribute("data-theme", item.id);
        if (entry.name.textContent !== item.label) entry.name.textContent = item.label;
        if (entry.description.textContent !== (item.description || "")) entry.description.textContent = item.description || "";
        if (entry.toggle) {
          const night = item.scheme === "dark";
          entry.toggle.setAttribute("aria-checked", night ? "true" : "false");
          entry.toggle.setAttribute("aria-label", `${night ? "Night" : "Day"}: ${item.label}`);
          entry.toggle.setAttribute("title", night ? `Switch to ${family.light.label}` : `Switch to ${family.dark.label}`);
        }
      }
      const backgroundChoice = display && typeof display.getBackground === "function" ? display.getBackground() : null;
      for (const [id, button] of backgroundButtons) {
        const on = id === backgroundChoice;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const handlingMode = display && typeof display.getHandling === "function" ? display.getHandling() : null;
      for (const [id, button] of handlingButtons) {
        const on = id === handlingMode;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const trackingMode = display && typeof display.getTrackingMode === "function" ? display.getTrackingMode() : null;
      for (const [id, button] of trackingButtons) {
        const on = id === trackingMode;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const layoutMode = display && typeof display.getLayout === "function" ? display.getLayout() : null;
      for (const [id, button] of layoutButtons) {
        const on = id === layoutMode;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const order = display && typeof display.getLayerOrder === "function" ? display.getLayerOrder() : null;
      for (const [id, button] of orderButtons) {
        const on = id === order;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const timelineView = display && typeof display.getTimelineView === "function" ? display.getTimelineView() : null;
      for (const [id, button] of viewButtons) {
        const on = id === timelineView;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const hostChoice = display && typeof display.getHostChoice === "function" ? display.getHostChoice() : null;
      for (const [id, button] of hostButtons) {
        const on = id === hostChoice;
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
      // A family's tile - by the family (yaru) or either half (yaru-dark) -
      // its choosing button and its day / night switch.
      tile: id => { const entry = tiles.get(String(id).replace(/-(light|dark)$/, "")); return entry ? entry.choose : null; },
      themeSwitch: id => { const entry = tiles.get(String(id).replace(/-(light|dark)$/, "")); return entry ? entry.toggle : null; },
      background: id => backgroundButtons.get(id) || null,
      handling: id => handlingButtons.get(id) || null,
      trackingMode: id => trackingButtons.get(id) || null,
      layout: id => layoutButtons.get(id) || null,
      layerOrder: id => orderButtons.get(id) || null,
      timelineView: id => viewButtons.get(id) || null,
      hostChoice: id => hostButtons.get(id) || null,
      admin: () => ({ open: adminOpen, pending: adminPending, note: adminNote.textContent, signedIn: adminGroup.classList.contains("is-signed-in") }),
      // Left behind, the block closes and the password goes with it.
      onHide() { openAdmin(false); }
    });
  }

  return Object.freeze({ create });
});
