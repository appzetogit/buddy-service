import { isPersonName } from '../../../../core/users/personName.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { AuthError, ValidationError } from '../../../../core/auth/errors.js';
import { replaceCloudinaryImage } from '../../services/foodImage.service.js';

const parseIsoDateOrNull = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

export const getCurrentUserProfile = async (userId) => {
    const user = await FoodUser.findById(userId).lean();
    if (!user) throw new AuthError('Profile not found');
    return user;
};

export const updateCurrentUserProfile = async (userId, payload = {}) => {
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    if (payload.name !== undefined) {
        const name = String(payload.name || '').trim();
        if (name && !isPersonName(name)) {
            throw new ValidationError('Name can only have letters');
        }
        user.name = name;
    }
    if (payload.email !== undefined) user.email = String(payload.email || '').trim();
    if (payload.phone !== undefined) user.phone = String(payload.phone || '').trim();
    if (payload.profileImage !== undefined) user.profileImage = String(payload.profileImage || '').trim();
    if (payload.gender !== undefined) user.gender = String(payload.gender || '').trim();
    if (payload.dateOfBirth !== undefined) {
        user.dateOfBirth = parseIsoDateOrNull(payload.dateOfBirth);
    }
    if (payload.anniversary !== undefined) {
        user.anniversary = parseIsoDateOrNull(payload.anniversary);
    }

    await user.save();
    return user.toObject();
};

export const uploadCurrentUserProfileImage = async (userId, file) => {
    if (!file?.buffer) throw new ValidationError('Image file is required');

    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    const asset = await replaceCloudinaryImage({
        buffer: file.buffer,
        folder: 'food/users/profile',
        oldUrl: user.profileImage,
        mimeType: file.mimetype,
    });
    user.profileImage = asset.url;
    await user.save();
    return { profileImage: asset.url };
};
