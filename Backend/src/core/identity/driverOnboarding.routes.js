import express from 'express';
import { sendResponse } from '../../utils/response.js';
import { authenticateIdentity } from './identity.middleware.js';
import {
  updateBasics,
  updateKyc,
  updateBank,
  updateVehicle,
  updateServices,
  updateFoodVehicle,
  updateTaxiVehicle,
  updateSelfie,
  completeOnboarding,
  enableCapability,
  getOnboardingState,
} from './driverOnboarding.service.js';

const router = express.Router();

// All onboarding endpoints accept a DRIVER token whose identity may have
// `onboardingComplete: false` — that's the whole point of the wizard.
const driverOnly = authenticateIdentity({ roles: ['DRIVER'], allowOnboarding: true });

router.get('/', driverOnly, async (req, res, next) => {
  try {
    const state = await getOnboardingState(req.identity);
    return sendResponse(res, 200, 'Onboarding state', state);
  } catch (err) {
    next(err);
  }
});

router.patch('/basics', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateBasics(req.identity, req.body);
    return sendResponse(res, 200, 'Basics saved', {
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/kyc', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateKyc(req.identity, req.body);
    return sendResponse(res, 200, 'KYC saved', {
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/bank', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateBank(req.identity, req.body);
    return sendResponse(res, 200, 'Bank details saved', {
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/services', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateServices(req.identity, req.body);
    return sendResponse(res, 200, 'Services saved', {
      onboardingStep: updated.onboardingStep,
      onboardingServices: updated.onboardingServices,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/vehicle-food', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateFoodVehicle(req.identity, req.body);
    return sendResponse(res, 200, 'Food vehicle saved', {
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/vehicle-taxi', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateTaxiVehicle(req.identity, req.body);
    return sendResponse(res, 200, 'Taxi vehicle saved', {
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/vehicle', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateVehicle(req.identity, req.body);
    return sendResponse(res, 200, 'Vehicle saved', {
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/selfie', driverOnly, async (req, res, next) => {
  try {
    const updated = await updateSelfie(req.identity, req.body);
    return sendResponse(res, 200, 'Selfie saved', {
      onboardingStep: updated.onboardingStep,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/complete', driverOnly, async (req, res, next) => {
  try {
    const result = await completeOnboarding(req.identity, req.body);
    return sendResponse(res, 200, 'Onboarding submitted for approval', result);
  } catch (err) {
    next(err);
  }
});

// Capability enable runs after onboarding is complete, so it needs the
// stricter middleware (no allowOnboarding flag).
router.post(
  '/capabilities/enable',
  authenticateIdentity({ roles: ['DRIVER'] }),
  async (req, res, next) => {
    try {
      const result = await enableCapability(req.identity, req.body?.service);
      return sendResponse(res, 200, 'Capability enabled', result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
