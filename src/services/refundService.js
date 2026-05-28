const Contest = require('../models/Contest');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middlewares/errorMiddleware');
const { creditCoins } = require('./walletService');
const cache = require('./cacheService');
const { emitContestUpdate } = require('./realtimeService');
const { withMongoTransaction } = require('../utils/transactions');

const refundContestEntriesCore = async ({ contestId, adminId, session = null }) => {
  const contest = await Contest.findById(contestId).session(session);

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  if (contest.status !== 'cancelled') {
    throw new AppError('Only cancelled contests can be refunded', 400);
  }

  const debits = await Transaction.find({
    contest: contestId,
    type: 'debit',
    reason: /^Contest entry:/,
  })
    .session(session)
    .lean();

  let refunded = 0;

  for (const debit of debits) {
    const refundKey = `refund:${contestId}:user:${debit.user}`;
    const existingRefund = await Transaction.findOne({ idempotencyKey: refundKey }).session(session).lean();

    if (existingRefund) {
      continue;
    }

    await creditCoins({
      userId: debit.user,
      amount: debit.amount,
      reason: `Contest refund: ${contest.title}`,
      contest: contest._id,
      idempotencyKey: refundKey,
      session,
    });

    refunded += 1;
  }

  contest.participants = [];
  contest.joined = 0;
  contest.totalCollection = 0;
  contest.platformCommissionAmount = 0;
  contest.prizePool = 0;
  await contest.save({ session });

  return {
    contest,
    refunded,
    adminId,
  };
};

const refundContestEntries = async ({ contestId, adminId }) => {
  const result = await withMongoTransaction(
    (session) => refundContestEntriesCore({ contestId, adminId, session }),
    {
      fallback: () => refundContestEntriesCore({ contestId, adminId }),
      name: 'contest_refund',
    }
  );

  await cache.delContestLists(`leaderboard:${contestId}`);
  emitContestUpdate(result.contest);

  return result;
};

module.exports = {
  refundContestEntries,
};
