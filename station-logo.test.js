"use strict";

/* The Station logo (station/station-logo.js): the hopper-and-flow mark
 * and the STATION wordmark, drawn inline in the header's heading. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const logo = require("./station/station-logo.js");
const shell = require("./station/station-shell.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function makeNode(name, ns) {
  const node = {
    nodeName: name, namespaceURI: ns || null, attributes: {}, children: [], textContent: "",
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    appendChild(child) { this.children.push(child); return child; }
  };
  return node;
}
const fakeDocument = () => ({ createElement: name => makeNode(name), createElementNS: (ns, name) => makeNode(name, ns) });
function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function all(node, predicate) { const out = []; walk(node, n => { if (predicate(n)) out.push(n); }); return out; }

test("the logo is an SVG of paths and polylines in the SVG namespace, named to a reader, with the mark, three chevrons of flow, the word's ink and the O's inset", () => {
  const svg = logo.create(fakeDocument());
  assert.equal(svg.nodeName, "svg");
  assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(svg.getAttribute("viewBox"), "0 0 380 48");
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("aria-label"), "Station");
  assert.equal(svg.getAttribute("focusable"), "false");
  assert.equal(svg.children[0].nodeName, "title");
  assert.equal(svg.children[0].textContent, "Station");
  assert.equal(all(svg, n => n.getAttribute("class") === "station-logo__hopper").length, 1);
  const flow = all(svg, n => /station-logo__flow/.test(n.getAttribute("class") || ""));
  assert.equal(flow.length, 3);
  assert.ok(flow.every(n => n.nodeName === "polyline"));
  const ink = all(svg, n => n.getAttribute("class") === "station-logo__ink")[0];
  assert.equal(ink.children.length, 7, "S T A T I O N");
  assert.equal(ink.children[2].getAttribute("fill-rule"), "evenodd", "the A's counter");
  assert.equal(all(svg, n => n.getAttribute("class") === "station-logo__signal").length, 1);
  assert.equal(all(svg, n => /^(text|image|use)$/.test(n.nodeName)).length, 0, "no type, no image, no symbol");
  // Every node is namespaced: a fake document without createElementNS
  // still gets elements, but a real one gets SVG ones.
  assert.ok(all(svg, () => true).every(n => n.namespaceURI === "http://www.w3.org/2000/svg"));
  assert.equal(logo.create(fakeDocument(), { label: "Resin.Tools Station" }).getAttribute("aria-label"), "Resin.Tools Station");
});

test("the module's paths are the reusable asset's, exactly: station/assets/station-logo.svg and the header cannot drift apart", () => {
  const asset = read("station/assets/station-logo.svg");
  assert.match(asset, /viewBox="0 0 380 48"/);
  assert.ok(asset.includes(`d="${logo.HOPPER}"`), "the mark");
  for (const points of logo.FLOW) assert.ok(asset.includes(`points="${points}"`), `flow ${points}`);
  for (const d of logo.INK) assert.ok(asset.includes(`d="${d}"`), `ink ${d.slice(0, 20)}`);
  assert.ok(asset.includes(`d="${logo.SIGNAL}"`), "the inset");
  // The same count of each, so the asset carries nothing the module lacks.
  assert.equal((asset.match(/<path /g) || []).length, 1 + logo.INK.length + 1);
  assert.equal((asset.match(/<polyline /g) || []).length, logo.FLOW.length);
  assert.doesNotMatch(asset, /c2pa|<metadata|<image|<text/, "the asset is the drawing alone");
  // The asset's own defaults read the same tokens the stylesheet does.
  for (const token of ["--station-text", "--station-accent", "--station-rundown-flow"]) assert.ok(asset.includes(token), `asset lacks ${token}`);
});

test("the shell puts the logo in the heading, and falls back to the word when no logo module is loaded", () => {
  const doc = fakeDocument();
  const root = shell.createShell(doc);
  const heading = all(root, n => n.getAttribute("class") === "station-header__title")[0];
  assert.equal(heading.nodeName, "h1");
  assert.equal(heading.children.length, 1);
  assert.equal(heading.children[0].getAttribute("class"), "station-logo");
  assert.equal(heading.textContent, "", "no word set in type beside the mark");
  // The shell's fallback: evaluated with the logo global absent.
  const source = read("station/station-shell.js");
  assert.match(source, /if \(logoModule && typeof logoModule\.create === "function"\) title\.appendChild\(logoModule\.create\(doc, \{ label: "Station" \}\)\);\s+else title\.textContent = "Station";/);
});

test("the stylesheet colours the mark from tokens only - ink, tracked flow, accent - and the breathe stops under reduced motion; the shell's sheet carries no motion query", () => {
  const css = read("station/styles/components/logo.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, "logo.css names a colour");
  assert.match(css, /\.station-logo \{[^}]*height: 18px;[^}]*color: var\(--station-text\);/);
  assert.match(css, /\.station-logo__flow \{[^}]*stroke: var\(--station-rundown-flow\);/);
  assert.match(css, /\.station-logo__signal \{[^}]*fill: var\(--station-accent\);[^}]*animation: station-logo-breathe/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.station-logo__signal \{\s*animation: none;/);
  assert.doesNotMatch(read("station/styles/shell.css"), /prefers-reduced-motion|station-logo__/);
  for (const theme of ["industrial-light", "industrial-dark", "gruvbox-light", "gruvbox-dark", "engineering-paper", "blueprint"]) {
    const sheet = read(`station/styles/themes/${theme}.css`);
    for (const token of ["--station-text:", "--station-accent:", "--station-rundown-flow:"]) assert.ok(sheet.includes(token), `${theme} lacks ${token}`);
  }
});

test("the logo is loaded by both hosts before the shell that draws it, with its stylesheet, and by nothing else", () => {
  const host = read("station-host.js");
  const html = read("station/station.html");
  const order = (text, quote) => ["station-logo.js", "station-shell.js"].map(name => text.indexOf(quote(name)));
  for (const [text, quote] of [[host, name => `"station/${name}"`], [html, name => `src="${name}?v=`]]) {
    const at = order(text, quote);
    assert.ok(at.every(index => index > -1), "a host does not load the logo");
    assert.ok(at[0] < at[1], "the logo must be evaluated before station-shell.js reads its global");
  }
  assert.match(host, /"station\/styles\/components\/logo\.css"/);
  assert.match(html, /styles\/components\/logo\.css\?v=/);
  assert.doesNotMatch(read("index.html"), /station-logo/, "index.html loads Station modules through the host only");
});
