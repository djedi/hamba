import { describe, it, expect, beforeEach } from "vitest";
import type { Email } from "./api";
import {
  listKey,
  getSnapshot,
  setSnapshot,
  updateSnapshot,
  hasSnapshot,
  invalidateAccount,
  clearListCache,
  MAX_ENTRIES,
  type ListSnapshot,
} from "./listCache";

function makeSnap(overrides: Partial<ListSnapshot> = {}): ListSnapshot {
  return {
    emails: [{ id: "e1" } as Email],
    offset: 1,
    hasMore: false,
    selectedEmailId: "e1",
    selectedIndex: 0,
    scrollTop: 0,
    fetchedAt: 1,
    ...overrides,
  };
}

describe("listCache", () => {
  beforeEach(() => {
    clearListCache();
  });

  describe("listKey", () => {
    it("builds account:folder keys", () => {
      expect(listKey("acct-1", "inbox")).toBe("acct-1:inbox");
      expect(listKey("acct-1", "sent")).toBe("acct-1:sent");
    });

    it("includes the label id for label folders", () => {
      expect(listKey("acct-1", "label", "lbl-9")).toBe("acct-1:label:lbl-9");
    });
  });

  describe("round trip", () => {
    it("returns what was stored", () => {
      const snap = makeSnap({ offset: 42, scrollTop: 120 });
      setSnapshot("a:inbox", snap);
      expect(hasSnapshot("a:inbox")).toBe(true);
      expect(getSnapshot("a:inbox")).toEqual(snap);
    });

    it("returns undefined for missing keys", () => {
      expect(getSnapshot("missing")).toBeUndefined();
      expect(hasSnapshot("missing")).toBe(false);
    });
  });

  describe("updateSnapshot", () => {
    it("merges the patch into the existing snapshot", () => {
      setSnapshot("a:inbox", makeSnap({ scrollTop: 0, selectedIndex: 0 }));
      updateSnapshot("a:inbox", { scrollTop: 300 });
      const snap = getSnapshot("a:inbox");
      expect(snap?.scrollTop).toBe(300);
      expect(snap?.selectedIndex).toBe(0);
      expect(snap?.offset).toBe(1);
    });

    it("is a no-op when the key is missing", () => {
      updateSnapshot("missing", { scrollTop: 10 });
      expect(hasSnapshot("missing")).toBe(false);
    });
  });

  describe("LRU eviction", () => {
    it("evicts the least recently used entry past MAX_ENTRIES", () => {
      for (let i = 0; i < MAX_ENTRIES; i++) {
        setSnapshot(`k${i}`, makeSnap());
      }
      // Touch k0 so k1 becomes the least recently used
      getSnapshot("k0");
      setSnapshot("extra", makeSnap());

      expect(hasSnapshot("k0")).toBe(true);
      expect(hasSnapshot("k1")).toBe(false);
      expect(hasSnapshot("extra")).toBe(true);
      expect(hasSnapshot(`k${MAX_ENTRIES - 1}`)).toBe(true);
    });

    it("never holds more than MAX_ENTRIES entries", () => {
      for (let i = 0; i < MAX_ENTRIES + 10; i++) {
        setSnapshot(`k${i}`, makeSnap());
      }
      let count = 0;
      for (let i = 0; i < MAX_ENTRIES + 10; i++) {
        if (hasSnapshot(`k${i}`)) count++;
      }
      expect(count).toBe(MAX_ENTRIES);
      expect(hasSnapshot("k0")).toBe(false);
    });
  });

  describe("invalidateAccount", () => {
    it("removes only keys belonging to the account", () => {
      setSnapshot("acct-1:inbox", makeSnap());
      setSnapshot("acct-1:label:x", makeSnap());
      setSnapshot("acct-10:inbox", makeSnap());
      setSnapshot("acct-2:inbox", makeSnap());

      invalidateAccount("acct-1");

      expect(hasSnapshot("acct-1:inbox")).toBe(false);
      expect(hasSnapshot("acct-1:label:x")).toBe(false);
      expect(hasSnapshot("acct-10:inbox")).toBe(true);
      expect(hasSnapshot("acct-2:inbox")).toBe(true);
    });
  });

  describe("clearListCache", () => {
    it("removes every entry", () => {
      setSnapshot("a:inbox", makeSnap());
      setSnapshot("b:sent", makeSnap());
      clearListCache();
      expect(hasSnapshot("a:inbox")).toBe(false);
      expect(hasSnapshot("b:sent")).toBe(false);
    });
  });
});
