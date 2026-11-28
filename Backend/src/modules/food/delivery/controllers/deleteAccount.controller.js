import { deleteDeliveryAccount } from '../services/deleteAccount.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { assertCanDeleteAccount, announceAccountDeleted } from '../../../../core/accountDeletion/accountDeletion.guard.js';
import { resolvePartnerObjectId } from '../services/riderCash.service.js';
import { FoodRefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';

export async function deleteDeliveryAccountController(req, res) {
    try {
        const tokenId = req.user?.userId;
        if (!tokenId) return sendError(res, 401, 'Authentication required');
        // A unified DRIVER token carries the identity id; the partner document has its own _id.
        const partnerId = String((await resolvePartnerObjectId(tokenId)) || tokenId);

        const reason = String(req.body?.reason || '').trim().slice(0, 300);
        await assertCanDeleteAccount('DRIVER', partnerId);
        const result = await deleteDeliveryAccount(partnerId, { reason, source: 'self' });
        if (!result) return sendError(res, 404, 'Driver account not found');
        const ids = [...new Set([String(tokenId), partnerId, String(req.user?.identityId || '')].filter(Boolean))];
        await FoodRefreshToken.deleteMany({ userId: { $in: ids } }).catch(() => {});
        void announceAccountDeleted({ type: 'DELIVERY_PARTNER', ...(result.deleted || {}), reason });
        return sendResponse(res, 200, result.message, null);
    } catch (error) {
        console.error('[deleteDeliveryAccount] Error:', error.message);
        return sendError(res, error.statusCode || 500, error.message || 'Failed to delete account');
    }
}
