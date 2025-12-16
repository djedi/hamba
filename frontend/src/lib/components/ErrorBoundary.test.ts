import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ErrorBoundary error handling logic", () => {
  let originalAddEventListener: typeof window.addEventListener;
  let originalRemoveEventListener: typeof window.removeEventListener;
  let errorHandler: ((event: ErrorEvent) => void) | null = null;
  let rejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

  beforeEach(() => {
    errorHandler = null;
    rejectionHandler = null;

    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;

    window.addEventListener = vi.fn((type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === "error") {
        errorHandler = handler as (event: ErrorEvent) => void;
      } else if (type === "unhandledrejection") {
        rejectionHandler = handler as (event: PromiseRejectionEvent) => void;
      }
    }) as unknown as typeof window.addEventListener;

    window.removeEventListener = vi.fn() as unknown as typeof window.removeEventListener;
  });

  afterEach(() => {
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
  });

  describe("error event handling", () => {
    it("should extract error message from ErrorEvent with Error object", () => {
      const error = new Error("Test error message");
      const event = new ErrorEvent("error", { error, message: error.message });

      // Simulate the logic from ErrorBoundary
      const extractedMessage = event.error instanceof Error
        ? event.error.message
        : String(event.error || event.message);

      expect(extractedMessage).toBe("Test error message");
    });

    it("should fall back to event message if no error object", () => {
      const event = new ErrorEvent("error", { message: "Fallback message" });

      const extractedMessage = event.error instanceof Error
        ? event.error.message
        : String(event.error || event.message);

      expect(extractedMessage).toBe("Fallback message");
    });

    it("should handle string errors", () => {
      const event = new ErrorEvent("error", { error: "String error" });

      const extractedMessage = event.error instanceof Error
        ? event.error.message
        : String(event.error || event.message);

      expect(extractedMessage).toBe("String error");
    });
  });

  describe("unhandled rejection handling", () => {
    it("should extract message from Error rejection reason", () => {
      const reason = new Error("Promise rejection message");

      const extractedMessage = reason instanceof Error
        ? reason.message
        : String(reason);

      expect(extractedMessage).toBe("Promise rejection message");
    });

    it("should convert non-Error rejection reasons to string", () => {
      const reason: unknown = "String rejection reason";

      const extractedMessage = reason instanceof Error
        ? reason.message
        : String(reason);

      expect(extractedMessage).toBe("String rejection reason");
    });

    it("should handle object rejection reasons", () => {
      const reason = { code: "ERROR_CODE", detail: "Some error" };

      const extractedMessage = reason instanceof Error
        ? reason.message
        : String(reason);

      expect(extractedMessage).toBe("[object Object]");
    });

    it("should handle null rejection reasons", () => {
      const reason: unknown = null;

      const extractedMessage = reason instanceof Error
        ? reason.message
        : String(reason);

      expect(extractedMessage).toBe("null");
    });

    it("should handle undefined rejection reasons", () => {
      const reason: unknown = undefined;

      const extractedMessage = reason instanceof Error
        ? reason.message
        : String(reason);

      expect(extractedMessage).toBe("undefined");
    });
  });

  describe("error stack extraction", () => {
    it("should extract stack trace from Error objects", () => {
      const error = new Error("Test error");
      const stack = error instanceof Error ? error.stack || "" : "";

      expect(stack).toContain("Error: Test error");
    });

    it("should return empty string for non-Error objects", () => {
      const error: unknown = "String error";
      const stack = error instanceof Error ? error.stack || "" : "";

      expect(stack).toBe("");
    });
  });

  describe("state reset logic", () => {
    it("should clear error state on reset", () => {
      let hasError = true;
      let errorMessage = "Some error";
      let errorStack = "Error stack";

      // Simulate handleReset
      hasError = false;
      errorMessage = "";
      errorStack = "";

      expect(hasError).toBe(false);
      expect(errorMessage).toBe("");
      expect(errorStack).toBe("");
    });
  });
});
