// The "server inside the app". It answers the same URLs as the real server, but from the data stored on this device,
// and every change is saved locally first and queued for the server (see sync.js).
import { ApiError } from '../lib/errors.js';
import { calcLines, r2 } from '../lib/calc.js';
import { store } from './store.js';
import { numbers } from './numbers.js';
import { emit } from './events.js';
import { dutyInfo, setDuty, recordPing, liveSnapshot } from './duty.js';

export const NOT_HANDLED = Symbol('not-handled');

// ─── helpers ─────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
let tempCounter = 0;
export const tempId = () => -(Date.now() * 1000 + (tempCounter++ % 1000));
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
const fail = (status, message, code = 'ERROR', fields = {}) => {
  throw new ApiError(message, { status, code, fields });
};
const lc = (v) => String(v == null ? '' : v).toLowerCase();
const has = (v, q) => lc(v).includes(q);
const numOr = (v, d = 0) => {
  const n = Number(v);
  return v === '' || v === null || v === undefined || Number.isNaN(n) ? d : n;
};
const textOrNull = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const page = (rows, q, dl) => {
  const p = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || dl));
  return { items: rows.slice((p - 1) * limit, p * limit), total: rows.length, page: p, limit };
};
const byCreatedDesc = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id);

/** a record created offline gets its real id later; pages that still hold the old id keep working */
export function resolveId(table, id) {
  if (store.get(table, id)) return id;
  const alias = store.kvGet('aliases', {})[`${table}:${id}`];
  return alias || id;
}

function queue(op) {
  store.pushOp({ id: uuid(), ...op });
  emit('kick');
}

export function tzDay(iso) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: store.kvGet('timezone', 'Asia/Kolkata') }).format(new Date(iso));
  } catch (e) {
    return String(iso).slice(0, 10);
  }
}
const today = () => tzDay(nowIso());

// ─── views (same shapes the server sends) ────────────────────────────
const agentName = (id) => {
  const u = id ? store.get('users', id) : null;
  return u ? u.name : null;
};

const partyView = (p) => ({ ...p, agentName: agentName(p.assignedAgentId) });

const primaryImage = (p) => {
  const imgs = [...(p.images || [])].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.id - b.id);
  return imgs[0] ? imgs[0].url : null;
};
const stockStatus = (p) => (p.stockQty <= 0 ? 'out' : p.stockQty <= p.lowStockLevel ? 'low' : 'in');
const productView = (p, isAdmin) => {
  const { images, deletedAt, ...rest } = p; // eslint-disable-line no-unused-vars
  if (!isAdmin) delete rest.costPrice;
  return { ...rest, stockStatus: stockStatus(p), imageUrl: primaryImage(p) };
};

function orderView(o) {
  const party = store.get('parties', o.partyId);
  const inv = o.invoiceId ? store.get('invoices', o.invoiceId) : null;
  const { items, ...rest } = o;
  return {
    ...rest,
    partyName: party ? party.name : 'Party',
    partyPhone: party ? party.phone : null,
    partyAddress: party ? party.address : null,
    partyArea: party ? party.area : null,
    agentName: agentName(o.agentId),
    invoiceNo: inv ? inv.invoiceNo : null,
    items: (items || []).map((it) => {
      const pr = store.get('products', it.productId);
      return { ...it, name: pr ? pr.name : 'Item', unit: pr ? pr.unit : '', sku: pr ? pr.sku : null, stockQty: pr ? pr.stockQty : 0, imageUrl: pr ? primaryImage(pr) : null };
    }),
  };
}

const shopFields = (s) => ({ shopName: s.shopName, logoUrl: s.logoUrl, address: s.address, phone: s.phone, email: s.email, bankName: s.bankName, accountNo: s.accountNo, ifsc: s.ifsc, upiId: s.upiId, terms: s.terms });

function invoiceView(inv) {
  const party = store.get('parties', inv.partyId) || {};
  const order = store.list('orders').find((o) => o.invoiceId === inv.id);
  const { items, ...rest } = inv;
  return {
    invoice: { ...rest, partyName: party.name || 'Party', partyOwner: party.ownerName || null, partyPhone: party.phone || null, partyAddress: party.address || null, partyArea: party.area || null, orderNo: order ? order.orderNo : null, orderId: order ? order.id : null },
    items: (items || []).map((it, i) => ({ id: it.id || i + 1, invoiceId: inv.id, ...it })),
    shop: shopFields(store.kvGet('settings', {})),
  };
}

