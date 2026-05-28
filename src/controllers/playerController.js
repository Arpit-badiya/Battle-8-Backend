const Player = require('../models/Player');
const Contest = require('../models/Contest');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');

const allowedRoles = ['IGL', 'Assaulter', 'Supporter', 'Support', 'Sniper'];
const normalizeGame = (game = '') => String(game || 'BGMI').trim();

const validatePlayerPayload = ({ name, team, credits, role }) => {
  if (!name || !team) {
    throw new AppError('Player name and team are required', 400);
  }

  if (Number(credits) < 0 || Number.isNaN(Number(credits))) {
    throw new AppError('Valid player credits are required', 400);
  }

  if (role && !allowedRoles.includes(role)) {
    throw new AppError('Invalid player role', 400);
  }
};

exports.getPlayers = asyncHandler(async (req, res) => {
  const game = String(req.query.game || '').trim();
  const players = await Player.find({
    active: true,
    ...(game ? { game } : {}),
  }).sort({ game: 1, team: 1, role: 1, credits: -1, name: 1 });

  res.json(players);
});

exports.getContestPlayers = asyncHandler(async (req, res) => {
  const contest = await Contest.findById(req.params.contestId)
    .populate('contestPlayers')
    .lean();

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  res.json({
    players: (contest.contestPlayers || []).filter((player) => player?.active !== false),
  });
});

exports.createPlayer = asyncHandler(async (req, res) => {
  validatePlayerPayload(req.body);
  const game = normalizeGame(req.body.game);
  const team = String(req.body.team || '').trim();

  const teamExists = await Player.exists({
    game,
    team,
    active: true,
  });

  if (!teamExists) {
    throw new AppError('Select a valid existing team for this game', 400);
  }

  const player = await Player.create({
    game,
    name: req.body.name,
    team,
    credits: Number(req.body.credits),
    role: req.body.role || 'Assaulter',
    image: req.body.image || '',
    active: req.body.active !== false,
  });

  res.status(201).json({
    message: 'Player created',
    player,
  });
});

exports.createTeamPlayers = asyncHandler(async (req, res) => {
  const game = normalizeGame(req.body.game);
  const team = String(req.body.team || '').trim();
  const players = Array.isArray(req.body.players) ? req.body.players : [];

  if (!team) {
    throw new AppError('Team name is required', 400);
  }

  if (players.length === 0) {
    throw new AppError('Add at least one player for a team', 400);
  }

  const existingTeam = await Player.exists({
    game,
    team,
    active: true,
  });

  if (existingTeam) {
    throw new AppError('Team already added', 409);
  }

  players.forEach((player) => validatePlayerPayload({
    ...player,
    team,
  }));

  const created = await Player.insertMany(
    players.map((player) => ({
      game,
      name: String(player.name).trim(),
      team,
      credits: Number(player.credits),
      role: player.role || 'Assaulter',
      image: player.image || '',
      active: player.active !== false,
    })),
    { ordered: true }
  );

  res.status(201).json({
    message: 'Team players saved',
    players: created,
  });
});

exports.updatePlayer = asyncHandler(async (req, res) => {
  validatePlayerPayload(req.body);
  const game = normalizeGame(req.body.game);

  const player = await Player.findByIdAndUpdate(
    req.params.playerId,
    {
      game,
      name: req.body.name,
      team: req.body.team,
      credits: Number(req.body.credits),
      role: req.body.role || 'Assaulter',
      image: req.body.image || '',
      active: req.body.active !== false,
    },
    { new: true, runValidators: true }
  );

  if (!player) {
    throw new AppError('Player not found', 404);
  }

  res.json({
    message: 'Player updated',
    player,
  });
});

exports.deletePlayer = asyncHandler(async (req, res) => {
  const player = await Player.findByIdAndUpdate(
    req.params.playerId,
    { active: false },
    { new: true }
  );

  if (!player) {
    throw new AppError('Player not found', 404);
  }

  res.json({
    message: 'Player deleted',
    player,
  });
});
