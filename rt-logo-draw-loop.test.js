"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const html = fs.readFileSync("index.html", "utf8");
const styles = readStyles();

test("Confluence is the live mobile and desktop Resin.Tools mark", () => {
  assert.equal((html.match(/href="#rtConfluenceMark"/g) || []).length, 2);
  assert.match(html, /class="resinToolsLogo rtConfluence"[^>]+viewBox="0 0 196 104"/);
  assert.match(html, /class="resinToolsSidebarIcon rtConfluence"[^>]+viewBox="0 0 196 104"/);
  assert.equal((html.match(/aria-label="Resin\.Tools Confluence logo"/g) || []).length, 2);
});

test("the symbol contains five swept resin channels and a layered die core", () => {
  assert.match(html, /id="rtConfluenceChannel"/);
  for (let stream = 1; stream <= 5; stream += 1) {
    assert.match(html, new RegExp(`class="rtStream${stream}"`));
  }
  assert.match(html, /M0-15 14\.3-4\.6 8\.8 12\.1H-8\.8L-14\.3-4\.6Z/);
  assert.match(html, /m-7-3 7-3\.3L7-3 0 \.3Z/);
});

test("the logo is font-independent and keeps the RT lettering as paths", () => {
  const symbolStart = html.indexOf('<symbol id="rtConfluenceMark"');
  const symbol = html.slice(symbolStart, html.indexOf("</symbol>", symbolStart));
  assert.doesNotMatch(symbol, /<text\b/);
  assert.match(symbol, /M99 28h23c14 0 22 7 22 19/);
  assert.match(symbol, /M146 28h43v11h-16v44/);
});

test("all five material streams follow the active semantic theme colors", () => {
  const tokens = ["--bad", "--orange", "--warn", "--ok", "--focus-border"];
  tokens.forEach((token, index) => {
    const stream = index + 1;
    assert.match(html, new RegExp(`class="rtStream${stream}"[^>]+var\\(--rt-stream-${stream},var\\(${token}\\)\\)`));
  });
  assert.match(styles, /\.rtLogoSprite\{position:absolute;width:0;height:0;overflow:hidden;color:var\(--text\)\}/);
});

test("continuous flow rotates the channels, traces their highlights, and pulses each output", () => {
  assert.match(html, /class="rtConfluenceRotor"/);
  assert.equal((html.match(/class="rtConfluenceHighlight"/g) || []).length, 5);
  assert.equal((html.match(/rtConfluenceOutput/g) || []).length, 5);
  assert.match(styles, /\.rtConfluenceRotor\{animation:rtConfluenceRevolve 30s linear infinite/);
  assert.match(styles, /animation:rtConfluenceTravel 6s linear var\(--rt-flow-delay,0s\) infinite/);
  assert.match(styles, /\.rtConfluenceOutput\{animation:rtConfluenceOutput 6s ease-in-out var\(--rt-flow-delay,0s\) infinite\}/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /\.rtConfluenceRotor,\.rtConfluenceHighlight,\.rtConfluenceOutput\{animation:none\}/);
  assert.doesNotMatch(html, /class="rtLayer(?:Red|Orange|Yellow|Green|Blue)"/);
});
