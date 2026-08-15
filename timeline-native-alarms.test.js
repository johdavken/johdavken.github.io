"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const capacitorConfig = JSON.parse(fs.readFileSync("capacitor.config.json", "utf8"));
const pluginJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmPlugin.java", "utf8");
const receiverJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmReceiver.java", "utf8");
const activityJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmActivity.java", "utf8");

// Root cause (see the feature's own diagnosis notes): Timeline cards only ever
// recomputed startByText/isLate inside validateAndCompute, which only runs on
// a data mutation - so a card sat stale until something else (an edit, an RT
// Sync apply, a restart) happened to trigger a recompute. These tests cover
// the fix: a single centralized clock ticker that re-derives only the
// time-dependent presentation, plus the native (Android) alarm replacement
// for the page-JS-lifetime-bound setTimeout alarm, which Android silently
// suspends when backgrounded/screen-off.

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  assert.notEqual(next, -1, `Expected a following function after ${name} to bound its body`);
  return app.slice(start, next);
}

// --- Part A: the clock ticker ------------------------------------------

test("refreshTimelinePresentation re-derives status from a fresh wall-clock read, not a cached one", () => {
  const body = functionBody("refreshTimelinePresentation");
  assert.match(body, /if \(!lastTimelineFlat\) return;/, "must no-op before the first real computation has ever populated the cache");
  assert.match(body, /const now = new Date\(\);/);
  assert.match(body, /formatTimelineStart\(item\.startByDate, lastTimelineChangeoverDate, now, state\.timeFormat\)/);
});

