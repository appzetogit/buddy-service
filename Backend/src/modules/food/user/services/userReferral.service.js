import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';
import { FoodReferralLog } from '../../admin/models/referralLog.model.js';
import { creditReferralReward } from './userWallet.service.js';

/** Shared by signup-time ref crediting (core/auth/auth.service.js) and applyUserReferral below. */
export const creditUserReferral = async (userDoc, referrerId, settingsDoc) => {
    const reward = Math.max(0, Number(settingsDoc?.referralRewardUser) || 0);
    const limit = Math.max(0, Number(settingsDoc?.referralLimitUser) || 0);
    const referrer = await FoodUser.findById(referrerId).select('_id referralCount').lean();

    if (!referrer || reward <= 0 || limit <= 0 || Number(referrer.referralCount || 0) >= limit) {
        await FoodReferralLog.create({
            referrerId,
            refereeId: userDoc._id,
            role: 'USER',
            rewardAmount: reward,
            status: 'rejected',
            reason: !referrer ? 'referrer_not_found' : reward <= 0 ? 'reward_disabled' : limit <= 0 ? 'limit_disabled' : 'limit_reached',
        });
        throw new ValidationError('Referral program is unavailable right now');
    }

    userDoc.referredBy = referrerId;
    await userDoc.save();

    const log = await FoodReferralLog.create({
        referrerId,
        refereeId: userDoc._id,
        role: 'USER',
        rewardAmount: reward,
        status: 'credited',
    });

    await Promise.all([
        FoodUser.updateOne({ _id: referrerId }, { $inc: { referralCount: 1 } }),
        creditReferralReward(referrerId, reward, {
            role: 'USER',
            refereeId: String(userDoc._id),
            referralLogId: String(log._id),
        }),
    ]);
};

export const applyUserReferral = async (userId, code) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const refRaw = String(code || '').trim();
    if (!refRaw || !mongoose.Types.ObjectId.isValid(refRaw)) {
        throw new ValidationError('Invalid referral code');
    }

    const referrerId = new mongoose.Types.ObjectId(refRaw);
    if (String(referrerId) === id) {
        throw new ValidationError('You cannot use your own referral code');
    }

    const userDoc = await FoodUser.findById(id);
    if (!userDoc) throw new ValidationError('User not found');
    if (userDoc.referredBy) {
        throw new ValidationError('A referral code is already applied to your account');
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (userDoc.createdAt && userDoc.createdAt < sevenDaysAgo) {
        throw new ValidationError('Referral codes can only be applied within 7 days of joining');
    }
    const hasOrdered = await FoodOrder.exists({ userId: id });
    if (hasOrdered) {
        throw new ValidationError('Referral codes can only be applied before your first order');
    }

    const settingsDoc = await FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    if (!settingsDoc) {
        throw new ValidationError('Referral program is currently disabled');
    }

    await creditUserReferral(userDoc, referrerId, settingsDoc);
    return { success: true };
};

export const getUserReferralStats = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const [user, wallet, settingsDoc] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()
    ]);

    return {
        referralCount: Number(user?.referralCount) || 0,
        totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
        rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0)
    };
};

export const getUserReferralDetails = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }

    const oid = new mongoose.Types.ObjectId(id);
    const [user, wallet, settingsDoc, logs] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean(),
        FoodReferralLog.find({ referrerId: oid, role: 'USER' })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean()
    ]);

    const refereeIds = Array.from(
        new Set(
            (Array.isArray(logs) ? logs : [])
                .map((log) => String(log?.refereeId || ''))
                .filter(Boolean)
        )
    )
        .filter((value) => mongoose.Types.ObjectId.isValid(value))
        .map((value) => new mongoose.Types.ObjectId(value));

    const referees = refereeIds.length
        ? await FoodUser.find({ _id: { $in: refereeIds } })
            .select('_id name phone profileImage')
            .lean()
        : [];

    const refereeMap = new Map(referees.map((entry) => [String(entry._id), entry]));

    const invitedFriends = (Array.isArray(logs) ? logs : []).map((log) => {
        const referee = refereeMap.get(String(log?.refereeId || ''));
        const rawPhone = String(referee?.phone || '');
        const maskedPhone = rawPhone
            ? `${rawPhone.slice(0, Math.min(3, rawPhone.length))}${'*'.repeat(Math.max(rawPhone.length - 5, 0))}${rawPhone.slice(-2)}`
            : '';

        return {
            id: String(log?._id || ''),
            refereeId: String(log?.refereeId || ''),
            name: String(referee?.name || '').trim() || 'Friend',
            phone: maskedPhone,
            profileImage: String(referee?.profileImage || '').trim() || '',
            status: String(log?.status || 'pending'),
            reason: String(log?.reason || ''),
            rewardAmount: Math.max(0, Number(log?.rewardAmount) || 0),
            earnedAmount: String(log?.status || '') === 'credited' ? Math.max(0, Number(log?.rewardAmount) || 0) : 0,
            invitedAt: log?.createdAt || null
        };
    });

    const totalInvited = invitedFriends.length;
    const creditedCount = invitedFriends.filter((entry) => entry.status === 'credited').length;
    const pendingCount = invitedFriends.filter((entry) => entry.status === 'pending').length;
    const rejectedCount = invitedFriends.filter((entry) => entry.status === 'rejected').length;

    return {
        stats: {
            referralCount: Number(user?.referralCount) || 0,
            totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
            rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0),
            totalInvited,
            creditedCount,
            pendingCount,
            rejectedCount
        },
        invitedFriends
    };
};
