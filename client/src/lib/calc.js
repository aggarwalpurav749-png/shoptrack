// Same arithmetic as the server (server/src/utils/money.js): prices are GST-exclusive, GST is added on top.
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** lines: [{ qty, rate, discount, gstPercent }] -> { lines (with taxable/tax/lineTotal), subtotal, tax, discount, total } */
export function calcLines(lines) {
  let subtotal = 0;
  let tax = 0;
  let discount = 0;
  const out = lines.map((l) => {
    const qty = Number(l.qty) || 0;
    const rate = Number(l.rate) || 0;
    const gross = r2(qty * rate);
    const disc = Math.min(r2(Number(l.discount) || 0), gross);
    const taxable = r2(gross - disc);
    const t = r2((taxable * (Number(l.gstPercent) || 0)) / 100);
    subtotal += taxable;
    tax += t;
    discount += disc;
    return { ...l, gross, discount: disc, taxable, tax: t, lineTotal: r2(taxable + t) };
  });
  return { lines: out, subtotal: r2(subtotal), tax: r2(tax), discount: r2(discount), total: r2(subtotal + tax) };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n) {
  let s = '';
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} Hundred `;
    n %= 100;
  }
  if (n >= 20) {
    s += `${TENS[Math.floor(n / 10)]} `;
    n %= 10;
  }
  if (n > 0) s += `${ONES[n]} `;
  return s;
}

/** 146 -> "Rupees One Hundred Forty Six Only" (Indian grouping: thousand, lakh, crore) */
export function rupeesInWords(amount) {
  const total = Math.round(Number(amount) * 100) / 100;
  let rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';
  let s = '';
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) s += `${below1000(crore)}Crore `;
  if (lakh) s += `${below1000(lakh)}Lakh `;
  if (thousand) s += `${below1000(thousand)}Thousand `;
  if (rupees) s += below1000(rupees);
  s = s.trim();
  let out = s ? `Rupees ${s}` : 'Rupees Zero';
  if (paise) out += ` and ${below1000(paise).trim()} Paise`;
  return `${out} Only`;
}
