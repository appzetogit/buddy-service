import express from 'express';
import { sendResponse } from '../../../utils/response.js';
import { ValidationError } from '../../../core/auth/errors.js';
import { COD_SERVICES, getCodSettings, getPaymentOptions, updateCodSettings } from './cod.service.js';

const wrap = (fn, status = 200, message = 'OK') => async (req, res, next) => {
  try {
    return sendResponse(res, status, message, await fn(req));
  } catch (err) {
    return next(err);
  }
};

/** Mounted at /v1/common/admin/cod-settings (admin guard applied where it is mounted). */
export const codAdminRouter = express.Router();
codAdminRouter.get('/', wrap(async () => ({ settings: await getCodSettings() })));
codAdminRouter.put('/', wrap(async (req) => ({ settings: await updateCodSettings(req.body) }), 200, 'COD settings saved'));

/**
 * Mounted at /v1/common/payment-options (public). `GET ?service=food|quickCommerce|taxi&total=250`
 * tells an app which payment options to show and, with `total`, the exact COD advance / remaining split.
 */
export const codPublicRouter = express.Router();
codPublicRouter.get('/', wrap(async (req) => {
  const service = String(req.query.service || '');
  if (!COD_SERVICES.includes(service)) throw new ValidationError('service must be food, quickCommerce or taxi');
  return getPaymentOptions(service, req.query.total);
}));
