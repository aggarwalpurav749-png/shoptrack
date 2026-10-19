// Shared field normalisers + zod building blocks. Pure functions are unit-tested in test/.
const { z } = require('zod');

const { normalizePhone, normalizeGstin, parseNumber, GSTIN_RE } = require('./normalize');

// ── zod helpers ──────────────────────────────────────────────────────
const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const blankToUndefined = (v) => (v === '' || v === null || v === undefined ? undefined : v);

const reqText = (max, label) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long (max ${max} characters)`);

const optText = (max, label = 'Text') =>
  z.preprocess(emptyToNull, z.string().trim().max(max, `${label} is too long (max ${max} characters)`).nullable().optional());

const num = (label, { min = 0, max = 1e9, def = 0 } = {}) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: `${label} must be a number` })
      .min(min, `${label} cannot be less than ${min}`)
      .max(max, `${label} is too large`)
      .default(def)
  );

const emailField = z.preprocess(
  emptyToNull,
  z.string().trim().toLowerCase().email('Enter a valid email address').max(120).nullable().optional()
);

const phoneField = z
  .preprocess(emptyToNull, z.string().nullable().optional())
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Phone must be a valid 10-digit number' });
      return z.NEVER;
    }
    return p;
  });

const gstinField = z
  .preprocess(emptyToNull, z.string().nullable().optional())
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const g = normalizeGstin(v);
    if (!g) {
      ctx.addIssue({ code: 'custom', message: 'GSTIN must be 15 characters, e.g. 27AABCS1234F1Z5' });
      return z.NEVER;
    }
    return g;
  });

const passwordField = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password is too long (max 72 characters)')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use time like 09:30');

module.exports = {
  normalizePhone,
  normalizeGstin,
  parseNumber,
  GSTIN_RE,
  emptyToNull,
  blankToUndefined,
  reqText,
  optText,
  num,
  emailField,
  phoneField,
  gstinField,
  passwordField,
  hhmm,
};