// ─── building an order from a cart ───────────────────────────────────
function buildLines(items, allowPriceEdit) {
  if (!Array.isArray(items) || !items.length) fail(400, 'Add at least one product', 'VALIDATION');
  const merged = new Map();
  for (const it of items) {
    const productId = resolveId('products', Number(it.productId));
    const qty = Number(it.qty);
    if (!(qty > 0)) fail(400, 'Quantity must be more than 0', 'VALIDATION');
    const prev = merged.get(productId);
    if (prev) prev.qty = r2(prev.qty + qty);
    else merged.set(productId, { productId, qty, rate: it.rate, discount: it.discount });
  }
  const lines = [...merged.values()].map((it) => {
    const p = store.get('products', it.productId);
    if (!p || p.deletedAt) fail(400, 'One of the products no longer exists. Please refresh and try again.', 'VALIDATION');
    if (p.isArchived) fail(400, `"${p.name}" is archived and cannot be ordered`, 'VALIDATION');
    return {
      productId: it.productId,
      qty: it.qty,
      rate: allowPriceEdit && it.rate !== undefined && it.rate !== '' ? Number(it.rate) : p.sellingPrice,
      discount: allowPriceEdit && it.discount !== undefined && it.discount !== '' ? Number(it.discount) : 0,
      gstPercent: p.gstPercent,
    };
  });
  return calcLines(lines);
}

const orderItems = (calc, orderId) =>
  calc.lines.map((l, i) => ({ id: -(Date.now() * 10 + i), orderId, productId: l.productId, qty: l.qty, rate: l.rate, discount: l.discount, gstPercent: l.gstPercent, lineTotal: l.lineTotal }));

// ─── route table ─────────────────────────────────────────────────────
const routes = [];
const on = (method, re, fn) => routes.push({ method, re, fn });
const ID = '(-?\\d+)';

// parties
function filterParties(query) {
  const q = lc(query.q || '').trim();
  let rows = store.list('parties').filter((p) => !p.deletedAt);
  // agents see every party; they can narrow to "my parties" with agentId = their own id
  if (query.agentId === 'none') rows = rows.filter((p) => !p.assignedAgentId);
  else if (/^\d+$/.test(query.agentId || '')) rows = rows.filter((p) => p.assignedAgentId === Number(query.agentId));
  if (query.area) rows = rows.filter((p) => p.area === query.area);
  if (q) rows = rows.filter((p) => has(p.name, q) || has(p.ownerName, q) || has(p.phone, q) || has(p.area, q));
  return rows.sort((a, b) => lc(a.name).localeCompare(lc(b.name)) || a.id - b.id);
}
on('GET', /^\/parties$/, ({ query }) => {
  const out = page(filterParties(query), query, 50);
  return { ...out, items: out.items.map(partyView) };
});
// ids of everything matching the filters ("select all N"), owner only
on('GET', /^\/parties\/ids$/, ({ query, isAdmin }) => {
  needAdmin(isAdmin);
  return { ids: filterParties(query).slice(0, 5000).map((p) => p.id) };
});
on('GET', /^\/parties\/areas$/, () => {
  const rows = store.list('parties').filter((p) => !p.deletedAt && p.area);
  return { items: [...new Set(rows.map((p) => p.area))].sort((a, b) => lc(a).localeCompare(lc(b))) };
});
on('GET', new RegExp(`^/parties/${ID}$`), ({ params }) => {
  const p = store.get('parties', resolveId('parties', Number(params[0])));
  if (!p || p.deletedAt) fail(404, 'Party not found', 'NOT_FOUND');
  return { party: partyView(p) };
});

