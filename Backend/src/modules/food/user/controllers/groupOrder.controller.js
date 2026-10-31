import { sendResponse } from '../../../../utils/response.js';
import {
  createGroupOrder,
  getGroupOrder,
  joinGroupOrder,
  setMyGroupItems,
  markGroupOrderPlaced,
  leaveGroupOrder,
} from '../services/groupOrder.service.js';

const handle = (fn, message, status = 200) => async (req, res, next) => {
  try {
    return sendResponse(res, status, message, await fn(req.user?.userId, req));
  } catch (err) {
    next(err);
  }
};

export const createGroupOrderController = handle((u, req) => createGroupOrder(u, req.body || {}), 'Group order created', 201);
export const getGroupOrderController = handle((u, req) => getGroupOrder(u, req.params.code), 'Group order');
export const joinGroupOrderController = handle((u, req) => joinGroupOrder(u, req.params.code), 'Joined group order');
export const setMyGroupItemsController = handle((u, req) => setMyGroupItems(u, req.params.code, req.body?.items), 'Items saved');
export const markGroupOrderPlacedController = handle((u, req) => markGroupOrderPlaced(u, req.params.code, req.body?.orderId), 'Group order placed');
export const leaveGroupOrderController = handle((u, req) => leaveGroupOrder(u, req.params.code), 'Left group order');
