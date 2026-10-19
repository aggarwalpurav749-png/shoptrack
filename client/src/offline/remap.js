// Same idea as server/src/utils/syncRemap.js: swap temporary (negative) ids for real ones in queued changes.
const isIdKey = (k) => /Id$/.test(k) || k === 'id' || k === 'ids';

export function remapIds(value, map, key = '') {
  if (Array.isArray(value)) return value.map((x) => remapIds(x, map, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, map, k)]));
  if (typeof value === 'number' && value < 0 && isIdKey(key) && map.has(value)) return map.get(value);
  return value;
}
export const remapPath = (path, map) => path.replace(/\/(-\d+)(?=\/|$)/g, (m, n) => (map.has(Number(n)) ? `/${map.get(Number(n))}` : m));

/** which local table does a created record belong to? */
export function tableFor(path) {
  if (path === '/orders') return 'orders';
  if (path === '/parties') return 'parties';
  if (path === '/products') return 'products';
  if (path.startsWith('/invoices/from-order')) return 'invoices';
  return null;
}
