// Shared upload limits and validation helpers (client-side).

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

export const ALLOWED_IMAGE_WITH_GIF_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  'image/gif',
];

export const ALLOWED_UPLOAD_MIME_TYPES = [
  ...ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
  'application/pdf',
];

function imageLabelFromTypes(types) {
  const labels = [];
  const set = new Set(types || []);
  if (set.has('image/jpeg') || set.has('image/jpg')) labels.push('JPG');
  if (set.has('image/png')) labels.push('PNG');
  if (set.has('image/gif')) labels.push('GIF');
  if (set.has('image/webp')) labels.push('WEBP');
  return labels.length ? labels.join('/') : 'image';
}

export function validateFileUpload({
  file,
  maxBytes = MAX_UPLOAD_BYTES,
  allowedMimeTypes = ALLOWED_UPLOAD_MIME_TYPES,
} = {}) {
  if (!file) return 'File is required.';
  if (typeof file.size === 'number' && file.size > maxBytes) {
    return `File too large. Max size is ${Math.floor(maxBytes / (1024 * 1024))}MB.`;
  }
  if (file.type && !allowedMimeTypes.includes(file.type)) {
    const imageLabel = imageLabelFromTypes(allowedMimeTypes);
    const allowsPdf = allowedMimeTypes.includes('application/pdf');
    return allowsPdf
      ? `That file type isn’t supported. Please upload an image (${imageLabel}) or PDF.`
      : `That file type isn’t supported. Please upload an image (${imageLabel}).`;
  }
  return null;
}
