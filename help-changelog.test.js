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

const MONTHS = ["january","february","march","april","may","june","july",
  "august","september","october","november","december"];

/**
 * A sortable key for a period heading. Takes the first month named and the
 * first year after it, so a range ("August 21-22, 2026", "December 2025 to
 * January 2026") is keyed by where it starts. A heading with no day
 * ("late July 2026") keys to day 0, which still orders correctly against
 * other months.
 */
function periodKey(heading){
  const named = heading.match(new RegExp(`(${MONTHS.join("|")})`, "i"));
  assert.ok(named, `changelog heading names no month: "${heading}"`);
  const month = MONTHS.indexOf(named[1].toLowerCase()) + 1;

  // The year is the first four-digit number anywhere in the heading, so a
  // span reading "December 2025 to January 2026" keys to where it starts.
  const year = heading.match(/\d{4}/);
  assert.ok(year, `changelog heading names no year: "${heading}"`);

  // The day is the first one- or two-digit number directly after the month,
  // if there is one. The lookahead is what keeps "late July 2026" from
  // reading its year as day 20, and lets a range like "August 21-22" key to
  // the 21st.
  const after = heading.slice(named.index + named[1].length);
  const day = after.match(/^\s*(\d{1,2})(?!\d)/);

  return Number(year[0]) * 10000 + month * 100 + (day ? Number(day[1]) : 0);
}

// Deliberately an ordering invariant rather than a pin on today's newest
// heading. A pinned date fails when a new entry is correctly added and passes
// when one is forgotten, which is backwards for a guard.
test("the changelog is organized into dated periods with h3 headings, newest first", () => {
  const section = helpTopicsSection();
  const start = section.indexOf('id="helpChangelog"');
  const end = section.indexOf("</details>", start);
  const body = section.slice(start, end);
  const headings = [...body.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
  assert.ok(headings.length >= 6, `expected at least 6 dated periods, found ${headings.length}`);

  const keys = headings.map(periodKey);
  keys.forEach((key, index) => {
    if (index === 0) return;
    assert.ok(key <= keys[index - 1],
      `"${headings[index]}" is newer than "${headings[index - 1]}" above it - periods must run newest first`);
  });

  // The app's first period is a fixed historical fact, so this one is safe to
  // pin: nothing can ever legitimately sort below it.
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

test("the August 11 entry documents the Line 9, bulk density, and Smart Hopper refinements", () => {
  const section = helpTopicsSection();
  const start = section.indexOf('id="helpChangelog"');
  const end = section.indexOf("</details>", start);
  const body = section.slice(start, end);
  // Scoped to its own period rather than "everything above the next one
  // down", so newer entries landing on top cannot satisfy it by accident.
  const entry = body.slice(
    body.indexOf("<h3>Smart Hopper, RT Sync &amp; admin refinements - August 11, 2026</h3>"),
    body.indexOf("<h3>Mobile workspace redesign")
  );
  assert.ok(entry, "expected the August 11, 2026 period");
  assert.match(entry, /Line 9/);
  assert.match(entry, /Bulk Density Measurement/);
  assert.match(entry, /Smart Hopper/);
  assert.match(entry, /Account\/Admin/);
});

test("each period after the first release documents something, rather than sitting empty under its heading", () => {
  const section = helpTopicsSection();
  const start = section.indexOf('id="helpChangelog"');
  const end = section.indexOf("</details>", start);
  const body = section.slice(start, end);
  const periods = body.split(/<h3>[^<]+<\/h3>/).slice(1);
  periods.forEach((period, index) => {
    const items = (period.match(/<li>/g) || []).length;
    assert.ok(items >= 1, `changelog period ${index} has no entries`);
  });
});
