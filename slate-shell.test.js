"use strict";

/* slate-shell.js and slate-logo.js: the frame every host draws Slate
 * into, and the mark at its corner. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument } = require("./tools/slate-test/fake-dom.js");
const shell = require("./slate/slate-shell.js");
const logo = require("./slate/slate-logo.js");

test("the shell is one detached slate-root carrying every mount exactly once, and no <main>", () => {
  const doc = makeDocument({ href: "https://resin.tools/?view=slate" });
  const root = shell.createShell(doc);
  assert.equal(root.tagName, "DIV");
  assert.ok(root.classList.contains("slate-root"));
  assert.equal(root.getAttribute("data-slate-app"), "");
  assert.equal(root.parentNode, null);
  for (const name of shell.MOUNTS) {
    assert.equal(root.querySelectorAll(`[data-slate-mount='${name}']`).length, 1, `mount ${name}`);
  }
  assert.equal(root.querySelectorAll("main").length, 0);
  assert.deepEqual([...shell.MOUNTS], ["rail", "header", "notice", "sync", "stats", "centre", "aside", "bar"]);
  // Landmarks: nav, header, two sections, an aside - each labelled.
  assert.equal(root.querySelector("[data-slate-mount='rail']").tagName, "NAV");
  assert.equal(root.querySelector("[data-slate-mount='header']").tagName, "HEADER");
  assert.equal(root.querySelector("[data-slate-mount='centre']").tagName, "SECTION");
  assert.equal(root.querySelector("[data-slate-mount='aside']").tagName, "ASIDE");
  assert.equal(root.querySelector("[data-slate-mount='centre']").getAttribute("aria-label"), "Workspace");
  // The notice starts hidden and is a live region.
  const notice = root.querySelector("[data-slate-mount='notice']");
  assert.ok(notice.hasAttribute("hidden"));
  assert.equal(notice.getAttribute("role"), "status");
  // Kept for compatibility, but CSS never reveals it in place of Slate.
  assert.equal(root.querySelector(".slate-too-small").textContent, shell.TOO_SMALL);
});

test("the shell keeps one 1440px composition and never hides behind a width gate", () => {
  const css = fs.readFileSync(path.join(__dirname, "slate/styles/shell.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "slate/styles/tokens.css"), "utf8");
  assert.match(tokens, /--slate-frame-width: 1440px;/);
  assert.match(css, /width: var\(--slate-frame-width\);\s*\n\s*min-width: var\(--slate-frame-width\);/);
  assert.doesNotMatch(css, /@media \(max-width:/);
  assert.doesNotMatch(css, /\.slate-shell\s*\{[^}]*display:\s*none/s);
});

test("Slate stands on its own: no way back to the floor UI in its frame", () => {
  const root = shell.createShell(makeDocument({ href: "https://resin.tools/?view=slate" }));
  assert.equal(root.querySelector(".slate-header__legacy"), null, "the header still links to the floor UI");
  assert.equal(root.querySelectorAll("a").length, 0, "the frame carries a link");
  for (const gone of ["legacyHref", "HARNESS_LEGACY"]) assert.ok(!(gone in shell), `${gone} is still exported`);
  const css = fs.readFileSync(path.join(__dirname, "slate/styles/components/header.css"), "utf8");
  assert.doesNotMatch(css, /header__legacy/);
});

/* ----------------------------------------------------------------------
 *   The mark
 * -------------------------------------------------------------------- */

test("the logo's path data is the application's own symbol, verbatim", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const start = html.indexOf('<symbol id="rtConfluenceMark"');
  const symbol = html.slice(start, html.indexOf("</symbol>", start));
  const channel = html.slice(html.indexOf('<g id="rtConfluenceChannel">'), html.indexOf("</g>", html.indexOf('<g id="rtConfluenceChannel">')));
  const inIndex = new Set([...(symbol + channel).matchAll(/\sd="([^"]+)"/g)].map(match => match[1]));
  const ours = [];
  (function collect(value) {
    if (typeof value === "string") ours.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  })(logo.PATHS);
  for (const d of ours) assert.ok(inIndex.has(d), `logo path not in index.html's symbol: ${d.slice(0, 40)}`);
  assert.equal(symbol.match(/viewBox="([^"]+)"/)[1], logo.VIEW_BOX);
});

