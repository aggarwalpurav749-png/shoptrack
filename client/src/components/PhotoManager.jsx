import { useRef, useState } from 'react';
import { assetUrl } from '../lib/api.js';
import { compressImage } from '../lib/imageTools.js';
import { useI18n } from '../lib/i18n.jsx';
import { Badge, Button, Icon, Spinner, useToast } from './ui.jsx';
import ImageSearchModal from './ImageSearchModal.jsx';

/**
 * Photo area of the product form. Four ways to add a photo:
 *   Camera (phone camera) · Gallery · Search on internet · Paste a link
 * images: [{ key, url, isPrimary, staged }]   (staged = will be uploaded when the product is saved)
 */
export default function PhotoManager({ images, busy, productName, max = 8, onAddFile, onAddUrl, onMakePrimary, onRemove }) {
  const { t } = useI18n();
  const toast = useToast();
  const camRef = useRef(null);
  const galRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [working, setWorking] = useState(false);
  const full = images.length >= max;

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setWorking(true);
    try {
      for (const f of files.slice(0, max - images.length)) {
        const small = await compressImage(f); // 5 MB phone photo -> ~300 KB
        await onAddFile(small);
      }
    } catch (err) {
      toast.error(err.message || t('Photo could not be added'));
    } finally {
      setWorking(false);
    }
  }

  async function addLink(e) {
    e.preventDefault();
    if (!/^https?:\/\//i.test(link.trim())) {
      toast.error(t('Paste a full link starting with http'));
      return;
    }
    setWorking(true);
    try {
      await onAddUrl(link.trim(), link.trim());
      setLink('');
      setLinkOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function pickFromSearch(item) {
    setSearchOpen(false);
    setWorking(true);
    try {
      await onAddUrl(item.full, item.thumb);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWorking(false);
    }
  }

  const loading = busy || working;
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="secondary" icon="camera" disabled={full || loading} onClick={() => camRef.current && camRef.current.click()}>
          {t('Camera')}
        </Button>
        <Button variant="secondary" icon="image" disabled={full || loading} onClick={() => galRef.current && galRef.current.click()}>
          {t('Gallery')}
        </Button>
        <Button variant="secondary" icon="globe" disabled={full || loading} onClick={() => setSearchOpen(true)}>
          {t('Search web')}
        </Button>
        <Button variant="secondary" icon="link" disabled={full || loading} onClick={() => setLinkOpen((o) => !o)}>
          {t('Paste link')}
        </Button>
      </div>

      {/* capture="environment" opens the phone's back camera directly */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFiles} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />

      {linkOpen && (
        <form onSubmit={addLink} className="mb-3 flex gap-2">
          <input className="input flex-1" type="url" inputMode="url" placeholder="https://..." value={link} onChange={(e) => setLink(e.target.value)} />
          <Button type="submit" loading={working}>
            {t('Add')}
          </Button>
        </form>
      )}

      {images.length === 0 && !loading ? (
        <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 py-8 text-center text-slate-400">
          <Icon name="image" className="mb-2 h-8 w-8" />
          <p className="text-sm">{t('No photos yet')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img) => (
            <div key={img.key} className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              <img src={assetUrl(img.url)} alt="" className="h-full w-full object-cover" loading="lazy" />
              {img.isPrimary && (
                <span className="absolute left-1 top-1">
                  <Badge tone="brand">{t('Main')}</Badge>
                </span>
              )}
              {img.staged && <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{t('Saves with product')}</span>}
              <div className="absolute right-1 top-1 flex flex-col gap-1">
                {!img.isPrimary && (
                  <button type="button" onClick={() => onMakePrimary(img)} className="rounded-full bg-white/90 p-1.5 text-amber-600 shadow" aria-label="Make main photo" title={t('Make main photo')}>
                    <Icon name="star" className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={() => onRemove(img)} className="rounded-full bg-white/90 p-1.5 text-red-600 shadow" aria-label="Remove photo" title={t('Remove')}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex aspect-square items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-brand-700">
              <Spinner className="h-6 w-6" />
            </div>
          )}
        </div>
      )}
      {full && <p className="mt-2 text-xs text-slate-500">{t('Maximum photos reached')}</p>}

      <ImageSearchModal open={searchOpen} initialQuery={productName} onClose={() => setSearchOpen(false)} onPick={pickFromSearch} />
    </div>
  );
}
