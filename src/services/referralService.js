const crypto = require('crypto');

const Referral = require('../models/Referral');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorMiddleware');
const { creditCoins } = require('./walletService');

const INVITER_REWARD = Number(process.env.REFERRAL_INVITER_REWARD || 20);
const REFERRED_REWARD = Number(process.env.REFERRAL_REFERRED_REWARD || 10);

const normalizeCode = (code = '') => String(code).trim().toUpperCase();

const buildReferralCode = (user) => {
  const emailPrefix = String(user.email || 'PLAYER').split('@')[0].replace(/[^a-z0-9]/gi, '').toUpperCase();
  const readable = emailPrefix.slice(0, 6) || 'PLAYER';
  return `${readable}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
};

const ensureReferralCode = async (userOrId, session = null) => {
  const user = typeof userOrId === 'object' && userOrId?._id
    ? userOrId
    : await User.findById(userOrId).session(session);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.referralCode) {
    return user.referralCode;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    user.referralCode = buildReferralCode(user);
    try {
      await user.save({ session });
      return user.referralCode;
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
      user.referralCode = undefined;
    }
  }

  throw new AppError('Unable to generate referral code', 500);
};

const applyReferralCode = async ({ userId, code, session = null }) => {
  const normalizedCode = normalizeCode(code);

  if (!normalizedCode) {
    throw new AppError('Referral code is required', 400);
  }

  const [user, inviter] = await Promise.all([
    User.findById(userId).session(session),
    User.findOne({ referralCode: normalizedCode }).session(session),
  ]);

  if (!user) throw new AppError('User not found', 404);
  if (!inviter) throw new AppError('Invalid referral code', 404);
  if (String(inviter._id) === String(user._id)) {
    throw new AppError('Self referral is not allowed', 400);
  }
  if (user.referredBy || user.referralRewardedAt) {
    throw new AppError('Referral already applied', 409);
  }

  user.referredBy = inviter._id;
  await user.save({ session });

  try {
    await Referral.create(
      [
        {
          inviter: inviter._id,
          referredUser: user._id,
          code: normalizedCode,
          inviterReward: INVITER_REWARD,
          referredReward: REFERRED_REWARD,
        },
      ],
      { session }
    );
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError('Referral already applied', 409);
    }
    throw error;
  }

  return { inviter, user };
};

const rewardFirstPaidJoin = async ({ userId, contestId, session = null }) => {
  const referral = await Referral.findOne({
    referredUser: userId,
    status: 'pending',
  }).session(session);

  if (!referral) {
    return null;
  }

  const inviterKey = `referral:inviter:${referral._id}`;
  const referredKey = `referral:referred:${referral._id}`;
  const [inviterCredit, referredCredit] = await Promise.all([
    Transaction.findOne({ idempotencyKey: inviterKey }).session(session).lean(),
    Transaction.findOne({ idempotencyKey: referredKey }).session(session).lean(),
  ]);

  if (!inviterCredit) {
    await creditCoins({
      userId: referral.inviter,
      amount: referral.inviterReward,
      reason: 'Referral reward',
      contest: contestId,
      idempotencyKey: inviterKey,
      metadata: { referredUser: userId },
      session,
    });
  }

  if (!referredCredit) {
    await creditCoins({
      userId,
      amount: referral.referredReward,
      reason: 'Referral signup reward',
      contest: contestId,
      idempotencyKey: referredKey,
      metadata: { inviter: referral.inviter },
      session,
    });
  }

  referral.status = 'rewarded';
  referral.contest = contestId;
  referral.rewardedAt = new Date();
  await referral.save({ session });

  await User.updateOne(
    { _id: userId, referralRewardedAt: null },
    { $set: { referralRewardedAt: referral.rewardedAt } },
    { session }
  );

  return referral;
};

const getReferralStats = async (userId) => {
  const user = await User.findById(userId);
  const referralCode = await ensureReferralCode(user);
  const [totalReferrals, rewarded, earnings] = await Promise.all([
    Referral.countDocuments({ inviter: userId }),
    Referral.countDocuments({ inviter: userId, status: 'rewarded' }),
    Referral.aggregate([
      { $match: { inviter: user._id, status: 'rewarded' } },
      { $group: { _id: null, total: { $sum: '$inviterReward' } } },
    ]),
  ]);

  return {
    referralCode,
    totalReferrals,
    rewardedReferrals: rewarded,
    referralEarnings: earnings[0]?.total || 0,
    inviterReward: INVITER_REWARD,
    referredReward: REFERRED_REWARD,
  };
};

module.exports = {
  applyReferralCode,
  ensureReferralCode,
  getReferralStats,
  rewardFirstPaidJoin,
};
