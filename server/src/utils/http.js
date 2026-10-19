class HttpError extends Error {
  /** details (optional) is merged into the JSON error body, e.g. { fields: { email: '...' } } */
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Express 4 does not catch errors thrown inside async handlers - this does.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const camel = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v])) : row);
const camelAll = (rows) => rows.map(camel);

/** Make user text safe to put inside an ILIKE '%...%' pattern. */
const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');

module.exports = { HttpError, wrap, camel, camelAll, escapeLike };
