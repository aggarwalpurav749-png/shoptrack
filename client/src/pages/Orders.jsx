import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import useDebounce from '../lib/useDebounce.js';
import useFetch from '../lib/useFetch.js';
import { fmtDate, money } from '../lib/format.js';
import { ORDER_STATUSES, STATUS_HI, STATUS_TONE } from '../lib/orderStatus.js';
import { Badge, EmptyState, ErrorBox, Icon, PageHeader, Pagination, SearchBox, Skeleton } from '../components/ui.jsx';

const LIMIT = 20;

export function StatusBadge({ status }) {
  const { lang, t } = useI18n();
  return <Badge tone={STATUS_TONE[status] || 'gray'}>{lang === 'hi' && STATUS_HI[status] ? STATUS_HI[status] : t(status.charAt(0) + status.slice(1).toLowerCase())}</Badge>;
}

export default function Orders() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [params] = useSearchParams();
  const [status, setStatus] = useState(ORDER_STATUSES.includes(params.get('status')) ? params.get('status') : '');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, status]);

  const list = useFetch(() => api.get('/orders', { q: dq, status, page, limit: LIMIT }), [dq, status, page], { live: true });
  const items = list.data ? list.data.items : [];

  return (
    <div>
      <PageHeader
        title={t('Orders')}
        subtitle={isAdmin ? t('Orders taken by your agents') : t('Orders you have taken')}
        actions={
          <Link to="/orders/new" className="btn btn-primary">
            <Icon name="plus" className="h-4 w-4" /> {t('New order')}
          </Link>
        }
      />
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder={t('Search order no. or party')} />
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {['', ...ORDER_STATUSES].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${status === s ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            {s ? t(s.charAt(0) + s.slice(1).toLowerCase()) : t('All')}
          </button>
        ))}
      </div>

      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {list.data && items.length === 0 && (
        <EmptyState
          icon="cart"
          title={t('No orders yet')}
          text={isAdmin ? t('Orders taken by agents will appear here.') : t('Tap "New order" to take your first order.')}
          action={
            <Link to="/orders/new" className="btn btn-primary">
              {t('New order')}
            </Link>
          }
        />
      )}
      <div className={`grid gap-3 sm:grid-cols-2 ${list.loading ? 'opacity-60' : ''}`}>
        {items.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="card p-4 transition hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{o.partyName}</p>
                <p className="text-xs text-slate-500">
                  {o.orderNo} · {fmtDate(o.createdAt)}
                </p>
              </div>
              <StatusBadge status={o.status} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-600">
                {o.itemCount} {t('items')}
                {isAdmin && o.agentName ? ` · ${o.agentName}` : ''}
              </span>
              <span className="font-bold text-slate-900">{money(o.grandTotal)}</span>
            </div>
            {o.invoiceNo && (
              <p className="mt-1 text-xs font-medium text-emerald-700">
                <Icon name="receipt" className="mr-1 inline h-3.5 w-3.5" />
                {t('Estimate')} {o.invoiceNo}
              </p>
            )}
            {isAdmin && !o.invoiceId && o.status !== 'CANCELLED' && <p className="mt-1 text-xs font-medium text-amber-700">{t('Estimate not created yet')}</p>}
          </Link>
        ))}
      </div>
      <Pagination page={page} total={list.data ? list.data.total : 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
