import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useTracking } from '../lib/tracking.jsx';
import { Button, Icon } from './ui.jsx';

// Full-screen block shown to agents until the phone's location is on and allowed.
export default function LocationGate() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const { loc, checkLocation } = useTracking();
  const [busy, setBusy] = useState(false);
  const checking = loc.state === 'checking';

  const retry = async () => {
    setBusy(true);
    await checkLocation();
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Icon name="pin" className="h-8 w-8" />
      </span>
      <h1 className="text-xl font-bold text-slate-900">{checking ? t('Checking your location...') : t('Turn on location to continue')}</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-600">{t('You need to keep your phone location (GPS) on to use this app.')}</p>
      {!checking && loc.message && <p className="mt-3 max-w-sm rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{t(loc.message)}</p>}
      {!checking && (
        <ol className="mt-4 max-w-sm list-decimal space-y-1 pl-5 text-left text-sm text-slate-600">
          <li>{t('Turn on Location / GPS in your phone settings.')}</li>
          <li>{t('Allow location for this site in your browser (tap the icon next to the web address).')}</li>
          <li>{t('Then tap the button below.')}</li>
        </ol>
      )}
      <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
        <Button icon="navigation" loading={busy || checking} onClick={retry}>
          {t('Turn on location')}
        </Button>
        <Button variant="secondary" onClick={logout}>
          {t('Log out')}
        </Button>
      </div>
    </div>
  );
}
