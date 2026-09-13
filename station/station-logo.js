/* The Station logo: the hopper-and-flow mark and the STATION wordmark,
 * drawn in the header in place of the name.
 *
 * WHAT IT IS
 *
 * Identity, as the name was: a hopper with three chevrons of flow
 * falling from it - the same motif a tracked hopper wears on the stage -
 * and the word STATION cut as custom paths, no font. The O carries an
 * inset in the accent that breathes once every few seconds; decoration,
 * not live status, and still under reduced motion.
 *
 * WHY IT IS DRAWN HERE
 *
 * Station's identity follows its theme (six of them): the ink is the
 * text colour, the flow is the tracked-flow colour, the inset is the
 * accent. An SVG loaded through an <img> cannot read the page's tokens,
 * so the mark is built inline from its path data, as the Handbook's
 * launcher icon is, and the stylesheet (shell.css) colours it. The
 * reusable file at station/assets/station-logo.svg carries the same
 * paths with its own defaults for use outside the console; a test keeps
 * the two in step.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationLogo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* The artwork, 380 by 48: the mark at the left, the word from x=54. */
  const VIEW_BOX = "0 0 380 48";
  const HOPPER = "M4 2 H36 L25 22 H15 Z";
  const FLOW = Object.freeze(["14,27 20,31.5 26,27", "14,33 20,37.5 26,33", "14,39 20,43.5 26,39"]);
  const INK = Object.freeze([
    "M10 2H39V10H13L9 14V19H30L40 29V36L30 46H1V38H27L31 34V31L27 27H10L0 17V12Z",
    "M48 2H90V10H74V46H65V10H48Z",
    "M112 2H123L145 46H135L130 36H105L100 46H90ZM109 28H126L117.5 11Z",
    "M145 2H187V10H171V46H162V10H145Z",
    "M199 2H208V46H199Z",
    "M236 2H232L222 12V36L232 46H253L263 36V12L253 2H250V10L254 15V33L249 38H236L231 33V15L236 10Z",
    "M277 46V2H286L317 32V2H326V46H317L286 16V46Z"
  ]);
  const SIGNAL = "M239 2H247V10H239Z";
  /* The A is cut with a hole: its counter is the second subpath. */
  const EVEN_ODD = Object.freeze([2]);

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  /**
   * Build the logo.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {string} [options.label]  the accessible name; "Station" by default
   * @returns {Element} the <svg>
   */
  function create(doc, options) {
    const settings = options || {};
    const label = typeof settings.label === "string" && settings.label ? settings.label : "Station";
    const svg = svgNode(doc, "svg", "station-logo", {
      viewBox: VIEW_BOX, role: "img", "aria-label": label, focusable: "false"
    });
    const title = svgNode(doc, "title");
    title.textContent = label;
    svg.appendChild(title);
    svg.appendChild(svgNode(doc, "path", "station-logo__hopper", { d: HOPPER }));
    FLOW.forEach((points, index) => {
      svg.appendChild(svgNode(doc, "polyline", `station-logo__flow${index ? ` station-logo__flow--${index + 1}` : ""}`, { points }));
    });
    const word = svgNode(doc, "g", null, { transform: "translate(54 0)" });
    const ink = svgNode(doc, "g", "station-logo__ink");
    INK.forEach((d, index) => {
      const attributes = { d };
      if (EVEN_ODD.includes(index)) attributes["fill-rule"] = "evenodd";
      ink.appendChild(svgNode(doc, "path", null, attributes));
    });
    word.appendChild(ink);
    word.appendChild(svgNode(doc, "path", "station-logo__signal", { d: SIGNAL }));
    svg.appendChild(word);
    return svg;
  }

  return Object.freeze({ VIEW_BOX, HOPPER, FLOW, INK, SIGNAL, EVEN_ODD, create });
});
