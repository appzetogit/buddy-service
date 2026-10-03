import { FoodUser } from '../users/user.model.js';
import { FoodReferralSettings } from '../../modules/food/admin/models/referralSettings.model.js';
import { FoodUserWallet } from '../../modules/food/user/models/userWallet.model.js';

export const getMasterProfile = async (userId) => {
    const foodUser = await FoodUser.findById(userId).lean();
    if (!foodUser) {
        throw new Error('User not found');
    }

    const [referralSettings, foodWallet] = await Promise.all([
        FoodReferralSettings.findOne({ isActive: true }).lean(),
        FoodUserWallet.findOne({ userId }).select('balance referralEarnings').lean()
    ]);

    return {
        personal: {
            name: foodUser.name || '',
            phone: foodUser.phone || '',
            email: foodUser.email || '',
            profileImage: foodUser.profileImage || '',
            gender: foodUser.gender || '',
            dateOfBirth: foodUser.dateOfBirth || null,
            anniversary: foodUser.anniversary || null
        },
        addresses: foodUser.addresses || [],
        wallets: {
            food_qc_balance: Number(foodWallet?.balance || 0),
        },
        referrals: {
            food_code: foodUser.referralCode || '',
            food_count: Number(foodUser.referralCount || 0),
            food_reward: Number(referralSettings?.referralRewardUser || 0),
        },
        modules: { food: true },
    };
};