function partyFields(b, existing) {
  const name = textOrNull(b.name);
  if (!name) fail(400, 'Party name is required', 'VALIDATION', { name: 'Party name is required' });
  const phone = textOrNull(b.phone);
  if (phone) {
    const dup = store.list('parties').find((p) => !p.deletedAt && p.phone === phone && (!existing || p.id !== existing.id));
    if (dup) fail(409, `This phone number already belongs to "${dup.name}"`, 'DUPLICATE', { phone: `Already used by ${dup.name}` });
  }
  const agentRaw = b.assignedAgentId === '' || b.assignedAgentId == null ? null : Number(b.assignedAgentId);
  return {
    name,
    ownerName: textOrNull(b.ownerName),
    phone,
    email: textOrNull(b.email),
    address: textOrNull(b.address),
    area: textOrNull(b.area),
    creditLimit: numOr(b.creditLimit),
    openingBalance: numOr(b.openingBalance),
    assignedAgentId: agentRaw ? resolveId('users', agentRaw) : null,
  };
}

on('POST', /^\/parties$/, ({ body, isAdmin }) => {
  if (!isAdmin) fail(403, 'Only the owner can do this', 'FORBIDDEN');
  const f = partyFields(body, null);
  const id = tempId();
  const t = nowIso();
  const party = { id, ...f, currentBalance: f.openingBalance, isActive: true, deletedAt: null, createdAt: t, updatedAt: t };
  store.put('parties', party);
  queue({ method: 'POST', path: '/parties', body, tempId: id });
  return { party: partyView(party) };
});
on('PUT', new RegExp(`^/parties/${ID}$`), ({ params, body, isAdmin }) => {
  if (!isAdmin) fail(403, 'Only the owner can do this', 'FORBIDDEN');
  const id = resolveId('parties', Number(params[0]));
  const cur = store.get('parties', id);
  if (!cur || cur.deletedAt) fail(404, 'Party not found', 'NOT_FOUND');
  const f = partyFields(body, cur);
  const party = { ...cur, ...f, currentBalance: r2(cur.currentBalance + (f.openingBalance - cur.openingBalance)), updatedAt: nowIso() };
  store.put('parties', party);
  queue({ method: 'PUT', path: `/parties/${id}`, body });
  return { party: partyView(party) };
});
on('DELETE', new RegExp(`^/parties/${ID}$`), ({ params, isAdmin }) => {
  if (!isAdmin) fail(403, 'Only the owner can do this', 'FORBIDDEN');
  const id = resolveId('parties', Number(params[0]));
  const cur = store.get('parties', id);
  if (!cur || cur.deletedAt) fail(404, 'Party not found', 'NOT_FOUND');
  store.put('parties', { ...cur, deletedAt: nowIso(), isActive: false, updatedAt: nowIso() });
  queue({ method: 'DELETE', path: `/parties/${id}` });
  return { ok: true };
});

const bulkIds = (body) => {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n !== 0);
  if (!ids.length) fail(400, 'Choose at least one item', 'VALIDATION');
  return ids;
};
on('POST', /^\/parties\/bulk-delete$/, ({ body, isAdmin }) => {
  needAdmin(isAdmin);
  const ids = bulkIds(body).map((i) => resolveId('parties', i));
  const t = nowIso();
  let deleted = 0;
  ids.forEach((id) => {
    const cur = store.get('parties', id);
    if (cur && !cur.deletedAt) {
      store.put('parties', { ...cur, deletedAt: t, isActive: false, updatedAt: t });
      deleted += 1;
    }
  });
  queue({ method: 'POST', path: '/parties/bulk-delete', body: { ids } });
  return { ok: true, deleted };
});

