import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useTracking } from '../lib/tracking.jsx';
import { isNativeApp } from '../lib/geo.js';
import { Button, Icon } from './ui.jsx';

// Agents must keep location ON all the time they use the app (recording itself happens only in working hours).
// If it is refused or switched off, this full-screen block replaces the whole app until it is back.
export default function GpsGate() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const { isAgent, active, gpsStatus, gps, retry, openSettings, info } = useTracking();
  const [busy, setBusy] = useState(false);
  if (!isAgent) return null;

  if (gpsStatus === 'denied' || gpsStatus === 'unavailable') {
    const again = () => {
      setBusy(true);
      retry();
      setTimeout(() => setBusy(false), 1500);
    };
    return (
      <div className="fixed inset-0 z-[100] flex min-h-screen flex-col items-center justify-center overflow-y-auto bg-slate-50 px-6 text-center">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Icon name="pin" className="h-8 w-8" />
        </span>
        <h1 className="text-xl font-bold text-slate-900">{t('Turn on location to continue')}</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-600">
          {t('You need to keep your phone location (GPS) on to use this app.')}
          {active && info ? ` (${info.workStart} - ${info.workEnd})` : ''}
        </p>
        {gps.error && <p className="mt-3 max-w-sm rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{t(gps.error)}</p>}
        <ol className="mt-4 max-w-sm list-decimal space-y-1 pl-5 text-left text-sm text-slate-600">
          <li>{t('Turn on Location / GPS in your phone settings.')}</li>
          <li>{isNativeApp() ? t('Allow location for ShopTrack ("All the time" is best).') : t('Allow location for this site in your browser (tap the icon next to the web address).')}</li>
          <li>{t('Then tap the button below.')}</li>
        </ol>
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
          <Button icon="navigation" loading={busy} onClick={again}>
            {t('Turn on location')}
          </Button>
          {isNativeApp() && (
            <Button variant="secondary" onClick={openSettings}>
              {t('Open location settings')}
            </Button>
          )}
          <Button variant="secondary" onClick={logout}>
            {t('Log out')}
          </Button>
        </div>
        {active && <p className="mt-4 text-xs text-slate-500">{t('The owner is told when location is switched off.')}</p>}
      </div>
    );
  }

  if (active && gpsStatus === 'no_fix') {
    return (
      <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
        <Icon name="alert" className="h-4 w-4" />
        {t('No GPS signal. Go outside or check that GPS is ON.')}
        <button type="button" onClick={retry} className="ml-2 underline">
          {t('Retry')}
        </button>
      </div>
    );
  }
  return null;
}
