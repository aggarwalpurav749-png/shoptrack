import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { getServerUrl, isNativeShell, setServerUrl } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { useShop } from '../lib/shop.jsx';
import { Button, Field, Icon, TextInput } from '../components/ui.jsx';

export default function Login() {
  const { t, lang, toggle } = useI18n();
  const { user, login, notice } = useAuth();
  const { shop } = useShop();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const native = isNativeShell(); // Android / Windows app: the shop server address must be entered once
  const [server, setServer] = useState(getServerUrl());

  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError(t('Enter your email and password'));
      return;
    }
    if (native) {
      if (!server.trim()) {
        setError(t('Enter the shop server address'));
        return;
      }
      setServerUrl(server);
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate((location.state && location.state.from) || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-lg">
          <Icon name="box" className="h-8 w-8" />
        </span>
        <h1 className="text-2xl font-bold text-slate-900">{shop ? shop.shopName : 'ShopTrack'}</h1>
        <p className="text-sm text-slate-500">{t('Orders, agents and estimates in one place')}</p>
      </div>

      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6" noValidate>
        {(notice || error) && (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error || notice}</span>
          </div>
        )}
        {native && (
          <Field label={t('Shop server address')} hint={t('Given by the owner, e.g. https://myshop.onrender.com')}>
            <TextInput type="url" inputMode="url" autoCapitalize="none" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://myshop.onrender.com" />
          </Field>
        )}
        <Field label={t('Email')}>
          <TextInput type="email" inputMode="email" autoComplete="username" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@shop.com" />
        </Field>
        <Field label={t('Password')}>
          <div className="relative">
            <TextInput type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500" aria-label="Show password">
              <Icon name={show ? 'eye-off' : 'eye'} className="h-5 w-5" />
            </button>
          </div>
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          {t('Log in')}
        </Button>
      </form>

      <button type="button" onClick={toggle} className="mt-5 flex items-center gap-2 text-sm font-medium text-slate-600">
        <Icon name="globe" className="h-4 w-4" />
        {lang === 'en' ? 'हिंदी में बदलें' : 'Switch to English'}
      </button>
    </div>
  );
}
