import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, hasToken, onSessionProblem, setToken } from './api.js';
import { attachUser, detachUser, initOffline } from '../offline/index.js';
import { useToast } from '../components/ui.jsx';

const AuthCtx = createContext(null);
const USER_KEY = 'shoptrack_user';

const readCachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch (e) {
    return null;
  }
};
const cacheUser = (u) => {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch (e) {
    /* ignore */
  }
};

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  const [booting, setBooting] = useState(hasToken());
  const [notice, setNotice] = useState('');
  const toast = useToast();

  const setUser = useCallback((u) => {
    setUserState(u);
    cacheUser(u);
  }, []);

  // server says: session over / password change needed
  useEffect(() => {
    onSessionProblem((err) => {
      if (err.code === 'MUST_CHANGE_PASSWORD') {
        setUserState((u) => (u ? { ...u, mustChangePassword: true } : u));
      } else {
        setToken(null);
        setUser(null);
        setNotice(err.message);
      }
    });
  }, [setUser]);

  // on app start: who am I?
  useEffect(() => {
    if (!hasToken()) {
      setBooting(false);
      return;
    }
    // start the offline engine first, so saved data is there even with no internet
    initOffline()
      .then(() => api.get('/auth/me'))
      .then((r) => {
        setUser(r.user);
        if (!r.user.mustChangePassword) return attachUser(r.user);
        return null;
      })
      .catch((err) => {
        // offline at start-up: let the person in with the last known profile
        if (err.code === 'NETWORK') {
          const cached = readCachedUser();
          if (cached) {
            setUserState(cached);
            return attachUser(cached).catch(() => {});
          }
        }
        return null;
      })
      .finally(() => setBooting(false));
  }, [setUser]);

  const login = useCallback(
    async (email, password) => {
      const r = await api.post('/auth/login', { email, password });
      await initOffline();
      if (!r.user.mustChangePassword) await attachUser(r.user); // may refuse: unsynced work of another account is still on this device
      setToken(r.token);
      setUser(r.user);
      setNotice('');
      return r.user;
    },
    [setUser]
  );

  // Log out only when everything is sent to the server (the offline copy on this device is cleared afterwards).
  const logout = useCallback(async () => {
    const r = await detachUser();
    if (!r.ok) {
      toast.error(r.message);
      return r;
    }
    setToken(null);
    setUser(null);
    return r;
  }, [setUser, toast]);

  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      const r = await api.post('/auth/change-password', { currentPassword, newPassword });
      setToken(r.token);
      setUser(r.user);
      await attachUser(r.user);
      return r.user;
    },
    [setUser]
  );

  const value = useMemo(
    () => ({ user, booting, notice, isAdmin: !!user && user.role === 'ADMIN', login, logout, changePassword }),
    [user, booting, notice, login, logout, changePassword]
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
