const { asyncHandler } = require('../middlewares/errorMiddleware');
const { createTeam } = require('../services/teamService');

exports.createTeam = asyncHandler(async (req, res) => {
  const team = await createTeam({
    userId: req.user.id,
    contestId: req.body.contestId,
    players: req.body.players,
  });

  res.status(201).json({
    message: 'Team created successfully',
    team,
  });
});
