const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorMiddleware');

const debitCoins = async ({ userId, amount, reason, contest = null, team = null, idempotencyKey = null, metadata = {}, session = null }) => {
  const debitAmount = Number(amount || 0);

  if (debitAmount < 0) {
    throw new AppError('Invalid wallet amount', 400);
  }

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      coins: { $gte: debitAmount },
    },
    {
      $inc: { coins: -debitAmount },
    },
    {
      returnDocument: 'after',
      session,
    }
  );

  if (!user) {
    throw new AppError('Insufficient wallet balance', 400);
  }

  try {
    await Transaction.create(
      [
        {
          user: userId,
          type: 'debit',
          amount: debitAmount,
          reason,
          contest,
          team,
          balanceAfter: user.coins,
          metadata,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      ],
      { session }
    );
  } catch (error) {
    if (!session) {
      await User.updateOne({ _id: userId }, { $inc: { coins: debitAmount } });
    }

    if (error.code === 11000) {
      throw new AppError('Duplicate wallet transaction', 409);
    }

    throw error;
  }

  return user;
};

const creditCoins = async ({ userId, amount, reason, contest = null, team = null, idempotencyKey = null, metadata = {}, session = null }) => {
  const creditAmount = Number(amount || 0);

  if (creditAmount < 0) {
    throw new AppError('Invalid wallet amount', 400);
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { coins: creditAmount } },
    { returnDocument: 'after', session }
  );

  if (!user) {
    throw new AppError('User not found', 404);
  }

  try {
    await Transaction.create(
      [
        {
          user: userId,
          type: 'credit',
          amount: creditAmount,
          reason,
          contest,
          team,
          balanceAfter: user.coins,
          metadata,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      ],
      { session }
    );
  } catch (error) {
    if (!session) {
      await User.updateOne({ _id: userId, coins: { $gte: creditAmount } }, { $inc: { coins: -creditAmount } });
    }

    if (error.code === 11000) {
      throw new AppError('Duplicate wallet transaction', 409);
    }

    throw error;
  }

  return user;
};

module.exports = {
  creditCoins,
  debitCoins,
};
