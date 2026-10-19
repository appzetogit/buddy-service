import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const toggleBoolSchema = z.object({
  status: z.boolean().optional(),
});

export const validateOptionalStatusDto = (body) => {
  const result = toggleBoolSchema.safeParse(body || {});
  if (!result.success) {
    throw new ValidationError(result.error.errors[0].message);
  }
  return result.data;
};



const rangeSchema = z.object({
  name: z.string().optional().default(''),
  min: z.number().min(0),
  max: z.number().min(0),
  fee: z.number().min(0),
  deliveryBoyPerKm: z.number().min(0).optional().default(0),
  deliveryBoyBasePay: z.number().min(0).optional().default(0),
  status: z.boolean().optional().default(true)
});

const feeSettingsUpsertSchema = z.object({
  deliveryFeeRanges: z.array(rangeSchema).optional(),
  platformFee: z.number().min(0).nullable().optional(),
  freeDeliveryThreshold: z.number().min(0).nullable().optional(),
  minWithdrawalAmount: z.number().min(0).nullable().optional(),
  maxWithdrawalAmount: z.number().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const validateFeeSettingsUpsertDto = (body) => {
  const normalized = {
    deliveryFeeRanges: Array.isArray(body?.deliveryFeeRanges)
      ? body.deliveryFeeRanges.map((r) => ({
          name: r?.name != null ? String(r.name) : '',
          min: Number(r?.min),
          max: Number(r?.max),
          fee: Number(r?.fee),
          deliveryBoyPerKm: Number(r?.deliveryBoyPerKm || 0),
          deliveryBoyBasePay: Number(r?.deliveryBoyBasePay || 0),
          status: r?.status !== false
        }))
      : undefined,
    platformFee:
      body?.platformFee === null
        ? null
        : body?.platformFee !== undefined
          ? Number(body.platformFee)
          : undefined,
    freeDeliveryThreshold:
      body?.freeDeliveryThreshold === null
        ? null
        : body?.freeDeliveryThreshold !== undefined
          ? Number(body.freeDeliveryThreshold)
          : undefined,
    minWithdrawalAmount:
      body?.minWithdrawalAmount === null
        ? null
        : body?.minWithdrawalAmount !== undefined
          ? Number(body.minWithdrawalAmount)
          : undefined,
    maxWithdrawalAmount:
      body?.maxWithdrawalAmount === null
        ? null
        : body?.maxWithdrawalAmount !== undefined
          ? Number(body.maxWithdrawalAmount)
          : undefined,
    isActive: body?.isActive !== undefined ? Boolean(body.isActive) : undefined,
  };

  const result = feeSettingsUpsertSchema.safeParse(normalized);
  if (!result.success) {
    throw new ValidationError(result.error.errors[0].message);
  }

  const ranges = Array.isArray(result.data.deliveryFeeRanges)
    ? result.data.deliveryFeeRanges
    : undefined;
  if (ranges) {
    for (const r of ranges) {
      if (r.min >= r.max) {
        throw new ValidationError('Each range must have min less than max');
      }
    }

    const active = ranges.filter((r) => r.status !== false);
    const baseSlabs = active.filter((r) => Number(r.min) === 0);
    if (active.length > 0 && baseSlabs.length === 0) {
      throw new ValidationError('A base slab with min distance = 0 is required');
    }
    if (baseSlabs.length > 1) {
      throw new ValidationError('Only one base slab (min distance = 0) is allowed. Please update the existing one instead.');
    }

    const sortedActive = [...active].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sortedActive.length; i += 1) {
      const prev = sortedActive[i - 1];
      const cur = sortedActive[i];
      if (cur.min === prev.min) {
        throw new ValidationError(`Duplicate range found for distance ${cur.min} km. Please edit the existing range instead.`);
      }
      if (cur.min < prev.max) {
        throw new ValidationError('Delivery fee ranges must not overlap');
      }
    }

    result.data.deliveryFeeRanges = [...ranges].sort((a, b) => a.min - b.min);
  }

  const minWd = result.data.minWithdrawalAmount;
  const maxWd = result.data.maxWithdrawalAmount;
  if (
    minWd != null &&
    maxWd != null &&
    Number(maxWd) > 0 &&
    Number(minWd) > Number(maxWd)
  ) {
    throw new ValidationError('Minimum withdrawal amount cannot exceed maximum');
  }

  return result.data;
};
