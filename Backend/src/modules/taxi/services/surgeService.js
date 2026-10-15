import mongoose from 'mongoose';
import { expandRiderVehicleKeys } from '../shared/vehicleClasses.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { cellToBoundary, cellToLatLng, greatCircleDistance, gridDisk, latLngToCell } from 'h3-js';
import { runRedisCommand } from '../shared/redisClient.js';
import { ApiError } from '../../../utils/ApiError.js';
import { SurgeSetting } from '../admin/models/SurgeSetting.js';
import { Driver } from '../driver/models/Driver.js';

/**
 * Automatic, demand-driven surge - the hexagon map Rapido and Uber drivers see.
 *
 * The city is cut into H3 hexagons. Demand is the number of distinct riders
 * who asked for a price with their pickup in a hexagon (every quote passes
 * through GET /users/set-prices with lat/lng). Supply is the free drivers in
 * it, counted the way dispatch counts them. Both are summed over the hexagon
 * and its six neighbours, so a surge follows an area rather than one block.
 *
 * Surge is worked out per settings profile. "default" compares the riders with
 * every free driver and prices every vehicle without settings of its own -
 * which, until an admin gives a vehicle its own, is all of them. A vehicle type
 * with its own settings compares the same riders with its own free drivers
 * only, under its own limits: ten free autos and one free car surge the car,
 * not the auto. A rider asking for a price has not chosen a vehicle yet, so
 * every rider counts as demand for every profile.
 *
 * Once a minute one API instance (whichever holds the Redis lock) recomputes
 * every hexagon with recent demand and writes the result to Redis, where every
 * instance reads it when quoting. A surge holds for `hold_minutes` once set, so
 * prices do not flicker and the driver map can say when it ends.
 *
 * The rider is billed the fare the app quotes, so applying the multiplier to
 * the quote is applying it to the charge.
 */

const CYCLE_MS = 60 * 1000;
const LOCK_KEY = 'surge:engine:lock';
// Field "<profile>|<hex>" -> the surge running there for that profile.
const ACTIVE_KEY = 'surge:active';
// Demand and free drivers per hexagon from the latest cycle, surging or not,
// for the driver map's "high demand" layer. Short-lived: it describes the
// last minute, and a stale snapshot must not outlive a stopped engine.
const SNAPSHOT_KEY = 'surge:snapshot';
const SNAPSHOT_TTL_SECONDS = 180;
const SETTINGS_TTL_MS = 30 * 1000;
// Legal ceiling for the combined multiplier (Motor Vehicle Aggregator
// Guidelines 2025), whatever the scheduled windows and settings say.
export const ABSOLUTE_MAX_MULTIPLIER = 2;

export const DEFAULT_PROFILE = 'default';

// Set per profile.
const PROFILE_FIELDS = [
  'enabled',
  'window_minutes',
  'min_demand',
  'trigger_ratio',
  'ratio_step',
  'step',
  'max_multiplier',
  'hold_minutes',
];
// Shared by every profile, read from "default": one map for all vehicles.
const SHARED_FIELDS = ['resolution'];

let profilesCache = { value: null, at: 0 };
// Used only when Redis is unavailable, so a single instance still works.
const memory = { demand: new Map(), active: new Map(), snapshot: new Map() };
let engineTimer = null;

const minuteBucket = (time = Date.now()) => Math.floor(time / 60000);
const demandKey = (res, bucket, hex) => `surge:dem:${res}:${bucket}:${hex}`;
const demandHexesKey = (res, bucket) => `surge:demhex:${res}:${bucket}`;
const activeField = (profile, hex) => `${profile}|${hex}`;
const round2 = (value) => Math.round(value * 100) / 100;

const serializeProfile = (doc, shared = null) => {
  const defaults = new SurgeSetting().toObject();
  const source = doc || defaults;
  const own = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, source[field] ?? defaults[field]]));
  const sharedValues = shared
    || Object.fromEntries(SHARED_FIELDS.map((field) => [field, source[field] ?? defaults[field]]));
  return {
    ...own,
    ...sharedValues,
    vehicle_type_id: source.vehicle_type_id ? String(source.vehicle_type_id) : null,
  };
};

