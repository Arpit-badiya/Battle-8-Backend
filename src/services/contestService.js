const Contest = require('../models/Contest');
const Team = require('../models/Team');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AppError } = require('../middlewares/errorMiddleware');
const cache = require('./cacheService');
const { emitContestUpdate } = require('./realtimeService');
const { debitCoins } = require('./walletService');
const { rewardFirstPaidJoin } = require('./referralService');
const { getDynamicContestAccounting } = require('./prizeService');
const { withMongoTransaction } = require('../utils/transactions');
const { getEffectiveContestStatus, isValidObjectId, normalizeContest } = require('../utils/helpers');

const CONTEST_LIST_CACHE_KEY = 'contests:list';

const applyDynamicAccounting = (contest) => {
  if (!contest) return contest;
  const accounting = getDynamicContestAccounting({
    entryFee: contest.entryFee,
    joined: contest.joined,
    platformCommissionPercent: contest.platformCommissionPercent,
  });

  contest.totalCollection = accounting.totalCollection;
  contest.platformCommissionAmount = accounting.platformCommissionAmount;
  contest.prizePool = accounting.prizePool;
  return contest;
};

const normalizeGame = (game = '') => String(game || '').trim();

const getContestsForUser = async (userId, { game = '' } = {}) => {
  const selectedGame = normalizeGame(game);
  const cacheKey = selectedGame ? `${CONTEST_LIST_CACHE_KEY}:${selectedGame}` : CONTEST_LIST_CACHE_KEY;
  let contests = await cache.get(cacheKey);

  if (!contests) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    contests = await Contest.find({
      ...(selectedGame ? { game: selectedGame } : {}),
      $or: [
        { status: { $in: ['upcoming', 'live'] } },
        { endTime: { $gte: cutoff } },
        { endsAt: { $gte: cutoff } },
        { updatedAt: { $gte: cutoff } },
      ],
    }).sort({ createdAt: -1 }).lean();
    await cache.set(cacheKey, contests, 30);
  }

  const teams = await Team.find({ user: userId }).select('contest').lean();
  const teamContestIds = new Set(teams.map((team) => String(team.contest)));

  return contests.map((contest) => ({
    ...normalizeContest(applyDynamicAccounting(contest), userId),
    teamCreated: teamContestIds.has(String(contest._id)),
  }));
};

const getJoinFailure = async (contestId, userId, session = null) => {
  const currentContest = await Contest.findById(contestId).session(session).lean();

  if (!currentContest) {
    return new AppError('Contest not found', 404);
  }

  if (
    currentContest.status === 'completed' ||
    currentContest.status === 'cancelled' ||
    getEffectiveContestStatus(currentContest) !== 'upcoming'
  ) {
    return new AppError('Contest is not open for joining', 400);
  }

  if ((currentContest.participants || []).some((participant) => String(participant) === String(userId))) {
    return new AppError('Contest already joined', 409);
  }

  return new AppError('Contest is full', 400);
};

const readJoinState = async (contestId, userId, session = null) => {
  const [contest, walletTransaction] = await Promise.all([
    Contest.findById(contestId).session(session),
    Transaction.findOne({
      user: userId,
      contest: contestId,
      type: 'debit',
      reason: /^Contest entry:/,
    }).session(session),
  ]);

  return {
    contest: normalizeContest(contest, userId),
    wallet: walletTransaction
      ? {
          balance: walletTransaction.balanceAfter,
          coins: walletTransaction.balanceAfter,
        }
      : null,
  };
};

const joinContestCore = async ({ userId, contestId, idempotencyKey, session = null }) => {
  const existingTeam = await Team.findOne({ user: userId, contest: contestId }).session(session).lean();

  if (!existingTeam) {
    throw new AppError('Create your team before joining this contest', 400);
  }

  const transactionKey = idempotencyKey || `contest:${contestId}:user:${userId}`;
  const existingTransaction = await Transaction.findOne({ idempotencyKey: transactionKey }).session(session).lean();

  if (existingTransaction) {
    return readJoinState(contestId, userId, session);
  }

  const contest = await Contest.findOneAndUpdate(
    {
      _id: contestId,
      status: 'upcoming',
      $and: [
        {
          $or: [
            { startTime: null },
            { startTime: { $gt: new Date() } },
          ],
        },
        {
          $or: [
            { startsAt: null },
            { startsAt: { $gt: new Date() } },
          ],
        },
      ],
      participants: { $ne: userId },
      $expr: { $lt: ['$joined', '$players'] },
    },
    {
      $addToSet: { participants: userId },
      $inc: { joined: 1 },
    },
    { returnDocument: 'after', session }
  );

  if (!contest) {
    throw await getJoinFailure(contestId, userId, session);
  }

  applyDynamicAccounting(contest);
  await contest.save({ session });

  const updatedUser = await debitCoins({
    userId,
    amount: contest.entryFee,
    reason: `Contest entry: ${contest.title}`,
    contest: contest._id,
    idempotencyKey: transactionKey,
    session,
  });

  let walletUser = updatedUser;

  if (Number(contest.entryFee || 0) > 0) {
    const referralReward = await rewardFirstPaidJoin({
      userId,
      contestId: contest._id,
      session,
    });
    if (referralReward) {
      walletUser = await User.findById(userId).session(session);
    }
  }

  return {
    contest: normalizeContest(contest, userId),
    wallet: {
      balance: walletUser.coins,
      coins: walletUser.coins,
    },
  };
};

const releaseContestSeat = async (contestId, userId) => {
  const contest = await Contest.findOneAndUpdate(
    {
      _id: contestId,
      participants: userId,
      joined: { $gt: 0 },
    },
    {
      $pull: { participants: userId },
      $inc: { joined: -1 },
    },
    { returnDocument: 'after' }
  );

  if (contest) {
    applyDynamicAccounting(contest);
    await contest.save();
  }
};

const joinContestFallback = async (payload) => {
  try {
    return await joinContestCore(payload);
  } catch (error) {
    if (error.message === 'Duplicate wallet transaction') {
      return readJoinState(payload.contestId, payload.userId);
    }

    if (error.message === 'Insufficient wallet balance') {
      await releaseContestSeat(payload.contestId, payload.userId);
    }

    throw error;
  }
};

const joinContest = async ({ userId, contestId, idempotencyKey }) => {
  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  const payload = { userId, contestId, idempotencyKey };
  const result = await withMongoTransaction(
    (session) => joinContestCore({ ...payload, session }),
    {
      fallback: () => joinContestFallback(payload),
      name: 'contest_join',
    }
  );

  await cache.delContestLists(`leaderboard:${contestId}`);
  emitContestUpdate(result.contest);

  return result;
};

module.exports = {
  CONTEST_LIST_CACHE_KEY,
  getContestsForUser,
  joinContest,
};
