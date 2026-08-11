"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

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
  const listenerStart = app.indexOf('$("mobileTimelineAlarmToggle")?.addEventListener');
  const listener = app.slice(listenerStart,app.indexOf('$("prodResinLb")',listenerStart));
  assert.match(listener,/Notification\.requestPermission\(\)/);
  assert.match(listener,/navigator\.serviceWorker\.register\("service-worker\.js"\)/);
});
