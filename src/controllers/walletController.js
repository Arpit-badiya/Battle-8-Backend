const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');

exports.getWallet = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('coins winningCoins');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const transactions = await Transaction.find({
    user: req.user.id,
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.json({
    balance: user.coins,
    coins: user.coins,
    mainCoins: user.coins,
    winningCoins: user.winningCoins || 0,
    transactions,
  });
});
