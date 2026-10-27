"use strict";

/* Unit tests for the configurable day-window bucketing (site/assets/day-window.js). */

const assert = require("assert");
const DayWindow = require("../site/assets/day-window.js");

const shanghai = DayWindow.makePartsFormatter("Asia/Shanghai");
const newYork = DayWindow.makePartsFormatter("America/New_York");

/* Defaults: Asia/Shanghai (UTC+8) with an 08:00 day boundary */
assert.equal(DayWindow.DAY_WINDOW_DEFAULTS.tz, "Asia/Shanghai");
assert.equal(DayWindow.DAY_WINDOW_DEFAULTS.dayStartHour, 8);

function iso(ms) {
  return new Date(ms).toISOString();
}

/* bucketKey: Asia/Shanghai, midnight boundary */
assert.equal(
  DayWindow.bucketKey(shanghai, "Asia/Shanghai", Date.parse("2026-10-27T01:00:00Z"), 0),
  "2026-10-27",
  "09:00 CST belongs to 2026-10-27",
);
assert.equal(
  DayWindow.bucketKey(shanghai, "Asia/Shanghai", Date.parse("2026-10-26T17:00:00Z"), 0),
  "2026-10-27",
  "01:00 CST on the 27th still belongs to the 27th at midnight boundary",
);

/* bucketKey: Asia/Shanghai, 08:00 boundary (8am -> next 8am = one day) */
assert.equal(
  DayWindow.bucketKey(shanghai, "Asia/Shanghai", Date.parse("2026-10-26T17:00:00Z"), 8),
  "2026-10-26",
  "01:00 CST belongs to the previous day when the day starts at 08:00",
);
assert.equal(
  DayWindow.bucketKey(shanghai, "Asia/Shanghai", Date.parse("2026-10-26T23:59:00Z"), 8),
  "2026-10-26",
  "07:59 CST belongs to the previous day when the day starts at 08:00",
);
assert.equal(
  DayWindow.bucketKey(shanghai, "Asia/Shanghai", Date.parse("2026-10-27T00:01:00Z"), 8),
  "2026-10-27",
  "08:01 CST starts the new 08:00-bounded day",
);

/* zonedUtcMs: wall clock -> instant */
assert.equal(
  iso(DayWindow.zonedUtcMs(shanghai, 2026, 10, 27, 0, 0, 0)),
  "2026-10-26T16:00:00.000Z",
  "2026-10-27 00:00 Shanghai is 2026-10-26T16:00Z",
);
assert.equal(
  iso(DayWindow.zonedUtcMs(shanghai, 2026, 10, 27, 8, 0, 0)),
  "2026-10-27T00:00:00.000Z",
  "2026-10-27 08:00 Shanghai is 2026-10-27T00:00Z",
);

/* bucket start/end instants */
assert.equal(
  iso(DayWindow.bucketEndMs(shanghai, "2026-10-26", 8)),
  "2026-10-27T00:00:00.000Z",
  "08:00-bounded day 2026-10-26 ends at 2026-10-27T00:00Z",
);
assert.equal(
  iso(DayWindow.bucketStartMs(shanghai, "2026-10-26", 0)),
  "2026-10-25T16:00:00.000Z",
  "midnight-bounded day 2026-10-26 starts at 2026-10-25T16:00Z",
);

/* DST: America/New_York */
assert.equal(
  DayWindow.bucketKey(newYork, "America/New_York", Date.parse("2026-03-08T06:59:00Z"), 0),
  "2026-03-08",
  "01:59 EST before the spring-forward is still 2026-03-08",
);
assert.equal(
  DayWindow.bucketKey(newYork, "America/New_York", Date.parse("2026-03-08T07:00:00Z"), 0),
  "2026-03-08",
  "02:00 EDT after the spring-forward is still 2026-03-08",
);
assert.equal(
  iso(DayWindow.bucketEndMs(newYork, "2026-03-08", 0)),
  "2026-03-09T04:00:00.000Z",
  "end of 2026-03-08 in NY is 04:00Z (00:00 EDT after spring-forward)",
);
assert.equal(
  DayWindow.bucketKey(newYork, "America/New_York", Date.parse("2026-11-01T05:30:00Z"), 0),
  "2026-11-01",
  "01:30 EDT before the fall-back is 2026-11-01",
);
assert.equal(
  DayWindow.bucketKey(newYork, "America/New_York", Date.parse("2026-11-01T06:30:00Z"), 0),
  "2026-11-01",
  "01:30 EST after the fall-back is 2026-11-01",
);

/* lowerBound */
assert.equal(DayWindow.lowerBound([1, 3, 5], 3), 1);
assert.equal(DayWindow.lowerBound([1, 3, 5], 4), 2);
assert.equal(DayWindow.lowerBound([1, 3, 5], 0), 0);
assert.equal(DayWindow.lowerBound([], 5), 0);

/* buildDailyRows: full daily reconstruction from raw events */
const events = {
  prs: [
    // A: opened 2026-10-27 00:00 CST, still open
    { created_at: "2026-10-26T16:00:00Z", closed_at: null, merged_at: null },
    // B: opened 2026-10-27 10:00 CST, closed+merged 12:00 CST
    {
      created_at: "2026-10-27T02:00:00Z",
      closed_at: "2026-10-27T04:00:00Z",
      merged_at: "2026-10-27T04:00:00Z",
    },
    // C: opened 2026-10-26 23:00 CST, closed 2026-10-27 08:00 CST
    {
      created_at: "2026-10-26T15:00:00Z",
      closed_at: "2026-10-27T00:00:00Z",
      merged_at: null,
    },
  ],
};
const now = Date.parse("2026-10-27T06:00:00Z"); // 14:00 CST -> today bucket 2026-10-27

const midnightRows = DayWindow.buildDailyRows(
  events,
  { tz: "Asia/Shanghai", dayStartHour: 0 },
  now,
);
assert.deepEqual(
  midnightRows,
  [
    { date: "2026-10-26", prs_opened: 1, prs_closed: 0, prs_merged: 0, pr_net: 1, prs_open_eod: 1 },
    { date: "2026-10-27", prs_opened: 2, prs_closed: 2, prs_merged: 1, pr_net: 0, prs_open_eod: 1 },
  ],
  "midnight-bounded days (C opened 23:00 on the 26th is still open at midnight)",
);

const eightRows = DayWindow.buildDailyRows(
  events,
  { tz: "Asia/Shanghai", dayStartHour: 8 },
  now,
);
assert.deepEqual(
  eightRows,
  [
    { date: "2026-10-26", prs_opened: 2, prs_closed: 0, prs_merged: 0, pr_net: 2, prs_open_eod: 2 },
    { date: "2026-10-27", prs_opened: 1, prs_closed: 2, prs_merged: 1, pr_net: -1, prs_open_eod: 1 },
  ],
  "08:00-bounded days (8am to next 8am)",
);

/* empty events */
assert.deepEqual(DayWindow.buildDailyRows({ prs: [] }, { tz: "Asia/Shanghai", dayStartHour: 0 }, now), []);

console.log("test_day_window.js: all assertions passed");
