import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { I18nProvider } from './lib/i18n.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { ShopProvider } from './lib/shop.jsx';
import { ConfirmProvider, ToastProvider } from './components/ui.jsx';
import { initOffline } from './offline/index.js';
import { isNativeShell } from './lib/api.js';
import './index.css';

// the Windows app opens the page from a file, where normal URLs do not work: use #/ addresses there
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

// load the saved shop data first, so the app opens instantly even with no internet
initOffline().catch(() => {}).finally(() =>
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <I18nProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <ShopProvider>
                <App />
              </ShopProvider>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </Router>
  </React.StrictMode>
));

// Offline-ready app shell (only in the built version, not while developing)
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeShell()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
