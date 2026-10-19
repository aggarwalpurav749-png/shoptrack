const test = require('node:test');
const assert = require('node:assert');
const imp = require('../src/utils/productImport');

const ex = () => ({ bySku: new Map([['sku9', { id: 9, name: 'Old' }]]), byName: new Map() });

test('suggests mapping from common headers', () => {
  const m = imp.suggestMapping(['Item Name', 'Code', 'Rate', 'MRP', 'Qty', 'GST %']);
  assert.equal(m.name, 'Item Name');
  assert.equal(m.sku, 'Code');
  assert.equal(m.sellingPrice, 'Rate');
  assert.equal(m.stockQty, 'Qty');
  assert.equal(m.gstPercent, 'GST %');
});

test('validates rows, duplicates and updates', () => {
  const mapping = imp.suggestMapping(['Name', 'SKU', 'MRP', 'Selling Price', 'Stock']);
  const rows = [
    { Name: 'A', SKU: 'a1', MRP: '10', 'Selling Price': '9', Stock: '5' },
    { Name: 'B', SKU: 'A1', MRP: '10', 'Selling Price': '9', Stock: '5' }, // dup in file
    { Name: 'C', SKU: 'c1', MRP: '10', 'Selling Price': '11', Stock: '' }, // sp > mrp
    { Name: '', SKU: 'd1', MRP: '', 'Selling Price': '', Stock: '' }, // no name
    { Name: 'E', SKU: 'sku9', MRP: '5', 'Selling Price': '', Stock: 'x' }, // bad stock
    { Name: 'F', SKU: 'SKU9', MRP: '5', 'Selling Price': '', Stock: '3' },
  ];
  const r = imp.analyzeRows({ rows, mapping, existing: ex(), mode: 'skip' });
  assert.deepEqual(r.map((x) => x.status), ['ok', 'duplicate', 'error', 'error', 'error', 'duplicate']);
  const u = imp.analyzeRows({ rows, mapping, existing: ex(), mode: 'update' });
  assert.equal(u[5].status, 'update');
  assert.equal(u[5].matchId, 9);
  assert.equal(u[5].data.sellingPrice, 5); // blank selling price falls back to MRP
});
