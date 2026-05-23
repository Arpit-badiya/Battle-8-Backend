const cache = require('../services/cacheService');

const buckets = new Map();

const rateLimit = ({ windowMs = 15 * 60 * 1000, max = 100 } = {}) => (req, res, next) => {
  const now = Date.now();
  const key = `${req.ip}:${req.originalUrl.split('?')[0]}`;
  const redisKey = `rate:${key}`;
  const ttlSeconds = Math.ceil(windowMs / 1000);

  cache.incrWithTtl(redisKey, ttlSeconds).then((count) => {
    if (count && count > max) {
      return res.status(429).json({
        message: 'Too many requests. Please try again later.',
      });
    }

    if (count) {
      return next();
    }

    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > max) {
      return res.status(429).json({
        message: 'Too many requests. Please try again later.',
      });
    }

    return next();
  }).catch(next);
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, 60 * 1000).unref();

const authRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
});
const apiRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });

module.exports = {
  apiRateLimit,
  authRateLimit,
  rateLimit,
};
