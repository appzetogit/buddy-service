import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const DEFAULT_QUALITY = Number(process.env.FOOD_IMAGE_QUALITY || 82);
const MAX_DIMENSION = Number(process.env.FOOD_IMAGE_MAX_DIMENSION || 2048);
const CLOUDINARY_HOST_RE = /res\.cloudinary\.com/i;

cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
});

const ensureCredentials = () => {
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
        const error = new Error('Cloudinary credentials are not configured');
        error.statusCode = 500;
        throw error;
    }
};

export const extractImagePublicIdFromUrl = (imageUrl) => {
    const raw = String(imageUrl || '').trim();
    if (!raw || !CLOUDINARY_HOST_RE.test(raw)) return '';

    try {
        const url = new URL(raw);
        const parts = url.pathname.split('/').filter(Boolean);
        const uploadIndex = parts.findIndex((part) => part === 'upload');
        if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return '';

        let start = uploadIndex + 1;
        if (/^v\d+$/i.test(parts[start])) start += 1;

        const publicPath = parts.slice(start).join('/');
        if (!publicPath) return '';
        const decoded = decodeURIComponent(publicPath);
        return decoded.replace(/\.[a-z0-9]+$/i, '');
    } catch {
        return '';
    }
};

export const compressImage = async (buffer, options = {}) => {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        const error = new Error('A valid image buffer is required for compression');
        error.statusCode = 400;
        throw error;
    }

    const mimeType = String(options.mimeType || '').trim().toLowerCase();
    const quality = Number.isFinite(Number(options.quality)) ? Number(options.quality) : DEFAULT_QUALITY;
    const maxDimension = Number.isFinite(Number(options.maxDimension))
        ? Number(options.maxDimension)
        : MAX_DIMENSION;

    try {
        let pipeline = sharp(buffer, { failOn: 'none', animated: true }).rotate();
        const metadata = await pipeline.metadata();
        const originalBytes = buffer.length;

        if (
            (metadata.width && metadata.width > maxDimension) ||
            (metadata.height && metadata.height > maxDimension)
        ) {
            pipeline = pipeline.resize(maxDimension, maxDimension, {
                fit: 'inside',
                withoutEnlargement: true,
            });
        }

        const isGif = mimeType === 'image/gif' || metadata.format === 'gif';
        let outputBuffer;
        let outputMimeType;
        let format;

        if (isGif) {
            outputBuffer = await pipeline.gif().toBuffer();
            outputMimeType = 'image/gif';
            format = 'gif';
        } else if (mimeType === 'image/png' && metadata.hasAlpha) {
            outputBuffer = await pipeline.png({ quality, compressionLevel: 9 }).toBuffer();
            outputMimeType = 'image/png';
            format = 'png';
        } else {
            outputBuffer = await pipeline.webp({ quality, effort: 4 }).toBuffer();
            outputMimeType = 'image/webp';
            format = 'webp';
        }

        logger.info(`[Cloudinary] compression_completed ${JSON.stringify({
            originalBytes,
            compressedBytes: outputBuffer.length,
            format,
        })}`);

        return {
            buffer: outputBuffer,
            mimeType: outputMimeType,
            format,
            originalBytes,
            compressedBytes: outputBuffer.length,
        };
    } catch (error) {
        logger.error(`[Cloudinary] compression_failed ${error.message}`);
        const wrapped = new Error(`Image compression failed: ${error.message}`);
        wrapped.statusCode = 400;
        throw wrapped;
    }
};

const uploadCompressedBuffer = async (buffer, folder, options = {}) => {
    ensureCredentials();

    const mimeType = String(options.mimeType || '').trim().toLowerCase();
    const skipCompression = options.skipCompression === true;

    logger.info(`[Cloudinary] upload_started ${JSON.stringify({ folder, mimeType })}`);

    let uploadBuffer = buffer;
    let uploadFormat = options.format;

    if (!skipCompression) {
        const compressed = await compressImage(buffer, {
            mimeType,
            quality: options.quality,
            maxDimension: options.maxDimension,
        });
        uploadBuffer = compressed.buffer;
        uploadFormat = compressed.format;
    }

    const uploadOptions = {
        folder,
        resource_type: 'image',
        ...(uploadFormat ? { format: uploadFormat } : {}),
    };

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
            if (error) {
                logger.error(`[Cloudinary] upload_failed ${error.message}`);
                return reject(error);
            }
            logger.info(`[Cloudinary] upload_successful ${JSON.stringify({
                folder,
                publicId: result.public_id,
                bytes: result.bytes,
            })}`);
            return resolve(result);
        });
        stream.end(uploadBuffer);
    });
};

export const uploadImageBuffer = async (buffer, folder = 'uploads', options = {}) => {
    if (!buffer) {
        throw new Error('File buffer is required');
    }
    const result = await uploadCompressedBuffer(buffer, folder, options);
    return result.secure_url;
};

export const uploadImageBufferDetailed = async (buffer, folder = 'uploads', options = {}) => {
    if (!buffer) {
        throw new Error('File buffer is required');
    }
    return uploadCompressedBuffer(buffer, folder, options);
};

