const Papa = require('papaparse');
const XLSX = require('xlsx');
const { HttpError } = require('./http');

const MAX_IMPORT_ROWS = 5000;

/** Excel / CSV buffer -> { headers, rows } */
function parseSheet(file) {
  const name = (file.originalname || '').toLowerCase();
  let grid;
  try {
    if (name.endsWith('.csv') || name.endsWith('.txt') || file.mimetype === 'text/csv') {
      const text = file.buffer.toString('utf8').replace(/^﻿/, '');
      const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
      grid = parsed.data;
    } else if (/\.(xlsx|xls|xlsm)$/.test(name)) {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    } else {
      throw new HttpError(400, 'Please upload a .csv or .xlsx file', 'BAD_FILE');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Could not read this file. Is it a valid CSV / Excel file?', 'BAD_FILE');
  }

  grid = (grid || []).filter((r) => Array.isArray(r) && r.some((c) => String(c == null ? '' : c).trim() !== ''));
  if (grid.length < 2) throw new HttpError(400, 'The file needs a header row and at least one data row', 'BAD_FILE');

  // unique, non-empty header names
  const seen = new Map();
  const headers = grid[0].map((h, i) => {
    let base = String(h == null ? '' : h).trim() || `Column ${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = grid.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = r[i] == null ? '' : String(r[i]).trim();
    });
    return o;
  });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new HttpError(400, `Too many rows (${rows.length}). Please split the file into parts of ${MAX_IMPORT_ROWS} rows or fewer.`, 'TOO_MANY_ROWS');
  }
  return { headers, rows };
}

module.exports = { parseSheet, MAX_IMPORT_ROWS };
