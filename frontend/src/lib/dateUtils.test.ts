import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatRelativeDate,
  formatDateShort,
  formatDateMedium,
  formatDateFull,
  formatDateTooltip,
} from "./dateUtils";

describe("dateUtils", () => {
  beforeEach(() => {
    // Mock date to December 15, 2024 at 3:00 PM
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 11, 15, 15, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("formatRelativeDate", () => {
    it('returns "Just now" for timestamps less than 1 minute ago', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeDate(now)).toBe("Just now");
      expect(formatRelativeDate(now - 30)).toBe("Just now");
    });

    it("returns minutes ago for timestamps less than 1 hour ago", () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeDate(now - 60)).toBe("1m ago");
      expect(formatRelativeDate(now - 5 * 60)).toBe("5m ago");
      expect(formatRelativeDate(now - 30 * 60)).toBe("30m ago");
      expect(formatRelativeDate(now - 59 * 60)).toBe("59m ago");
    });

    it("returns hours ago for timestamps earlier today", () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeDate(now - 60 * 60)).toBe("1h ago");
      expect(formatRelativeDate(now - 3 * 60 * 60)).toBe("3h ago");
    });

    it('returns "Yesterday" for timestamps from yesterday', () => {
      // Yesterday at noon
      const yesterday = new Date(2024, 11, 14, 12, 0, 0);
      const timestamp = Math.floor(yesterday.getTime() / 1000);
      expect(formatRelativeDate(timestamp)).toBe("Yesterday");
    });

    it("returns month and day for timestamps from same year", () => {
      // December 10, 2024
      const dec10 = new Date(2024, 11, 10, 12, 0, 0);
      const timestamp = Math.floor(dec10.getTime() / 1000);
      expect(formatRelativeDate(timestamp)).toBe("Dec 10");

      // January 5, 2024
      const jan5 = new Date(2024, 0, 5, 12, 0, 0);
      const timestamp2 = Math.floor(jan5.getTime() / 1000);
      expect(formatRelativeDate(timestamp2)).toBe("Jan 5");
    });

    it("returns month, day, and year for timestamps from different year", () => {
      // December 10, 2023
      const dec10Last = new Date(2023, 11, 10, 12, 0, 0);
      const timestamp = Math.floor(dec10Last.getTime() / 1000);
      expect(formatRelativeDate(timestamp)).toBe("Dec 10, 2023");
    });
  });

  describe("formatDateShort", () => {
    it("returns time for today's timestamps", () => {
      // 2:30 PM today
      const today = new Date(2024, 11, 15, 14, 30, 0);
      const timestamp = Math.floor(today.getTime() / 1000);
      expect(formatDateShort(timestamp)).toBe("2:30 PM");
    });

    it("returns month and day for other dates", () => {
      // Yesterday
      const yesterday = new Date(2024, 11, 14, 12, 0, 0);
      const timestamp = Math.floor(yesterday.getTime() / 1000);
      expect(formatDateShort(timestamp)).toBe("Dec 14");

      // A week ago
      const weekAgo = new Date(2024, 11, 8, 12, 0, 0);
      const timestamp2 = Math.floor(weekAgo.getTime() / 1000);
      expect(formatDateShort(timestamp2)).toBe("Dec 8");
    });
  });

  describe("formatDateMedium", () => {
    it("returns weekday, month, day, and time", () => {
      // Sunday, December 15, 2024 at 2:30 PM
      const date = new Date(2024, 11, 15, 14, 30, 0);
      const timestamp = Math.floor(date.getTime() / 1000);
      const result = formatDateMedium(timestamp);
      expect(result).toContain("Sun");
      expect(result).toContain("Dec");
      expect(result).toContain("15");
      expect(result).toContain("2:30");
    });
  });

  describe("formatDateFull", () => {
    it("returns full readable date", () => {
      // Sunday, December 15, 2024 at 2:30 PM
      const date = new Date(2024, 11, 15, 14, 30, 0);
      const timestamp = Math.floor(date.getTime() / 1000);
      const result = formatDateFull(timestamp);
      expect(result).toContain("Sunday");
      expect(result).toContain("December");
      expect(result).toContain("15");
      expect(result).toContain("2024");
      expect(result).toContain("2:30");
    });
  });

  describe("formatDateTooltip", () => {
    it("returns full date with seconds for tooltip", () => {
      // Sunday, December 15, 2024 at 2:30:45 PM
      const date = new Date(2024, 11, 15, 14, 30, 45);
      const timestamp = Math.floor(date.getTime() / 1000);
      const result = formatDateTooltip(timestamp);
      expect(result).toContain("Sunday");
      expect(result).toContain("December");
      expect(result).toContain("15");
      expect(result).toContain("2024");
      expect(result).toContain("2:30:45");
    });
  });
});
