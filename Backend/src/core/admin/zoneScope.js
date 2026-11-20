import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Zone scoping for employees.
 *
 * The admin access guard runs each admin request of a zone-restricted employee inside
 * runWithScope({ zones }). Models that carry a zone register zoneScopePlugin, which adds the zone
 * filter to every find / count / update / delete / aggregate made while that request runs - so
 * every admin list, count, detail and edit is limited to the employee's zones without touching each
 * controller. Requests without a scope (main admin, apps, workers, webhooks) are never filtered.
 */
const storage = new AsyncLocalStorage();

export const runWithScope = (scope, fn) => storage.run(scope, fn);
export const getScope = () => storage.getStore() || null;

/** zones = { food: [ObjectId], quick: [...], taxi: [...] }; geometries.taxi = [GeoJSON polygon]. */
export const idsFor = (module) => {
    const ids = getScope()?.zones?.[module];
    return Array.isArray(ids) && ids.length ? ids : null;
};

/** Filter on a plain zone-id field (or several fields, any of them matching). */
export const byFields = (module, ...fields) => () => {
    const ids = idsFor(module);
    if (!ids) return null;
    return fields.length === 1
        ? { [fields[0]]: { $in: ids } }
        : { $or: fields.map((f) => ({ [f]: { $in: ids } })) };
};

/** Filter on a GeoJSON point field lying inside any of the employee's taxi zones. */
export const byGeo = (module, field) => () => {
    const ids = idsFor(module);
    const polygons = getScope()?.geometries?.[module];
    if (!ids) return null;
    if (!Array.isArray(polygons) || !polygons.length) return { _id: { $in: [] } }; // zones set but no usable area: show nothing
    return { $or: polygons.map((geometry) => ({ [field]: { $geoWithin: { $geometry: geometry } } })) };
};

const QUERY_HOOKS = [
    'find', 'findOne', 'countDocuments', 'distinct',
    'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
];

/** schema.plugin(zoneScopePlugin, { filter: byFields('food', 'zoneId') }) */
export const zoneScopePlugin = (schema, { filter }) => {
    schema.pre(QUERY_HOOKS, function applyZoneScope() {
        // deleteOne / updateOne also run for document calls (doc.deleteOne()), which have no query to narrow.
        if (typeof this.and !== 'function') return;
        const f = filter();
        if (f) this.and([f]);
    });
    schema.pre('aggregate', function applyZoneScopeToAggregate() {
        const f = filter();
        if (!f) return;
        const pipeline = this.pipeline();
        // $geoNear has to stay the first stage; the zone $match goes right after it.
        const at = pipeline.length && pipeline[0].$geoNear ? 1 : 0;
        pipeline.splice(at, 0, { $match: f });
    });
};
