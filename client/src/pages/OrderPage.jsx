import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import useFetch from '../lib/useFetch.js';
import { calcLines } from '../lib/calc.js';
import { fmtDate, money, num, phoneLink } from '../lib/format.js';
import { ORDER_STATUSES } from '../lib/orderStatus.js';
import ProductPickerModal from '../components/ProductPickerModal.jsx';
import { StatusBadge } from './Orders.jsx';
import { Button, ErrorBox, Icon, PageHeader, Skeleton, Textarea, useConfirm, useToast } from '../components/ui.jsx';

export default function OrderPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch(() => api.get(`/orders/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [notes, setNotes] = useState('');
  const [picker, setPicker] = useState(false);

  const order = data ? data.order : null;
  const locked = !!(order && (order.invoiceId || order.status === 'CANCELLED'));

  const startEdit = () => {
    setDraft(order.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, qty: i.qty, rate: i.rate, discount: i.discount, gstPercent: i.gstPercent })));
    setNotes(order.notes || '');
    setEditing(true);
  };
  useEffect(() => setEditing(false), [id]);

  const calc = useMemo(() => calcLines(editing ? draft : []), [editing, draft]);
  const setLine = (pid, patch) => setDraft((d) => d.map((l) => (l.productId === pid ? { ...l, ...patch } : l)));

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = () =>
    run(async () => {
      await api.put(`/orders/${id}`, { items: draft.map((l) => ({ productId: l.productId, qty: Number(l.qty), rate: Number(l.rate), discount: Number(l.discount) || 0 })), notes });
      setEditing(false);
      toast.success(t('Order updated'));
      reload();
    });

  const setStatus = (status) =>
    run(async () => {
      await api.patch(`/orders/${id}/status`, { status });
      toast.success(t('Status updated'));
      reload();
    });

  const cancel = async () => {
    const ok = await confirm({ title: t('Cancel this order?'), message: t('The order will be marked as cancelled.'), confirmText: t('Yes, cancel'), danger: true });
    if (ok) setStatus('CANCELLED');
  };

  const makeInvoice = () =>
    run(async () => {
      const r = await api.post(`/invoices/from-order/${id}`);
      toast.success(`${t('Estimate created')}: ${r.invoiceNo}`);
      if (r.negativeStock && r.negativeStock.length) toast.info(`${t('Stock went below zero for')}: ${r.negativeStock.join(', ')}`);
      navigate(`/invoices/${r.id}`);
    });

  if (loading && !data) return <Skeleton className="h-64" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!order) return null;

  const rows = editing ? calc.lines : order.items.map((i) => ({ ...i, lineTotal: i.lineTotal }));
  const shownSubtotal = editing ? calc.subtotal : order.subtotal;
  const shownTax = editing ? calc.tax : order.taxAmount;
  const shownTotal = editing ? calc.total : order.grandTotal;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={order.orderNo}
        subtitle={fmtDate(order.createdAt)}
        actions={
          <>
            <StatusBadge status={order.status} />
            <Link to="/orders" className="btn btn-secondary btn-sm">
              {t('All orders')}
            </Link>
          </>
        }
      />

      <div className="card mb-4 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{t('Party')}</p>
        <p className="font-semibold text-slate-900">{order.partyName}</p>
        <p className="text-sm text-slate-600">{[order.partyAddress, order.partyArea].filter(Boolean).join(', ')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {order.partyPhone && (
            <a className="btn btn-secondary btn-sm" href={phoneLink(order.partyPhone)}>
              <Icon name="phone" className="h-4 w-4" /> {order.partyPhone}
            </a>
          )}
          {order.agentName && (
            <span className="text-slate-500">
              {t('Taken by')}: <span className="font-medium text-slate-700">{order.agentName}</span>
            </span>
          )}
        </div>
        {order.invoiceId && (
          <Link to={isAdmin ? `/invoices/${order.invoiceId}` : '#'} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
            <Icon name="receipt" className="h-4 w-4" /> {t('Estimate')} {order.invoiceNo}
          </Link>
        )}
      </div>

      <div className="card mb-4 overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {rows.map((i) => (
            <li key={i.productId} className="p-3">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {i.imageUrl ? <img src={assetUrl(i.imageUrl)} alt="" className="h-full w-full object-cover" /> : <Icon name="image" className="m-3 h-6 w-6 text-slate-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{i.name}</p>
                  {!editing ? (
                    <p className="text-xs text-slate-500">
                      {num(i.qty)} {i.unit} × {money(i.rate)}
                      {i.discount > 0 && ` − ${money(i.discount)}`} · GST {num(i.gstPercent)}%
                      {isAdmin && i.stockQty !== undefined && ` · ${t('Stock')} ${num(i.stockQty)}`}
                    </p>
                  ) : (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="text-[11px] text-slate-500">
                        {t('Qty')}
                        <input type="number" inputMode="decimal" min="0" className="input !min-h-[40px]" value={i.qty} onChange={(e) => setLine(i.productId, { qty: e.target.value })} />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        {t('Rate')}
                        <input type="number" inputMode="decimal" min="0" className="input !min-h-[40px]" value={i.rate} onChange={(e) => setLine(i.productId, { rate: e.target.value })} />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        {t('Discount')} ₹
                        <input type="number" inputMode="decimal" min="0" className="input !min-h-[40px]" value={i.discount} onChange={(e) => setLine(i.productId, { discount: e.target.value })} />
                      </label>
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-slate-900">{money(i.lineTotal)}</p>
                  {editing && draft.length > 1 && (
                    <button type="button" className="mt-1 rounded-full p-1.5 text-red-500 hover:bg-red-50" onClick={() => setDraft((d) => d.filter((l) => l.productId !== i.productId))} aria-label="Remove">
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {editing && (
          <div className="border-t border-slate-100 p-3">
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setPicker(true)}>
              {t('Add product')}
            </Button>
          </div>
        )}
        <div className="space-y-1 border-t border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">{t('Subtotal')}</span>
            <span>{money(shownSubtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">GST</span>
            <span>{money(shownTax)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
            <span>{t('Total')}</span>
            <span>{money(shownTotal)}</span>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="card mb-4 p-4">
          <p className="mb-1 text-sm font-medium text-slate-700">{t('Notes (optional)')}</p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
            <Button loading={busy} icon="check" onClick={saveEdit}>
              {t('Save changes')}
            </Button>
          </div>
        </div>
      ) : (
        order.notes && (
          <div className="card mb-4 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{t('Notes')}</p>
            <p className="text-sm text-slate-800">{order.notes}</p>
          </div>
        )
      )}

      {/* owner actions */}
      {isAdmin && !editing && (
        <div className="card mb-4 p-4">
          {!order.invoiceId && order.status !== 'CANCELLED' && (
            <Button className="mb-3 w-full" icon="receipt" loading={busy} onClick={makeInvoice}>
              {t('Create estimate')}
            </Button>
          )}
          {!locked && (
            <Button variant="secondary" className="mb-3 w-full" icon="edit" onClick={startEdit}>
              {t('Edit items, rate, discount')}
            </Button>
          )}
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Order status')}</p>
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.filter((s) => s !== 'CANCELLED').map((s) => (
              <Button key={s} size="sm" variant={order.status === s ? 'primary' : 'secondary'} disabled={busy || order.status === s || order.status === 'CANCELLED'} onClick={() => setStatus(s)}>
                {t(s.charAt(0) + s.slice(1).toLowerCase())}
              </Button>
            ))}
            {order.status !== 'CANCELLED' && !order.invoiceId && (
              <Button size="sm" variant="danger" disabled={busy} onClick={cancel}>
                {t('Cancel order')}
              </Button>
            )}
            {order.status === 'CANCELLED' && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus('PENDING')}>
                {t('Reopen order')}
              </Button>
            )}
          </div>
          {order.invoiceId && <p className="mt-2 text-xs text-slate-500">{t('To cancel this order, cancel its estimate first.')}</p>}
        </div>
      )}

      {/* agent action: withdraw an order the owner has not started on */}
      {!isAdmin && order.status === 'PENDING' && (
        <Button variant="danger" className="w-full" disabled={busy} onClick={cancel}>
          {t('Cancel order')}
        </Button>
      )}

      <ProductPickerModal
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(p) => {
          setDraft((d) => (d.some((l) => l.productId === p.id) ? d.map((l) => (l.productId === p.id ? { ...l, qty: Number(l.qty) + 1 } : l)) : [...d, { productId: p.id, name: p.name, unit: p.unit, qty: 1, rate: p.sellingPrice, discount: 0, gstPercent: p.gstPercent }]));
          setPicker(false);
        }}
      />
    </div>
  );
}
