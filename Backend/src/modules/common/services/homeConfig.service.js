import { HomeItem, HOME_SECTIONS, HOME_LINK_TYPES, HOME_SERVICE_KEYS } from '../models/homeItem.model.js';
import { uploadFoodImage, deleteFoodImageAsset } from '../../food/services/foodImage.service.js';
import { ValidationError, NotFoundError } from '../../../core/auth/errors.js';
import { invalidateCache } from '../../../middleware/cache.js';

// multipart/form-data sends every value as a string
const bool = (v, fallback) => (v === undefined ? fallback : v === true || v === 'true' || v === '1' || v === 1);

const clean = (body = {}, existing = null) => {
    const section = body.section ?? existing?.section;
    if (!HOME_SECTIONS.includes(section)) throw new ValidationError(`section must be one of: ${HOME_SECTIONS.join(', ')}`);

    const linkType = body.linkType ?? existing?.linkType ?? 'none';
    if (!HOME_LINK_TYPES.includes(linkType)) throw new ValidationError(`linkType must be one of: ${HOME_LINK_TYPES.join(', ')}`);
    const linkValue = linkType === 'none' ? '' : String(body.linkValue ?? existing?.linkValue ?? '').trim();
    if (linkType === 'service' && !HOME_SERVICE_KEYS.includes(linkValue)) {
        throw new ValidationError(`Service link must be one of: ${HOME_SERVICE_KEYS.join(', ')}`);
    }
    if (linkType === 'url' && !linkValue) throw new ValidationError('A link URL is required');

    const sortOrder = body.sortOrder === undefined || body.sortOrder === '' ? existing?.sortOrder ?? 0 : Number(body.sortOrder);
    if (!Number.isFinite(sortOrder)) throw new ValidationError('sortOrder must be a number');

    return {
        section,
        title: String(body.title ?? existing?.title ?? '').trim(),
        subtitle: String(body.subtitle ?? existing?.subtitle ?? '').trim(),
        iconKey: String(body.iconKey ?? existing?.iconKey ?? '').trim(),
        linkType,
        linkValue,
        sortOrder,
        isActive: bool(body.isActive, existing?.isActive ?? true),
    };
};

const assertComplete = (fields, imageUrl) => {
    const needsImage = ['hero_banner', 'service_card'].includes(fields.section);
    if (needsImage && !imageUrl) throw new ValidationError('An image is required');
    if (fields.section === 'feature' && !fields.title) throw new ValidationError('A title is required');
    if (fields.section === 'feature' && !imageUrl && !fields.iconKey) throw new ValidationError('Choose an icon or upload an image');
};

const bust = () => invalidateCache('home_config:*').catch(() => {});

export const listHomeItems = async ({ section } = {}) => {
    const filter = section ? { section } : {};
    return HomeItem.find(filter).sort({ section: 1, sortOrder: 1, createdAt: 1 }).lean();
};

export const createHomeItem = async (body, file) => {
    const fields = clean(body);
    let asset = { url: '', publicId: '' };
    if (file) asset = await uploadFoodImage(file, `home/${fields.section}`);
    assertComplete(fields, asset.url);
    const item = await HomeItem.create({ ...fields, imageUrl: asset.url, publicId: asset.publicId });
    await bust();
    return item.toObject();
};

export const updateHomeItem = async (id, body, file) => {
    const item = await HomeItem.findById(id);
    if (!item) throw new NotFoundError('Item not found');
    const fields = clean({ ...body, section: item.section }, item); // a row never moves between sections

    let imageUrl = item.imageUrl;
    let publicId = item.publicId;
    if (file) {
        const asset = await uploadFoodImage(file, `home/${item.section}`);
        await deleteFoodImageAsset({ publicId: item.publicId, url: item.imageUrl });
        imageUrl = asset.url;
        publicId = asset.publicId;
    }
    assertComplete(fields, imageUrl);
    item.set({ ...fields, imageUrl, publicId });
    await item.save();
    await bust();
    return item.toObject();
};

export const deleteHomeItem = async (id) => {
    const item = await HomeItem.findById(id);
    if (!item) return { deleted: false };
    await deleteFoodImageAsset({ publicId: item.publicId, url: item.imageUrl });
    await item.deleteOne();
    await bust();
    return { deleted: true };
};

const toPublic = (i) => ({
    id: String(i._id),
    title: i.title,
    subtitle: i.subtitle,
    imageUrl: i.imageUrl,
    iconKey: i.iconKey,
    linkType: i.linkType,
    linkValue: i.linkValue,
    sortOrder: i.sortOrder,
});

/** What the user apps render: only active rows, already ordered, grouped by section. */
export const getPublicHomeConfig = async () => {
    const rows = await HomeItem.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    const by = (section) => rows.filter((r) => r.section === section).map(toPublic);
    return {
        heroBanners: by('hero_banner'),
        serviceCards: by('service_card'),
        features: by('feature'),
    };
};
