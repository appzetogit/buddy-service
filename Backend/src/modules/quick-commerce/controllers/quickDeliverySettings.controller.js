import { sendResponse, sendError } from '../../../utils/response.js';
import { logger } from '../../../utils/logger.js';
import {
  getPublicQuickDeliveryOptions,
  getQuickDeliverySettings,
  upsertQuickDeliverySettings,
  getPeakHourRules,
  createPeakHourRule,
  updatePeakHourRule,
  deletePeakHourRule,
  togglePeakHourRuleStatus,
  resolveActiveQuickPeakHourSurcharge,
} from '../services/quickDeliverySettings.service.js';
import {
  validatePeakHourRuleDto,
  validateOptionalStatusDto,
} from '../../food/admin/validators/peakHourRule.validator.js';

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

// ----- Peak Hour Rules (admin) -----
export const getPeakHourRulesController = async (req, res) => {
  try {
    const data = await getPeakHourRules();
    return sendResponse(res, 200, 'Peak hour rules fetched successfully', data);
  } catch (error) {
    logger.error(`[QuickSettings] get peak hour rules failed: ${error.message}`);
    return sendError(res, 500, 'Failed to load peak hour rules');
  }
};

export const createPeakHourRuleController = async (req, res) => {
  try {
    const body = validatePeakHourRuleDto(req.body || {});
    const rule = await createPeakHourRule(body);
    return sendResponse(res, 201, 'Peak hour rule created successfully', { rule });
  } catch (error) {
    logger.error(`[QuickSettings] create peak hour rule failed: ${error.message}`);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to create peak hour rule');
  }
};

export const updatePeakHourRuleController = async (req, res) => {
  try {
    const body = validatePeakHourRuleDto(req.body || {});
    const rule = await updatePeakHourRule(req.params.id, body);
    if (!rule) return sendError(res, 404, 'Peak hour rule not found');
    return sendResponse(res, 200, 'Peak hour rule updated successfully', { rule });
  } catch (error) {
    logger.error(`[QuickSettings] update peak hour rule failed: ${error.message}`);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to update peak hour rule');
  }
};

export const deletePeakHourRuleController = async (req, res) => {
  try {
    const result = await deletePeakHourRule(req.params.id);
    if (!result) return sendError(res, 404, 'Peak hour rule not found');
    return sendResponse(res, 200, 'Peak hour rule deleted successfully', result);
  } catch (error) {
    logger.error(`[QuickSettings] delete peak hour rule failed: ${error.message}`);
    return sendError(res, 500, 'Failed to delete peak hour rule');
  }
};

export const togglePeakHourRuleStatusController = async (req, res) => {
  try {
    const { status } = validateOptionalStatusDto(req.body || {});
    if (typeof status !== 'boolean') return sendError(res, 400, 'status is required');
    const rule = await togglePeakHourRuleStatus(req.params.id, status);
    if (!rule) return sendError(res, 404, 'Peak hour rule not found');
    return sendResponse(res, 200, 'Status updated successfully', { rule });
  } catch (error) {
    logger.error(`[QuickSettings] toggle peak hour rule failed: ${error.message}`);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to update status');
  }
};

export const getActivePeakHourSurchargeController = async (req, res) => {
  try {
    const surcharge = await resolveActiveQuickPeakHourSurcharge();
    return sendResponse(res, 200, 'Active peak hour surcharge fetched successfully', { surcharge });
  } catch (error) {
    logger.error(`[QuickSettings] active peak hour surcharge failed: ${error.message}`);
    return sendError(res, 500, 'Failed to load active peak hour surcharge');
  }
};
