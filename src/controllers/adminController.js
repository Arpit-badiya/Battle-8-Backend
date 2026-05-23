const Contest = require('../models/Contest');
const AdminAudit = require('../models/AdminAudit');
const Player = require('../models/Player');
const Team = require('../models/Team');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');
const cache = require('../services/cacheService');
const leaderboardService = require('../services/leaderboardService');
const resultService = require('../services/resultService');
const { refundContestEntries } = require('../services/refundService');
const { emitContestUpdate } = require('../services/realtimeService');
const { calculateContestAccounting } = require('../services/prizeService');
const { isValidObjectId, normalizeContest } = require('../utils/helpers');

const normalizePlayerIds = (players = []) =>
  [...new Set((Array.isArray(players) ? players : []).map(String))].filter(isValidObjectId);

const validatePlayerIdPayload = (players = []) => {
  if (!Array.isArray(players)) return [];

  const normalized = normalizePlayerIds(players);
  if (normalized.length !== [...new Set(players.map(String))].length) {
    throw new AppError('Contest players must be valid unique player IDs', 400);
  }

  return normalized;
};

const ensurePlayersExist = async (playerIds) => {
  if (!playerIds.length) return;

  const count = await Player.countDocuments({ _id: { $in: playerIds } });
  if (count !== playerIds.length) {
    throw new AppError('One or more contest players do not exist', 400);
  }
};

const validateContestPayload = ({ title, players, entryFee, status, startTime, startsAt, platformCommissionPercent }) => {
  if (!title) {
    throw new AppError('Contest title is required', 400);
  }

  if (Number(players) <= 0 || Number.isNaN(Number(players))) {
    throw new AppError('Contest slots must be greater than zero', 400);
  }

  if (Number(entryFee) < 0 || Number.isNaN(Number(entryFee))) {
    throw new AppError('Valid entry fee is required', 400);
  }

  try {
    calculateContestAccounting({
      entryFee,
      totalSpots: Number(players),
      platformCommissionPercent,
    });
  } catch (error) {
    throw new AppError(error.message, 400);
  }

  if (status && !['upcoming', 'live', 'completed', 'cancelled'].includes(status)) {
    throw new AppError('Invalid contest status', 400);
  }

  if (!startTime && !startsAt) {
    throw new AppError('Contest start time is required', 400);
  }
};

exports.getDashboard = asyncHandler(async (req, res) => {
  const [totalUsers, totalContests, totalTeams, revenue, platformEarnings] = await Promise.all([
    User.countDocuments(),
    Contest.countDocuments(),
    Team.countDocuments(),
    Transaction.aggregate([
      { $match: { type: 'debit' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Contest.aggregate([
      { $match: { status: { $in: ['live', 'completed'] } } },
      { $group: { _id: null, total: { $sum: '$platformCommissionAmount' } } },
    ]),
  ]);

  res.json({
    totalUsers,
    totalContests,
    totalTeams,
    totalRevenue: revenue[0]?.total || 0,
    platformEarnings: platformEarnings[0]?.total || 0,
  });
});

exports.createContest = asyncHandler(async (req, res) => {
  validateContestPayload(req.body);
  const totalSpots = Number(req.body.totalSpots ?? req.body.players);
  const startTime = req.body.startTime || req.body.startsAt || null;
  const estimatedEndTime = req.body.estimatedEndTime || req.body.endTime || req.body.endsAt || null;
  const accounting = calculateContestAccounting({
    entryFee: req.body.entryFee,
    totalSpots,
    platformCommissionPercent: req.body.platformCommissionPercent,
  });
  const contestPlayers = validatePlayerIdPayload(req.body.contestPlayers);
  await ensurePlayersExist(contestPlayers);

  const contest = await Contest.create({
    title: req.body.title,
    players: totalSpots,
    entryFee: accounting.entryFee,
    totalCollection: accounting.totalCollection,
    platformCommissionPercent: accounting.platformCommissionPercent,
    platformCommissionAmount: accounting.platformCommissionAmount,
    prizePool: accounting.prizePool,
    timeLeft: req.body.timeLeft || '00:00:00',
    status: 'upcoming',
    startsAt: startTime,
    endsAt: estimatedEndTime,
    startTime,
    estimatedEndTime,
    contestPlayers,
  });

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_CREATED',
    targetType: 'Contest',
    targetId: contest._id,
    metadata: {
      title: contest.title,
      totalCollection: contest.totalCollection,
      platformCommissionAmount: contest.platformCommissionAmount,
      prizePool: contest.prizePool,
      contestPlayers: contestPlayers.length,
    },
    ip: req.ip,
  });
  await cache.del('contests:list');
  await cache.setActiveMatchState(contest._id, { status: contest.status, updatedAt: new Date().toISOString() });
  emitContestUpdate(normalizeContest(contest));

  res.status(201).json({
    message: 'Contest created',
    contest,
  });
});

exports.updateContest = asyncHandler(async (req, res) => {
  const payload = {
    ...req.body,
    players: req.body.totalSpots ?? req.body.players,
  };
  validateContestPayload(payload);

  const contest = await Contest.findById(req.params.contestId);

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  if (Number(payload.players) < contest.joined) {
    throw new AppError('Contest slots cannot be less than joined users', 400);
  }

  contest.title = req.body.title;
  contest.players = Number(payload.players);
  const accounting = calculateContestAccounting({
    entryFee: req.body.entryFee,
    totalSpots: Number(payload.players),
    platformCommissionPercent: req.body.platformCommissionPercent,
  });
  contest.entryFee = accounting.entryFee;
  contest.totalCollection = accounting.totalCollection;
  contest.platformCommissionPercent = accounting.platformCommissionPercent;
  contest.platformCommissionAmount = accounting.platformCommissionAmount;
  contest.prizePool = accounting.prizePool;
  contest.timeLeft = req.body.timeLeft || contest.timeLeft;
  contest.startsAt = req.body.startsAt || req.body.startTime || contest.startsAt;
  contest.endsAt = req.body.estimatedEndTime || req.body.endsAt || req.body.endTime || contest.endsAt;
  contest.startTime = req.body.startTime || req.body.startsAt || contest.startTime;
  contest.estimatedEndTime = req.body.estimatedEndTime || req.body.endTime || req.body.endsAt || contest.estimatedEndTime;
  if (Array.isArray(req.body.contestPlayers)) {
    contest.contestPlayers = validatePlayerIdPayload(req.body.contestPlayers);
    await ensurePlayersExist(contest.contestPlayers);
  }

  await contest.save();

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_UPDATED',
    targetType: 'Contest',
    targetId: contest._id,
    metadata: {
      status: contest.status,
      totalCollection: contest.totalCollection,
      platformCommissionAmount: contest.platformCommissionAmount,
      prizePool: contest.prizePool,
      contestPlayers: contest.contestPlayers.length,
    },
    ip: req.ip,
  });
  await cache.del('contests:list');
  await cache.setActiveMatchState(contest._id, { status: contest.status, updatedAt: new Date().toISOString() });
  emitContestUpdate(normalizeContest(contest));

  res.json({
    message: 'Contest updated',
    contest,
  });
});

