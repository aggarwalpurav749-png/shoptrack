// Location source. On the Android app a background service keeps GPS running with the screen off (shows a notification);
// in a browser / Windows it uses the normal browser location.
import { registerPlugin } from '@capacitor/core';

export const isNativeApp = () => typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

let plugin = null;
const bg = () => {
  if (!plugin) plugin = registerPlugin('BackgroundGeolocation');
  return plugin;
};

const webMessage = (e) => {
  if (e && e.code === 1) return 'Location is blocked. Allow location for ShopTrack, then try again.';
  if (e && e.code === 2) return 'Location is not available. Turn on GPS / Location on your phone.';
  if (e && e.code === 3) return 'Getting location took too long. Go outside or check GPS.';
  return (e && e.message) || 'Could not get location';
};

/** onPos({lat,lng,accuracy,speed}), onErr({code: 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'ERROR', message}). Returns a function that stops watching. */
export function watchLocation(onPos, onErr) {
  if (isNativeApp()) {
    let id = null;
    let stopped = false;
    bg()
      .addWatcher(
        {
          backgroundTitle: 'ShopTrack: location ON',
          backgroundMessage: 'Your location is shared with the owner during working hours.',
          requestPermissions: true,
          stale: false,
        },
        (loc, err) => {
          if (err) {
            const denied = err.code === 'NOT_AUTHORIZED';
            onErr({ code: denied ? 'DENIED' : 'ERROR', message: denied ? 'Location permission is OFF. Allow location "All the time" for ShopTrack.' : err.message || 'Could not get location' });
            return;
          }
          onPos({ lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy, speed: loc.speed == null || Number.isNaN(loc.speed) ? null : Math.max(0, loc.speed) });
        }
      )
      .then((wid) => {
        if (stopped) bg().removeWatcher({ id: wid });
        else id = wid;
      })
      .catch((e) => onErr({ code: 'ERROR', message: (e && e.message) || 'Could not start location' }));
    return () => {
      stopped = true;
      if (id !== null) bg().removeWatcher({ id });
    };
  }

  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    onErr({ code: 'UNAVAILABLE', message: 'This device cannot share location.' });
    return () => {};
  }
  const wid = navigator.geolocation.watchPosition(
    (p) => onPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed == null || Number.isNaN(p.coords.speed) ? null : Math.max(0, p.coords.speed) }),
    (e) => onErr({ code: e.code === 1 ? 'DENIED' : e.code === 2 ? 'UNAVAILABLE' : 'TIMEOUT', message: webMessage(e) }),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
  );
  return () => navigator.geolocation.clearWatch(wid);
}

/** One-off check (used outside working hours): resolves {ok:true} or {ok:false, code, message}. Never keeps GPS running. */
export function checkLocation(timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    let stop = () => {};
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: true, slow: true }), timeoutMs); // permission fine, just no fix yet
    stop = watchLocation(
      () => finish({ ok: true }),
      (e) => finish(e.code === 'DENIED' || e.code === 'UNAVAILABLE' ? { ok: false, code: e.code, message: e.message } : { ok: true, slow: true })
    );
    if (done) stop();
  });
}

export function openLocationSettings() {
  if (isNativeApp()) bg().openSettings().catch(() => {});
}
