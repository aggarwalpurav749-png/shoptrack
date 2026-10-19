// Pure logic for bulk product import (no database, no network) so it can be unit-tested.
const { parseNumber } = require('./normalize');

const FIELDS = [
  { key: 'name', label: 'Product name', required: true, synonyms: ['name', 'productname', 'product', 'item', 'itemname', 'description', 'particulars', 'title'] },
  { key: 'sku', label: 'SKU / code', synonyms: ['sku', 'code', 'itemcode', 'productcode', 'barcode', 'sno', 'partno'] },
  { key: 'category', label: 'Category', synonyms: ['category', 'group', 'itemgroup', 'type', 'department'] },
  { key: 'brand', label: 'Brand', synonyms: ['brand', 'company', 'manufacturer', 'make'] },
  { key: 'unit', label: 'Unit', synonyms: ['unit', 'uom', 'units', 'packing', 'pack'] },
  { key: 'mrp', label: 'MRP', synonyms: ['mrp', 'maxretailprice', 'listprice'] },
  { key: 'sellingPrice', label: 'Selling price', synonyms: ['sellingprice', 'saleprice', 'price', 'rate', 'sellrate', 'wholesaleprice', 'sp', 'salerate'] },
  { key: 'costPrice', label: 'Cost price', synonyms: ['costprice', 'cost', 'purchaseprice', 'purchaserate', 'buyprice', 'cp'] },
  { key: 'gstPercent', label: 'GST %', synonyms: ['gst', 'gstpercent', 'gstrate', 'tax', 'taxpercent', 'gst%'] },
  { key: 'hsn', label: 'HSN', synonyms: ['hsn', 'hsncode', 'hsnsac'] },
  { key: 'stockQty', label: 'Stock', synonyms: ['stock', 'stockqty', 'qty', 'quantity', 'openingstock', 'closingstock', 'available'] },
  { key: 'lowStockLevel', label: 'Low-stock level', synonyms: ['lowstock', 'lowstocklevel', 'minstock', 'reorderlevel', 'minimumstock'] },
];

const TEMPLATE_HEADERS = ['Name', 'SKU', 'Category', 'Brand', 'Unit', 'MRP', 'Selling Price', 'Cost Price', 'GST %', 'HSN', 'Stock', 'Low Stock Level'];
const TEMPLATE_ROWS = [
  ['Parle-G Biscuit 80g', 'SKU101', 'Snacks', 'Parle', 'PKT', '10', '9', '7', '18', '1905', '500', '50'],
  ['Tata Salt 1kg', 'SKU102', 'Groceries', 'Tata', 'PKT', '25', '22', '18', '0', '2501', '300', '30'],
];

const normalizeHeader = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9%]/g, '');

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
 * existing: { bySku: Map<lowerSku,{id,name}>, byName: Map<lowerName,{id,name}> }
 * mode: 'skip' | 'update'
 */
function analyzeRows({ rows, mapping, existing, mode = 'skip' }) {
  const seenSku = new Map();
  const seenName = new Map();
  const results = [];

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const get = (key) => {
      const col = mapping[key];
      if (!col) return '';
      const v = raw[col];
      return v === null || v === undefined ? '' : String(v).trim();
    };
    const errors = [];
    const warnings = [];
    const d = {};

    d.name = get('name');
    if (!d.name) errors.push('Product name is empty');
    else if (d.name.length > 150) errors.push('Product name is too long (max 150)');

    d.sku = get('sku') || null;
    if (d.sku && d.sku.length > 50) errors.push('SKU is too long (max 50)');
    d.category = get('category') || null;
    d.brand = get('brand') || null;
    d.hsn = get('hsn') || null;
    d.unit = (get('unit') || 'PCS').toUpperCase().slice(0, 20);

    const numField = (key, label, { min = 0, max = 1e9 } = {}) => {
      const raw0 = get(key);
      const n = parseNumber(raw0);
      if (n === undefined) return null; // blank
      if (Number.isNaN(n)) {
        errors.push(`${label} "${raw0}" is not a number`);
        return null;
      }
      if (n < min) errors.push(`${label} cannot be less than ${min}`);
      if (n > max) errors.push(`${label} is too large`);
      return n;
    };
    d.mrp = numField('mrp', 'MRP');
    d.sellingPrice = numField('sellingPrice', 'Selling price');
    d.costPrice = numField('costPrice', 'Cost price');
    d.gstPercent = numField('gstPercent', 'GST %', { max: 100 });
    d.stockQty = numField('stockQty', 'Stock', { min: -1e9 });
    d.lowStockLevel = numField('lowStockLevel', 'Low-stock level');

    if (!errors.length) {
      if (d.sellingPrice === null && d.mrp !== null) {
        d.sellingPrice = d.mrp;
        warnings.push('Selling price was blank - using MRP');
      }
      if (d.mrp !== null && d.mrp > 0 && d.sellingPrice !== null && d.sellingPrice > d.mrp) {
        errors.push('Selling price is more than MRP');
      }
    }

    let status = 'ok';
    let matchId = null;
    let dupMessage = '';
    if (errors.length) {
      status = 'error';
    } else {
      const skuKey = d.sku ? d.sku.toLowerCase() : null;
      const nameKey = d.name.toLowerCase();
      if (skuKey && seenSku.has(skuKey)) {
        status = 'duplicate';
        dupMessage = `Same SKU as row ${seenSku.get(skuKey)} in this file`;
      } else if (!skuKey && seenName.has(nameKey)) {
        status = 'duplicate';
        dupMessage = `Same name as row ${seenName.get(nameKey)} in this file`;
      } else {
        const hit = skuKey ? existing.bySku.get(skuKey) : existing.byName.get(nameKey);
        if (hit) {
          if (mode === 'update') {
            status = 'update';
            matchId = hit.id;
            dupMessage = `Will update existing product "${hit.name}"`;
          } else {
            status = 'duplicate';
            dupMessage = `Already exists as "${hit.name}"`;
          }
        }
      }
      if (status === 'ok' || status === 'update') {
        if (skuKey) seenSku.set(skuKey, rowNumber);
        else seenName.set(nameKey, rowNumber);
      }
    }
    const messages = [...errors, ...(dupMessage ? [dupMessage] : []), ...warnings];
    results.push({ rowNumber, status, data: d, matchId, errors, warnings, message: messages.join('; ') });
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

module.exports = { FIELDS, TEMPLATE_HEADERS, TEMPLATE_ROWS, suggestMapping, analyzeRows, summarize };
