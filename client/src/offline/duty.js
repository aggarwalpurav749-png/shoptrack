// Agent duty + GPS points, kept on the device and sent to the server when there is internet.
import { ApiError } from '../lib/errors.js';
import { store } from './store.js';
import { emit } from './events.js';

const tz = () => store.kvGet('timezone', 'Asia/Kolkata');

export function hhmmNow(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
    const h = parts.find((p) => p.type === 'hour').value.replace('24', '00');
    return `${h}:${parts.find((p) => p.type === 'minute').value}`;
  } catch (e) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

export function workHours(user) {
  const s = store.kvGet('settings', {}) || {};
  return { start: (user && user.workStart) || s.workStart || '09:00', end: (user && user.workEnd) || s.workEnd || '18:00' };
}
export const withinHoursNow = (user) => {
  const h = workHours(user);
  const n = hhmmNow();
  return n >= h.start && n <= h.end;
};

export function dutyInfo(user) {
  const d = store.kvGet('duty', { on: false, since: null });
  const h = workHours(user);
  return { onDuty: d.on, onDutySince: d.since, workStart: h.start, workEnd: h.end, withinHours: withinHoursNow(user) };
}

export function recordEvent(kind) {
  store.kvSet('events', [...store.kvGet('events', []), { kind, at: new Date().toISOString() }].slice(-300));
}

export function setDuty(on, user) {
  const h = workHours(user);
  if (on && !withinHoursNow(user)) throw new ApiError(`Duty can start only in your working hours (${h.start} - ${h.end})`, { status: 400, code: 'OFF_HOURS' });
  const cur = store.kvGet('duty', { on: false, since: null });
  if (cur.on !== on) {
    store.kvSet('duty', { on, since: on ? new Date().toISOString() : null });
    recordEvent(on ? 'DUTY_ON' : 'DUTY_OFF');
  }
  store.kvSet('dutyDirty', true);
  emit('kick');
  return { onDuty: on, workStart: h.start, workEnd: h.end };
}

export function recordPing(b, user) {
  const d = store.kvGet('duty', { on: false });
  if (!d.on) return { saved: false, reason: 'OFF_DUTY' };
  if (!withinHoursNow(user)) {
    setDuty(false, user);
    return { saved: false, reason: 'OFF_HOURS' };
  }
  const nowMs = Date.now();
  if (nowMs - store.kvGet('lastPingAt', 0) < 4000) return { saved: false, reason: 'TOO_FAST' };
  store.kvSet('lastPingAt', nowMs);
  store.pushPing({
    lat: Number(b.lat),
    lng: Number(b.lng),
    accuracy: b.accuracy == null ? null : Number(b.accuracy),
    speed: b.speed == null ? null : Number(b.speed),
    battery: b.battery == null ? null : Number(b.battery),
    at: new Date(nowMs).toISOString(),
  });
  emit('kick');
  return { saved: true };
}

const STALE_MS = 3 * 60 * 1000;
export function liveSnapshot() {
  const now = Date.now();
  const items = (store.kvGet('live', []) || []).map((a) => {
    const age = a.lastSeen ? now - new Date(a.lastSeen).getTime() : null;
    let status = 'OFF';
    if (a.onDuty) status = age !== null && age <= STALE_MS ? 'LIVE' : 'NO_SIGNAL';
    return { ...a, status, secondsAgo: age === null ? null : Math.round(age / 1000) };
  });
  return { items, serverTime: new Date().toISOString() };
}
