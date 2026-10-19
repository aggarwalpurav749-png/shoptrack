const { HttpError } = require('../utils/http');

/**
 * validate(schema, 'body' | 'query' | 'params')
 * The cleaned data lands in req.valid[source].
 */
const validate =
  (schema, source = 'body') =>
  (req, res, next) => {
    const result = schema.safeParse(req[source] === undefined ? {} : req[source]);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      return next(new HttpError(400, result.error.issues[0].message, 'VALIDATION', { fields }));
    }
    req.valid = req.valid || {};
    req.valid[source] = result.data;
    next();
  };

module.exports = { validate };
