import { describe, it, expect } from "vitest";
import { parseWhen, whenPresets, formatWhen, toUnix } from "./dateParse";

// Wednesday, Oct 28 2026, 10:00 local
const NOW = new Date(2026, 9, 28, 10, 0, 0);
const p = (s: string, now = NOW) => parseWhen(s, now);
const parts = (d: Date | null) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

describe("parseWhen", () => {
  it("parses relative offsets", () => {
    expect(parts(p("in 2 hours"))).toEqual([2026, 10, 28, 12, 0]);
    expect(parts(p("in 30 min"))).toEqual([2026, 10, 28, 10, 30]);
    expect(parts(p("in 3 days"))).toEqual([2026, 10, 31, 10, 0]);
    expect(parts(p("in 1 week"))).toEqual([2026, 11, 4, 10, 0]);
    expect(parts(p("2h"))).toEqual([2026, 10, 28, 12, 0]);
  });

  it("parses tomorrow with and without a time", () => {
    expect(parts(p("tomorrow"))).toEqual([2026, 10, 29, 9, 0]);
    expect(parts(p("tomorrow 9am"))).toEqual([2026, 10, 29, 9, 0]);
    expect(parts(p("tomorrow at 2:30pm"))).toEqual([2026, 10, 29, 14, 30]);
    expect(parts(p("tomorrow afternoon"))).toEqual([2026, 10, 29, 14, 0]);
  });

  it("parses weekdays", () => {
    expect(parts(p("fri 3pm"))).toEqual([2026, 10, 30, 15, 0]);
    expect(parts(p("friday"))).toEqual([2026, 10, 30, 9, 0]);
    expect(parts(p("next monday"))).toEqual([2026, 11, 2, 9, 0]);
    // Same weekday means next week unless today's time is still ahead
    expect(parts(p("wed"))).toEqual([2026, 11, 4, 9, 0]);
    expect(parts(p("wed 5pm"))).toEqual([2026, 10, 28, 17, 0]);
    expect(parts(p("next week"))).toEqual([2026, 11, 2, 9, 0]);
  });

  it("parses time-only input as the next occurrence", () => {
    expect(parts(p("3pm"))).toEqual([2026, 10, 28, 15, 0]);
    expect(parts(p("9am"))).toEqual([2026, 10, 29, 9, 0]);
    expect(parts(p("15:30"))).toEqual([2026, 10, 28, 15, 30]);
    expect(parts(p("tonight"))).toEqual([2026, 10, 28, 20, 0]);
  });

  it("parses calendar dates", () => {
    expect(parts(p("nov 5 2pm"))).toEqual([2026, 11, 5, 14, 0]);
    expect(parts(p("5 nov"))).toEqual([2026, 11, 5, 9, 0]);
    expect(parts(p("12/25"))).toEqual([2026, 12, 25, 9, 0]);
    expect(parts(p("2026-12-25 14:00"))).toEqual([2026, 12, 25, 14, 0]);
    // A date already past this year rolls to next year
    expect(parts(p("jan 2"))).toEqual([2027, 1, 2, 9, 0]);
  });

  it("parses the weekend", () => {
    expect(parts(p("this weekend"))).toEqual([2026, 10, 31, 10, 0]);
  });

  it("rejects garbage, past and empty input", () => {
    expect(p("")).toBeNull();
    expect(p("blah")).toBeNull();
    expect(p("feb 30")).toBeNull();
    expect(p("today 8am")).toBeNull();
    expect(p("in 0 minutes")).toBeNull();
  });
});

describe("whenPresets", () => {
  it("numbers presets from 1", () => {
    const presets = whenPresets(NOW);
    expect(presets.map((x) => x.key)).toEqual(["1", "2", "3", "4", "5"]);
    expect(parts(presets[0].date)).toEqual([2026, 10, 28, 17, 0]);
    expect(parts(presets[1].date)).toEqual([2026, 10, 29, 9, 0]);
    expect(parts(presets[3].date)).toEqual([2026, 10, 31, 10, 0]);
    expect(parts(presets[4].date)).toEqual([2026, 11, 2, 9, 0]);
  });

  it("uses 8pm in the evening and drops it once passed", () => {
    expect(parts(whenPresets(new Date(2026, 9, 28, 18, 0))[0].date)).toEqual([2026, 10, 28, 20, 0]);
    const late = whenPresets(new Date(2026, 9, 28, 21, 0));
    expect(late[0].id).toBe("tomorrow");
    expect(late[0].key).toBe("1");
  });
});

describe("formatWhen", () => {
  it("labels today and tomorrow", () => {
    expect(formatWhen(new Date(2026, 9, 28, 17, 0), NOW)).toMatch(/^Today, /);
    expect(formatWhen(new Date(2026, 9, 29, 9, 0), NOW)).toMatch(/^Tomorrow, /);
  });
  it("converts to unix seconds", () => {
    expect(toUnix(NOW)).toBe(Math.floor(NOW.getTime() / 1000));
  });
});
