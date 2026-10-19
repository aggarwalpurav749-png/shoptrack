import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { checkLocation, isNativeApp, openLocationSettings, watchLocation } from './geo.js';
import { dutyInfo, recordEvent } from '../offline/duty.js';
import { onDataChanged } from '../offline/useSync.js';

// Agent side of tracking. During working hours location is COMPULSORY: duty switches on by itself, the phone's position
// is saved on the device every ~20 seconds (works with no internet) and is sent to the owner whenever there is internet.
// If location is off or refused, GpsGate blocks the app until it is turned on again.
const TrackingCtx = createContext(null);
const SAVE_EVERY_MS = 20000;
const NO_FIX_AFTER_MS = 2 * 60 * 1000;

export function TrackingProvider({ children }) {
  const { user } = useAuth();
  const isAgent = !!user && user.role === 'AGENT' && !user.mustChangePassword;
  const [info, setInfo] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('starting'); // starting | ok | denied | unavailable | no_fix
  const [gps, setGps] = useState({ accuracy: null, lastSaved: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const lastFix = useRef(0);
  const lastSave = useRef(0);
  const statusRef = useRef('starting');
  const wakeRef = useRef(null);
  const activeRef = useRef(false);

  const setStatus = useCallback((s) => {
    if (statusRef.current === s) return;
    const bad = (x) => x === 'denied' || x === 'unavailable';
    // the owner is told only about switch-offs during working hours
    if (activeRef.current && bad(s) && !bad(statusRef.current)) recordEvent('GPS_OFF');
    if (activeRef.current && s === 'ok' && bad(statusRef.current)) recordEvent('GPS_ON');
    statusRef.current = s;
    setGpsStatus(s);
  }, []);

  // duty follows working hours by itself
  const refresh = useCallback(async () => {
    if (!isAgent) return;
    try {
      let i = dutyInfo(user);
      if (i.withinHours && !i.onDuty) {
        await api.post('/tracking/duty', { on: true });
        i = dutyInfo(user);
      } else if (!i.withinHours && i.onDuty) {
        await api.post('/tracking/duty', { on: false });
        i = dutyInfo(user);
      }
      setInfo(i);
    } catch (e) {
      /* ignore, tried again in 30 s */
    }
  }, [isAgent, user]);

  useEffect(() => {
    if (!isAgent) {
      setInfo(null);
      return undefined;
    }
    refresh();
    const t = setInterval(refresh, 30000);
    const off = onDataChanged(refresh);
    return () => {
      clearInterval(t);
      off();
    };
  }, [isAgent, refresh]);

  const active = !!(isAgent && info && info.withinHours);
  activeRef.current = active;
  const idle = !!(isAgent && info && !info.withinHours);

  // outside working hours nothing is recorded, but location must still be allowed: quick check now and every minute
  useEffect(() => {
    if (!idle) return undefined;
    let dead = false;
    const run = async () => {
      const r = await checkLocation();
      if (dead) return;
      if (r.ok) setStatus('ok');
      else {
        setStatus(r.code === 'DENIED' ? 'denied' : 'unavailable');
        setGps((g) => ({ ...g, error: r.message }));
      }
    };
    run();
    const t = setInterval(run, 60000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [idle, attempt, setStatus]);

  // watch the position while inside working hours
  useEffect(() => {
    if (!active) return undefined;
    lastFix.current = Date.now();
    const stop = watchLocation(
      (p) => {
        lastFix.current = Date.now();
        setStatus('ok');
        setGps((g) => ({ ...g, accuracy: Math.round(p.accuracy || 0), error: '' }));
        if (Date.now() - lastSave.current >= SAVE_EVERY_MS) {
          lastSave.current = Date.now();
          let battery = null;
          const done = (b) =>
            api
              .post('/tracking/ping', { lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, battery: b })
              .then((r) => r && r.saved && setGps((g) => ({ ...g, lastSaved: new Date() })))
              .catch(() => {});
          if (navigator.getBattery) navigator.getBattery().then((b) => done(Math.round(b.level * 100)), () => done(battery));
          else done(battery);
        }
      },
      (e) => {
        if (e.code === 'DENIED') setStatus('denied');
        else if (e.code === 'UNAVAILABLE') setStatus('unavailable');
        else if (e.code === 'TIMEOUT') setStatus('no_fix');
        setGps((g) => ({ ...g, error: e.message }));
      }
    );
    // no position for 2 minutes (GPS switched off, or deep indoors)
    const beat = setInterval(() => {
      if (Date.now() - lastFix.current > NO_FIX_AFTER_MS && statusRef.current === 'ok') setStatus('no_fix');
    }, 15000);
    return () => {
      stop();
      clearInterval(beat);
    };
  }, [active, attempt, setStatus]);

  // keep the screen awake in a browser (the Android app uses a background service instead)
  useEffect(() => {
    if (!active || isNativeApp() || !('wakeLock' in navigator)) return undefined;
    let cancelled = false;
    const lock = async () => {
      try {
        const w = await navigator.wakeLock.request('screen');
        if (cancelled) w.release();
        else wakeRef.current = w;
      } catch (e) {
        /* ignore */
      }
    };
    lock();
    const onVis = () => document.visibilityState === 'visible' && lock();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      if (wakeRef.current) wakeRef.current.release().catch(() => {});
      wakeRef.current = null;
    };
  }, [active]);

  const retry = useCallback(() => {
    statusRef.current = 'starting';
    setGpsStatus('starting');
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ isAgent, info, active, onDuty: !!(info && info.onDuty), gpsStatus, gps, retry, openSettings: openLocationSettings }),
    [isAgent, info, active, gpsStatus, gps, retry]
  );
  return <TrackingCtx.Provider value={value}>{children}</TrackingCtx.Provider>;
}

export const useTracking = () => useContext(TrackingCtx) || { isAgent: false, info: null, active: false, onDuty: false, gpsStatus: 'ok', gps: {}, retry() {}, openSettings() {} };
