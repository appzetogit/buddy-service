import mongoose from 'mongoose';
import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';

/**
 * Taxi riders are the platform's delivery partners. The access token of a rider carries either the
 * delivery-partner id (legacy login) or the unified identity id, so both are accepted.
 *
 * @returns {Promise<{ _id: string, status: string, name: string } | null>}
 */
export const resolvePartnerFromAccountId = async (accountId) => {
  const raw = String(accountId || '');
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;

  const select = '_id name status availabilityStatus';
  const direct = await FoodDeliveryPartner.findById(raw).select(select).lean();
  if (direct) return direct;
  return FoodDeliveryPartner.findOne({ identityId: raw }).select(select).lean();
};

/** Platform roles that are riders. */
export const RIDER_PLATFORM_ROLES = ['DELIVERY_PARTNER', 'DRIVER'];
