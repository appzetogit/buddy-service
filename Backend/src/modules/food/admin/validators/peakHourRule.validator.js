import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:MM (24-hour) format');

const peakHourRuleSchema = z.object({
  name: z.string().optional().or(z.literal('')),
  days: z.array(z.number().int().min(0).max(6)).optional().default([]),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  charge: z.number().min(0, 'Charge must be 0 or greater'),
  status: z.boolean().optional(),
});

export const validatePeakHourRuleDto = (body) => {
  const normalized = {
    name: body?.name != null ? String(body.name) : '',
    days: Array.isArray(body?.days) ? body.days.map((d) => Number(d)) : [],
    startTime: String(body?.startTime || ''),
    endTime: String(body?.endTime || ''),
    charge: body?.charge != null && body?.charge !== '' ? Number(body.charge) : Number.NaN,
    status: body?.status,
  };

  const result = peakHourRuleSchema.safeParse(normalized);
  if (!result.success) {
    throw new ValidationError(result.error.errors[0].message);
  }

  if (result.data.startTime === result.data.endTime) {
    throw new ValidationError('Start time and end time must be different');
  }

  return {
    name: result.data.name ? result.data.name.trim() : '',
    days: [...new Set(result.data.days)].sort((a, b) => a - b),
    startTime: result.data.startTime,
    endTime: result.data.endTime,
    charge: result.data.charge,
    status: result.data.status ?? true,
  };
};

const toggleBoolSchema = z.object({ status: z.boolean().optional() });

export const validateOptionalStatusDto = (body) => {
  const result = toggleBoolSchema.safeParse(body || {});
  if (!result.success) {
    throw new ValidationError(result.error.errors[0].message);
  }
  return result.data;
};