// products
const SORTS = {
  name: (a, b) => lc(a.name).localeCompare(lc(b.name)) || a.id - b.id,
  price_asc: (a, b) => a.sellingPrice - b.sellingPrice || lc(a.name).localeCompare(lc(b.name)),
  price_desc: (a, b) => b.sellingPrice - a.sellingPrice || lc(a.name).localeCompare(lc(b.name)),
  stock_low: (a, b) => a.stockQty - b.stockQty || lc(a.name).localeCompare(lc(b.name)),
  newest: (a, b) => b.id - a.id,
};
function filterProducts(query, isAdmin) {
  const q = lc(query.q || '').trim();
  let rows = store.list('products').filter((p) => !p.deletedAt);
  rows = rows.filter((p) => (isAdmin && query.archived === 'true' ? p.isArchived : !p.isArchived));
  if (query.category) rows = rows.filter((p) => p.category === query.category);
  if (q) rows = rows.filter((p) => has(p.name, q) || has(p.sku, q) || has(p.brand, q) || has(p.category, q));
  if (query.stock === 'out') rows = rows.filter((p) => p.stockQty <= 0);
  if (query.stock === 'low') rows = rows.filter((p) => p.stockQty > 0 && p.stockQty <= p.lowStockLevel);
  if (query.stock === 'in') rows = rows.filter((p) => p.stockQty > p.lowStockLevel);
  return rows.sort(SORTS[query.sort] || SORTS.name);
}
on('GET', /^\/products$/, ({ query, isAdmin }) => {
  const out = page(filterProducts(query, isAdmin), query, 24);
  return { ...out, items: out.items.map((p) => productView(p, isAdmin)) };
});
on('GET', /^\/products\/ids$/, ({ query, isAdmin }) => {
  needAdmin(isAdmin);
  return { ids: filterProducts(query, true).slice(0, 5000).map((p) => p.id) };
});
on('POST', /^\/products\/bulk-delete$/, ({ body, isAdmin }) => {
  needAdmin(isAdmin);
  const ids = bulkIds(body).map((i) => resolveId('products', i));
  const t = nowIso();
  let deleted = 0;
  ids.forEach((id) => {
    const cur = store.get('products', id);
    if (cur && !cur.deletedAt) {
      store.put('products', { ...cur, deletedAt: t, updatedAt: t });
      deleted += 1;
    }
  });
  queue({ method: 'POST', path: '/products/bulk-delete', body: { ids } });
  return { ok: true, deleted };
});
on('GET', /^\/products\/categories$/, ({ isAdmin }) => {
  const counts = new Map();
  store
    .list('products')
    .filter((p) => !p.deletedAt && p.category && (isAdmin || !p.isArchived))
    .forEach((p) => counts.set(p.category, (counts.get(p.category) || 0) + 1));
  return { items: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => lc(a.name).localeCompare(lc(b.name))) };
});
on('GET', new RegExp(`^/products/${ID}$`), ({ params, isAdmin }) => {
  const p = store.get('products', resolveId('products', Number(params[0])));
  if (!p || p.deletedAt || (!isAdmin && p.isArchived)) fail(404, 'Product not found', 'NOT_FOUND');
  const images = [...(p.images || [])].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.id - b.id);
  return { product: { ...productView(p, isAdmin), images } };
});

