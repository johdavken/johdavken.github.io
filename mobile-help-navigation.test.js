"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("mobile Help has no separate tile landing page - the tile grid and its markup are gone", () => {
  assert.doesNotMatch(html, /mobileHelpHome/);
  assert.doesNotMatch(html, /mobileHelpTile/);
  assert.doesNotMatch(html, /data-mobile-help-target/);
});

test("mobile Help has no separate full-screen article panel/back button - it's the same accordion list as desktop", () => {
  assert.doesNotMatch(html, /mobileHelpHeader/);
  assert.doesNotMatch(html, /mobileHelpBack/);
  assert.doesNotMatch(html, /mobileHelpHeaderLabel/);
  assert.doesNotMatch(styles, /mobileHelpHome|mobileHelpTile|mobileHelpHeader|mobileHelpBack|mobile-help-active|data-mobile-help/);
  assert.doesNotMatch(app, /mobileHelpHome|mobileHelpTile|mobileHelpHeader|mobileHelpBack|mobile-help-active|dataset\.mobileHelp/);
});

test("Help's topic hierarchy (#helpBlock .helpTopics > .helpTopic) is not gated behind any mobile-only display:none - it renders identically at every width", () => {
  assert.doesNotMatch(styles, /#helpBlock \.helpTopics\{ display:none; \}/);
  const topicsRule = styles.slice(styles.indexOf(".helpTopics{"), styles.indexOf("}", styles.indexOf(".helpTopics{")) + 1);
  assert.doesNotMatch(topicsRule, /display:\s*none/);
});

test("in-body help links (e.g. Quick Start's step list) just open their target topic - same behavior on every viewport, no separate mobile tile/label bookkeeping", () => {
  const linkHandlerStart = app.indexOf('#helpBlock .helpTopicBody a.helpTopicLink');
  assert.ok(linkHandlerStart > -1, "expected a click handler wiring up in-body help links");
  const linkHandlerBody = app.slice(linkHandlerStart, app.indexOf("});", app.indexOf("});", linkHandlerStart) + 3));
  assert.match(linkHandlerBody, /topic\.open = true;/);
  assert.doesNotMatch(linkHandlerBody, /dataset\.mobileHelp/);
  assert.doesNotMatch(linkHandlerBody, /mobileHelpReturnTile/);
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

test("the one-open-topic-at-a-time accordion applies unconditionally - not scoped to a desktop-only branch that mobile skips", () => {
  const start = app.indexOf('const helpTopics = [...document.querySelectorAll("#helpBlock .helpTopics > .helpTopic")];');
  assert.ok(start > -1);
  const body = app.slice(start, app.indexOf("toolTabs.forEach", start));
  assert.match(body, /topic\.addEventListener\("toggle",\(\)=>\{/);
  assert.match(body, /helpTopics\.forEach\(other=>\{ if \(other !== topic\) other\.open = false; \}\);/);
});

test("Android Back has no Help-specific branch any more - Help has no nested home/panel state, so Back from an open topic goes straight to Main like every other section", () => {
  assert.doesNotMatch(app, /activeWorkspaceId === "helpBlock"/);
  assert.doesNotMatch(app, /dataset\.mobileHelp/);
});
