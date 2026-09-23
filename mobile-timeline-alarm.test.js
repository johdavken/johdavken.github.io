"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = readStyles();

test("Timeline includes the persistent pump-off alarm preference",()=>{
  assert.match(html,/id="mobileTimelineAlarmToggle"/);
  const timeline = html.slice(html.indexOf('id="resultsBlock"'),html.indexOf('id="lineSyncBlock"'));
  assert.match(timeline,/id="mobileTimelineAlarmToggle"/);
  assert.doesNotMatch(html,/statusPreferences/);
  assert.match(app,/mobileTimelineAlarm: false/);
  assert.match(app,/mobileTimelineAlarm: !!state\.mobileTimelineAlarm/);
  assert.match(app,/applyMobileTimelineAlarm\(!!payload\.mobileTimelineAlarm\)/);
  assert.match(styles,/\.mobileTileStyleSection,\.mobileBackgroundStyleSection,\.mobileTimelineAlarmSection\{ display:none; \}/);
});

test("timeline computation reschedules sound, vibration, and notification alerts",()=>{
  assert.match(app,/schedulePumpOffAlerts\(flat, changeoverDate\)/);
  assert.match(app,/navigator\.vibrate\?\.\(\[500,200,500,200,800\]\)/);
  assert.match(app,/playPumpOffAlarm\(\)/);
  assert.match(app,/showPumpOffNotification\(item\)/);
  assert.match(app,/item\._ref\.h\.pumpOff/);
});

test("notification permission is requested only from the explicit enable interaction",()=>{
  // The browser's asks live in one helper...
  const primeStart = app.indexOf("async function primeTimelineAlarm(){");
  assert.ok(primeStart > -1);
  const prime = app.slice(primeStart,app.indexOf("\n    }\n",primeStart));
  assert.match(prime,/Notification\.requestPermission\(\)/);
  assert.match(prime,/navigator\.serviceWorker\.register\("service-worker\.js"\)/);
  assert.equal(app.split("Notification.requestPermission(").length - 1,1,"notification permission is asked somewhere else");
  // ...called from exactly two explicit enables: the floor UI's toggle and
  // a presentation layer's setTimelineAlarm, each only when turning it on.
  const calls = [...app.matchAll(/primeTimelineAlarm\(\)/g)].map(match => match.index).filter(at => at !== primeStart + "async function ".length);
  assert.equal(calls.length,2);
  const listenerStart = app.indexOf('$("mobileTimelineAlarmToggle")?.addEventListener');
  const listener = app.slice(listenerStart,app.indexOf('$("prodResinLb")',listenerStart));
  assert.match(listener,/if \(enabled\) await primeTimelineAlarm\(\);/);
  const commandStart = app.indexOf("setTimelineAlarm(args){");
  const command = app.slice(commandStart,app.indexOf("\n      },",commandStart));
  assert.match(command,/if \(args\.enabled\) primeTimelineAlarm\(\)/);
});
