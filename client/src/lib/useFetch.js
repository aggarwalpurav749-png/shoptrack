import { useCallback, useEffect, useRef, useState } from 'react';
import { onDataChanged } from '../offline/useSync.js';

/**
 * const { data, loading, error, reload } = useFetch(() => api.get('/x'), [dep1, dep2]);
 * Keeps the previous data on screen while a new request is loading (no flicker when filtering).
 * options.live: also reload by itself when new data arrives from the server (use on list pages, not on edit forms).
 */
export default function useFetch(fetcher, deps = [], options = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef
      .current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState((s) => ({ data: s.data, loading: false, error })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const live = !!options.live;
  useEffect(() => (live ? onDataChanged(reload) : undefined), [live, reload]);
  return { ...state, reload };
}
