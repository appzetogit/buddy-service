import {
    listHomeItems,
    createHomeItem,
    updateHomeItem,
    deleteHomeItem,
    getPublicHomeConfig,
} from '../services/homeConfig.service.js';
import { sendResponse } from '../../../utils/response.js';

const wrap = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (error) {
        next(error);
    }
};

export const getPublicHomeConfigController = wrap(async (req, res) =>
    sendResponse(res, 200, 'Home config fetched', await getPublicHomeConfig()));

export const listHomeItemsController = wrap(async (req, res) =>
    sendResponse(res, 200, 'Home items fetched', { items: await listHomeItems({ section: req.query.section }) }));

export const createHomeItemController = wrap(async (req, res) =>
    sendResponse(res, 201, 'Home item created', await createHomeItem(req.body, req.file)));

export const updateHomeItemController = wrap(async (req, res) =>
    sendResponse(res, 200, 'Home item updated', await updateHomeItem(req.params.id, req.body, req.file)));

export const deleteHomeItemController = wrap(async (req, res) => {
    const result = await deleteHomeItem(req.params.id);
    return sendResponse(res, 200, result.deleted ? 'Home item deleted' : 'Home item not found', result);
});
