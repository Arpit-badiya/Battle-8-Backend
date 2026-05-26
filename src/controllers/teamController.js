const { asyncHandler } = require('../middlewares/errorMiddleware');
const { createTeam, getMyTeam } = require('../services/teamService');

exports.createTeam = asyncHandler(async (req, res) => {
  const team = await createTeam({
    userId: req.user.id,
    contestId: req.body.contestId,
    players: req.body.players,
    captain: req.body.captain,
    viceCaptain: req.body.viceCaptain,
  });

  res.status(201).json({
    message: 'Team created successfully',
    team,
  });
});

exports.getMyTeam = asyncHandler(async (req, res) => {
  const team = await getMyTeam({
    userId: req.user.id,
    contestId: req.params.contestId,
  });

  res.json({
    team,
  });
});