test("refreshTimelinePresentation reuses the existing render path and touches nothing else - no persistence, no RT Sync, no re-scheduling", () => {
  const body = functionBody("refreshTimelinePresentation");
  assert.match(body, /renderResultsFlat\(refreshed, lastTimelineChangeoverDate\);/);
  assert.match(body, /updateFooterNext\(refreshed, lastTimelineChangeoverDate\);/);
  assert.doesNotMatch(body, /saveSession\(/);
  assert.doesNotMatch(body, /notifyActiveJobMutation/);
  assert.doesNotMatch(body, /schedulePumpOffAlerts/);
  assert.doesNotMatch(body, /syncNativeTimelineAlarms/);
});

test("the ticker fires every 15-30s (the task's requested cadence) and is guarded against ever starting twice", () => {
  const body = functionBody("startTimelineTicker");
  assert.match(body, /if \(timelineTickerStarted\) return;/);
  assert.match(body, /timelineTickerStarted = true;/);
  const interval = /setInterval\(refreshTimelinePresentation, (\d+)\)/.exec(body);
  assert.ok(interval, "expected a single setInterval driving refreshTimelinePresentation");
  const ms = Number(interval[1]);
  assert.ok(ms >= 15000 && ms <= 30000, `expected 15-30s cadence, got ${ms}ms`);
});

test("startTimelineTicker is called exactly once, from init - not from Timeline being opened/visited", () => {
  const calls = app.match(/startTimelineTicker\(\);/g) || [];
  assert.equal(calls.length, 1);
});

test("validateAndCompute caches flat/changeoverDate for the ticker on every real computation", () => {
  assert.match(app, /lastTimelineFlat = flat;\n\s*lastTimelineChangeoverDate = changeoverDate;/);
});

test("foreground/resume forces one immediate refresh on both native (appStateChange) and web (visibilitychange)", () => {
  assert.match(app, /window\.Capacitor\?\.Plugins\?\.App\?\.addListener\?\.\("appStateChange", \(\{ isActive \}\)=>\{/);
  const nativeStart = app.indexOf('addListener?.("appStateChange"');
  const nativeBlock = app.slice(nativeStart, app.indexOf("});", nativeStart));
  assert.match(nativeBlock, /if \(!isActive\) return;/);
  assert.match(nativeBlock, /refreshTimelinePresentation\(\);/);

  assert.match(app, /document\.addEventListener\("visibilitychange", \(\)=>\{/);
  const webStart = app.indexOf('addEventListener("visibilitychange"');
  const webBlock = app.slice(webStart, app.indexOf("});", webStart));
  assert.match(webBlock, /if \(!document\.hidden\) refreshTimelinePresentation\(\);/);
});

// --- Part B/C: native alarms ---------------------------------------------

test("native notifications are gated behind the real plugin object, using window.Capacitor - app.js has no root/UMD wrapper, so a root.Capacitor reference is an undefined-variable crash, not a native/web branch", () => {
  assert.match(app, /function nativeLocalNotifications\(\)\{ return window\.Capacitor\?\.Plugins\?\.LocalNotifications \|\| null; \}/);
  // Regression guard: this file's IIFE is `(() => { ... })()` with no root
  // parameter (unlike scheduling.js/recipe-scan-ui.js's UMD wrapper) - a
  // bare `root.` reference here throws ReferenceError, which is exactly
  // what silently broke every native alarm call (channel creation,
  // permission request, and scheduling all failed as uncaught promise
  // rejections) until this was caught via live device testing.
  assert.doesNotMatch(app, /\broot\.Capacitor\b/);
});

test("stableNotificationId is a deterministic 32-bit-safe hash of identity only, not of anything that changes on every edit", () => {
  const body = functionBody("stableNotificationId");
  // Executed directly (pure function, no external deps) rather than only
  // pattern-matched, to actually prove determinism and range - not just that
  // the code looks right.
  const fn = new Function(`${body}; return stableNotificationId;`)();

  const a1 = fn("workspace-1:A:H1");
  const a2 = fn("workspace-1:A:H1");
  assert.equal(a1, a2, "same seed must always produce the same id");
  assert.ok(Number.isInteger(a1) && a1 >= 1 && a1 <= 2147483647, "id must be a positive 32-bit int (Android notification id constraint)");

  const b = fn("workspace-1:A:H2");
  assert.notEqual(a1, b, "different hoppers should not collide for this seed set");

  // Volatile fields (changeover time, weight, resin) must never be part of
  // the seed at the call site - checked at the source level since the pure
  // function itself can't prove what its caller passes in.
  const callSite = functionBody("syncNativeTimelineAlarms");
  assert.match(callSite, /stableNotificationId\(`\$\{workspaceId\}:\$\{item\.layer\}:\$\{item\.hopperLabel\}`\)/);
});

test("syncNativeTimelineAlarms builds the desired set only from trackable, not-yet-due entries while the alarm is enabled", () => {
  const body = functionBody("syncNativeTimelineAlarms");
  assert.match(body, /if \(!PumpOffAlarm\) return;/, "no-op on web/desktop where the plugin doesn't exist");
  assert.match(body, /if \(state\.mobileTimelineAlarm && changeoverDate\)/, "nothing scheduled while the operator has the alarm off");
  assert.match(body, /if \(!item\.startByDate \|\| item\.pumpOff\) return;/, "never notify for a pumped-off or timeless entry");
  assert.match(body, /if \(due <= Date\.now\(\)\) return;/, "never (re)notify for something already due/late");
});

test("syncNativeTimelineAlarms diffs against what's currently scheduled - cancels exactly what's no longer desired, schedules the rest, then updates the tracked set", () => {
  const body = functionBody("syncNativeTimelineAlarms");
  assert.match(body, /const toCancel = \[\.\.\.scheduledTimelineNotificationIds\]\.filter\(id=>!desired\.has\(id\)\);/);
  assert.match(body, /if \(toCancel\.length\) await PumpOffAlarm\.cancel\(\{ notifications: toCancel\.map\(id=>\(\{ id \}\)\) \}\);/);
  assert.match(body, /if \(desired\.size\) await PumpOffAlarm\.schedule\(\{ notifications: \[\.\.\.desired\.values\(\)\] \}\);/);
  assert.match(body, /scheduledTimelineNotificationIds = new Set\(desired\.keys\(\)\);/);
});

test("syncNativeTimelineAlarms is reused as the single resync point for every trigger the task lists - data recompute, foreground resume, RT Sync workspace change/disconnect, and changing the alarm sound/vibrate choice", () => {
  const calls = app.match(/syncNativeTimelineAlarms\(/g) || [];
  // Definition + validateAndCompute + appStateChange resume + renderLineSync
  // + sound-change handler + vibrate-toggle handler = 6.
  assert.equal(calls.length, 6, `expected exactly 6 references (definition + 5 call sites), found ${calls.length}`);
  assert.match(app, /syncNativeTimelineAlarms\(flat, changeoverDate\);/, "wired into validateAndCompute alongside schedulePumpOffAlerts");
  assert.match(app, /if \(lastTimelineFlat\) syncNativeTimelineAlarms\(lastTimelineFlat, lastTimelineChangeoverDate\);/, "resume and RT Sync paths reuse the cached flat rather than recomputing");
});

test("a bare RT Sync disconnect (selectedWorkspaceId unchanged, only `connected` flips) still triggers a native alarm resync, not just an explicit workspace switch", () => {
  const start = app.indexOf("function renderLineSync(syncState){");
  const end = app.indexOf("\n  function resolveLineSyncConflict", start);
  const body = app.slice(start, end);
  assert.match(body, /const connectedChanged = lastLineSyncConnectedState !== null && lastLineSyncConnectedState !== connected;/);
  assert.match(body, /lastLineSyncConnectedState = connected;/);
  assert.match(body, /if \(\(workspaceChanged \|\| connectedChanged\) && lastTimelineFlat\)\{/);
});

test("notification ids are seeded by workspace, so leaving/switching workspaces never lets one workspace's alarms fire under another's identity", () => {
  const body = functionBody("syncNativeTimelineAlarms");
  assert.match(body, /const workspaceId = lineSync\?\.getState\?\.\(\)\.selectedWorkspaceId \|\| "local";/);
});

test("checkNativePumpOffAlarmLaunch picks up the alarm screen's Open Resin.Tools tap and navigates to Timeline via the existing panel navigation, not a new API", () => {
  const body = functionBody("checkNativePumpOffAlarmLaunch");
  assert.match(body, /if \(!PumpOffAlarm\) return;/);
  assert.match(body, /const \{ openTimeline \} = await PumpOffAlarm\.consumeLaunchIntent\(\);/);
  assert.match(body, /if \(openTimeline\) setWorkspacePanel\("resultsBlock", \{ reveal: true \}\);/);
  const calls = app.match(/checkNativePumpOffAlarmLaunch\(\);/g) || [];
  assert.equal(calls.length, 2, "must be checked at init and again on every foreground resume");
});

// --- permission timing (extends mobile-timeline-alarm.test.js's web-side coverage) ---

test("native notification permission is requested only from the alarm toggle's own enable branch - never at launch, never from session/payload restore", () => {
  // Matches an actual call statement (preceded by "await "), not the
  // `async function requestNativeTimelineAlarmPermission(){` declaration.
  const callSites = app.match(/await requestNativeTimelineAlarmPermission\(\);/g) || [];
  assert.equal(callSites.length, 1, `expected exactly one call site, found ${callSites.length}`);

  const listenerStart = app.indexOf('$("mobileTimelineAlarmToggle")?.addEventListener');
  const listenerEnd = app.indexOf('$("prodResinLb")', listenerStart);
  const listener = app.slice(listenerStart, listenerEnd);
  assert.match(listener, /if \(enabled\) await requestNativeTimelineAlarmPermission\(\);/);
});

test("permission denial leaves the app usable and explains the in-app alarm still works, with a path to retry", () => {
  const body = functionBody("requestNativeTimelineAlarmPermission");
  assert.match(body, /status\.textContent = "Notifications are turned off for Resin Tools, so alarms won't fire while the app is closed or the screen is off - sound and vibration still work while it's open\. Turn this off and on to ask again, or enable notifications for Resin Tools in Android Settings\."/);
});

// --- Part D: full-screen alarm-clock behavior (native PumpOffAlarm plugin) -

test("the alarm is genuinely alarm-clock-like: SCHEDULE_EXACT_ALARM (the low-friction, user-toggleable permission) is requested, but USE_EXACT_ALARM (the Play-Console-review-gated one) never is", () => {
  assert.match(manifest, /<uses-permission android:name="android\.permission\.SCHEDULE_EXACT_ALARM" \/>/);
  assert.match(manifest, /<uses-permission android:name="android\.permission\.USE_FULL_SCREEN_INTENT" \/>/);
  assert.doesNotMatch(manifest, /USE_EXACT_ALARM/);
  const body = functionBody("requestNativeTimelineAlarmPermission");
  assert.match(body, /const exactAlarm = await PumpOffAlarm\.checkExactAlarmPermission\(\);/);
  assert.match(body, /if \(!exactAlarm\.granted\) await PumpOffAlarm\.requestExactAlarmPermission\(\);/);
});

test("full-screen-intent access (revocable independently on Android 14+) is checked and, if blocked, the settings screen to fix it is actually opened - not just described in a status message", () => {
  const body = functionBody("requestNativeTimelineAlarmPermission");
  assert.match(body, /const fullScreenIntent = await PumpOffAlarm\.checkFullScreenIntentPermission\(\);/);
  assert.match(body, /if \(!fullScreenIntent\.granted\)\{/);
  const gateStart = body.indexOf("if (!fullScreenIntent.granted){");
  const gate = body.slice(gateStart, body.indexOf("return;", gateStart));
  assert.match(gate, /await PumpOffAlarm\.requestFullScreenIntentPermission\(\);/, "must actually route the operator to the settings screen, mirroring the exact-alarm gate above it - not just tell them to go find it themselves");
  assert.match(gate, /Android is blocking the full-screen alarm screen/);
});

// --- Part E: in-app alarm sound/vibrate customization ---------------------

test("the sound/vibrate controls exist in the Timeline alarm section and start hidden - they're native-only, shown only once nativePumpOffAlarm() is confirmed present", () => {
  assert.match(html, /<div class="pumpOffAlarmSoundRow" id="pumpOffAlarmSoundRow" hidden>/);
  assert.match(html, /<button id="pumpOffAlarmSoundChangeBtn" type="button" class="copyBtn">Change<\/button>/);
  assert.match(html, /<button id="pumpOffAlarmPreviewBtn" type="button" class="copyBtn">Preview<\/button>/);
  assert.match(html, /<label class="pumpOffAlarmVibrateChoice" id="pumpOffAlarmVibrateRow" for="pumpOffAlarmVibrateToggle" hidden>/);
});

test("the sound/vibrate rows' own hidden attribute isn't silently defeated by their own display:flex rule - this is exactly what requires the APK: no window.Capacitor in any browser means nativePumpOffAlarm() is always null there, so these rows must actually stay invisible", () => {
  // Found live in an earlier feature on this same page (.splitsMobilePrimaryRow):
  // an author rule's display:flex always beats the UA stylesheet's own
  // [hidden]{display:none}, regardless of selector specificity - so without
  // an explicit override here, Change/Preview/Vibrate would render in every
  // browser, not just inside the Capacitor app.
  assert.match(styles, /\.pumpOffAlarmSoundRow\[hidden\],\.pumpOffAlarmVibrateChoice\[hidden\]\{display:none!important\}/);
});

test("applyPumpOffAlarmSound stores the choice, refreshes the displayed name/toggle, and gates visibility on native availability alone", () => {
  const body = functionBody("applyPumpOffAlarmSound");
  assert.match(body, /state\.pumpOffAlarmSoundUri = uri \|\| null;/);
  assert.match(body, /state\.pumpOffAlarmSoundName = name \|\| "Default alarm sound";/);
  assert.match(body, /state\.pumpOffAlarmVibrate = vibrate !== false;/);
  assert.match(body, /const nativeAvailable = !!nativePumpOffAlarm\(\);/);
  assert.match(body, /soundRow\.hidden = !nativeAvailable;/);
  assert.match(body, /vibrateRow\.hidden = !nativeAvailable;/);
});

test("Change opens the native ringtone picker and, unless cancelled, applies the result and immediately resyncs any already-scheduled alarms", () => {
  const start = app.indexOf('$("pumpOffAlarmSoundChangeBtn")?.addEventListener("click"');
  assert.notEqual(start, -1);
  const body = app.slice(start, app.indexOf("\n    });", start));
  assert.match(body, /await PumpOffAlarm\.pickAlarmSound\(\{ uri: state\.pumpOffAlarmSoundUri \|\| null \}\);/);
  assert.match(body, /if \(result\?\.cancelled\) return;/);
  assert.match(body, /applyPumpOffAlarmSound\(result\.uri, result\.name, state\.pumpOffAlarmVibrate\);/);
  assert.match(body, /saveSession\(\);/);
  assert.match(body, /if \(lastTimelineFlat\) syncNativeTimelineAlarms\(lastTimelineFlat, lastTimelineChangeoverDate\);/);
});

test("Preview plays the currently selected sound/vibrate choice without touching any scheduled alarm or persisted state", () => {
  const start = app.indexOf('$("pumpOffAlarmPreviewBtn")?.addEventListener("click"');
  assert.notEqual(start, -1);
  const body = app.slice(start, app.indexOf("\n    });", start));
  assert.match(body, /await PumpOffAlarm\.previewAlarmSound\(\{ uri: state\.pumpOffAlarmSoundUri \|\| null, vibrate: state\.pumpOffAlarmVibrate !== false \}\);/);
  assert.doesNotMatch(body, /saveSession|syncNativeTimelineAlarms/);
});

test("the sound/vibrate choice is a local device preference, not shared job data - present in snapshotPayload, re-applied over an incoming shared payload in applySharedActiveJob, and restored via applyPayload", () => {
  assert.match(app, /pumpOffAlarmSoundUri: state\.pumpOffAlarmSoundUri \|\| null,/);
  assert.match(app, /pumpOffAlarmSoundName: state\.pumpOffAlarmSoundName \|\| "Default alarm sound",/);
  assert.match(app, /pumpOffAlarmVibrate: state\.pumpOffAlarmVibrate !== false,/);

  const sharedStart = app.indexOf("function applySharedActiveJob(payload){");
  const sharedBody = app.slice(sharedStart, app.indexOf("applyPayload({ ...payload, ...localPreferences }", sharedStart));
  assert.match(sharedBody, /pumpOffAlarmSoundUri: state\.pumpOffAlarmSoundUri,/, "must be in localPreferences so an incoming shared payload can never silently change it");
  assert.match(sharedBody, /pumpOffAlarmVibrate: state\.pumpOffAlarmVibrate,/);

  assert.match(app, /applyPumpOffAlarmSound\(payload\.pumpOffAlarmSoundUri \|\| null, payload\.pumpOffAlarmSoundName \|\| "Default alarm sound", payload\.pumpOffAlarmVibrate !== false\);/);
});

test("syncNativeTimelineAlarms threads the current sound/vibrate choice into every scheduled alarm entry", () => {
  const body = functionBody("syncNativeTimelineAlarms");
  assert.match(body, /sound: state\.pumpOffAlarmSoundUri \|\| null,/);
  assert.match(body, /vibrate: state\.pumpOffAlarmVibrate !== false/);
});

test("the native plugin reads sound/vibrate per schedule entry and threads them through the alarm PendingIntent, receiver, and alarm-screen Activity", () => {
  assert.match(pluginJava, /String sound = entry\.isNull\("sound"\) \? null : entry\.optString\("sound", null\);/);
  assert.match(pluginJava, /boolean vibrate = entry\.optBoolean\("vibrate", true\);/);
  assert.match(pluginJava, /alarmPendingIntent\(id, title, body, sound, vibrate\)/);

  assert.match(receiverJava, /static final String EXTRA_SOUND = "sound";/);
  assert.match(receiverJava, /static final String EXTRA_VIBRATE = "vibrate";/);
  assert.match(receiverJava, /if \(sound != null\) fullScreenIntent\.putExtra\(EXTRA_SOUND, sound\);/);

  assert.match(activityJava, /String sound = intent\.getStringExtra\(PumpOffAlarmReceiver\.EXTRA_SOUND\);/);
  assert.match(activityJava, /boolean vibrate = intent\.getBooleanExtra\(PumpOffAlarmReceiver\.EXTRA_VIBRATE, true\);/);
  assert.match(activityJava, /if \(soundUri != null\) \{\s*\n\s*alarmSound = Uri\.parse\(soundUri\);/);
  assert.match(activityJava, /if \(!vibrate\) return;/, "picking no vibration must skip the vibrate call entirely, not just zero out the pattern");
});

test("the ringtone picker excludes silent as an option - operators can change the sound, but can't accidentally pick no sound for an unmissable alarm", () => {
  assert.match(pluginJava, /RingtoneManager\.EXTRA_RINGTONE_SHOW_SILENT, false\);/);
});

test("picking the picker's own Default entry is stored as the real sentinel URI (not null), so it keeps following the device's system default alarm sound if that's changed later", () => {
  assert.match(pluginJava, /if \(uri\.equals\(RingtoneManager\.getDefaultUri\(RingtoneManager\.TYPE_ALARM\)\)\) return "Default alarm sound";/);
});

test("capacitor.config.json configures a real default notification icon/color, not the placeholder Capacitor ships with", () => {
  const config = capacitorConfig.plugins && capacitorConfig.plugins.LocalNotifications;
  assert.ok(config, "expected plugins.LocalNotifications in capacitor.config.json");
  assert.equal(config.smallIcon, "ic_stat_timeline");
  assert.ok(fs.existsSync("android/app/src/main/res/drawable-mdpi/ic_stat_timeline.png"));
  assert.ok(fs.existsSync("android/app/src/main/res/drawable-xxxhdpi/ic_stat_timeline.png"));
});

test("the boot receiver, wake lock, and POST_NOTIFICATIONS permissions still come from Capacitor's own plugin manifest merge at build/sync time, not from hand-editing this file - only VIBRATE/SCHEDULE_EXACT_ALARM/USE_FULL_SCREEN_INTENT were hand-added, for the new native PumpOffAlarm plugin", () => {
  assert.doesNotMatch(manifest, /RECEIVE_BOOT_COMPLETED|WAKE_LOCK|POST_NOTIFICATIONS/, "these are supplied by the plugin's own manifest at build/sync time, not hand-declared here");
  assert.match(manifest, /<uses-permission android:name="android\.permission\.VIBRATE" \/>/);
});
