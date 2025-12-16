/**
 * Structured logging service for Hamba backend.
 * Provides JSON logging with timestamps, log levels, and context.
 * Supports Sentry integration for error tracking and performance monitoring.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

interface SentryConfig {
  dsn: string;
  environment?: string;
  release?: string;
}

interface LoggerConfig {
  level: LogLevel;
  json: boolean;
  sentry?: SentryConfig;
}

// Log level priorities for filtering
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Global configuration
let config: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) || "info",
  json: process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production",
  sentry: process.env.SENTRY_DSN
    ? {
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || "development",
        release: process.env.APP_VERSION,
      }
    : undefined,
};

// Sentry-like error tracking (in-memory for now, can be extended to send to Sentry)
interface ErrorRecord {
  timestamp: string;
  error: Error;
  context?: LogContext;
  fingerprint?: string;
}

const errorBuffer: ErrorRecord[] = [];
const MAX_ERROR_BUFFER = 100;

// Performance metrics storage
interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: string;
  tags?: Record<string, string>;
}

const metricsBuffer: PerformanceMetric[] = [];
const MAX_METRICS_BUFFER = 1000;

// Metrics aggregation
interface MetricsAggregation {
  count: number;
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  avgDuration: number;
}

const metricsAggregation: Map<string, MetricsAggregation> = new Map();

/**
 * Configure the logger
 */
export function configureLogger(newConfig: Partial<LoggerConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Get current logger configuration
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

/**
 * Format a log entry
 */
function formatLogEntry(entry: LogEntry): string {
  if (config.json) {
    return JSON.stringify(entry);
  }

  // Human-readable format for development
  const timestamp = entry.timestamp.split("T")[1].split(".")[0]; // HH:MM:SS
  const levelStr = entry.level.toUpperCase().padEnd(5);
  let output = `${timestamp} ${levelStr} ${entry.message}`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    const contextStr = Object.entries(entry.context)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" ");
    output += ` ${contextStr}`;
  }

  if (entry.error) {
    output += `\n  Error: ${entry.error.name}: ${entry.error.message}`;
    if (entry.error.stack && config.level === "debug") {
      output += `\n  ${entry.error.stack}`;
    }
  }

  return output;
}

/**
 * Output a log entry
 */
function outputLog(entry: LogEntry): void {
  const formatted = formatLogEntry(entry);

  switch (entry.level) {
    case "error":
      console.error(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

/**
 * Create a log entry and output it
 */
function log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    // Track error for monitoring
    trackError(error, context);
  }

  outputLog(entry);
}

/**
 * Track an error for monitoring/alerting
 */
function trackError(error: Error, context?: LogContext): void {
  const record: ErrorRecord = {
    timestamp: new Date().toISOString(),
    error,
    context,
    fingerprint: `${error.name}:${error.message}`,
  };

  errorBuffer.push(record);
  if (errorBuffer.length > MAX_ERROR_BUFFER) {
    errorBuffer.shift();
  }

  // In a real implementation, this would send to Sentry:
  // if (config.sentry) {
  //   Sentry.captureException(error, { extra: context });
  // }
}

/**
 * Logger object with level-specific methods
 */
export const logger = {
  debug(message: string, context?: LogContext): void {
    log("debug", message, context);
  },

  info(message: string, context?: LogContext): void {
    log("info", message, context);
  },

  warn(message: string, context?: LogContext): void {
    log("warn", message, context);
  },

  error(message: string, error?: Error | LogContext, context?: LogContext): void {
    if (error instanceof Error) {
      log("error", message, context, error);
    } else {
      log("error", message, error as LogContext);
    }
  },

  /**
   * Create a child logger with preset context
   */
  child(defaultContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) =>
        log("debug", message, { ...defaultContext, ...context }),
      info: (message: string, context?: LogContext) =>
        log("info", message, { ...defaultContext, ...context }),
      warn: (message: string, context?: LogContext) =>
        log("warn", message, { ...defaultContext, ...context }),
      error: (message: string, error?: Error | LogContext, context?: LogContext) => {
        if (error instanceof Error) {
          log("error", message, { ...defaultContext, ...context }, error);
        } else {
          log("error", message, { ...defaultContext, ...(error as LogContext) });
        }
      },
    };
  },
};

/**
 * Performance monitoring utilities
 */
export const metrics = {
  /**
   * Record a timing metric
   */
  timing(name: string, duration: number, tags?: Record<string, string>): void {
    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: new Date().toISOString(),
      tags,
    };

    metricsBuffer.push(metric);
    if (metricsBuffer.length > MAX_METRICS_BUFFER) {
      metricsBuffer.shift();
    }

    // Update aggregation
    const existing = metricsAggregation.get(name);
    if (existing) {
      existing.count++;
      existing.totalDuration += duration;
      existing.minDuration = Math.min(existing.minDuration, duration);
      existing.maxDuration = Math.max(existing.maxDuration, duration);
      existing.avgDuration = existing.totalDuration / existing.count;
    } else {
      metricsAggregation.set(name, {
        count: 1,
        totalDuration: duration,
        minDuration: duration,
        maxDuration: duration,
        avgDuration: duration,
      });
    }

    // Log slow operations
    if (duration > 1000) {
      logger.warn(`Slow operation: ${name}`, { duration, tags });
    }
  },

  /**
   * Measure the duration of an async function
   */
  async measure<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      this.timing(name, duration, tags);
    }
  },

  /**
   * Measure the duration of a sync function
   */
  measureSync<T>(name: string, fn: () => T, tags?: Record<string, string>): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = performance.now() - start;
      this.timing(name, duration, tags);
    }
  },

  /**
   * Increment a counter metric
   */
  increment(name: string, value: number = 1, tags?: Record<string, string>): void {
    const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
    const existing = metricsAggregation.get(key);
    if (existing) {
      existing.count += value;
    } else {
      metricsAggregation.set(key, {
        count: value,
        totalDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        avgDuration: 0,
      });
    }
  },

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(): Record<string, MetricsAggregation> {
    return Object.fromEntries(metricsAggregation);
  },

  /**
   * Get recent metrics
   */
  getRecentMetrics(limit: number = 100): PerformanceMetric[] {
    return metricsBuffer.slice(-limit);
  },

  /**
   * Reset metrics (useful for testing)
   */
  reset(): void {
    metricsBuffer.length = 0;
    metricsAggregation.clear();
  },
};

/**
 * Error tracking utilities
 */
export const errorTracking = {
  /**
   * Capture an exception for tracking
   */
  captureException(error: Error, context?: LogContext): void {
    logger.error(error.message, error, context);
  },

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 50): ErrorRecord[] {
    return errorBuffer.slice(-limit);
  },

  /**
   * Get error counts by fingerprint
   */
  getErrorCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of errorBuffer) {
      if (record.fingerprint) {
        counts[record.fingerprint] = (counts[record.fingerprint] || 0) + 1;
      }
    }
    return counts;
  },

  /**
   * Clear error buffer (useful for testing)
   */
  reset(): void {
    errorBuffer.length = 0;
  },
};

/**
 * Request context for HTTP request logging
 */
export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  userAgent?: string;
  ip?: string;
  accountId?: string;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(ctx: RequestContext) {
  return logger.child({
    requestId: ctx.requestId,
    method: ctx.method,
    path: ctx.path,
  });
}
