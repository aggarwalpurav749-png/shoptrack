import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, assetUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import useDebounce from '../lib/useDebounce.js';
import useFetch from '../lib/useFetch.js';
import { calcLines } from '../lib/calc.js';
import { money, num } from '../lib/format.js';
import { Badge, Button, EmptyState, ErrorBox, Field, Icon, Modal, PageHeader, Pagination, SearchBox, Skeleton, Textarea, useToast } from '../components/ui.jsx';

const LIMIT = 20;
const draftKey = (partyId) => `shoptrack_cart_${partyId}`;

function loadDraft(partyId) {
  try {
    const raw = JSON.parse(localStorage.getItem(draftKey(partyId)) || 'null');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}
function saveDraft(partyId, cart) {
  try {
    if (Object.keys(cart).length) localStorage.setItem(draftKey(partyId), JSON.stringify(cart));
    else localStorage.removeItem(draftKey(partyId));
  } catch (e) {
    /* storage unavailable: the cart simply lives in memory */
  }
}

// ───────────── step 1: choose the party ─────────────
function ChooseParty({ onPick }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [dq]);
  const list = useFetch(() => api.get('/parties', { q: dq, page, limit: LIMIT }), [dq, page]);
  const items = list.data ? list.data.items : [];
  return (
    <div>
      <PageHeader title={t('New order')} subtitle={t('Whose order is it?')} />
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder={t('Search party name, phone, area')} />
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {list.data && items.length === 0 && <EmptyState icon="users" title={t('No parties found')} text={t('Parties are added by the owner.')} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p)} className="card p-4 text-left transition hover:shadow-md">
            <p className="truncate font-semibold text-slate-900">{p.name}</p>
            <p className="truncate text-sm text-slate-500">{[p.ownerName, p.phone].filter(Boolean).join(' · ') || '—'}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.area && <Badge tone="blue">{p.area}</Badge>}
              {p.currentBalance > 0 && <Badge tone="amber">{t('Due')} {money(p.currentBalance)}</Badge>}
            </div>
          </button>
        ))}
      </div>
      <Pagination page={page} total={list.data ? list.data.total : 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}

// ───────────── qty stepper ─────────────
function Stepper({ qty, onChange }) {
  const { t } = useI18n();
  if (!qty) {
    return (
      <Button size="sm" icon="plus" onClick={() => onChange(1)}>
        {t('Add')}
      </Button>
    );
  }
  return (
    <div className="flex items-center overflow-hidden rounded-xl border border-brand-600">
      <button type="button" className="flex h-10 w-10 items-center justify-center text-brand-700 active:bg-brand-50" onClick={() => onChange(Math.max(0, Math.round((qty - 1) * 1000) / 1000))} aria-label="Less">
        <Icon name="minus" className="h-4 w-4" />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        value={qty}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="h-10 w-14 border-x border-brand-600 text-center text-base font-semibold focus:outline-none"
      />
      <button type="button" className="flex h-10 w-10 items-center justify-center text-brand-700 active:bg-brand-50" onClick={() => onChange(Math.round((qty + 1) * 1000) / 1000)} aria-label="More">
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </div>
  );
}

