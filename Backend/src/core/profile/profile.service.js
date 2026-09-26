import { FoodUser } from '../users/user.model.js';
import QCOrder from '../../modules/quickCommerce/models/order.js';
import QCWishlist from '../../modules/quickCommerce/models/wishlist.js';
import QCPreference from '../../modules/quickCommerce/modules/notifications/preference.model.js';
import { FoodReferralSettings } from '../../modules/food/admin/models/referralSettings.model.js';
import { FoodUserWallet } from '../../modules/food/user/models/userWallet.model.js';

export const getMasterProfile = async (userId) => {
    const foodUser = await FoodUser.findById(userId).lean();
    if (!foodUser) {
        throw new Error('User not found');
    }

    const [orderCount, wishlistDoc, notificationPref, referralSettings, foodWallet] = await Promise.all([
        QCOrder.countDocuments({ customer: userId }),
        QCWishlist.findOne({ customerId: userId }).select('products').lean(),
        QCPreference.findOne({ userId, role: 'customer' }).lean(),
        FoodReferralSettings.findOne({ isActive: true }).lean(),
        FoodUserWallet.findOne({ userId }).select('balance referralEarnings').lean()
    ]);

    const wishlistCount = wishlistDoc?.products?.length || 0;

    const qc = {
        orderCount: Number(orderCount || 0),
        wishlistCount: Number(wishlistCount || 0),
        preferences: {
            vegMode: false,
            theme: 'light',
            notificationPreferences: notificationPref ? {
                orderUpdates: notificationPref.orderUpdates,
                deliveryUpdates: notificationPref.deliveryUpdates,
                promotions: notificationPref.promotions
            } : {
                orderUpdates: true,
                deliveryUpdates: true,
                promotions: false
            }
        }
    };

    const modules = {
        food: true,
        qc: {
            enabled: true,
            orderCount: Number(orderCount || 0),
            wishlistCount: Number(wishlistCount || 0)
        },
    };

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
        modules,
        qc
    };
};
