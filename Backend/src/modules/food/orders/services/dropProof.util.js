/**
 * Delivery proof photo: before asking the customer for the handover OTP, the rider photographs the
 * parcel where it was left. Shared by Food and Quick Commerce (both order models carry the same
 * `deliveryVerification` / `legs` shape).
 *
 *  - one rider  -> order.deliveryVerification.dropProof
 *  - two riders -> each leg has its own dropProofUrl (every rider proves their own drop)
 *  - several restaurants / stores do not matter here: there is still one drop per rider.
 */
import { ValidationError } from '../../../../core/auth/errors.js';

/** Set DROP_PROOF_REQUIRED=false to stop enforcing the photo (upload still works) - kill switch for rollout. */
export const isDropProofRequired = () => String(process.env.DROP_PROOF_REQUIRED ?? 'true').toLowerCase() !== 'false';

/** The photo is uploaded through the normal upload API first; here we only accept its http(s) URL. */
export function validateProofUrl(url) {
  const value = String(url || '').trim();
  if (!value || value.length > 1000 || !/^https?:\/\/[^\s]+$/i.test(value)) {
    throw new ValidationError('A valid delivery photo URL is required');
  }
  return value;
}

export const hasDropProof = (order, leg) =>
  leg ? Boolean(leg.dropProofUrl) : Boolean(order.deliveryVerification?.dropProof?.imageUrl);

/** Call right before an OTP is checked. */
export function assertDropProof(order, leg) {
  if (isDropProofRequired() && !hasDropProof(order, leg)) {
    throw new ValidationError('Take a photo of the delivered order before verifying the customer OTP.');
  }
}

/** The rider must be at the drop point (same phase the OTP is generated in). */
export function assertAtDrop(order, leg) {
  const atDrop = leg
    ? String(leg.status || '') === 'at_drop'
    : order.deliveryState?.currentPhase === 'at_drop' || order.deliveryState?.status === 'reached_drop';
  if (!atDrop) throw new ValidationError('Mark "reached drop" before uploading the delivery photo.');
}

/** Store the photo (a new upload replaces the old one while the OTP is still unverified). */
export function applyDropProof(order, leg, partnerId, imageUrl) {
  const now = new Date();
  if (leg) {
    leg.dropProofUrl = imageUrl;
    leg.dropProofAt = now;
    order.markModified('legs');
  } else {
    order.set('deliveryVerification.dropProof', { imageUrl, uploadedAt: now, partnerId });
  }
}

/** Customer-facing list: one entry per rider drop. */
export function buildDropProofs(order) {
  const legs = Array.isArray(order.legs) ? order.legs : [];
  const out = legs
    .filter((l) => l?.dropProofUrl)
    .map((l) => ({ legIndex: l.legIndex ?? null, imageUrl: l.dropProofUrl, uploadedAt: l.dropProofAt || null }));
  const single = order.deliveryVerification?.dropProof;
  if (single?.imageUrl) out.unshift({ legIndex: null, imageUrl: single.imageUrl, uploadedAt: single.uploadedAt || null });
  return out;
}
