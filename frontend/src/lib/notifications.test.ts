import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  playNotificationSound,
  shouldNotify,
  showNewMailNotification,
  getNotificationStatus,
  _resetAudioContext,
} from "./notifications";

describe("notifications module", () => {
  let originalNotification: typeof Notification;
  let originalAudioContext: typeof AudioContext;
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    // Mock localStorage
    mockLocalStorage = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key: string) => mockLocalStorage[key] ?? null
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      (key: string, value: string) => {
        mockLocalStorage[key] = value;
      }
    );

    // Save originals
    originalNotification = globalThis.Notification;
    originalAudioContext = globalThis.AudioContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.Notification = originalNotification;
    globalThis.AudioContext = originalAudioContext;
    _resetAudioContext();
  });

  describe("shouldNotify", () => {
    it("returns false when notifications are disabled", () => {
      mockLocalStorage["settings.notifications"] = "false";

      // Mock Notification with granted permission
      (globalThis as any).Notification = { permission: "granted" };

      expect(shouldNotify()).toBe(false);
    });

    it("returns false when permission is not granted", () => {
      mockLocalStorage["settings.notifications"] = "true";

      // Mock Notification with denied permission
      (globalThis as any).Notification = { permission: "denied" };

      expect(shouldNotify()).toBe(false);
    });

    it("returns true when enabled and permission granted", () => {
      mockLocalStorage["settings.notifications"] = "true";

      // Mock Notification with granted permission
      (globalThis as any).Notification = { permission: "granted" };

      expect(shouldNotify()).toBe(true);
    });

    it("returns false for non-important emails when important-only is set", () => {
      mockLocalStorage["settings.notifications"] = "true";
      mockLocalStorage["settings.notifyImportantOnly"] = "true";

      (globalThis as any).Notification = { permission: "granted" };

      expect(shouldNotify(false)).toBe(false);
    });

    it("returns true for important emails when important-only is set", () => {
      mockLocalStorage["settings.notifications"] = "true";
      mockLocalStorage["settings.notifyImportantOnly"] = "true";

      (globalThis as any).Notification = { permission: "granted" };

      expect(shouldNotify(true)).toBe(true);
    });

    it("returns false when Notification is undefined", () => {
      mockLocalStorage["settings.notifications"] = "true";

      (globalThis as any).Notification = undefined;

      expect(shouldNotify()).toBe(false);
    });
  });

  describe("getNotificationStatus", () => {
    it("returns unsupported when Notification is undefined", () => {
      (globalThis as any).Notification = undefined;

      const status = getNotificationStatus();
      expect(status.supported).toBe(false);
      expect(status.permission).toBe("unsupported");
      expect(status.enabled).toBe(false);
    });

    it("returns correct status when notifications are enabled and granted", () => {
      mockLocalStorage["settings.notifications"] = "true";
      (globalThis as any).Notification = { permission: "granted" };

      const status = getNotificationStatus();
      expect(status.supported).toBe(true);
      expect(status.permission).toBe("granted");
      expect(status.enabled).toBe(true);
    });

    it("returns enabled false when permission not granted", () => {
      mockLocalStorage["settings.notifications"] = "true";
      (globalThis as any).Notification = { permission: "denied" };

      const status = getNotificationStatus();
      expect(status.supported).toBe(true);
      expect(status.permission).toBe("denied");
      expect(status.enabled).toBe(false);
    });
  });

  describe("playNotificationSound", () => {
    it("does nothing when sound is disabled", () => {
      mockLocalStorage["settings.sound"] = "false";

      const mockContext = {
        state: "running",
        currentTime: 0,
        destination: {},
        resume: vi.fn(),
        createOscillator: vi.fn(),
        createGain: vi.fn(),
      };

      (globalThis as any).AudioContext = function () {
        return mockContext;
      };

      playNotificationSound();

      // AudioContext should not be created since sound is disabled
      expect(mockContext.createOscillator).not.toHaveBeenCalled();
    });

    it("creates oscillators when sound is enabled", () => {
      mockLocalStorage["settings.sound"] = "true";

      const mockGain = {
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      };

      const mockOscillator = {
        connect: vi.fn(),
        type: "",
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      };

      const mockContext = {
        state: "running",
        currentTime: 0,
        destination: {},
        resume: vi.fn(),
        createOscillator: vi.fn(() => mockOscillator),
        createGain: vi.fn(() => mockGain),
      };

      (globalThis as any).AudioContext = function () {
        return mockContext;
      };

      playNotificationSound();

      expect(mockContext.createOscillator).toHaveBeenCalledTimes(2);
      expect(mockContext.createGain).toHaveBeenCalledTimes(2);
    });

    it("resumes suspended audio context", () => {
      mockLocalStorage["settings.sound"] = "true";

      const mockGain = {
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      };

      const mockOscillator = {
        connect: vi.fn(),
        type: "",
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      };

      const mockContext = {
        state: "suspended",
        currentTime: 0,
        destination: {},
        resume: vi.fn(),
        createOscillator: vi.fn(() => mockOscillator),
        createGain: vi.fn(() => mockGain),
      };

      (globalThis as any).AudioContext = function () {
        return mockContext;
      };

      playNotificationSound();

      expect(mockContext.resume).toHaveBeenCalled();
    });
  });

  describe("showNewMailNotification", () => {
    it("does not show notification when shouldNotify returns false", () => {
      mockLocalStorage["settings.notifications"] = "false";

      const mockNotification = vi.fn();
      (globalThis as any).Notification = mockNotification;
      (globalThis as any).Notification.permission = "granted";

      showNewMailNotification({
        from: "test@example.com",
        subject: "Test Subject",
      });

      expect(mockNotification).not.toHaveBeenCalled();
    });

    it("shows notification with correct options when enabled", () => {
      mockLocalStorage["settings.notifications"] = "true";
      mockLocalStorage["settings.sound"] = "false"; // Disable sound for simplicity

      const mockNotificationInstance = {
        close: vi.fn(),
        onclick: null as any,
      };

      const mockNotification = vi.fn(() => mockNotificationInstance);
      (mockNotification as any).permission = "granted";
      (globalThis as any).Notification = mockNotification;

      showNewMailNotification({
        from: "sender@example.com",
        subject: "Hello World",
      });

      expect(mockNotification).toHaveBeenCalledWith("sender@example.com", {
        body: "Hello World",
        icon: "/favicon-96x96.png",
        tag: "new-mail",
      });
    });

    it("uses (no subject) when subject is empty", () => {
      mockLocalStorage["settings.notifications"] = "true";
      mockLocalStorage["settings.sound"] = "false";

      const mockNotificationInstance = {
        close: vi.fn(),
        onclick: null as any,
      };

      const mockNotification = vi.fn(() => mockNotificationInstance);
      (mockNotification as any).permission = "granted";
      (globalThis as any).Notification = mockNotification;

      showNewMailNotification({
        from: "sender@example.com",
        subject: "",
      });

      expect(mockNotification).toHaveBeenCalledWith("sender@example.com", {
        body: "(no subject)",
        icon: "/favicon-96x96.png",
        tag: "new-mail",
      });
    });
  });
});
