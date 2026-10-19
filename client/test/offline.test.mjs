// Tests the offline engine (local "server", queue, sync) in plain Node with a pretend server.
// Run:  node client/test/offline.test.mjs   (needs esbuild, which comes with vite)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  esbuild = require('/opt/npm-tools/node_modules/esbuild');
}

// the sync engine talks to the server through lib/api.js: swap it for a pretend server
const fakeApi = {
  name: 'fake-api',
  setup(b) {
    b.onResolve({ filter: /lib\/api\.js$/ }, () => ({ path: 'fake-api', namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: 'export const netRequest = (...a) => globalThis.__net(...a); export const setLocalHandler = () => {};', loader: 'js' }));
  },
};
const out = path.join(here, '.offline-bundle.mjs');
await esbuild.build({
  stdin: {
    contents: `export * from '../src/offline/local.js'; export { store } from '../src/offline/store.js'; export { numbers } from '../src/offline/numbers.js';
               export * from '../src/offline/sync.js'; export * from '../src/offline/duty.js';`,
    resolveDir: here, loader: 'js',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [fakeApi], logLevel: 'error',
});

// pretend browser
globalThis.window = { location: { protocol: 'https:' }, addEventListener() {}, Capacitor: undefined };
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

// pretend server state
const server = { orders: [], pulls: 0, pings: [], nextId: 700, blocks: 100 };
globalThis.__net = async (method, p, opts = {}) => {
  if (p === '/sync/push') {
    const results = opts.body.ops.map((op) => {
      if (op.method === 'POST' && op.path === '/orders') {
        const id = server.nextId++;
        server.orders.push({ id, ...op.body });
        return { id: op.id, tempId: op.tempId, ok: true, status: 201, realId: id };
      }
      if (op.path === '/parties' && op.body.name === 'Dup') return { id: op.id, tempId: op.tempId, ok: false, status: 409, error: 'This phone number already belongs to "X"', code: 'DUPLICATE' };
      return { id: op.id, tempId: op.tempId, ok: true, status: 200, realId: null };
    });
    return { results };
  }
  if (p === '/sync/pings') {
    server.pings.push(...opts.body.pings);
    return { saved: opts.body.pings.length };
  }
  if (p === '/sync/blocks') {
    const from = server.blocks;
    server.blocks += 30;
    return { from, to: from + 29 };
  }
  if (p === '/sync/pull') {
    server.pulls++;
    return {
      serverTime: new Date().toISOString(), timezone: 'Asia/Kolkata',
      parties: [], products: [], users: [], invoices: [], live: null, visiblePartyIds: null,
      settings: { shopName: 'Shop', workStart: '00:00', workEnd: '23:59', invoicePrefix: 'EST' },
      orders: server.orders.map((o) => ({ id: o.id, orderNo: o.orderNo, partyId: o.partyId, agentId: 5, status: 'PENDING', grandTotal: 999, createdAt: o.createdAt, updatedAt: o.createdAt, invoiceId: null, items: [] })),
    };
  }
  throw new Error('unexpected ' + method + ' ' + p);
};

const m = await import(out);
const { store, numbers, handleLocal, runSync, setDuty, recordPing, dutyInfo } = m;
await store.init();

const agent = { id: 5, role: 'AGENT', name: 'Ravi', workStart: null, workEnd: null };
store.kvSet('user', agent);
store.kvSet('timezone', 'Asia/Kolkata');
store.kvSet('settings', { shopName: 'Shop', workStart: '00:00', workEnd: '23:59', invoicePrefix: 'EST', terms: null });
store.putMany('users', [{ id: 5, role: 'AGENT', name: 'Ravi', isActive: true, onDuty: false }]);
store.putMany('parties', [{ id: 1, name: 'Shree Ram Store', phone: '9011', area: 'Civil Lines', assignedAgentId: 5, currentBalance: 100, openingBalance: 100, creditLimit: 0, deletedAt: null }]);
store.putMany('products', [
  { id: 10, name: 'Parle-G', sku: 'S1', unit: 'PKT', sellingPrice: 9, mrp: 10, costPrice: 7, gstPercent: 18, stockQty: 100, lowStockLevel: 10, isArchived: false, deletedAt: null, images: [] },
  { id: 11, name: 'Salt', sku: 'S2', unit: 'PKT', sellingPrice: 22, mrp: 25, costPrice: 18, gstPercent: 0, stockQty: 5, lowStockLevel: 10, isArchived: false, deletedAt: null, images: [] },
]);
store.put('parties', { id: 2, name: 'Unassigned Mart', phone: '9022', area: 'Itwari', assignedAgentId: null, currentBalance: 0, openingBalance: 0, creditLimit: 0, deletedAt: null });
store.markReady();
numbers.add('ORDER', 50, 60);

// ── agent, offline ──
let r = await handleLocal('GET', '/parties', { query: { q: 'ram' } });
assert.equal(r.total, 1);
r = await handleLocal('GET', '/products', { query: {} });
assert.equal(r.items.length, 2);
assert.equal(r.items[0].costPrice, undefined, 'agents must not see cost price');

let res = await handleLocal('POST', '/orders', { body: { partyId: 1, items: [{ productId: 10, qty: 10, rate: 1 }, { productId: 11, qty: 2 }], notes: 'urgent' } });
const tempOrder = res.order.id;
assert.ok(tempOrder < 0);
assert.equal(res.order.orderNo, 'ORD-00050');
assert.equal(res.order.items.length, 2);
// 10*9=90 +18% = 106.2 ; 2*22=44 +0 ; agent's own rate (1) must be ignored
assert.equal(res.order.grandTotal, 150.2);
assert.equal(store.outbox().length, 1);
assert.equal(store.outbox()[0].body.items[0].rate, undefined);

r = await handleLocal('GET', '/dashboard');
assert.equal(r.role, 'AGENT');
assert.equal(r.ordersToday, 1);
assert.equal(r.ordersPending, 1);

await assert.rejects(() => handleLocal('POST', '/orders', { body: { partyId: 99, items: [{ productId: 10, qty: 1 }] } }), /Party not found/);
await assert.rejects(() => handleLocal('PUT', '/parties/1', { body: { name: 'x' } }), /Only the owner/);

// agents see EVERY party and can order for any of them
r = await handleLocal('GET', '/parties', { query: {} });
assert.equal(r.total, 2, 'agent sees all parties');
r = await handleLocal('GET', '/parties', { query: { agentId: '5' } });
assert.equal(r.total, 1, 'my parties filter');
res = await handleLocal('POST', '/orders', { body: { partyId: 2, items: [{ productId: 10, qty: 1 }] } });
assert.equal(res.order.partyName, 'Unassigned Mart');
assert.equal(res.order.agentId, 5);
await assert.rejects(() => handleLocal('GET', '/parties/ids', { query: {} }), /Only the owner/);

// ── GPS offline ──
assert.equal(dutyInfo(agent).withinHours, true);
setDuty(true, agent);
assert.equal(recordPing({ lat: 12.9, lng: 77.5, accuracy: 8 }, agent).saved, true);
assert.equal(recordPing({ lat: 12.9, lng: 77.5 }, agent).reason, 'TOO_FAST');
assert.equal(store.pings().length, 1);

// ── back online: everything is sent ──
await runSync();
assert.equal(store.outbox().length, 0, 'queue is empty after sync');
assert.equal(store.pings().length, 0, 'pings were sent');
assert.equal(server.pings.length, 1);
assert.equal(server.orders.length, 2);
assert.equal(server.orders[0].orderNo, 'ORD-00050', 'the number printed offline is kept');
assert.equal(store.get('orders', tempOrder), undefined, 'temporary order replaced');
assert.ok(store.get('orders', 700), 'real order pulled');
assert.equal(numbers.remaining('ORDER') >= 10, true);
// a page still holding the old id keeps working
res = await handleLocal('GET', `/orders/${tempOrder}`);
assert.equal(res.order.id, 700);
store.dropOps(store.outbox().map((o) => o.id));

// ── owner side, offline ──
store.kvSet('user', { id: 1, role: 'ADMIN', name: 'Owner' });
store.putMany('users', [{ id: 1, role: 'ADMIN', name: 'Owner', isActive: true }]);
store.put('orders', { id: 800, orderNo: 'ORD-00061', partyId: 1, agentId: 5, status: 'PENDING', notes: null, discount: 0, subtotal: 126, taxAmount: 16.2, grandTotal: 142.2, invoiceId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  items: [{ id: 1, productId: 10, qty: 10, rate: 9, discount: 0, gstPercent: 18, lineTotal: 106.2 }, { id: 2, productId: 11, qty: 2, rate: 22, discount: 0, gstPercent: 0, lineTotal: 44 }] });
numbers.add('INVOICE', 20, 30);
res = await handleLocal('POST', '/invoices/from-order/800');
assert.equal(res.invoiceNo, 'EST-0020');
assert.deepEqual(res.negativeStock, ['Salt'].filter(() => false));
assert.equal(store.get('products', 10).stockQty, 90);
assert.equal(store.get('parties', 1).currentBalance, 100 + 150);
assert.equal(store.get('orders', 800).status, 'CONFIRMED');
await assert.rejects(() => handleLocal('POST', '/invoices/from-order/800'), /already has an estimate/);
const inv = await handleLocal('GET', `/invoices/${res.id}`);
assert.equal(inv.invoice.grandTotal, 150);
assert.equal(inv.invoice.orderNo, 'ORD-00061');
assert.equal(inv.items.length, 2);
assert.equal(store.outbox().at(-1).path, '/invoices/from-order/800');

res = await handleLocal('POST', `/invoices/${inv.invoice.id}/cancel`);
assert.equal(res.invoice.status, 'CANCELLED');
assert.equal(store.get('products', 10).stockQty, 100);
assert.equal(store.get('parties', 1).currentBalance, 100);
assert.equal(store.get('orders', 800).invoiceId, null);

// party / product created offline, then ordered offline: ids are patched when synced
res = await handleLocal('POST', '/parties', { body: { name: 'New Shop', phone: '9999' } });
const tp = res.party.id;
await assert.rejects(() => handleLocal('POST', '/parties', { body: { name: 'Other', phone: '9999' } }), /already belongs/);
res = await handleLocal('POST', '/orders', { body: { partyId: tp, items: [{ productId: 10, qty: 1 }] } });
assert.equal(store.outbox().at(-1).body.partyId, tp, 'queued with the temporary id; server swaps it');

// a refused change is reported and rolled back
res = await handleLocal('POST', '/parties', { body: { name: 'Dup', phone: '1234' } });
const dupTemp = res.party.id;
await runSync();
const failed = store.kvGet('failedOps', []);
assert.equal(failed.length, 1);
assert.match(failed[0].message, /already belongs/);
assert.equal(store.get('parties', dupTemp), undefined, 'refused record removed from the device');

// ── bulk delete (owner) goes through the queue ──
store.putMany('products', [{ id: 12, name: 'A', sku: 'A', unit: 'PCS', sellingPrice: 1, mrp: 0, gstPercent: 0, stockQty: 1, lowStockLevel: 1, isArchived: false, deletedAt: null, images: [] }]);
r = await handleLocal('GET', '/parties/ids', { query: {} });
assert.ok(r.ids.includes(1) && r.ids.includes(2));
r = await handleLocal('GET', '/products/ids', { query: { q: 'parle' } });
assert.deepEqual(r.ids, [10]);
const before = store.outbox().length;
res = await handleLocal('POST', '/parties/bulk-delete', { body: { ids: [1, 2] } });
assert.equal(res.deleted, 2);
assert.equal((await handleLocal('GET', '/parties', { query: {} })).total, 1, 'only the party made offline is left');
assert.equal(store.outbox().length, before + 1);
assert.deepEqual(store.outbox().at(-1).body, { ids: [1, 2] });
assert.equal(store.outbox().at(-1).path, '/parties/bulk-delete');
res = await handleLocal('POST', '/products/bulk-delete', { body: { ids: [11, 12] } });
assert.equal(res.deleted, 2);
await assert.rejects(() => handleLocal('POST', '/products/bulk-delete', { body: { ids: [] } }), /at least one/);
// deleting a party that only exists on this device uses its temporary id; the server swaps it
res = await handleLocal('POST', '/parties/bulk-delete', { body: { ids: [tp] } });
assert.equal(store.outbox().at(-1).body.ids[0], tp);

fs.rmSync(out, { force: true });
console.log('offline engine: all checks passed');
