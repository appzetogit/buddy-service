/**
 * Local-disk replacement for cloudinary.service.js — files are written under config.uploadRoot
 * and served back by express.static (see app.js) instead of Cloudinary's CDN.
 *
 * Every export here keeps the exact name, signature and return shape the original Cloudinary
 * service had, so the ~16 call sites across the app (food/admin/restaurant/quick-commerce
 * services, the generic /uploads routes, bulk import) needed zero changes.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const DEFAULT_QUALITY = Number(process.env.FOOD_IMAGE_QUALITY || 82);
const MAX_DIMENSION = Number(process.env.FOOD_IMAGE_MAX_DIMENSION || 2048);
const LOCAL_UPLOAD_HOST_RE = () => new RegExp(`^${config.uploadPublicHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${config.uploadPublicBaseUrl}/`, 'i');

export const ensureUploadRoot = () => {
    try {
        fs.mkdirSync(config.uploadRoot, { recursive: true });
    } catch (err) {
        logger.error(`[LocalUpload] failed to create upload root ${config.uploadRoot}: ${err.message}`);
    }
};

const safeFolder = (folder) =>
    String(folder || 'uploads')
        .split('/')
        .map((segment) => segment.trim().replace(/[^a-zA-Z0-9_-]/g, '_'))
        .filter(Boolean)
        .join('/') || 'uploads';

/** "<folder>/<uuid>" — mirrors Cloudinary's public_id shape (folder + unique id, no extension). */
const buildPublicId = (folder) => `${safeFolder(folder)}/${uuidv4()}`;

const absoluteUrlForRelativePath = (relativePath) =>
    `${config.uploadPublicHost}${config.uploadPublicBaseUrl}/${relativePath.split(path.sep).join('/')}`;

const writeBufferToDisk = (relativePathNoExt, extension, buffer) => {
    const relativePath = `${relativePathNoExt}.${extension}`;
    const absolutePath = path.join(config.uploadRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);
    return relativePath;
};

export const extractImagePublicIdFromUrl = (imageUrl) => {
    const raw = String(imageUrl || '').trim();
    if (!raw || !LOCAL_UPLOAD_HOST_RE().test(raw)) return '';
    const afterBase = raw.replace(LOCAL_UPLOAD_HOST_RE(), '');
    return afterBase.replace(/\.[a-z0-9]+$/i, '');
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

        logger.info(`[LocalUpload] compression_completed ${JSON.stringify({
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
        logger.error(`[LocalUpload] compression_failed ${error.message}`);
        const wrapped = new Error(`Image compression failed: ${error.message}`);
        wrapped.statusCode = 400;
        throw wrapped;
    }
};

const uploadCompressedBuffer = async (buffer, folder, options = {}) => {
    const mimeType = String(options.mimeType || '').trim().toLowerCase();
    const skipCompression = options.skipCompression === true;

    logger.info(`[LocalUpload] upload_started ${JSON.stringify({ folder, mimeType })}`);

    let uploadBuffer = buffer;
    let uploadFormat = options.format || 'webp';

    if (!skipCompression) {
        const compressed = await compressImage(buffer, {
            mimeType,
            quality: options.quality,
            maxDimension: options.maxDimension,
        });
        uploadBuffer = compressed.buffer;
        uploadFormat = compressed.format;
    }

    const publicId = buildPublicId(folder);
    const relativePath = writeBufferToDisk(publicId, uploadFormat, uploadBuffer);
    const secureUrl = absoluteUrlForRelativePath(relativePath);

    logger.info(`[LocalUpload] upload_successful ${JSON.stringify({
        folder,
        publicId,
        bytes: uploadBuffer.length,
    })}`);

    return { public_id: publicId, secure_url: secureUrl, bytes: uploadBuffer.length, format: uploadFormat };
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

    // publicId has no extension (matches Cloudinary's shape) — the on-disk file does, and we
    // don't track format separately, so try the formats compressImage/uploadFileBuffer/
    // uploadVideoBuffer can actually produce.
    const candidateExtensions = ['webp', 'png', 'gif', 'jpg', 'jpeg', 'mp4', 'mov', 'pdf', 'raw'];
    let deletedAny = false;

    for (const ext of candidateExtensions) {
        const absolutePath = path.join(config.uploadRoot, `${normalizedPublicId}.${ext}`);
        try {
            if (fs.existsSync(absolutePath)) {
                fs.unlinkSync(absolutePath);
                deletedAny = true;
            }
        } catch (error) {
            logger.error(`[LocalUpload] delete_failed ${error.message}`);
            if (!options.ignoreErrors) throw error;
        }
    }

    if (deletedAny) {
        logger.info(`[LocalUpload] delete_successful ${JSON.stringify({ publicId: normalizedPublicId })}`);
    }
    // Matches Cloudinary's semantics: "not found" also counts as deleted=true (nothing left behind).
    return { deleted: true, result: deletedAny ? 'ok' : 'not found' };
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
        logger.info(`[LocalUpload] old_image_deleted ${JSON.stringify({ publicId: previousPublicId })}`);
    }

    logger.info(`[LocalUpload] image_replacement_completed ${JSON.stringify({
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
    const publicId = buildPublicId(folder);
    const relativePath = writeBufferToDisk(publicId, 'mp4', buffer);
    return absoluteUrlForRelativePath(relativePath);
};

export const uploadFileBuffer = async (buffer, folder = 'uploads', options = {}) => {
    if (!buffer) {
        throw new Error('File buffer is required');
    }

    const format = typeof options.format === 'string' && options.format.trim()
        ? options.format.trim().toLowerCase()
        : 'pdf';

    const publicId = buildPublicId(folder);
    const relativePath = writeBufferToDisk(publicId, format, buffer);
    return absoluteUrlForRelativePath(relativePath);
};

/** Cloudinary's buildRawDownloadUrlFromFileUrl forced an attachment download via a signed URL.
 *  Locally served files don't need signing — express.static serves them directly, so this is
 *  just a passthrough. A Content-Disposition header, if ever needed, belongs on the static route. */
export const buildRawDownloadUrlFromFileUrl = (fileUrl) => String(fileUrl || '');
