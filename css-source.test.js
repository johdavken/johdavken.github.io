"use strict";

/* Guards for the one-logical-view helper the suite reads styles.css through.
 *
 * These are the invariants a positional split of styles.css depends on. They
 * are nearly free to satisfy today, with the stylesheet still in one piece -
 * which is the point: they are installed BEFORE the cut, so the cut lands on
 * a net that already works rather than one written to describe it afterwards.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { STYLE_PARTS, readStyles, stylePartFilesOnDisk } = require("./css-source");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

test("the stylesheet has at least one part and it reads", () => {
  assert.ok(STYLE_PARTS.length >= 1, "index.html links no styles*.css at all");
  const css = readStyles();
  assert.ok(css.length > 1000);
  // Landmarks that must survive any cut: the very first rule of the file and
  // the global [hidden] rule that every other visibility rule defers to.
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.match(css, /:root\{/);
});

test("every part on disk is actually linked by index.html", () => {
  // The failure this catches is a cut that produces a new part file and
  // forgets its <link>: the suite would still pass, reading a stylesheet the
  // browser never loads, while the app silently lost those rules.
  const linked = new Set(STYLE_PARTS.map(p => path.basename(p)));
  const orphans = stylePartFilesOnDisk().filter(name => !linked.has(name));
  assert.deepEqual(orphans, [],
    "these styles*.css files exist but no <link> loads them - add the link, " +
    "or delete the file");
});

test("every linked part exists and is linked exactly once", () => {
  for (const part of STYLE_PARTS) {
    assert.ok(fs.existsSync(path.join(__dirname, part)), `${part} is linked but missing`);
  }
  assert.equal(new Set(STYLE_PARTS).size, STYLE_PARTS.length,
    "a part linked twice is applied twice, and the second copy wins ties");
});

test("each part is brace-balanced, so no cut lands inside a block", () => {
  // The catastrophic split failure: cutting inside an @media block leaves one
  // part with an unclosed brace and the next starting mid-block. Browsers
  // recover from that silently and differently than the original cascaded.
  // Each part must open and close at depth zero on its own.
  for (const part of STYLE_PARTS) {
    const css = fs.readFileSync(path.join(__dirname, part), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0, min = 0;
    for (const ch of css) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth < min) min = depth; }
    }
    assert.equal(depth, 0, `${part} ends at brace depth ${depth}, not 0`);
    assert.equal(min, 0, `${part} closes a block it never opened`);
  }
});

test("the parts are linked before theme.css, desktop.css and button-styling.css", () => {
  // Cascade order is document order. These three deliberately come after and
  // override; a part linked below them would quietly stop losing ties it is
  // supposed to lose.
  const order = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map(m => path.basename(m[1].split("?")[0]));
  const lastPart = Math.max(...STYLE_PARTS.map(p => order.indexOf(path.basename(p))));
  for (const after of ["theme.css", "desktop.css", "button-styling.css"]) {
    const at = order.indexOf(after);
    if (at === -1) continue;
    assert.ok(at > lastPart,
      `${after} is linked at ${at}, before or among the styles parts (last at ${lastPart})`);
  }
});

test("every part carries a cache-busting version tag", () => {
  // Eight parts means eight tags to bump. Shipping a changed part under its
  // old tag serves stale CSS from cache, which reads as "the change did
  // nothing" - the exact misdiagnosis that cost two debugging passes while
  // consolidating [hidden].
  for (const part of STYLE_PARTS) {
    const tag = new RegExp(`href="${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=[0-9.]+"`);
    assert.match(html, tag, `${part} is linked without a ?v= cache tag`);
  }
});
