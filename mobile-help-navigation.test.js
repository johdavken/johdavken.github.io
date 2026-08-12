"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("Help selection retains its topics with the refreshed Quick Start and Tools wording", () => {
  const start = html.indexOf('<div class="mobileHelpHome"');
  const home = html.slice(start, html.indexOf("</div>", start) + 6);
  for (const target of ["helpQuickStart", "helpSetup", "helpHopperPercentages", "helpTimeline", "helpCloudSync", "helpTools", "helpRecipeScan", "helpChangelog"]){
    assert.match(home, new RegExp(`data-mobile-help-target="${target}"`));
  }
  assert.match(home, /<span>Quick Start<\/span>/);
  assert.match(home, /Calculators and reference/);
});

test("mobile Help articles use the same accessible parent/child navigation pattern as Tools", () => {
  const headerStart = html.indexOf('<div class="mobileHelpHeader">');
  const header = html.slice(headerStart, html.indexOf("</div>", headerStart) + 6);
  assert.match(header, /id="mobileHelpBack"[^>]*aria-label="Back to Help"/);
  assert.match(header, /<span>Help<\/span>/);
  assert.match(header, /<h1 id="mobileHelpHeaderLabel">Quick Start<\/h1>/);
  assert.match(styles, /body\[data-mobile-help="panel"\] #helpBlock > summary\{ display:none; \}/);
  assert.match(styles, /mobile-help-active > summary\{ display:none; \}/);
  assert.match(styles, /min-width:44px;/);
});

test("selecting an article updates its semantic heading and Back to Help restores focus to the topic tile", () => {
  const selectStart = app.indexOf('document.querySelectorAll(".mobileHelpTile")');
  const selectBody = app.slice(selectStart, app.indexOf('$("mobileHelpBack")?.addEventListener', selectStart));
  assert.match(selectBody, /mobileHelpHeaderLabel\.textContent = tile\.querySelector\("span"\)\?\.textContent/);
  assert.match(selectBody, /mobileHelpReturnTile = tile/);
  const backStart = app.indexOf('$("mobileHelpBack")?.addEventListener');
  const backBody = app.slice(backStart, app.indexOf('toolTabs\.forEach', backStart));
  assert.match(backBody, /document\.body\.dataset\.mobileHelp = "home"/);
  assert.match(backBody, /mobileHelpReturnTile\?\.focus\(\)/);
});

test("Quick Start links to the relevant section for every step, and each target actually exists", () => {
  const start = html.indexOf('id="helpQuickStart"');
  const quickStart = html.slice(start, html.indexOf("</details>", start));
  const links = [...quickStart.matchAll(/<a class="helpTopicLink" href="#(help\w+)">/g)].map(m => m[1]);
  assert.deepEqual(links, ["helpCloudSync", "helpSetup", "helpHopperPercentages", "helpHopperPercentages", "helpTimeline", "helpTools"]);
  for (const id of new Set(links)){
    assert.match(html, new RegExp(`id="${id}"`), `#${id} should exist as a help topic`);
  }
});

test("in-body help links open their target topic on mobile the same way a tile does", () => {
  const linkHandlerStart = app.indexOf('#helpBlock .helpTopicBody a.helpTopicLink');
  assert.ok(linkHandlerStart > -1, "expected a click handler wiring up in-body help links");
  const linkHandlerBody = app.slice(linkHandlerStart, app.indexOf('$("mobileHelpBack")?.addEventListener', linkHandlerStart));
  assert.match(linkHandlerBody, /topic\.open = true/);
  assert.match(linkHandlerBody, /document\.body\.dataset\.mobileHelp = "panel"/);
  assert.match(linkHandlerBody, /mobileHelpReturnTile = matchingTile/);
});
