"use strict";

/* work-alarm.js: this device's wake-up alarm before every shift of its
 * crew, armed through the pump-off alarm's native plugin under ids of its
 * own. Plant time is Central. */

process.env.TZ = "America/Chicago";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const alarm = require("./work-alarm.js");

function memoryStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
}

function fakePlugin(options) {
  const calls = [];
  const armed = new Map(Object.entries((options && options.armed) || {}).map(([id, at]) => [Number(id), at]));
  return {
    calls, armed,
    async schedule({ notifications }) {
      if (options && options.fail) throw new Error("AlarmManager unavailable");
      calls.push(["schedule", notifications.map(n => n.id)]);
      for (const n of notifications) armed.set(n.id, n);
    },
    async cancel({ notifications }) { calls.push(["cancel", notifications.map(n => n.id)]); for (const n of notifications) armed.delete(n.id); },
    async checkNotificationPermission() { return { granted: true }; },
    async checkExactAlarmPermission() { return { granted: !(options && options.noExact) }; },
    async checkFullScreenIntentPermission() { return { granted: true }; }
  };
}

// Saturday Sep 26 2026, 8 PM: crew A's next shift is Monday's night.
const SAT_EVENING = new Date(2026, 8, 26, 20, 0).getTime();

test("the plan: one alarm per shift, the lead before it, named for the shift", () => {
  const plan = alarm.plan({ crew: "A", leadMinutes: 120 }, SAT_EVENING, 14);
  assert.equal(plan[0].date, "2026-09-28");
  assert.equal(plan[0].kind, "night");
  assert.equal(plan[0].at.getHours(), 18);
  assert.equal(plan[0].at.getMinutes(), 0);
  assert.deepEqual(plan.slice(0, 7).map(item => item.date),
    ["2026-09-28", "2026-09-29", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-07", "2026-10-08"]);
  const n = alarm.notificationFor(plan[0], { crew: "A", leadMinutes: 120 });
  assert.equal(n.title, "Work: night shift at 8:00 PM");
  assert.equal(n.body, "Crew A. Your night shift starts in 2 hours.");
  assert.equal(n.at, new Date(2026, 8, 28, 18, 0).getTime());
  // A day shift at 8 AM with 90 minutes: 6:30 AM.
  const days = alarm.plan({ crew: "A", leadMinutes: 90 }, new Date(2026, 9, 20).getTime(), 3);
  assert.equal(days[0].kind, "day");
  assert.equal(alarm.formatClock(days[0].at), "6:30 AM");
  assert.equal(alarm.notificationFor(days[0], { crew: "A", leadMinutes: 90 }).body, "Crew A. Your day shift starts in 1 h 30 min.");
  assert.deepEqual(alarm.plan({ crew: null }, SAT_EVENING, 14), []);
});

test("settings are this device's: normalized, clamped to 15-minute steps between 15 min and 4 h, off until a crew is chosen", () => {
  assert.deepEqual(alarm.normalize(null), { enabled: false, crew: null, leadMinutes: 120, skips: [] });
  assert.deepEqual(alarm.normalize({ enabled: true, crew: "a", leadMinutes: 97, skips: ["2026-10-02", "junk", "2026-10-02"] }),
    { enabled: true, crew: "A", leadMinutes: 90, skips: ["2026-10-02"] });
  assert.equal(alarm.normalize({ enabled: true, crew: "Z" }).enabled, false);
  assert.equal(alarm.clampLead(5), 15);
  assert.equal(alarm.clampLead(1000), 240);
  assert.equal(alarm.leadChoices().length, 16);
  assert.equal(alarm.formatLead(45), "45 minutes");
  assert.equal(alarm.formatLead(60), "1 hour");
  assert.equal(alarm.formatLead(240), "4 hours");
});

test("turning it on arms four weeks of alarms, records them under its own key, and turning it off cancels exactly those", async () => {
  const storage = memoryStorage({ "resinTimer.scheduledAlarms.v0.01": "[111,222]" });
  const plugin = fakePlugin({ armed: { 111: 1, 222: 2 } });
  const device = alarm.create({ storage, plugin, now: () => SAT_EVENING });
  assert.equal(device.native, true);

  const on = await device.update({ enabled: true, crew: "A", leadMinutes: 120 });
  assert.equal(on.ok, true);
  const armed = JSON.parse(storage.getItem(alarm.ARMED_KEY));
  assert.equal(armed.length, 14, "four weeks of a 2-2-3 is 14 shifts");
  assert.equal(device.lastSync().armed, 14);
  assert.ok(plugin.armed.has(111) && plugin.armed.has(222), "the Timeline's alarms were touched");
  assert.equal(storage.getItem("resinTimer.scheduledAlarms.v0.01"), "[111,222]");

  const off = await device.update({ enabled: false });
  assert.equal(off.ok, true);
  const cancel = plugin.calls.find(call => call[0] === "cancel");
  assert.deepEqual(cancel[1].sort(), [...armed].sort());
  assert.deepEqual([...plugin.armed.keys()].sort(), [111, 222]);
  assert.deepEqual(JSON.parse(storage.getItem(alarm.ARMED_KEY)), []);
});

test("a skipped shift's alarm is cancelled and comes back when unskipped; changing the lead re-arms at the new time", async () => {
  const storage = memoryStorage();
  const plugin = fakePlugin();
  const device = alarm.create({ storage, plugin, now: () => SAT_EVENING });
  await device.update({ enabled: true, crew: "A" });
  const monday = alarm.alarmId("2026-09-28");
  assert.ok(plugin.armed.has(monday));

  await device.toggleSkip("2026-09-28");
  assert.ok(!plugin.armed.has(monday), "the skipped alarm is still armed");
  assert.equal(device.upcoming(1)[0].skipped, true);
  await device.toggleSkip("2026-09-28");
  assert.ok(plugin.armed.has(monday));

  await device.update({ leadMinutes: 60 });
  assert.equal(plugin.armed.get(monday).at, new Date(2026, 8, 28, 19, 0).getTime());
  assert.equal(plugin.armed.get(monday).body, "Crew A. Your night shift starts in 1 hour.");
});

test("in a browser nothing rings but the schedule still shows; a failed arm keeps the record and says why", async () => {
  const browser = alarm.create({ storage: memoryStorage(), plugin: null, now: () => SAT_EVENING });
  assert.equal(browser.native, false);
  const result = await browser.update({ enabled: true, crew: "B" });
  assert.equal(result.ok, true);
  assert.equal(result.sync.native, false);
  assert.equal(browser.upcoming(3).length, 3);
  assert.deepEqual(await browser.permissions(), { native: false, notifications: false, exact: false, fullScreen: false });

  const storage = memoryStorage({ [alarm.ARMED_KEY]: "[5,6]" });
  const failing = alarm.create({ storage, plugin: fakePlugin({ fail: true }), now: () => SAT_EVENING });
  const failed = await failing.update({ enabled: true, crew: "A" });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /AlarmManager/);
  assert.equal(storage.getItem(alarm.ARMED_KEY), "[5,6]");
  assert.equal((await alarm.create({ plugin: fakePlugin({ noExact: true }) }).permissions()).exact, false);
});

test("past skips are dropped on save, and a skip survives a reload of the page", async () => {
  const storage = memoryStorage({ [alarm.SETTINGS_KEY]: JSON.stringify({ enabled: true, crew: "A", leadMinutes: 120, skips: ["2026-09-01", "2026-10-02"] }) });
  const device = alarm.create({ storage, plugin: null, now: () => SAT_EVENING });
  await device.update({});
  assert.deepEqual(device.getSettings().skips, ["2026-10-02"]);
  const again = alarm.create({ storage, plugin: null, now: () => SAT_EVENING });
  assert.deepEqual(again.getSettings(), { enabled: true, crew: "A", leadMinutes: 120, skips: ["2026-10-02"] });
});

test("the work alarm never syncs: no RT Sync, workspace or Supabase reference in either module", () => {
  for (const file of ["work-alarm.js", "work-rotation.js"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /supabase|lineSync|workspace_|active_job|fetch\s*\(/i, `${file} reaches the cloud`);
  }
});
