/*
 * Configurable day window for the dashboard.
 *
 * Pure, DOM-free helpers that bucket PR events into calendar days under an
 * IANA timezone and a configurable day-start hour. A day with start hour H and
 * label YYYY-MM-DD covers [YYYY-MM-DD H:00, YYYY-MM-DD+1 H:00) in that zone.
 *
 * Works in the browser as `window.DayWindow` and in Node via require() so the
 * bucketing rules can be unit-tested without a DOM.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DayWindow = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY_WINDOW_DEFAULTS = Object.freeze({ tz: "Asia/Shanghai", dayStartHour: 8 });

  const TZ_OPTIONS = [
    { value: "UTC", label: "UTC" },
    { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+8)" },
    { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
    { value: "Asia/Singapore", label: "Asia/Singapore (UTC+8)" },
    { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+5:30)" },
    { value: "Europe/London", label: "Europe/London" },
    { value: "Europe/Paris", label: "Europe/Paris" },
    { value: "America/New_York", label: "America/New_York" },
    { value: "America/Los_Angeles", label: "America/Los_Angeles" },
    { value: "Australia/Sydney", label: "Australia/Sydney" },
  ];

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  function parseDateKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return { year, month, day };
  }

  function shiftDateKey(key, days) {
    const { year, month, day } = parseDateKey(key);
    const dt = new Date(Date.UTC(year, month - 1, day + days));
    return dateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  function makePartsFormatter(tz) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }

  function localParts(formatter, ms) {
    const parts = formatter.formatToParts(new Date(ms));
    const map = {};
    for (const part of parts) {
      map[part.type] = part.value;
    }
    return {
      year: +map.year,
      month: +map.month,
      day: +map.day,
      hour: +map.hour,
      minute: +map.minute,
      second: +map.second,
    };
  }

  /**
   * UTC epoch ms for a wall-clock time in the given timezone.
   * Converges even across DST transitions; a nonexistent wall time (a spring
   * gap) resolves to the first valid instant with those components.
   */
  function zonedUtcMs(formatter, year, month, day, hour, minute, second) {
    let utc = Date.UTC(year, month - 1, day, hour, minute, second);
    for (let i = 0; i < 3; i++) {
      const parts = localParts(formatter, utc);
      const current = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const target = Date.UTC(year, month - 1, day, hour, minute, second);
      const diff = target - current;
      if (diff === 0) {
        return utc;
      }
      utc += diff;
    }
    return utc;
  }

  /**
   * Label (YYYY-MM-DD) of the day bucket containing the instant `ms`,
   * under the given timezone and day-start hour.
   */
  function bucketKey(formatter, tz, ms, dayStartHour) {
    const parts = localParts(formatter, ms);
    let key = dateKey(parts.year, parts.month, parts.day);
    if (parts.hour < dayStartHour) {
      key = shiftDateKey(key, -1);
    }
    return key;
  }

  /** Start instant (UTC ms) of the bucket labeled `key`. */
  function bucketStartMs(formatter, key, dayStartHour) {
    const { year, month, day } = parseDateKey(key);
    return zonedUtcMs(formatter, year, month, day, dayStartHour, 0, 0);
  }

  /** End instant (UTC ms) of the bucket labeled `key` (start of the next bucket). */
  function bucketEndMs(formatter, key, dayStartHour) {
    return bucketStartMs(formatter, shiftDateKey(key, 1), dayStartHour);
  }

  /**
   * First index in a sorted (ascending) array whose value is >= target.
   * Equivalent to the count of values strictly below target.
   */
  function lowerBound(sorted, targetMs) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < targetMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Build daily PR rows from raw PR events under a day-window config.
   *
   * events.prs entries: { created_at: "ISO-Z", closed_at: "ISO-Z"|null,
   * merged_at: "ISO-Z"|null }. Returns rows in ascending date order, each with
   * date, prs_opened, prs_closed, prs_merged, pr_net, prs_open_eod. The last
   * row is the day bucket that contains `nowMs`.
   */
  function buildDailyRows(events, config, nowMs) {
    const formatter = makePartsFormatter(config.tz);
    const dayStartHour = config.dayStartHour;
    const prs = (events && Array.isArray(events.prs) && events.prs) || [];

    const opened = new Map();
    const closed = new Map();
    const merged = new Map();
    const createdMs = [];
    const closedMs = [];

    for (const pr of prs) {
      const created = Date.parse(pr.created_at);
      if (!Number.isFinite(created)) {
        continue;
      }
      const openedKey = bucketKey(formatter, config.tz, created, dayStartHour);
      opened.set(openedKey, (opened.get(openedKey) || 0) + 1);
      createdMs.push(created);

      if (pr.closed_at) {
        const closedMsValue = Date.parse(pr.closed_at);
        if (Number.isFinite(closedMsValue)) {
          const closedKey = bucketKey(formatter, config.tz, closedMsValue, dayStartHour);
          closed.set(closedKey, (closed.get(closedKey) || 0) + 1);
          closedMs.push(closedMsValue);
        }
      }
      if (pr.merged_at) {
        const mergedMsValue = Date.parse(pr.merged_at);
        if (Number.isFinite(mergedMsValue)) {
          const mergedKey = bucketKey(formatter, config.tz, mergedMsValue, dayStartHour);
          merged.set(mergedKey, (merged.get(mergedKey) || 0) + 1);
        }
      }
    }

    createdMs.sort((a, b) => a - b);
    closedMs.sort((a, b) => a - b);

    const todayKey = bucketKey(formatter, config.tz, nowMs, dayStartHour);
    if (!opened.size && !closed.size && !merged.size) {
      return [];
    }

    let minKey = todayKey;
    for (const key of opened.keys()) {
      if (key < minKey) {
        minKey = key;
      }
    }
    for (const key of closed.keys()) {
      if (key < minKey) {
        minKey = key;
      }
    }
    for (const key of merged.keys()) {
      if (key < minKey) {
        minKey = key;
      }
    }

    const rows = [];
    for (let key = minKey; key <= todayKey; key = shiftDateKey(key, 1)) {
      const endMs = bucketEndMs(formatter, key, dayStartHour);
      // A PR is open at the bucket end iff it was created before the end and
      // not closed before the end. Counts are exact with sorted timestamps.
      const openEod = lowerBound(createdMs, endMs) - lowerBound(closedMs, endMs);
      rows.push({
        date: key,
        prs_opened: opened.get(key) || 0,
        prs_closed: closed.get(key) || 0,
        prs_merged: merged.get(key) || 0,
        pr_net: (opened.get(key) || 0) - (closed.get(key) || 0),
        prs_open_eod: openEod,
      });
    }
    return rows;
  }

  return {
    DAY_WINDOW_DEFAULTS,
    TZ_OPTIONS,
    dateKey,
    parseDateKey,
    shiftDateKey,
    makePartsFormatter,
    localParts,
    zonedUtcMs,
    bucketKey,
    bucketStartMs,
    bucketEndMs,
    lowerBound,
    buildDailyRows,
  };
});