function productFields(b, existing) {
  const name = textOrNull(b.name);
  if (!name) fail(400, 'Product name is required', 'VALIDATION', { name: 'Product name is required' });
  const unit = textOrNull(b.unit);
  if (!unit) fail(400, 'Unit is required', 'VALIDATION', { unit: 'Unit is required' });
  const mrp = numOr(b.mrp);
  const sellingPrice = numOr(b.sellingPrice);
  if (mrp !== 0 && sellingPrice > mrp) fail(400, 'Selling price cannot be more than MRP', 'VALIDATION', { sellingPrice: 'Selling price cannot be more than MRP' });
  const sku = textOrNull(b.sku);
  if (sku) {
    const dup = store.list('products').find((p) => !p.deletedAt && lc(p.sku) === lc(sku) && (!existing || p.id !== existing.id));
    if (dup) fail(409, 'Another product already uses this SKU', 'DUPLICATE', { sku: 'SKU already in use' });
  }
  return {
    name, sku, unit,
    category: textOrNull(b.category),
    brand: textOrNull(b.brand),
    mrp, sellingPrice,
    costPrice: numOr(b.costPrice),
    gstPercent: numOr(b.gstPercent, 18),
    hsn: textOrNull(b.hsn),
    stockQty: numOr(b.stockQty),
    lowStockLevel: numOr(b.lowStockLevel, 10),
    description: textOrNull(b.description),
  };
}
const needAdmin = (isAdmin) => {
  if (!isAdmin) fail(403, 'Only the owner can do this', 'FORBIDDEN');
};
on('POST', /^\/products$/, ({ body, isAdmin }) => {
  needAdmin(isAdmin);
  const f = productFields(body, null);
  const id = tempId();
  const t = nowIso();
  const product = { id, ...f, isArchived: false, deletedAt: null, images: [], createdAt: t, updatedAt: t };
  store.put('products', product);
  queue({ method: 'POST', path: '/products', body, tempId: id });
  return { product: productView(product, true) };
});
on('PUT', new RegExp(`^/products/${ID}$`), ({ params, body, isAdmin }) => {
  needAdmin(isAdmin);
  const id = resolveId('products', Number(params[0]));
  const cur = store.get('products', id);
  if (!cur || cur.deletedAt) fail(404, 'Product not found', 'NOT_FOUND');
  const product = { ...cur, ...productFields(body, cur), updatedAt: nowIso() };
  store.put('products', product);
  queue({ method: 'PUT', path: `/products/${id}`, body });
  return { product: { ...productView(product, true), images: product.images } };
});
on('PATCH', new RegExp(`^/products/${ID}/archive$`), ({ params, body, isAdmin }) => {
  needAdmin(isAdmin);
  const id = resolveId('products', Number(params[0]));
  const cur = store.get('products', id);
  if (!cur || cur.deletedAt) fail(404, 'Product not found', 'NOT_FOUND');
  const product = { ...cur, isArchived: !!body.archived, updatedAt: nowIso() };
  store.put('products', product);
  queue({ method: 'PATCH', path: `/products/${id}/archive`, body });
  return { product: { ...productView(product, true), images: product.images } };
});
on('DELETE', new RegExp(`^/products/${ID}$`), ({ params, isAdmin }) => {
  needAdmin(isAdmin);
  const id = resolveId('products', Number(params[0]));
  const cur = store.get('products', id);
  if (!cur || cur.deletedAt) fail(404, 'Product not found', 'NOT_FOUND');
  store.put('products', { ...cur, deletedAt: nowIso(), updatedAt: nowIso() });
  queue({ method: 'DELETE', path: `/products/${id}` });
  return { ok: true };
});
// photos need the internet (they are uploaded to the server) - a product that is not synced yet has nothing to attach them to
on('POST', new RegExp(`^/products/${ID}/images`), ({ params }) => {
  if (Number(params[0]) < 0) fail(409, 'Product saved on this device. Photos can be added after it syncs (needs internet).', 'NOT_SYNCED');
  return NOT_HANDLED;
});

