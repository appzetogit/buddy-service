import express from 'express';
import { upload } from '../../../middleware/upload.js';
import { uploadFileBuffer, uploadImageBuffer, uploadVideoBuffer } from '../../../services/localUpload.service.js';

const router = express.Router();

// POST /v1/uploads/image
router.post('/image', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const folder = typeof req.body?.folder === 'string' && req.body.folder.trim()
            ? req.body.folder.trim()
            : 'uploads';

        const url = await uploadImageBuffer(req.file.buffer, folder);

        return res.status(200).json({
            success: true,
            message: 'Image uploaded successfully',
            data: {
                url,
                publicId: null
            }
        });
    } catch (error) {
        next(error);
    }
});

// POST /v1/uploads/audio — short voice notes (parcel instructions). Only an
// .m4a (AAC in an MP4 box, what the apps record) of at most 1 MB; anything
// else is refused so the folder cannot hold arbitrary files.
const MAX_AUDIO_BYTES = 1024 * 1024;
router.post('/audio', upload.single('file'), async (req, res, next) => {
    try {
        const buf = req.file?.buffer;
        if (!buf) {
            return res.status(400).json({ success: false, message: 'No file provided' });
        }
        if (buf.length > MAX_AUDIO_BYTES) {
            return res.status(400).json({ success: false, message: 'Voice note is too long' });
        }
        // MP4 container: bytes 4..7 are "ftyp".
        if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') {
            return res.status(400).json({ success: false, message: 'Only .m4a voice notes are allowed' });
        }
        const folder = typeof req.body?.folder === 'string' && req.body.folder.trim()
            ? req.body.folder.trim()
            : 'uploads';
        const url = await uploadFileBuffer(buf, folder, { format: 'm4a' });
        return res.status(200).json({
            success: true,
            message: 'Audio uploaded successfully',
            data: { url, publicId: null },
        });
    } catch (error) {
        next(error);
    }
});

// POST /v1/uploads/file
router.post('/file', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const mimeType = String(req.file.mimetype || '').toLowerCase();
        const originalName = String(req.file.originalname || '').toLowerCase();
        const isPdf = mimeType === 'application/pdf' || originalName.endsWith('.pdf');
        if (!isPdf) {
            return res.status(400).json({
                success: false,
                message: 'Only PDF files are allowed'
            });
        }

        const folder = typeof req.body?.folder === 'string' && req.body.folder.trim()
            ? req.body.folder.trim()
            : 'uploads';

        const url = await uploadFileBuffer(req.file.buffer, folder, {
            fileName: req.file.originalname || 'menu.pdf',
            format: 'pdf'
        });

        return res.status(200).json({
            success: true,
            message: 'File uploaded successfully',
            data: {
                url,
                publicId: null
            }
        });
    } catch (error) {
        next(error);
    }
});

// POST /v1/uploads/video
router.post('/video', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const mimeType = String(req.file.mimetype || '').toLowerCase();
        if (!mimeType.startsWith('video/')) {
            return res.status(400).json({
                success: false,
                message: 'Only video files are allowed'
            });
        }

        const folder = typeof req.body?.folder === 'string' && req.body.folder.trim()
            ? req.body.folder.trim()
            : 'uploads/videos';

        const url = await uploadVideoBuffer(req.file.buffer, folder);

        return res.status(200).json({
            success: true,
            message: 'Video uploaded successfully',
            data: {
                url,
                publicId: null
            }
        });
    } catch (error) {
        next(error);
    }
});

export default router;

