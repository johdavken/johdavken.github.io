(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynScheduling = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parseChangeoverDate(hhmm, now = new Date()) {
    if (!hhmm) return null;

    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hhmm).trim());
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    const deadline = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes,
      0,
      0
    );

    // Preserve the existing one-minute grace period before rolling to tomorrow.
    if (deadline.getTime() < now.getTime() - 60 * 1000) {
      deadline.setDate(deadline.getDate() + 1);
    }
    return deadline;
  }

  // How long a changeover time can go unedited before we stop trusting it as
  // "today's deadline" and flag it as stale instead. Comfortably longer than
  // a single shift, comfortably shorter than a full day, so normal shift-start
  // edits never trip it but a forgotten field from a prior day does.
  const CHANGEOVER_STALE_MS = 20 * 60 * 60 * 1000;

  function isChangeoverStale(setAt, now = new Date()) {
    if (!setAt && setAt !== 0) return false;
    const setAtMs = setAt instanceof Date ? setAt.getTime() : Number(setAt);
    if (!Number.isFinite(setAtMs)) return false;
    return (now.getTime() - setAtMs) > CHANGEOVER_STALE_MS;
  }

  function calendarDayOffset(date, baseDate) {
    const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const baseDay = Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    return Math.round((dateDay - baseDay) / 86400000);
  }

  function formatTime(date, baseDate, timeFormat = "12") {
    if (!date) return "—";
    const time = date.toLocaleTimeString([], timeFormat === "24"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { hour: "numeric", minute: "2-digit", hour12: true });
    if (!baseDate) return time;

    const dayOffset = calendarDayOffset(date, baseDate);
    if (dayOffset === 0) return time;
    const sign = dayOffset > 0 ? "+" : "";
    return `${time} (${sign}${dayOffset}d)`;
  }

  function formatTimelineStart(date, deadline, now = new Date(), timeFormat = "12") {
    if (!date) return { text: "—", late: false };
    const time = formatTime(date, null, timeFormat);
    const late = date.getTime() < now.getTime();
    if (late){
      const daysLate = Math.max(0, calendarDayOffset(now, date));
      const lateLabel = daysLate > 0
        ? `${daysLate} day${daysLate === 1 ? "" : "s"} late`
        : "late";
      return { text: `${time} · ${lateLabel}`, late };
    }
    if (!deadline) return { text: time, late };

    const dayOffset = calendarDayOffset(date, deadline);
    if (dayOffset !== 0){
      const days = Math.abs(dayOffset);
      const relation = dayOffset < 0 ? "before" : "after";
      const relative = days === 1 ? `Day ${relation}` : `${days} days ${relation}`;
      return { text: `${time} · ${relative}`, late };
    }
    return { text: time, late };
  }

  return {
    parseChangeoverDate,
    calendarDayOffset,
    formatTime,
    formatTimelineStart,
    isChangeoverStale,
    CHANGEOVER_STALE_MS
  };
});
