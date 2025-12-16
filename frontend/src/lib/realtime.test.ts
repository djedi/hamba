import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

// Mock WebSocket class
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  });

  // Track all instances
  static instances: MockWebSocket[] = [];

  // Helper to simulate connection events
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  simulateError(error: Error) {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  simulateMessage(data: object) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  static clearInstances() {
    MockWebSocket.instances = [];
  }

  static getLatest(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

describe("realtime module", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.clearInstances();

    // Save and replace WebSocket
    originalWebSocket = global.WebSocket;
    (global as any).WebSocket = MockWebSocket;
  });

  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
  });

  describe("connectionState store", () => {
    it("starts as disconnected", async () => {
      const { connectionState } = await import("./realtime");
      expect(get(connectionState)).toBe("disconnected");
    });

    it("changes to connecting when connect() is called", async () => {
      const { connect, connectionState } = await import("./realtime");

      connect();

      expect(get(connectionState)).toBe("connecting");
    });

    it("changes to connected when WebSocket opens", async () => {
      const { connect, connectionState } = await import("./realtime");

      connect();
      expect(get(connectionState)).toBe("connecting");

      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      expect(get(connectionState)).toBe("connected");
    });

    it("changes to disconnected when WebSocket closes", async () => {
      const { connect, connectionState } = await import("./realtime");

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();
      expect(get(connectionState)).toBe("connected");

      mockWs.simulateClose();
      expect(get(connectionState)).toBe("disconnected");
    });
  });

  describe("reconnect with exponential backoff", () => {
    it("schedules reconnect after disconnect", async () => {
      const { connect, connectionState, reconnectAttempt } = await import(
        "./realtime"
      );

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();
      mockWs.simulateClose();

      expect(get(connectionState)).toBe("disconnected");
      expect(get(reconnectAttempt)).toBe(1);

      // Advance timer to trigger reconnect (1 second initial delay)
      vi.advanceTimersByTime(1000);

      // Should be in connecting state (attempting to reconnect)
      expect(get(connectionState)).toBe("connecting");
      // A new WebSocket should have been created
      expect(MockWebSocket.instances.length).toBe(2);
    });

    it("resets backoff on successful connection", async () => {
      const { connect, reconnectAttempt } = await import("./realtime");

      connect();
      let mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();
      mockWs.simulateClose();

      expect(get(reconnectAttempt)).toBe(1);

      // Wait for first reconnect
      vi.advanceTimersByTime(1000);
      mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      expect(get(reconnectAttempt)).toBe(0);
    });
  });

  describe("subscribe", () => {
    it("sends subscription message when connected", async () => {
      const { connect, subscribe } = await import("./realtime");

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      subscribe("account-1");

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "subscribe", accountId: "account-1" })
      );
    });

    it("re-subscribes after reconnect", async () => {
      const { connect, subscribe } = await import("./realtime");

      connect();
      let mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      subscribe("account-1");
      mockWs.send.mockClear();

      // Disconnect and reconnect
      mockWs.simulateClose();
      vi.advanceTimersByTime(1000);
      mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      // Should have re-subscribed
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "subscribe", accountId: "account-1" })
      );
    });
  });

  describe("reconnectNow", () => {
    it("immediately triggers reconnection", async () => {
      const { connect, reconnectNow, connectionState } = await import(
        "./realtime"
      );

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();
      mockWs.simulateClose();

      // Call reconnectNow instead of waiting
      reconnectNow();

      expect(get(connectionState)).toBe("connecting");
    });

    it("resets reconnect attempt counter", async () => {
      const { connect, reconnectAttempt, reconnectNow } = await import(
        "./realtime"
      );

      connect();
      let mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      // Build up reconnect attempts
      mockWs.simulateClose();
      expect(get(reconnectAttempt)).toBe(1);

      // Call reconnectNow to reset
      reconnectNow();
      expect(get(reconnectAttempt)).toBe(0);
    });
  });

  describe("disconnect", () => {
    it("closes WebSocket and resets state", async () => {
      const { connect, disconnect, connectionState, reconnectAttempt } =
        await import("./realtime");

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      disconnect();

      expect(mockWs.close).toHaveBeenCalled();
      expect(get(connectionState)).toBe("disconnected");
      expect(get(reconnectAttempt)).toBe(0);
    });

    it("clears pending reconnect timeout", async () => {
      const { connect, disconnect, connectionState } = await import(
        "./realtime"
      );

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();
      mockWs.simulateClose();

      // A reconnect is scheduled
      const instanceCount = MockWebSocket.instances.length;
      disconnect();

      // Advance past reconnect time - should NOT reconnect
      vi.advanceTimersByTime(5000);

      // No new WebSocket should have been created
      expect(MockWebSocket.instances.length).toBe(instanceCount);
      expect(get(connectionState)).toBe("disconnected");
    });
  });

  describe("onMessage", () => {
    it("calls handlers when message received", async () => {
      const { connect, onMessage } = await import("./realtime");
      const handler = vi.fn();

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      onMessage(handler);

      mockWs.simulateMessage({ type: "new_mail", accountId: "123" });

      expect(handler).toHaveBeenCalledWith({
        type: "new_mail",
        accountId: "123",
      });
    });

    it("returns unsubscribe function", async () => {
      const { connect, onMessage } = await import("./realtime");
      const handler = vi.fn();

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      const unsubscribe = onMessage(handler);
      unsubscribe();

      mockWs.simulateMessage({ type: "test" });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("isConnected", () => {
    it("returns true when WebSocket is open", async () => {
      const { connect, isConnected } = await import("./realtime");

      connect();
      const mockWs = MockWebSocket.getLatest()!;
      mockWs.simulateOpen();

      expect(isConnected()).toBe(true);
    });

    it("returns false when WebSocket is not open", async () => {
      const { isConnected } = await import("./realtime");

      expect(isConnected()).toBe(false);
    });
  });
});
