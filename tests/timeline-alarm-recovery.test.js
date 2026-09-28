"use strict";

// Two field-reported alarm failures, and what stops them recurring.
//
//   "There's no way to cancel the alarm sound. I had to reset my phone."
//
//     PumpOffAlarmActivity started the looping MediaPlayer in onCreate and
//     stopped it only in onDestroy, then cancelled its own launching
//     notification. Press Home and the activity is stopped but alive, so the
//     alarm keeps playing - with no notification left to tap and nothing in
//     Recents to return to, because the activity is excludeFromRecents.
//     Force-stop or reboot were the only ways out.
//
//   "It goes off even if the pump has been turned off before the due time,
//    or if tracking has been reset."
//
//     AlarmManager alarms outlive the page that scheduled them, but the
//     record of which ids were scheduled did not - it was a plain in-memory
//     Set. Close the app, have another device clear the hopper over RT Sync,
//     reopen: the fresh page believed it had scheduled nothing, so the
//     no-longer-wanted alarm was never in the cancel list and fired anyway.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const activityJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmActivity.java", "utf8");
const receiverJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmReceiver.java", "utf8");
const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const pluginJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmPlugin.java", "utf8");
const storeJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmStore.java", "utf8");
const schedulerJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffAlarmScheduler.java", "utf8");
const bootJava = fs.readFileSync("android/app/src/main/java/tools/resin/app/PumpOffBootReceiver.java", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  assert.notEqual(next, -1, `Expected a following function after ${name}`);
  return app.slice(start, next);
}

/* ----------------------------------------------------------------------
 *   The alarm can always be silenced
 * -------------------------------------------------------------------- */

