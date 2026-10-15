/**
 * A rider's money (earnings, cash in hand, trips, offers) comes from every order they carried,
 * and a rider now carries both Food and Quick Commerce orders. These helpers run the same query
 * against both collections and merge the answer, so the wallet / pocket / history screens do not
 * need to know the order came from a different vertical.
 *
 * Only the queries the rider screens already use are supported: `aggregate` with a single
 * `$group: { _id: null, ... }` stage, `countDocuments`, and `find(...).sort/select/limit/skip/
 * populate/lean`.
 */
import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';

/** The QC model is registered by the quick-commerce module; resolve lazily to avoid import cycles. */
const quickModel = () => mongoose.models.QuickOrder || null;

const models = () => [FoodOrder, quickModel()].filter(Boolean);

const getPath = (obj, path) => String(path).split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

const asComparable = (value) => {
  if (value == null) return Number.NEGATIVE_INFINITY;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  if (typeof value !== 'object' && Number.isFinite(n) && String(value).trim() !== '') return n;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : String(value);
};

const comparator = (sort = {}) => {
  const entries = Object.entries(sort || {});
  return (a, b) => {
    for (const [path, dir] of entries) {
      const av = asComparable(getPath(a, path));
      const bv = asComparable(getPath(b, path));
      if (av === bv) continue;
      const cmp = av > bv ? 1 : -1;
      return Number(dir) < 0 ? -cmp : cmp;
    }
    return 0;
  };
};

/** Sum the numeric fields of groups that share an `_id`. */
const mergeGroups = (resultSets) => {
  const byId = new Map();
  for (const rows of resultSets) {
    for (const row of rows || []) {
      const key = JSON.stringify(row?._id ?? null);
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, { ...row });
        continue;
      }
      for (const [field, value] of Object.entries(row)) {
        if (field === '_id') continue;
        if (typeof value === 'number') existing[field] = (Number(existing[field]) || 0) + value;
      }
    }
  }
  return [...byId.values()];
};

const POPULATE_FOOD_ONLY = new Set(['restaurantId']);

class MergedFind {
  constructor(match) {
    this.match = match;
    this.sortSpec = null;
    this.selectSpec = null;
    this.limitN = null;
    this.skipN = 0;
    this.populates = [];
  }

  sort(spec) { this.sortSpec = spec; return this; }
  select(spec) { this.selectSpec = spec; return this; }
  limit(n) { this.limitN = n; return this; }
  skip(n) { this.skipN = n; return this; }
  populate(spec) { this.populates.push(spec); return this; }

  async lean() {
    const want = this.limitN != null ? this.skipN + this.limitN : null;
    const perModel = await Promise.all(
      models().map(async (Model) => {
        const isFood = Model === FoodOrder;
        let query = Model.find(this.match);
        if (this.sortSpec) query = query.sort(this.sortSpec);
        if (this.selectSpec) query = query.select(this.selectSpec);
        if (want != null) query = query.limit(want);
        for (const spec of this.populates) {
          const path = typeof spec === 'string' ? spec : spec?.path;
          if (!isFood && POPULATE_FOOD_ONLY.has(path)) continue;
          query = query.populate(spec);
        }
        const rows = await query.lean();
        return isFood
          ? rows
          : rows.map((row) => ({
              ...row,
              orderKind: 'quick',
              restaurantName: row.restaurantName || row.pickupPoints?.[0]?.sourceName || 'Store',
            }));
      }),
    );
    const merged = perModel.flat();
    if (this.sortSpec) merged.sort(comparator(this.sortSpec));
    return want != null ? merged.slice(this.skipN, want) : merged;
  }
}

export const riderOrders = {
  /** Same pipeline on both collections; `$group` results are summed per `_id`. */
  async aggregate(pipeline) {
    const sets = await Promise.all(models().map((Model) => Model.aggregate(pipeline)));
    return mergeGroups(sets);
  },

  async countDocuments(match) {
    const counts = await Promise.all(models().map((Model) => Model.countDocuments(match)));
    return counts.reduce((sum, n) => sum + n, 0);
  },

  find(match) {
    return new MergedFind(match);
  },
};