test("the mark draws in tokens and currentColor only, and turns on its own keyframes", () => {
  const doc = makeDocument();
  const svg = logo.create(doc);
  assert.equal(svg.tagName, "SVG");
  assert.equal(svg.namespaceURI, logo.SVG_NS);
  assert.equal(svg.getAttribute("role"), "img");
  // The symbol's box grown at its foot for Slate's word: SLATE, spread and centred.
  assert.equal(svg.getAttribute("viewBox"), logo.VIEW_BOX_WITH_WORD);
  assert.equal(logo.VIEW_BOX_WITH_WORD.split(" ").slice(0, 3).join(" "), logo.VIEW_BOX.split(" ").slice(0, 3).join(" "), "the word's box does not keep the symbol's width");
  const word = svg.querySelector(".slate-logo__word");
  assert.ok(word, "no word under the mark");
  assert.equal(word.textContent, "SLATE");
  assert.equal(word.getAttribute("text-anchor"), "middle");
  assert.equal(word.getAttribute("lengthAdjust"), "spacing");
  assert.ok(Number(word.getAttribute("y")) < Number(logo.VIEW_BOX_WITH_WORD.split(" ")[3]), "the word falls outside the box");
  assert.equal(word.hasAttribute("fill"), false, "the word's colour belongs to the sheet");
  const nodes = svg.querySelectorAll("path, circle, g");
  assert.ok(nodes.length > 20);
  for (const node of nodes) {
    for (const attr of ["fill", "stroke"]) {
      const value = node.getAttribute(attr);
      if (value === null) continue;
      assert.ok(value === "none" || value === "currentColor" || /^var\(--slate-/.test(value), `${attr}="${value}"`);
    }
    assert.ok(!node.hasAttribute("class") || !/rtConfluence/.test(node.getAttribute("class")), "legacy animation class");
  }
  // The rotor carries the five channels and a glint per channel, each glint
  // and each output stroke offset by its own delay; the keyframes are
  // Slate's, in rail.css, each with a reduced-motion switch.
  const rotor = svg.querySelector(".slate-logo__rotor");
  assert.ok(rotor, "no rotor");
  assert.equal(rotor.querySelectorAll(".slate-logo__stream").length, 5);
  const glints = rotor.querySelectorAll(".slate-logo__glint");
  assert.equal(glints.length, 5);
  assert.deepEqual(glints.map(node => node.style.getPropertyValue("--slate-flow-delay")), ["0.0s", "-1.2s", "-2.4s", "-3.6s", "-4.8s"]);
  assert.deepEqual(svg.querySelectorAll(".slate-logo__output").map(node => node.style.getPropertyValue("--slate-flow-delay")), ["0.0s", "-1.2s", "-2.4s", "-3.6s", "-4.8s"]);
  const railCss = fs.readFileSync(path.join(__dirname, "slate/styles/components/rail.css"), "utf8");
  for (const name of ["slate-logo-revolve", "slate-logo-travel", "slate-logo-output"]) assert.match(railCss, new RegExp(`@keyframes ${name}`));
  assert.match(railCss, /prefers-reduced-motion: reduce\)[\s\S]*\.slate-logo__rotor/);
  const streams = svg.querySelectorAll(".slate-logo__stream");
  assert.equal(streams.length, 5);
  assert.deepEqual(streams.map(node => node.style.color), [...logo.STREAMS]);
  for (const token of logo.STREAMS) assert.match(token, /^var\(--slate-(accent|layer-[a-z]+)\)$/);
});
