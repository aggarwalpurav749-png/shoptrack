import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import HI from './hi.js';

// Usage:  const { t } = useI18n();   t('Save')   ->  "Save" or "सेव करें"
// English text is the key. If a Hindi word is missing, English is shown, so nothing ever breaks.
const I18nCtx = createContext({ lang: 'en', t: (s) => s, toggle: () => {} });
const KEY = 'shoptrack_lang';

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'hi' ? 'hi' : 'en';
    } catch (e) {
      return 'en';
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(KEY, lang);
    } catch (e) {
      /* ignore */
    }
  }, [lang]);

  const t = useCallback((s) => (lang === 'hi' && HI[s]) || s, [lang]);
  const toggle = useCallback(() => setLang((l) => (l === 'en' ? 'hi' : 'en')), []);
  const value = useMemo(() => ({ lang, t, toggle }), [lang, t, toggle]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
