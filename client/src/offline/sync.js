// Keeps the device and the server in step:  send my changes -> send my GPS points -> fetch what changed -> top up number blocks.
// Runs by itself: on start, when the internet comes back, when the app is opened again, every 30 seconds, and right after any change.
import { netRequest } from '../lib/api.js';
import { store } from './store.js';
import { numbers } from './numbers.js';
import { emit, on } from './events.js';
import { remapIds, remapPath, tableFor } from './remap.js';

const state = { online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing: false, pendingOps: 0, pendingPings: 0, lastSync: null, error: '', failed: [] };
export const getSyncState = () => state;
const publish = (patch = {}) => {
  Object.assign(state, patch, {
    pendingOps: store.outbox().length,
    pendingPings: store.pings().length,
    failed: store.kvGet('failedOps', []),
    lastSync: store.kvGet('lastSync', null),
  });
  emit('sync-state', { ...state });
};

let running = false;
let timer = null;
let kickTimer = null;
let started = false;

const isNetwork = (e) => e && (e.code === 'NETWORK' || e.status === 0);

// ─── 1. my changes -> server ─────────────────────────────────────────
async function pushOps() {
  let needFull = false;
  while (store.outbox().length) {
    const batch = store.outbox().slice(0, 60);
    const r = await netRequest('POST', '/sync/push', { body: { ops: batch.map(({ id, method, path, body, tempId }) => ({ id, method, path, body, tempId })) }, timeout: 60000 });
    const done = [];
    const aliases = store.kvGet('aliases', {});
    const idMap = new Map();
    let stopped = false;
    for (const res of r.results || []) {
      const op = batch.find((o) => o.id === res.id);
      if (!op) continue;
      if (res.ok) {
        done.push(op.id);
        if (op.tempId && res.realId) {
          const table = tableFor(op.path);
          if (table) {
            aliases[`${table}:${op.tempId}`] = res.realId;
            store.remove(table, op.tempId);
          }
          idMap.set(op.tempId, res.realId);
        }
        if (res.warnings && res.warnings.length) store.kvSet('warnings', [...store.kvGet('warnings', []), `Stock went below zero: ${res.warnings.join(', ')}`].slice(-20));
      } else if (res.retry) {
        stopped = true;
        break;
      } else {
        // the server said no (e.g. duplicate phone, product removed). Drop the change, remember why, and re-download the truth.
        done.push(op.id);
        needFull = true;
        if (op.tempId) {
          const table = tableFor(op.path);
          if (table) store.remove(table, op.tempId);
        }
        store.kvSet('failedOps', [...store.kvGet('failedOps', []), { at: new Date().toISOString(), method: op.method, path: op.path, message: res.error || 'Could not save', code: res.code }].slice(-30));
      }
    }
    store.kvSet('aliases', aliases);
    store.dropOps(done);
    // later changes that still point to a temporary id get the real one
    if (idMap.size) {
      store.outbox().forEach((o) => {
        o.path = remapPath(o.path, idMap);
        o.body = remapIds(o.body, idMap);
      });
      store.saveOps();
    }
    if (done.length) emit('data');
    publish();
    if (stopped || !done.length) {
      if (store.outbox().length) throw Object.assign(new Error('Server busy, will retry'), { code: 'NETWORK' });
    }
  }
  if (needFull) store.kvSet('cursor', null);
}

// ─── 2. my GPS points -> server ──────────────────────────────────────
async function pushPings() {
  const user = store.kvGet('user');
  if (!user || user.role !== 'AGENT') return;
  const pings = store.pings().slice(0, 500);
  const events = store.kvGet('events', []).slice(0, 200);
  const duty = store.kvGet('dutyDirty') ? { on: !!store.kvGet('duty', { on: false }).on } : undefined;
  if (!pings.length && !events.length && !duty) return;
  try {
    await netRequest('POST', '/sync/pings', { body: { pings: pings.map(({ lat, lng, accuracy, speed, battery, at }) => ({ lat, lng, accuracy, speed, battery, at })), events, duty } });
  } catch (e) {
    if (isNetwork(e) || e.status >= 500 || e.status === 401) throw e;
    // a bad request must not block the queue forever
  }
  store.dropPings(pings.map((p) => p.seq));
  store.kvSet('events', store.kvGet('events', []).slice(events.length));
  if (duty) store.kvSet('dutyDirty', false);
  if (store.pings().length > 0) await pushPings();
}

