import { useCallback, useEffect, useState } from 'react';

// Keeps a Set of selected ids across pages. `resetKey` changes (filters) -> selection clears.
export default function useBulkSelect(pageIds, resetKey) {
  const [on, setOn] = useState(false);
  const [sel, setSel] = useState(() => new Set());

  useEffect(() => {
    setSel(new Set());
  }, [resetKey]);

  const toggle = useCallback((id) => {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const togglePage = useCallback(() => {
    setSel((s) => {
      const n = new Set(s);
      if (pageIds.length > 0 && pageIds.every((id) => n.has(id))) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  }, [pageIds]);

  const exit = useCallback(() => {
    setOn(false);
    setSel(new Set());
  }, []);

  return { on, setOn, sel, setSel, toggle, allOnPage, togglePage, exit };
}
