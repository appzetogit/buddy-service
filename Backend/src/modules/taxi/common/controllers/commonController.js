import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { uploadDataUrl } from '../../shared/fileUpload.js';
import { env } from '../../shared/env.js';
import { getPublicActivePaymentGateway } from '../../services/paymentGatewayService.js';
import { buildPaymentRequestContext, logPaymentDiagnostic } from '../../services/paymentDiagnostics.js';

/**
 * Common controller for shared utilities like file uploads
 */
export const uploadImage = asyncHandler(async (req, res) => {
    const { image, folder = 'general' } = req.body;
    
    if (!image) {
        return res.status(400).json({ success: false, message: 'Image data is required' });
    }

    const uploadResult = await uploadDataUrl({
        dataUrl: image,
        folder: `${env.uploads.folder}/${folder}`,
        publicIdPrefix: `content-${folder}`
    });

    return res.json({
        success: true,
        data: {
            url: uploadResult.secureUrl,
            publicId: uploadResult.publicId,
            format: uploadResult.format
        }
    });
});



export const getPaymentGatewayConfig = asyncHandler(async (_req, res) => {
    const data = await getPublicActivePaymentGateway();

    return res.json({
        success: true,
        data,
    });
});

export const acknowledgePhonePeCallback = asyncHandler(async (req, res) => {
    logPaymentDiagnostic({
        provider: 'phonepe',
        scope: 'callback',
        stage: 'received',
        request: buildPaymentRequestContext(req),
        query: req.query || {},
        body: req.body || {},
    });

    return res.json({
        success: true,
        message: 'Callback received',
    });
});

