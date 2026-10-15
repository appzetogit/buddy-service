/**
 * Image uploads for the taxi module use the platform's uploader (Cloudinary), so taxi images
 * live in the same place and follow the same configuration as Food / Quick Commerce uploads.
 */
import { uploadDataUrlToCloudinary } from '../../../utils/cloudinaryUpload.js';
import { env } from './env.js';

const safeSegment = (value, fallback = '') =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 80) || fallback;

const safeFolder = (value) =>
  String(value ?? '')
    .split('/')
    .map((segment) => safeSegment(segment))
    .filter(Boolean)
    .slice(0, 6)
    .join('/');

/** Keeps every taxi upload under one folder, whatever sub-folder the caller asked for. */
const resolveFolder = (folder) => {
  const root = safeFolder(env.uploads.folder) || 'taxi';
  const sub = safeFolder(folder);
  if (!sub || sub === root || sub.startsWith(`${root}/`)) return sub || root;
  return `${root}/${sub}`;
};

export const uploadDataUrl = async ({
  dataUrl,
  folder = env.uploads.folder,
  publicIdPrefix = 'taxi-image',
  publicIdSuffix = '',
}) =>
  uploadDataUrlToCloudinary({
    dataUrl,
    folder: resolveFolder(folder),
    publicIdPrefix: safeSegment(publicIdPrefix, 'taxi-image'),
    publicIdSuffix: safeSegment(publicIdSuffix),
  });

/** Same uploader; documents other than images are not stored by the platform uploader. */
export const uploadRawFile = uploadDataUrl;
