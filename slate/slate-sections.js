/* Slate's sections: what the centre pane shows, and the swap between them.
 *
 * A section is a definition - an id, a label, a group (which part of the
 * rail lists it) and a `create` that builds it once - and the registry
 * mounts every section up front, hidden, so a section is already current
 * the moment it is shown: `update` fans the state out to all of them,
 * visible or not. The aside runs a second swap from the same registry:
 * the Timeline (group "aside": no rail item of its own) and the tools,
 * one in its place at a time.
 *
 *   definition: { id, label, group: "sections"|"tools"|"foot"|"aside", icon,
 *                 create(doc, ctx) -> { element, update?(resolved, meta), onShow?(), onHide?() } }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateSections = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const GROUPS = Object.freeze(["sections", "tools", "foot", "aside"]);
  const ENTERING = "is-entering";

  function valid(definition) {
    return !!definition
      && typeof definition.id === "string" && /^[a-z][a-z0-9-]*$/.test(definition.id)
      && typeof definition.label === "string" && definition.label.length > 0
      && GROUPS.includes(definition.group)
      && typeof definition.create === "function";
  }

  /**
   * Mount every section into `mount` and return the swap.
   *
   * @param {Document} doc
   * @param {Element} mount            the centre pane
   * @param {object[]} definitions
   * @param {object} ctx               handed to every section's create()
   * @param {object} [options]
   * @param {function} [options.onChange]  called with the definition now shown
   */
  function mountSections(doc, mount, definitions, ctx, options) {
    const settings = options || {};
    const sections = new Map();
    let shown = null;

    for (const definition of definitions || []) {
      if (!valid(definition)) throw new Error(`slate-sections: invalid section definition ${definition && definition.id}`);
      if (sections.has(definition.id)) throw new Error(`slate-sections: duplicate section ${definition.id}`);
      const built = definition.create(doc, ctx) || {};
      const wrapper = doc.createElement("div");
      wrapper.setAttribute("class", "slate-section");
      wrapper.setAttribute("data-section", definition.id);
      wrapper.setAttribute("hidden", "");
      if (built.element) wrapper.appendChild(built.element);
      wrapper.addEventListener("animationend", () => wrapper.classList.remove(ENTERING));
      mount.appendChild(wrapper);
      sections.set(definition.id, { definition, built, wrapper });
    }

    function show(id) {
      const next = sections.get(id);
      if (!next) return false;
      if (shown && shown !== next) {
        shown.wrapper.setAttribute("hidden", "");
        shown.wrapper.classList.remove(ENTERING);
        if (typeof shown.built.onHide === "function") shown.built.onHide();
      }
      const arriving = shown !== next;
      shown = next;
      next.wrapper.removeAttribute("hidden");
      if (arriving) {
        next.wrapper.classList.add(ENTERING);
        if (typeof next.built.onShow === "function") next.built.onShow();
        if (typeof settings.onChange === "function") settings.onChange(next.definition);
      }
      return true;
    }

    function update(resolved, meta) {
      for (const entry of sections.values()) {
        if (typeof entry.built.update !== "function") continue;
        try { entry.built.update(resolved, meta || {}); } catch (error) { /* one section cannot stop the others */ }
      }
    }

    return Object.freeze({
      show,
      update,
      current: () => (shown ? shown.definition : null),
      has: id => sections.has(id),
      definitions: () => [...sections.values()].map(entry => entry.definition),
      element: id => (sections.has(id) ? sections.get(id).wrapper : null),
      section: id => (sections.has(id) ? sections.get(id).built : null)
    });
  }

  return Object.freeze({ GROUPS, ENTERING, valid, mountSections });
});