export const deleteFromCloudinary = async (publicId, options = {}) => {
    const normalizedPublicId = String(publicId || '').trim();
    if (!normalizedPublicId) {
        return { deleted: false, reason: 'missing_public_id' };
    }

    ensureCredentials();
    const resourceType = options.resourceType || 'image';

    try {
        const result = await cloudinary.uploader.destroy(normalizedPublicId, {
            resource_type: resourceType,
            invalidate: true,
        });
        const deleted = result.result === 'ok' || result.result === 'not found';
        if (deleted) {
            logger.info(`[Cloudinary] delete_successful ${JSON.stringify({ publicId: normalizedPublicId })}`);
        } else {
            logger.error(`[Cloudinary] delete_failed ${JSON.stringify({ publicId: normalizedPublicId, result: result.result })}`);
        }
        return { deleted, result: result.result };
    } catch (error) {
        logger.error(`[Cloudinary] delete_failed ${error.message}`);
        if (options.ignoreErrors) {
            return { deleted: false, error: error.message };
        }
        throw error;
    }
};

export const replaceCloudinaryImage = async ({
    buffer,
    folder,
    oldPublicId,
    oldUrl,
    mimeType,
} = {}) => {
    const uploaded = await uploadImageBufferDetailed(buffer, folder, { mimeType });
    const previousPublicId = String(oldPublicId || '').trim() || extractImagePublicIdFromUrl(oldUrl);

    if (previousPublicId && previousPublicId !== uploaded.public_id) {
        await deleteFromCloudinary(previousPublicId, { ignoreErrors: true });
        logger.info(`[Cloudinary] old_image_deleted ${JSON.stringify({ publicId: previousPublicId })}`);
    }

    logger.info(`[Cloudinary] image_replacement_completed ${JSON.stringify({
        folder,
        newPublicId: uploaded.public_id,
    })}`);

    return {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        secure_url: uploaded.secure_url,
        public_id: uploaded.public_id,
        raw: uploaded,
    };
};

export const uploadVideoBuffer = async (buffer, folder = 'uploads') => {
    if (!buffer) {
        throw new Error('File buffer is required');
    }

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: 'video' },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                return resolve(result.secure_url);
            }
        );

        stream.end(buffer);
    });
};

export const uploadFileBuffer = async (buffer, folder = 'uploads', options = {}) => {
    if (!buffer) {
        throw new Error('File buffer is required');
    }

    const fileName = typeof options.fileName === 'string' ? options.fileName.trim() : '';
    const rawBaseName = fileName ? fileName.replace(/\.[^/.]+$/, '') : '';
    const baseName = rawBaseName.replace(/[.\s]+$/g, '');
    const format = typeof options.format === 'string' && options.format.trim()
        ? options.format.trim().toLowerCase()
        : '';

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: 'raw',
                type: 'upload',
                access_mode: 'public',
                format: format || undefined,
                use_filename: Boolean(baseName),
                unique_filename: !baseName,
                filename_override: baseName || undefined,
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                return resolve(result.secure_url);
            }
        );

        stream.end(buffer);
    });
};

const stripTrailingExtension = (value) => {
    if (!value) return '';
    return value.replace(/\.[a-z0-9]{1,10}$/i, '');
};

const extractRawPublicIdFromUrl = (fileUrl, options = {}) => {
    const preserveExtension = Boolean(options.preserveExtension);
    try {
        const url = new URL(String(fileUrl));
        const path = url.pathname || '';

        const directMatch = preserveExtension
            ? path.match(/\/raw\/(?:upload|private|authenticated)\/(?:v\d+\/)?(.+?)\/?$/i)
            : path.match(/\/raw\/(?:upload|private|authenticated)\/(?:v\d+\/)?(.+?)(?:\.[^/.]+)?\/?$/i);
        if (directMatch?.[1]) {
            const decoded = decodeURIComponent(directMatch[1]);
            return preserveExtension ? decoded : stripTrailingExtension(decoded);
        }

        const parts = path.split('/').filter(Boolean);
        const rawIndex = parts.findIndex((part) => part.toLowerCase() === 'raw');
        if (rawIndex === -1 || rawIndex + 2 >= parts.length) return null;

        let start = rawIndex + 2;
        if (/^v\d+$/i.test(parts[start])) {
            start += 1;
        }

        const publicPath = parts.slice(start).join('/').replace(/\/+$/, '');
        if (!publicPath) return null;

        const decoded = decodeURIComponent(publicPath);
        return preserveExtension ? decoded : stripTrailingExtension(decoded);
    } catch {
        return null;
    }
};

const extractRawFormatFromUrl = (fileUrl) => {
    try {
        const url = new URL(String(fileUrl));
        const path = url.pathname || '';
        const match = path.match(/\.([a-z0-9]+)$/i);
        return match ? match[1].toLowerCase() : '';
    } catch {
        return '';
    }
};

export const buildRawDownloadUrlFromFileUrl = (fileUrl, options = {}) => {
    if (!fileUrl) return '';
    const normalizedPublicId = extractRawPublicIdFromUrl(fileUrl);
    const exactPublicId = extractRawPublicIdFromUrl(fileUrl, { preserveExtension: true });
    if (!normalizedPublicId && !exactPublicId) return String(fileUrl);

    const publicId = exactPublicId && /\.\.[a-z0-9]{1,10}$/i.test(exactPublicId)
        ? exactPublicId
        : (normalizedPublicId || exactPublicId);

    const format = options.format || extractRawFormatFromUrl(fileUrl) || 'pdf';
    const attachmentName = typeof options.fileName === 'string' && options.fileName.trim()
        ? options.fileName.trim()
        : 'menu.pdf';

    if (typeof cloudinary.utils?.private_download_url === 'function') {
        return cloudinary.utils.private_download_url(publicId, format, {
            resource_type: 'raw',
            type: 'upload',
            attachment: attachmentName,
        });
    }

    return cloudinary.url(publicId, {
        resource_type: 'raw',
        type: 'upload',
        sign_url: true,
        secure: true,
        format,
        flags: 'attachment',
    });
};
