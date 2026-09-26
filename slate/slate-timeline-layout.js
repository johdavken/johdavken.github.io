/* The vertical timeline's geometry, without a document.
 *
 * Four pure functions over station-rundown.js's projected entries:
 *
 *   windowFor      how much time the axis spans - the scale the operator
 *                  chose: a fixed 3, 6 or 12 hours, or Scaled, which fits
 *                  the axis to the changeover and stands at the chosen
 *                  hours while there is no usable one to fit
 *   verticalTicks  the wall-clock marks down the axis, labelled as densely
 *                  as the height allows
 *   groupEvents    who is overdue, who is on the axis (in groups within
 *                  five minutes of a group's earliest member), who is beyond
 *                  the horizon, who has no estimate, who is pumped off
 *   spanNeeded     the shortest axis on which every card fits without a
 *                  merge - so only hoppers within five minutes share a card
 *                  and every dot stands at its own instant; the Timeline
 *                  grows to it and scrolls when the window is shorter.
 *                  `endRoom` keeps the cards after a mark under the axis's
 *                  end, which a fitted axis wants (its end is the
 *                  changeover) and a chosen span does not: an hour chosen
 *                  is an hour shown, and a card near the end is lifted to
 *                  fit rather than stretching the axis to make room
 *   placeCards     where each card sits so that none overlap and none leave
 *                  the axis, while every dot stays at its exact instant
 *
 * Nothing here is time-aware beyond the `now` it is handed, so the tests
 * can pin every case; the DOM module (slate-timeline.js) only draws.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("../station/station-rundown.js")
    : (root && root.PolynStationRundown);
  const api = factory(rundown);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateTimelineLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : null, function (rundownModule) {
  "use strict";

  const MINUTE = rundownModule.MINUTE;
  const HOUR = rundownModule.HOUR;
  /* Slate's own scale ladder. Station's run-down row offers six or twelve
   * hours (station-rundown.js WINDOWS) and keeps them; a tall, narrow axis
   * reads a short shift well, so Slate adds three - and names the fitted
   * axis, which until now happened to the operator rather than being
   * chosen. DEFAULT_HOURS is where a fitted axis stands while there is no
   * changeover to fit, and Station's default is the same six hours. */
  const SCALED = "scaled";
  const HOURS = Object.freeze([3, 6, 12]);
  const DEFAULT_HOURS = rundownModule.DEFAULT_WINDOW;
  const DEFAULT_SCALE = SCALED;

  /* A fitted window keeps this much room under the changeover for its
   * label, and is never shorter than an hour. */
  const FIT_MARGIN = 1.1;
  const MIN_WINDOW_MS = HOUR;
  const GROUP_MS = 5 * MINUTE;

  /* Tick ladders for a tall, narrow axis: a minor mark needs eight
   * pixels, a label twenty-eight (one line of small type with air). */
  const MINOR_LADDER = [1, 5, 10, 15, 30];
  const LABEL_LADDER = [5, 10, 15, 30, 60, 120, 180];
  const MINOR_MIN_PX = 8;
  const LABEL_MIN_PX = 28;
  const LABEL_EDGE_PX = 10;

  /* ---- The window ---- */

  /** The scale as offered: 3, 6, 12 or "scaled", anything else the default. */
  function scaleFrom(value) {
    if (value === SCALED) return SCALED;
    return HOURS.includes(value) ? value : DEFAULT_SCALE;
  }

  /** The hours a fixed axis stands at, and a fitted one falls back to. */
  function hoursFrom(value) {
    return HOURS.includes(value) ? value : DEFAULT_HOURS;
  }

  /**
   * How far the axis reaches.
   *
   * `scale` is the operator's choice and is obeyed: a number of hours is
   * that many hours, whatever the changeover does. "Scaled" fits the axis
   * to a usable changeover, and while there is none - unset, stale or
   * passed - stands at `hours` (the hours last chosen), which is where a
   * fitted axis has always stood. So `fitted` says whether Scaled is
   * fitting anything at the moment, which is what the scale's control
   * reports.
   *
   * @param {object} options  { now, changeover: {at, stale} | null, scale, hours }
   * @returns {{ mode, windowMs, scale, hours, fitted, endAt }}  `hours` is
   *          the hours the axis stands at, which a fitted axis has none of
   */
  function windowFor(options) {
    const settings = options || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const changeover = settings.changeover || null;
    const scale = scaleFrom(settings.scale);
    const hours = hoursFrom(settings.hours);
    const usable = !!(changeover && Number.isFinite(changeover.at) && !changeover.stale && changeover.at > now);
    if (scale === SCALED && usable) {
      const windowMs = Math.max((changeover.at - now) * FIT_MARGIN, MIN_WINDOW_MS);
      return { mode: "fit", windowMs, scale, hours, fitted: true, endAt: now + windowMs };
    }
    const standing = scale === SCALED ? hours : scale;
    const windowMs = standing * HOUR;
    return { mode: "fixed", windowMs, scale, hours: standing, fitted: false, endAt: now + windowMs };
  }

  /* ---- The ticks ---- */

  function localMinuteOfDay(t) {
    const date = new Date(t);
    return date.getHours() * 60 + date.getMinutes();
  }

  function tickPlan(windowMs, height, minLabelGapPx) {
    const minutes = windowMs / MINUTE;
    const pxPerMinute = height > 0 ? height / minutes : 0;
    const minor = MINOR_LADDER.find(step => step * pxPerMinute >= MINOR_MIN_PX) || MINOR_LADDER[MINOR_LADDER.length - 1];
    const label = LABEL_LADDER.find(step => step >= minor && step * pxPerMinute >= minLabelGapPx) || LABEL_LADDER[LABEL_LADDER.length - 1];
    return { minor, major: 30, hour: 60, label };
  }

  /**
   * The marks down an axis `height` pixels tall spanning `windowMs` from
   * `now`, aligned to the wall clock by minute-of-day (as station-rundown's
   * ticks are), each with its pixel offset and a label when the plan gives
   * it one. No label sits within `edgePx` of either end: the Now line owns
   * the top, the changeover the bottom.
   */
  function verticalTicks(options) {
    const settings = options || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const windowMs = Number.isFinite(settings.windowMs) && settings.windowMs > 0 ? settings.windowMs : DEFAULT_HOURS * HOUR;
    const height = Number.isFinite(settings.height) && settings.height > 0 ? settings.height : 0;
    const minLabelGapPx = Number.isFinite(settings.minLabelGapPx) ? settings.minLabelGapPx : LABEL_MIN_PX;
    const edgePx = Number.isFinite(settings.edgePx) ? settings.edgePx : LABEL_EDGE_PX;
    const plan = tickPlan(windowMs, height, minLabelGapPx);
    const minorMs = plan.minor * MINUTE;
    const marks = [];
    const startMinute = localMinuteOfDay(now);
    const startSeconds = new Date(now).getSeconds() * 1000 + new Date(now).getMilliseconds();
    const firstOffset = ((plan.minor - (startMinute % plan.minor)) % plan.minor) * MINUTE - startSeconds;
    let t = now + (firstOffset < 0 ? firstOffset + minorMs : firstOffset);
    if (t < now) t += minorMs;
    const end = now + windowMs;
    while (t <= end) {
      const minuteOfDay = localMinuteOfDay(t);
      const hour = minuteOfDay % plan.hour === 0;
      const major = hour || minuteOfDay % plan.major === 0;
      const y = ((t - now) / windowMs) * height;
      const clearOfEdges = height <= 0 || (y >= edgePx && y <= height - edgePx);
      const labelled = minuteOfDay % plan.label === 0 && clearOfEdges;
      marks.push({
        t,
        fraction: (t - now) / windowMs,
        y,
        kind: hour ? "hour" : (major ? "major" : "minor"),
        label: labelled ? rundownModule.formatClock(t) : ""
      });
      t += minorMs;
    }
    return { plan, marks };
  }

  /* ---- The events ---- */

  function byMark(a, b) {
    if (a.markAt !== b.markAt) return a.markAt - b.markAt;
    return String(a.key).localeCompare(String(b.key));
  }

  function makeGroup(first, now, windowMs) {
    return {
      id: first.key,
      at: first.markAt,
      fraction: windowMs > 0 ? (first.markAt - now) / windowMs : 0,
      kind: first.markKind === "empty" ? "empty" : "pump-off",
      late: !!first.late,
      members: [first]
    };
  }

  /**
   * Sort the projected entries into what the pane shows.
   *
   * @param {Array} entries   station-rundown's projectEntries output
   * @param {object} options  { now, windowMs, groupMs }
   * @returns {{ overdue: {members}|null, groups: Array, later: Array, unavailable: Array, done: Array }}
   */
  function groupEvents(entries, options) {
    const settings = options || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const windowMs = Number.isFinite(settings.windowMs) && settings.windowMs > 0 ? settings.windowMs : DEFAULT_HOURS * HOUR;
    const groupMs = Number.isFinite(settings.groupMs) ? settings.groupMs : GROUP_MS;
    const list = Array.isArray(entries) ? entries : [];
    const done = [];
    const unavailable = [];
    const overdue = [];
    const later = [];
    const upcoming = [];
    for (const entry of list) {
      if (!entry || !entry.tracked) continue;
      if (entry.pumpOff) { done.push(entry); continue; }
      if (entry.reason || !Number.isFinite(entry.markAt)) { unavailable.push(entry); continue; }
      if (entry.markAt < now) { overdue.push(entry); continue; }
      if (entry.markAt > now + windowMs) { later.push(entry); continue; }
      upcoming.push(entry);
    }
    done.sort((a, b) => {
      const at = (Number.isFinite(a.markAt) ? a.markAt : Infinity) - (Number.isFinite(b.markAt) ? b.markAt : Infinity);
      return at !== 0 && Number.isFinite(at) ? at : String(a.key).localeCompare(String(b.key));
    });
    overdue.sort(byMark);
    later.sort(byMark);
    upcoming.sort(byMark);

    const groups = [];
    for (const entry of upcoming) {
      const open = groups.length ? groups[groups.length - 1] : null;
      // Anchored on the group's earliest member, so a chain of near
      // misses cannot stretch a group past the five minutes.
      if (open && entry.markAt - open.at <= groupMs) {
        open.members.push(entry);
        open.late = open.late || !!entry.late;
      } else {
        groups.push(makeGroup(entry, now, windowMs));
      }
    }
    return {
      overdue: overdue.length ? { members: overdue, kind: overdue[0].markKind === "empty" ? "empty" : "pump-off" } : null,
      groups,
      later,
      unavailable,
      done
    };
  }

  /* ---- The length the cards need ---- */

  /* A card near the axis's end is not allowed to demand an endless axis:
   * its instant is counted as if it stood at most this near the end. */
  const MIN_END_ROOM = 0.05;

  /**
   * The shortest span (the axis's time scale, px) on which placeCards
   * needs no merge. Stacked from their instants, the last card ends at the
   * greater of: every card stacked from the floor, and any card's instant
   * plus the cards after it. Both must end by the span's end.
   *
   * `endRoom` is the second of those two: a fitted axis ends at the
   * changeover, so what stands after a mark must fit above it and the axis
   * stretches until it does. A chosen span has no such end - three hours
   * chosen is three hours shown - so it asks only that the cards stack,
   * and a card near the end is lifted to fit (placeCards) rather than
   * stretching the axis by twenty times to hold the last few pixels.
   *
   * @param {Array} groups       groupEvents' groups (each with its fraction)
   * @param {object} options     { cardHeight(group), gap, floorOffset (the
   *                             pinned block's room above the first card),
   *                             minSpan (what the window shows), maxSpan,
   *                             endRoom (default true) }
   * @returns {{ span: number, needed: number, grows: boolean, fits: boolean }}
   */
  function spanNeeded(groups, options) {
    const settings = options || {};
    const gap = Number.isFinite(settings.gap) ? settings.gap : 0;
    const cardHeight = typeof settings.cardHeight === "function" ? settings.cardHeight : () => 0;
    const floorOffset = Number.isFinite(settings.floorOffset) ? Math.max(settings.floorOffset, 0) : 0;
    const minSpan = Number.isFinite(settings.minSpan) ? Math.max(settings.minSpan, 0) : 0;
    const maxSpan = Number.isFinite(settings.maxSpan) && settings.maxSpan > 0 ? settings.maxSpan : Infinity;
    const endRoom = settings.endRoom !== false;
    const list = Array.isArray(groups) ? groups : [];
    const heights = list.map(group => Math.max(Number(cardHeight(group)) || 0, 0));
    let needed = 0;
    if (list.length) {
      const stacked = heights.reduce((sum, height) => sum + height, 0) + gap * (list.length - 1);
      needed = floorOffset + stacked;
      if (endRoom) {
        let tail = -gap;
        for (let index = list.length - 1; index >= 0; index -= 1) {
          tail += heights[index] + gap;
          const fraction = Math.max(0, Math.min(1, Number(list[index].fraction) || 0));
          needed = Math.max(needed, tail / Math.max(1 - fraction, MIN_END_ROOM));
        }
      }
    }
    const span = Math.min(Math.max(minSpan, needed), Math.max(maxSpan, minSpan));
    return { span, needed, grows: span > minSpan, fits: needed <= span };
  }

  /* ---- The cards ---- */

  function mergeInto(groups, index) {
    const a = groups[index];
    const b = groups[index + 1];
    const merged = {
      id: a.id,
      at: a.at,
      fraction: a.fraction,
      kind: a.kind,
      late: a.late || b.late,
      members: a.members.concat(b.members),
      merged: true
    };
    return groups.slice(0, index).concat([merged], groups.slice(index + 2));
  }

  /**
   * Place the cards down the axis.
   *
   * Each card wants its top at its group's instant (`y0`). A sweep down
   * pushes a card below the one before it; if the last then hangs below the
   * axis, a sweep back up lifts them to fit; if that lifts the first above
   * the top (or the pinned overdue block), the two nearest groups merge and
   * the placement runs again - until it fits or one group is left, which
   * is then `clipped` and scrolls its own list.
   *
   * @param {Array} groups        groupEvents' groups
   * @param {object} options      { height, topInset, bottomInset, gap, cardHeight(group), pinned: {members}|null }
   * @returns {{ cards: Array<{group, y0, y, displacement, height}>, pinned: {y, height}|null, span, floor, ceiling }}
   */
  function placeCards(groups, options) {
    const settings = options || {};
    const height = Number.isFinite(settings.height) && settings.height > 0 ? settings.height : 0;
    const topInset = Number.isFinite(settings.topInset) ? settings.topInset : 0;
    const bottomInset = Number.isFinite(settings.bottomInset) ? settings.bottomInset : 0;
    const gap = Number.isFinite(settings.gap) ? settings.gap : 0;
    const cardHeight = typeof settings.cardHeight === "function" ? settings.cardHeight : () => 0;
    const span = Math.max(height - topInset - bottomInset, 0);
    const ceiling = height - bottomInset;

    let pinned = null;
    let floor = topInset;
    if (settings.pinned && Array.isArray(settings.pinned.members) && settings.pinned.members.length) {
      const pinnedHeight = cardHeight(settings.pinned);
      pinned = { y: topInset + gap, height: pinnedHeight };
      floor = pinned.y + pinnedHeight + gap;
    }

    let list = Array.isArray(groups) ? groups.slice() : [];
    let cards = [];
    let clipped = false;
    for (;;) {
      cards = list.map(group => ({ group, y0: topInset + group.fraction * span, y: 0, displacement: 0, height: cardHeight(group) }));
      let cursor = floor;
      for (const card of cards) {
        card.y = Math.max(card.y0, cursor);
        cursor = card.y + card.height + gap;
      }
      const last = cards[cards.length - 1];
      if (last && last.y + last.height > ceiling) {
        let limit = ceiling;
        for (let index = cards.length - 1; index >= 0; index -= 1) {
          const card = cards[index];
          card.y = Math.min(card.y, limit - card.height);
          limit = card.y - gap;
        }
      }
      const first = cards[0];
      if (!first || first.y >= floor) break;
      if (list.length === 1) { clipped = true; first.y = floor; break; }
      // Merge the two nearest neighbours by instant.
      let nearest = 0;
      let distance = Infinity;
      for (let index = 0; index + 1 < list.length; index += 1) {
        const d = list[index + 1].at - list[index].at;
        if (d < distance) { distance = d; nearest = index; }
      }
      list = mergeInto(list, nearest);
    }
    for (const card of cards) card.displacement = card.y - card.y0;
    if (clipped && cards[0]) cards[0].clipped = true;
    return { cards, pinned, span, floor, ceiling };
  }

  return Object.freeze({
    FIT_MARGIN, MIN_WINDOW_MS, GROUP_MS, MINOR_LADDER, LABEL_LADDER, MINOR_MIN_PX, LABEL_MIN_PX, LABEL_EDGE_PX, MIN_END_ROOM,
    SCALED, HOURS, DEFAULT_HOURS, DEFAULT_SCALE,
    windowFor, scaleFrom, hoursFrom, tickPlan, verticalTicks, groupEvents, spanNeeded, placeCards
  });
});
