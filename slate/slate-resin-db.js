/* Resin Database: the catalog every recipe's resin is looked up in -
 * each code, its density and its bulk density, and whether it is still
 * offered.
 *
 * Slate never touches the catalog cache itself: the application refreshes
 * it when a save goes through, which is how the recipe's search and the
 * Smart Hopper weights see a change. Deactivating is the usual way to
 * retire a code, since a recipe that already names it must stay loadable;
 * deleting is permanent and asked for on its own.
 *
 * Every action is one request through slate-admin-actions.js, and nothing
 * here is read or asked for until an administrator is signed in and the
 * section is on screen.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(pick("PolynSlateAdminActions", "./slate-admin-actions.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateResinDb = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (actionsModule) {
  "use strict";

  const TITLE = "Resin Database";
  const LEAD = "The shared resin catalog: codes, densities and what is still offered.";
  const SIGNED_OUT = "No administrator is signed in. Sign in under Administrator access in Settings.";
  const NO_BRIDGE = "No application is connected to Slate's administrator tools.";
  const SOON = "The catalog and its editor arrive in a later phase.";

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

    const rootEl = element(doc, "div", "slate-admin", { "data-admin": "resins" });
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
