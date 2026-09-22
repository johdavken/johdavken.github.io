/* Line Configuration: what each production line IS - how many layers it
 * runs, which way round they stack, how its hoppers are named, measured
 * and built - held as definitions in the database rather than in a
 * release.
 *
 * A definition is not a workspace: adding a line here describes a line
 * the plant has, it does not create anywhere for a device to sync. Other
 * devices read definitions when they start, so a change here reaches them
 * on their next load.
 *
 * Every action is one request through slate-admin-actions.js, and nothing
 * here is read or asked for until an administrator is signed in and the
 * section is on screen.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(pick("PolynSlateAdminActions", "./slate-admin-actions.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateLineConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (actionsModule) {
  "use strict";

  const TITLE = "Line Configuration";
  const LEAD = "Every line definition: layers, orientation, hoppers and naming.";
  const SIGNED_OUT = "No administrator is signed in. Sign in under Administrator access in Settings.";
  const NO_BRIDGE = "No application is connected to Slate's administrator tools.";
  const SOON = "The definitions and their editor arrive in a later phase.";

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
   * @param {object|null} ctx.admin  the admin bridge
   * @param {function} [ctx.say]     a line for the operator
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const admin = settings.admin || null;

    const rootEl = element(doc, "div", "slate-admin", { "data-admin": "line-config" });
    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", LEAD);
    bar.appendChild(subtitle);
    rootEl.appendChild(bar);

    const body = element(doc, "div", "slate-admin__body");
    const gate = text(doc, "p", "slate-admin__gate", SIGNED_OUT, { role: "status" });
    const stub = text(doc, "p", "slate-stub", SOON, { hidden: "" });
    body.appendChild(gate);
    body.appendChild(stub);
    rootEl.appendChild(body);

    function paint() {
      const connected = !!(admin && typeof admin.isConnected === "function" && admin.isConnected());
      const open = !!(actionsModule && actionsModule.signedIn(admin));
      gate.textContent = connected ? SIGNED_OUT : NO_BRIDGE;
      show(gate, !open);
      show(stub, open);
    }

    if (admin && typeof admin.subscribe === "function") admin.subscribe(paint);
    paint();

    return Object.freeze({
      element: rootEl,
      refresh: paint,
      onShow: paint,
      onHide() {}
    });
  }

  return Object.freeze({ TITLE, LEAD, SIGNED_OUT, NO_BRIDGE, SOON, create });
});
