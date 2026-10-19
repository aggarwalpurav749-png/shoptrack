import { useEffect, useState } from 'react';
import { getSyncState } from './sync.js';
import { on } from './events.js';

export function useSyncState() {
  const [s, setS] = useState({ ...getSyncState() });
  useEffect(() => on('sync-state', (v) => setS(v)), []);
  return s;
}

/** Re-run a page's fetch when synced data arrives. */
export const onDataChanged = (fn) => {
  return on('data', fn);
};
