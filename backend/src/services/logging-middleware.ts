/**
 * Elysia middleware for request/response logging and error handling.
 * Integrates with the structured logger for consistent logging across all routes.
 */

import { Elysia } from "elysia";
import {
  logger,
  metrics,
  errorTracking,
  generateRequestId,
  type RequestContext,
} from "./logger";

/**
 * Extract relevant headers from request
 */
function getRequestHeaders(headers: Headers): Record<string, string> {
  const relevant: Record<string, string> = {};
  const include = ["user-agent", "content-type", "accept", "x-request-id"];
  for (const key of include) {
    const value = headers.get(key);
    if (value) {
      relevant[key] = value;
    }
  }
  return relevant;
}

/**
 * Logging middleware plugin for Elysia
 * Provides:
 * - Request/response logging
 * - Request timing metrics
 * - Error tracking
 * - Request ID generation
 */
export const loggingMiddleware = new Elysia({ name: "logging" })
  .derive(({ request, headers }) => {
    // Generate or use existing request ID
    const requestId = headers["x-request-id"] || generateRequestId();
    const startTime = performance.now();

    const ctx: RequestContext = {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      userAgent: headers["user-agent"],
    };

    return {
      requestId,
      requestContext: ctx,
      startTime,
    };
  })
  .onRequest(({ request, requestId, requestContext }) => {
    // Log incoming request (debug level to avoid noise)
    logger.debug("Request received", {
      requestId,
      method: requestContext.method,
      path: requestContext.path,
      userAgent: requestContext.userAgent,
    });
  })
  .onAfterResponse(({ request, requestId, requestContext, startTime, response, set }) => {
    const duration = performance.now() - startTime;
    const statusCode = set.status || 200;

    // Record timing metric
    metrics.timing("http.request", duration, {
      method: requestContext.method,
      path: requestContext.path,
      status: String(statusCode),
    });

    // Log response
    const logData = {
      requestId,
      method: requestContext.method,
      path: requestContext.path,
      status: statusCode,
      duration: Math.round(duration),
    };

    // Use appropriate log level based on status
    if (statusCode >= 500) {
      logger.error("Request completed with error", logData);
    } else if (statusCode >= 400) {
      logger.warn("Request completed with client error", logData);
    } else if (duration > 1000) {
      logger.warn("Slow request", logData);
    } else {
      logger.info("Request completed", logData);
    }
  })
  .onError(({ error, request, requestId, requestContext, set }) => {
    // Capture the error
    errorTracking.captureException(error as Error, {
      requestId,
      method: requestContext?.method,
      path: requestContext?.path,
    });

    // Log the error
    logger.error("Unhandled error in request", error as Error, {
      requestId,
      method: requestContext?.method,
      path: requestContext?.path,
    });

    // Return a clean error response
    set.status = 500;
    return {
      error: "Internal server error",
      requestId,
    };
  });

/**
 * Metrics endpoint plugin for Elysia
 * Exposes /metrics and /health/detailed endpoints
 */
export const metricsEndpoints = new Elysia({ name: "metrics-endpoints" })
  .get("/metrics", () => {
    return {
      timestamp: new Date().toISOString(),
      aggregated: metrics.getAggregatedMetrics(),
      recent: metrics.getRecentMetrics(50),
    };
  }, {
    detail: {
      tags: ["Health"],
      summary: "Get performance metrics",
      description: "Returns aggregated and recent performance metrics for monitoring",
    },
  })
  .get("/health/detailed", () => {
    const aggregatedMetrics = metrics.getAggregatedMetrics();
    const httpMetrics = aggregatedMetrics["http.request"];
    const errorCounts = errorTracking.getErrorCounts();

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      metrics: {
        totalRequests: httpMetrics?.count || 0,
        avgResponseTime: httpMetrics?.avgDuration || 0,
        maxResponseTime: httpMetrics?.maxDuration || 0,
      },
      errors: {
        recentCount: errorTracking.getRecentErrors(100).length,
        byType: errorCounts,
      },
    };
  }, {
    detail: {
      tags: ["Health"],
      summary: "Detailed health check",
      description: "Returns detailed health information including memory usage, metrics, and error counts",
    },
  })
  .get("/errors/recent", () => {
    const errors = errorTracking.getRecentErrors(50);
    return {
      count: errors.length,
      errors: errors.map((e) => ({
        timestamp: e.timestamp,
        error: e.error.name,
        message: e.error.message,
        context: e.context,
      })),
    };
  }, {
    detail: {
      tags: ["Health"],
      summary: "Recent errors",
      description: "Returns recent errors for debugging. Useful for monitoring and alerting.",
    },
  });
