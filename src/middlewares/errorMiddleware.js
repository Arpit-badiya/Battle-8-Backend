const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const notFound = (req, res, next) => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
};

const errorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || (res.statusCode !== 200 ? res.statusCode : 500);

  logger.error('request_error', {
    error,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    userId: req.user?.id ? String(req.user.id) : undefined,
  });

  res.status(statusCode).json({
    message: error.isOperational ? error.message : 'Internal server error',
    details: error.details || undefined,
  });
};

module.exports = {
  AppError,
  asyncHandler,
  errorHandler,
  notFound,
};
