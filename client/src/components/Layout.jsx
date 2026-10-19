import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useShop } from '../lib/shop.jsx';
import { assetUrl } from '../lib/api.js';
import { Icon } from './ui.jsx';
import SyncBadge from './SyncBadge.jsx';
import GpsGate from './GpsGate.jsx';

const ADMIN_NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/orders', label: 'Orders', icon: 'cart' },
  { to: '/invoices', label: 'Estimates', icon: 'receipt' },
  { to: '/parties', label: 'Parties', icon: 'users' },
  { to: '/products', label: 'Products', icon: 'box' },
  { to: '/agents', label: 'Agents', icon: 'truck' },
  { to: '/tracking', label: 'Live tracking', icon: 'map' },
  { to: '/settings', label: 'Settings', icon: 'sliders' },
  { to: '/account', label: 'Account', icon: 'user' },
];
const AGENT_NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/orders', label: 'Orders', icon: 'cart' },
  { to: '/parties', label: 'Parties', icon: 'users' },
  { to: '/products', label: 'Products', icon: 'box' },
  { to: '/account', label: 'Account', icon: 'user' },
];

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function Brand({ shop }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {shop && shop.logoUrl ? (
        <img src={assetUrl(shop.logoUrl)} alt="" className="h-9 w-9 rounded-lg border border-slate-200 bg-white object-contain" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white">
          <Icon name="box" className="h-5 w-5" />
        </span>
      )}
      <span className="truncate text-base font-bold text-slate-900">{shop ? shop.shopName : 'ShopTrack'}</span>
    </div>
  );
}

function LangButton() {
  const { lang, toggle } = useI18n();
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex min-h-[36px] items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      aria-label="Change language"
    >
      <Icon name="globe" className="h-4 w-4" />
      {lang === 'en' ? 'हिंदी' : 'English'}
    </button>
  );
}

export default function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const { shop } = useShop();
  const { t } = useI18n();
  const online = useOnline();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const nav = isAdmin ? ADMIN_NAV : AGENT_NAV;

  useEffect(() => setDrawer(false), [location.pathname]);

  const linkCls = ({ isActive }) =>
    `flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
      isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100'
    }`;

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 px-1 pt-1">
        <Brand shop={shop} />
      </div>
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>
          <Icon name={n.icon} />
          {t(n.label)}
        </NavLink>
      ))}
      <div className="mt-auto border-t border-slate-200 pt-3">
        <p className="truncate px-3 text-sm font-semibold text-slate-800">{user.name}</p>
        <p className="mb-2 truncate px-3 text-xs text-slate-500">{user.email}</p>
        <button type="button" onClick={logout} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50">
          <Icon name="logout" />
          {t('Log out')}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen">
      {/* Admin: sidebar on large screens, slide-in drawer on phones */}
      {isAdmin && (
        <>
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>
          {drawer && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
              <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl">{sidebar}</aside>
            </div>
          )}
        </>
      )}

      <div className={isAdmin ? 'lg:pl-64' : ''}>
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            {isAdmin && (
              <button type="button" onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden" aria-label="Menu">
                <Icon name="menu" />
              </button>
            )}
            <div className={isAdmin ? 'lg:hidden' : ''}>
              <Brand shop={shop} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SyncBadge />
            <LangButton />
          </div>
        </header>
        <GpsGate />

        {!online && (
          <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white">
            <Icon name="wifioff" className="h-4 w-4" />
            {t('You are offline. Your work is saved on this device and will be sent when you are back online.')}
          </div>
        )}

        <main className={`mx-auto w-full max-w-6xl px-4 py-5 ${isAdmin ? '' : 'pb-24'}`}>
          <Outlet />
        </main>
      </div>

      {/* Agent: bottom navigation */}
      {!isAdmin && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive ? 'text-brand-700' : 'text-slate-500'}`}
            >
              <Icon name={n.icon} className="h-6 w-6" />
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
