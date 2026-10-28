import {
    compressImage,
    deleteFromCloudinary,
    extractImagePublicIdFromUrl,
    replaceCloudinaryImage,
    uploadImageBufferDetailed,
} from '../../../services/localUpload.service.js';
import { logger } from '../../../utils/logger.js';

export {
    compressImage,
    deleteFromCloudinary,
    extractImagePublicIdFromUrl,
    replaceCloudinaryImage,
};

export const getImageUrl = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object' && value.url) return String(value.url).trim();
    return '';
};

export const getImagePublicId = (value, fallbackPublicId = '') => {
    if (value && typeof value === 'object' && value.publicId) {
        return String(value.publicId).trim();
    }
    return String(fallbackPublicId || '').trim();
};

export const toImageAsset = (uploadResult) => ({
    url: uploadResult?.secure_url || uploadResult?.secureUrl || '',
    publicId: uploadResult?.public_id || uploadResult?.publicId || '',
});

export const normalizeImageAssetList = (items = []) => {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => ({
            url: getImageUrl(item),
            publicId: getImagePublicId(item),
        }))
        .filter((item) => item.url);
};

export const uploadToCloudinary = async (buffer, folder = 'food/uploads', options = {}) => {
    return uploadImageBufferDetailed(buffer, folder, options);
};

export const deleteFoodImageAsset = async ({ publicId, url } = {}, options = {}) => {
    const resolvedPublicId = String(publicId || '').trim() || extractImagePublicIdFromUrl(url);
    if (!resolvedPublicId) {
        return { deleted: false, reason: 'no_public_id' };
    }
    return deleteFromCloudinary(resolvedPublicId, { ignoreErrors: options.ignoreErrors !== false });
};

export const uploadFoodImage = async (fileOrBuffer, folder, options = {}) => {
    const buffer = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fileOrBuffer?.buffer;
    const mimeType = options.mimeType || fileOrBuffer?.mimetype || '';
    const result = await uploadImageBufferDetailed(buffer, folder, { mimeType, ...options });
    return toImageAsset(result);
};

export const uploadFoodImageUrl = async (fileOrBuffer, folder, options = {}) => {
    const asset = await uploadFoodImage(fileOrBuffer, folder, options);
    return asset.url;
};

export const setRestaurantImageField = (target, field, asset, publicIds = {}) => {
    const url = getImageUrl(asset);
    if (!url) return;
    target[field] = url;
    if (asset?.publicId) {
        publicIds[field] = asset.publicId;
    }
};

export const collectImageAssetsFromRestaurant = (restaurant = {}) => {
    const assets = [];
    const publicIds = restaurant.imagePublicIds && typeof restaurant.imagePublicIds === 'object'
        ? restaurant.imagePublicIds
        : {};

    ['profileImage', 'panImage', 'gstImage', 'fssaiImage', 'upiQrImage'].forEach((field) => {
        const url = getImageUrl(restaurant[field]);
        if (!url) return;
        assets.push({
            url,
            publicId: getImagePublicId(restaurant[field], publicIds[field]),
        });
    });

    normalizeImageAssetList(restaurant.coverImages).forEach((asset) => assets.push(asset));
    normalizeImageAssetList(restaurant.menuImages).forEach((asset) => assets.push(asset));

    return assets;
};

export const deleteCollectedImageAssets = async (assets = []) => {
    const seen = new Set();
    for (const asset of assets) {
        const publicId = getImagePublicId(asset) || extractImagePublicIdFromUrl(getImageUrl(asset));
        if (!publicId || seen.has(publicId)) continue;
        seen.add(publicId);
        await deleteFoodImageAsset({ publicId, url: getImageUrl(asset) });
    }
};

export const logFoodImageEvent = (event, details = {}) => {
    logger.info(`[FoodImage] ${event} ${JSON.stringify(details)}`);
};
