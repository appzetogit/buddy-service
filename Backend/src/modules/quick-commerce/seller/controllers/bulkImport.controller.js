import { sendResponse, sendError } from '../../../../utils/response.js';
import {
    parseWorkbookRows,
    buildImageMap,
    bulkCreateSellerProducts,
    generateSellerTemplateBuffer
} from '../services/bulkImport.service.js';

const sellerScope = (req) => req.user?.userId;

export async function downloadProductBulkTemplate(req, res, next) {
    try {
        const buffer = await generateSellerTemplateBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="product-bulk-upload-template.xlsx"');
        res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
}

export async function bulkUploadProductsExcelController(req, res, next) {
    try {
        const sellerId = sellerScope(req);
        const file = req.files?.file?.[0];
        if (!file) return sendError(res, 400, 'Excel file is required');
        const rows = await parseWorkbookRows(file.buffer);
        if (rows.length === 0) return sendError(res, 400, 'No data rows found in the excel file');
        const imagesMap = buildImageMap(req.files?.images || []);
        const data = await bulkCreateSellerProducts({ rows, imagesMap, sellerId });
        return sendResponse(res, 200, 'Bulk product upload processed', data);
    } catch (error) {
        next(error);
    }
}

// Admin: same flow, but the seller is the one the admin picked (form field), not the authenticated user.
export async function downloadProductBulkTemplateAdmin(req, res, next) {
    return downloadProductBulkTemplate(req, res, next);
}

export async function bulkUploadProductsExcelAdminController(req, res, next) {
    try {
        const sellerId = String(req.body?.sellerId || '').trim();
        if (!sellerId) return sendError(res, 400, 'sellerId is required');
        const file = req.files?.file?.[0];
        if (!file) return sendError(res, 400, 'Excel file is required');
        const rows = await parseWorkbookRows(file.buffer);
        if (rows.length === 0) return sendError(res, 400, 'No data rows found in the excel file');
        const imagesMap = buildImageMap(req.files?.images || []);
        const data = await bulkCreateSellerProducts({ rows, imagesMap, sellerId });
        return sendResponse(res, 200, 'Bulk product upload processed', data);
    } catch (error) {
        next(error);
    }
}
