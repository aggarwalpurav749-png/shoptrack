import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, assetUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import useDebounce from '../lib/useDebounce.js';
import useFetch from '../lib/useFetch.js';
import { money, num } from '../lib/format.js';
import { Badge, Button, EmptyState, ErrorBox, Icon, PageHeader, Pagination, SearchBox, Select, Skeleton, StockBadge, useConfirm, useToast } from '../components/ui.jsx';
import BulkBar, { SelectBox } from '../components/BulkBar.jsx';
import useBulkSelect from '../lib/useBulkSelect.js';

const LIMIT = 24;

function ProductCard({ p, isAdmin, selecting, selected, onToggle }) {
  const { t } = useI18n();
  const hasDiscount = p.mrp > p.sellingPrice;
  return (
    <Link
      to={`/products/${p.id}`}
      onClick={(e) => {
        if (selecting) {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`card relative flex flex-col overflow-hidden transition hover:shadow-md ${selected ? 'ring-2 ring-brand-700' : ''}`}
    >
      <div className="relative aspect-square bg-slate-100">
        {p.imageUrl ? (
          <img src={assetUrl(p.imageUrl)} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <Icon name="image" className="h-10 w-10" />
          </div>
        )}
        {selecting ? (
          <span className="absolute left-2 top-2 z-10">
            <SelectBox checked={selected} onChange={onToggle} label={p.name} />
          </span>
        ) : (
          <span className="absolute left-2 top-2">{p.stockStatus !== 'in' && <StockBadge status={p.stockStatus} />}</span>
        )}
        {p.isArchived && (
          <span className="absolute right-2 top-2">
            <Badge tone="gray">{t('Archived')}</Badge>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{p.name}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{[p.brand, p.unit].filter(Boolean).join(' · ')}</p>
        <div className="mt-auto pt-2">
          <span className="text-base font-bold text-slate-900">{money(p.sellingPrice)}</span>
          {hasDiscount && <span className="ml-1.5 text-xs text-slate-400 line-through">{money(p.mrp)}</span>}
          <p className="text-[11px] text-slate-500">
            {t('Stock')}: {num(p.stockQty)} · GST {num(p.gstPercent)}%
            {isAdmin && <span> · {t('Cost')} {money(p.costPrice)}</span>}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function Products() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState('');
  const [sort, setSort] = useState('name');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(1), [dq, category, stock, sort, archived]);

  const list = useFetch(
    () => api.get('/products', { q: dq, category, stock, sort, archived: archived ? 'true' : 'false', page, limit: LIMIT }),
    [dq, category, stock, sort, archived, page],
    { live: true }
  );
  const cats = useFetch(() => api.get('/products/categories'), []);

  const items = list.data ? list.data.items : [];
  const total = list.data ? list.data.total : 0;
  const categories = cats.data ? cats.data.items : [];

  const pageIds = useMemo(() => items.map((p) => p.id), [items]);
  const bulk = useBulkSelect(pageIds, `${dq}|${category}|${stock}|${archived}`);
  const allSelected = total > 0 && bulk.sel.size >= total;
  const filterQuery = { q: dq, category, stock, archived: archived ? 'true' : 'false' };

  const selectAllMatching = async () => {
    setBusy(true);
    try {
      const r = await api.get('/products/ids', filterQuery);
      bulk.setSel(new Set(r.ids));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    const n = bulk.sel.size;
    const ok = await confirm({
      title: `${t('Delete')} ${n} ${t('products')}?`,
      message: t('These products will be removed from the catalog. Old orders and estimates stay intact.'),
      confirmText: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.post('/products/bulk-delete', { ids: Array.from(bulk.sel) });
      toast.success(`${r.deleted} ${t('products deleted')}`);
      bulk.exit();
      if (page > 1 && n >= items.length) setPage(1);
      list.reload();
      cats.reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('Products')}
        subtitle={t('Your catalog')}
        actions={
          isAdmin && (
            <>
              {items.length > 0 && (
                <Button variant="secondary" icon="check" onClick={() => (bulk.on ? bulk.exit() : bulk.setOn(true))}>
                  {t('Select')}
                </Button>
              )}
              <Link to="/products/import" className="btn btn-secondary">
                <Icon name="upload" className="h-4 w-4" /> {t('Import')}
              </Link>
              <Link to="/products/new" className="btn btn-primary">
                <Icon name="plus" className="h-4 w-4" /> {t('Add product')}
              </Link>
            </>
          )
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <SearchBox value={q} onChange={setQ} placeholder={t('Search name, SKU, brand')} />
        </div>
        <Select value={stock} onChange={(e) => setStock(e.target.value)}>
          <option value="">{t('All stock')}</option>
          <option value="in">{t('In stock')}</option>
          <option value="low">{t('Low stock')}</option>
          <option value="out">{t('Out of stock')}</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">{t('Name A–Z')}</option>
          <option value="price_asc">{t('Price: low to high')}</option>
          <option value="price_desc">{t('Price: high to low')}</option>
          <option value="stock_low">{t('Stock: lowest first')}</option>
          <option value="newest">{t('Newest first')}</option>
        </Select>
      </div>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ name: '', label: t('All') }, ...categories.map((c) => ({ name: c.name, label: `${c.name} (${c.count})` }))].map((c) => (
          <button
            key={c.name || 'all'}
            type="button"
            onClick={() => setCategory(c.name)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${category === c.name ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            {c.label}
          </button>
        ))}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setArchived((a) => !a)}
            className={`ml-auto shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${archived ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            <Icon name="archive" className="mr-1 inline h-4 w-4" />
            {t('Archived')}
          </button>
        )}
      </div>

      {bulk.on && (
        <BulkBar
          count={bulk.sel.size}
          pageCount={items.length}
          total={total}
          allOnPageSelected={bulk.allOnPage}
          allSelected={allSelected}
          busy={busy}
          onTogglePage={bulk.togglePage}
          onSelectAll={selectAllMatching}
          onClear={() => bulk.setSel(new Set())}
          onDelete={deleteSelected}
          onExit={bulk.exit}
        />
      )}

      <ErrorBox error={list.error} onRetry={list.reload} />

      {list.loading && !list.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      )}

      {list.data && items.length === 0 && (
        <EmptyState
          icon="box"
          title={t('No products found')}
          text={dq || category || stock ? t('Try a different search or filter.') : t('Add your first product to start building the catalog.')}
          action={
            isAdmin && !dq && !category && !stock && !archived ? (
              <Link to="/products/new" className="btn btn-primary">
                {t('Add product')}
              </Link>
            ) : null
          }
        />
      )}

      {items.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {total} {t('products')}
          </p>
          <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 ${list.loading ? 'opacity-60' : ''}`}>
            {items.map((p) => (
              <ProductCard key={p.id} p={p} isAdmin={isAdmin} selecting={bulk.on} selected={bulk.sel.has(p.id)} onToggle={() => bulk.toggle(p.id)} />
            ))}
          </div>
          <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
        </>
      )}
    </div>
  );
}
