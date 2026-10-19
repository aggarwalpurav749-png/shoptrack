// Run with:  npm test      (uses Node's built-in test runner, no extra packages)
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, parseNumber } = require('../src/utils/normalize');
const { suggestMapping, analyzeRows, summarize } = require('../src/utils/partyImport');
const { isPrivateIp } = require('../src/utils/safeFetch');
const { sniffImage } = require('../src/utils/sniff');

test('normalizePhone', () => {
  assert.equal(normalizePhone('9011223344'), '9011223344');
  assert.equal(normalizePhone('+91 90112-23344'), '9011223344');
  assert.equal(normalizePhone('09011223344'), '9011223344');
  assert.equal(normalizePhone('919011223344'), '9011223344');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('1011223344'), null); // cannot start with 0 or 1
  assert.equal(normalizePhone(''), null);
});

test('parseNumber', () => {
  assert.equal(parseNumber('1,200'), 1200);
  assert.equal(parseNumber('₹ 5,000.50'), 5000.5);
  assert.equal(parseNumber('Rs. 300'), 300);
  assert.equal(parseNumber(''), undefined);
  assert.ok(Number.isNaN(parseNumber('abc')));
});

test('suggestMapping understands common column names', () => {
  const m = suggestMapping(['Party Name', 'Mobile No.', 'Credit Limit', 'Salesman', 'Junk']);
  assert.equal(m.name, 'Party Name');
  assert.equal(m.phone, 'Mobile No.');
  assert.equal(m.creditLimit, 'Credit Limit');
  assert.equal(m.agent, 'Salesman');
  assert.equal(m.email, null);
});

const emptyExisting = () => ({ byPhone: new Map() });
const agents = { byEmail: new Map([['ravi@shop.com', 7]]), byName: new Map([['ravi kumar', 7]]) };
const mapping = { name: 'Name', phone: 'Phone', creditLimit: 'Credit', agent: 'Agent' };

test('analyzeRows: valid, invalid and in-file duplicate rows', () => {
  const rows = [
    { Name: 'A Store', Phone: '9011223344', Credit: '1,000', Agent: 'ravi@shop.com' },
    { Name: '', Phone: '9011223355', Credit: '', Agent: '' }, // no name
    { Name: 'B Store', Phone: '12345', Credit: '', Agent: '' }, // bad phone
    { Name: 'C Store', Phone: '90112 23344', Credit: '', Agent: '' }, // same phone as row 2
    { Name: 'D Store', Phone: '', Credit: 'abc', Agent: 'ghost' }, // bad credit
  ];
  const r = analyzeRows({ rows, mapping, existing: emptyExisting(), agents });
  assert.deepEqual(r.map((x) => x.status), ['ok', 'error', 'error', 'duplicate', 'error']);
  assert.equal(r[0].rowNumber, 2);
  assert.equal(r[0].data.creditLimit, 1000);
  assert.equal(r[0].data.assignedAgentId, 7);
  assert.match(r[3].message, /row 2/);
  const s = summarize(r);
  assert.equal(s.ok, 1);
  assert.equal(s.error, 3);
  assert.equal(s.duplicate, 1);
});

test('analyzeRows: unknown agent is only a warning', () => {
  const r = analyzeRows({ rows: [{ Name: 'X', Phone: '', Credit: '', Agent: 'ghost' }], mapping, existing: emptyExisting(), agents });
  assert.equal(r[0].status, 'ok');
  assert.equal(r[0].warnings.length, 1);
  assert.equal(r[0].data.assignedAgentId, null);
});

test('analyzeRows: duplicate phone against the database - skip vs update mode', () => {
  const existing = emptyExisting();
  existing.byPhone.set('9011223344', { id: 99, name: 'Old Store' });
  const rows = [
    { Name: 'New name', Phone: '9011223344', Credit: '', Agent: '' },
    { Name: 'Other', Phone: '9055667788', Credit: '', Agent: '' },
  ];
  const skip = analyzeRows({ rows, mapping, existing, agents, mode: 'skip' });
  assert.deepEqual(skip.map((x) => x.status), ['duplicate', 'ok']);
  const upd = analyzeRows({ rows, mapping, existing, agents, mode: 'update' });
  assert.deepEqual(upd.map((x) => x.status), ['update', 'ok']);
  assert.equal(upd[0].matchId, 99);
});

test('isPrivateIp blocks internal addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('sniffImage reads real file signatures', () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([0, 0])]);
  assert.equal(sniffImage(jpg), 'jpg');
  assert.equal(sniffImage(png), 'png');
  assert.equal(sniffImage(webp), 'webp');
  assert.equal(sniffImage(Buffer.from('<?php echo 1; ?> not an image')), null);
});
