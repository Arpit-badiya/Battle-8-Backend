const mongoose = require('mongoose');
const logger = require('./logger');

const MAX_TRANSACTION_RETRIES = Number(process.env.TRANSACTION_RETRIES || 3);

const isTransientTransactionError = (error) =>
  error?.hasErrorLabel?.('TransientTransactionError') ||
  error?.hasErrorLabel?.('UnknownTransactionCommitResult');

const isUnsupportedTransactionError = (error) => {
  const message = String(error?.message || '').toLowerCase();

  return (
    message.includes('transaction numbers are only allowed') ||
    message.includes('replica set member') ||
    message.includes('not supported') ||
    error?.code === 20 ||
    error?.code === 251
  );
};

const withMongoTransaction = async (work, { fallback, name = 'transaction' } = {}) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      let result;

      await session.withTransaction(
        async () => {
          result = await work(session);
        },
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        }
      );

      return result;
    } catch (error) {
      lastError = error;

      logger.warn('mongo_transaction_failed', {
        name,
        attempt,
        transient: isTransientTransactionError(error),
        unsupported: isUnsupportedTransactionError(error),
        error,
      });

      if (isUnsupportedTransactionError(error) && fallback) {
        logger.warn('mongo_transaction_fallback_used', { name });
        return fallback();
      }

      if (!isTransientTransactionError(error) || attempt === MAX_TRANSACTION_RETRIES) {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }

  throw lastError;
};

module.exports = {
  isTransientTransactionError,
  isUnsupportedTransactionError,
  withMongoTransaction,
};
