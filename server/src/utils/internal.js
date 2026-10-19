// Random per-process secret: the sync route calls the app's own API and must not be slowed by the public rate limiter.
module.exports = { INTERNAL_SECRET: require('crypto').randomBytes(24).toString('hex') };
