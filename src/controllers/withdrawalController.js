const { asyncHandler } = require('../middlewares/errorMiddleware');
const withdrawalService = require('../services/withdrawalService');

exports.getWithdrawalOverview = asyncHandler(async (req, res) => {
  const overview = await withdrawalService.getWithdrawalOverview(req.user.id);
  res.json(overview);
});

exports.requestWithdrawal = asyncHandler(async (req, res) => {
  const overview = await withdrawalService.requestWithdrawal({
    userId: req.user.id,
    amountCoins: req.body.amountCoins,
    upiId: req.body.upiId,
    accountName: req.body.accountName,
  });

  res.status(201).json(overview);
});
