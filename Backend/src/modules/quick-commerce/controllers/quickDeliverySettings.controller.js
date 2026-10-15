import { sendResponse, sendError } from '../../../utils/response.js';
import { logger } from '../../../utils/logger.js';
import {
  getPublicQuickDeliveryOptions,
  getQuickDeliverySettings,
  upsertQuickDeliverySettings,
} from '../services/quickDeliverySettings.service.js';

export const getAdminQuickDeliverySettings = async (req, res) => {
  try {
    const settings = await getQuickDeliverySettings({ fresh: true });
    return sendResponse(res, 200, 'Quick commerce delivery settings', { settings });
  } catch (error) {
    logger.error(`[QuickSettings] load failed: ${error.message}`);
    return sendError(res, 500, 'Failed to load delivery settings');
  }
};

export const updateAdminQuickDeliverySettings = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const noRiderMin = body.noRiderCancelMinutes !== undefined ? Number(body.noRiderCancelMinutes) : null;
    const ackTimeout = body.sellerAckTimeoutMinutes !== undefined ? Number(body.sellerAckTimeoutMinutes) : null;
    const ackResend = body.sellerAckResendMinutes !== undefined ? Number(body.sellerAckResendMinutes) : null;
    if (ackTimeout != null && ackResend != null && ackTimeout <= ackResend) {
      return sendError(res, 400, 'Store timeout must be longer than the reminder interval');
    }
    if (noRiderMin != null && !(noRiderMin >= 1)) {
      return sendError(res, 400, 'No-rider cancel time must be at least 1 minute');
    }
    const settings = await upsertQuickDeliverySettings(body);
    return sendResponse(res, 200, 'Delivery settings saved', { settings });
  } catch (error) {
    logger.error(`[QuickSettings] save failed: ${error.message}`);
    return sendError(res, 500, 'Failed to save delivery settings');
  }
};

/** Customer app: which payment/schedule/speed options exist right now. */
export const getPublicQuickDeliveryOptionsController = async (req, res) => {
  try {
    const options = await getPublicQuickDeliveryOptions();
    return sendResponse(res, 200, 'Quick commerce delivery options', options);
  } catch (error) {
    logger.error(`[QuickSettings] public options failed: ${error.message}`);
    return sendError(res, 500, 'Failed to load delivery options');
  }
};
