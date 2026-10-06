import multer from 'multer';

const storage = multer.memoryStorage();

// Bulk Excel imports: one spreadsheet ('file') + the images it references ('images').
export const bulkUpload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per file
        files: 300,
    },
});
