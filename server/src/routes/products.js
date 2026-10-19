const router = require('express').Router();
const multer = require('multer');
const { z } = require('zod');
const { query, tx } = require('../db');
const { HttpError, wrap, camel, camelAll, escapeLike } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { protect, adminOnly } = require('../middleware/auth');
const { reqText, optText, num } = require('../utils/fields');
const { saveImage, deleteImage } = require('../utils/storage');
const { downloadImage } = require('../utils/safeFetch');
const Papa = require('papaparse');
const imp = require('../utils/productImport');
const { parseSheet, MAX_IMPORT_ROWS } = require('../utils/sheet');

const MAX_IMAGES = 8;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const idParam = z.object({ id: z.coerce.number().int().positive() });
const imageParam = z.object({ id: z.coerce.number().int().positive(), imageId: z.coerce.number().int().positive() });

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  stock: z.enum(['in', 'low', 'out']).optional(),
  sort: z.enum(['name', 'price_asc', 'price_desc', 'stock_low', 'newest']).default('name'),
  archived: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

const productSchema = z
  .object({
    name: reqText(150, 'Product name'),
    sku: optText(50, 'SKU'),
    category: optText(60, 'Category'),
    brand: optText(60, 'Brand'),
    unit: reqText(20, 'Unit'),
    mrp: num('MRP'),
    sellingPrice: num('Selling price'),
    costPrice: num('Cost price'),
    gstPercent: num('GST %', { max: 100, def: 18 }),
    hsn: optText(20, 'HSN'),
    stockQty: num('Stock', { min: -1e9, def: 0 }),
    lowStockLevel: num('Low-stock level', { def: 10 }),
    description: optText(1000, 'Description'),
  })
  .refine((d) => d.mrp === 0 || d.sellingPrice <= d.mrp, {
    message: 'Selling price cannot be more than MRP',
    path: ['sellingPrice'],
  });

// ─── SQL pieces ──────────────────────────────────────────────────────
const SORTS = {
  name: 'lower(p.name) ASC, p.id',
  price_asc: 'p.selling_price ASC, lower(p.name)',
  price_desc: 'p.selling_price DESC, lower(p.name)',
  stock_low: 'p.stock_qty ASC, lower(p.name)',
  newest: 'p.id DESC',
};

// cost_price is only selected for admins - agents can never receive it.
const columns = (isAdmin) => `
  p.id, p.name, p.sku, p.category, p.brand, p.unit, p.mrp, p.selling_price, p.gst_percent, p.hsn,
  p.stock_qty, p.low_stock_level, p.description, p.is_archived, p.created_at, p.updated_at
  ${isAdmin ? ', p.cost_price' : ''},
  CASE WHEN p.stock_qty <= 0 THEN 'out' WHEN p.stock_qty <= p.low_stock_level THEN 'low' ELSE 'in' END AS stock_status,
  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.id ASC LIMIT 1) AS image_url`;

