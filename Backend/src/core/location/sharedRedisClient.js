import Redis from "ioredis";

let _client = null;
let _lastSharedErrorLog = 0;
let _connectionAttempts = 0;

const REDIS_ERROR_LOG_INTERVAL_MS = () =>
  parseInt(process.env.REDIS_ERROR_LOG_INTERVAL_MS || "60000", 10);

/**
 * When false, no Redis connections are created: shared client is null and Bull
 * queues are no-op stubs (use MongoDB orderAutoCancelJob for timeouts).
 * 
 * In production mode (NODE_ENV=production), Redis is MANDATORY and this function
 * will throw an error if Redis is not properly configured.
 */
export function isRedisEnabled() {
  const d = process.env.REDIS_DISABLED;
  const e = process.env.REDIS_ENABLED;
  const isProduction = process.env.NODE_ENV === "production";

  // Default: disable Redis in Jest to avoid open handles + noisy retries.
  // Opt-in by setting REDIS_ENABLED=true.
  if (process.env.NODE_ENV === "test" && !(e === "true" || e === "1")) return false;
  if (d === "true" || d === "1") {
    if (isProduction) {
      throw new Error(
        "Redis cannot be disabled in production mode (NODE_ENV=production). " +
        "Redis is required for distributed operations, queues, and caching."
      );
    }
    return false;
  }
  if (e === "false" || e === "0") {
    if (isProduction) {
      throw new Error(
        "Redis is required in production mode (NODE_ENV=production). " +
        "Set REDIS_ENABLED=true or provide REDIS_URL/REDIS_HOST configuration."
      );
    }
    return false;
  }

  // In production, verify Redis configuration is present
  if (isProduction) {
    const hasConfig = !!(
      process.env.REDIS_URL ||
      process.env.REDIS_HOST ||
      e === "true" ||
      e === "1"
    );
    if (!hasConfig) {
      throw new Error(
        "Redis is required in production mode (NODE_ENV=production). " +
        "Please set REDIS_URL or REDIS_HOST environment variable."
      );
    }
  }

  return true;
}

/**
 * Single error handler so ioredis does not emit "Unhandled error event" when
 * Redis is down; logs are rate-limited.
 */
function attachRedisErrorHandler(client) {
  if (!client || client.__sharedRedisErrorHandler) return;
  client.__sharedRedisErrorHandler = true;

  client.on("connect", () => {
    _connectionAttempts = 0;
  });

  client.on("ready", () => {
    // suppress per-connection ready noise
  });

  client.on("error", (err) => {
    const now = Date.now();
    const interval = REDIS_ERROR_LOG_INTERVAL_MS();
    if (now - _lastSharedErrorLog > interval) {
      _lastSharedErrorLog = now;
      const isProduction = process.env.NODE_ENV === "production";
      const message = isProduction
        ? `[Redis] ERROR: ${err?.code || err?.message || String(err)} - Redis is required in production`
        : `[Redis] ${err?.code || err?.message || String(err)} — set REDIS_DISABLED=true to run without Redis.`;
      console.warn(message);
    }
  });

  client.on("close", () => {
    // suppress close noise
  });

  client.on("reconnecting", () => {
    _connectionAttempts++;
  });
}

function standaloneOptions() {
  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times > 20) return null;
      return Math.min(times * 200, 3000);
    },
  };
}

function urlOptions() {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times > 20) return null;
      return Math.min(times * 200, 3000);
    },
  };
}

/**
 * Shared Redis client for caching / rate limits (optional).
 * Returns null when REDIS_DISABLED=true.
 */
export function getRedisClient() {
  if (!isRedisEnabled()) return null;
  if (_client) return _client;

  const url = process.env.REDIS_URL;
  _client = url
    ? new Redis(url, urlOptions())
    : new Redis(standaloneOptions());

  attachRedisErrorHandler(_client);
  return _client;
}
