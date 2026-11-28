import { deleteRestaurantAccount } from '../services/deleteAccount.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { assertCanDeleteAccount, announceAccountDeleted } from '../../../../core/accountDeletion/accountDeletion.guard.js';
import { FoodRefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';
import { invalidateCache } from '../../../../middleware/cache.js';

export async function deleteRestaurantAccountController(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return sendError(res, 401, 'Authentication required');

        const reason = String(req.body?.reason || '').trim().slice(0, 300);
        await assertCanDeleteAccount('RESTAURANT', userId);
        const result = await deleteRestaurantAccount(userId, { reason, source: 'self' });
        await FoodRefreshToken.deleteMany({ userId }).catch(() => {});
        // The restaurant and its foods are gone: drop cached restaurant / menu lists so customers stop seeing them at once.
        await Promise.all(['*restaurant*', '*food*', '*menu*', '*home*'].map((p) => invalidateCache(p).catch(() => {})));
        void announceAccountDeleted({ type: 'RESTAURANT', ...(result.deleted || {}), reason });
        return sendResponse(res, 200, result.message, null);
    } catch (error) {
        console.error('[deleteRestaurantAccount] Error:', error.message);
        return sendError(res, error.statusCode || 500, error.message || 'Failed to delete account');
    }
}