// orders
on('GET', /^\/orders$/, ({ query, user, isAdmin }) => {
  const q = lc(query.q || '').trim();
  let rows = store.list('orders').map(orderView);
  if (!isAdmin) rows = rows.filter((o) => o.agentId === user.id);
  else if (query.agentId) rows = rows.filter((o) => o.agentId === Number(query.agentId));
  if (query.partyId) rows = rows.filter((o) => o.partyId === Number(query.partyId));
  if (query.status) rows = rows.filter((o) => o.status === query.status);
  if (q) rows = rows.filter((o) => has(o.orderNo, q) || has(o.partyName, q));
  rows.sort(byCreatedDesc);
  const out = page(rows, query, 20);
  return {
    ...out,
    items: out.items.map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.status, grandTotal: o.grandTotal, createdAt: o.createdAt, invoiceId: o.invoiceId, partyName: o.partyName, agentName: o.agentName, invoiceNo: o.invoiceNo, itemCount: (store.get('orders', o.id).items || []).length })),
  };
});
on('GET', new RegExp(`^/orders/${ID}$`), ({ params, user, isAdmin }) => {
  const o = store.get('orders', resolveId('orders', Number(params[0])));
  if (!o || (!isAdmin && o.agentId !== user.id)) fail(404, 'Order not found', 'NOT_FOUND');
  return { order: orderView(o) };
});
on('POST', /^\/orders$/, ({ body, user, isAdmin }) => {
  const partyId = resolveId('parties', Number(body.partyId));
  const party = store.get('parties', partyId);
  if (!party || party.deletedAt) fail(404, 'Party not found', 'NOT_FOUND'); // agents can order for any party
  const calc = buildLines(body.items, isAdmin);
  const n = numbers.take('ORDER');
  const orderNo = n ? `ORD-${String(n).padStart(5, '0')}` : `NEW-${String(Date.now()).slice(-6)}`;
  const id = tempId();
  const t = nowIso();
  const order = {
    id, orderNo, partyId,
    agentId: isAdmin ? party.assignedAgentId : user.id,
    createdBy: user.id, status: 'PENDING', notes: textOrNull(body.notes),
    discount: calc.discount, subtotal: calc.subtotal, taxAmount: calc.tax, grandTotal: calc.total,
    invoiceId: null, createdAt: t, updatedAt: t, items: orderItems(calc, id),
  };
  store.put('orders', order);
  const items = (body.items || []).map((i) => ({ productId: resolveId('products', Number(i.productId)), qty: Number(i.qty), ...(isAdmin && i.rate !== undefined ? { rate: Number(i.rate) } : {}), ...(isAdmin && i.discount !== undefined ? { discount: Number(i.discount) || 0 } : {}) }));
  queue({ method: 'POST', path: '/orders', tempId: id, body: { partyId, items, notes: body.notes || undefined, ...(n ? { orderNo } : {}), createdAt: t } });
  return { order: orderView(order) };
});
on('PUT', new RegExp(`^/orders/${ID}$`), ({ params, body, isAdmin }) => {
  needAdmin(isAdmin);
  const id = resolveId('orders', Number(params[0]));
  const cur = store.get('orders', id);
  if (!cur) fail(404, 'Order not found', 'NOT_FOUND');
  if (cur.invoiceId) fail(409, 'This order already has an estimate. Cancel the estimate first to change it.', 'LOCKED');
  if (cur.status === 'CANCELLED') fail(409, 'A cancelled order cannot be edited', 'LOCKED');
  const calc = buildLines(body.items, true);
  const order = { ...cur, notes: textOrNull(body.notes), discount: calc.discount, subtotal: calc.subtotal, taxAmount: calc.tax, grandTotal: calc.total, items: orderItems(calc, id), updatedAt: nowIso() };
  store.put('orders', order);
  queue({ method: 'PUT', path: `/orders/${id}`, body: { ...body, items: (body.items || []).map((i) => ({ ...i, productId: resolveId('products', Number(i.productId)) })) } });
  return { order: orderView(order) };
});
on('PATCH', new RegExp(`^/orders/${ID}/status$`), ({ params, body, user, isAdmin }) => {
  const id = resolveId('orders', Number(params[0]));
  const cur = store.get('orders', id);
  if (!cur || (!isAdmin && cur.agentId !== user.id)) fail(404, 'Order not found', 'NOT_FOUND');
  if (!isAdmin && !(body.status === 'CANCELLED' && cur.status === 'PENDING')) fail(403, 'Only the owner can change this order', 'FORBIDDEN');
  if (body.status === 'CANCELLED' && cur.invoiceId) fail(409, 'This order has an estimate. Cancel the estimate first.', 'LOCKED');
  const order = { ...cur, status: body.status, updatedAt: nowIso() };
  store.put('orders', order);
  queue({ method: 'PATCH', path: `/orders/${id}/status`, body: { status: body.status } });
  return { order: orderView(order) };
});