// ───────────── step 2: pick products ─────────────
function Catalog({ party, onChangeParty }) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState(() => loadDraft(party.id)); // { [productId]: { p: product, qty } }
  const [review, setReview] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dq = useDebounce(q);

  useEffect(() => setPage(1), [dq, category]);
  useEffect(() => saveDraft(party.id, cart), [party.id, cart]);

  const list = useFetch(() => api.get('/products', { q: dq, category, page, limit: LIMIT }), [dq, category, page]);
  const cats = useFetch(() => api.get('/products/categories'), []);
  const items = list.data ? list.data.items : [];

  const setQty = (p, qty) =>
    setCart((c) => {
      const next = { ...c };
      if (!qty) delete next[p.id];
      else next[p.id] = { p: { id: p.id, name: p.name, unit: p.unit, sellingPrice: p.sellingPrice, gstPercent: p.gstPercent, imageUrl: p.imageUrl, stockQty: p.stockQty }, qty };
      return next;
    });

  const lines = useMemo(() => Object.values(cart).map(({ p, qty }) => ({ productId: p.id, name: p.name, unit: p.unit, qty, rate: p.sellingPrice, gstPercent: p.gstPercent, imageUrl: p.imageUrl })), [cart]);
  const calc = useMemo(() => calcLines(lines), [lines]);
  const count = lines.length;

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.post('/orders', { partyId: party.id, items: lines.map((l) => ({ productId: l.productId, qty: l.qty })), notes });
      saveDraft(party.id, {});
      toast.success(`${t('Order sent')}: ${r.order.orderNo}`);
      navigate(`/orders/${r.order.id}`, { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-28">
      <PageHeader
        title={party.name}
        subtitle={t('Add products to the order')}
        actions={
          <Button variant="secondary" size="sm" onClick={onChangeParty}>
            {t('Change party')}
          </Button>
        }
      />
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder={t('Search product, brand, SKU')} />
      </div>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ name: '', label: t('All') }, ...(cats.data ? cats.data.items : []).map((c) => ({ name: c.name, label: c.name }))].map((c) => (
          <button
            key={c.name || 'all'}
            type="button"
            onClick={() => setCategory(c.name)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${category === c.name ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {list.data && items.length === 0 && <EmptyState icon="box" title={t('No products found')} text={t('Try a different search.')} />}

      <div className={`space-y-2 ${list.loading ? 'opacity-60' : ''}`}>
        {items.map((p) => {
          const qty = cart[p.id] ? cart[p.id].qty : 0;
          return (
            <div key={p.id} className={`card flex items-center gap-3 p-2.5 ${qty ? 'border-brand-500 bg-brand-50/40' : ''}`}>
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                {p.imageUrl ? (
                  <img src={assetUrl(p.imageUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-300">
                    <Icon name="image" className="h-7 w-7" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{p.name}</p>
                <p className="text-sm">
                  <span className="font-bold text-slate-900">{money(p.sellingPrice)}</span>
                  <span className="text-xs text-slate-500"> / {p.unit}</span>
                  {p.mrp > p.sellingPrice && <span className="ml-1 text-xs text-slate-400 line-through">{money(p.mrp)}</span>}
                </p>
                <p className="text-[11px] text-slate-500">
                  GST {num(p.gstPercent)}% · {t('Stock')}: {num(p.stockQty)}
                  {p.stockStatus === 'out' && <span className="ml-1 font-semibold text-red-600">({t('Out of stock')})</span>}
                </p>
              </div>
              <Stepper qty={qty} onChange={(v) => setQty(p, v)} />
            </div>
          );
        })}
      </div>
      <Pagination page={page} total={list.data ? list.data.total : 0} limit={LIMIT} onPage={setPage} />

      {/* cart bar (sits above the agent's bottom navigation) */}
      <div className={`fixed inset-x-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,.08)] ${isAdmin ? 'bottom-0 lg:left-64' : 'bottom-[60px]'}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">
              {count} {t('items')}
            </p>
            <p className="text-lg font-bold text-slate-900">{money(calc.total)}</p>
          </div>
          <Button disabled={!count} icon="cart" onClick={() => setReview(true)}>
            {t('Review order')}
          </Button>
        </div>
      </div>

      <Modal
        open={review}
        onClose={() => setReview(false)}
        title={t('Review order')}
        footer={
          <Button className="w-full" loading={busy} disabled={!count} icon="check" onClick={send}>
            {t('Send order')} · {money(calc.total)}
          </Button>
        }
      >
        <p className="mb-3 text-sm text-slate-500">
          {t('Party')}: <span className="font-semibold text-slate-800">{party.name}</span>
        </p>
        <ul className="divide-y divide-slate-100">
          {calc.lines.map((l) => (
            <li key={l.productId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{l.name}</p>
                <p className="text-xs text-slate-500">
                  {num(l.qty)} {l.unit} × {money(l.rate)} · GST {num(l.gstPercent)}%
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-semibold">{money(l.lineTotal)}</span>
                <button type="button" className="rounded-full p-1.5 text-red-500 hover:bg-red-50" onClick={() => setQty({ id: l.productId }, 0)} aria-label="Remove">
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!count && <p className="py-4 text-center text-sm text-slate-500">{t('Your order is empty.')}</p>}
        <div className="mt-3 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">{t('Subtotal')}</span>
            <span>{money(calc.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">GST</span>
            <span>{money(calc.tax)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
            <span>{t('Total')}</span>
            <span>{money(calc.total)}</span>
          </div>
        </div>
        <Field label={t('Notes (optional)')} className="mt-3">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder={t('e.g. deliver by Friday')} />
        </Field>
        {err && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-medium text-red-700">{err}</p>}
      </Modal>
    </div>
  );
}

export default function NewOrder() {
  const [params, setParams] = useSearchParams();
  const partyId = params.get('party');
  const [party, setParty] = useState(null);
  const [loading, setLoading] = useState(!!partyId);

  // "/orders/new?party=12" (from a party card) skips the first step
  useEffect(() => {
    if (!partyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .get(`/parties/${partyId}`)
      .then((r) => setParty(r.party))
      .catch(() => setParams({}, { replace: true }))
      .finally(() => setLoading(false));
  }, [partyId, setParams]);

  if (loading) return <Skeleton className="h-40" />;
  if (!party) {
    return (
      <ChooseParty
        onPick={(p) => {
          setParty(p);
          setParams({ party: String(p.id) }, { replace: true });
        }}
      />
    );
  }
  return (
    <Catalog
      party={party}
      onChangeParty={() => {
        setParty(null);
        setParams({}, { replace: true });
      }}
    />
  );
}
