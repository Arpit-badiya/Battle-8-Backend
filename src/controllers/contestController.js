const { asyncHandler } = require('../middlewares/errorMiddleware');
const contestService = require('../services/contestService');

exports.getContests = asyncHandler(async (req, res) => {
  const contests = await contestService.getContestsForUser(req.user.id, {
    game: req.query.game,
  });

  res.json({
    contests,
  });
});

exports.joinContest = asyncHandler(async (req, res) => {
  const payload = await contestService.joinContest({
    userId: req.user.id,
    contestId: req.body.contestId,
    idempotencyKey: req.headers['idempotency-key'],
  });

  res.json({
    message: 'Contest joined successfully',
    ...payload,
  });
});
