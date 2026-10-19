import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

// Shop name / logo / hours, loaded once after login and shown in the header.
const ShopCtx = createContext({ shop: null, refreshShop: () => {} });

export function ShopProvider({ children }) {
  const { user } = useAuth();
  const [shop, setShop] = useState(null);

  const refreshShop = useCallback(() => {
    api
      .get('/settings')
      .then((r) => setShop(r.settings))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user && !user.mustChangePassword) refreshShop();
  }, [user, refreshShop]);

  const value = useMemo(() => ({ shop, refreshShop, setShop }), [shop, refreshShop]);
  return <ShopCtx.Provider value={value}>{children}</ShopCtx.Provider>;
}

export const useShop = () => useContext(ShopCtx);
