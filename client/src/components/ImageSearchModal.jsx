import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Icon, Modal, SearchBox, Skeleton } from './ui.jsx';

// Search free photos on the internet (Pexels / Pixabay, through our server so keys stay secret).
export default function ImageSearchModal({ open, initialQuery, onClose, onPick }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: false, items: null, message: '', error: '' });

  const search = async (text) => {
    if (text.trim().length < 2) return;
    setState({ loading: true, items: null, message: '', error: '' });
    try {
      const r = await api.get('/images/search', { q: text.trim() });
      setState({ loading: false, items: r.items, message: r.message || '', error: '' });
    } catch (e) {
      setState({ loading: false, items: null, message: '', error: e.message });
    }
  };

  useEffect(() => {
    if (open) {
      setQ(initialQuery || '');
      setState({ loading: false, items: null, message: '', error: '' });
      if (initialQuery && initialQuery.trim().length >= 2) search(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('Search photo on internet')} size="lg">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <div className="flex-1">
          <SearchBox value={q} onChange={setQ} placeholder={t('e.g. Parle-G biscuit')} />
        </div>
        <Button type="submit" loading={state.loading}>
          {t('Search')}
        </Button>
      </form>

      {state.loading && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      )}
      {state.error && <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{state.error}</p>}
      {state.message && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{state.message}</p>}
      {state.items && state.items.length === 0 && !state.message && <p className="py-8 text-center text-sm text-slate-500">{t('No photos found. Try another word.')}</p>}
      {state.items && state.items.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {state.items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => onPick(it)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                title={it.credit ? `${it.source}: ${it.credit}` : it.source}
              >
                <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                <span className="absolute inset-0 flex items-center justify-center bg-brand-900/50 opacity-0 transition group-hover:opacity-100">
                  <Icon name="check" className="h-7 w-7 text-white" />
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">{t('Free-to-use photos (Openverse, Wikimedia, Pexels, Pixabay). Tap a photo to use it.')}</p>
        </>
      )}
    </Modal>
  );
}
