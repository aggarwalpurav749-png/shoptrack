// Pure logic for bulk party import (no database, no network) so it can be unit-tested.
const { normalizePhone, parseNumber } = require('./normalize');

const FIELDS = [
  { key: 'name', label: 'Party name', required: true,
    synonyms: ['name', 'partyname', 'shopname', 'retailername', 'retailer', 'party', 'customername', 'customer', 'businessname', 'firmname', 'storename', 'shop'] },
  { key: 'ownerName', label: 'Owner name',
    synonyms: ['ownername', 'owner', 'contactperson', 'contactname', 'proprietor', 'person'] },
  { key: 'phone', label: 'Phone',
    synonyms: ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'mobilenumber', 'contact', 'contactno', 'contactnumber', 'whatsapp', 'cell'] },
  { key: 'email', label: 'Email', synonyms: ['email', 'emailid', 'emailaddress', 'mail'] },
  { key: 'address', label: 'Address', synonyms: ['address', 'fulladdress', 'shopaddress', 'location'] },
  { key: 'area', label: 'Area', synonyms: ['area', 'locality', 'market', 'zone', 'route', 'city', 'town', 'beat'] },
  { key: 'creditLimit', label: 'Credit limit', synonyms: ['creditlimit', 'credit', 'limit', 'creditamount'] },
  { key: 'openingBalance', label: 'Opening balance',
    synonyms: ['openingbalance', 'opening', 'balance', 'outstanding', 'openingbal', 'dueamount', 'due'] },
  { key: 'agent', label: 'Agent (email or name)',
    synonyms: ['agentemail', 'agent', 'agentname', 'salesman', 'salesperson', 'assignedto', 'assignedagent', 'executive'] },
];

const TEMPLATE_HEADERS = ['Name', 'Owner Name', 'Phone', 'Email', 'Address', 'Area', 'Credit Limit', 'Opening Balance', 'Agent Email'];
const TEMPLATE_ROWS = [
  ['Shree Ram General Store', 'Rakesh Gupta', '9011223344', 'ram@example.com', '45 MG Road', 'Civil Lines', '50000', '5000', 'ravi@shop.com'],
  ['Jai Hanuman Kirana', 'Vijay Sharma', '9022334455', '', '12 Station Road', 'Sitabuldi', '30000', '0', ''],
];

const normalizeHeader = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** headers: string[] -> { name: 'Party Name', phone: 'Mobile', ... } (null when no match) */
function suggestMapping(headers) {
  const used = new Set();
  const mapping = {};
  for (const f of FIELDS) {
    const hit = headers.find((h) => !used.has(h) && f.synonyms.includes(normalizeHeader(h)));
    mapping[f.key] = hit || null;
    if (hit) used.add(hit);
  }
  return mapping;
}

/**
 * Check every row. Nothing is written here.
 * @param rows      array of { [header]: value }
 * @param mapping   { fieldKey: headerName | null }
 * @param existing  { byPhone: Map<phone,{id,name}> }
 * @param agents    { byEmail: Map<lower,id>, byName: Map<lower,id> }
 * @param mode      'skip' | 'update'  - what to do with rows that already exist in the database
 * @returns array of { rowNumber, status: 'ok'|'update'|'duplicate'|'error', data, matchId, errors[], warnings[], message }
 */
function analyzeRows({ rows, mapping, existing, agents, mode = 'skip' }) {
  const seenPhone = new Map();
  const results = [];

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // row 1 is the header in the sheet
    const get = (key) => {
      const col = mapping[key];
      if (!col) return '';
      const v = raw[col];
      return v === null || v === undefined ? '' : String(v).trim();
    };
    const errors = [];
    const warnings = [];
    const data = {};

    data.name = get('name');
    if (!data.name) errors.push('Party name is empty');
    else if (data.name.length > 150) errors.push('Party name is too long (max 150)');

    data.ownerName = get('ownerName') || null;
    if (data.ownerName && data.ownerName.length > 100) errors.push('Owner name is too long (max 100)');

    const phoneRaw = get('phone');
    data.phone = null;
    if (phoneRaw) {
      const p = normalizePhone(phoneRaw);
      if (!p) errors.push(`Invalid phone "${phoneRaw}" (need 10 digits)`);
      else data.phone = p;
    }

    const emailRaw = get('email').toLowerCase();
    data.email = null;
    if (emailRaw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) errors.push(`Invalid email "${emailRaw}"`);
      else data.email = emailRaw;
    }

    data.address = get('address') || null;
    data.area = get('area') || null;

    const credit = parseNumber(get('creditLimit'));
    if (Number.isNaN(credit)) errors.push(`Credit limit "${get('creditLimit')}" is not a number`);
    else if (credit !== undefined && credit < 0) errors.push('Credit limit cannot be negative');
    data.creditLimit = credit === undefined || Number.isNaN(credit) ? null : credit;

    const opening = parseNumber(get('openingBalance'));
    if (Number.isNaN(opening)) errors.push(`Opening balance "${get('openingBalance')}" is not a number`);
    data.openingBalance = opening === undefined || Number.isNaN(opening) ? null : opening;

    data.assignedAgentId = null;
    const agentRaw = get('agent');
    if (agentRaw) {
      const k = agentRaw.toLowerCase();
      const id = agents.byEmail.get(k) || agents.byName.get(k);
      if (id) data.assignedAgentId = id;
      else warnings.push(`Agent "${agentRaw}" not found - will be imported without an agent`);
    }

    // ── duplicates ──
    let status = 'ok';
    let matchId = null;
    let dupMessage = '';
    if (errors.length) {
      status = 'error';
    } else {
      const checks = [
        ['phone', data.phone, seenPhone, existing.byPhone],
      ];
      for (const [label, val, seen, ex] of checks) {
        if (!val || status !== 'ok') continue;
        if (seen.has(val)) {
          status = 'duplicate';
          dupMessage = `Same ${label} as row ${seen.get(val)} in this file`;
        } else if (ex.has(val)) {
          const hit = ex.get(val);
          if (mode === 'update') {
            status = 'update';
            matchId = hit.id;
            dupMessage = `Will update existing party "${hit.name}" (same ${label})`;
          } else {
            status = 'duplicate';
            dupMessage = `${label} already belongs to existing party "${hit.name}"`;
          }
        }
      }
      if (status === 'ok' || status === 'update') {
        if (data.phone) seenPhone.set(data.phone, rowNumber);
      }
    }

    const messages = [...errors, ...(dupMessage ? [dupMessage] : []), ...warnings];
    results.push({ rowNumber, status, data, matchId, errors, warnings, message: messages.join('; ') });
  });

  return results;
}

function summarize(results) {
  const s = { total: results.length, ok: 0, update: 0, duplicate: 0, error: 0, warnings: 0 };
  for (const r of results) {
    s[r.status] += 1;
    if (r.warnings.length) s.warnings += 1;
  }
  return s;
}

module.exports = { FIELDS, TEMPLATE_HEADERS, TEMPLATE_ROWS, normalizeHeader, suggestMapping, analyzeRows, summarize };
