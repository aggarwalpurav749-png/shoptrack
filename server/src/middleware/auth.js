const jwt = require('jsonwebtoken');
const cfg = require('../config');
const { query } = require('../db');
const { HttpError, wrap } = require('../utils/http');

function signToken(user) {
  // token_version lets us end every session of a user (password reset / account disabled)
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, cfg.jwtSecret, { expiresIn: cfg.jwtExpiresIn });
}

/** The user object the browser is allowed to see (never the password hash). */
function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    mustChangePassword: u.must_change_password,
    workStart: u.work_start,
    workEnd: u.work_end,
  };
}

/** Checks the Bearer token and loads req.user (raw DB row, without password hash). */
const authenticate = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Please log in first', 'NO_TOKEN');

  let payload;
  try {
    payload = jwt.verify(token, cfg.jwtSecret);
  } catch (e) {
    const expired = e.name === 'TokenExpiredError';
    throw new HttpError(401, expired ? 'Your session expired. Please log in again.' : 'Invalid login. Please log in again.', expired ? 'TOKEN_EXPIRED' : 'BAD_TOKEN');
  }

  const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  const row = rows[0];
  if (!row) throw new HttpError(401, 'Account not found. Please log in again.', 'BAD_TOKEN');
  if (!row.is_active) throw new HttpError(401, 'This account is disabled. Please contact the owner.', 'DISABLED');
  if (row.token_version !== payload.tv) throw new HttpError(401, 'Your session ended. Please log in again.', 'SESSION_ENDED');

  const { password_hash, ...user } = row; // eslint-disable-line no-unused-vars
  req.user = user;
  next();
});

// Everything except /me and /change-password is blocked until the first-login password change is done.
const requirePasswordChanged = (req, res, next) => {
  if (req.user.must_change_password) {
    return next(new HttpError(403, 'Please change your password first', 'MUST_CHANGE_PASSWORD'));
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') return next(new HttpError(403, 'Only the owner can do this', 'FORBIDDEN'));
  next();
};

// Spread into a route:  router.get('/', ...protect, handler)   /   router.use(...adminOnly)
const protect = [authenticate, requirePasswordChanged];
const adminOnly = [authenticate, requirePasswordChanged, requireAdmin];

module.exports = { authenticate, protect, adminOnly, signToken, publicUser };
