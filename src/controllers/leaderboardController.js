const { asyncHandler } = require('../middlewares/errorMiddleware');
const leaderboardService = require('../services/leaderboardService');

exports.getLeaderboard = asyncHandler(async (req, res) => {
  const leaderboard = await leaderboardService.getLeaderboard(
    req.params.contestId,
    req.user?.id
  );

  res.json({
    leaderboard,
  });
});
