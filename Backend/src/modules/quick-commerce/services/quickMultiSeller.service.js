/**
 * Several stores in one Quick Commerce order - the counterpart of Food's multi-restaurant order.
 *
 * Off by default (QC has always been one store per order). An admin turns it on in the delivery
 * settings and picks how many stores (2-3) and how far apart they may be. Everything here is a
 * no-op while the setting is off.
 */
import mongoose from 'mongoose';
import { Seller } from '../seller/models/seller.model.js';
import { ValidationError } from '../../../core/auth/errors.js';
import { haversineKm } from '../../../core/location/haversine.util.js';
import { roadDistanceDetails } from '../utils/roadDistance.helpers.js';
import { getSellerLocation } from './quickOrder.service.js';
import { getQuickDeliverySettings } from './quickDeliverySettings.service.js';
import { assignPickupSequence } from '../../food/orders/services/order-lifecycle.policy.js';
import { SELLER_MISMATCH_CODE, MULTI_SELLER_NOT_ALLOWED_CODE } from '../utils/singleSeller.helpers.js';

/** The cart already allows several stores, but this particular one is over the count / distance limit. */
const MULTI_STORE_LIMIT_CODE = 'MULTI_STORE_LIMIT';

const codedError = (message, code) => {
  const error = new ValidationError(message);
  error.code = code;
  return error;
};

const coordsOf = (seller) => getSellerLocation(seller);

/** Road distance between two stores, falling back to straight-line when the road lookup is unavailable. */
const storeToStoreKm = async (a, b) => {
  const from = coordsOf(a);
  const to = coordsOf(b);
  if (!from || !to) return { km: null, estimated: true };
  try {
    const road = await roadDistanceDetails(from.lat, from.lng, to.lat, to.lng);
    if (Number.isFinite(road?.distanceKm) && road.distanceKm >= 0) {
      return { km: road.distanceKm, estimated: Boolean(road.estimated) };
    }
  } catch {
    /* fall through to straight line */
  }
  const straight = haversineKm(from.lat, from.lng, to.lat, to.lng);
  return Number.isFinite(straight) ? { km: Number(straight.toFixed(2)), estimated: true } : { km: null, estimated: true };
};

const loadSellers = async (sellerIds) => {
  const valid = sellerIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
  const docs = await Seller.find({ _id: { $in: valid } })
    .select('shopName name phone location shopInfo')
    .lean();
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  return sellerIds.map((id) => byId.get(String(id))).filter(Boolean);
};

/**
 * Cart rule: may `newSellerId` join a cart that already holds `existingSellerIds`?
 * With multi-store off this is the old one-store rule.
 */
export async function assertSellerCanJoinCart(existingSellerIds, newSellerId) {
  const existing = [...existingSellerIds].filter((id) => id && id !== 'DEFAULT_SELLER');
  if (existing.length === 0 || existing.includes(String(newSellerId))) return;

  const settings = await getQuickDeliverySettings();
  if (!settings.multiOrderEnabled) {
    throw codedError(
      'Your cart contains items from another seller. Clear your current cart to add this product.',
      SELLER_MISMATCH_CODE,
    );
  }
  if (existing.length >= settings.maxSellersPerOrder) {
    throw codedError(
      `You can order from at most ${settings.maxSellersPerOrder} stores in one order.`,
      MULTI_STORE_LIMIT_CODE,
    );
  }

  // Same rule as Food: every extra store must be near the first store in the cart.
  const [anchor, candidate] = await loadSellers([existing[0], String(newSellerId)]);
  const { km } = await storeToStoreKm(anchor, candidate);
  if (km == null) {
    throw codedError(
      'We could not confirm this store location, so we cannot check how far it is from the first store in your cart.',
      MULTI_STORE_LIMIT_CODE,
    );
  }
  if (km > settings.multiOrderMaxDistance) {
    throw codedError(
      `This store is outside the allowed ${settings.multiOrderMaxDistance} km of the first store in your cart. To place a single order, please choose a nearby store.`,
      MULTI_STORE_LIMIT_CODE,
    );
  }
}