// estimates (the "invoices" of the app)
on('GET', /^\/invoices$/, ({ query, isAdmin }) => {
  needAdmin(isAdmin);
  const q = lc(query.q || '').trim();
  let rows = store.list('invoices').map((i) => ({ ...i, partyName: (store.get('parties', i.partyId) || {}).name || 'Party', orderNo: (store.list('orders').find((o) => o.invoiceId === i.id) || {}).orderNo || null }));
  if (query.status) rows = rows.filter((i) => i.status === query.status);
  if (q) rows = rows.filter((i) => has(i.invoiceNo, q) || has(i.partyName, q));
  rows.sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : a.invoiceDate > b.invoiceDate ? -1 : b.id - a.id));
  const out = page(rows, query, 20);
  return { ...out, items: out.items.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, grandTotal: i.grandTotal, amountPaid: i.amountPaid, status: i.status, partyName: i.partyName, orderNo: i.orderNo })) };
});
on('GET', new RegExp(`^/invoices/${ID}$`), ({ params, isAdmin }) => {
  needAdmin(isAdmin);
  const inv = store.get('invoices', resolveId('invoices', Number(params[0])));
  if (!inv) fail(404, 'Estimate not found', 'NOT_FOUND');
  return invoiceView(inv);
});
on('POST', new RegExp(`^/invoices/from-order/${ID}$`), ({ params, user, isAdmin }) => {
  needAdmin(isAdmin);
  const orderId = resolveId('orders', Number(params[0]));
  const order = store.get('orders', orderId);
  if (!order) fail(404, 'Order not found', 'NOT_FOUND');
  if (order.invoiceId) fail(409, 'This order already has an estimate', 'DUPLICATE');
  if (order.status === 'CANCELLED') fail(409, 'A cancelled order cannot get an estimate', 'LOCKED');
  if (!(order.items || []).length) fail(400, 'This order has no items', 'VALIDATION');

  const lines = order.items.map((it) => {
    const p = store.get('products', it.productId) || {};
    return { productId: it.productId, name: p.name || 'Item', hsn: p.hsn || null, unit: p.unit || null, qty: it.qty, rate: it.rate, discount: it.discount, gstPercent: it.gstPercent };
  });
  const calc = calcLines(lines);
  const grand = Math.round(calc.total);
  const roundOff = r2(grand - calc.total);
  const cgst = r2(calc.tax / 2);
  const settings = store.kvGet('settings', {});
  const n = numbers.take('INVOICE');
  const prefix = settings.invoicePrefix || 'EST';
  const invoiceNo = n ? `${prefix}-${String(n).padStart(4, '0')}` : `${prefix}-NEW${String(Date.now()).slice(-5)}`;
  const id = tempId();
  const t = nowIso();
  const inv = {
    id, invoiceNo, partyId: order.partyId, createdBy: user.id, invoiceDate: t, dueDate: null,
    subtotal: calc.subtotal, discount: calc.discount, cgst, sgst: r2(calc.tax - cgst), igst: 0, roundOff, grandTotal: grand,
    amountPaid: 0, status: 'UNPAID', notes: null, terms: settings.terms || null, createdAt: t, updatedAt: t,
    items: calc.lines.map((l, i) => ({ id: -(Date.now() * 10 + i), productId: l.productId, name: l.name, hsn: l.hsn, unit: l.unit, qty: l.qty, rate: l.rate, discount: l.discount, gstPercent: l.gstPercent, taxable: l.taxable, tax: l.tax, lineTotal: l.lineTotal })),
  };
  store.put('invoices', inv);

  const negative = [];
  calc.lines.forEach((l) => {
    const p = store.get('products', l.productId);
    if (!p) return;
    const stockQty = r2(p.stockQty - l.qty);
    store.put('products', { ...p, stockQty, updatedAt: t });
    if (stockQty < 0) negative.push(p.name);
  });
  const party = store.get('parties', order.partyId);
  if (party) store.put('parties', { ...party, currentBalance: r2(party.currentBalance + grand), updatedAt: t });
  store.put('orders', { ...order, invoiceId: id, status: order.status === 'PENDING' ? 'CONFIRMED' : order.status, updatedAt: t });
  queue({ method: 'POST', path: `/invoices/from-order/${orderId}`, tempId: id, body: { ...(n ? { number: n } : {}), createdAt: t } });
  return { id, invoiceNo, negativeStock: negative };
});
on('POST', new RegExp(`^/invoices/${ID}/cancel$`), ({ params, isAdmin }) => {
  needAdmin(isAdmin);
  const id = resolveId('invoices', Number(params[0]));
  const inv = store.get('invoices', id);
  if (!inv) fail(404, 'Estimate not found', 'NOT_FOUND');
  if (inv.status === 'CANCELLED') fail(409, 'Estimate is already cancelled', 'LOCKED');
  if (Number(inv.amountPaid) > 0) fail(409, 'Payments are recorded on this estimate, so it cannot be cancelled', 'LOCKED');
  const t = nowIso();
  (inv.items || []).forEach((it) => {
    const p = it.productId && store.get('products', it.productId);
    if (p) store.put('products', { ...p, stockQty: r2(p.stockQty + it.qty), updatedAt: t });
  });
  const party = store.get('parties', inv.partyId);
  if (party) store.put('parties', { ...party, currentBalance: r2(party.currentBalance - inv.grandTotal), updatedAt: t });
  const cancelled = { ...inv, status: 'CANCELLED', updatedAt: t };
  store.put('invoices', cancelled);
  store.list('orders').filter((o) => o.invoiceId === id).forEach((o) => store.put('orders', { ...o, invoiceId: null, status: 'PENDING', updatedAt: t }));
  queue({ method: 'POST', path: `/invoices/${id}/cancel` });
  return invoiceView(cancelled);
});

