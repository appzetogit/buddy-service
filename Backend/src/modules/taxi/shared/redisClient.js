/**
 * Redis access for the taxi module, on top of the platform's single Redis client
 * (config/redis.js). No second connection is opened; when the platform has Redis switched off
 * every command here reports `disabled` and the callers fall back to in-memory behaviour.
 */
import { getRedisClient as getPlatformRedisClient } from '../../../config/redis.js';
import { env } from './env.js';

const withTimeout = async (promise, timeoutMs, label = 'Redis command') => {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const isRedisEnabled = () => Boolean(env.redis.enabled && env.redis.url);

export const getRedisClient = () => (isRedisEnabled() ? getPlatformRedisClient() : null);

/** The platform connects at startup; this only hands back the client when it is usable. */
export const connectRedis = async () => {
  const client = getRedisClient();
  return client?.isReady ? client : null;
};

export const getRedisStatus = () => {
  const client = getRedisClient();
  return {
    enabled: isRedisEnabled(),
    configured: Boolean(env.redis.url),
    ready: Boolean(client?.isReady),
    open: Boolean(client?.isOpen),
  };
};

export const runRedisCommand = async (executor, { label = 'Redis command' } = {}) => {
  if (!isRedisEnabled()) {
    return { ok: false, reason: 'disabled', value: null };
  }

  try {
    const client = await connectRedis();
    if (!client?.isReady) {
      return { ok: false, reason: 'not_ready', value: null };
    }
    const value = await withTimeout(executor(client), env.redis.commandTimeoutMs, label);
    return { ok: true, reason: '', value };
  } catch (error) {
    return { ok: false, reason: error?.message || 'redis_error', value: null };
  }
};
