const AdReward = require('../models/AdReward');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorMiddleware');
const { creditCoins } = require('./walletService');
const { withMongoTransaction } = require('../utils/transactions');

const STANDARD_AD_TARGET = 3;
const STANDARD_AD_REWARD = 10;
const MILESTONE_AD_TARGET = 10;
const MILESTONE_REWARD = 50;
const MIN_SECONDS_BETWEEN_REWARDS = 20;

const getStartOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const serializeReward = (reward) => ({
  id: reward._id,
  adEventId: reward.adEventId,
  adsWatchedAfter: reward.adsWatchedAfter,
  standardRewardAmount: reward.standardRewardAmount || 0,
  milestoneRewardAmount: reward.milestoneRewardAmount || 0,
  totalRewardAmount: reward.totalRewardAmount || 0,
  milestone: reward.milestone || null,
  placement: reward.placement,
  createdAt: reward.createdAt,
});

const getAdSummary = async (userId) => {
  const [user, rewards, adsWatchedToday] = await Promise.all([
    User.findById(userId).select('coins adStats premium').lean(),
    AdReward.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean(),
    AdReward.countDocuments({
      user: userId,
      status: 'completed',
      createdAt: { $gte: getStartOfToday() },
    }),
  ]);

  if (!user) throw new AppError('User not found', 404);

  const totalAdsWatched = user.adStats?.totalAdsWatched || 0;
  const milestoneClaims = user.adStats?.milestoneClaims || [];
  const standardProgress = totalAdsWatched % STANDARD_AD_TARGET;

  return {
    coins: user.coins || 0,
    premiumActive: Boolean(user.premium?.active),
    adsWatchedToday,
    totalAdsWatched,
    standardReward: {
      target: STANDARD_AD_TARGET,
      progress: standardProgress,
      remaining: STANDARD_AD_TARGET - standardProgress,
      amount: STANDARD_AD_REWARD,
    },
    milestoneReward: {
      target: MILESTONE_AD_TARGET,
      progress: Math.min(totalAdsWatched, MILESTONE_AD_TARGET),
      amount: MILESTONE_REWARD,
      claimed: milestoneClaims.includes(MILESTONE_AD_TARGET),
    },
    rewards: rewards.map(serializeReward),
  };
};

const recordAdRewardCore = async ({ userId, adEventId, adUnitId = '', placement = 'earn_coins', completed, session = null }) => {
  const normalizedEventId = String(adEventId || '').trim();
  if (!normalizedEventId || normalizedEventId.length < 10) {
    throw new AppError('Valid ad event ID is required', 400);
  }
  if (completed !== true) {
    throw new AppError('Ad completion is required before reward', 400);
  }

  const existing = await AdReward.findOne({ adEventId: normalizedEventId }).session(session).lean();
  if (existing) {
    return { reward: existing, duplicate: true };
  }

  const user = await User.findById(userId).session(session);
  if (!user) throw new AppError('User not found', 404);
  if (user.premium?.active) {
    throw new AppError('Premium users do not need rewarded ads', 400);
  }

  const lastRewardAt = user.adStats?.lastRewardAt;
  if (lastRewardAt && Date.now() - new Date(lastRewardAt).getTime() < MIN_SECONDS_BETWEEN_REWARDS * 1000) {
    throw new AppError('Please wait before watching another ad', 429);
  }

  const priorTotal = Number(user.adStats?.totalAdsWatched || 0);
  const adsWatchedAfter = priorTotal + 1;
  const milestoneClaims = user.adStats?.milestoneClaims || [];
  const standardRewardAmount = adsWatchedAfter % STANDARD_AD_TARGET === 0 ? STANDARD_AD_REWARD : 0;
  const milestoneRewardAmount =
    adsWatchedAfter >= MILESTONE_AD_TARGET && !milestoneClaims.includes(MILESTONE_AD_TARGET)
      ? MILESTONE_REWARD
      : 0;
  const totalRewardAmount = standardRewardAmount + milestoneRewardAmount;

  const [reward] = await AdReward.create(
    [
      {
        user: userId,
        adEventId: normalizedEventId,
        adUnitId,
        placement,
        adsWatchedAfter,
        standardRewardAmount,
        milestoneRewardAmount,
        milestone: milestoneRewardAmount ? MILESTONE_AD_TARGET : null,
        totalRewardAmount,
        metadata: { standardTarget: STANDARD_AD_TARGET },
      },
    ],
    { session }
  );

  let standardTransaction = null;
  let milestoneTransaction = null;

  if (standardRewardAmount > 0) {
    const key = `ad-standard:${normalizedEventId}`;
    await creditCoins({
      userId,
      amount: standardRewardAmount,
      reason: `Ad reward: ${STANDARD_AD_TARGET} ads watched`,
      idempotencyKey: key,
      metadata: { wallet: 'main', adReward: reward._id, adEventId: normalizedEventId },
      session,
    });
    standardTransaction = await Transaction.findOne({ idempotencyKey: key }).session(session).lean();
  }

  if (milestoneRewardAmount > 0) {
    const key = `ad-milestone:${userId}:${MILESTONE_AD_TARGET}`;
    await creditCoins({
      userId,
      amount: milestoneRewardAmount,
      reason: `Ad milestone bonus: ${MILESTONE_AD_TARGET} ads`,
      idempotencyKey: key,
      metadata: { wallet: 'main', adReward: reward._id, milestone: MILESTONE_AD_TARGET },
      session,
    });
    milestoneTransaction = await Transaction.findOne({ idempotencyKey: key }).session(session).lean();
  }

  await AdReward.updateOne(
    { _id: reward._id },
    {
      standardTransaction: standardTransaction?._id || null,
      milestoneTransaction: milestoneTransaction?._id || null,
    },
    { session }
  );

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'adStats.totalAdsWatched': adsWatchedAfter,
        'adStats.lastRewardAt': new Date(),
      },
      $inc: {
        'adStats.standardRewardCount': standardRewardAmount > 0 ? 1 : 0,
      },
      ...(milestoneRewardAmount > 0 ? { $addToSet: { 'adStats.milestoneClaims': MILESTONE_AD_TARGET } } : {}),
    },
    { session }
  );

  return {
    reward: {
      ...reward.toObject(),
      standardTransaction: standardTransaction?._id || null,
      milestoneTransaction: milestoneTransaction?._id || null,
    },
    duplicate: false,
  };
};

const recordAdReward = async (payload) => {
  const result = await withMongoTransaction(
    (session) => recordAdRewardCore({ ...payload, session }),
    {
      fallback: () => recordAdRewardCore(payload),
      name: 'record_ad_reward',
    }
  );

  return {
    ...result,
    summary: await getAdSummary(payload.userId),
  };
};

module.exports = {
  MILESTONE_AD_TARGET,
  MILESTONE_REWARD,
  STANDARD_AD_REWARD,
  STANDARD_AD_TARGET,
  getAdSummary,
  recordAdReward,
};
