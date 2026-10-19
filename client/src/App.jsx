import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { useI18n } from './lib/i18n.jsx';
import Layout from './components/Layout.jsx';
import ChangePasswordForm from './components/ChangePasswordForm.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Parties from './pages/Parties.jsx';
import PartyImport from './pages/PartyImport.jsx';
import Products from './pages/Products.jsx';
import ProductPage from './pages/ProductPage.jsx';
import Agents from './pages/Agents.jsx';
import Settings from './pages/Settings.jsx';
import Account from './pages/Account.jsx';
import ProductImport from './pages/ProductImport.jsx';
import NewOrder from './pages/NewOrder.jsx';
import Orders from './pages/Orders.jsx';
import OrderPage from './pages/OrderPage.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoicePage from './pages/InvoicePage.jsx';
import LiveMap from './pages/LiveMap.jsx';
import { TrackingProvider } from './lib/tracking.jsx';
import NotFound from './pages/NotFound.jsx';

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-brand-700">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

// First login (or after an owner reset): the person must choose a new password before anything else.
function ForcedPasswordChange() {
  const { t } = useI18n();
  const { logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-bold text-slate-900">{t('Set a new password')}</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">{t('For your safety, please choose your own password before you continue.')}</p>
        <ChangePasswordForm />
        <button type="button" onClick={logout} className="mt-4 w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700">
          {t('Log out')}
        </button>
      </div>
    </div>
  );
}

function RequireAuth() {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  return (
    <TrackingProvider>
      <Outlet />
    </TrackingProvider>
  );
}

function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="parties" element={<Parties />} />
          <Route
            path="parties/import"
            element={
              <AdminOnly>
                <PartyImport />
              </AdminOnly>
            }
          />
          <Route
            path="products/import"
            element={
              <AdminOnly>
                <ProductImport />
              </AdminOnly>
            }
          />
          <Route path="products" element={<Products />} />
          <Route path="products/:id" element={<ProductPage />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/new" element={<NewOrder />} />
          <Route path="orders/:id" element={<OrderPage />} />
          <Route
            path="invoices"
            element={
              <AdminOnly>
                <Invoices />
              </AdminOnly>
            }
          />
          <Route
            path="invoices/:id"
            element={
              <AdminOnly>
                <InvoicePage />
              </AdminOnly>
            }
          />
          <Route
            path="tracking"
            element={
              <AdminOnly>
                <LiveMap />
              </AdminOnly>
            }
          />
          <Route
            path="agents"
            element={
              <AdminOnly>
                <Agents />
              </AdminOnly>
            }
          />
          <Route
            path="settings"
            element={
              <AdminOnly>
                <Settings />
              </AdminOnly>
            }
          />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
