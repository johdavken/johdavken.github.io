"use strict";

/* The host boundary.
 *
 * Two of Slate's CSS rules are relaxed to let host.css exist: it may name an
 * application selector, and it may use !important. This file is what that
 * relaxation is traded for. host.css is held to rules the component sheets
 * are not: every selector gated on the Slate view attribute, a hard size cap,
 * and no way to touch the application unless the flag is set.
 *
 * The property that actually matters is the one at the top: with no
 * ?view=slate, nothing about Slate is in the document at all.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const host = fs.readFileSync(path.join(ROOT, "slate-host.js"), "utf8");
const hostCss = fs.readFileSync(path.join(ROOT, "slate/styles/host.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* Every element type Slate renders. Bare-element rules in the legacy sheets
 * reach all of these inside ?view=slate; the base layer must out-declare
 * every property they set. */
const SLATE_ELEMENTS = ["button", "input", "h1", "h2", "h3", "p", "dl", "dt", "dd", "ol", "ul", "li",
  "div", "span", "section", "nav", "aside", "header", "footer", "a", "label", "small", "strong", "time",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "svg", "g", "path", "rect", "circle", "line", "text", "use"];

const VIEW_GATE = '[data-slate-view="slate"]';

function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function cssCode(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function selectorsIn(css) {
  const withoutComments = cssCode(css);
  const selectors = [];
  const pattern = /(^|[}{;])\s*([^{}@;]+?)\s*\{/g;
  let match;
  while ((match = pattern.exec(withoutComments))) {
    const text = match[2].trim();
    if (!text || text.startsWith("@")) continue;
    for (const part of text.split(",")) if (part.trim()) selectors.push(part.trim());
  }
  return selectors;
}

function slateSheets() {
  const sheets = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) sheets.push(full);
    }
  })(path.join(ROOT, "slate/styles"));
  return sheets;
}

/* ----------------------------------------------------------------------
 *   Normal startup is untouched
 * -------------------------------------------------------------------- */

test("without the flag, the host returns before touching the document", () => {
  const gate = codeOnly(host).indexOf("if (!requested()) return;");
  assert.ok(gate > -1, "the host has no early return for the normal case");

  const before = codeOnly(host).slice(0, gate);
  for (const sideEffect of [/appendChild/, /createElement/, /setAttribute/, /classList/, /\.rel\s*=/, /\.src\s*=/]) {
    assert.doesNotMatch(before, sideEffect,
      "the host touches the document before deciding whether Slate was asked for");
  }
});

