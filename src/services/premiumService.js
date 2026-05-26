const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorMiddleware');
const { creditCoins } = require('./walletService');

const DAILY_PREMIUM_BONUS = 5;

const isPremiumActive = (premium = {}) =>
  Boolean(premium.active) && (!premium.expiresAt || new Date(premium.expiresAt).getTime() > Date.now());

const getPremiumStatus = async (userId) => {
  const user = await User.findById(userId).select('coins premium').lean();
  if (!user) throw new AppError('User not found', 404);

  return {
    active: isPremiumActive(user.premium),
    coins: user.coins || 0,
    premium: user.premium || {},
    dailyBonus: DAILY_PREMIUM_BONUS,
  };
};

const claimDailyPremiumBonus = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404);
  if (!isPremiumActive(user.premium)) throw new AppError('Premium is not active', 400);

  const last = user.premium?.lastDailyBonusAt ? new Date(user.premium.lastDailyBonusAt) : null;
  const now = new Date();
  if (last && last.toDateString() === now.toDateString()) {
    throw new AppError('Daily premium bonus already claimed', 409);
  }

  const key = `premium-daily:${userId}:${now.toISOString().slice(0, 10)}`;
  await creditCoins({
    userId,
    amount: DAILY_PREMIUM_BONUS,
    reason: 'Premium daily bonus',
    idempotencyKey: key,
    metadata: { wallet: 'main', premium: true },
  });
  await User.updateOne({ _id: userId }, { 'premium.lastDailyBonusAt': now });

  const transaction = await Transaction.findOne({ idempotencyKey: key }).lean();
  return {
    status: await getPremiumStatus(userId),
    transaction,
  };
};

const setPremiumStatus = async ({ userId, active, expiresAt = null, adminId }) => {
  const update = active
    ? {
        'premium.active': true,
        'premium.activatedAt': new Date(),
        'premium.expiresAt': expiresAt || null,
        'premium.source': 'manual',
      }
    : {
        'premium.active': false,
        'premium.expiresAt': new Date(),
        'premium.source': 'manual',
      };

  const user = await User.findByIdAndUpdate(userId, { $set: update }, { returnDocument: 'after' }).select('email name premium coins winningCoins');
  if (!user) throw new AppError('User not found', 404);

  return {
    user,
    adminId,
  };
};

module.exports = {
  DAILY_PREMIUM_BONUS,
  claimDailyPremiumBonus,
  getPremiumStatus,
  isPremiumActive,
  setPremiumStatus,
};
