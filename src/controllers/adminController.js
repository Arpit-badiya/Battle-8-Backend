const Contest = require('../models/Contest');
const AdReward = require('../models/AdReward');
const AdminAudit = require('../models/AdminAudit');
const Player = require('../models/Player');
const Team = require('../models/Team');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');
const cache = require('../services/cacheService');
const leaderboardService = require('../services/leaderboardService');
const resultService = require('../services/resultService');
const premiumService = require('../services/premiumService');
const { refundContestEntries } = require('../services/refundService');
const { emitContestUpdate } = require('../services/realtimeService');
const withdrawalService = require('../services/withdrawalService');
const { normalizeKey, parsePlayerImport, parseResultImport } = require('../services/importService');
const { calculateContestAccounting, getDynamicContestAccounting } = require('../services/prizeService');
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

const normalizeTeamNames = (teams = []) =>
  [...new Set((Array.isArray(teams) ? teams : []).map((team) => String(team || '').trim()).filter(Boolean))];

const normalizeGame = (game = '') => String(game || 'BGMI').trim();

const getPlayersForContestTeams = async (teams = [], game = 'BGMI') => {
  const contestTeams = normalizeTeamNames(teams);
  const selectedGame = normalizeGame(game);

  if (contestTeams.length === 0) {
    return { contestTeams, contestPlayers: [] };
  }

  const players = await Player.find({
    game: selectedGame,
    active: true,
    team: { $in: contestTeams },
  }).select('_id team').lean();

  const foundTeams = new Set(players.map((player) => String(player.team)));
  const missingTeams = contestTeams.filter((team) => !foundTeams.has(team));

  if (missingTeams.length) {
    throw new AppError(`No active players found for team(s): ${missingTeams.join(', ')}`, 400);
  }

  return {
    contestTeams,
    contestPlayers: players.map((player) => player._id),
  };
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

const VALID_CONTEST_TYPES = ['fantasy', 'team'];

const validateContestPayload = ({ players, entryFee, status, startTime, startsAt, platformCommissionPercent, contestType }) => {
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

  if (contestType && !VALID_CONTEST_TYPES.includes(contestType)) {
    throw new AppError(`Invalid contest type. Allowed values: ${VALID_CONTEST_TYPES.join(', ')}`, 400);
  }

  if (!startTime && !startsAt) {
    throw new AppError('Contest start time is required', 400);
  }
};

exports.getDashboard = asyncHandler(async (req, res) => {
  const [totalUsers, totalContests, totalTeams, revenue, platformEarnings, pendingWithdrawals, adRewards] = await Promise.all([
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
    Withdrawal.countDocuments({ status: { $in: ['requested', 'approved'] } }),
    AdReward.aggregate([
      { $group: { _id: null, ads: { $sum: 1 }, rewards: { $sum: '$totalRewardAmount' } } },
    ]),
  ]);

  res.json({
    totalUsers,
    totalContests,
    totalTeams,
    totalRevenue: revenue[0]?.total || 0,
    platformEarnings: platformEarnings[0]?.total || 0,
    pendingWithdrawals,
    totalAdsWatched: adRewards[0]?.ads || 0,
    adRewardCoins: adRewards[0]?.rewards || 0,
  });
});

exports.createContest = asyncHandler(async (req, res) => {
  validateContestPayload(req.body);
  const game = normalizeGame(req.body.game);
  const totalSpots = Number(req.body.totalSpots ?? req.body.players);
  const startTime = req.body.startTime || req.body.startsAt || null;
  const estimatedEndTime = req.body.estimatedEndTime || req.body.endTime || req.body.endsAt || null;
  const accounting = calculateContestAccounting({
    entryFee: req.body.entryFee,
    totalSpots,
    platformCommissionPercent: req.body.platformCommissionPercent,
  });
  const teamSelection = await getPlayersForContestTeams(req.body.contestTeams || req.body.teams || [], game);
  let contestPlayers = teamSelection.contestPlayers;

  if (contestPlayers.length === 0) {
    contestPlayers = validatePlayerIdPayload(req.body.contestPlayers);
    await ensurePlayersExist(contestPlayers);
  }

  if (contestPlayers.length === 0) {
    throw new AppError('Select at least one participating team', 400);
  }

  const generatedMatchIdentifier = req.body.matchIdentifier || `MATCH-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const title = req.body.title || req.body.matchName || `${game} Contest ${new Date(startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

  const contest = await Contest.create({
    title,
    game,
    contestType: VALID_CONTEST_TYPES.includes(req.body.contestType) ? req.body.contestType : 'fantasy',
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
    matchName: req.body.matchName || title,
    tournamentName: req.body.tournamentName || '',
    matchIdentifier: generatedMatchIdentifier,
    matchDateTime: req.body.matchDateTime || startTime,
    contestPlayers,
    contestTeams: teamSelection.contestTeams,
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
      contestTeams: teamSelection.contestTeams,
    },
    ip: req.ip,
  });
  await cache.delContestLists();
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

  contest.title = req.body.title || contest.title;
  contest.game = req.body.game ? normalizeGame(req.body.game) : contest.game;
  if (req.body.contestType && VALID_CONTEST_TYPES.includes(req.body.contestType)) {
    contest.contestType = req.body.contestType;
  }
  contest.players = Number(payload.players);
  const accounting = calculateContestAccounting({
    entryFee: req.body.entryFee,
    totalSpots: Number(payload.players),
    platformCommissionPercent: req.body.platformCommissionPercent,
  });
  contest.entryFee = accounting.entryFee;
  contest.platformCommissionPercent = accounting.platformCommissionPercent;
  const dynamicAccounting = getDynamicContestAccounting({
    entryFee: accounting.entryFee,
    joined: contest.joined,
    platformCommissionPercent: accounting.platformCommissionPercent,
  });
  contest.totalCollection = dynamicAccounting.totalCollection;
  contest.platformCommissionAmount = dynamicAccounting.platformCommissionAmount;
  contest.prizePool = dynamicAccounting.prizePool;
  contest.timeLeft = req.body.timeLeft || contest.timeLeft;
  contest.startsAt = req.body.startsAt || req.body.startTime || contest.startsAt;
  contest.endsAt = req.body.estimatedEndTime || req.body.endsAt || req.body.endTime || contest.endsAt;
  contest.startTime = req.body.startTime || req.body.startsAt || contest.startTime;
  contest.estimatedEndTime = req.body.estimatedEndTime || req.body.endTime || req.body.endsAt || contest.estimatedEndTime;
  contest.matchName = req.body.matchName ?? contest.matchName;
  contest.tournamentName = req.body.tournamentName ?? contest.tournamentName;
  contest.matchIdentifier = req.body.matchIdentifier ?? contest.matchIdentifier;
  contest.matchDateTime = req.body.matchDateTime || contest.matchDateTime;
  if (Array.isArray(req.body.contestPlayers)) {
    contest.contestPlayers = validatePlayerIdPayload(req.body.contestPlayers);
    await ensurePlayersExist(contest.contestPlayers);
  }
  if (Array.isArray(req.body.contestTeams) || Array.isArray(req.body.teams)) {
    const teamSelection = await getPlayersForContestTeams(req.body.contestTeams || req.body.teams, contest.game);
    if (teamSelection.contestPlayers.length === 0) {
      throw new AppError('Select at least one participating team', 400);
    }
    contest.contestTeams = teamSelection.contestTeams;
    contest.contestPlayers = teamSelection.contestPlayers;
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
  await cache.delContestLists();
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

  await cache.delContestLists();
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

exports.cancelContest = asyncHandler(async (req, res) => {
  const contest = await Contest.findById(req.params.contestId);

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  if (contest.status === 'completed' || contest.payoutsDistributed) {
    throw new AppError('Completed contest cannot be cancelled', 409);
  }

  contest.status = 'cancelled';
  contest.cancelledReason = req.body.reason || 'Cancelled by admin';
  contest.endTime = new Date();
  contest.endsAt = contest.endTime;
  contest.timeLeft = 'CANCELLED';
  await contest.save();

  const refund = await refundContestEntries({
    contestId: contest._id,
    adminId: req.user.id,
  });

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_CANCELLED',
    targetType: 'Contest',
    targetId: contest._id,
    metadata: {
      reason: contest.cancelledReason,
      refunded: refund.refunded,
    },
    ip: req.ip,
  });

  await cache.delContestLists(`leaderboard:${contest._id}`);
  emitContestUpdate(normalizeContest(refund.contest));

  res.json({
    message: 'Contest cancelled and refunds processed',
    refunded: refund.refunded,
    contest: normalizeContest(refund.contest),
  });
});

exports.rehostContest = asyncHandler(async (req, res) => {
  const original = await Contest.findById(req.params.contestId).lean();

  if (!original) {
    throw new AppError('Contest not found', 404);
  }

  if (original.status === 'completed' || original.payoutsDistributed) {
    throw new AppError('Completed contest cannot be rehosted', 409);
  }

  const [cancelled] = await Promise.all([
    Contest.findByIdAndUpdate(
      original._id,
      {
        status: 'cancelled',
        cancelledReason: req.body.reason || 'Match rehosted',
        endTime: new Date(),
        endsAt: new Date(),
        timeLeft: 'REHOSTED',
      },
      { new: true }
    ),
  ]);

  await refundContestEntries({
    contestId: original._id,
    adminId: req.user.id,
  });

  const newStart = req.body.startTime || req.body.startsAt || original.startTime || original.startsAt;
  const newContest = await Contest.create({
    title: req.body.title || `${original.title} Rehost`,
    game: original.game || 'BGMI',
    contestType: original.contestType || 'fantasy',
    players: original.players,
    entryFee: original.entryFee,
    prizePool: 0,
    totalCollection: 0,
    platformCommissionPercent: original.platformCommissionPercent,
    platformCommissionAmount: 0,
    status: 'upcoming',
    startsAt: newStart,
    startTime: newStart,
    endsAt: req.body.estimatedEndTime || original.estimatedEndTime || original.endsAt,
    estimatedEndTime: req.body.estimatedEndTime || original.estimatedEndTime,
    contestPlayers: original.contestPlayers,
    matchName: req.body.matchName || original.matchName || original.title,
    tournamentName: req.body.tournamentName || original.tournamentName || '',
    matchIdentifier: req.body.matchIdentifier || `${original.matchIdentifier || original._id}-rehost-${Date.now()}`,
    matchDateTime: req.body.matchDateTime || newStart,
    rehostedFrom: original._id,
  });

  await Contest.updateOne({ _id: original._id }, { rehostedTo: newContest._id });

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_REHOSTED',
    targetType: 'Contest',
    targetId: original._id,
    metadata: {
      rehostedTo: newContest._id,
      cancelledStatus: cancelled?.status,
    },
    ip: req.ip,
  });

  await cache.delContestLists();
  emitContestUpdate(normalizeContest(newContest));

  res.status(201).json({
    message: 'Contest rehosted',
    contest: normalizeContest(newContest),
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

  let contestTeams = [];
  let contestPlayers = [];

  if (Array.isArray(req.body.contestTeams) || Array.isArray(req.body.teams)) {
    const teamSelection = await getPlayersForContestTeams(req.body.contestTeams || req.body.teams, contest.game);
    contestTeams = teamSelection.contestTeams;
    contestPlayers = teamSelection.contestPlayers;
  } else {
    contestPlayers = validatePlayerIdPayload(req.body.players || req.body.contestPlayers);
  }

  await ensurePlayersExist(contestPlayers);

  if (contestPlayers.length === 0) {
    throw new AppError('Select at least one contest player', 400);
  }

  contest.contestPlayers = contestPlayers;
  contest.contestTeams = contestTeams.length ? contestTeams : contest.contestTeams;
  await contest.save();

  await AdminAudit.create({
    admin: req.user.id,
    action: 'CONTEST_PLAYERS_UPDATED',
    targetType: 'Contest',
    targetId: contest._id,
    metadata: { contestPlayers: contestPlayers.length },
    ip: req.ip,
  });

  await cache.delContestLists();
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
        game: contest.game || 'BGMI',
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
                  game: contest.game || 'BGMI',
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
              game: contest.game || 'BGMI',
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
      contest.contestTeams = normalizeTeamNames(parsed.players.map((player) => player.team));
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

  await cache.delContestLists();
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

  if (errors.length) {
    throw new AppError('Result import validation failed', 400, { errors });
  }

  const result = await resultService.processResults({
    contestId: req.params.contestId,
    playerResults,
    matchName: req.body.matchName,
    tournamentName: req.body.tournamentName,
    matchIdentifier: req.body.matchIdentifier,
    matchDateTime: req.body.matchDateTime,
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

exports.restartResultProcessing = asyncHandler(async (req, res) => {
  const result = await resultService.restartResultProcessing({
    contestId: req.params.contestId,
    adminId: req.user.id,
    ip: req.ip,
  });

  res.json(result);
});

exports.getAdRewardLogs = asyncHandler(async (req, res) => {
  const rewards = await AdReward.find({})
    .populate('user', 'name email coins winningCoins premium')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.json({
    rewards,
  });
});

exports.getWithdrawalRequests = asyncHandler(async (req, res) => {
  const withdrawals = await withdrawalService.listWithdrawals();
  res.json({
    withdrawals,
  });
});

exports.updateWithdrawalRequest = asyncHandler(async (req, res) => {
  const withdrawal = await withdrawalService.updateWithdrawalStatus({
    withdrawalId: req.params.withdrawalId,
    adminId: req.user.id,
    status: req.body.status,
    adminNote: req.body.adminNote,
    paymentReference: req.body.paymentReference,
  });

  res.json({
    withdrawal,
  });
});

exports.setUserPremium = asyncHandler(async (req, res) => {
  const result = await premiumService.setPremiumStatus({
    userId: req.params.userId,
    active: req.body.active !== false,
    expiresAt: req.body.expiresAt || null,
    adminId: req.user.id,
  });

  await AdminAudit.create({
    admin: req.user.id,
    action: result.user.premium?.active ? 'PREMIUM_ACTIVATED' : 'PREMIUM_EXPIRED',
    targetType: 'User',
    targetId: result.user._id,
    metadata: {
      expiresAt: result.user.premium?.expiresAt,
    },
    ip: req.ip,
  });

  res.json({
    user: result.user,
  });
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