exports.markContestLive = asyncHandler(async (req, res) => {
  const contest = await Contest.findById(req.params.contestId);

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  if (contest.status === 'completed' || contest.resultDeclared) {
    throw new AppError('Completed contest cannot go live again', 409);
  }

  if (contest.status === 'cancelled') {
    throw new AppError('Cancelled contest cannot go live', 400);
  }

  contest.status = 'live';
  contest.startTime = contest.startTime || new Date();
  contest.startsAt = contest.startsAt || contest.startTime;
  contest.timeLeft = 'LIVE';

  await contest.save();

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_MARKED_LIVE',
    targetType: 'Contest',
    targetId: contest._id,
    metadata: { status: contest.status },
    ip: req.ip,
  });

  await cache.del('contests:list');
  await cache.setActiveMatchState(contest._id, {
    status: 'live',
    updatedAt: new Date().toISOString(),
  });
  emitContestUpdate(normalizeContest(contest));

  res.json({
    message: 'Contest marked live',
    contest: normalizeContest(contest),
  });
});

exports.updateContestPlayers = asyncHandler(async (req, res) => {
  const contest = await Contest.findById(req.params.contestId);

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  if (contest.status !== 'upcoming' || contest.joined > 0) {
    throw new AppError('Contest players can only be changed before joining starts', 409);
  }

  const contestPlayers = validatePlayerIdPayload(req.body.players || req.body.contestPlayers);
  await ensurePlayersExist(contestPlayers);

  if (contestPlayers.length === 0) {
    throw new AppError('Select at least one contest player', 400);
  }

  contest.contestPlayers = contestPlayers;
  await contest.save();

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_PLAYERS_UPDATED',
    targetType: 'Contest',
    targetId: contest._id,
    metadata: { contestPlayers: contestPlayers.length },
    ip: req.ip,
  });

  await cache.del('contests:list');
  emitContestUpdate(normalizeContest(contest));

  res.json({
    message: 'Contest players updated',
    contest: normalizeContest(contest),
  });
});

exports.markContestCompleted = asyncHandler(async (req, res) => {
  const result = await resultService.completeContest({
    contestId: req.params.contestId,
    adminId: req.user.id,
    ip: req.ip,
  });

  res.json(result);
});

exports.getLeaderboard = asyncHandler(async (req, res) => {
  const leaderboard = await leaderboardService.getLeaderboard(req.params.contestId);

  res.json({
    leaderboard,
  });
});

exports.refundContest = asyncHandler(async (req, res) => {
  const result = await refundContestEntries({
    contestId: req.params.contestId,
    adminId: req.user.id,
  });

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_REFUNDED',
    targetType: 'Contest',
    targetId: req.params.contestId,
    metadata: { refunded: result.refunded },
    ip: req.ip,
  });

  res.json({
    message: 'Contest entries refunded',
    refunded: result.refunded,
  });
});
