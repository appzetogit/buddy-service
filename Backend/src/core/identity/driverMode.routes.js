import express from 'express';
import { sendResponse } from '../../utils/response.js';
import { authenticateIdentity } from './identity.middleware.js';
import { setDriverMode, getDriverMode } from './driverMode.service.js';

const router = express.Router();

const driverOnly = authenticateIdentity({ roles: ['DRIVER'] });

router.get('/mode', driverOnly, async (req, res, next) => {
  try {
    const state = await getDriverMode(req.identity);
    return sendResponse(res, 200, 'Current driver mode', state);
  } catch (err) {
    next(err);
  }
});

router.post('/mode', driverOnly, async (req, res, next) => {
  try {
    const { mode, latitude, longitude, selfieImageUrl } = req.body || {};
    const result = await setDriverMode(req.identity, mode, {
      latitude,
      longitude,
      selfieImageUrl,
    });
    return sendResponse(res, 200, `Mode set to ${mode}`, result);
  } catch (err) {
    next(err);
  }
});

export default router;
