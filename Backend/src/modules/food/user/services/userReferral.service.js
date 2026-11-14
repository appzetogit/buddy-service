import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';
import { FoodReferralLog } from '../../admin/models/referralLog.model.js';
import { creditReferralReward } from './userWallet.service.js';

/** A short code people can read out and type: up to 4 letters of the name + 4 digits ("RIDH4821"). */
export const shortReferralCode = (name, digits = Math.floor(1000 + Math.random() * 9000)) => {
    const letters = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'BUDY';
    return `${letters}${digits}`;
};

const isLegacyCode = (code, userId) => !code || code === String(userId) || mongoose.Types.ObjectId.isValid(code);

/**
 * The user's short referral code, made (and saved) the first time it is needed. Accounts from
 * before short codes carried their id as the code; those get a short one too, and their id keeps
 * working through [resolveReferrerId], so links already shared are not broken.
 */
export const ensureShortReferralCode = async (userDoc) => {
    if (!userDoc || !isLegacyCode(userDoc.referralCode, userDoc._id)) return userDoc?.referralCode || '';
    for (let i = 0; i < 8; i += 1) {
        const code = shortReferralCode(userDoc.name);
        // ponytail: check-then-write; two users racing to the same random code is ~1 in 9000, add a unique index if it ever matters.
        if (!(await FoodUser.exists({ referralCode: code }))) {
            await FoodUser.updateOne({ _id: userDoc._id }, { $set: { referralCode: code } });
            userDoc.referralCode = code;
            return code;
        }
    }
    return userDoc.referralCode || String(userDoc._id);
};

/** The referrer behind a typed code: a short code ("RIDH4821") or, for old links, an account id. */
export const resolveReferrerId = async (code) => {
    const raw = String(code || '').trim();
    if (!raw) return null;
    if (mongoose.Types.ObjectId.isValid(raw)) {
        const byId = await FoodUser.exists({ _id: raw });
        if (byId) return new mongoose.Types.ObjectId(raw);
    }
    const byCode = await FoodUser.findOne({ referralCode: raw.toUpperCase() }).select('_id').lean();
    return byCode?._id || null;
};

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
    const referrerId = await resolveReferrerId(code);
    if (!referrerId) {
        throw new ValidationError('Invalid referral code');
    }
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
        FoodUser.findById(oid).select('_id name referralCount referralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean(),
        FoodReferralLog.find({ referrerId: oid, role: 'USER' })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean()
    ]);
    if (user) user.referralCode = await ensureShortReferralCode(user);

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
        referralCode: user?.referralCode || '',
        // Off when no active settings, or a zero reward or limit: a code shared now earns nothing.
        programActive: Boolean(
            settingsDoc &&
            Number(settingsDoc.referralRewardUser) > 0 &&
            Number(settingsDoc.referralLimitUser) > 0
        ),
        invitedFriends
    };
};
