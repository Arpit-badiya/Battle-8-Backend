const { asyncHandler } = require('../middlewares/errorMiddleware');
const adRewardService = require('../services/adRewardService');

exports.getAdSummary = asyncHandler(async (req, res) => {
  const summary = await adRewardService.getAdSummary(req.user.id);
  res.json(summary);
});

exports.recordAdReward = asyncHandler(async (req, res) => {
  const result = await adRewardService.recordAdReward({
    userId: req.user.id,
    adEventId: req.body.adEventId,
    adUnitId: req.body.adUnitId,
    placement: req.body.placement,
    completed: req.body.completed,
  });

  res.status(result.duplicate ? 200 : 201).json(result);
});
