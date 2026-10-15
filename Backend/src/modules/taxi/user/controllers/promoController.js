import { resolveServiceLocationIdForPickup } from '../../services/rideService.js';
import { listAvailablePromosForUser, validatePromoForContext } from '../../services/promoService.js';

export const validatePromo = async (req, res) => {
  const { code, fare, service_location_id, transport_type, lat, lng } = req.body || {};

  // The rider app checks a code before it knows any service location, so the
  // pickup stands in for it - the same fallback the booking itself uses.
  const latitude = Number(lat);
  const longitude = Number(lng);
  const serviceLocationId =
    service_location_id ||
    (Number.isFinite(latitude) && Number.isFinite(longitude)
      ? await resolveServiceLocationIdForPickup([longitude, latitude])
      : null);

  const result = await validatePromoForContext({
    code,
    userId: req.auth?.sub,
    fare,
    service_location_id: serviceLocationId,
    transport_type,
  });

  res.json({ success: true, data: result });
};

export const getAvailablePromos = async (req, res) => {
  // The rider app sends no location here; a pickup, when given, narrows the
  // list to that city.
  const latitude = Number(req.query.lat ?? req.query.latitude);
  const longitude = Number(req.query.lng ?? req.query.longitude);
  const serviceLocationId =
    req.query.service_location_id ||
    (Number.isFinite(latitude) && Number.isFinite(longitude)
      ? await resolveServiceLocationIdForPickup([longitude, latitude])
      : null);

  const result = await listAvailablePromosForUser({
    userId: req.auth?.sub,
    service_location_id: serviceLocationId,
    transport_type: req.query.transport_type,
    limit: req.query.limit,
  });

  res.json({ success: true, data: result });
};
