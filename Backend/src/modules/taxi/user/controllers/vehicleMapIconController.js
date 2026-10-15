import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { Vehicle } from '../../admin/models/Vehicle.js';

/**
 * Marker art for the map, per vehicle type.
 *
 * Both apps have called `/users/vehicle-map-icons` since the marker work
 * landed, but the route was never actually registered — it 404'd, the apps
 * swallowed the error and fell back to bundled silhouettes, so admin-uploaded
 * art never reached a map.
 *
 * Icons are listed as URLs rather than inlined. Six of the catalog's entries
 * are base64 data URLs totalling 2.7 MB, and sending that on every app start
 * would cost more than the markers are worth; instead each is served from its
 * own cacheable endpoint and fetched only when a marker actually needs it.
 */

const iconSourceFor = (vehicle) =>
  String(vehicle?.map_icon || vehicle?.image || vehicle?.icon || '').trim();

/// Absolute, because the app hands this straight to an image loader that has no
/// API base to resolve a relative path against.
const publicBaseUrl = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = req.get('host') || '';
  const protocol = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');

  return `${protocol}://${host}`;
};

export const getVehicleMapIcons = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find({ active: { $ne: false } })
    .select('name icon_types category vehicle_type map_icon image icon')
    .lean();

  const base = publicBaseUrl(req);

  const results = vehicles
    .map((vehicle) => {
      const source = iconSourceFor(vehicle);
      if (!source) return null;

      return {
        id: String(vehicle._id),
        name: vehicle.name || '',
        // The family the app buckets by when it has no art for this exact
        // vehicle: 'bike', 'auto', 'car'.
        icon_types: String(vehicle.icon_types || vehicle.category || vehicle.vehicle_type || '').trim(),
        map_icon: source.startsWith('data:')
          ? `${base}/api/users/vehicle-map-icons/${String(vehicle._id)}/image`
          : source,
      };
    })
    .filter(Boolean);

  res.json({ success: true, data: { results } });
});

/// Decodes one stored data-URL icon and serves it as a plain image.
///
/// Cached hard: vehicle art changes when an admin re-uploads it, which is rare,
/// and re-decoding a 2 MB base64 blob per marker draw is not free.
export const getVehicleMapIconImage = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.vehicleId)
    .select('map_icon image icon')
    .lean();

  const source = iconSourceFor(vehicle);

  if (!source.startsWith('data:')) {
    throw new ApiError(404, 'Vehicle icon not found');
  }

  const separator = source.indexOf(',');
  if (separator < 0) {
    throw new ApiError(404, 'Vehicle icon is malformed');
  }

  const meta = source.slice('data:'.length, separator);
  const contentType = meta.split(';')[0] || 'image/png';
  const buffer = Buffer.from(source.slice(separator + 1), 'base64');

  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'public, max-age=604800');
  res.send(buffer);
});
