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
  assert.deepEqual([...shell.MOUNTS], ["rail", "header", "notice", "sync", "stats", "centre", "aside"]);
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
  // The too-small notice is present for the breakpoint to reveal.
  assert.equal(root.querySelector(".slate-too-small").textContent, shell.TOO_SMALL);
});

test("the way back is the same URL without the flag, and the harness's is the application beside it", () => {
  assert.equal(shell.legacyHref("https://resin.tools/?view=slate"), "/");
  assert.equal(shell.legacyHref("https://resin.tools/index.html?view=slate&other=1#x"), "/index.html?other=1#x");
  assert.equal(shell.legacyHref("https://resin.tools/slate/slate.html"), "../index.html");
  assert.equal(shell.legacyHref("https://resin.tools/?view=station"), "../index.html");
  assert.equal(shell.legacyHref(undefined), "../index.html");
  const doc = makeDocument({ href: "https://resin.tools/?view=slate" });
  assert.equal(shell.createShell(doc).querySelector(".slate-header__legacy").getAttribute("href"), "/");
  assert.equal(shell.createShell(doc, { legacy: "x.html" }).querySelector(".slate-header__legacy").getAttribute("href"), "x.html");
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

test("the mark draws in tokens and currentColor only, and does not turn", () => {
  const doc = makeDocument();
  const svg = logo.create(doc);
  assert.equal(svg.tagName, "SVG");
  assert.equal(svg.namespaceURI, logo.SVG_NS);
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("viewBox"), logo.VIEW_BOX);
  const nodes = svg.querySelectorAll("path, circle, g");
  assert.ok(nodes.length > 20);
  for (const node of nodes) {
    for (const attr of ["fill", "stroke"]) {
      const value = node.getAttribute(attr);
      if (value === null) continue;
      assert.ok(value === "none" || value === "currentColor" || /^var\(--slate-/.test(value), `${attr}="${value}"`);
    }
    assert.ok(!node.hasAttribute("class") || !/rotor|rtConfluence/.test(node.getAttribute("class")), "legacy animation class");
  }
  const streams = svg.querySelectorAll(".slate-logo__stream");
  assert.equal(streams.length, 5);
  assert.deepEqual(streams.map(node => node.style.color), [...logo.STREAMS]);
  for (const token of logo.STREAMS) assert.match(token, /^var\(--slate-(accent|layer-[a-z]+)\)$/);
});
