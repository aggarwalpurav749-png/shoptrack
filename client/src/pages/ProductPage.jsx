import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import useFetch from '../lib/useFetch.js';
import { fmtDate, money, num } from '../lib/format.js';
import PhotoManager from '../components/PhotoManager.jsx';
import { Badge, Button, ErrorBox, Field, Icon, Modal, PageHeader, Skeleton, StockBadge, TextInput, Textarea, useConfirm, useToast } from '../components/ui.jsx';

const UNITS = ['PCS', 'KG', 'GM', 'LTR', 'ML', 'PKT', 'BOX', 'DOZEN', 'BAG', 'CARTON'];
const EMPTY = {
  name: '',
  sku: '',
  category: '',
  brand: '',
  unit: 'PCS',
  mrp: '',
  sellingPrice: '',
  costPrice: '',
  gstPercent: '18',
  hsn: '',
  stockQty: '0',
  lowStockLevel: '10',
  description: '',
};
const FIELD_LABEL = { mrp: 'MRP', selling_price: 'Selling price', cost_price: 'Cost price' };

const toForm = (p) => ({
  name: p.name || '',
  sku: p.sku || '',
  category: p.category || '',
  brand: p.brand || '',
  unit: p.unit || 'PCS',
  mrp: String(p.mrp ?? ''),
  sellingPrice: String(p.sellingPrice ?? ''),
  costPrice: String(p.costPrice ?? ''),
  gstPercent: String(p.gstPercent ?? '18'),
  hsn: p.hsn || '',
  stockQty: String(p.stockQty ?? '0'),
  lowStockLevel: String(p.lowStockLevel ?? '10'),
  description: p.description || '',
});

