const { asyncHandler } = require('../middlewares/errorMiddleware');
const resultService = require('../services/resultService');

exports.processResults = asyncHandler(async (req, res) => {
  const result = await resultService.processResults({
    contestId: req.body.contestId,
    playerResults: req.body.playerResults,
    payouts: req.body.payouts || [],
    matchName: req.body.matchName,
    tournamentName: req.body.tournamentName,
    matchIdentifier: req.body.matchIdentifier,
    matchDateTime: req.body.matchDateTime,
    adminId: req.user.id,
    ip: req.ip,
  });

  res.json(result);
});

exports.processTeamResults = asyncHandler(async (req, res) => {
  const result = await resultService.processTeamResults({
    contestId: req.body.contestId,
    teamResults: req.body.teamResults,
    matchName: req.body.matchName,
    tournamentName: req.body.tournamentName,
    matchIdentifier: req.body.matchIdentifier,
    matchDateTime: req.body.matchDateTime,
    adminId: req.user.id,
    ip: req.ip,
  });

  res.json(result);
});

exports.savePlayerResult = asyncHandler(async (req, res) => {
  const result = await resultService.savePlayerResult({
    contestId: req.body.contestId,
    playerId: req.body.playerId || req.body.player,
    kills: req.body.kills,
    placement: req.body.placement,
    adminId: req.user.id,
    ip: req.ip,
  });

  res.json(result);
});
