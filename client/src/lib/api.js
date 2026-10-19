// Tiny fetch wrapper: adds the login token, turns server errors into ApiError, retries safe GETs once.
// Reads and changes for shop data are answered by the offline engine (src/offline) when this device has synced once;
// everything else (login, photos, imports, agent management...) goes to the server.
import { ApiError } from './errors.js';
import { NOT_HANDLED } from '../offline/local.js';

export { ApiError };

const TOKEN_KEY = 'shoptrack_token';
const SERVER_KEY = 'shoptrack_server';
const ENV_BASE = import.meta.env.VITE_API_BASE_URL || '';

let token = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch (e) {
  /* private mode: keep going without storage */
}

export function setToken(t) {
  token = t || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* ignore */
  }
}
export const hasToken = () => !!token;

/** The Android / Windows apps are not served by the shop server, so they need to be told its address once. */
export const isNativeShell = () =>
  typeof window !== 'undefined' && (['file:', 'app:'].includes(window.location.protocol) || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()));
export const getServerUrl = () => {
  try {
    return localStorage.getItem(SERVER_KEY) || ENV_BASE;
  } catch (e) {
    return ENV_BASE;
  }
};
export function setServerUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    if (u) localStorage.setItem(SERVER_KEY, u);
    else localStorage.removeItem(SERVER_KEY);
  } catch (e) {
    /* ignore */
  }
  return u;
}
export const needsServerUrl = () => isNativeShell() && !getServerUrl();
const base = () => getServerUrl().replace(/\/$/, '');

// AuthProvider registers this to react to "session ended" / "must change password"
let sessionHandler = () => {};
export const onSessionProblem = (fn) => {
  sessionHandler = fn;
};

// the offline engine plugs in here
let localHandler = null;
let afterNetworkWrite = null;
export const setLocalHandler = (handler, afterWrite) => {
  localHandler = handler;
  afterNetworkWrite = afterWrite;
};

const qs = (query) => {
  if (!query) return '';
  const p = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  const s = p.toString();
  return s ? '?' + s : '';
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, path, { body, query, form, timeout = 30000, asBlob = false } = {}) {
  const url = `${base()}/api${path}${qs(query)}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const attempts = method === 'GET' ? 2 : 1;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { method, headers, body: payload, signal: ctrl.signal });
      if (res.status >= 502 && res.status <= 504 && i < attempts - 1) {
        await wait(1200);
        continue;
      }
      if (!res.ok) {
        let data = {};
        try {
          data = await res.json();
        } catch (e) {
          /* not json */
        }
        const err = new ApiError(data.error || `Server error (${res.status})`, { status: res.status, code: data.code || 'ERROR', fields: data.fields || {} });
        if (res.status === 401 && !path.startsWith('/auth/login')) sessionHandler(err);
        if (res.status === 403 && err.code === 'MUST_CHANGE_PASSWORD') sessionHandler(err);
        throw err;
      }
      if (asBlob) return await res.blob();
      if (res.status === 204) return null;
      return await res.json();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      lastErr = e;
      if (i < attempts - 1) {
        await wait(1200);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const timedOut = lastErr && lastErr.name === 'AbortError';
  throw new ApiError(timedOut ? 'The server is taking too long. Check your internet and try again.' : 'Cannot reach the server. Check your internet connection.', {
    status: 0,
    code: 'NETWORK',
  });
}

/** Straight to the server (used by the sync engine). */
export const netRequest = (method, path, opts) => request(method, path, opts);

async function route(method, path, opts = {}) {
  if (localHandler) {
    const hit = await localHandler(method, path, { query: opts.query, body: opts.body });
    if (hit !== NOT_HANDLED) return hit;
  }
  const out = await request(method, path, opts);
  // photos, agents, settings... changed on the server: fetch the new state soon
  if (method !== 'GET' && afterNetworkWrite) afterNetworkWrite();
  return out;
}

export const api = {
  get: (path, query) => route('GET', path, { query }),
  post: (path, body) => route('POST', path, { body }),
  put: (path, body) => route('PUT', path, { body }),
  patch: (path, body) => route('PATCH', path, { body }),
  del: (path) => route('DELETE', path),
  upload: (path, formData) => route('POST', path, { form: formData, timeout: 90000 }),
  blob: (path) => route('GET', path, { asBlob: true }),
};

/** Photos saved on the server itself are returned as "/uploads/x.jpg" - make them absolute if the API lives elsewhere. */
export const assetUrl = (u) => (!u ? '' : /^(https?:|blob:|data:)/.test(u) ? u : base() + u);

/** Download a file that needs the login token (e.g. the CSV template). */
export async function downloadFromApi(path, filename) {
  const blob = await api.blob(path);
  saveBlob(blob, filename);
}

export async function saveBlob(blob, filename) {
  // Android app: the web view cannot download files, so open the phone's share sheet (save to Drive / WhatsApp / Files)
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && navigator.canShare) {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