test("every asset the host loads is loaded dynamically, never linked in index.html", () => {
  for (const asset of ["slate/styles/tokens.css", "slate/styles/host.css",
    "slate/slate.js", "slate/slate-shell.js", "slate/slate-recipe.js"]) {
    assert.ok(codeOnly(host).includes(asset), `the host does not load ${asset}`);
    assert.ok(!indexHtml.includes(asset), `index.html statically links ${asset}`);
  }
  assert.doesNotMatch(indexHtml, /["'/]slate\//, "index.html references the slate/ directory");
});

test("the host is the only thing that sets the view attribute", () => {
  assert.match(host, /const ATTRIBUTE = "data-slate-view";/);
  assert.match(host, /doc\.body\.setAttribute\(ATTRIBUTE, VALUE\)/);
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.doesNotMatch(app, /data-slate-view|slate-root|PolynSlate/, "app.js knows Slate exists");
  const stationHost = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  assert.doesNotMatch(stationHost, /slate/i, "station-host.js knows Slate exists");
});

test("the flag is read from the URL and matched exactly", () => {
  assert.match(host, /const FLAG = "view";/);
  assert.match(host, /const VALUE = "slate";/);
  assert.match(host, /searchParams\.get\(FLAG\) === VALUE/);
  assert.match(host, /catch \(error\) \{\s*return false;\s*\}/);
});

/* ----------------------------------------------------------------------
 *   host.css is inert unless the flag is set
 * -------------------------------------------------------------------- */

test("every rule in host.css is gated on the Slate view attribute", () => {
  const selectors = selectorsIn(hostCss);
  assert.ok(selectors.length > 0);
  for (const selector of selectors) {
    assert.ok(selector.includes(VIEW_GATE),
      `host.css: "${selector}" is not gated on ${VIEW_GATE}, so it could affect a normal load`);
  }
});

test("host.css stays small enough to read in one sitting", () => {
  const selectors = selectorsIn(hostCss);
  assert.ok(selectors.length <= 3,
    `host.css has ${selectors.length} rules; it is the boundary, not a component`);
});

test("host.css hides the application by exclusion, never by naming its elements", () => {
  assert.match(hostCss, /body\[data-slate-view="slate"\] > :not\(\[data-slate-host\]\)/);
  for (const legacy of ["main", "footer", "dialog", "#appOverlayRoot", ".footerBar", ".mobileFooterMeta", "[data-station-host]"]) {
    const selectors = selectorsIn(hostCss).join(" | ");
    assert.ok(!new RegExp(`(^|[\\s>+~,(])${legacy.replace(/[.#[\]]/g, "\\$&")}([\\s>+~,)]|$)`).test(selectors),
      `host.css names the legacy element ${legacy}`);
  }
});

test("an open modal is the one application element let through the hide rule - by what it is, not by name", () => {
  const hide = selectorsIn(hostCss).find(selector => selector.includes(":not([data-slate-host])"));
  assert.ok(hide, "the hide rule is gone");
  assert.equal(hide, 'body[data-slate-view="slate"] > :not([data-slate-host]):not(:modal)');
  assert.doesNotMatch(hide, /dialog|\[open\]/, "the exception names a dialog rather than the modal state");
});

test("!important appears only in host.css, and only on the hide rule", () => {
  for (const sheet of slateSheets()) {
    const css = fs.readFileSync(sheet, "utf8");
    if (path.basename(sheet) === "host.css") continue;
    assert.doesNotMatch(css, /!important/, `${path.relative(ROOT, sheet)} uses !important`);
  }
  assert.equal((cssCode(hostCss).match(/!important/g) || []).length, 1,
    "host.css uses !important more than once - it is licensed for the hide rule only");
  assert.match(cssCode(hostCss), /display: none !important;/);
});

/* ----------------------------------------------------------------------
 *   Legacy CSS cannot style Slate
 * -------------------------------------------------------------------- */

test("Slate's base layer covers every property the legacy sheets set on bare elements it uses", () => {
  /* Inside the application document, a legacy `button { ... }` rule matches
   * Slate's buttons. Slate's own `.slate-root button` out-specifies it, but
   * only for properties it actually declares - so this derives the list from
   * the legacy stylesheets rather than trusting anyone to remember it. */
  const legacySheets = fs.readdirSync(ROOT)
    .filter(name => name.endsWith(".css"))
    .map(name => ({ name, css: fs.readFileSync(path.join(ROOT, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

  const reaching = new Map();
  for (const sheet of legacySheets) {
    const pattern = /(^|[};{])\s*([^{}@;]+?)\s*\{([^{}]*)\}/g;
    let match;
    while ((match = pattern.exec(sheet.css))) {
      const selectorText = match[2].trim();
      if (!selectorText || selectorText.startsWith("@")) continue;
      for (const selector of selectorText.split(",").map(one => one.trim())) {
        if (!SLATE_ELEMENTS.includes(selector)) continue;
        for (const declaration of match[3].split(";")) {
          if (!declaration.includes(":")) continue;
          const property = declaration.split(":")[0].trim();
          if (!reaching.has(selector)) reaching.set(selector, new Map());
          reaching.get(selector).set(property, sheet.name);
        }
      }
    }
  }
  assert.ok(reaching.has("button") && reaching.has("input"), "the derivation found nothing - the legacy sheets moved");

  const base = fs.readFileSync(path.join(ROOT, "slate/styles/base.css"), "utf8");
  const uncovered = [];
  for (const [element, properties] of reaching) {
    const rule = base.match(new RegExp(`\\.slate-root ${element}\\s*\\{([^}]*)\\}`));
    const declared = rule
      ? new Set(rule[1].split(";").filter(one => one.includes(":")).map(one => one.split(":")[0].trim()))
      : new Set();
    if (declared.has("font")) ["font-size", "font-weight", "font-family", "line-height"].forEach(one => declared.add(one));
    for (const [property, sheetName] of properties) {
      if (!declared.has(property)) uncovered.push(`${element}{${property}} from ${sheetName}`);
    }
  }
  assert.deepEqual(uncovered, [],
    "the legacy stylesheets set these on elements Slate renders, and Slate's base layer does not reset them - " +
    "inside ?view=slate they would leak into Slate");
});

test("the input reset repeats legacy's own selector shapes, so every specificity legacy uses is out-specified", () => {
  const base = cssCode(fs.readFileSync(path.join(ROOT, "slate/styles/base.css"), "utf8"));
  for (const shape of [
    '.slate-root input:not([type="checkbox"]):not([type="radio"])',
    ".slate-root input[readonly]",
    ".slate-root input:focus",
    ".slate-root input[readonly]:focus",
    '.slate-root input:not([type="checkbox"]):not([type="radio"]):focus'
  ]) {
    assert.ok(base.includes(shape), `base.css lacks the reset shape ${shape}`);
  }
});

test("the Slate shell avoids the one element the legacy grid owns", () => {
  // Legacy styles bare `main` with its own grid, and the application already
  // has a <main>; a second one is invalid as well as mis-styled.
  const shellPath = path.join(ROOT, "slate/slate-shell.js");
  if (!fs.existsSync(shellPath)) return;
  const shell = fs.readFileSync(shellPath, "utf8");
  assert.doesNotMatch(codeOnly(shell), /createElement\("main"\)|"main"/, "the Slate shell creates a <main>");
});

/* ----------------------------------------------------------------------
 *   The host starts no application code
 * -------------------------------------------------------------------- */

test("the host loads no application module, no bridge, and no Station UI module", () => {
  const scripts = [...codeOnly(host).matchAll(/"([^"]+\.js)"/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.ok(/^slate\//.test(script) || script === "station/station-rundown.js",
      `the host loads ${script}`);
  }
  // The bridges are loaded by index.html, once, before app.js. Loading one
  // again here would create a second, orphaned instance.
  assert.doesNotMatch(codeOnly(host), /station-state-bridge|station-command-bridge|station-connection-bridge|station-recipes-bridge|station-admin-bridge|station-weight-profiles-bridge/);
  assert.doesNotMatch(codeOnly(host), /app\.js|cloud-sync|supabase/);
});

test("the host never connects a producer or publishes; it only loads", () => {
  const code = codeOnly(host);
  assert.doesNotMatch(code, /\.connect\(|\.publish\(|\.dispatch\(|\.subscribe\(/);
  assert.doesNotMatch(code, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
});
