/* The Resin.Tools mark, drawn for Slate.
 *
 * The application's rail carries an inline SVG symbol (index.html,
 * #rtConfluenceMark): five resin streams into a die inside a calibration
 * ring, and the RT letterforms. Slate draws the same geometry - every path
 * here is that symbol's, and slate-logo.test.js pins them equal - but on
 * its own tokens: the letterforms in the text colour, the streams in the
 * theme's layer and accent colours, and nothing turning. The application's
 * sprite sits inside the <main> host.css hides, and its colours and rotor
 * are legacy CSS; a <use> of it would draw in the wrong palette.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateLogo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const VIEW_BOX = "0 0 196 104";

  /* Path data, verbatim from the application's symbol. */
  const PATHS = Object.freeze({
    channel: "M0-35C16-35 29-25 33-12L24-9C21-19 12-25 2-25C-5-25-11-22-15-17L-22-23C-16-31-8-35 0-35Z",
    channelInner: "M-19-14C-12-23 0-26 10-22",
    channelGlint: "M-9-29C-3-31 3-31 9-29M24-20l3 3",
    ticks: "M0-38.5V-43M12.361-38.042l.556-1.712M23.511-32.361l1.058-1.456M32.361-23.511l1.456-1.058M38.042-12.361l1.712-.556M38.5 0H43M38.042 12.361l1.712.556M32.361 23.511l1.456 1.058M23.511 32.361l1.058 1.456M12.361 38.042l.556 1.712M0 38.5V43M-12.361 38.042l-.556 1.712M-23.511 32.361l-1.058 1.456M-32.361 23.511l-1.456 1.058M-38.042 12.361l-1.712.556M-38.5 0H-43M-38.042-12.361l-1.712-.556M-32.361-23.511l-1.456-1.058M-23.511-32.361l-1.058-1.456M-12.361-38.042l-.556-1.712",
    cardinals: "M0-38.5V-43M38.5 0H43M0 38.5V43M-38.5 0H-43",
    die: "M0-15 14.3-4.6 8.8 12.1H-8.8L-14.3-4.6Z",
    filmTop: "m-7-3 7-3.3L7-3 0 .3Z",
    filmFolds: "m-7 .5 7 3.3L7 .5M-7 4l7 3.3L7 4",
    letterR: "M99 28h23c14 0 22 7 22 19 0 8-4 14-11 17l15 19h-15l-13-17h-9v17H99Zm12 11v16h10c8 0 11-3 11-8s-3-8-11-8Z",
    letterT: "M146 28h43v11h-16v44h-12V39h-15Z",
    outputs: Object.freeze(["M100 91h12", "M117 91h12", "M134 91h12", "M151 91h12", "M168 91h20"]),
    rule: "M100 20h24m4 0h4"
  });

  /* One token per stream, in the symbol's order. The application colours
   * them by status (bad, orange, warn, ok, focus); Slate by what the mark
   * shows - resins into a film - so the film's layer colours and the accent. */
  const STREAMS = Object.freeze([
    "var(--slate-accent)",
    "var(--slate-layer-core)",
    "var(--slate-layer-subskin)",
    "var(--slate-layer-outside)",
    "var(--slate-layer-inside)"
  ]);

  function svgNode(doc, name, attributes) {
    const node = doc.createElementNS(SVG_NS, name);
    if (attributes) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    }
    return node;
  }

  function channel(doc, index) {
    const group = svgNode(doc, "g", { class: "slate-logo__stream", transform: `rotate(${index * 72})` });
    group.style.color = STREAMS[index];
    group.appendChild(svgNode(doc, "path", { d: PATHS.channel, fill: "currentColor" }));
    group.appendChild(svgNode(doc, "path", { d: PATHS.channelInner, fill: "none", stroke: "currentColor", "stroke-width": "1.3", "stroke-linecap": "round" }));
    group.appendChild(svgNode(doc, "path", { d: PATHS.channelGlint, fill: "none", stroke: "var(--slate-text)", "stroke-width": ".7", opacity: ".52" }));
    return group;
  }

  /**
   * The mark as an <svg>. `currentColor` is the letterforms' and the
   * linework's colour, so the caller colours it with `color`.
   */
  function create(doc, options) {
    const settings = options || {};
    const svg = svgNode(doc, "svg", {
      class: "slate-logo",
      viewBox: VIEW_BOX,
      role: "img",
      "aria-label": settings.label || "Resin.Tools",
      focusable: "false"
    });

    const ring = svgNode(doc, "g", { transform: "translate(49 52)", fill: "none", stroke: "currentColor" });
    ring.appendChild(svgNode(doc, "circle", { r: "40", "stroke-width": ".65", opacity: ".22" }));
    ring.appendChild(svgNode(doc, "path", { d: PATHS.ticks, "stroke-width": ".65", opacity: ".32" }));
    ring.appendChild(svgNode(doc, "path", { d: PATHS.cardinals, "stroke-width": "1", opacity: ".65" }));
    svg.appendChild(ring);

    const confluence = svgNode(doc, "g", { transform: "translate(49 52)" });
    for (let index = 0; index < STREAMS.length; index += 1) confluence.appendChild(channel(doc, index));
    confluence.appendChild(svgNode(doc, "path", { d: PATHS.die, fill: "none", stroke: "currentColor", "stroke-width": "1.25", "stroke-linejoin": "round", opacity: ".75" }));
    const film = svgNode(doc, "g", { fill: "none", stroke: "currentColor", "stroke-width": "1.45", "stroke-linecap": "round", "stroke-linejoin": "round" });
    film.appendChild(svgNode(doc, "path", { d: PATHS.filmTop }));
    film.appendChild(svgNode(doc, "path", { d: PATHS.filmFolds }));
    confluence.appendChild(film);
    svg.appendChild(confluence);

    const letters = svgNode(doc, "g", { fill: "currentColor" });
    letters.appendChild(svgNode(doc, "path", { "fill-rule": "evenodd", d: PATHS.letterR }));
    letters.appendChild(svgNode(doc, "path", { d: PATHS.letterT }));
    svg.appendChild(letters);

    const outputs = svgNode(doc, "g", { fill: "none", "stroke-width": "1.5" });
    PATHS.outputs.forEach((d, index) => {
      outputs.appendChild(svgNode(doc, "path", { d, stroke: STREAMS[index] }));
    });
    svg.appendChild(outputs);

    svg.appendChild(svgNode(doc, "path", { d: PATHS.rule, fill: "none", stroke: "currentColor", "stroke-width": ".7", opacity: ".4" }));
    return svg;
  }

  return Object.freeze({ SVG_NS, VIEW_BOX, PATHS, STREAMS, create });
});
