const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { HttpError, wrap, camel, camelAll } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { adminOnly } = require('../middleware/auth');
const { hashPassword, generateTempPassword } = require('../utils/password');
const { reqText, phoneField, hhmm, emptyToNull, passwordField } = require('../utils/fields');

router.use(...adminOnly);

const optHhmm = z.preprocess(emptyToNull, hhmm.nullable().optional());
const idParam = z.object({ id: z.coerce.number().int().positive() });

const baseShape = {
  name: reqText(100, 'Name'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(120),
  phone: phoneField,
  workStart: optHhmm,
  workEnd: optHhmm,
};
const hoursOk = (d) => !d.workStart || !d.workEnd || d.workStart < d.workEnd;
const hoursMsg = { message: 'Working hours end must be after start', path: ['workEnd'] };

const createSchema = z
  .object({
    ...baseShape,
    password: z.preprocess(emptyToNull, passwordField.nullable().optional()),
  })
  .refine(hoursOk, hoursMsg);

const updateSchema = z
  .object({
    ...baseShape,
    isActive: z.boolean().optional(),
  })
  .refine(hoursOk, hoursMsg);

const LIST_SQL = `
  SELECT u.id, u.email, u.name, u.phone, u.is_active, u.must_change_password, u.work_start, u.work_end, u.created_at,
         (SELECT count(*)::int FROM parties p WHERE p.assigned_agent_id = u.id AND p.deleted_at IS NULL) AS party_count
    FROM users u`;

router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await query(`${LIST_SQL} WHERE u.role = 'AGENT' ORDER BY u.is_active DESC, lower(u.name)`);
    res.json({ items: camelAll(rows) });
  })
);

router.post(
  '/',
  validate(createSchema),
  wrap(async (req, res) => {
    const b = req.valid.body;
    const exists = await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [b.email]);
    if (exists.rowCount) {
      throw new HttpError(409, 'An account with this email already exists', 'DUPLICATE', { fields: { email: 'Email already in use' } });
    }
    const generated = !b.password;
    const plain = b.password || generateTempPassword();
    const hash = await hashPassword(plain);
    const ins = await query(
      `INSERT INTO users (email, password_hash, name, phone, role, must_change_password, work_start, work_end)
       VALUES ($1, $2, $3, $4, 'AGENT', TRUE, $5, $6) RETURNING id`,
      [b.email, hash, b.name, b.phone, b.workStart || null, b.workEnd || null]
    );
    const { rows } = await query(`${LIST_SQL} WHERE u.id = $1`, [ins.rows[0].id]);
    // The temp password is shown to the owner exactly once - it is never stored in readable form.
    res.status(201).json({ agent: camel(rows[0]), tempPassword: plain, generated });
  })
);

router.put(
  '/:id',
  validate(idParam, 'params'),
  validate(updateSchema),
  wrap(async (req, res) => {
    const { id } = req.valid.params;
    const b = req.valid.body;
    const dup = await query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [b.email, id]);
    if (dup.rowCount) {
      throw new HttpError(409, 'Another account already uses this email', 'DUPLICATE', { fields: { email: 'Email already in use' } });
    }
    const upd = await query(
      `UPDATE users
          SET name = $1, email = $2, phone = $3, work_start = $4, work_end = $5,
              is_active = COALESCE($6, is_active),
              -- disabling an agent also signs them out immediately
              token_version = CASE WHEN $6 = FALSE AND is_active THEN token_version + 1 ELSE token_version END,
              updated_at = now()
        WHERE id = $7 AND role = 'AGENT' RETURNING id`,
      [b.name, b.email, b.phone, b.workStart || null, b.workEnd || null, b.isActive === undefined ? null : b.isActive, id]
    );
    if (!upd.rowCount) throw new HttpError(404, 'Agent not found', 'NOT_FOUND');
    const { rows } = await query(`${LIST_SQL} WHERE u.id = $1`, [id]);
    res.json({ agent: camel(rows[0]) });
  })
);

router.post(
  '/:id/reset-password',
  validate(idParam, 'params'),
  wrap(async (req, res) => {
    const { id } = req.valid.params;
    const plain = generateTempPassword();
    const hash = await hashPassword(plain);
    const upd = await query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, token_version = token_version + 1, updated_at = now()
        WHERE id = $2 AND role = 'AGENT' RETURNING id`,
      [hash, id]
    );
    if (!upd.rowCount) throw new HttpError(404, 'Agent not found', 'NOT_FOUND');
    res.json({ tempPassword: plain });
  })
);

module.exports = router;
