import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import useFetch from '../lib/useFetch.js';
import { phoneLink } from '../lib/format.js';
import MapView from '../components/MapView.jsx';
import { Badge, Button, EmptyState, ErrorBox, Icon, PageHeader, Skeleton } from '../components/ui.jsx';

const TONE = { LIVE: 'green', NO_SIGNAL: 'amber', OFF: 'gray' };

function ago(sec, t) {
  if (sec === null || sec === undefined) return t('never');
  if (sec < 60) return `${sec}s ${t('ago')}`;
  if (sec < 3600) return `${Math.round(sec / 60)} ${t('min ago')}`;
  if (sec < 86400) return `${Math.round(sec / 3600)} ${t('hr ago')}`;
  return `${Math.round(sec / 86400)} ${t('days ago')}`;
}

export default function LiveMap() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useFetch(() => api.get('/tracking/live'), []);
  const [selected, setSelected] = useState(null);
  const [trailDate, setTrailDate] = useState('');
  const [trail, setTrail] = useState([]);
  const [trailMsg, setTrailMsg] = useState('');

  // refresh positions every 15 seconds
  useEffect(() => {
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload]);

  const items = data ? data.items : [];
  const statusLabel = { LIVE: t('Live'), NO_SIGNAL: t('No signal'), OFF: t('Off duty') };

  const markers = useMemo(
    () =>
      items
        .filter((a) => a.lat !== null && a.lat !== undefined)
        .map((a) => ({
          id: a.id,
          lat: a.lat,
          lng: a.lng,
          label: a.name,
          status: a.status,
          popup: `<b>${a.name.replace(/[<>&]/g, '')}</b><br/>${statusLabel[a.status]} · ${ago(a.secondsAgo, t)}`,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );

  const loadTrail = async (agentId, date) => {
    setTrailMsg('');
    try {
      const r = await api.get(`/tracking/trail/${agentId}`, { date });
      setTrail(r.items);
      if (!r.items.length) setTrailMsg(t('No location recorded for this day.'));
    } catch (e) {
      setTrail([]);
      setTrailMsg(e.message);
    }
  };

  const pick = (a) => {
    setSelected(a.id);
    setTrail([]);
    setTrailDate('');
    setTrailMsg('');
  };

  const showTrail = (a) => {
    const d = trailDate || new Intl.DateTimeFormat('en-CA').format(new Date());
    setTrailDate(d);
    setSelected(a.id);
    loadTrail(a.id, d);
  };

  const onDuty = items.filter((a) => a.onDuty).length;

  return (
    <div>
      <PageHeader
        title={t('Live tracking')}
        subtitle={`${onDuty} ${t('agents on duty')} · ${t('updates every 15 seconds')}`}
        actions={
          <Button variant="secondary" icon="navigation" onClick={reload}>
            {t('Refresh')}
          </Button>
        }
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton className="h-72" />}

      {data && items.length === 0 && <EmptyState icon="truck" title={t('No agents yet')} text={t('Add agents first. They will show up here when they start duty.')} />}

      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:order-1">
            {items.map((a) => (
              <div key={a.id} className={`card p-3 ${selected === a.id ? 'ring-2 ring-brand-600' : ''}`}>
                <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => pick(a)}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900">{a.name}</span>
                    <span className="block text-xs text-slate-500">
                      {a.lat !== null && a.lat !== undefined ? `${t('Last seen')}: ${ago(a.secondsAgo, t)}` : t('No location yet')}
                      {a.battery !== null && a.battery !== undefined ? ` · 🔋 ${Math.round(a.battery)}%` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t('Hours')}: {a.workStart || '—'} - {a.workEnd || '—'}
                    </span>
                    {a.lastGpsEvent === 'GPS_OFF' && (
                      <span className="mt-0.5 block text-xs font-semibold text-red-600">
                        {t('GPS was switched OFF at')} {new Date(a.lastGpsEventAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </span>
                  <Badge tone={TONE[a.status]}>{statusLabel[a.status]}</Badge>
                </button>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => showTrail(a)}>
                    <Icon name="map" className="h-4 w-4" /> {t('Day route')}
                  </Button>
                  {a.phone && (
                    <a className="btn btn-secondary btn-sm" href={phoneLink(a.phone)}>
                      <Icon name="phone" className="h-4 w-4" /> {t('Call')}
                    </a>
                  )}
                </div>
                {selected === a.id && trailDate && (
                  <div className="mt-2 flex items-center gap-2">
                    <input type="date" className="input !min-h-[36px] !py-1" value={trailDate} max={new Intl.DateTimeFormat('en-CA').format(new Date())} onChange={(e) => { setTrailDate(e.target.value); loadTrail(a.id, e.target.value); }} />
                  </div>
                )}
                {selected === a.id && trailMsg && <p className="mt-2 text-xs text-slate-500">{trailMsg}</p>}
              </div>
            ))}
          </div>

          <div className="lg:col-span-2 lg:order-2">
            <MapView markers={markers} trail={trail} selectedId={selected} className="h-[55vh] lg:h-[70vh]" />
            {markers.length === 0 && <p className="mt-2 text-sm text-slate-500">{t('No agent has shared a location yet. Ask an agent to open the app during working hours.')}</p>}
            <p className="mt-2 text-xs text-slate-500">
              <span className="text-emerald-600">●</span> {t('Live')} &nbsp; <span className="text-amber-600">●</span> {t('No signal for 3+ minutes')} &nbsp; <span className="text-slate-500">●</span> {t('Off duty (last known place)')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
