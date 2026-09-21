/* Printing the recipe sheet from Slate.
 *
 * The sheet itself is the floor UI's, built by station/station-print-sheet.js
 * - a module with no Station dependency that draws into any document and
 * carries its own print stylesheet. Slate hands it a frame of its own (an
 * iframe under a Slate class, so no Station rule is needed) and the
 * layers as the rows show them: the line's hoppers, the shown share and
 * blend, nothing runtime.
 */
(function (root, factory) {
  const sheet = typeof require === "function"
    ? require("../station/station-print-sheet.js")
    : (root && root.PolynStationPrintSheet);
  const api = factory(sheet);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlatePrint = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (sheetModule) {
  "use strict";

  const PAGES = Object.freeze(["current", "next", "both"]);
  const LABEL = Object.freeze({ current: "Current", next: "Next", both: "Both" });

  /** The sheet's layers for one recipe, or null when it is not there. */
  function layersFor(resolved, recipe) {
    const model = resolved && resolved.line;
    if (!model) return null;
    if (recipe === "next" && !(resolved.plan && resolved.plan.planned)) return null;
    const hoppers = recipe === "next" ? (resolved.nextHopperState || {}) : (resolved.hopperState || {});
    const layers = recipe === "next" ? (resolved.nextLayerState || {}) : (resolved.layerState || {});
    return model.layers.map(layer => ({
      name: layer.id,
      layerPct: layers[layer.id] ? layers[layer.id].layerPct : 0,
      hoppers: layer.hoppers.map(hopper => {
        const state = hoppers[`${layer.id}:${hopper.index}`] || {};
        return { resinName: state.resinName || "", pct: Number(state.pct) || 0 };
      })
    }));
  }

  function lineFor(resolved) {
    const line = resolved && resolved.line ? resolved.line.line : {};
    return {
      displayName: line.displayName || (Number.isInteger(line.lineNumber) ? `Line ${line.lineNumber}` : "This device"),
      layerCount: line.layerCount || 0,
      hopperNamingMode: line.hopperNamingMode || "standard"
    };
  }

  /** Whether a page has anything to print. */
  function available(which, resolved) {
    if (!PAGES.includes(which) || !resolved || !resolved.line) return false;
    const current = layersFor(resolved, "current") || [];
    const assigned = current.some(layer => layer.hoppers.some(hopper => hopper.resinName));
    const planned = !!(resolved.plan && resolved.plan.planned);
    if (which === "current") return assigned;
    if (which === "next") return planned;
    return assigned || planned;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {Element} options.mount   where the frame stands (the section root)
   * @param {object} [options.sheet]  the print-sheet module (for tests)
   * @param {function} [options.now]
   */
  function create(doc, options) {
    const settings = options || {};
    const mount = settings.mount;
    const sheet = settings.sheet || sheetModule;
    if (!sheet || typeof sheet.create !== "function" || !mount) return null;

    function frame() {
      const iframe = doc.createElement("iframe");
      iframe.setAttribute("class", "slate-print__frame");
      iframe.setAttribute("data-role", "print-frame");
      iframe.setAttribute("title", "Recipe print sheet");
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("tabindex", "-1");
      mount.appendChild(iframe);
      const frameDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (!frameDoc) { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); return null; }
      return {
        document: frameDoc,
        print: () => { if (iframe.contentWindow && typeof iframe.contentWindow.print === "function") iframe.contentWindow.print(); },
        remove: () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }
      };
    }

    const printer = sheet.create(doc, { mount, frame, now: settings.now });

    function print(which, resolved) {
      if (!PAGES.includes(which)) return { ok: false, code: "invalid", message: "Choose Current, Next or Both." };
      return printer.print({
        which,
        current: layersFor(resolved, "current") || [],
        next: layersFor(resolved, "next"),
        line: lineFor(resolved)
      });
    }

    return Object.freeze({ print, available: (which, resolved) => available(which, resolved), frame: () => printer.frame(), dispose: () => printer.dispose() });
  }

  return Object.freeze({ PAGES, LABEL, layersFor, lineFor, available, create });
});
