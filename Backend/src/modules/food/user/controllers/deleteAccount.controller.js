import { deleteUserAccount } from '../services/deleteAccount.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { assertCanDeleteAccount, announceAccountDeleted } from '../../../../core/accountDeletion/accountDeletion.guard.js';
import { FoodRefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';

export async function deleteUserAccountController(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return sendError(res, 401, 'Authentication required');

        const reason = String(req.body?.reason || '').trim().slice(0, 300);
        await assertCanDeleteAccount('USER', userId);
        const result = await deleteUserAccount(userId, { reason, source: 'self' });
        await FoodRefreshToken.deleteMany({ userId }).catch(() => {});
        void announceAccountDeleted({ type: 'USER', ...(result.deleted || {}), reason });
        return sendResponse(res, 200, result.message, null);
    } catch (error) {
        console.error('[deleteUserAccount] Error:', error.message);
        return sendError(res, error.statusCode || 500, error.message || 'Failed to delete account');
    }
}
