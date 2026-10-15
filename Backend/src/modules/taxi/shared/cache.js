import { runRedisCommand } from './redisClient.js';

const localCache = new Map();
const inflightLoads = new Map();

const nowMs = () => Date.now();

const readLocalEntry = (key) => {
  const entry = localCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= nowMs()) {
    localCache.delete(key);
    return null;
  }

  return entry;
};

const writeLocalEntry = (key, value, ttlMs) => {
  localCache.set(key, {
    value,
    expiresAt: nowMs() + Math.max(1, Number(ttlMs) || 1),
  });
};

const serializeCachePayload = (value) => JSON.stringify({ value });

const deserializeCachePayload = (rawValue) => {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed?.value;
  } catch {
    return null;
  }
};

export const invalidateCachedValue = async (key) => {
  localCache.delete(key);

  await runRedisCommand(
    async (client) => client.del(key),
    { label: `cache invalidate ${key}` },
  ).catch(() => null);
};

/**
 * Drops every key beginning with `prefix`, from both the in-process map and
 * Redis. Needed because cache keys embed the request query, so one logical list
 * ("app modules") spans many keys and a single-key invalidation would leave the
 * others stale.
 */
export const invalidateCachedPrefix = async (prefix) => {
  if (!prefix) return;

  for (const key of [...localCache.keys()]) {
    if (key.startsWith(prefix)) {
      localCache.delete(key);
    }
  }

  await runRedisCommand(
    async (client) => {
      // SCAN rather than KEYS: KEYS blocks the server, and this Redis is shared
      // with other projects on the box.
      let cursor = 0;
      do {
        const res = await client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 200 });
        cursor = Number(res.cursor ?? res[0] ?? 0);
        const found = res.keys ?? res[1] ?? [];
        if (found.length) await client.del(found);
      } while (cursor !== 0);
      return true;
    },
    { label: `cache invalidate prefix ${prefix}` },
  ).catch(() => null);
};

export const getOrLoadCachedValue = async (
  key,
  {
    ttlMs = 30_000,
    load,
  } = {},
) => {
  if (!key || typeof load !== 'function') {
    throw new Error('getOrLoadCachedValue requires key and load');
  }

  const localEntry = readLocalEntry(key);
  if (localEntry) {
    return localEntry.value;
  }

  const redisResult = await runRedisCommand(
    async (client) => client.get(key),
    { label: `cache get ${key}` },
  );
  if (redisResult.ok && typeof redisResult.value === 'string') {
    const cachedValue = deserializeCachePayload(redisResult.value);
    writeLocalEntry(key, cachedValue, ttlMs);
    return cachedValue;
  }

  if (inflightLoads.has(key)) {
    return inflightLoads.get(key);
  }

  const loadPromise = Promise.resolve()
    .then(load)
    .then(async (value) => {
      writeLocalEntry(key, value, ttlMs);

      await runRedisCommand(
        async (client) => client.pSetEx(key, Math.max(1, Number(ttlMs) || 1), serializeCachePayload(value)),
        { label: `cache set ${key}` },
      ).catch(() => null);

      return value;
    })
    .finally(() => {
      inflightLoads.delete(key);
    });

  inflightLoads.set(key, loadPromise);
  return loadPromise;
};
