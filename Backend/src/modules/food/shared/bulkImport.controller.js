import { sendResponse, sendError } from '../../../utils/response.js';
import {
    parseWorkbookRows,
    buildImageMap,
    bulkCreateFoods,
    bulkCreateAddons,
    generateTemplateBuffer,
} from './bulkImport.service.js';

async function runBulkImport(req, res, next, { kind, isAdmin, restaurantId }) {
    try {
        const file = req.files?.file?.[0];
        if (!file) return sendError(res, 400, 'Excel file is required');
        const rows = await parseWorkbookRows(file.buffer);
        if (rows.length === 0) return sendError(res, 400, 'No data rows found in the excel file');
        const imagesMap = buildImageMap(req.files?.images || []);
        const data = kind === 'food'
            ? await bulkCreateFoods({ rows, imagesMap, isAdmin, restaurantId })
            : await bulkCreateAddons({ rows, imagesMap, isAdmin, restaurantId });
        return sendResponse(res, 200, 'Bulk upload processed', data);
    } catch (error) {
        next(error);
    }
}

async function downloadTemplate(req, res, next, { kind, includeRestaurant }) {
    try {
        const buffer = await generateTemplateBuffer({ kind, includeRestaurant });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${kind}-bulk-upload-template.xlsx"`);
        res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
}

// Admin: restaurant chosen per-row by "Restaurant Name" in the sheet.
export const bulkUploadFoodsAdmin = (req, res, next) =>
    runBulkImport(req, res, next, { kind: 'food', isAdmin: true });
export const bulkUploadAddonsAdmin = (req, res, next) =>
    runBulkImport(req, res, next, { kind: 'addon', isAdmin: true });
export const downloadFoodTemplateAdmin = (req, res, next) =>
    downloadTemplate(req, res, next, { kind: 'food', includeRestaurant: true });
export const downloadAddonTemplateAdmin = (req, res, next) =>
    downloadTemplate(req, res, next, { kind: 'addon', includeRestaurant: true });

// Restaurant self-service: every row belongs to the authenticated restaurant.
export const bulkUploadFoodsRestaurant = (req, res, next) =>
    runBulkImport(req, res, next, { kind: 'food', isAdmin: false, restaurantId: req.user?.userId });
export const bulkUploadAddonsRestaurant = (req, res, next) =>
    runBulkImport(req, res, next, { kind: 'addon', isAdmin: false, restaurantId: req.user?.userId });
export const downloadFoodTemplateRestaurant = (req, res, next) =>
    downloadTemplate(req, res, next, { kind: 'food', includeRestaurant: false });
export const downloadAddonTemplateRestaurant = (req, res, next) =>
    downloadTemplate(req, res, next, { kind: 'addon', includeRestaurant: false });
