const { asyncHandler } = require('../middlewares/errorMiddleware');
const { createTeam, createTeamContestEntry, getMyTeam } = require('../services/teamService');

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

exports.createTeamContestEntry = asyncHandler(async (req, res) => {
  const entry = await createTeamContestEntry({
    userId: req.user.id,
    contestId: req.body.contestId,
    selectedTeams: req.body.selectedTeams,
    captainTeam: req.body.captainTeam,
    viceCaptainTeam: req.body.viceCaptainTeam,
  });

  res.status(201).json({
    message: 'Team contest entry created successfully',
    entry,
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
