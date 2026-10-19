const { HttpError } = require('../utils/http');

function notFound(req, res, next) {
  next(new HttpError(404, 'Not found', 'NOT_FOUND'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details || {}) });
  }
  // multer upload errors
  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 8 MB)' : 'Upload failed: ' + err.message;
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg, code: 'UPLOAD' });
  }
  // malformed JSON body
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request', code: 'BAD_JSON' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large', code: 'TOO_LARGE' });
  }
  // postgres: unique violation / foreign key
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'That value already exists (duplicate)', code: 'DUPLICATE' });
  }
  if (err && err.code === '23503') {
    return res.status(409).json({ error: 'This record is linked to other data and cannot be changed that way', code: 'LINKED' });
  }

  // errors raised by Express itself (e.g. a missing /uploads file -> 404)
  const status = err && (err.status || err.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: status === 404 ? 'Not found' : 'Bad request', code: 'HTTP_' + status });
  }

  console.error('[error]', req.method, req.originalUrl, '-', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.', code: 'SERVER' });
}

module.exports = { notFound, errorHandler };
