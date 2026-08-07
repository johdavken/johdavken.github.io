"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");

function helpTopicsSection(){
  const start = html.indexOf('<div class="helpTopics">');
  assert.notEqual(start, -1, "expected the Help section's topic list");
  const end = html.indexOf('</div>\n    </div>\n  </details>', start);
  assert.notEqual(end, -1, "expected the closing of the Help section");
  return html.slice(start, end);
}

test("Changelog is a real helpTopic, using the same <details>/<summary> structure as every other Help entry", () => {
  const section = helpTopicsSection();
  const start = section.indexOf('<details class="helpTopic" id="helpChangelog">');
  assert.notEqual(start, -1, "expected a helpChangelog topic using the standard helpTopic class");
  const end = section.indexOf("</details>", start);
  const body = section.slice(start, end);
  assert.match(body, /<summary><span>Changelog<\/span><small>[^<]+<\/small><\/summary>/);
  assert.match(body, /<div class="helpTopicBody">/);
});

test("Changelog is the last topic in the list - sits at the bottom of the Help section, after Scan Recipe", () => {
  const section = helpTopicsSection();
  const scanRecipeIndex = section.indexOf('id="helpRecipeScan"');
  const changelogIndex = section.indexOf('id="helpChangelog"');
  assert.ok(scanRecipeIndex > -1 && changelogIndex > scanRecipeIndex, "Changelog must come after Scan Recipe, not before it");
  // Nothing else should follow it inside the topics list.
  const changelogEnd = section.indexOf("</details>", changelogIndex);
  const afterChangelog = section.slice(changelogEnd);
  assert.equal((afterChangelog.match(/class="helpTopic"/g) || []).length, 0, "Changelog must be the final helpTopic - nothing else should follow it");
});

test("the changelog is organized into dated periods with h3 headings, newest first, matching the app's actual commit history dates", () => {
  const section = helpTopicsSection();
  const start = section.indexOf('id="helpChangelog"');
  const end = section.indexOf("</details>", start);
  const body = section.slice(start, end);
  const headings = [...body.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
  assert.ok(headings.length >= 6, `expected at least 6 dated periods, found ${headings.length}`);
  assert.match(headings[0], /August 7, 2026/, "most recent period must be first");
  assert.match(headings[headings.length - 1], /December 2025 to January 2026/, "oldest period must be last");
});

test("references the app's actual major milestones - RT Sync, Scan Recipe, and the resin catalog - not placeholder text", () => {
  const section = helpTopicsSection();
  const start = section.indexOf('id="helpChangelog"');
  const end = section.indexOf("</details>", start);
  const body = section.slice(start, end);
  assert.match(body, /Scan Recipe/);
  assert.match(body, /RT Sync/);
  assert.match(body, /resin catalog/);
  assert.match(body, /Workspace Recovery/);
});
