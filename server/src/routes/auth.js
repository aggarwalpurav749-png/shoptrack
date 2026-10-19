const router = require('express').Router();
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { HttpError, wrap } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { authenticate, signToken, publicUser } = require('../middleware/auth');
const { hashPassword, checkPassword, DUMMY_HASH } = require('../utils/password');
const { passwordField } = require('../utils/fields');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.', code: 'RATE_LIMIT' },
});

const loginSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).trim().toLowerCase().min(1, 'Email is required'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(200),
});

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  wrap(async (req, res) => {
    const { email, password } = req.valid.body;
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    const user = rows[0];
    const ok = await checkPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Wrong email or password', 'BAD_LOGIN');
    if (!user.is_active) throw new HttpError(403, 'This account is disabled. Please contact the owner.', 'DISABLED');
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

// Works even while a password change is still required (so the user can actually change it).
router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

const changeSchema = z.object({
  currentPassword: z.string({ required_error: 'Current password is required' }).min(1, 'Current password is required'),
  newPassword: passwordField,
});

router.post(
  '/change-password',
  authenticate,
  validate(changeSchema),
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await checkPassword(currentPassword, rows[0].password_hash))) {
      throw new HttpError(400, 'Current password is wrong', 'VALIDATION', { fields: { currentPassword: 'Current password is wrong' } });
    }
    if (currentPassword === newPassword) {
      throw new HttpError(400, 'New password must be different from the current one', 'VALIDATION', {
        fields: { newPassword: 'New password must be different' },
      });
    }
    const hash = await hashPassword(newPassword);
    // token_version + 1 signs out every other device; we hand back a fresh token for this one.
    const upd = await query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE, token_version = token_version + 1, updated_at = now()
        WHERE id = $2 RETURNING *`,
      [hash, req.user.id]
    );
    const user = upd.rows[0];
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

module.exports = router;
