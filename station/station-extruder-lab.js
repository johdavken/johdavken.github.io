/* Extruder Lab - a development-only study, not part of the product.
 *
 * WHY IT EXISTS
 *
 * The extruder is drawn at about 60 units wide on the real stage, which is too
 * small to judge geometry by. This renders the SAME component at several times
 * that size, in the yaw states that matter, side by side - so a proportion that
 * is wrong is obvious instead of merely suspicious.
 *
 * IT IS THE SAME COMPONENT. Every machine below comes from
 * PolynStationMachineParts.extruder() fed by
 * PolynStationMachineLayout.extruderGeometry(). There is no lab-only artwork
 * and no second renderer; if the lab looks right and the stage does not, the
 * difference is scale, which is the whole point of looking.
 *
 * REMOVING IT
 *
 * Delete this file, its <script> tag in station/station.html, and the
 * `labRequested()` branch in station/station.js. Nothing else refers to it, and
 * it is never loaded by station-host.js - so the real application cannot reach
 * it at all.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationExtruderLab = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* The states worth comparing: both extremes, both midpoints, and straight on.
   * Derived from the real maximum rather than typed in, so the lab cannot drift
   * away from what the stage actually draws. */
  function specimens(maxYaw) {
    return [
      { label: "strong left", angle: -maxYaw },
      { label: "moderate left", angle: -maxYaw / 2 },
      { label: "front", angle: 0 },
      { label: "moderate right", angle: maxYaw / 2 },
      { label: "strong right", angle: maxYaw }
    ];
  }

  /**
   * @param {Document} doc
   * @param {object} deps  { layout, parts }
   * @param {object} [options]  { scale, gap }
   */
  function render(doc, deps, options) {
    const settings = options || {};
    const layout = deps.layout;
    const parts = deps.parts;
    const scale = settings.scale || 3.2;
    const gap = settings.gap || 40;
    const d = layout.DIMENSIONS;
    const cases = specimens(d.extruderMaxYaw);

    // Measure every specimen first, so the cells are sized by the widest one
    // rather than by a guess - a strongly yawed machine is much wider than a
    // front-facing one.
    const measured = cases.map(one => ({
      ...one,
      geometry: layout.extruderGeometry(one.angle, d, { pivotX: 0, pivotY: 0, scale })
    }));
    // Sized to the widest specimen's ACTUAL extent, not to a symmetric guess
    // about it - a strongly yawed machine reaches much further one way than the
    // other, and padding both sides equally wastes most of the canvas.
    const cellWidth = Math.max(...measured.map(one =>
      one.geometry.bounds.right - one.geometry.bounds.left)) + gap;
    const cellHeight = Math.max(...measured.map(one => one.geometry.height)) + 104;

    const width = cellWidth * measured.length;
    const svg = parts.node(doc, "svg", "station-machine__stage station-lab", {
      viewBox: `0 0 ${Math.round(width)} ${Math.round(cellHeight)}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Extruder study: five yaw states drawn from one component"
    });

    measured.forEach((one, index) => {
      const centerX = cellWidth * index + cellWidth / 2;
      const top = 84;
      const cell = parts.group(doc, "station-lab__cell", "lab-cell", {
        "data-yaw": Math.round(one.angle * 100) / 100
      });

      cell.appendChild(parts.label(doc, one.label, centerX, 30, "station-lab__title"));
      cell.appendChild(parts.label(doc, `yaw ${Math.round(one.angle)}°`, centerX, 48, "station-lab__caption"));

      /* The centreline. The rear feed point must sit on it in every state -
       * that is the claim the lab exists to make visible, because a model that
       * rotated the machine would drift off it. */
      cell.appendChild(parts.node(doc, "line", "station-lab__centreline", {
        x1: centerX, y1: 58, x2: centerX, y2: cellHeight - 24
      }));

      // The real component, from the real geometry function.
      const geometry = layout.extruderGeometry(one.angle, d, {
        pivotX: centerX, pivotY: top, scale
      });
      cell.appendChild(parts.extruder(doc, { id: `LAB${index}`, extruder: geometry }, 20));
      svg.appendChild(cell);
    });

    return svg;
  }

  function mount(host, doc, deps, options) {
    if (!host) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    const svg = render(doc, deps, options);
    host.appendChild(svg);
    host.setAttribute("data-station-lab", "extruder");
    return svg;
  }

  return { SVG_NS, specimens, render, mount };
});
