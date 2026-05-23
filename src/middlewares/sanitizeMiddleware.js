const sanitizeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((clean, key) => {
      if (key.startsWith('$') || key.includes('.')) {
        return clean;
      }

      clean[key] = sanitizeValue(value[key]);
      return clean;
    }, {});
  }

  return typeof value === 'string' ? value.trim() : value;
};

const sanitizeRequest = (req, res, next) => {
  req.body = sanitizeValue(req.body || {});
  req.params = sanitizeValue(req.params || {});
  req.query = sanitizeValue(req.query || {});
  next();
};

module.exports = sanitizeRequest;
