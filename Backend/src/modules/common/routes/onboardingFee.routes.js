import express from 'express';
import { getPublicOnboardingFees, createOnboardingPaymentOrder } from '../controllers/onboardingFee.controller.js';

const router = express.Router();

router.get('/public', getPublicOnboardingFees);
router.post('/public/create-order', createOnboardingPaymentOrder);

export default router;
