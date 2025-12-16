import { describe, it, expect, beforeEach, vi } from "vitest";

// Unit tests for the virtual scrolling calculation logic
// The VirtualList component uses these calculations internally

describe("VirtualList calculations", () => {
  const itemHeight = 46;
  const overscan = 3;

  function calculateVisibleRange(
    scrollTop: number,
    containerHeight: number,
    totalItems: number
  ) {
    if (totalItems === 0) {
      return { start: 0, end: 0 };
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const endIndex = Math.min(totalItems, startIndex + visibleCount + overscan * 2);

    return { start: startIndex, end: endIndex };
  }

  describe("calculateVisibleRange", () => {
    it("should return empty range for empty list", () => {
      const result = calculateVisibleRange(0, 500, 0);
      expect(result).toEqual({ start: 0, end: 0 });
    });

    it("should calculate range from start of list", () => {
      // Container height 500, can show ~11 items (500/46), plus overscan
      const result = calculateVisibleRange(0, 500, 100);
      expect(result.start).toBe(0);
      // end = 0 + 11 + 6 = 17 (with double overscan)
      expect(result.end).toBe(17);
    });

    it("should calculate range in middle of list", () => {
      // Scroll to item 20 (scrollTop = 20 * 46 = 920)
      const result = calculateVisibleRange(920, 500, 100);
      // start = floor(920/46) - 3 = 20 - 3 = 17
      expect(result.start).toBe(17);
      // end = 17 + ceil(500/46) + 6 = 17 + 11 + 6 = 34
      expect(result.end).toBe(34);
    });

    it("should clamp range at end of list", () => {
      // Scroll to item 95 (scrollTop = 95 * 46 = 4370)
      const result = calculateVisibleRange(4370, 500, 100);
      expect(result.start).toBe(92); // 95 - 3
      expect(result.end).toBe(100); // Clamped to total items
    });

    it("should handle small lists", () => {
      // Only 5 items total
      const result = calculateVisibleRange(0, 500, 5);
      expect(result.start).toBe(0);
      expect(result.end).toBe(5);
    });
  });

  describe("scroll to index calculations", () => {
    function shouldScrollTo(
      index: number,
      scrollTop: number,
      containerHeight: number,
      totalItems: number
    ): number | null {
      if (index < 0 || index >= totalItems) return null;

      const itemTop = index * itemHeight;
      const itemBottom = itemTop + itemHeight;
      const viewportTop = scrollTop;
      const viewportBottom = scrollTop + containerHeight;

      // Already fully visible
      if (itemTop >= viewportTop && itemBottom <= viewportBottom) {
        return null;
      }

      // Item is above viewport - scroll up
      if (itemTop < viewportTop) {
        return itemTop;
      }

      // Item is below viewport - scroll down
      return itemBottom - containerHeight;
    }

    it("should return null if item is visible", () => {
      // Item 5 is at position 230 (5 * 46)
      // Viewport shows 0-500, so item 5 is visible
      const result = shouldScrollTo(5, 0, 500, 100);
      expect(result).toBeNull();
    });

    it("should scroll up if item is above viewport", () => {
      // Scrolled to 500, viewport is 500-1000
      // Item 5 is at 230, which is above viewport
      const result = shouldScrollTo(5, 500, 500, 100);
      expect(result).toBe(230); // Scroll to item's top position
    });

    it("should scroll down if item is below viewport", () => {
      // Viewport shows 0-500
      // Item 15 is at 690-736, which is below viewport
      const result = shouldScrollTo(15, 0, 500, 100);
      // Scroll so item's bottom (736) is at viewport bottom (scrollTop + 500)
      expect(result).toBe(236); // 736 - 500 = 236
    });

    it("should return null for invalid indices", () => {
      expect(shouldScrollTo(-1, 0, 500, 100)).toBeNull();
      expect(shouldScrollTo(100, 0, 500, 100)).toBeNull();
    });
  });

  describe("offset and height calculations", () => {
    it("should calculate correct total height", () => {
      const totalItems = 1000;
      const totalHeight = totalItems * itemHeight;
      expect(totalHeight).toBe(46000);
    });

    it("should calculate correct offset for visible range", () => {
      const rangeStart = 50;
      const offsetY = rangeStart * itemHeight;
      expect(offsetY).toBe(2300);
    });
  });
});
