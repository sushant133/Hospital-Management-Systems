import multer from 'multer';
import ApiError from '../utils/ApiError.js';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/pdf',
]);

/**
 * Memory storage: the controller writes the file under the patient's folder
 * once the order is loaded. Avoids a temp-dir race and path traversal.
 */
export const radiologyImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 8 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(
      ApiError.badRequest(
        `Unsupported file type "${file.mimetype}". Use JPEG, PNG, WebP, TIFF or PDF.`,
        { code: 'UNSUPPORTED_FILE_TYPE' },
      ),
    );
  },
});

export const ALLOWED_RADIOLOGY_MIME_TYPES = [...ALLOWED_TYPES];

const DICOM_TYPES = new Set([
  'application/dicom',
  'application/dicom+json',
  'application/octet-stream',
]);

/**
 * DICOM instances from a modality or a USB dump. Memory storage — the
 * controller writes under uploads/dicom/<studyUid>/ after the header parse.
 */
export const dicomUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const name = (file.originalname || '').toLowerCase();
    if (DICOM_TYPES.has(file.mimetype) || name.endsWith('.dcm') || name.endsWith('.dicom')) {
      cb(null, true);
      return;
    }
    cb(
      ApiError.badRequest(
        `Unsupported file type "${file.mimetype}". Upload a .dcm / DICOM instance.`,
        { code: 'UNSUPPORTED_FILE_TYPE' },
      ),
    );
  },
});

export default radiologyImageUpload;
