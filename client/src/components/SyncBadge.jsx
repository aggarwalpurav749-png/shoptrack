import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { useSyncState } from '../offline/useSync.js';
import { dismissFailed, syncNow } from '../offline/sync.js';
import { store } from '../offline/store.js';
import { Button, Icon, Modal, Spinner } from './ui.jsx';

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');

// Small pill in the header: online / offline, how much is waiting to be sent, last sync time. Tap for details.
export default function SyncBadge() {
  const { t } = useI18n();
  const s = useSyncState();
  const [open, setOpen] = useState(false);
  if (!store.isReady() && !s.syncing && !s.pendingOps) return null;

  const waiting = s.pendingOps + (s.pendingPings > 0 ? 1 : 0);
  const offline = !s.online;
  const problem = s.failed.length > 0 || !!s.error;
  const tone = problem ? 'bg-red-100 text-red-700' : offline ? 'bg-amber-100 text-amber-800' : waiting ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${tone}`} aria-label="Sync status">
        {s.syncing ? <Spinner className="h-3.5 w-3.5" /> : <Icon name={problem ? 'alert' : offline ? 'wifioff' : 'check'} className="h-4 w-4" />}
        {problem ? t('Check sync') : offline ? (waiting ? `${t('Offline')} · ${s.pendingOps} ${t('waiting')}` : t('Offline')) : waiting ? `${s.pendingOps} ${t('to send')}` : t('Synced')}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('Sync status')}>
        <ul className="space-y-2 text-sm text-slate-700">
          <li>
            {t('Internet')}: <b>{s.online ? t('Connected') : t('Not connected')}</b>
          </li>
          <li>
            {t('Waiting to be sent')}: <b>{s.pendingOps}</b> {t('changes')}, <b>{s.pendingPings}</b> {t('location points')}
          </li>
          <li>
            {t('Last sync')}: <b>{s.lastSync ? hm(s.lastSync) : '—'}</b>
          </li>
        </ul>
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{t('You can keep working without internet. Everything is saved on this device and sent automatically when you are online.')}</p>
        {s.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{s.error}</p>}
        {s.failed.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-sm font-semibold text-red-700">{t('These changes were refused by the server:')}</p>
            <ul className="space-y-1.5">
              {s.failed.map((f, i) => (
                <li key={i} className="rounded-lg bg-red-50 p-2 text-xs text-red-800">
                  <b>{f.method} {f.path}</b> — {f.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">{t('The data was reset to what the server has. Please make the change again if it is still needed.')}</p>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button loading={s.syncing} onClick={() => syncNow()} className="flex-1">
            {t('Sync now')}
          </Button>
          {(s.failed.length > 0 || s.error) && (
            <Button variant="secondary" onClick={dismissFailed} className="flex-1">
              {t('Dismiss')}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
