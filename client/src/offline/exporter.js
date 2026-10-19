// Excel export of estimates, built on the device from the saved data (so it also works offline).
import { store } from './store.js';
import { tzDay } from './local.js';

export async function exportEstimatesLocal(from, to, includeCancelled) {
  if (from > to) throw new Error('Start date must be before the end date');
  const XLSX = await import('xlsx');
  const orders = store.list('orders');
  const invs = store
    .list('invoices')
    .filter((i) => {
      const d = tzDay(i.invoiceDate);
      return d >= from && d <= to && (includeCancelled || i.status !== 'CANCELLED');
    })
    .sort((a, b) => (a.invoiceDate < b.invoiceDate ? -1 : a.invoiceDate > b.invoiceDate ? 1 : a.id - b.id));

  const tz = store.kvGet('timezone', 'Asia/Kolkata');
  const timeOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

  const estimates = invs.map((i) => {
    const p = store.get('parties', i.partyId) || {};
    const o = orders.find((x) => x.invoiceId === i.id);
    const agent = o && o.agentId ? store.get('users', o.agentId) : null;
    return {
      'Estimate No': i.invoiceNo, Date: tzDay(i.invoiceDate), Time: timeOf(i.invoiceDate), Party: p.name || '', Owner: p.ownerName || '', Phone: p.phone || '', Area: p.area || '',
      Agent: agent ? agent.name : '', 'Order No': o ? o.orderNo : '',
      'Taxable Amount': i.subtotal, Discount: i.discount, 'GST Amount': Math.round((i.cgst + i.sgst + i.igst) * 100) / 100, 'Round Off': i.roundOff, Total: i.grandTotal, Status: i.status,
    };
  });
  const items = [];
  invs.forEach((i) => {
    const p = store.get('parties', i.partyId) || {};
    (i.items || []).forEach((it) => {
      const pr = it.productId ? store.get('products', it.productId) : null;
      items.push({
        'Estimate No': i.invoiceNo, Date: tzDay(i.invoiceDate), Party: p.name || '', Item: it.name, SKU: (pr && pr.sku) || '', HSN: it.hsn || '', Unit: it.unit || '',
        Qty: it.qty, Rate: it.rate, Discount: it.discount, 'Taxable Amount': it.taxable, 'GST %': it.gstPercent, 'GST Amount': it.tax, 'Line Total': it.lineTotal,
      });
    });
  });
  const live = invs.filter((i) => i.status !== 'CANCELLED');
  const sum = (f) => Math.round(live.reduce((a, i) => a + f(i), 0) * 100) / 100;
  const summary = [
    { Item: 'From', Value: from },
    { Item: 'To', Value: to },
    { Item: 'Number of estimates (excluding cancelled)', Value: live.length },
    { Item: 'Taxable Amount', Value: sum((i) => i.subtotal) },
    { Item: 'GST Amount', Value: sum((i) => i.cgst + i.sgst + i.igst) },
    { Item: 'Total', Value: sum((i) => i.grandTotal) },
  ];

  const sheet = (rows, header, widths) => {
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    ws['!cols'] = widths.map((wch) => ({ wch }));
    return ws;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(estimates, ['Estimate No', 'Date', 'Time', 'Party', 'Owner', 'Phone', 'Area', 'Agent', 'Order No', 'Taxable Amount', 'Discount', 'GST Amount', 'Round Off', 'Total', 'Status'], [14, 12, 8, 28, 18, 13, 16, 16, 12, 14, 10, 12, 10, 12, 11]), 'Estimates');
  XLSX.utils.book_append_sheet(wb, sheet(items, ['Estimate No', 'Date', 'Party', 'Item', 'SKU', 'HSN', 'Unit', 'Qty', 'Rate', 'Discount', 'Taxable Amount', 'GST %', 'GST Amount', 'Line Total'], [14, 12, 28, 34, 12, 10, 8, 8, 10, 10, 14, 8, 12, 12]), 'Items');
  XLSX.utils.book_append_sheet(wb, sheet(summary, ['Item', 'Value'], [42, 16]), 'Summary');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