async function getProduct(id, isAdmin) {
  const where = isAdmin ? 'p.deleted_at IS NULL' : 'p.deleted_at IS NULL AND p.is_archived = FALSE';
  const { rows } = await query(`SELECT ${columns(isAdmin)} FROM products p WHERE p.id = $1 AND ${where}`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Product not found', 'NOT_FOUND');
  const imgs = await query(
    'SELECT id, url, is_primary, storage, created_at FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, id ASC',
    [id]
  );
  return { ...camel(rows[0]), images: camelAll(imgs.rows) };
}

async function assertSkuFree(sku, excludeId) {
  if (!sku) return;
  const params = [sku];
  let sql = 'SELECT 1 FROM products WHERE lower(sku) = lower($1) AND deleted_at IS NULL';
  if (excludeId) {
    params.push(excludeId);
    sql += ' AND id <> $2';
  }
  if ((await query(sql, params)).rowCount) {
    throw new HttpError(409, 'Another product already uses this SKU', 'DUPLICATE', { fields: { sku: 'SKU already in use' } });
  }
}

async function assertProductExists(id) {
  if (!(await query('SELECT 1 FROM products WHERE id = $1 AND deleted_at IS NULL', [id])).rowCount) {
    throw new HttpError(404, 'Product not found', 'NOT_FOUND');
  }
}

// ─── list + categories ───────────────────────────────────────────────
router.get(
  '/',
  ...protect,
  validate(listSchema, 'query'),
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const { q, category, stock, sort, archived, page, limit } = req.valid.query;
    const where = ['p.deleted_at IS NULL'];
    const params = [];

    // agents never see archived items; admin can flip the toggle
    where.push(isAdmin && archived === 'true' ? 'p.is_archived = TRUE' : 'p.is_archived = FALSE');
    if (category) {
      params.push(category);
      where.push(`p.category = $${params.length}`);
    }
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      const n = '$' + params.length;
      where.push(`(p.name ILIKE ${n} OR p.sku ILIKE ${n} OR p.brand ILIKE ${n} OR p.category ILIKE ${n})`);
    }
    if (stock === 'out') where.push('p.stock_qty <= 0');
    if (stock === 'low') where.push('p.stock_qty > 0 AND p.stock_qty <= p.low_stock_level');
    if (stock === 'in') where.push('p.stock_qty > p.low_stock_level');
    const w = where.join(' AND ');

    const total = (await query(`SELECT count(*)::int AS n FROM products p WHERE ${w}`, params)).rows[0].n;
    const { rows } = await query(
      `SELECT ${columns(isAdmin)} FROM products p WHERE ${w} ORDER BY ${SORTS[sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    res.json({ items: camelAll(rows), total, page, limit });
  })
);

// ids of EVERYTHING matching the current filters (for "select all N products"), owner only
router.get(
  '/ids',
  ...adminOnly,
  validate(listSchema, 'query'),
  wrap(async (req, res) => {
    const { q, category, stock, archived } = req.valid.query;
    const where = ['p.deleted_at IS NULL', archived === 'true' ? 'p.is_archived = TRUE' : 'p.is_archived = FALSE'];
    const params = [];
    if (category) {
      params.push(category);
      where.push(`p.category = $${params.length}`);
    }
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      const n = '$' + params.length;
      where.push(`(p.name ILIKE ${n} OR p.sku ILIKE ${n} OR p.brand ILIKE ${n} OR p.category ILIKE ${n})`);
    }
    if (stock === 'out') where.push('p.stock_qty <= 0');
    if (stock === 'low') where.push('p.stock_qty > 0 AND p.stock_qty <= p.low_stock_level');
    if (stock === 'in') where.push('p.stock_qty > p.low_stock_level');
    const { rows } = await query(`SELECT p.id FROM products p WHERE ${where.join(' AND ')} ORDER BY p.id LIMIT 5000`, params);
    res.json({ ids: rows.map((r) => r.id) });
  })
);

// delete many at once (soft delete, same as single delete)
router.post(
  '/bulk-delete',
  ...adminOnly,
  validate(z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(5000) })),
  wrap(async (req, res) => {
    const upd = await query('UPDATE products SET deleted_at = now(), updated_at = now() WHERE id = ANY($1::int[]) AND deleted_at IS NULL RETURNING id', [req.valid.body.ids]);
    res.json({ ok: true, deleted: upd.rowCount });
  })
);

router.get(
  '/categories',
  ...protect,
  wrap(async (req, res) => {
    const archivedClause = req.user.role === 'ADMIN' ? '' : 'AND is_archived = FALSE';
    const { rows } = await query(
      `SELECT category AS name, count(*)::int AS count FROM products
        WHERE deleted_at IS NULL AND category IS NOT NULL AND category <> '' ${archivedClause}
        GROUP BY category ORDER BY lower(category)`
    );
    res.json({ items: rows });
  })
);


// ─── bulk import (CSV / Excel) ───────────────────────────────────────
router.get('/import/template', ...adminOnly, (req, res) => {
  const csv = Papa.unparse({ fields: imp.TEMPLATE_HEADERS, data: imp.TEMPLATE_ROWS });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="products-import-template.csv"');
  res.send('﻿' + csv);
});

router.post(
  '/import/preview',
  ...adminOnly,
  sheetUpload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Please choose a file first', 'NO_FILE');
    const { headers, rows } = parseSheet(req.file);
    res.json({
      fileName: req.file.originalname,
      headers,
      rows,
      totalRows: rows.length,
      suggestedMapping: imp.suggestMapping(headers),
      fields: imp.FIELDS.map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
    });
  })
);

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.any())).min(1, 'No rows to import').max(MAX_IMPORT_ROWS),
  mapping: z.record(z.string(), z.string().nullable()),
  mode: z.enum(['skip', 'update']).default('skip'),
});

async function runAnalysis(body) {
  if (!body.mapping.name) throw new HttpError(400, 'Please choose which column holds the Product name', 'VALIDATION');
  const { rows: prods } = await query('SELECT id, name, sku FROM products WHERE deleted_at IS NULL');
  const existing = { bySku: new Map(), byName: new Map() };
  for (const p of prods) {
    if (p.sku) existing.bySku.set(p.sku.toLowerCase(), p);
    else existing.byName.set(p.name.toLowerCase(), p);
  }
  return imp.analyzeRows({ rows: body.rows, mapping: body.mapping, existing, mode: body.mode });
}

const brief = (r) => ({ row: r.rowNumber, status: r.status, name: r.data.name || '', message: r.message });

router.post(
  '/import/validate',
  ...adminOnly,
  validate(importSchema),
  wrap(async (req, res) => {
    const results = await runAnalysis(req.valid.body);
    res.json({ summary: imp.summarize(results), rows: results.map(brief) });
  })
);

const PCOLS = ['name', 'sku', 'category', 'brand', 'unit', 'mrp', 'selling_price', 'cost_price', 'gst_percent', 'hsn', 'stock_qty', 'low_stock_level'];

router.post(
  '/import/commit',
  ...adminOnly,
  validate(importSchema),
  wrap(async (req, res) => {
    const results = await runAnalysis(req.valid.body); // re-check at the moment of saving
    const toInsert = results.filter((r) => r.status === 'ok');
    const toUpdate = results.filter((r) => r.status === 'update');

    await tx(async (client) => {
      for (let i = 0; i < toInsert.length; i += 200) {
        const chunk = toInsert.slice(i, i + 200);
        const params = [];
        const tuples = chunk.map((r) => {
          const d = r.data;
          params.push(d.name, d.sku, d.category, d.brand, d.unit, d.mrp || 0, d.sellingPrice || 0, d.costPrice || 0, d.gstPercent === null ? 18 : d.gstPercent, d.hsn, d.stockQty || 0, d.lowStockLevel === null ? 10 : d.lowStockLevel);
          const base = params.length - PCOLS.length;
          return '(' + PCOLS.map((_, k) => '$' + (base + k + 1)).join(',') + ')';
        });
        await client.query(`INSERT INTO products (${PCOLS.join(',')}) VALUES ${tuples.join(',')}`, params);
      }
      // existing products: only overwrite what the file actually filled in
      for (const r of toUpdate) {
        const d = r.data;
        await client.query(
          `UPDATE products SET
             name = $1, category = COALESCE($2, category), brand = COALESCE($3, brand), unit = COALESCE($4, unit),
             mrp = COALESCE($5, mrp), selling_price = COALESCE($6, selling_price), cost_price = COALESCE($7, cost_price),
             gst_percent = COALESCE($8, gst_percent), hsn = COALESCE($9, hsn),
             stock_qty = COALESCE($10, stock_qty), low_stock_level = COALESCE($11, low_stock_level), updated_at = now()
           WHERE id = $12`,
          [d.name, d.category, d.brand, d.unit, d.mrp, d.sellingPrice, d.costPrice, d.gstPercent, d.hsn, d.stockQty, d.lowStockLevel, r.matchId]
        );
      }
    });

    const summary = imp.summarize(results);
    res.json({
      inserted: toInsert.length,
      updated: toUpdate.length,
      skippedDuplicates: summary.duplicate,
      failed: summary.error,
      issues: results.filter((r) => r.status === 'error' || r.status === 'duplicate' || r.warnings.length).map(brief),
    });
  })
);

router.get(
  '/:id',
  ...protect,
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    res.json({ product: await getProduct(req.valid.params.id, req.user.role === 'ADMIN') });
  })
);

// ─── create / update / archive / delete (admin) ──────────────────────
router.post(
  '/',
  ...adminOnly,
  validate(productSchema),
  wrap(async (req, res) => {
    const b = req.valid.body;
    await assertSkuFree(b.sku);
    const { rows } = await query(
      `INSERT INTO products (name, sku, category, brand, unit, mrp, selling_price, cost_price, gst_percent, hsn, stock_qty, low_stock_level, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [b.name, b.sku, b.category, b.brand, b.unit, b.mrp, b.sellingPrice, b.costPrice, b.gstPercent, b.hsn, b.stockQty, b.lowStockLevel, b.description]
    );
    res.status(201).json({ product: await getProduct(rows[0].id, true) });
  })
);

