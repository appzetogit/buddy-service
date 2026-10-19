import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:MM (24-hour) format');

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

const peakHourRuleSchema = z.object({
  name: z.string().optional().or(z.literal('')),
  dateMode: z.enum(['recurring', 'dates']).optional().default('recurring'),
  days: z.array(z.number().int().min(0).max(6)).optional().default([]),
  startDate: dateStringSchema.nullable().optional(),
  endDate: dateStringSchema.nullable().optional(),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  charge: z.number().min(0, 'Charge must be 0 or greater'),
  status: z.boolean().optional(),
});

export const validatePeakHourRuleDto = (body) => {
  const dateMode = body?.dateMode === 'dates' ? 'dates' : 'recurring';

  const normalized = {
    name: body?.name != null ? String(body.name) : '',
    dateMode,
    days: Array.isArray(body?.days) ? body.days.map((d) => Number(d)) : [],
    startDate: body?.startDate ? String(body.startDate) : null,
    endDate: body?.endDate ? String(body.endDate) : null,
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

  if (dateMode === 'dates') {
    if (!result.data.startDate && !result.data.endDate) {
      throw new ValidationError('A festival rule needs a start date, an end date, or both');
    }
    if (result.data.startDate && result.data.endDate && result.data.startDate > result.data.endDate) {
      throw new ValidationError('Start date must be on or before the end date');
    }
  }

  return {
    name: result.data.name ? result.data.name.trim() : '',
    dateMode,
    days: dateMode === 'recurring' ? [...new Set(result.data.days)].sort((a, b) => a - b) : [],
    startDate: dateMode === 'dates' ? result.data.startDate ?? null : null,
    endDate: dateMode === 'dates' ? result.data.endDate ?? null : null,
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
