const test = require('node:test');
const assert = require('node:assert/strict');
const { remapIds, remapPath, hasTempId, createdId, isAllowedOp } = require('../src/utils/syncRemap');

const T = -1760000000000001;
const map = new Map([[T, 42]]);

test('remapIds swaps temp ids only under id keys', () => {
  const out = remapIds({ partyId: T, items: [{ productId: T, qty: 3 }], openingBalance: T }, map);
  assert.equal(out.partyId, 42);
  assert.equal(out.items[0].productId, 42);
  assert.equal(out.items[0].qty, 3);
  assert.equal(out.openingBalance, T); // an amount that happens to be negative is never touched
});

test('bulk delete ids are remapped and replayable', () => {
  const out = remapIds({ ids: [T, 5] }, map);
  assert.deepEqual(out.ids, [42, 5]);
  assert.equal(hasTempId('/parties/bulk-delete', { ids: [T] }), true);
  assert.equal(isAllowedOp('POST', '/parties/bulk-delete'), true);
  assert.equal(isAllowedOp('POST', '/products/bulk-delete'), true);
});

test('remapPath and hasTempId', () => {
  assert.equal(remapPath(`/orders/${T}/status`, map), '/orders/42/status');
  assert.equal(remapPath('/orders/7/status', map), '/orders/7/status');
  assert.equal(hasTempId(`/orders/${T}`, {}), true);
  assert.equal(hasTempId('/orders/9', { partyId: T }), true);
  assert.equal(hasTempId('/orders/9', { partyId: 5, stockQty: -3 }), false);
});

test('createdId reads the new id from the response', () => {
  assert.equal(createdId('POST', '/orders', { order: { id: 5 } }), 5);
  assert.equal(createdId('POST', '/invoices/from-order/3', { id: 9 }), 9);
  assert.equal(createdId('PUT', '/orders/3', { order: { id: 3 } }), null);
});

test('only known changes can be replayed', () => {
  assert.equal(isAllowedOp('POST', '/orders'), true);
  assert.equal(isAllowedOp('PATCH', '/orders/-5/status'), true);
  assert.equal(isAllowedOp('POST', '/agents'), false);
  assert.equal(isAllowedOp('DELETE', '/orders/3'), false);
  assert.equal(isAllowedOp('POST', '/orders/../auth/login'), false);
});