// ───────────── read-only view for agents ─────────────
function ProductView({ id }) {
  const { t } = useI18n();
  const { data, loading, error, reload } = useFetch(() => api.get(`/products/${id}`), [id]);
  const [idx, setIdx] = useState(0);
  const p = data && data.product;
  const imgs = p ? p.images : [];

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600">
        <Icon name="chevron-left" className="h-4 w-4" /> {t('Products')}
      </Link>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !p && <Skeleton className="h-80" />}
      {p && (
        <div className="card overflow-hidden">
          <div className="aspect-square bg-slate-100 sm:aspect-[4/3]">
            {imgs.length ? (
              <img src={assetUrl(imgs[Math.min(idx, imgs.length - 1)].url)} alt={p.name} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-300">
                <Icon name="image" className="h-16 w-16" />
              </div>
            )}
          </div>
          {imgs.length > 1 && (
            <div className="flex gap-2 overflow-x-auto p-3">
              {imgs.map((im, i) => (
                <button key={im.id} type="button" onClick={() => setIdx(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${i === idx ? 'border-brand-700' : 'border-transparent'}`}>
                  <img src={assetUrl(im.url)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-bold text-slate-900">{p.name}</h1>
              <StockBadge status={p.stockStatus} />
            </div>
            <p className="text-sm text-slate-500">{[p.brand, p.category, p.sku].filter(Boolean).join(' · ')}</p>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              {money(p.sellingPrice)} <span className="text-base font-medium text-slate-500">/ {p.unit}</span>
            </p>
            {p.mrp > p.sellingPrice && <p className="text-sm text-slate-400 line-through">MRP {money(p.mrp)}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">GST</dt>
                <dd className="font-semibold">{num(p.gstPercent)}%</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('Stock')}</dt>
                <dd className="font-semibold">
                  {num(p.stockQty)} {p.unit}
                </dd>
              </div>
              {p.hsn && (
                <div>
                  <dt className="text-slate-500">HSN</dt>
                  <dd className="font-semibold">{p.hsn}</dd>
                </div>
              )}
            </dl>
            {p.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-600">{p.description}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────── owner: create / edit ─────────────
function ProductEditor({ id }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [staged, setStaged] = useState([]); // photos picked before the product exists
  const [history, setHistory] = useState(null);

  const cats = useFetch(() => api.get('/products/categories'), []);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    api
      .get(`/products/${id}`)
      .then((r) => {
        setProduct(r.product);
        setForm(toForm(r.product));
      })
      .catch(setLoadError)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isNew) {
      setProduct(null);
      setForm(EMPTY);
      setStaged([]);
      setLoading(false);
    } else load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = t('Product name is required');
    if (!form.unit.trim()) e.unit = t('Unit is required');
    if (form.sellingPrice === '' || Number(form.sellingPrice) < 0) e.sellingPrice = t('Enter the selling price');
    if (Number(form.mrp) > 0 && Number(form.sellingPrice) > Number(form.mrp)) e.sellingPrice = t('Selling price cannot be more than MRP');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save(ev) {
    ev.preventDefault();
    if (!validate()) {
      toast.error(t('Please fix the highlighted fields'));
      return;
    }
    setBusy(true);
    try {
      if (isNew) {
        const r = await api.post('/products', form);
        const newId = r.product.id;
        let failed = 0;
        for (const s of staged) {
          try {
            if (s.file) {
              const fd = new FormData();
              fd.append('image', s.file);
              await api.upload(`/products/${newId}/images`, fd);
            } else {
              await api.post(`/products/${newId}/images/from-url`, { url: s.remoteUrl });
            }
          } catch (e) {
            failed += 1;
          }
        }
        staged.forEach((s) => s.file && URL.revokeObjectURL(s.url));
        toast.success(t('Product added'));
        if (failed) toast.error(`${failed} ${t('photo(s) could not be uploaded. Add them again from the product page.')}`);
        navigate(`/products/${newId}`, { replace: true });
      } else {
        const r = await api.put(`/products/${id}`, form);
        setProduct(r.product);
        setForm(toForm(r.product));
        toast.success(t('Saved'));
      }
    } catch (err) {
      setErrors(err.fields || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── photos: live (product exists) ──
  const live = {
    async addFile(file) {
      setPhotoBusy(true);
      try {
        const fd = new FormData();
        fd.append('image', file);
        await api.upload(`/products/${id}/images`, fd);
        const r = await api.get(`/products/${id}`);
        setProduct(r.product);
      } finally {
        setPhotoBusy(false);
      }
    },
    async addUrl(url) {
      setPhotoBusy(true);
      try {
        await api.post(`/products/${id}/images/from-url`, { url });
        const p = await api.get(`/products/${id}`);
        setProduct(p.product);
      } finally {
        setPhotoBusy(false);
      }
    },
    async makePrimary(img) {
      try {
        const r = await api.put(`/products/${id}/images/${img.id}/primary`);
        setProduct(r.product);
      } catch (e) {
        toast.error(e.message);
      }
    },
    async remove(img) {
      const ok = await confirm({ title: t('Remove photo?'), message: t('This photo will be deleted.'), confirmText: t('Remove'), danger: true });
      if (!ok) return;
      try {
        const r = await api.del(`/products/${id}/images/${img.id}`);
        setProduct(r.product);
      } catch (e) {
        toast.error(e.message);
      }
    },
  };

  // ── photos: staged (new product, not saved yet) ──
  const stage = {
    async addFile(file) {
      setStaged((l) => [...l, { key: `f${Date.now()}${l.length}`, url: URL.createObjectURL(file), file, staged: true }]);
    },
    async addUrl(url, thumb) {
      setStaged((l) => [...l, { key: `u${Date.now()}${l.length}`, url: thumb || url, remoteUrl: url, staged: true }]);
    },
    makePrimary(img) {
      setStaged((l) => {
        const first = l.find((x) => x.key === img.key);
        return first ? [first, ...l.filter((x) => x.key !== img.key)] : l;
      });
    },
    remove(img) {
      if (img.file) URL.revokeObjectURL(img.url);
      setStaged((l) => l.filter((x) => x.key !== img.key));
    },
  };

  const handlers = isNew ? stage : live;
  const images = isNew
    ? staged.map((s, i) => ({ ...s, isPrimary: i === 0 }))
    : (product ? product.images : []).map((im) => ({ key: im.id, id: im.id, url: im.url, isPrimary: im.isPrimary }));

  async function toggleArchive() {
    const next = !product.isArchived;
    try {
      const r = await api.patch(`/products/${id}/archive`, { archived: next });
      setProduct(r.product);
      toast.success(next ? t('Product archived') : t('Product restored'));
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t('Delete product?'),
      message: `${product.name} ${t('will be removed from the catalog. Old orders and estimates stay safe.')}`,
      confirmText: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/products/${id}`);
      toast.success(t('Product deleted'));
      navigate('/products', { replace: true });
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function openHistory() {
    setHistory({ loading: true, items: [] });
    try {
      const r = await api.get(`/products/${id}/price-history`);
      setHistory({ loading: false, items: r.items });
    } catch (e) {
      setHistory(null);
      toast.error(e.message);
    }
  }

  if (loading) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (loadError) return <ErrorBox error={loadError} onRetry={load} />;

  const categories = cats.data ? cats.data.items : [];
  const margin = Number(form.sellingPrice) > 0 && form.costPrice !== '' ? Number(form.sellingPrice) - Number(form.costPrice) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600">
        <Icon name="chevron-left" className="h-4 w-4" /> {t('Products')}
      </Link>
      <PageHeader
        title={isNew ? t('Add product') : product.name}
        subtitle={isNew ? null : `${t('Last updated')}: ${fmtDate(product.updatedAt)}`}
        actions={
          !isNew && (
            <>
              <StockBadge status={product.stockStatus} />
              {product.isArchived && <Badge tone="gray">{t('Archived')}</Badge>}
            </>
          )
        }
      />

      <form onSubmit={save} noValidate className="space-y-4">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold text-slate-900">{t('Photos')}</h2>
          <PhotoManager
            images={images}
            busy={photoBusy}
            productName={form.name}
            onAddFile={handlers.addFile}
            onAddUrl={handlers.addUrl}
            onMakePrimary={handlers.makePrimary}
            onRemove={handlers.remove}
          />
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-slate-900">{t('Basic details')}</h2>
          <Field label={t('Product name')} required error={errors.name}>
            <TextInput value={form.name} onChange={set('name')} error={errors.name} autoFocus={isNew} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU / Code" error={errors.sku}>
              <TextInput value={form.sku} onChange={set('sku')} error={errors.sku} autoCapitalize="characters" />
            </Field>
            <Field label="HSN" error={errors.hsn}>
              <TextInput value={form.hsn} onChange={set('hsn')} error={errors.hsn} inputMode="numeric" />
            </Field>
            <Field label={t('Category')} error={errors.category}>
              <TextInput list="cat-list" value={form.category} onChange={set('category')} error={errors.category} />
              <datalist id="cat-list">
                {categories.map((c) => (
                  <option key={c.name} value={c.name} />
                ))}
              </datalist>
            </Field>
            <Field label={t('Brand')} error={errors.brand}>
              <TextInput value={form.brand} onChange={set('brand')} error={errors.brand} />
            </Field>
          </div>
          <Field label={t('Description')} error={errors.description}>
            <Textarea value={form.description} onChange={set('description')} error={errors.description} />
          </Field>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-slate-900">{t('Price and tax')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="MRP (₹)" error={errors.mrp}>
              <TextInput type="number" inputMode="decimal" min="0" step="any" value={form.mrp} onChange={set('mrp')} error={errors.mrp} />
            </Field>
            <Field label={t('Selling price (₹)')} required error={errors.sellingPrice}>
              <TextInput type="number" inputMode="decimal" min="0" step="any" value={form.sellingPrice} onChange={set('sellingPrice')} error={errors.sellingPrice} />
            </Field>
            <Field label={t('Cost price (₹)')} error={errors.costPrice} hint={margin !== null ? `${t('Profit per unit')}: ${money(margin)} — ${t('only you can see cost price')}` : t('Only you can see cost price')}>
              <TextInput type="number" inputMode="decimal" min="0" step="any" value={form.costPrice} onChange={set('costPrice')} error={errors.costPrice} />
            </Field>
            <Field label="GST %" error={errors.gstPercent}>
              <TextInput list="gst-list" type="number" inputMode="decimal" min="0" max="100" step="any" value={form.gstPercent} onChange={set('gstPercent')} error={errors.gstPercent} />
              <datalist id="gst-list">
                {[0, 5, 12, 18, 28].map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
          </div>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-slate-900">{t('Stock')}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Unit')} required error={errors.unit}>
              <TextInput list="unit-list" value={form.unit} onChange={set('unit')} error={errors.unit} autoCapitalize="characters" />
              <datalist id="unit-list">
                {UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
            <Field label={t('Stock quantity')} error={errors.stockQty}>
              <TextInput type="number" inputMode="decimal" step="any" value={form.stockQty} onChange={set('stockQty')} error={errors.stockQty} />
            </Field>
            <Field label={t('Low-stock alert at')} error={errors.lowStockLevel}>
              <TextInput type="number" inputMode="decimal" min="0" step="any" value={form.lowStockLevel} onChange={set('lowStockLevel')} error={errors.lowStockLevel} />
            </Field>
          </div>
        </section>

        <div className="safe-bottom sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          {isNew ? (
            <span />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon="clock" onClick={openHistory}>
                {t('Price history')}
              </Button>
              <Button size="sm" variant="secondary" icon="archive" onClick={toggleArchive}>
                {product.isArchived ? t('Restore') : t('Archive')}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-600" icon="trash" onClick={remove}>
                {t('Delete')}
              </Button>
            </div>
          )}
          <Button type="submit" loading={busy}>
            {isNew ? t('Add product') : t('Save changes')}
          </Button>
        </div>
      </form>

      <Modal open={!!history} onClose={() => setHistory(null)} title={t('Price history')}>
        {history && history.loading && <Skeleton className="h-24" />}
        {history && !history.loading && history.items.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{t('No price changes yet.')}</p>}
        {history && history.items.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {history.items.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{t(FIELD_LABEL[h.field] || h.field)}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(h.changedAt)}
                    {h.changedByName ? ` · ${h.changedByName}` : ''}
                  </p>
                </div>
                <p className="font-semibold text-slate-800">
                  {money(h.oldValue)} → {money(h.newValue)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

export default function ProductPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  if (!isAdmin) return <ProductView id={id} />;
  return <ProductEditor key={id} id={id} />;
}
