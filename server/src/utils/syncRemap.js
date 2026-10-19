// While offline a device gives new records temporary NEGATIVE ids. When its queued changes are replayed on the server,
// every temporary id is swapped for the real one as soon as that record exists.

const isIdKey = (k) => /Id$/.test(k) || k === 'id' || k === 'ids';

/** Replace temp ids (negative numbers under keys like partyId / productId / orderId) using `map` (temp -> real). */
function remapIds(value, map, key = '') {
  if (Array.isArray(value)) return value.map((x) => remapIds(x, map, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapIds(v, map, k);
    return out;
  }
  if (typeof value === 'number' && value < 0 && isIdKey(key) && map.has(value)) return map.get(value);
  return value;
}

/** Same for the numeric segments of a URL path: /orders/-17/status */
function remapPath(path, map) {
  return path.replace(/\/(-\d+)(?=\/|$)/g, (m, n) => (map.has(Number(n)) ? `/${map.get(Number(n))}` : m));
}

/** Is there still an unresolved temp id? Then the change this one depends on has not been saved. */
function hasTempId(path, body, key = '') {
  if (typeof path === 'string' && /\/-\d+(?=\/|$)/.test(path)) return true;
  const walk = (v, k) => {
    if (Array.isArray(v)) return v.some((x) => walk(x, k));
    if (v && typeof v === 'object') return Object.entries(v).some(([kk, x]) => walk(x, kk));
    return typeof v === 'number' && v < 0 && isIdKey(k);
  };
  return walk(body, key);
}

/** Which id did the server give to the record this change created? */
function createdId(method, path, data) {
  if (!data || method !== 'POST') return null;
  if (path === '/orders') return data.order && data.order.id;
  if (path === '/parties') return data.party && data.party.id;
  if (path === '/products') return data.product && data.product.id;
  if (/^\/invoices\/from-order\//.test(path)) return data.id;
  return null;
}

const ALLOWED = [
  ['POST', /^\/orders$/],
  ['PUT', /^\/orders\/-?\d+$/],
  ['PATCH', /^\/orders\/-?\d+\/status$/],
  ['POST', /^\/invoices\/from-order\/-?\d+$/],
  ['POST', /^\/invoices\/-?\d+\/cancel$/],
  ['POST', /^\/parties$/],
  ['PUT', /^\/parties\/-?\d+$/],
  ['DELETE', /^\/parties\/-?\d+$/],
  ['POST', /^\/parties\/bulk-delete$/],
  ['POST', /^\/products\/bulk-delete$/],
  ['POST', /^\/products$/],
  ['PUT', /^\/products\/-?\d+$/],
  ['PATCH', /^\/products\/-?\d+\/archive$/],
  ['DELETE', /^\/products\/-?\d+$/],
];
const isAllowedOp = (method, path) => ALLOWED.some(([m, re]) => m === method && re.test(path));

module.exports = { remapIds, remapPath, hasTempId, createdId, isAllowedOp };
