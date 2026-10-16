import { Router } from 'express';
import * as commonController from '../controllers/commonController.js';
import { authenticate } from '../../middlewares/authMiddleware.js';

export const commonRouter = Router();

// Universal image upload endpoint (signed-in riders and admins only: it writes to shared storage)
commonRouter.post('/common/upload/image', authenticate(['user', 'admin']), commonController.uploadImage);
commonRouter.get('/common/payment-gateway', commonController.getPaymentGatewayConfig);
commonRouter.post('/common/payment-gateway/phonepe/callback', commonController.acknowledgePhonePeCallback);
