(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResinIQScheduling = api;
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

  function calendarDayOffset(date, baseDate) {
    const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const baseDay = Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    return Math.round((dateDay - baseDay) / 86400000);
  }

  function formatTime(date, baseDate) {
    if (!date) return "—";
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (!baseDate) return time;

    const dayOffset = calendarDayOffset(date, baseDate);
    if (dayOffset === 0) return time;
    const sign = dayOffset > 0 ? "+" : "";
    return `${time} (${sign}${dayOffset}d)`;
  }

  return {
    parseChangeoverDate,
    calendarDayOffset,
    formatTime
  };
});
