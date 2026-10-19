// Pure helper functions (no packages needed) - unit-tested in test/.

/** Returns a clean 10-digit Indian phone number, or null if it is not valid. */
function normalizePhone(value) {
  if (value === null || value === undefined) return null;
  let d = String(value).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[2-9]\d{9}$/.test(d) ? d : null;
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Returns upper-case GSTIN, or null if it is not valid. */
function normalizeGstin(value) {
  if (value === null || value === undefined) return null;
  const g = String(value).replace(/\s/g, '').toUpperCase();
  return GSTIN_RE.test(g) ? g : null;
}

/** "1,200", "₹ 1200", "Rs. 50" -> number. Blank -> undefined. Garbage -> NaN. */
function parseNumber(value) {
  if (value === null || value === undefined) return undefined;
  const s = String(value)
    .replace(/[₹,\s]/g, '')
    .replace(/^rs\.?/i, '');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = { normalizePhone, normalizeGstin, parseNumber, GSTIN_RE };
