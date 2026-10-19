// Order / estimate numbers handed out by the server in advance (see server/src/utils/numbers.js).
// A device numbers its own bills from these while offline, so the number printed is already the final one.
import { store } from './store.js';

const key = (kind) => `blocks_${kind}`;

export const numbers = {
  /** next free number of this kind, or null if this device has none left */
  take(kind) {
    const ranges = store.kvGet(key(kind), []);
    for (const r of ranges) {
      if (r.next <= r.to) {
        const n = r.next;
        r.next += 1;
        store.kvSet(key(kind), ranges.filter((x) => x.next <= x.to));
        return n;
      }
    }
    return null;
  },
  remaining(kind) {
    return store.kvGet(key(kind), []).reduce((a, r) => a + Math.max(0, r.to - r.next + 1), 0);
  },
  add(kind, from, to) {
    store.kvSet(key(kind), [...store.kvGet(key(kind), []), { from, to, next: from }]);
  },
};
