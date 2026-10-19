const test = require('node:test');
const assert = require('node:assert');
const m = require('../src/utils/money');

test('calcLines adds GST on top of price', () => {
  const r = m.calcLines([
    { qty: 10, rate: 9, discount: 0, gstPercent: 18 }, // 90 + 16.2
    { qty: 2, rate: 22, discount: 4, gstPercent: 0 }, // 44 - 4 = 40
  ]);
  assert.equal(r.subtotal, 130);
  assert.equal(r.tax, 16.2);
  assert.equal(r.total, 146.2);
  assert.equal(r.discount, 4);
  assert.equal(r.lines[0].lineTotal, 106.2);
});

test('discount cannot exceed the line value', () => {
  const r = m.calcLines([{ qty: 1, rate: 10, discount: 50, gstPercent: 18 }]);
  assert.equal(r.total, 0);
});

test('tax split and rounding', () => {
  assert.deepEqual(m.splitTax(16.21, false), { cgst: 8.11, sgst: 8.1, igst: 0 });
  assert.deepEqual(m.splitTax(16.2, true), { cgst: 0, sgst: 0, igst: 16.2 });
  assert.deepEqual(m.roundTotal(146.2), { grand: 146, roundOff: -0.2 });
  assert.equal(m.isInterstate('27AAAAA0000A1Z5', '07AAAAA0000A1Z5'), true);
  assert.equal(m.isInterstate('27AAAAA0000A1Z5', null), false);
});
