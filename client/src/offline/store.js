// The phone's / PC's own copy of the shop data. Everything is kept in memory (fast, synchronous reads)
// and written through to IndexedDB so it survives closing the app.
import { idb, TABLES } from './idb.js';
import { emit } from './events.js';

const mem = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
let kv = {};
let outbox = [];
let pings = [];
let ready = false;
let writes = Promise.resolve();

// all disk writes happen one after another, in order
const persist = (fn) => {
  writes = writes.then(fn).catch(() => {});
  return writes;
};

export const store = {
  async init() {
    for (const t of TABLES) mem[t] = new Map((await idb.getAll(t)).map((r) => [r.id, r]));
    kv = Object.fromEntries((await idb.getAll('kv')).map((r) => [r.k, r.v]));
    outbox = (await idb.getAll('outbox')).sort((a, b) => a.seq - b.seq);
    pings = (await idb.getAll('pings')).sort((a, b) => a.seq - b.seq);
    ready = !!kv.firstSyncDone;
    emit('store');
  },
  isReady: () => ready,
  markReady() {
    ready = true;
    this.kvSet('firstSyncDone', true);
  },

  // ── tables ──
  list: (t) => Array.from(mem[t].values()),
  get: (t, id) => mem[t].get(id),
  put(t, row) {
    mem[t].set(row.id, row);
    persist(() => idb.put(t, row));
  },
  putMany(t, rows) {
    rows.forEach((r) => mem[t].set(r.id, r));
    persist(() => idb.putMany(t, rows));
  },
  remove(t, id) {
    mem[t].delete(id);
    persist(() => idb.del(t, id));
  },
  removeMany(t, ids) {
    ids.forEach((id) => mem[t].delete(id));
    persist(() => idb.delMany(t, ids));
  },

  // ── small settings ──
  kvGet: (k, d = null) => (kv[k] === undefined ? d : kv[k]),
  kvSet(k, v) {
    kv[k] = v;
    persist(() => idb.put('kv', { k, v }));
  },

  // ── queue of changes waiting to be sent ──
  outbox: () => outbox,
  pushOp(op) {
    const seq = (kv.opSeq || 0) + 1;
    this.kvSet('opSeq', seq);
    const row = { ...op, seq, queuedAt: new Date().toISOString() };
    outbox.push(row);
    persist(() => idb.put('outbox', row));
    emit('outbox');
    return row;
  },
  saveOps() {
    const copy = outbox.slice();
    persist(() => idb.putMany('outbox', copy));
  },
  dropOps(ids) {
    const gone = outbox.filter((o) => ids.includes(o.id));
    outbox = outbox.filter((o) => !ids.includes(o.id));
    persist(() => idb.delMany('outbox', gone.map((o) => o.seq)));
    emit('outbox');
  },

  // ── GPS points waiting to be sent ──
  pings: () => pings,
  pushPing(p) {
    const seq = (kv.pingSeq || 0) + 1;
    this.kvSet('pingSeq', seq);
    const row = { ...p, seq };
    pings.push(row);
    persist(() => idb.put('pings', row));
    return row;
  },
  dropPings(seqs) {
    const set = new Set(seqs);
    pings = pings.filter((p) => !set.has(p.seq));
    persist(() => idb.delMany('pings', seqs));
  },

  /** Forget everything on this device (used when a different person logs in, or after logout). */
  async wipe() {
    TABLES.forEach((t) => mem[t].clear());
    kv = {};
    outbox = [];
    pings = [];
    ready = false;
    await writes;
    await idb.clearAll();
    emit('store');
  },
};
