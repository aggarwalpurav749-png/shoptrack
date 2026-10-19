const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const money = (n) => `₹${inr.format(Number(n) || 0)}`;
export const num = (n) => inr.format(Number(n) || 0);

export function fmtDate(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const phoneLink = (p) => (p ? `tel:+91${p}` : '');
export const whatsappLink = (p, text = '') => `https://wa.me/91${p}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** rows: array of arrays. Opens fine in Excel (UTF-8 BOM). */
export function toCsv(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
