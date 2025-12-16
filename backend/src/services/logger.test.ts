import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  logger,
  metrics,
  errorTracking,
  configureLogger,
  getLoggerConfig,
  generateRequestId,
  createRequestLogger,
} from "./logger";

describe("logger", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Reset config to defaults
    configureLogger({ level: "info", json: false });
    // Spy on console methods
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    // Reset metrics and errors
    metrics.reset();
    errorTracking.reset();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe("log levels", () => {
    it("should log info messages at info level", () => {
      logger.info("test message");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should log warn messages at info level", () => {
      logger.warn("test warning");
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it("should log error messages at info level", () => {
      logger.error("test error");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("should not log debug messages at info level", () => {
      logger.debug("debug message");
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should log debug messages at debug level", () => {
      configureLogger({ level: "debug" });
      logger.debug("debug message");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should only log errors at error level", () => {
      configureLogger({ level: "error" });
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe("context", () => {
    it("should include context in log messages", () => {
      logger.info("test message", { userId: "123", action: "login" });
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain("userId=123");
      expect(output).toContain("action=login");
    });

    it("should handle object context values", () => {
      logger.info("test message", { data: { nested: true } });
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('data={"nested":true}');
    });
  });

  describe("error logging", () => {
    it("should log error name and message", () => {
      const error = new Error("Something went wrong");
      logger.error("Operation failed", error);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain("Error: Error: Something went wrong");
    });

    it("should track errors for monitoring", () => {
      const error = new Error("Test error");
      logger.error("Operation failed", error);
      const errors = errorTracking.getRecentErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].error.message).toBe("Test error");
    });
  });

  describe("child logger", () => {
    it("should create a child logger with default context", () => {
      const childLogger = logger.child({ service: "auth" });
      childLogger.info("user logged in", { userId: "123" });
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain("service=auth");
      expect(output).toContain("userId=123");
    });
  });

  describe("JSON format", () => {
    it("should output JSON when json mode is enabled", () => {
      configureLogger({ json: true });
      logger.info("test message", { key: "value" });
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.message).toBe("test message");
      expect(parsed.level).toBe("info");
      expect(parsed.context.key).toBe("value");
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should get current config", () => {
      const config = getLoggerConfig();
      expect(config.level).toBe("info");
      expect(config.json).toBe(false);
    });

    it("should update config", () => {
      configureLogger({ level: "warn", json: true });
      const config = getLoggerConfig();
      expect(config.level).toBe("warn");
      expect(config.json).toBe(true);
    });
  });
});

describe("metrics", () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe("timing", () => {
    it("should record timing metrics", () => {
      metrics.timing("db.query", 100);
      metrics.timing("db.query", 200);
      const aggregated = metrics.getAggregatedMetrics();
      expect(aggregated["db.query"]).toBeDefined();
      expect(aggregated["db.query"].count).toBe(2);
      expect(aggregated["db.query"].avgDuration).toBe(150);
      expect(aggregated["db.query"].minDuration).toBe(100);
      expect(aggregated["db.query"].maxDuration).toBe(200);
    });

    it("should store recent metrics", () => {
      metrics.timing("api.request", 50, { endpoint: "/health" });
      const recent = metrics.getRecentMetrics();
      expect(recent.length).toBe(1);
      expect(recent[0].name).toBe("api.request");
      expect(recent[0].duration).toBe(50);
      expect(recent[0].tags?.endpoint).toBe("/health");
    });
  });

  describe("measure", () => {
    it("should measure async function duration", async () => {
      const result = await metrics.measure("async.operation", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      });
      expect(result).toBe("done");
      const aggregated = metrics.getAggregatedMetrics();
      expect(aggregated["async.operation"]).toBeDefined();
      expect(aggregated["async.operation"].avgDuration).toBeGreaterThanOrEqual(10);
    });

    it("should measure sync function duration", () => {
      const result = metrics.measureSync("sync.operation", () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        return sum;
      });
      expect(result).toBe(499500);
      const aggregated = metrics.getAggregatedMetrics();
      expect(aggregated["sync.operation"]).toBeDefined();
    });
  });

  describe("increment", () => {
    it("should increment counters", () => {
      metrics.increment("requests.total");
      metrics.increment("requests.total");
      metrics.increment("requests.total", 5);
      const aggregated = metrics.getAggregatedMetrics();
      expect(aggregated["requests.total"].count).toBe(7);
    });

    it("should handle tags in counters", () => {
      metrics.increment("requests.total", 1, { method: "GET" });
      metrics.increment("requests.total", 1, { method: "POST" });
      const aggregated = metrics.getAggregatedMetrics();
      expect(aggregated['requests.total:{"method":"GET"}'].count).toBe(1);
      expect(aggregated['requests.total:{"method":"POST"}'].count).toBe(1);
    });
  });

  describe("reset", () => {
    it("should clear all metrics", () => {
      metrics.timing("test", 100);
      metrics.increment("counter");
      metrics.reset();
      expect(metrics.getRecentMetrics().length).toBe(0);
      expect(Object.keys(metrics.getAggregatedMetrics()).length).toBe(0);
    });
  });
});

describe("errorTracking", () => {
  beforeEach(() => {
    errorTracking.reset();
  });

  describe("captureException", () => {
    it("should capture exceptions", () => {
      // Mock console.error to prevent output
      const spy = spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Test error");
      errorTracking.captureException(error, { userId: "123" });
      spy.mockRestore();
      const errors = errorTracking.getRecentErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].error.message).toBe("Test error");
      expect(errors[0].context?.userId).toBe("123");
    });
  });

  describe("getErrorCounts", () => {
    it("should count errors by fingerprint", () => {
      // Mock console.error to prevent output
      const spy = spyOn(console, "error").mockImplementation(() => {});
      errorTracking.captureException(new Error("Error A"));
      errorTracking.captureException(new Error("Error A"));
      errorTracking.captureException(new Error("Error B"));
      spy.mockRestore();
      const counts = errorTracking.getErrorCounts();
      expect(counts["Error:Error A"]).toBe(2);
      expect(counts["Error:Error B"]).toBe(1);
    });
  });

  describe("reset", () => {
    it("should clear error buffer", () => {
      const spy = spyOn(console, "error").mockImplementation(() => {});
      errorTracking.captureException(new Error("Test"));
      errorTracking.reset();
      spy.mockRestore();
      expect(errorTracking.getRecentErrors().length).toBe(0);
    });
  });
});

describe("request utilities", () => {
  beforeEach(() => {
    // Ensure logger is configured with info level (non-json for easier testing)
    configureLogger({ level: "info", json: false });
  });

  describe("generateRequestId", () => {
    it("should generate unique request IDs", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^req_[a-z0-9]+_[a-z0-9]+$/);
    });
  });

  describe("createRequestLogger", () => {
    it("should create a request-scoped logger", () => {
      const spy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const reqLogger = createRequestLogger({
          requestId: "req_123",
          method: "GET",
          path: "/api/test",
        });
        reqLogger.info("Processing request");
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls[0][0];
        expect(output).toContain("requestId=req_123");
        expect(output).toContain("method=GET");
        expect(output).toContain("path=/api/test");
      } finally {
        spy.mockRestore();
      }
    });
  });
});
