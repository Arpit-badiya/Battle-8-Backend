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
const { normalizeKey, parsePlayerImport, parseResultImport } = require('../services/importService');
const { calculateContestAccounting } = require('../services/prizeService');
const { withMongoTransaction } = require('../utils/transactions');
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

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getImportSource = (req) => ({
  file: req.file,
  csvText: req.body.csvText || req.body.text || '',
});

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

exports.importContestPlayers = asyncHandler(async (req, res) => {
  const parsed = await parsePlayerImport(getImportSource(req));

  if (!parsed.players.length || parsed.errors.length) {
    throw new AppError('Player import validation failed', 400, {
      errors: parsed.errors.length ? parsed.errors : [{ line: 0, message: 'No player rows found' }],
    });
  }

  const defaultCredits = Number(req.body.defaultCredits || 8);

  if (!Number.isFinite(defaultCredits) || defaultCredits < 0) {
    throw new AppError('Default credits must be greater than or equal to 0', 400);
  }

  const result = await withMongoTransaction(
    async (session) => {
      const contest = await Contest.findById(req.params.contestId).session(session);

      if (!contest) throw new AppError('Contest not found', 404);
      if (contest.status !== 'upcoming' || contest.joined > 0) {
        throw new AppError('Players can be imported only before the contest receives joins', 409);
      }

      const orQuery = parsed.players.map((player) => ({
        name: new RegExp(`^${escapeRegex(player.name)}$`, 'i'),
        team: new RegExp(`^${escapeRegex(player.team)}$`, 'i'),
      }));
      const existingPlayers = await Player.find({ $or: orQuery }).session(session);
      const playerByKey = new Map(
        existingPlayers.map((player) => [`${normalizeKey(player.team)}:${normalizeKey(player.name)}`, player])
      );
      const importedPlayerIds = [];
      let created = 0;
      let reused = 0;

      for (const row of parsed.players) {
        const key = `${normalizeKey(row.team)}:${normalizeKey(row.name)}`;
        let player = playerByKey.get(key);

        if (player) {
          reused += 1;
        } else {
          try {
            [player] = await Player.create(
              [
                {
                  name: row.name,
                  team: row.team,
                  credits: defaultCredits,
                  role: 'Assaulter',
                },
              ],
              { session }
            );
            created += 1;
            playerByKey.set(key, player);
          } catch (error) {
            if (error.code !== 11000) {
              throw error;
            }
            player = await Player.findOne({
              name: new RegExp(`^${escapeRegex(row.name)}$`, 'i'),
              team: new RegExp(`^${escapeRegex(row.team)}$`, 'i'),
            }).session(session);
            if (!player) throw error;
            reused += 1;
          }
        }

        importedPlayerIds.push(player._id);
      }

      contest.contestPlayers = [...new Set(importedPlayerIds.map(String))];
      await contest.save({ session });

      await AdminAudit.create(
        [
          {
            admin: req.user.id,
            action: 'CONTEST_PLAYERS_IMPORTED',
            targetType: 'Contest',
            targetId: contest._id,
            metadata: {
              rows: parsed.players.length,
              created,
              reused,
              defaultCredits,
            },
            ip: req.ip,
          },
        ],
        { session }
      );

      return {
        contest,
        summary: {
          rows: parsed.players.length,
          imported: contest.contestPlayers.length,
          created,
          reused,
          errors: [],
        },
      };
    },
    {
      fallback: async () => {
        throw new AppError('Player import requires MongoDB transaction support', 500);
      },
      name: 'import_contest_players',
    }
  );

  await cache.del('contests:list');
  emitContestUpdate(normalizeContest(result.contest));

  res.json({
    message: 'Contest players imported',
    contest: normalizeContest(result.contest),
    summary: result.summary,
  });
});

exports.importContestResults = asyncHandler(async (req, res) => {
  const parsed = await parseResultImport(getImportSource(req));

  if (!parsed.results.length || parsed.errors.length) {
    throw new AppError('Result import validation failed', 400, {
      errors: parsed.errors.length ? parsed.errors : [{ line: 0, message: 'No result rows found' }],
    });
  }

  const contest = await Contest.findById(req.params.contestId).populate('contestPlayers').lean();

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  const players = contest.contestPlayers || [];
  if (!players.length) {
    throw new AppError('Contest players are not configured', 400);
  }

  const playerByName = new Map();
  const duplicateNames = new Set();

  players.forEach((player) => {
    const key = normalizeKey(player.name);
    if (playerByName.has(key)) {
      duplicateNames.add(player.name);
      return;
    }
    playerByName.set(key, player);
  });

  if (duplicateNames.size) {
    throw new AppError(
      `Duplicate player names in contest: ${[...duplicateNames].join(', ')}. Rename or enter results manually.`,
      400
    );
  }

  const errors = [];
  const playerResults = parsed.results.map((row) => {
    const player = playerByName.get(normalizeKey(row.name));

    if (!player) {
      errors.push({ line: row.line, message: `Player not found in contest: ${row.name}` });
      return null;
    }

    return {
      playerId: player._id,
      kills: row.kills,
      placement: row.placement,
    };
  }).filter(Boolean);

  const importedIds = new Set(playerResults.map((row) => String(row.playerId)));
  const missing = players
    .filter((player) => !importedIds.has(String(player._id)))
    .map((player) => player.name);

  if (missing.length) {
    errors.push({
      line: 0,
      message: `Missing results for: ${missing.join(', ')}`,
    });
  }

  if (errors.length) {
    throw new AppError('Result import validation failed', 400, { errors });
  }

  const result = await resultService.processResults({
    contestId: req.params.contestId,
    playerResults,
    adminId: req.user.id,
    ip: req.ip,
  });

  res.json({
    ...result,
    summary: {
      rows: parsed.results.length,
      processed: playerResults.length,
      errors: [],
    },
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
