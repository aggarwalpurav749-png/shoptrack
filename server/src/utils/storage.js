// Photo storage. Cloudinary when its 3 keys are set, otherwise the local server/uploads folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config');
const { HttpError } = require('./http');
const { sniffImage } = require('./sniff');

const cloudOn = () => !!(cfg.cloudinary.cloudName && cfg.cloudinary.apiKey && cfg.cloudinary.apiSecret);

let cld = null;
function cloudinary() {
  if (!cld) {
    cld = require('cloudinary').v2;
    cld.config({
      cloud_name: cfg.cloudinary.cloudName,
      api_key: cfg.cloudinary.apiKey,
      api_secret: cfg.cloudinary.apiSecret,
      secure: true,
    });
  }
  return cld;
}

/**
 * Save an image buffer. Returns { url, publicId, storage }.
 * The real file type is checked from the file's first bytes (JPG / PNG / WEBP only).
 */
async function saveImage(buffer, folder = 'products') {
  const ext = sniffImage(buffer);
  if (!ext) throw new HttpError(400, 'That file is not a JPG, PNG or WEBP photo', 'BAD_IMAGE');

  if (cloudOn()) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary().uploader.upload_stream(
          {
            folder: `shoptrack/${folder}`,
            resource_type: 'image',
            transformation: [{ width: 1400, height: 1400, crop: 'limit', quality: 'auto' }],
          },
          (err, res) => (err ? reject(err) : resolve(res))
        );
        stream.end(buffer);
      });
      return { url: result.secure_url, publicId: result.public_id, storage: 'cloudinary' };
    } catch (e) {
      console.error('[storage] Cloudinary upload failed:', e && e.message ? e.message : e);
      throw new HttpError(502, 'Photo upload failed. Check your Cloudinary keys or try again.', 'UPLOAD_FAILED');
    }
  }

  await fs.promises.mkdir(cfg.uploadDir, { recursive: true });
  const name = `${folder}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(cfg.uploadDir, name), buffer);
  return { url: `/uploads/${name}`, publicId: name, storage: 'local' };
}

/** Best effort: a failed delete must never break the request. */
async function deleteImage({ publicId, storage }) {
  if (!publicId) return;
  try {
    if (storage === 'cloudinary' && cloudOn()) {
      await cloudinary().uploader.destroy(publicId);
    } else if (storage === 'local') {
      await fs.promises.unlink(path.join(cfg.uploadDir, path.basename(publicId)));
    }
  } catch (e) {
    console.warn('[storage] could not delete old photo:', e && e.message ? e.message : e);
  }
}

module.exports = { saveImage, deleteImage, cloudOn };