router.put(
  '/:id',
  ...adminOnly,
  validate(idParam, 'params'),
  validate(productSchema),
  wrap(async (req, res) => {
    const { id } = req.valid.params;
    const b = req.valid.body;
    await assertSkuFree(b.sku, id);

    await tx(async (client) => {
      const cur = (await client.query('SELECT mrp, selling_price, cost_price FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
      if (!cur) throw new HttpError(404, 'Product not found', 'NOT_FOUND');

      await client.query(
        `UPDATE products SET name=$1, sku=$2, category=$3, brand=$4, unit=$5, mrp=$6, selling_price=$7, cost_price=$8,
                gst_percent=$9, hsn=$10, stock_qty=$11, low_stock_level=$12, description=$13, updated_at=now()
          WHERE id=$14`,
        [b.name, b.sku, b.category, b.brand, b.unit, b.mrp, b.sellingPrice, b.costPrice, b.gstPercent, b.hsn, b.stockQty, b.lowStockLevel, b.description, id]
      );

      // price-change log
      const changes = [
        ['mrp', cur.mrp, b.mrp],
        ['selling_price', cur.selling_price, b.sellingPrice],
        ['cost_price', cur.cost_price, b.costPrice],
      ];
      for (const [field, oldV, newV] of changes) {
        if (Math.abs(Number(oldV) - Number(newV)) > 0.0001) {
          await client.query(
            'INSERT INTO price_history (product_id, field, old_value, new_value, changed_by, changed_by_name) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, field, oldV, newV, req.user.id, req.user.name]
          );
        }
      }
    });
    res.json({ product: await getProduct(id, true) });
  })
);

router.patch(
  '/:id/archive',
  ...adminOnly,
  validate(idParam, 'params'),
  validate(z.object({ archived: z.boolean() })),
  wrap(async (req, res) => {
    const upd = await query('UPDATE products SET is_archived = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING id', [
      req.valid.body.archived,
      req.valid.params.id,
    ]);
    if (!upd.rowCount) throw new HttpError(404, 'Product not found', 'NOT_FOUND');
    res.json({ product: await getProduct(req.valid.params.id, true) });
  })
);

router.delete(
  '/:id',
  ...adminOnly,
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    // soft delete keeps old orders/invoices intact; the SKU becomes free again
    const upd = await query('UPDATE products SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [
      req.valid.params.id,
    ]);
    if (!upd.rowCount) throw new HttpError(404, 'Product not found', 'NOT_FOUND');
    res.json({ ok: true });
  })
);