test("ringing is bound to the alarm screen being visible, so an invisible alarm screen is a silent one", () => {
  // The precise inversion of the bug: start on show, stop on hide.
  assert.match(activityJava, /protected void onStart\(\) \{\s*\n\s*super\.onStart\(\);\s*\n\s*if \(!dismissed\) startAlarm\(\);/);
  assert.match(activityJava, /protected void onStop\(\) \{[\s\S]*?stopAlarm\(\);/);
  // onDestroy still stops as a backstop, but is no longer the only path.
  assert.match(activityJava, /protected void onDestroy\(\) \{\s*\n\s*stopAlarm\(\);/);
});

test("the launching notification is no longer cancelled out from under the operator", () => {
  // This single line was the trap: it removed the only remaining handle on a
  // ringing alarm the moment the screen appeared.
  const onCreate = activityJava.slice(activityJava.indexOf("protected void onCreate"), activityJava.indexOf("protected void onNewIntent"));
  assert.doesNotMatch(onCreate, /manager\.cancel\(notificationId\)/);
  // Replaced in place by one that stays put and carries a way out.
  assert.match(activityJava, /PumpOffAlarmReceiver\.showRingingNotification\(this, notificationId, title, body, soundUri, vibrateEnabled\);/);
});

test("the ringing notification cannot be swiped away and carries a Stop alarm action", () => {
  const ringing = receiverJava.slice(receiverJava.indexOf("static void showRingingNotification"));
  const body = ringing.slice(0, ringing.indexOf("\n    static void showMissedNotification"));
  assert.match(body, /\.setOngoing\(true\)/);
  assert.match(body, /\.setAutoCancel\(false\)/);
  assert.match(body, /\.addAction\(0, "Stop alarm", stopPendingIntent\(context, id\)\)/);
  // Tapping the body returns to the alarm screen rather than doing nothing.
  assert.match(body, /\.setContentIntent\(activityPendingIntent\(context, id, screenIntent\)\)/);
});

test("Stop alarm reaches the screen that owns the player, and takes the notification with it", () => {
  assert.match(receiverJava, /static final String ACTION_STOP = "tools\.resin\.app\.STOP_PUMP_OFF_ALARM";/);
  const handler = receiverJava.slice(receiverJava.indexOf('if (ACTION_STOP.equals(intent.getAction()))'));
  const body = handler.slice(0, handler.indexOf("\n        }") + 10);
  // Cancelled first, so the operator gets feedback even when no alarm screen
  // is alive to hear the rebroadcast.
  assert.match(body, /stopManager\.cancel\(id\)/);
  assert.match(body, /new Intent\(ACTION_STOP_BROADCAST\)/);
  assert.match(body, /stop\.setPackage\(context\.getPackageName\(\)\)/, "the stop broadcast must stay inside the app");
  // The activity listens for it - the receiver cannot stop a player it does
  // not own.
  assert.match(activityJava, /IntentFilter filter = new IntentFilter\(PumpOffAlarmReceiver\.ACTION_STOP_BROADCAST\);/);
  assert.match(activityJava, /registerReceiver\(stopRequestReceiver, filter, Context\.RECEIVER_NOT_EXPORTED\);/);
});

test("one hopper's Stop alarm cannot silence a different hopper's", () => {
  const receiver = activityJava.slice(activityJava.indexOf("private final BroadcastReceiver stopRequestReceiver"));
  const body = receiver.slice(0, receiver.indexOf("};") + 2);
  assert.match(body, /if \(id == notificationId \|\| id == -1\) dismissAlarm\(\);/);
});

test("the alarm silences itself rather than ringing indefinitely, and leaves a record that it was missed", () => {
  assert.match(activityJava, /static final long RING_TIMEOUT_MS = 5 \* 60 \* 1000L;/);
  assert.match(activityJava, /timeoutHandler\.postDelayed\(ringTimeout, RING_TIMEOUT_MS\);/);
  // Re-armed per ring and cleared on stop, so it can neither double-fire nor
  // outlive the alarm.
  assert.match(activityJava, /private void stopAlarm\(\) \{\s*\n\s*timeoutHandler\.removeCallbacks\(ringTimeout\);/);
  const timeout = activityJava.slice(activityJava.indexOf("private void timeOutAlarm()"));
  assert.match(timeout, /stopAlarm\(\);/);
  assert.match(timeout, /showMissedNotification/);
  // The leftover is quiet and dismissible - it informs, it does not demand.
  const missed = receiverJava.slice(receiverJava.indexOf("static void showMissedNotification"));
  assert.match(missed, /\.setOngoing\(false\)/);
  assert.match(missed, /\.setAutoCancel\(true\)/);
  assert.match(missed, /\.setSilent\(true\)/);
});

test("the screen is kept awake, so a display timeout cannot silence a live alarm", () => {
  // Now that ringing stops with visibility, losing the screen would stop the
  // alarm - setTurnScreenOn only wakes it, it does not hold it.
  const modern = activityJava.slice(activityJava.indexOf("if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1)"));
  const branch = modern.slice(0, modern.indexOf("} else {"));
  assert.match(branch, /addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
});

test("the alarm screen is still kept out of Recents - the notification is the way back now", () => {
  assert.match(manifest, /android:name="\.PumpOffAlarmActivity"[\s\S]*?android:excludeFromRecents="true"/);
});

/* ----------------------------------------------------------------------
 *   Alarms that should no longer fire, don't
 * -------------------------------------------------------------------- */

test("the scheduled-id record outlives the page, because the alarms it describes do", () => {
  assert.match(app, /const LS_SCHEDULED_ALARMS_KEY = "resinTimer\.scheduledAlarms\.v0\.01";/);
  const read = functionBody("readScheduledAlarmIds");
  assert.match(read, /localStorage\.getItem\(LS_SCHEDULED_ALARMS_KEY\)/);
  // A corrupt or hand-edited value must degrade to "know nothing", never throw
  // on the path that also schedules alarms.
  assert.match(read, /if \(!Array\.isArray\(parsed\)\) return new Set\(\);/);
  assert.match(read, /Number\.isInteger\(id\) && id > 0/);
  assert.match(read, /catch\(_error\)\{ return new Set\(\); \}/);
});

test("a cold start can cancel what a previous run armed", () => {
  const body = functionBody("syncNativeTimelineAlarms");
  assert.match(body, /const known = new Set\(\[\.\.\.scheduledTimelineNotificationIds, \.\.\.readScheduledAlarmIds\(\)\]\);/);
  assert.match(body, /const toCancel = \[\.\.\.known\]\.filter\(id=>!desired\.has\(id\)\);/);
  assert.match(body, /writeScheduledAlarmIds\(scheduledTimelineNotificationIds\);/);
});

test("a failed sync does not claim the alarms were cancelled", () => {
  const body = functionBody("syncNativeTimelineAlarms");
  const handler = body.slice(body.indexOf("}catch(error){"));
  // Recording success here would drop those ids out of every future cancel
  // list and strand them in the OS permanently - the exact shape of the bug
  // this whole file exists for.
  assert.match(handler, /return;/);
  const afterCatch = body.slice(body.indexOf("console.error(\"Timeline alarms: failed to sync native alarms.\""));
  const returnAt = afterCatch.indexOf("return;");
  const recordAt = afterCatch.indexOf("scheduledTimelineNotificationIds = new Set(desired.keys());");
  assert.ok(returnAt > -1 && recordAt > returnAt, "the failure path must return before the record is updated");
});

test("writing the record is best-effort - losing it must never break scheduling", () => {
  const write = functionBody("writeScheduledAlarmIds");
  assert.match(write, /catch\(_error\)\{/);
  assert.doesNotMatch(write, /throw/);
});

/* ----------------------------------------------------------------------
 *   Alarms survive a restart
 * -------------------------------------------------------------------- */

// AlarmManager drops every alarm on reboot, and the details of what to re-arm
// live in the WebView's JS state - which does not run at boot and will not run
// until somebody opens the app. So a phone that restarted overnight simply had
// no pump-off alarms the next morning, and nothing could notice: silent, which
// on a production floor is worse than a false alarm.

test("the device keeps its own record of armed alarms, because JS is not running at boot", () => {
  assert.match(storeJava, /class PumpOffAlarmStore/);
  assert.match(storeJava, /getSharedPreferences\(PREFS, Context\.MODE_PRIVATE\)/);
  // A corrupt record must read as empty rather than throw on a path that also
  // has real alarms to schedule.
  assert.match(storeJava, /catch \(JSONException ignored\) \{/);
  assert.match(storeJava, /if \(raw == null\) return entries;/);
});

test("arming records and cancelling forgets, so a reboot cannot resurrect a cancelled alarm", () => {
  assert.match(schedulerJava, /static void schedule\(Context context, JSONObject entry\) \{[\s\S]*?PumpOffAlarmStore\.put\(context, entry\);/);
  assert.match(schedulerJava, /static void cancel\(Context context, int id\) \{[\s\S]*?PumpOffAlarmStore\.remove\(context, id\);/);
  // The JS bridge goes through the shared scheduler rather than talking to
  // AlarmManager itself, which is what keeps the record in step.
  assert.match(pluginJava, /PumpOffAlarmScheduler\.schedule\(getContext\(\), entry\);/);
  assert.match(pluginJava, /PumpOffAlarmScheduler\.cancel\(getContext\(\), id\);/);
  assert.doesNotMatch(pluginJava, /alarmManager\.setAlarmClock/, "the plugin must not arm alarms behind the scheduler's back");
  assert.doesNotMatch(pluginJava, /alarmManager\.cancel\(/, "nor cancel them, or the record would drift");
});

test("boot and app-update both re-arm, including the OEM quick-boot actions", () => {
  assert.match(manifest, /<uses-permission android:name="android\.permission\.RECEIVE_BOOT_COMPLETED" \/>/);
  const receiver = manifest.slice(manifest.indexOf('android:name=".PumpOffBootReceiver"'));
  const block = receiver.slice(0, receiver.indexOf("</receiver>"));
  assert.match(block, /android:exported="true"/, "the sender is the system, and these are protected broadcasts");
  ["android.intent.action.BOOT_COMPLETED",
   "android.intent.action.MY_PACKAGE_REPLACED",
   "android.intent.action.QUICKBOOT_POWERON"].forEach(action => {
    assert.ok(block.includes(action), `missing ${action}`);
  });
  // An unrelated broadcast must not trigger a re-arm sweep.
  assert.match(bootJava, /if \(!Intent\.ACTION_BOOT_COMPLETED\.equals\(action\)/);
  assert.match(bootJava, /return;/);
});

test("an alarm that came due while the device was off is dropped, not fired late", () => {
  // Re-arming a past due time would fire immediately at boot, for a changeover
  // that is already over.
  assert.match(bootJava, /PumpOffAlarmStore\.pruneDueBefore\(context, now\);/);
  const prune = storeJava.slice(storeJava.indexOf("static void pruneDueBefore"));
  assert.match(prune, /entry\.optLong\(FIELD_AT, 0L\) <= millis/);
  // Pruned before the sweep, so the dropped ones are never re-armed.
  assert.ok(bootJava.indexOf("pruneDueBefore") < bootJava.indexOf("PumpOffAlarmScheduler.rearm"),
    "the prune must run before the re-arm sweep");
});

test("a re-armed alarm is identical to the one the app would have armed, so the app can still cancel it", () => {
  // Built through the same PendingIntent factory. A differently-shaped intent
  // would not match a later cancel, leaving an alarm nothing could stop.
  assert.match(schedulerJava, /static PendingIntent alarmPendingIntent\(Context context, int id, String title, String body, String sound, boolean vibrate\)/);
  assert.match(schedulerJava, /PendingIntent\.getBroadcast\(context, id, intent, flags\)/);
  assert.match(schedulerJava, /static void rearm\(Context context, JSONObject entry\)/);
  // rearm deliberately does not re-record: the entry came out of the store.
  const rearm = schedulerJava.slice(schedulerJava.indexOf("static void rearm"));
  assert.doesNotMatch(rearm.slice(0, rearm.indexOf("private static void arm")), /PumpOffAlarmStore\.put/);
});
