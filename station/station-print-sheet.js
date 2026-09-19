/* The Station recipe print sheet: the application's Print Recipe, from
 * the rail's Print row.
 *
 * WHAT IT IS
 *
 * The floor UI's printed recipe sheet (app.js: openPrintRecipeDialog,
 * buildRecipePrintSection, printRecipeSheet), as the desktop console
 * prints it - the same sheet, page for page: a heading naming which
 * recipe it is, so a sheet carried to the line is never mistaken for
 * the one running; a line under it naming the line, its layer count,
 * its hopper naming and when it was printed; then one overview table
 * that reads like the printouts operators already get off the dosing
 * controller - a layer to a row, its letter and share in the row's
 * head, a hopper to a column, the resin code over its share in every
 * cell, NOT USED where no resin is. Both recipes on one sheet stand one
 * over the other with a rule between them, never on two pages.
 *
 * The choice the floor UI asks in a dialog - Current, Next or Both -
 * the rail asks as a row of tiles (station-machine-rail.js); Next and
 * Both are held when nothing is planned, as the dialog's are.
 *
 * THE FRAME
 *
 * The floor UI writes its sheet into the page and, at print time, hides
 * everything else with a print rule of its own. Station cannot do that:
 * in the application's Station view that rule would hide the console
 * too, and Station's stylesheets carry no print rule, no id and no
 * override (station-isolation). So the sheet is written into a frame
 * of its own - an iframe, kept out of sight in the utility slot - with
 * the sheet's own stylesheet in it, and the FRAME is printed. Nothing
 * on the page is hidden, nothing on the page is printed; the sheet is
 * the whole document the printer sees. The frame stays until the next
 * print replaces it, so a print dialog still open is never pulled out
 * from under the operator.
 *
 * The orientation: layers as rows, always - the controller's own layout
 * and the floor UI's default. The floor UI follows its Recipe matrix
 * setting; that is a per-device display preference the state bridge
 * deliberately leaves out, so Station has nothing to follow.
 *
 * WHERE IT WRITES
 *
 * Nowhere. Printing reads the recipes as Station already holds them;
 * no command, no storage, no sync. The frame's document is the only
 * thing built.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationPrintSheet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PAGES = Object.freeze(["current", "next", "both"]);
  const TITLE = Object.freeze({ current: "Current Recipe", next: "Next Recipe" });

  /* The sheet's own stylesheet, written into the frame beside the sheet:
   * a printed page is black on white whatever the console's theme, and
   * a frame's document sees none of the console's stylesheets. Colours
   * are the printer's (the system's canvas and text), not the theme's.
   * The rules are the floor UI's print rules (styles-surfaces.css), one
   * for one, on Station's own class names. */
  const SHEET_STYLE = [
    "@page { margin: 12mm; }",
    ".station-sheet { margin: 0; color: CanvasText; background: Canvas; font-family: system-ui, sans-serif; }",
    ".station-sheet__header { margin-bottom: 10px; }",
    ".station-sheet__title { font-size: 18px; margin: 0 0 3px; }",
    ".station-sheet__meta { font-size: 11px; }",
    ".station-sheet__table { width: 100%; border-collapse: collapse; table-layout: fixed; }",
    ".station-sheet__table th, .station-sheet__table td { border: 1px solid currentColor; padding: 4px 6px; text-align: left; vertical-align: top; }",
    ".station-sheet__table thead th { font-size: 11px; font-weight: 600; }",
    /* The layer's head cell stays a table cell - a flex cell would drop
       out of the table's column layout - so the letter and its share
       read left to right as ordinary text. */
    ".station-sheet__layer { font-size: 20px; font-weight: 700; text-align: center; vertical-align: middle; }",
    ".station-sheet__layer-pct { font-size: 13px; font-weight: 600; margin-left: 6px; }",
    ".station-sheet__resin { font-size: 11px; font-weight: 600; line-height: 1.3; }",
    ".station-sheet__pct { font-size: 13px; line-height: 1.3; }",
    ".station-sheet__section--divided { margin-top: 14px; padding-top: 14px; border-top: 2px solid currentColor; }"
  ].join("\n");

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

  /* The floor UI's fmtNum(clampNum(x), 2): two decimals, 0 for nothing. */
  function pct(value) {
    const number = Number(value);
    return `${(Number.isFinite(number) ? number : 0).toFixed(2)}%`;
  }

  /* The column heads: naming-mode-generic, as the floor UI's - the layer
   * is the row, so the head says the position only. */
  function hopperColumnLabels(namingMode, count) {
    const main = namingMode === "main" || namingMode === "main-plus-five";
    return Array.from({ length: count }, (_, index) => (main ? (index === 0 ? "Main" : String(index)) : `H${index + 1}`));
  }

  function namingLabel(namingMode) {
    return namingMode === "main" || namingMode === "main-plus-five" ? "Main + 1–5" : "1–6";
  }

  /* One recipe's section of the sheet. `layers` is the recipe as Station
   * resolves it: [{ name, layerPct, hoppers: [{ resinName, pct }] }]. */
  function buildSection(doc, page, layers, line, printedAt) {
    const section = element(doc, "section", "station-sheet__section", { "data-page": page });
    const header = element(doc, "header", "station-sheet__header");
    header.appendChild(text(doc, "h1", "station-sheet__title", TITLE[page] || TITLE.current));
    const layerCount = Number.isInteger(line.layerCount) ? line.layerCount : layers.length;
    const meta = [
      line.displayName || "No line",
      `${layerCount} layer${layerCount === 1 ? "" : "s"}`,
      `Hopper naming: ${namingLabel(line.hopperNamingMode)}`,
      `Printed ${printedAt}`
    ].join(" · ");
    header.appendChild(text(doc, "div", "station-sheet__meta", meta));
    section.appendChild(header);

    const columns = layers.reduce((most, layer) => Math.max(most, layer.hoppers.length), 0);
    const labels = hopperColumnLabels(line.hopperNamingMode, columns);
    const table = element(doc, "table", "station-sheet__table");
    const thead = element(doc, "thead");
    const headRow = element(doc, "tr");
    headRow.appendChild(element(doc, "th"));
    for (const label of labels) headRow.appendChild(text(doc, "th", null, label, { scope: "col" }));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = element(doc, "tbody");
    for (const layer of layers) {
      const row = element(doc, "tr", null, { "data-layer": layer.name });
      const head = element(doc, "th", "station-sheet__layer", { scope: "row" });
      head.appendChild(text(doc, "span", null, layer.name));
      head.appendChild(text(doc, "span", "station-sheet__layer-pct", pct(layer.layerPct)));
      row.appendChild(head);
      for (let index = 0; index < columns; index += 1) {
        const hopper = layer.hoppers[index] || { resinName: "", pct: 0 };
        const cell = element(doc, "td");
        const name = String(hopper.resinName || "").trim();
        cell.appendChild(text(doc, "div", "station-sheet__resin", name || "NOT USED"));
        cell.appendChild(text(doc, "div", "station-sheet__pct", pct(hopper.pct)));
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  /**
   * The whole sheet: one section per page asked for, in order, a rule
   * between two.
   *
   * @param {Document} doc              the document the sheet is built in
   * @param {object}   request
   * @param {string}   request.which    "current" | "next" | "both"
   * @param {Array}    request.current  the running recipe's layers
   * @param {Array|null} request.next   the plan's layers, or null when nothing is planned
   * @param {object}   request.line     { displayName, layerCount, hopperNamingMode }
   * @param {string}   [request.printedAt]
   */
  function buildSheet(doc, request) {
    const r = request || {};
    const which = PAGES.includes(r.which) ? r.which : "current";
    const line = r.line || {};
    const printedAt = r.printedAt || new Date().toLocaleString();
    const pages = which === "both" ? ["current", "next"] : [which];
    const sheet = element(doc, "div", "station-sheet", { "data-role": "print-sheet" });
    pages.forEach((page, index) => {
      const layers = page === "next" ? (Array.isArray(r.next) ? r.next : []) : (Array.isArray(r.current) ? r.current : []);
      const section = buildSection(doc, page, layers, line, printedAt);
      if (index > 0) section.classList.add("station-sheet__section--divided");
      sheet.appendChild(section);
    });
    return { sheet, pages };
  }

  /* The default frame: an iframe in the mount, out of sight but laid out
   * (a frame not laid out cannot print in every browser), replaced by
   * the next print. */
  function defaultFrame(doc, mount) {
    const iframe = element(doc, "iframe", "station-print__frame", {
      "data-role": "print-frame", title: "Recipe print sheet", "aria-hidden": "true", tabindex: "-1"
    });
    mount.appendChild(iframe);
    const frameDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
    if (!frameDoc) { iframe.remove(); return null; }
    return {
      document: frameDoc,
      print: () => { if (iframe.contentWindow && typeof iframe.contentWindow.print === "function") iframe.contentWindow.print(); },
      remove: () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }
    };
  }

  /**
   * Build the printer.
   *
   * @param {Document} doc
   * @param {object}   options
   * @param {Element}  options.mount     where the frame stands
   * @param {function} [options.frame]   () => { document, print, remove }; the
   *        iframe by default - a test hands in its own
   * @param {function} [options.now]     () => Date
   */
  function create(doc, options) {
    const settings = options || {};
    const mount = settings.mount || null;
    const makeFrame = typeof settings.frame === "function" ? settings.frame : () => (mount ? defaultFrame(doc, mount) : null);
    const now = typeof settings.now === "function" ? settings.now : () => new Date();
    let frame = null;

    /* Print the sheet asked for. Refuses, and says why, a page there is
     * nothing to print for: the plan when nothing is planned. */
    function print(request) {
      const r = request || {};
      const which = PAGES.includes(r.which) ? r.which : null;
      if (!which) return { ok: false, code: "invalid", message: "Choose Current, Next or Both." };
      if (which !== "current" && !Array.isArray(r.next)) {
        return { ok: false, code: "nothing_planned", message: "Nothing is planned: there is no Next Recipe to print." };
      }
      if (frame) { frame.remove(); frame = null; }
      frame = makeFrame();
      if (!frame || !frame.document) return { ok: false, code: "unavailable", message: "The print frame could not be opened." };
      const frameDoc = frame.document;
      const { sheet, pages } = buildSheet(frameDoc, Object.assign({}, r, { printedAt: r.printedAt || now().toLocaleString() }));
      const head = frameDoc.head || frameDoc.querySelector("head");
      if (head) head.appendChild(text(frameDoc, "style", null, SHEET_STYLE));
      const body = frameDoc.body || frameDoc.querySelector("body");
      if (body) body.appendChild(sheet);
      frame.print();
      return { ok: true, which, pages };
    }

    return {
      print,
      frame: () => frame,
      dispose: () => { if (frame) { frame.remove(); frame = null; } }
    };
  }

  return Object.freeze({ PAGES, TITLE, SHEET_STYLE, pct, hopperColumnLabels, namingLabel, buildSheet, create });
});
