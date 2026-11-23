import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  createDelivery,
  getDelivery,
  getDeliveryQuote,
  getMyActiveDelivery,
  listMyDeliveries,
} from '../controllers/deliveryController.js';
import { verifyCodAdvance } from '../controllers/rideController.js';

export const deliveryRouter = Router();

// Static paths (/quote, /active/me) must come before the /:deliveryId
// wildcard below, or Express would try to look up a delivery literally
// named "quote"/"active".
deliveryRouter.post('/quote', authenticate(['user']), asyncHandler(getDeliveryQuote));
deliveryRouter.post('/', authenticate(['user']), asyncHandler(createDelivery));
// COD parcel booking, step 2 (same handler as rides).
deliveryRouter.post('/cod-advance/verify', authenticate(['user']), asyncHandler(verifyCodAdvance));
deliveryRouter.get('/', authenticate(['user']), asyncHandler(listMyDeliveries));
deliveryRouter.get('/active/me', authenticate(['user', 'driver']), asyncHandler(getMyActiveDelivery));
deliveryRouter.get('/:deliveryId', authenticate(['user', 'driver']), asyncHandler(getDelivery));
