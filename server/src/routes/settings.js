const router = require('express').Router();
const multer = require('multer');
const { z } = require('zod');
const { query } = require('../db');
const { HttpError, wrap, camel } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { protect, adminOnly } = require('../middleware/auth');
const { reqText, optText, num, emailField, hhmm, emptyToNull } = require('../utils/fields');
const { saveImage, deleteImage } = require('../utils/storage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const ifscField = z
  .preprocess(emptyToNull, z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like SBIN0001234').nullable().optional());

const settingsSchema = z
  .object({
    shopName: reqText(120, 'Shop name'),
    phone: optText(20, 'Phone'),
    email: emailField,
    address: optText(300, 'Address'),
    bankName: optText(80, 'Bank name'),
    accountNo: optText(30, 'Account number'),
    ifsc: ifscField,
    upiId: optText(60, 'UPI ID'),
    invoicePrefix: z
      .string({ required_error: 'Invoice prefix is required' })
      .trim()
      .regex(/^[A-Za-z0-9-]{1,10}$/, 'Prefix: 1-10 letters / numbers'),
    terms: optText(1000, 'Terms'),
    workStart: hhmm,
    workEnd: hhmm,
    defaultGstPercent: num('Default GST %', { max: 100, def: 18 }),
  })
  .refine((d) => d.workStart < d.workEnd, { message: 'Working hours end must be after start', path: ['workEnd'] });

const COLUMN_FOR = {
  shopName: 'shop_name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  bankName: 'bank_name',
  accountNo: 'account_no',
  ifsc: 'ifsc',
  upiId: 'upi_id',
  invoicePrefix: 'invoice_prefix',
  terms: 'terms',
  workStart: 'work_start',
  workEnd: 'work_end',
  defaultGstPercent: 'default_gst_percent',
};

const PUBLIC_FIELDS = ['shopName', 'logoUrl', 'phone', 'address', 'workStart', 'workEnd'];

async function loadSettings() {
  await query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  const { rows } = await query(
    `SELECT shop_name, logo_url, address, phone, email, bank_name, account_no, ifsc, upi_id,
            invoice_prefix, next_invoice_no, work_start, work_end, default_gst_percent, terms
       FROM settings WHERE id = 1`
  );
  return camel(rows[0]);
}

// Agents get the shop name / logo / hours only - never bank or GST details.
router.get(
  '/',
  ...protect,
  wrap(async (req, res) => {
    const s = await loadSettings();
    if (req.user.role === 'ADMIN') return res.json({ settings: s });
    const pub = {};
    for (const k of PUBLIC_FIELDS) pub[k] = s[k];
    res.json({ settings: pub });
  })
);

router.put(
  '/',
  ...adminOnly,
  validate(settingsSchema),
  wrap(async (req, res) => {
    const b = req.valid.body;
    const keys = Object.keys(COLUMN_FOR);
    const sets = keys.map((k, i) => `${COLUMN_FOR[k]} = $${i + 1}`);
    const vals = keys.map((k) => (b[k] === undefined ? null : b[k]));
    await query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await query(`UPDATE settings SET ${sets.join(', ')}, updated_at = now() WHERE id = 1`, vals);
    res.json({ settings: await loadSettings() });
  })
);

router.post(
  '/logo',
  ...adminOnly,
  upload.single('logo'),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Please choose a logo image', 'NO_FILE');
    const saved = await saveImage(req.file.buffer, 'logo');
    await query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    const old = (await query('SELECT logo_public_id, logo_storage FROM settings WHERE id = 1')).rows[0];
    await query('UPDATE settings SET logo_url = $1, logo_public_id = $2, logo_storage = $3, updated_at = now() WHERE id = 1', [
      saved.url,
      saved.publicId,
      saved.storage,
    ]);
    if (old && old.logo_public_id) await deleteImage({ publicId: old.logo_public_id, storage: old.logo_storage });
    res.json({ settings: await loadSettings() });
  })
);

router.delete(
  '/logo',
  ...adminOnly,
  wrap(async (req, res) => {
    const old = (await query('SELECT logo_public_id, logo_storage FROM settings WHERE id = 1')).rows[0];
    await query('UPDATE settings SET logo_url = NULL, logo_public_id = NULL, logo_storage = NULL, updated_at = now() WHERE id = 1');
    if (old && old.logo_public_id) await deleteImage({ publicId: old.logo_public_id, storage: old.logo_storage });
    res.json({ settings: await loadSettings() });
  })
);

module.exports = router;