// ─── 3. server -> my device ──────────────────────────────────────────
async function pull(full) {
  const since = full ? null : store.kvGet('cursor', null);
  const r = await netRequest('GET', '/sync/pull', { query: { since: since || undefined }, timeout: 90000 });
  const user = store.kvGet('user');
  const total = ['users', 'parties', 'products', 'orders', 'invoices'].reduce((a, k) => a + (r[k] || []).length, 0);
  store.putMany('users', r.users || []);
  store.putMany('parties', r.parties || []);
  store.putMany('products', r.products || []);
  store.putMany('orders', r.orders || []);
  if (r.invoices && r.invoices.length) store.putMany('invoices', r.invoices);
  if (r.visiblePartyIds) {
    const keep = new Set(r.visiblePartyIds);
    store.removeMany('parties', store.list('parties').filter((p) => p.id > 0 && !keep.has(p.id)).map((p) => p.id));
  }
  store.kvSet('settings', r.settings);
  store.kvSet('timezone', r.timezone || 'Asia/Kolkata');
  if (r.live) store.kvSet('live', r.live);
  const me = (r.users || []).find((u) => user && u.id === user.id);
  if (me) {
    store.kvSet('user', { ...user, name: me.name, phone: me.phone, workStart: me.workStart, workEnd: me.workEnd });
    if (store.kvGet('duty', null) === null) store.kvSet('duty', { on: !!me.onDuty, since: me.onDutySince || null });
  }
  // a small overlap is harmless (rows are simply saved again) and covers changes that were still being committed
  store.kvSet('cursor', new Date(new Date(r.serverTime).getTime() - 15000).toISOString());
  if (!store.isReady()) store.markReady();
  if (total > 0 || full || !since) emit('data');
}

// ─── 4. order / estimate numbers for offline use ─────────────────────
async function topUpBlocks() {
  const user = store.kvGet('user');
  if (!user) return;
  const kinds = user.role === 'ADMIN' ? ['ORDER', 'INVOICE'] : ['ORDER'];
  for (const kind of kinds) {
    if (numbers.remaining(kind) < 10) {
      const b = await netRequest('POST', '/sync/blocks', { body: { kind, count: 30 } });
      numbers.add(kind, b.from, b.to);
    }
  }
}

export async function runSync({ full = false } = {}) {
  if (running || !store.kvGet('user')) return;
  running = true;
  publish({ syncing: true });
  try {
    await pushOps();
    await pushPings();
    if (store.outbox().length === 0) await pull(full || store.kvGet('cursor', null) === null);
    await topUpBlocks();
    store.kvSet('lastSync', new Date().toISOString());
    publish({ error: '', online: true });
  } catch (e) {
    publish({ error: isNetwork(e) ? '' : e.message || 'Sync problem', online: isNetwork(e) ? false : state.online });
  } finally {
    running = false;
    publish({ syncing: false });
  }
}

const kick = () => {
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => runSync(), 500);
};

export function startSync() {
  if (started) return;
  started = true;
  on('kick', kick);
  window.addEventListener('online', () => {
    publish({ online: true });
    runSync();
  });
  window.addEventListener('offline', () => publish({ online: false }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && runSync());
  timer = setInterval(() => navigator.onLine !== false && runSync(), 30000);
  publish();
  runSync();
}

export function stopSync() {
  started = false;
  clearInterval(timer);
  clearTimeout(kickTimer);
}

export function dismissFailed() {
  store.kvSet('failedOps', []);
  store.kvSet('warnings', []);
  publish();
}

export const syncNow = () => runSync();
export { publish as refreshSyncState };
