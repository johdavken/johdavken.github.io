"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

function estimate({lineSpeed, footagePerRoll, numberUp, bothWinders, hours, minutes, rollsLeft}){
  const rollsPerSet = numberUp * (bothWinders ? 2 : 1);
  const futureSets = Math.ceil(Math.max(0, rollsLeft - rollsPerSet) / rollsPerSet);
  return {rollsPerSet, futureSets, remainingMinutes: hours * 60 + minutes + futureSets * footagePerRoll / lineSpeed};
}

test("wizard is exposed only by the calculator affordance beside Changeover time", () => {
  assert.match(html, /<label for="changeoverTime">Changeover time<\/label>\s*<button[^>]+id="changeoverWizardTrigger"/);
  assert.doesNotMatch(html, /changeoverLabelRow/);
  assert.match(css, /\.changeoverWizardTrigger\{display:none\}/);
  assert.match(css, /body\[data-shell="touch"\] \.changeoverWizardTrigger\{display:grid\}/);
  assert.doesNotMatch(css, /@media [^{]*pointer:coarse[^}]*\{[\s\S]*?\.changeoverWizardTrigger\{display:grid\}/);
  assert.match(css, /\.mobileProductionControls \.changeoverWizardTrigger\{position:absolute;right:calc\(50% \+ 54px\);top:-16px;z-index:3;display:grid;width:44px;height:44px/);
  assert.doesNotMatch(css, /changeoverLabelRow/);
  assert.equal((html.match(/id="changeoverWizardTrigger"/g) || []).length, 1);
  assert.match(html, /id="desktopChangeoverWizardTrigger"[^>]+data-changeover-wizard-trigger/);
  assert.match(app, /document\.querySelectorAll\("\[data-changeover-wizard-trigger\]"\)/);
});

test("desktop status bar orders wizard, changeover, then output", () => {
  const bar = html.slice(html.indexOf('<div class="workspaceStatusBar"'), html.indexOf('<div class="workspaceStatusItem">\n      <span>Tracked</span>'));
  const ordered = ["desktopChangeoverWizardTrigger", "workspaceChangeoverStatus", "workspaceOutputStatus"].map(id=>bar.indexOf(id));
  assert.ok(ordered.every(index=>index >= 0));
  assert.deepEqual(ordered, [...ordered].sort((a,b)=>a-b));
  assert.match(css, /\.desktopChangeoverWizardTrigger\{display:none\}/);
});

test("wizard uses one dialog, six ordered questions, numeric keypads and native time selects", () => {
  assert.match(html, /<dialog id="changeoverWizardDialog"/);
  ["What’s the line speed?", "What’s the footage per roll?", "How many up?", "Using both winders?", "How long is left on the current set?", "How many rolls are left on the order?"].forEach(question=>assert.match(app, new RegExp(question.replace(/[?]/g,"\\?"))));
  assert.match(app, /inputmode="numeric"/);
  assert.match(app, /<select name="hours">/);
  assert.match(app, /<select name="minutes">/);
  assert.match(app, /Array\.from\(\{length:10\}/);
  assert.match(app, /options\(25,/);
  assert.match(app, /options\(60,/);
});

test("wizard buttons reuse the app's segmented actions and selected tile language", () => {
  assert.match(css, /\.changeoverWizardActions\{[^}]*border:1px solid var\(--btn-secondary-border\)[^}]*border-radius:var\(--control-radius\)[^}]*background:var\(--btn-secondary-bg\)/);
  assert.match(css, /\.changeoverWizardActions button\.primary\{background:linear-gradient\(180deg,var\(--btn-primary-a\),var\(--btn-primary-b\)\)/);
  assert.match(css, /\.changeoverWizardChoices button\{[^}]*border:1px solid var\(--row-border-2\)[^}]*background:var\(--row-bg-2\)/);
  assert.match(css, /\.changeoverWizardChoices button\.selected\{[^}]*box-shadow:inset 0 -2px 0 var\(--focus-border\)/);
});

test("calculation counts partial final sets and supports one/two winders, multi-hour sets, and hundreds of rolls", () => {
  assert.deepEqual(estimate({lineSpeed:100,footagePerRoll:1000,numberUp:4,bothWinders:false,hours:2,minutes:15,rollsLeft:18}), {rollsPerSet:4,futureSets:4,remainingMinutes:175});
  assert.deepEqual(estimate({lineSpeed:100,footagePerRoll:1000,numberUp:4,bothWinders:true,hours:0,minutes:30,rollsLeft:401}), {rollsPerSet:8,futureSets:50,remainingMinutes:530});
  for (let numberUp=1; numberUp<=10; numberUp++) assert.equal(estimate({lineSpeed:1,footagePerRoll:1,numberUp,bothWinders:false,hours:0,minutes:0,rollsLeft:numberUp}).futureSets,0);
});

test("answers persist locally and accepting dispatches the existing changeover input path", () => {
  assert.match(app, /LS_CHANGEOVER_WIZARD_KEY/);
  assert.match(app, /localStorage\.setItem\(LS_CHANGEOVER_WIZARD_KEY/);
  assert.match(app, /input\.dispatchEvent\(new Event\("input",\{bubbles:true\}\)\)/);
  assert.match(app, /if \(dialog\)\{ dialog\.close\(\); return true; \}/);
});
