import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, assetUrl } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import useFetch from '../lib/useFetch.js';
import { rupeesInWords } from '../lib/calc.js';
import { fmtDate, money, num, whatsappLink } from '../lib/format.js';
import { Button, ErrorBox, Icon, Skeleton, useConfirm, useToast } from '../components/ui.jsx';

export default function InvoicePage() {
  const { id } = useParams();
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch(() => api.get(`/invoices/${id}`), [id]);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Skeleton className="h-96" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { invoice: inv, items, shop } = data;
  const cancelled = inv.status === 'CANCELLED';
  const gstSplit = [['GST', Number(inv.cgst) + Number(inv.sgst) + Number(inv.igst)]]; // estimates show one GST amount

  const cancelInvoice = async () => {
    const ok = await confirm({
      title: t('Cancel this estimate?'),
      message: t('Stock and the party balance will be restored and the order becomes editable again.'),
      confirmText: t('Yes, cancel estimate'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/cancel`);
      toast.success(t('Estimate cancelled'));
      reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const waText = `${shop.shopName}\n${t('Estimate')} ${inv.invoiceNo} (${fmtDate(inv.invoiceDate)})\n${inv.partyName}\n${t('Total')}: ${money(inv.grandTotal)}${shop.upiId ? `\nUPI: ${shop.upiId}` : ''}\n${t('Thank you!')}`;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/invoices" className="btn btn-secondary btn-sm">
          <Icon name="chevron-left" className="h-4 w-4" /> {t('All estimates')}
        </Link>
        <div className="flex flex-wrap gap-2">
          {inv.orderId && (
            <Button variant="secondary" size="sm" onClick={() => navigate(`/orders/${inv.orderId}`)}>
              {t('Order')} {inv.orderNo}
            </Button>
          )}
          {inv.partyPhone && (
            <a className="btn btn-secondary btn-sm" href={whatsappLink(inv.partyPhone, waText)} target="_blank" rel="noreferrer">
              <Icon name="whatsapp" className="h-4 w-4" /> WhatsApp
            </a>
          )}
          <Button size="sm" icon="printer" onClick={() => window.print()}>
            {t('Print / Save PDF')}
          </Button>
          {!cancelled && (
            <Button variant="danger" size="sm" loading={busy} onClick={cancelInvoice}>
              {t('Cancel estimate')}
            </Button>
          )}
        </div>
      </div>

      {/* The estimate itself - this is what gets printed (A4) */}
      <div id="invoice-print" className="relative rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-800 sm:p-8">
        {cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase tracking-widest text-red-500/20 [transform:rotate(-20deg)]">{t('Cancelled')}</div>}

        <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            {shop.logoUrl && <img src={assetUrl(shop.logoUrl)} alt="" className="h-16 w-16 rounded-lg object-contain" />}
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900">{shop.shopName}</h1>
              {shop.address && <p className="whitespace-pre-line text-xs text-slate-600">{shop.address}</p>}
              <p className="text-xs text-slate-600">{[shop.phone && `${t('Ph')}: ${shop.phone}`, shop.email].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-bold uppercase tracking-wide text-brand-800">{t('Estimate')}</p>
            <p className="font-semibold">{inv.invoiceNo}</p>
            <p className="text-xs text-slate-600">{fmtDate(inv.invoiceDate)}</p>
            {inv.orderNo && <p className="text-xs text-slate-500">{t('Order')}: {inv.orderNo}</p>}
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-300 py-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('Bill to')}</p>
            <p className="font-semibold text-slate-900">{inv.partyName}</p>
            {inv.partyOwner && <p className="text-xs text-slate-600">{inv.partyOwner}</p>}
            <p className="text-xs text-slate-600">{[inv.partyAddress, inv.partyArea].filter(Boolean).join(', ')}</p>
            {inv.partyPhone && <p className="text-xs text-slate-600">{t('Ph')}: {inv.partyPhone}</p>}
          </div>
        </div>

        <div className="overflow-x-auto py-3">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="border-b border-slate-300 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">{t('Item')}</th>
                <th className="py-2 pr-2">HSN</th>
                <th className="py-2 pr-2 text-right">{t('Qty')}</th>
                <th className="py-2 pr-2 text-right">{t('Rate')}</th>
                <th className="py-2 pr-2 text-right">{t('Disc.')}</th>
                <th className="py-2 pr-2 text-right">{t('Taxable')}</th>
                <th className="py-2 pr-2 text-right">GST%</th>
                <th className="py-2 text-right">{t('Amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i, n) => (
                <tr key={i.id}>
                  <td className="py-2 pr-2 align-top">{n + 1}</td>
                  <td className="py-2 pr-2 align-top font-medium text-slate-900">{i.name}</td>
                  <td className="py-2 pr-2 align-top">{i.hsn || ''}</td>
                  <td className="py-2 pr-2 text-right align-top">
                    {num(i.qty)} {i.unit}
                  </td>
                  <td className="py-2 pr-2 text-right align-top">{num(i.rate)}</td>
                  <td className="py-2 pr-2 text-right align-top">{i.discount > 0 ? num(i.discount) : ''}</td>
                  <td className="py-2 pr-2 text-right align-top">{num(i.taxable)}</td>
                  <td className="py-2 pr-2 text-right align-top">{num(i.gstPercent)}</td>
                  <td className="py-2 text-right align-top font-semibold">{num(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-300 pt-3 sm:flex-row sm:justify-between">
          <div className="text-xs text-slate-600 sm:max-w-sm">
            <p className="font-semibold text-slate-800">{rupeesInWords(inv.grandTotal)}</p>
            {(shop.bankName || shop.upiId) && (
              <div className="mt-3">
                <p className="font-semibold text-slate-800">{t('Payment details')}</p>
                {shop.bankName && <p>{shop.bankName}</p>}
                {shop.accountNo && <p>A/c: {shop.accountNo}</p>}
                {shop.ifsc && <p>IFSC: {shop.ifsc}</p>}
                {shop.upiId && <p>UPI: {shop.upiId}</p>}
              </div>
            )}
          </div>
          <div className="w-full space-y-1 sm:w-72">
            <div className="flex justify-between">
              <span className="text-slate-600">{t('Taxable value')}</span>
              <span>{money(inv.subtotal)}</span>
            </div>
            {gstSplit.map(([label, v]) => (
              <div key={label} className="flex justify-between">
                <span className="text-slate-600">{label}</span>
                <span>{money(v)}</span>
              </div>
            ))}
            {inv.discount > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>{t('Discount already given')}</span>
                <span>{money(inv.discount)}</span>
              </div>
            )}
            {inv.roundOff !== 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">{t('Round off')}</span>
                <span>{inv.roundOff > 0 ? '+' : ''}{inv.roundOff.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-300 pt-1 text-lg font-bold text-slate-900">
              <span>{t('Grand total')}</span>
              <span>{money(inv.grandTotal)}</span>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('This is an estimate / bill, not a GST tax invoice.')}</p>
        <div className="mt-6 flex items-end justify-between gap-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
          <div className="max-w-md">
            {inv.terms && (
              <>
                <p className="font-semibold text-slate-700">{t('Terms')}</p>
                <p className="whitespace-pre-line">{inv.terms}</p>
              </>
            )}
          </div>
          <div className="text-center">
            <div className="mb-1 h-10 w-36 border-b border-slate-400" />
            <p>{t('For')} {shop.shopName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