/**
 * Every profile: `default`, and `vehicles` - vehicle type id -> its own
 * settings - for the vehicle types that have them.
 */
export const getSurgeProfiles = async ({ fresh = false } = {}) => {
  if (!fresh && profilesCache.value && Date.now() - profilesCache.at < SETTINGS_TTL_MS) {
    return profilesCache.value;
  }
  const docs = await SurgeSetting.find({}).lean();
  const defaultProfile = serializeProfile(docs.find((doc) => doc.key === DEFAULT_PROFILE));
  const shared = Object.fromEntries(SHARED_FIELDS.map((field) => [field, defaultProfile[field]]));
  const vehicles = new Map(
    docs
      .filter((doc) => doc.key !== DEFAULT_PROFILE && doc.vehicle_type_id)
      .map((doc) => [String(doc.vehicle_type_id), serializeProfile(doc, shared)]),
  );
  const value = {
    default: defaultProfile,
    vehicles,
    anyEnabled: defaultProfile.enabled || [...vehicles.values()].some((profile) => profile.enabled),
  };
  profilesCache = { value, at: Date.now() };
  return value;
};

/** The "default" settings - and the shared hexagon size every profile uses. */
export const getSurgeSettings = async ({ fresh = false } = {}) => (await getSurgeProfiles({ fresh })).default;

/** Which profile prices a vehicle type: its own if it has one, else default. */
export const profileKeyForVehicle = (profiles, vehicleTypeId) =>
  vehicleTypeId && profiles?.vehicles?.has(String(vehicleTypeId)) ? String(vehicleTypeId) : DEFAULT_PROFILE;

export const settingsForProfile = (profiles, key) =>
  key === DEFAULT_PROFILE ? profiles.default : profiles.vehicles.get(key) || profiles.default;

export const settingsForVehicle = (profiles, vehicleTypeId) =>
  settingsForProfile(profiles, profileKeyForVehicle(profiles, vehicleTypeId));

const enabledProfileKeys = (profiles) => [
  ...(profiles.default.enabled ? [DEFAULT_PROFILE] : []),
  ...[...profiles.vehicles].filter(([, profile]) => profile.enabled).map(([key]) => key),
];

const toObjectId = (value) => {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
};

/**
 * Saves one profile: a vehicle type's when `vehicle_type_id` is given, the
 * default one otherwise. Only that document is written, so saving one vehicle
 * can never change another's settings. The first save for a vehicle starts
 * from the default values for anything not sent.
 */