/** Order rule: count and distance limits (the cart rule re-checked on the server at checkout). */
export async function assertMultiSellerOrderAllowed(sellerIds) {
  const unique = [...new Set(sellerIds.map(String))];
  if (unique.length <= 1) return;
  const settings = await getQuickDeliverySettings();
  if (!settings.multiOrderEnabled) {
    throw codedError('Quick Commerce orders support only one seller per order.', MULTI_SELLER_NOT_ALLOWED_CODE);
  }
  if (unique.length > settings.maxSellersPerOrder) {
    throw codedError(
      `You can order from at most ${settings.maxSellersPerOrder} stores in one order.`,
      MULTI_SELLER_NOT_ALLOWED_CODE,
    );
  }
  const sellers = await loadSellers(unique);
  if (sellers.length !== unique.length) {
    throw codedError('One of the stores in your cart could not be found.', MULTI_SELLER_NOT_ALLOWED_CODE);
  }
  for (const other of sellers.slice(1)) {
    const { km } = await storeToStoreKm(sellers[0], other);
    if (km == null || km > settings.multiOrderMaxDistance) {
      throw codedError(
        `Stores in one order must be within ${settings.multiOrderMaxDistance} km of each other.`,
        MULTI_SELLER_NOT_ALLOWED_CODE,
      );
    }
  }
}

/**
 * Visit order + the distance the rider covers: farthest store from the customer first, the nearest
 * last, then the drop. Fee and rider payout are priced on this whole route.
 */
export async function planMultiSellerRoute(sellerIds, customerCoords) {
  const sellers = await loadSellers([...new Set(sellerIds.map(String))]);
  const stops = sellers
    .map((seller) => {
      const c = coordsOf(seller);
      return c ? { seller, location: { coordinates: [c.lng, c.lat] }, restaurantId: seller._id } : null;
    })
    .filter(Boolean);
  if (stops.length !== sellers.length) {
    throw new ValidationError('Store location is not configured. Cannot calculate delivery distance.');
  }
  assignPickupSequence(stops, [customerCoords.lng, customerCoords.lat]);

  let interSellerKm = 0;
  let estimated = false;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const leg = await storeToStoreKm(stops[i].seller, stops[i + 1].seller);
    if (leg.km == null) throw new ValidationError('Unable to calculate the distance between stores');
    interSellerKm += leg.km;
    estimated = estimated || leg.estimated;
  }
  const last = coordsOf(stops[stops.length - 1].seller);
  const lastLeg = await roadDistanceDetails(last.lat, last.lng, customerCoords.lat, customerCoords.lng);
  if (!Number.isFinite(lastLeg?.distanceKm)) {
    throw new ValidationError('Unable to calculate delivery distance for this address');
  }
  estimated = estimated || Boolean(lastLeg.estimated);

  return {
    stops,
    interSellerKm: Number(interSellerKm.toFixed(2)),
    totalKm: Number((interSellerKm + lastLeg.distanceKm).toFixed(2)),
    estimated,
  };
}

/** Live per-store state the rider app walks through (one row per store, in visit order). */
export const buildQuickPickupStops = (stops, items) =>
  stops.map((stop) => {
    const seller = stop.seller;
    const sellerKey = String(seller._id);
    const loc = seller.location || {};
    const addressText =
      [loc.formattedAddress, loc.address, seller.shopInfo?.address, seller.shopInfo?.formattedAddress]
        .map((part) => String(part || '').trim())
        .find(Boolean) || '';
    return {
      restaurantId: seller._id,
      restaurantName: String(seller.shopName || seller.name || 'Store').trim(),
      address: addressText,
      phone: String(seller.phone || '').trim(),
      status: 'pending',
      location: { type: 'Point', coordinates: stop.location.coordinates },
      items: items.filter((item) => String(item.sellerId || '') === sellerKey).map((item) => item.name),
      sequence: stop.sequence ?? 0,
    };
  });
