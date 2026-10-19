import { useI18n } from '../lib/i18n.jsx';
import { useTracking } from '../lib/tracking.jsx';
import { Badge, Icon } from './ui.jsx';

// Shows tracking status. Switching it off is not possible: location is compulsory during working hours.
export default function DutyCard() {
  const { t } = useI18n();
  const { info, active, gpsStatus, gps } = useTracking();
  if (!info) return null;
  const hours = `${info.workStart} - ${info.workEnd}`;
  const ok = active && gpsStatus === 'ok';

  return (
    <div className={`card mb-4 p-4 ${ok ? 'border-emerald-300 bg-emerald-50' : active ? 'border-amber-300 bg-amber-50' : ''}`}>
      <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
        <Icon name="navigation" className="h-5 w-5 text-brand-700" />
        {active ? t('Location tracking is ON') : t('Outside working hours')}
        {ok && <Badge tone="green">{t('Sharing location')}</Badge>}
        {active && !ok && <Badge tone="amber">{t('Waiting for GPS')}</Badge>}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {t('Working hours')}: {hours}
      </p>
      {active && (
        <p className="mt-2 text-xs text-slate-600">
          {gps.lastSaved ? `${t('Last saved')}: ${gps.lastSaved.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : t('Getting your location...')}
          {gps.accuracy ? ` · ±${gps.accuracy} m` : ''}
          {' · '}
          {t('Works without internet; sent to the owner when you are online.')}
        </p>
      )}
      {!active && <p className="mt-2 text-xs text-slate-500">{t('Tracking starts by itself at the start of working hours.')}</p>}
    </div>
  );
}