export const updateSurgeSettings = async (payload = {}) => {
  const vehicleTypeId = payload.vehicle_type_id ? toObjectId(payload.vehicle_type_id) : null;
  if (payload.vehicle_type_id && !vehicleTypeId) {
    throw new ApiError(400, 'Invalid vehicle type');
  }

  const update = {};
  for (const field of PROFILE_FIELDS) {
    if (payload[field] === undefined || payload[field] === '') continue;
    update[field] = field === 'enabled' ? Boolean(payload[field]) : Number(payload[field]);
  }
  if (update.max_multiplier !== undefined) {
    update.max_multiplier = Math.min(ABSOLUTE_MAX_MULTIPLIER, Math.max(1, update.max_multiplier));
  }
  if (!vehicleTypeId && payload.resolution !== undefined && payload.resolution !== '') {
    update.resolution = Math.min(9, Math.max(7, Math.round(Number(payload.resolution))));
  }

  const key = vehicleTypeId ? `vehicle:${vehicleTypeId}` : DEFAULT_PROFILE;
  let seed = {};
  if (vehicleTypeId) {
    const exists = await SurgeSetting.exists({ key });
    if (!exists) {
      const base = (await getSurgeProfiles({ fresh: true })).default;
      seed = Object.fromEntries(PROFILE_FIELDS.filter((field) => update[field] === undefined).map((field) => [field, base[field]]));
    }
  }

  const doc = await SurgeSetting.findOneAndUpdate(
    { key },
    { $set: { ...seed, ...update }, $setOnInsert: { key, vehicle_type_id: vehicleTypeId } },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  profilesCache = { value: null, at: 0 };

  // A profile switched off stops surging now, not when its hold runs out. A
  // new hexagon size makes every running surge meaningless.
  if (update.resolution !== undefined) {
    await writeActive(new Map());
  } else if (!doc.enabled) {
    await clearProfile(vehicleTypeId ? String(vehicleTypeId) : DEFAULT_PROFILE);
  }
  return serializeProfile(doc);
};

/** Removes a vehicle type's own settings: it follows default again. */
export const resetVehicleSurgeSettings = async (vehicleTypeId) => {
  const id = toObjectId(vehicleTypeId);
  if (!id) throw new ApiError(400, 'Invalid vehicle type');
  await SurgeSetting.deleteOne({ key: `vehicle:${id}` });
  profilesCache = { value: null, at: 0 };
  await clearProfile(String(id));
};

const isValidPoint = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/**
 * Counts a rider asking for a price at a pickup. Distinct riders are counted
 * with a HyperLogLog per hexagon per minute, so the app refreshing its prices
 * every minute does not multiply one rider into a crowd.
 */
export const recordSurgeDemand = async ({ lat, lng, requester }) => {
  if (!isValidPoint(lat, lng) || !requester) return;
  const profiles = await getSurgeProfiles();
  if (!profiles.anyEnabled) return;

  const res = profiles.default.resolution;
  const hex = latLngToCell(lat, lng, res);
  const bucket = minuteBucket();
  const longestWindow = Math.max(
    profiles.default.window_minutes,
    ...[...profiles.vehicles.values()].map((profile) => profile.window_minutes),
  );
  const ttlSeconds = (longestWindow + 5) * 60;

  const result = await runRedisCommand(
    async (client) => {
      await client
        .multi()
        .pfAdd(demandKey(res, bucket, hex), String(requester))
        .expire(demandKey(res, bucket, hex), ttlSeconds)
        .sAdd(demandHexesKey(res, bucket), hex)
        .expire(demandHexesKey(res, bucket), ttlSeconds)
        .exec();
    },
    { label: 'surge demand' },
  );

  if (!result.ok) {
    const key = `${res}:${bucket}:${hex}`;
    if (!memory.demand.has(key)) memory.demand.set(key, new Set());
    memory.demand.get(key).add(String(requester));
  }
};

const parseEntries = (entries) =>
  new Map(
    entries.map(([field, json]) => {
      try {
        // Written before surge was per vehicle: those were default's.
        return [field.includes('|') ? field : activeField(DEFAULT_PROFILE, field), JSON.parse(json)];
      } catch {
        return [field, null];
      }
    }).filter(([, value]) => value),
  );

/// Every running surge, keyed "<profile>|<hex>".
const readActive = async () => {
  const result = await runRedisCommand((client) => client.hGetAll(ACTIVE_KEY), { label: 'surge read' });
  if (!result.ok) return new Map(memory.active);
  return parseEntries(Object.entries(result.value || {}));
};

async function writeActive(active) {
  memory.active = new Map(active);
  await runRedisCommand(
    async (client) => {
      const tx = client.multi().del(ACTIVE_KEY);
      if (active.size > 0) {
        tx.hSet(ACTIVE_KEY, Object.fromEntries([...active].map(([field, entry]) => [field, JSON.stringify(entry)])));
        tx.expire(ACTIVE_KEY, 3600);
      }
      await tx.exec();
    },
    { label: 'surge write' },
  );
}

async function clearProfile(profile) {
  const active = await readActive();
  for (const field of [...active.keys()]) {
    if (field.startsWith(`${profile}|`)) active.delete(field);
  }
  await writeActive(active);
}

async function writeSnapshot(snapshot) {
  memory.snapshot = new Map(snapshot);
  await runRedisCommand(
    async (client) => {
      const tx = client.multi().del(SNAPSHOT_KEY);
      if (snapshot.size > 0) {
        tx.hSet(SNAPSHOT_KEY, Object.fromEntries([...snapshot].map(([hex, entry]) => [hex, JSON.stringify(entry)])));
        tx.expire(SNAPSHOT_KEY, SNAPSHOT_TTL_SECONDS);
      }
      await tx.exec();
    },
    { label: 'surge snapshot write' },
  );
}

const readSnapshot = async () => {
  const result = await runRedisCommand((client) => client.hGetAll(SNAPSHOT_KEY), { label: 'surge snapshot read' });
  if (!result.ok) return new Map(memory.snapshot);
  return new Map(
    Object.entries(result.value || {}).map(([hex, json]) => {
      try {
        return [hex, JSON.parse(json)];
      } catch {
        return [hex, null];
      }
    }).filter(([, value]) => value),
  );
};

/// Distinct riders across a set of hexagons over the given minutes.
const countDemand = async (resolution, hexes, buckets) => {
  const keys = hexes.flatMap((hex) => buckets.map((bucket) => demandKey(resolution, bucket, hex)));
  const result = await runRedisCommand((client) => client.pfCount(keys), { label: 'surge count' });
  if (result.ok) return Number(result.value) || 0;

  const riders = new Set();
  for (const hex of hexes) {
    for (const bucket of buckets) {
      for (const rider of memory.demand.get(`${resolution}:${bucket}:${hex}`) || []) riders.add(rider);
    }
  }
  return riders.size;
};

const hexesWithDemand = async (resolution, buckets) => {
  const result = await runRedisCommand(
    (client) => client.sUnion(buckets.map((bucket) => demandHexesKey(resolution, bucket))),
    { label: 'surge hexes' },
  );
  if (result.ok) return result.value || [];

  const hexes = new Set();
  for (const key of memory.demand.keys()) {
    const [res, bucket, hex] = key.split(':');
    if (Number(res) === resolution && buckets.includes(Number(bucket))) hexes.add(hex);
  }
  return [...hexes];
};

/**
 * Free drivers per hexagon - the same availability test dispatch uses - in
 * total, and per vehicle type for the types with their own settings. A
 * driver enrolled in several types counts for each.
 */
const freeDriversByHex = async (resolution, vehicleTypeIds) => {
  // Riders are delivery partners who are online, approved, opted in to taxi and not on a ride.
  const drivers = await Driver.find({
    status: 'approved',
    availabilityStatus: 'online',
    deliveryServices: 'taxi',
    isOnRide: { $ne: true },
    'lastLocation.coordinates.0': { $exists: true },
  })
    .select('lastLocation vehicleType')
    .lean();

  // A rider counts for every vehicle class their own vehicle can serve.
  const classes = vehicleTypeIds.length
    ? await Vehicle.find({ _id: { $in: vehicleTypeIds } }).select('name vehicle_type icon_types').lean()
    : [];
  const classIdsByKey = new Map();
  for (const vehicle of classes) {
    for (const key of expandRiderVehicleKeys([vehicle.name, vehicle.vehicle_type, vehicle.icon_types])) {
      if (!classIdsByKey.has(key)) classIdsByKey.set(key, new Set());
      classIdsByKey.get(key).add(String(vehicle._id));
    }
  }

  const all = new Map();
  const byType = new Map(vehicleTypeIds.map((id) => [id, new Map()]));
  for (const driver of drivers) {
    const [lng, lat] = driver.lastLocation?.coordinates || [];
    if (!isValidPoint(lat, lng)) continue;
    const hex = latLngToCell(lat, lng, resolution);
    all.set(hex, (all.get(hex) || 0) + 1);
    const types = classIdsByKey.get(String(driver.vehicleType || '').trim().toLowerCase()) || new Set();
    for (const type of types) {
      const counts = byType.get(type);
      if (counts) counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }
  return { all, byType };
};

/// Riders per free driver -> multiplier. Below `min_demand` riders, or below
/// `trigger_ratio`, there is no surge.
export const multiplierForRatio = (settings, demand, supply) => {
  if (demand < settings.min_demand) return 1;
  const ratio = demand / Math.max(1, supply);
  if (ratio < settings.trigger_ratio) return 1;
  const steps = 1 + Math.floor((ratio - settings.trigger_ratio) / settings.ratio_step);
  const cap = Math.min(settings.max_multiplier, ABSOLUTE_MAX_MULTIPLIER);
  return round2(Math.min(cap, 1 + steps * settings.step));
};

/// One pass over every hexagon with recent demand, and its neighbours, for
/// every switched-on profile.
export const runSurgeCycle = async () => {
  const profiles = await getSurgeProfiles({ fresh: true });
  const keys = enabledProfileKeys(profiles);
  if (keys.length === 0) {
    await writeActive(new Map());
    return { enabled: false, active: 0 };
  }

  const resolution = profiles.default.resolution;
  const now = Date.now();
  const current = minuteBucket(now);
  const windowOf = (key) => settingsForProfile(profiles, key).window_minutes;
  const longestWindow = Math.max(profiles.default.window_minutes, ...keys.map(windowOf));
  const bucketsFor = (minutes) => Array.from({ length: minutes }, (_, index) => current - index);

  const demandHexes = await hexesWithDemand(resolution, bucketsFor(longestWindow));
  const candidates = new Set(demandHexes.flatMap((hex) => gridDisk(hex, 1)));
  const vehicleKeys = keys.filter((key) => key !== DEFAULT_PROFILE);
  const supply = candidates.size
    ? await freeDriversByHex(resolution, vehicleKeys)
    : { all: new Map(), byType: new Map() };
  const previous = await readActive();
  const next = new Map();
  const snapshot = new Map();

  for (const hex of candidates) {
    const area = gridDisk(hex, 1);
    // Profiles with the same window share one count.
    const demandByWindow = new Map();
    const demandOver = async (minutes) => {
      if (!demandByWindow.has(minutes)) demandByWindow.set(minutes, await countDemand(resolution, area, bucketsFor(minutes)));
      return demandByWindow.get(minutes);
    };
    const sumSupply = (counts) => area.reduce((sum, cell) => sum + (counts?.get(cell) || 0), 0);

    // The demand layer on the driver map: every rider, every free driver.
    const allSupply = sumSupply(supply.all);
    const allDemand = await demandOver(profiles.default.window_minutes);
    if (allDemand > 0) snapshot.set(hex, { demand: allDemand, supply: allSupply, at: now, resolution });

    for (const key of keys) {
      const settings = settingsForProfile(profiles, key);
      const demand = await demandOver(settings.window_minutes);
      const free = key === DEFAULT_PROFILE ? allSupply : sumSupply(supply.byType.get(key));
      const multiplier = multiplierForRatio(settings, demand, free);
      const field = activeField(key, hex);
      const held = previous.get(field);
      const heldLive = held && held.until > now && held.resolution === resolution;

      if (multiplier > 1 && (!heldLive || multiplier >= held.multiplier)) {
        // New or rising surge: (re)start the hold.
        const until = now + settings.hold_minutes * 60 * 1000;
        next.set(field, { multiplier, until, demand, supply: free, resolution, since: heldLive ? held.since : now });
      } else if (heldLive) {
        // Demand eased: keep the surge until its hold runs out.
        next.set(field, { ...held, demand, supply: free });
      }
    }
  }

  // Surges whose area had no demand at all this cycle still run their hold out,
  // as long as their profile is still on.
  for (const [field, held] of previous) {
    const [key] = field.split('|');
    if (!next.has(field) && keys.includes(key) && held.until > now && held.resolution === resolution) {
      next.set(field, held);
    }
  }

  await writeActive(next);
  // The map's demand layer is a by-product: it must never stop the surge
  // itself from being written.
  await writeSnapshot(snapshot).catch((error) => {
    console.error('[surge] snapshot not written', error?.message);
  });
  pruneMemory(current - longestWindow);
  return { enabled: true, profiles: keys.length, demandHexes: demandHexes.length, active: next.size };
};

const pruneMemory = (oldestBucket) => {
  for (const key of memory.demand.keys()) {
    if (Number(key.split(':')[1]) < oldestBucket) memory.demand.delete(key);
  }
};

const liveEntry = (entry, resolution, now) =>
  entry && entry.until > now && entry.multiplier > 1 && entry.resolution === resolution ? entry : null;

/**
 * The automatic surge at a pickup. `profiles` holds every switched-on
 * profile's surge there ({ multiplier, ends_at }); `multiplier` and `ends_at`
 * at the top are default's, for anything that does not price by vehicle.
 * Use surgeForVehicle() to read one vehicle's.
 */
export const getSurgeAt = async (lat, lng) => {
  const none = { multiplier: 1, ends_at: null, hex: null, profiles: {} };
  if (!isValidPoint(lat, lng)) return none;
  const surgeProfiles = await getSurgeProfiles();
  const keys = enabledProfileKeys(surgeProfiles);
  if (keys.length === 0) return none;

  const resolution = surgeProfiles.default.resolution;
  const hex = latLngToCell(lat, lng, resolution);
  const fields = keys.map((key) => activeField(key, hex));
  // Before surge was per vehicle, default's field was the bare hexagon.
  const legacy = surgeProfiles.default.enabled ? [hex] : [];
  const result = await runRedisCommand((client) => client.hmGet(ACTIVE_KEY, [...fields, ...legacy]), { label: 'surge lookup' });

  const raw = new Map();
  if (result.ok) {
    const values = result.value || [];
    [...fields, ...legacy].forEach((field, index) => {
      if (values[index]) raw.set(field.includes('|') ? field : activeField(DEFAULT_PROFILE, field), values[index]);
    });
  }
  const now = Date.now();
  const byProfile = {};
  for (const key of keys) {
    let entry = null;
    if (result.ok) {
      try {
        entry = raw.has(activeField(key, hex)) ? JSON.parse(raw.get(activeField(key, hex))) : null;
      } catch {
        entry = null;
      }
    } else {
      entry = memory.active.get(activeField(key, hex)) || null;
    }
    const live = liveEntry(entry, resolution, now);
    if (live) byProfile[key] = { multiplier: live.multiplier, ends_at: new Date(live.until).toISOString() };
  }

  const fallback = byProfile[DEFAULT_PROFILE];
  return {
    multiplier: fallback?.multiplier || 1,
    ends_at: fallback?.ends_at || null,
    hex,
    profiles: byProfile,
  };
};

/** One vehicle type's surge from a getSurgeAt() result: { multiplier, ends_at }. */
export const surgeForVehicle = (surgeAt, profiles, vehicleTypeId) => {
  const key = profileKeyForVehicle(profiles, vehicleTypeId);
  const entry = surgeAt?.profiles?.[key];
  if (!entry || !settingsForProfile(profiles, key).enabled) return { multiplier: 1, ends_at: null };
  return { multiplier: Math.min(ABSOLUTE_MAX_MULTIPLIER, Math.max(1, entry.multiplier)), ends_at: entry.ends_at };
};

/// The profiles that price a set of vehicle types; default when none given.
const profileKeysFor = (profiles, vehicleTypeIds = []) => {
  const ids = (vehicleTypeIds || []).filter(Boolean).map(String);
  if (ids.length === 0) return [DEFAULT_PROFILE];
  return [...new Set(ids.map((id) => profileKeyForVehicle(profiles, id)))];
};

/**
 * Active surge hexagons for a map - the driver app's surge view and the admin
 * page. Each carries its outline, so a client can draw it without H3.
 *
 * With `vehicleTypeIds` (a driver's vehicles) only the profiles that price
 * those vehicles count, and a hexagon shows the highest of them. Without, every
 * profile's surges are listed separately, each with its `vehicle_type_id`
 * (null for default) - the admin page.
 */
export const listActiveSurges = async ({ lat, lng, radiusKm = 15, vehicleTypeIds = null } = {}) => {
  const now = Date.now();
  const [profiles, active] = await Promise.all([getSurgeProfiles(), readActive()]);
  const enabled = new Set(enabledProfileKeys(profiles));
  const wanted = vehicleTypeIds ? new Set(profileKeysFor(profiles, vehicleTypeIds)) : null;
  const centre = isValidPoint(lat, lng) ? [lat, lng] : null;

  const rows = [];
  for (const [field, entry] of active) {
    const [key, hex] = field.split('|');
    if (!enabled.has(key) || (wanted && !wanted.has(key))) continue;
    if (!liveEntry(entry, profiles.default.resolution, now)) continue;
    rows.push({ key, hex, entry });
  }

  // For a driver: one row per hexagon, the best-paying profile.
  const picked = wanted
    ? [...rows.reduce((best, row) => {
      const current = best.get(row.hex);
      if (!current || row.entry.multiplier > current.entry.multiplier) best.set(row.hex, row);
      return best;
    }, new Map()).values()]
    : rows;

  return picked
    .map(({ key, hex, entry }) => {
      const [hexLat, hexLng] = cellToLatLng(hex);
      return {
        hex,
        vehicle_type_id: key === DEFAULT_PROFILE ? null : key,
        multiplier: entry.multiplier,
        ends_at: new Date(entry.until).toISOString(),
        ends_in_minutes: Math.max(0, Math.ceil((entry.until - now) / 60000)),
        demand: entry.demand,
        supply: entry.supply,
        center: { lat: hexLat, lng: hexLng },
        boundary: cellToBoundary(hex).map(([pointLat, pointLng]) => ({ lat: pointLat, lng: pointLng })),
        distance_km: centre ? round2(greatCircleDistance(centre, [hexLat, hexLng], 'km')) : null,
      };
    })
    .filter((surge) => surge.distance_km === null || surge.distance_km <= radiusKm)
    .sort((a, b) => b.multiplier - a.multiplier);
};

/**
 * How busy an area is, for the driver map.
 *
 * Surging is always "very high". Otherwise riders per free driver decides it:
 * more riders than drivers is "high", reaching the surge trigger is "very
 * high". A trickle of riders below half the surge minimum stays "normal", so
 * one person checking a price does not light up a hexagon.
 */
export const demandLevelFor = (settings, demand, supply, multiplier = 1) => {
  if (multiplier > 1) return 'very_high';
  if (demand < Math.max(2, Math.ceil(settings.min_demand / 2))) return 'normal';
  const ratio = demand / Math.max(1, supply);
  if (ratio >= settings.trigger_ratio) return 'very_high';
  if (ratio >= 1) return 'high';
  return 'normal';
};

/**
 * One hexagon for the driver map. `keys` are the profiles pricing the
 * driver's vehicles; the hexagon shows the highest surge among them, and
 * `profile_multipliers` keeps each one's for working out a vehicle's fare.
 */
const describeHex = (profiles, keys, hex, active, snapshot, now) => {
  const settings = profiles.default;
  const resolution = settings.resolution;
  const profileMultipliers = {};
  let best = null;
  for (const key of keys) {
    const live = liveEntry(active.get(activeField(key, hex)), resolution, now);
    if (!live) continue;
    profileMultipliers[key] = live.multiplier;
    if (!best || live.multiplier > best.multiplier) best = live;
  }

  const counts = snapshot.get(hex);
  const fresh = counts && counts.resolution === resolution;
  const demand = fresh ? counts.demand : (best ? best.demand : 0);
  const supply = fresh ? counts.supply : (best ? best.supply : 0);
  const multiplier = best ? best.multiplier : 1;

  return {
    multiplier,
    surge_ends_at: best ? new Date(best.until).toISOString() : null,
    surge_ends_in_minutes: best ? Math.max(0, Math.ceil((best.until - now) / 60000)) : 0,
    demand_level: demandLevelFor(settings, demand, supply, multiplier),
    demand,
    free_drivers: supply,
    profile_multipliers: profileMultipliers,
  };
};

/**
 * Every hexagon near a point that is surging or busy, for the driver map.
 *
 * Reads only what the engine already wrote (active surges and the last
 * cycle's snapshot): looking at the map is never counted as demand and never
 * changes a price. The multiplier is the very value rider quotes read - for
 * the driver's own vehicles (`vehicleTypeIds`).
 */
export const listOpportunityCells = async ({ lat, lng, radiusKm = 8, limit = 150, gridRings = GRID_RINGS, vehicleTypeIds = [] } = {}) => {
  const profiles = await getSurgeProfiles();
  const settings = profiles.default;
  const centre = isValidPoint(lat, lng) ? [lat, lng] : null;
  const keys = profileKeysFor(profiles, vehicleTypeIds).filter((key) => settingsForProfile(profiles, key).enabled);
  const maxMultiplier = keys.length
    ? Math.max(...keys.map((key) => settingsForProfile(profiles, key).max_multiplier))
    : settings.max_multiplier;

  // The hexagons around the driver, whatever their demand - the grid a driver
  // sees on Rapido or Uber even when nothing is surging. Without it a quiet
  // map was blank, which reads as broken rather than as "normal here".
  const grid = centre ? new Set(gridDisk(latLngToCell(centre[0], centre[1], settings.resolution), gridRings)) : new Set();

  if (keys.length === 0) {
    return { enabled: false, max_multiplier: maxMultiplier, cells: [...grid].map((hex) => normalCell(hex, centre)).slice(0, limit) };
  }

  const now = Date.now();
  const [active, snapshot] = await Promise.all([readActive(), readSnapshot()]);
  const hexes = new Set([
    ...[...active.keys()].map((field) => field.split('|')[1]).filter(Boolean),
    ...snapshot.keys(),
    ...grid,
  ]);

  const cells = [];
  for (const hex of hexes) {
    const info = describeHex(profiles, keys, hex, active, snapshot, now);
    // Quiet hexagons are only drawn as part of the grid around the driver.
    if (info.multiplier <= 1 && info.demand_level === 'normal' && !grid.has(hex)) continue;

    const [hexLat, hexLng] = cellToLatLng(hex);
    const distanceKm = centre ? round2(greatCircleDistance(centre, [hexLat, hexLng], 'km')) : null;
    if (distanceKm !== null && distanceKm > radiusKm) continue;

    cells.push({
      hex,
      center: { lat: hexLat, lng: hexLng },
      boundary: cellToBoundary(hex).map(([pointLat, pointLng]) => ({ lat: pointLat, lng: pointLng })),
      ...info,
      distance_km: distanceKm,
    });
  }

  cells.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
  return { enabled: true, max_multiplier: maxMultiplier, cells: cells.slice(0, limit) };
};

/**
 * Rings of hexagons drawn around the driver. At resolution 8 (about 0.8 km
 * between centres) 4 rings is 61 hexagons, reaching about 3 km out.
 */
const GRID_RINGS = 4;

const normalCell = (hex, centre) => {
  const [hexLat, hexLng] = cellToLatLng(hex);
  return {
    hex,
    center: { lat: hexLat, lng: hexLng },
    boundary: cellToBoundary(hex).map(([pointLat, pointLng]) => ({ lat: pointLat, lng: pointLng })),
    multiplier: 1,
    surge_ends_at: null,
    surge_ends_in_minutes: 0,
    demand_level: 'normal',
    demand: 0,
    free_drivers: 0,
    profile_multipliers: {},
    distance_km: centre ? round2(greatCircleDistance(centre, [hexLat, hexLng], 'km')) : null,
  };
};

/** The same description for one point - used for airports. */
export const describeOpportunityAt = async (lat, lng, vehicleTypeIds = []) => {
  const profiles = await getSurgeProfiles();
  const keys = profileKeysFor(profiles, vehicleTypeIds).filter((key) => settingsForProfile(profiles, key).enabled);
  if (keys.length === 0 || !isValidPoint(lat, lng)) {
    return { multiplier: 1, surge_ends_in_minutes: 0, demand_level: 'normal', demand: 0, free_drivers: 0 };
  }
  const hex = latLngToCell(lat, lng, profiles.default.resolution);
  const [active, snapshot] = await Promise.all([readActive(), readSnapshot()]);
  const { surge_ends_at: _unused, profile_multipliers: _alsoUnused, ...info } = describeHex(profiles, keys, hex, active, snapshot, Date.now());
  return { hex, ...info };
};

/// Runs a cycle every minute on whichever instance holds the lock.
export const startSurgeEngineLoop = () => {
  if (engineTimer) return;

  const run = async () => {
    const lock = await runRedisCommand(
      (client) => client.set(LOCK_KEY, String(process.pid), { NX: true, PX: CYCLE_MS - 5000 }),
      { label: 'surge lock' },
    );
    // No Redis: every instance runs its own cycle on its own memory.
    if (lock.ok && lock.value !== 'OK') return;
    try {
      await runSurgeCycle();
    } catch (error) {
      console.error('Surge cycle failed', error);
    }
  };

  engineTimer = setInterval(run, CYCLE_MS);
  engineTimer.unref?.();
  run();
};
