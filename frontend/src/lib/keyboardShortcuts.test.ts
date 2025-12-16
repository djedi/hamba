import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  type ShortcutAction,
  defaultShortcuts,
  customBindings,
  loadCustomBindings,
  getKeyForAction,
  getActionForKey,
  setBinding,
  resetBinding,
  resetAllBindings,
  hasCustomBindings,
  getShortcutsByCategory,
  formatKeyForDisplay,
  parseKeyEvent,
  buildKeyMaps,
} from "./keyboardShortcuts";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
});

describe("keyboardShortcuts", () => {
  beforeEach(() => {
    localStorageMock.clear();
    customBindings.set({});
  });

  describe("defaultShortcuts", () => {
    it("should have all required shortcut definitions", () => {
      expect(defaultShortcuts.length).toBeGreaterThan(0);

      // Check that each shortcut has required fields
      for (const shortcut of defaultShortcuts) {
        expect(shortcut.action).toBeDefined();
        expect(shortcut.defaultKey).toBeDefined();
        expect(shortcut.description).toBeDefined();
        expect(shortcut.category).toBeDefined();
      }
    });

    it("should have unique actions", () => {
      const actions = defaultShortcuts.map((s) => s.action);
      const uniqueActions = new Set(actions);
      expect(uniqueActions.size).toBe(actions.length);
    });
  });

  describe("loadCustomBindings", () => {
    it("should load empty bindings when localStorage is empty", () => {
      loadCustomBindings();
      expect(get(customBindings)).toEqual({});
    });

    it("should load custom bindings from localStorage", () => {
      const bindings = { navigate_down: "n", archive: "d" };
      localStorageMock.setItem(
        "settings.keyboardShortcuts",
        JSON.stringify(bindings)
      );

      loadCustomBindings();
      expect(get(customBindings)).toEqual(bindings);
    });

    it("should handle invalid JSON in localStorage", () => {
      localStorageMock.setItem("settings.keyboardShortcuts", "invalid json");

      // Should not throw
      loadCustomBindings();
      expect(get(customBindings)).toEqual({});
    });
  });

  describe("getKeyForAction", () => {
    it("should return default key when no custom binding", () => {
      const key = getKeyForAction("navigate_down");
      expect(key).toBe("j");
    });

    it("should return custom key when set", () => {
      customBindings.set({ navigate_down: "n" });
      const key = getKeyForAction("navigate_down");
      expect(key).toBe("n");
    });
  });

  describe("getActionForKey", () => {
    it("should return action for default key", () => {
      const action = getActionForKey("j");
      expect(action).toBe("navigate_down");
    });

    it("should return action for custom key", () => {
      customBindings.set({ navigate_down: "n" });
      const action = getActionForKey("n");
      expect(action).toBe("navigate_down");
    });

    it("should return null for unbound key", () => {
      const action = getActionForKey("z");
      expect(action).toBeNull();
    });
  });

  describe("setBinding", () => {
    it("should set a new binding successfully", () => {
      const result = setBinding("navigate_down", "n");
      expect(result.success).toBe(true);
      expect(get(customBindings)).toEqual({ navigate_down: "n" });
    });

    it("should detect conflicts with existing bindings", () => {
      const result = setBinding("navigate_down", "k"); // k is navigate_up
      expect(result.success).toBe(false);
      expect(result.conflict).toBe("navigate_up");
    });

    it("should remove custom binding when setting back to default", () => {
      customBindings.set({ navigate_down: "n" });
      const result = setBinding("navigate_down", "j"); // j is the default
      expect(result.success).toBe(true);
      expect(get(customBindings)).toEqual({});
    });

    it("should save to localStorage", () => {
      setBinding("navigate_down", "n");
      const stored = localStorageMock.getItem("settings.keyboardShortcuts");
      expect(stored).toBe(JSON.stringify({ navigate_down: "n" }));
    });
  });

  describe("resetBinding", () => {
    it("should reset a custom binding", () => {
      customBindings.set({ navigate_down: "n", archive: "d" });
      resetBinding("navigate_down");
      expect(get(customBindings)).toEqual({ archive: "d" });
    });
  });

  describe("resetAllBindings", () => {
    it("should reset all custom bindings", () => {
      customBindings.set({ navigate_down: "n", archive: "d" });
      resetAllBindings();
      expect(get(customBindings)).toEqual({});
    });
  });

  describe("hasCustomBindings", () => {
    it("should return false when no custom bindings", () => {
      expect(hasCustomBindings()).toBe(false);
    });

    it("should return true when custom bindings exist", () => {
      customBindings.set({ navigate_down: "n" });
      expect(hasCustomBindings()).toBe(true);
    });
  });

  describe("getShortcutsByCategory", () => {
    it("should return shortcuts grouped by category", () => {
      const groups = getShortcutsByCategory();

      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.category).toBeDefined();
        expect(group.shortcuts).toBeDefined();
        expect(group.shortcuts.length).toBeGreaterThan(0);
      }
    });

    it("should mark custom bindings", () => {
      customBindings.set({ navigate_down: "n" });
      const groups = getShortcutsByCategory();

      const navigationGroup = groups.find((g) => g.category === "Navigation");
      expect(navigationGroup).toBeDefined();

      const navigateDown = navigationGroup!.shortcuts.find(
        (s) => s.action === "navigate_down"
      );
      expect(navigateDown).toBeDefined();
      expect(navigateDown!.isCustom).toBe(true);
      expect(navigateDown!.key).toBe("n");
    });
  });

  describe("formatKeyForDisplay", () => {
    it("should format space key", () => {
      expect(formatKeyForDisplay(" ")).toBe("Space");
    });

    it("should format shift+space", () => {
      expect(formatKeyForDisplay("Shift+ ")).toBe("Shift + Space");
    });

    it("should format two-key sequences", () => {
      expect(formatKeyForDisplay("gi")).toBe("g i");
    });

    it("should format modifier combinations", () => {
      expect(formatKeyForDisplay("Cmd+k")).toBe("Cmd + K");
      expect(formatKeyForDisplay("Shift+r")).toBe("Shift + R");
    });

    it("should uppercase single keys", () => {
      expect(formatKeyForDisplay("j")).toBe("J");
    });
  });

  describe("parseKeyEvent", () => {
    function createKeyEvent(
      key: string,
      opts: Partial<KeyboardEvent> = {}
    ): KeyboardEvent {
      return {
        key,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...opts,
      } as KeyboardEvent;
    }

    it("should parse regular keys", () => {
      expect(parseKeyEvent(createKeyEvent("j"))).toBe("j");
    });

    it("should ignore standalone modifier keys", () => {
      expect(parseKeyEvent(createKeyEvent("Shift"))).toBe("");
      expect(parseKeyEvent(createKeyEvent("Control"))).toBe("");
      expect(parseKeyEvent(createKeyEvent("Meta"))).toBe("");
    });

    it("should handle shift+letter", () => {
      expect(
        parseKeyEvent(createKeyEvent("R", { shiftKey: true }))
      ).toBe("Shift+r");
    });

    it("should handle cmd+letter", () => {
      expect(parseKeyEvent(createKeyEvent("k", { metaKey: true }))).toBe(
        "Cmd+k"
      );
    });

    it("should handle shift+space", () => {
      expect(parseKeyEvent(createKeyEvent(" ", { shiftKey: true }))).toBe(
        "Shift+ "
      );
    });
  });

  describe("buildKeyMaps", () => {
    it("should build handler and sequence maps", () => {
      const { handlers, sequences } = buildKeyMaps();

      // Check that regular handlers are present
      expect(handlers["j"]).toBe("navigate_down");
      expect(handlers["k"]).toBe("navigate_up");

      // Check that sequences are present
      expect(sequences["gi"]).toBe("go_inbox");
      expect(sequences["gs"]).toBe("go_starred");
    });

    it("should reflect custom bindings", () => {
      customBindings.set({ navigate_down: "n" });
      const { handlers } = buildKeyMaps();

      expect(handlers["n"]).toBe("navigate_down");
      // j should no longer be navigate_down
      expect(handlers["j"]).toBeUndefined();
    });
  });
});