router.get(
  '/:id/price-history',
  ...adminOnly,
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT id, field, old_value, new_value, changed_by_name, changed_at FROM price_history WHERE product_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 100',
      [req.valid.params.id]
    );
    res.json({ items: camelAll(rows) });
  })
);

// ─── images ──────────────────────────────────────────────────────────
async function attachImage(productId, buffer) {
  await assertProductExists(productId);
  const count = (await query('SELECT count(*)::int AS n FROM product_images WHERE product_id = $1', [productId])).rows[0].n;
  if (count >= MAX_IMAGES) throw new HttpError(400, `A product can have at most ${MAX_IMAGES} photos`, 'LIMIT');
  const saved = await saveImage(buffer, 'products');
  try {
    // the first photo automatically becomes the main one
    const { rows } = await query(
      `INSERT INTO product_images (product_id, url, public_id, storage, is_primary)
       VALUES ($1, $2, $3, $4, NOT EXISTS (SELECT 1 FROM product_images WHERE product_id = $1))
       RETURNING id, url, is_primary, storage, created_at`,
      [productId, saved.url, saved.publicId, saved.storage]
    );
    return camel(rows[0]);
  } catch (e) {
    await deleteImage(saved); // do not leave an orphan file behind
    throw e;
  }
}

router.post(
  '/:id/images',
  ...adminOnly,
  validate(idParam, 'params'),
  upload.single('image'),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Please choose a photo', 'NO_FILE');
    res.status(201).json({ image: await attachImage(req.valid.params.id, req.file.buffer) });
  })
);

router.post(
  '/:id/images/from-url',
  ...adminOnly,
  validate(idParam, 'params'),
  validate(z.object({ url: z.string({ required_error: 'Paste an image link' }).trim().url('That is not a valid link').max(2000) })),
  wrap(async (req, res) => {
    await assertProductExists(req.valid.params.id);
    const buffer = await downloadImage(req.valid.body.url);
    res.status(201).json({ image: await attachImage(req.valid.params.id, buffer) });
  })
);

router.put(
  '/:id/images/:imageId/primary',
  ...adminOnly,
  validate(imageParam, 'params'),
  wrap(async (req, res) => {
    const { id, imageId } = req.valid.params;
    await tx(async (client) => {
      const hit = await client.query('SELECT 1 FROM product_images WHERE id = $1 AND product_id = $2', [imageId, id]);
      if (!hit.rowCount) throw new HttpError(404, 'Photo not found', 'NOT_FOUND');
      await client.query('UPDATE product_images SET is_primary = FALSE WHERE product_id = $1', [id]);
      await client.query('UPDATE product_images SET is_primary = TRUE WHERE id = $1', [imageId]);
    });
    res.json({ product: await getProduct(id, true) });
  })
);

router.delete(
  '/:id/images/:imageId',
  ...adminOnly,
  validate(imageParam, 'params'),
  wrap(async (req, res) => {
    const { id, imageId } = req.valid.params;
    const del = await query('DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING public_id, storage, is_primary', [imageId, id]);
    if (!del.rowCount) throw new HttpError(404, 'Photo not found', 'NOT_FOUND');
    if (del.rows[0].is_primary) {
      await query(
        `UPDATE product_images SET is_primary = TRUE
          WHERE id = (SELECT id FROM product_images WHERE product_id = $1 ORDER BY id LIMIT 1)`,
        [id]
      );
    }
    await deleteImage({ publicId: del.rows[0].public_id, storage: del.rows[0].storage });
    res.json({ product: await getProduct(id, true) });
  })
);

module.exports = router;
