const Player = require('../models/Player');
const Contest = require('../models/Contest');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');

const allowedRoles = ['Assaulter', 'Support', 'Sniper', 'IGL'];

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
  const players = await Player.find().sort({ role: 1, credits: -1, name: 1 });

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
    players: contest.contestPlayers || [],
  });
});

exports.createPlayer = asyncHandler(async (req, res) => {
  validatePlayerPayload(req.body);

  const player = await Player.create({
    name: req.body.name,
    team: req.body.team,
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
  const team = String(req.body.team || '').trim();
  const players = Array.isArray(req.body.players) ? req.body.players : [];

  if (!team) {
    throw new AppError('Team name is required', 400);
  }

  if (players.length !== 5) {
    throw new AppError('Create exactly 5 players for a team', 400);
  }

  players.forEach((player) => validatePlayerPayload({
    ...player,
    team,
  }));

  const created = [];
  for (const player of players) {
    const doc = await Player.findOneAndUpdate(
      {
        name: String(player.name).trim(),
        team,
      },
      {
        name: String(player.name).trim(),
        team,
        credits: Number(player.credits),
        role: player.role || 'Assaulter',
        image: player.image || '',
        active: player.active !== false,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
    created.push(doc);
  }

  res.status(201).json({
    message: 'Team players saved',
    players: created,
  });
});

exports.updatePlayer = asyncHandler(async (req, res) => {
  validatePlayerPayload(req.body);

  const player = await Player.findByIdAndUpdate(
    req.params.playerId,
    {
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
  const player = await Player.findByIdAndDelete(req.params.playerId);

  if (!player) {
    throw new AppError('Player not found', 404);
  }

  res.json({
    message: 'Player deleted',
  });
});
