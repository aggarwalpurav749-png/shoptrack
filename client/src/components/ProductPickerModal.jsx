import { useState } from 'react';
import { api, assetUrl } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import useDebounce from '../lib/useDebounce.js';
import useFetch from '../lib/useFetch.js';
import { money, num } from '../lib/format.js';
import { Icon, Modal, SearchBox, Skeleton } from './ui.jsx';

// Small "search and tap a product" dialog (used by the owner when editing an order).
export default function ProductPickerModal({ open, onClose, onPick }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const list = useFetch(() => (open ? api.get('/products', { q: dq, limit: 30 }) : Promise.resolve({ items: [] })), [open, dq]);
  const items = list.data ? list.data.items : [];
  return (
    <Modal open={open} onClose={onClose} title={t('Add product')} size="lg">
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder={t('Search product, brand, SKU')} />
      </div>
      {list.loading && !list.data && <Skeleton className="h-32" />}
      <ul className="divide-y divide-slate-100">
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => onPick(p)}>
              <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                {p.imageUrl ? <img src={assetUrl(p.imageUrl)} alt="" className="h-full w-full object-cover" /> : <Icon name="image" className="m-3 h-6 w-6 text-slate-300" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{p.name}</span>
                <span className="block text-xs text-slate-500">
                  {money(p.sellingPrice)} / {p.unit} · {t('Stock')} {num(p.stockQty)}
                </span>
              </span>
              <Icon name="plus" className="h-5 w-5 text-brand-700" />
            </button>
          </li>
        ))}
      </ul>
      {list.data && items.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{t('No products found')}</p>}
    </Modal>
  );
}
