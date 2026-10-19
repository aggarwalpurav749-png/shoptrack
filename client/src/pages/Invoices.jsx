import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFromApi, saveBlob } from '../lib/api.js';
import { store } from '../offline/store.js';
import { exportEstimatesLocal } from '../offline/exporter.js';
import { useI18n } from '../lib/i18n.jsx';
import useDebounce from '../lib/useDebounce.js';
import useFetch from '../lib/useFetch.js';
import { fmtDate, money } from '../lib/format.js';
import { Badge, Button, EmptyState, ErrorBox, Icon, PageHeader, Pagination, SearchBox, Skeleton, useToast } from '../components/ui.jsx';

const LIMIT = 20;
const TONE = { UNPAID: 'amber', PARTIAL: 'blue', PAID: 'green', CANCELLED: 'red' };


const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function presets() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7)); // week = Monday to Sunday
  return [
    ['Today', iso(today), iso(today)],
    ['Yesterday', iso(addDays(today, -1)), iso(addDays(today, -1))],
    ['This week', iso(monday), iso(addDays(monday, 6))],
    ['This month', iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(new Date(today.getFullYear(), today.getMonth() + 1, 0))],
    ['Last month', iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))],
  ];
}

// Download all estimates of a day / week / month (or any dates) as an Excel file for the owner's own software.
function ExportPanel() {
  const { t } = useI18n();
  const toast = useToast();
  const list = presets();
  const [from, setFrom] = useState(list[0][1]);
  const [to, setTo] = useState(list[0][2]);
  const [withCancelled, setWithCancelled] = useState(false);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const name = `estimates_${from}_to_${to}.xlsx`;
      if (store.isReady()) {
        // built from the data on this device, so it works with no internet too
        await saveBlob(await exportEstimatesLocal(from, to, withCancelled), name);
      } else {
        await downloadFromApi(`/invoices/export?from=${from}&to=${to}&includeCancelled=${withCancelled}`, name);
      }
      toast.success(t('Excel file downloaded'));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mb-4 p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900">
        <Icon name="download" className="h-5 w-5 text-brand-700" /> {t('Export to Excel')}
      </h2>
      <p className="mb-3 text-xs text-slate-500">{t('Estimates of the chosen dates in one .xlsx file (sheets: Estimates, Items, Summary).')}</p>
      <div className="-mx-1 mb-3 flex flex-wrap gap-2">
        {list.map(([label, a, b]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setFrom(a);
              setTo(b);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${from === a && to === b ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <label className="text-xs text-slate-500">
          {t('From')}
          <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">
          {t('To')}
          <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={withCancelled} onChange={(e) => setWithCancelled(e.target.checked)} />
        {t('Include cancelled estimates')}
      </label>
      <Button className="mt-3" icon="download" loading={busy} disabled={!from || !to || from > to} onClick={download}>
        {t('Download Excel')}
      </Button>
    </div>
  );
}

export default function Invoices() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq]);
  const list = useFetch(() => api.get('/invoices', { q: dq, page, limit: LIMIT }), [dq, page], { live: true });
  const items = list.data ? list.data.items : [];

  return (
    <div>
      <PageHeader title={t('Estimates')} subtitle={t('Created from your agents’ orders')} actions={<Link to="/orders" className="btn btn-secondary">{t('Go to orders')}</Link>} />
      <ExportPanel />
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder={t('Search estimate no. or party')} />
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {list.data && items.length === 0 && <EmptyState icon="receipt" title={t('No estimates yet')} text={t('Open an order and tap "Create estimate".')} />}
      <div className={`grid gap-3 sm:grid-cols-2 ${list.loading ? 'opacity-60' : ''}`}>
        {items.map((i) => (
          <Link key={i.id} to={`/invoices/${i.id}`} className="card p-4 transition hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{i.partyName}</p>
                <p className="text-xs text-slate-500">
                  {i.invoiceNo} · {fmtDate(i.invoiceDate)}
                </p>
              </div>
              <Badge tone={TONE[i.status]}>{t(i.status.charAt(0) + i.status.slice(1).toLowerCase())}</Badge>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-xs text-slate-500">
                <Icon name="cart" className="mr-1 inline h-3.5 w-3.5" />
                {i.orderNo || '—'}
              </span>
              <span className="font-bold text-slate-900">{money(i.grandTotal)}</span>
            </div>
          </Link>
        ))}
      </div>
      <Pagination page={page} total={list.data ? list.data.total : 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
