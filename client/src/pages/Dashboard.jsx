import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import useFetch from '../lib/useFetch.js';
import { fmtDate, money, num } from '../lib/format.js';
import DutyCard from '../components/DutyCard.jsx';
import { StatusBadge } from './Orders.jsx';
import { Badge, ErrorBox, Icon, PageHeader, Skeleton } from '../components/ui.jsx';

function Stat({ to, icon, label, value, tone = 'bg-brand-50 text-brand-700' }) {
  return (
    <Link to={to} className="card flex items-center gap-4 p-4 transition hover:shadow-md">
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tone}`}>
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span>
        <span className="block text-2xl font-bold text-slate-900">{value}</span>
        <span className="block text-sm text-slate-500">{label}</span>
      </span>
    </Link>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const { user, isAdmin } = useAuth();
  const { data, loading, error, reload } = useFetch(() => api.get('/dashboard'), [], { live: true });

  return (
    <div>
      <PageHeader title={`${t('Hello')}, ${user.name.split(' ')[0]}`} subtitle={isAdmin ? t('Here is your shop at a glance') : t('Your parties and products')} />
      <ErrorBox error={error} onRetry={reload} />

      {loading && !data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}

      {data && data.role === 'ADMIN' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat to="/orders?status=PENDING" icon="cart" label={t('New orders')} value={num(data.ordersPending)} tone="bg-amber-50 text-amber-700" />
            <Stat to="/orders" icon="receipt" label={t('Orders to bill')} value={num(data.ordersToInvoice)} tone="bg-sky-50 text-sky-700" />
            <Stat to="/tracking" icon="map" label={t('Agents on duty')} value={`${num(data.agentsOnDuty)} / ${num(data.agents)}`} tone="bg-emerald-50 text-emerald-700" />
            <Stat to="/parties" icon="users" label={t('Parties')} value={num(data.parties)} />
          </div>

          <div className="card mt-5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">{t('Latest orders')}</h2>
              <Link to="/orders" className="text-sm font-semibold text-brand-700">
                {t('See all')}
              </Link>
            </div>
            {data.recentOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">{t('Orders taken by agents will appear here.')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recentOrders.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="flex items-center justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{o.partyName}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {o.orderNo} · {o.agentName || '—'} · {fmtDate(o.createdAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-bold text-slate-900">{money(o.grandTotal)}</span>
                        <StatusBadge status={o.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="card p-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">{t('Stock alerts')}</h2>
                <div className="flex gap-2">
                  <Badge tone="amber">
                    {t('Low stock')}: {data.lowStock}
                  </Badge>
                  <Badge tone="red">
                    {t('Out of stock')}: {data.outOfStock}
                  </Badge>
                </div>
              </div>
              {data.lowStockItems.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">{t('All products have enough stock.')}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.lowStockItems.map((p) => (
                    <li key={p.id}>
                      <Link to={`/products/${p.id}`} className="flex items-center justify-between gap-3 py-3">
                        <span className="min-w-0 truncate text-sm font-medium text-slate-800">{p.name}</span>
                        <span className={`shrink-0 text-sm font-semibold ${p.stockQty <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                          {num(p.stockQty)} {p.unit}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-3 font-semibold text-slate-900">{t('Quick actions')}</h2>
              <div className="flex flex-col gap-2">
                <Link to="/products/new" className="btn btn-secondary justify-start">
                  <Icon name="plus" className="h-4 w-4" /> {t('Add product')}
                </Link>
                <Link to="/parties?new=1" className="btn btn-secondary justify-start">
                  <Icon name="plus" className="h-4 w-4" /> {t('Add party')}
                </Link>
                <Link to="/orders/new" className="btn btn-secondary justify-start">
                  <Icon name="cart" className="h-4 w-4" /> {t('New order')}
                </Link>
                <Link to="/parties/import" className="btn btn-secondary justify-start">
                  <Icon name="upload" className="h-4 w-4" /> {t('Import parties (CSV / Excel)')}
                </Link>
                <Link to="/products/import" className="btn btn-secondary justify-start">
                  <Icon name="upload" className="h-4 w-4" /> {t('Import products (CSV / Excel)')}
                </Link>
                <Link to="/agents" className="btn btn-secondary justify-start">
                  <Icon name="truck" className="h-4 w-4" /> {t('Manage agents')}
                </Link>
              </div>
            </div>
          </div>
        </>
      )}

      {data && data.role === 'AGENT' && (
        <>
          <DutyCard />
          <Link to="/orders/new" className="btn btn-primary mb-4 w-full !min-h-[56px] text-base">
            <Icon name="cart" className="h-5 w-5" /> {t('Take new order')}
          </Link>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat to="/orders" icon="cart" label={t('Orders today')} value={`${num(data.ordersToday)} · ${money(data.ordersTodayValue)}`} />
            <Stat to="/orders" icon="clock" label={t('Waiting for owner')} value={num(data.ordersPending)} tone="bg-amber-50 text-amber-700" />
            <Stat to="/parties" icon="users" label={t('My parties')} value={num(data.myParties)} />
            <Stat to="/products" icon="box" label={t('Products')} value={num(data.products)} />
          </div>
        </>
      )}
    </div>
  );
}
