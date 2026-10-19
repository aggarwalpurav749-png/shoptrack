// Order / invoice arithmetic (pure, unit-tested). Prices are GST-exclusive; GST is added on top.
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** lines: [{ qty, rate, discount, gstPercent }] -> same lines with taxable / tax / lineTotal, plus totals. */
function calcLines(lines) {
  let subtotal = 0; // taxable value (after line discounts)
  let tax = 0;
  let discount = 0;
  const out = lines.map((l) => {
    const gross = r2(l.qty * l.rate);
    const disc = Math.min(r2(l.discount || 0), gross);
    const taxable = r2(gross - disc);
    const t = r2((taxable * (l.gstPercent || 0)) / 100);
    subtotal += taxable;
    tax += t;
    discount += disc;
    return { ...l, discount: disc, gross, taxable, tax: t, lineTotal: r2(taxable + t) };
  });
  subtotal = r2(subtotal);
  tax = r2(tax);
  return { lines: out, subtotal, tax, discount: r2(discount), total: r2(subtotal + tax) };
}

/** Intra-state: CGST + SGST halves. Inter-state: all IGST. */
function splitTax(tax, interstate) {
  if (interstate) return { cgst: 0, sgst: 0, igst: r2(tax) };
  const cgst = r2(tax / 2);
  return { cgst, sgst: r2(tax - cgst), igst: 0 };
}

/** Round the invoice total to the nearest rupee. */
function roundTotal(total) {
  const grand = Math.round(total);
  return { grand, roundOff: r2(grand - total) };
}

/** Two GSTINs in different states (first 2 digits differ)? Unknown -> treated as same state. */
function isInterstate(shopGstin, partyGstin) {
  if (!shopGstin || !partyGstin) return false;
  return String(shopGstin).slice(0, 2) !== String(partyGstin).slice(0, 2);
}

module.exports = { r2, calcLines, splitTax, roundTotal, isInterstate };