// dashboard
on('GET', /^\/dashboard$/, ({ user, isAdmin }) => {
  const prods = store.list('products').filter((p) => !p.deletedAt && !p.isArchived);
  if (!isAdmin) {
    const mine = store.list('orders').filter((o) => o.agentId === user.id);
    const t = today();
    const todays = mine.filter((o) => tzDay(o.createdAt) === t);
    return {
      role: 'AGENT',
      myParties: store.list('parties').filter((p) => !p.deletedAt && p.assignedAgentId === user.id).length,
      products: prods.length,
      ordersToday: todays.length,
      ordersPending: mine.filter((o) => o.status === 'PENDING').length,
      ordersTodayValue: r2(todays.filter((o) => o.status !== 'CANCELLED').reduce((a, o) => a + o.grandTotal, 0)),
    };
  }
  const orders = store.list('orders');
  const agents = store.list('users').filter((u) => u.role === 'AGENT' && u.isActive);
  const low = prods.filter((p) => p.stockQty <= p.lowStockLevel).sort((a, b) => a.stockQty - b.stockQty || lc(a.name).localeCompare(lc(b.name)));
  return {
    role: 'ADMIN',
    parties: store.list('parties').filter((p) => !p.deletedAt).length,
    products: prods.length,
    agents: agents.length,
    outOfStock: prods.filter((p) => p.stockQty <= 0).length,
    lowStock: prods.filter((p) => p.stockQty > 0 && p.stockQty <= p.lowStockLevel).length,
    lowStockItems: low.slice(0, 6).map((p) => ({ id: p.id, name: p.name, unit: p.unit, stockQty: p.stockQty, lowStockLevel: p.lowStockLevel })),
    ordersPending: orders.filter((o) => o.status === 'PENDING').length,
    ordersToInvoice: orders.filter((o) => o.status !== 'CANCELLED' && !o.invoiceId).length,
    recentOrders: orders.map(orderView).sort(byCreatedDesc).slice(0, 6).map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.status, grandTotal: o.grandTotal, createdAt: o.createdAt, partyName: o.partyName, agentName: o.agentName })),
    agentsOnDuty: agents.filter((a) => a.onDuty).length,
  };
});

// agents (list only - adding / editing agents needs the internet)
on('GET', /^\/agents$/, ({ isAdmin }) => {
  needAdmin(isAdmin);
  const parties = store.list('parties').filter((p) => !p.deletedAt);
  const items = store
    .list('users')
    .filter((u) => u.role === 'AGENT')
    .map((u) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, isActive: u.isActive, mustChangePassword: u.mustChangePassword, workStart: u.workStart, workEnd: u.workEnd, createdAt: u.createdAt, partyCount: parties.filter((p) => p.assignedAgentId === u.id).length }))
    .sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0) || lc(a.name).localeCompare(lc(b.name)));
  return { items };
});

// shop settings (read only here; saving needs the internet)
on('GET', /^\/settings$/, ({ isAdmin }) => {
  const s = store.kvGet('settings', null);
  if (!s) return NOT_HANDLED;
  if (isAdmin) return { settings: s };
  return { settings: { shopName: s.shopName, logoUrl: s.logoUrl, phone: s.phone, address: s.address, workStart: s.workStart, workEnd: s.workEnd } };
});

// location (agents) and the live map (owner)
on('GET', /^\/tracking\/me$/, ({ user }) => dutyInfo(user));
on('POST', /^\/tracking\/duty$/, ({ body, user }) => setDuty(!!body.on, user));
on('POST', /^\/tracking\/ping$/, ({ body, user }) => recordPing(body, user));
on('GET', /^\/tracking\/live$/, ({ isAdmin }) => {
  needAdmin(isAdmin);
  return liveSnapshot();
});

export async function handleLocal(method, path, { query = {}, body } = {}) {
  if (!store.isReady()) return NOT_HANDLED;
  const user = store.kvGet('user');
  if (!user) return NOT_HANDLED;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    return r.fn({ params: m.slice(1), query, body: body || {}, user, isAdmin: user.role === 'ADMIN' });
  }
  return NOT_HANDLED;
}
