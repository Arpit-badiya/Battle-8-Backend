const { asyncHandler } = require('../middlewares/errorMiddleware');
const premiumService = require('../services/premiumService');

exports.getPremiumStatus = asyncHandler(async (req, res) => {
  const status = await premiumService.getPremiumStatus(req.user.id);
  res.json(status);
});

exports.claimDailyBonus = asyncHandler(async (req, res) => {
  const result = await premiumService.claimDailyPremiumBonus(req.user.id);
  res.json(result);
});
