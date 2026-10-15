/**
 * Admin actions on a Quick Commerce order: cancel, assign / reassign a rider, add a second rider.
 * Thin HTTP layer over quickOrderFlows.service.js (same actions Food's admin has).
 */
import { sendResponse, sendError } from '../../../utils/response.js';
import { logger } from '../../../utils/logger.js';
import {
  adminAssignQuickRider,
  adminAssignSecondQuickRider,
  adminCancelQuickOrder,
  listAssignableQuickRiders,
} from '../services/quickOrderFlows.service.js';

const adminIdOf = (req) => req.user?.userId || req.user?._id || req.user?.id || null;

const sendFlowError = (res, error, fallback) => {
  const name = error?.name || '';
  const status = /Validation/.test(name) ? 400 : /Forbidden/.test(name) ? 403 : /NotFound/.test(name) ? 404 : 500;
  if (status === 500) logger.error(`[QuickAdminFlows] ${fallback}: ${error?.message}`);
  return sendError(res, status, status === 500 ? fallback : error.message);
};

const summarize = (order) => ({
  _id: order._id,
  orderId: order.orderId,
  orderStatus: order.orderStatus,
  dispatch: {
    status: order.dispatch?.status,
    deliveryPartnerId: order.dispatch?.deliveryPartnerId || null,
    sharedPartnerId: order.dispatch?.sharedPartnerId || null,
  },
});

export const cancelAdminQuickOrder = async (req, res) => {
  try {
    const { order, refund, message } = await adminCancelQuickOrder(
      req.params.orderId,
      adminIdOf(req),
      req.body?.reason,
    );
    return sendResponse(res, 200, message || 'Order cancelled', { order: summarize(order), refund: refund || null });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to cancel order');
  }
};

export const listAdminAssignableQuickRiders = async (req, res) => {
  try {
    const riders = await listAssignableQuickRiders(req.params.orderId);
    return sendResponse(res, 200, 'Available riders', { riders });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to load riders');
  }
};

export const assignAdminQuickRider = async (req, res) => {
  try {
    const partnerId = String(req.body?.deliveryPartnerId || '').trim();
    if (!partnerId) return sendError(res, 400, 'deliveryPartnerId is required');
    const order = await adminAssignQuickRider(req.params.orderId, partnerId, adminIdOf(req));
    return sendResponse(res, 200, 'Rider assigned', { order: summarize(order) });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to assign rider');
  }
};

export const assignAdminSecondQuickRider = async (req, res) => {
  try {
    const partnerId = String(req.body?.deliveryPartnerId || '').trim();
    if (!partnerId) return sendError(res, 400, 'deliveryPartnerId is required');
    const order = await adminAssignSecondQuickRider(req.params.orderId, partnerId, adminIdOf(req));
    return sendResponse(res, 200, 'Second rider assigned', { order: summarize(order) });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to assign second rider');
  }
};
