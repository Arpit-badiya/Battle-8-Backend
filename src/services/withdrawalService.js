const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { AppError } = require('../middlewares/errorMiddleware');
const { creditWinningCoins, debitWinningCoins } = require('./walletService');
const { withMongoTransaction } = require('../utils/transactions');

const MIN_WITHDRAWAL_COINS = 1000;
const INR_PER_1000_COINS = 10;

const coinsToInr = (coins) => Math.floor((Number(coins || 0) / 1000) * INR_PER_1000_COINS * 100) / 100;

const getPaidContestJoinCount = (userId) =>
  Transaction.countDocuments({
    user: userId,
    type: 'debit',
    amount: { $gt: 0 },
    reason: /^Contest entry:/,
  });

const serializeWithdrawal = (item) => ({
  id: item._id,
  amountCoins: item.amountCoins,
  amountInr: item.amountInr,
  upiId: item.upiId,
  accountName: item.accountName,
  status: item.status,
  adminNote: item.adminNote || '',
  paymentReference: item.paymentReference || '',
  createdAt: item.createdAt,
  reviewedAt: item.reviewedAt,
  paidAt: item.paidAt,
});

const getWithdrawalOverview = async (userId) => {
  const [user, joinedPaidContests, withdrawals] = await Promise.all([
    User.findById(userId).select('coins winningCoins').lean(),
    getPaidContestJoinCount(userId),
    Withdrawal.find({ user: userId }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);

  if (!user) throw new AppError('User not found', 404);

  const winningCoins = Number(user.winningCoins || 0);
  return {
    mainCoins: Number(user.coins || 0),
    winningCoins,
    withdrawableCoins: winningCoins,
    estimatedInr: coinsToInr(winningCoins),
    joinedPaidContests,
    eligible: joinedPaidContests > 0 && winningCoins >= MIN_WITHDRAWAL_COINS,
    minimumCoins: MIN_WITHDRAWAL_COINS,
    conversion: {
      coins: 1000,
      inr: INR_PER_1000_COINS,
    },
    withdrawals: withdrawals.map(serializeWithdrawal),
  };
};

const validateUpi = (upiId) => /^[a-z0-9.\-_]{2,}@[a-z]{2,}$/i.test(String(upiId || '').trim());

const requestWithdrawalCore = async ({ userId, amountCoins, upiId, accountName, session = null }) => {
  const coins = Math.floor(Number(amountCoins || 0));
  if (coins < MIN_WITHDRAWAL_COINS) {
    throw new AppError(`Minimum withdrawal is ${MIN_WITHDRAWAL_COINS} winning coins`, 400);
  }
  if (!validateUpi(upiId)) {
    throw new AppError('Valid UPI ID is required', 400);
  }
  if (!String(accountName || '').trim()) {
    throw new AppError('Account holder name is required', 400);
  }

  const joinedPaidContests = await getPaidContestJoinCount(userId);
  if (joinedPaidContests < 1) {
    throw new AppError('Join at least one paid contest before withdrawing', 400);
  }

  const [withdrawal] = await Withdrawal.create(
    [
      {
        user: userId,
        amountCoins: coins,
        amountInr: coinsToInr(coins),
        upiId,
        accountName,
      },
    ],
    { session }
  );

  const holdKey = `withdrawal-hold:${withdrawal._id}`;
  await debitWinningCoins({
    userId,
    amount: coins,
    reason: `Withdrawal hold: ${withdrawal._id}`,
    withdrawal: withdrawal._id,
    idempotencyKey: holdKey,
    metadata: { status: 'requested' },
    session,
  });

  const holdTransaction = await Transaction.findOne({ idempotencyKey: holdKey }).session(session).lean();
  withdrawal.holdTransaction = holdTransaction?._id || null;
  await withdrawal.save({ session });

  return withdrawal;
};

const requestWithdrawal = async (payload) => {
  await withMongoTransaction(
    (session) => requestWithdrawalCore({ ...payload, session }),
    {
      fallback: () => requestWithdrawalCore(payload),
      name: 'request_withdrawal',
    }
  );

  return getWithdrawalOverview(payload.userId);
};

const updateWithdrawalStatusCore = async ({ withdrawalId, adminId, status, adminNote = '', paymentReference = '', session = null }) => {
  const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
  if (!withdrawal) throw new AppError('Withdrawal not found', 404);

  if (status === 'approved') {
    if (withdrawal.status !== 'requested') throw new AppError('Only requested withdrawals can be approved', 409);
    withdrawal.status = 'approved';
    withdrawal.reviewedBy = adminId;
    withdrawal.reviewedAt = new Date();
  } else if (status === 'rejected') {
    if (!['requested', 'approved'].includes(withdrawal.status)) throw new AppError('Withdrawal cannot be rejected', 409);
    const refundKey = `withdrawal-refund:${withdrawal._id}`;
    const existing = await Transaction.findOne({ idempotencyKey: refundKey }).session(session).lean();
    if (!existing) {
      await creditWinningCoins({
        userId: withdrawal.user,
        amount: withdrawal.amountCoins,
        reason: `Withdrawal rejected refund: ${withdrawal._id}`,
        withdrawal: withdrawal._id,
        idempotencyKey: refundKey,
        metadata: { status: 'rejected' },
        session,
      });
    }
    const refund = await Transaction.findOne({ idempotencyKey: refundKey }).session(session).lean();
    withdrawal.refundTransaction = refund?._id || withdrawal.refundTransaction;
    withdrawal.status = 'rejected';
    withdrawal.reviewedBy = adminId;
    withdrawal.reviewedAt = new Date();
  } else if (status === 'paid') {
    if (withdrawal.status !== 'approved') throw new AppError('Approve withdrawal before marking paid', 409);
    withdrawal.status = 'paid';
    withdrawal.paidAt = new Date();
    withdrawal.reviewedBy = adminId;
  } else {
    throw new AppError('Invalid withdrawal status', 400);
  }

  withdrawal.adminNote = adminNote || withdrawal.adminNote;
  withdrawal.paymentReference = paymentReference || withdrawal.paymentReference;
  await withdrawal.save({ session });
  return withdrawal;
};

const updateWithdrawalStatus = (payload) =>
  withMongoTransaction(
    (session) => updateWithdrawalStatusCore({ ...payload, session }),
    {
      fallback: () => updateWithdrawalStatusCore(payload),
      name: 'update_withdrawal_status',
    }
  );

const listWithdrawals = async () => {
  const withdrawals = await Withdrawal.find({})
    .populate('user', 'name email coins winningCoins')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return withdrawals.map((item) => ({
    ...serializeWithdrawal(item),
    user: item.user,
  }));
};

module.exports = {
  MIN_WITHDRAWAL_COINS,
  coinsToInr,
  getWithdrawalOverview,
  listWithdrawals,
  requestWithdrawal,
  updateWithdrawalStatus,
};
