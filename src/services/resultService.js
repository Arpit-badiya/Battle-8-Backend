const AdminAudit = require('../models/AdminAudit');
const Contest = require('../models/Contest');
const ContestResult = require('../models/ContestResult');
const Player = require('../models/Player');
const Team = require('../models/Team');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middlewares/errorMiddleware');
const cache = require('./cacheService');
const { emitContestUpdate, emitLeaderboardUpdate, emitResultDeclared } = require('./realtimeService');
const { getLeaderboard } = require('./leaderboardService');
const { calculatePlayerPoints, validateResultInput } = require('./pointService');
const { calculatePrizeDistribution } = require('./prizeService');
const { creditCoins } = require('./walletService');
const { withMongoTransaction } = require('../utils/transactions');
const { getEffectiveContestStatus, isValidObjectId, normalizeContest } = require('../utils/helpers');

const getWinningsMap = (contest, winnerCount) =>
  new Map(calculatePrizeDistribution({
    prizePool: contest.prizePool,
    winnerCount,
  }).map((item) => [
    Number(item.rank),
    Number(item.amount || 0),
  ]));

const calculateRanks = (teams) => {
  let previousPoints = null;
  let previousRank = 0;

  return teams.map((team, index) => {
    const rank = previousPoints === team.points ? previousRank : index + 1;
    previousPoints = team.points;
    previousRank = rank;
    return { team, rank };
  });
};

const splitTieAmount = (amount, count) => {
  const cents = Math.round(Number(amount || 0) * 100);
  const base = Math.floor(cents / count);
  const remainder = cents % count;

  return Array.from({ length: count }).map((_, index) =>
    (base + (index < remainder ? 1 : 0)) / 100
  );
};

const recalculateTeams = async ({ contestId, session = null }) => {
  const resultDoc = await ContestResult.findOne({ contest: contestId }).session(session).lean();
  const resultMap = new Map(
    (resultDoc?.playerResults || []).map((result) => [String(result.player), result])
  );
  const teams = await Team.find({ contest: contestId }).session(session);

  for (const team of teams) {
    const breakdown = team.players.map((playerId) => {
      const result = resultMap.get(String(playerId)) || {
        kills: 0,
        placement: 0,
        points: 0,
      };

      return {
        player: playerId,
        kills: result.kills || 0,
        placement: result.placement || 0,
        points: result.points || 0,
      };
    });

    team.resultBreakdown = breakdown;
    team.points = breakdown.reduce((sum, item) => sum + Number(item.points || 0), 0);
    await team.save({ session });
  }

  const rankedTeams = await Team.find({ contest: contestId })
    .sort({ points: -1, updatedAt: 1, createdAt: 1 })
    .session(session);
  const ranked = calculateRanks(rankedTeams);

  for (const { team, rank } of ranked) {
    team.rank = rank;
    await team.save({ session });
  }

  return rankedTeams.length;
};

const savePlayerResultCore = async ({ contestId, playerId, kills, placement, adminId, ip = '', session = null }) => {
  if (!isValidObjectId(contestId) || !isValidObjectId(playerId)) {
    throw new AppError('Valid contest and player are required', 400);
  }

  const validation = validateResultInput({ kills, placement });
  if (!validation.valid) {
    throw new AppError(validation.message, 400);
  }

  const [contest, player] = await Promise.all([
    Contest.findById(contestId).session(session),
    Player.findById(playerId).session(session).lean(),
  ]);

  if (!contest) throw new AppError('Contest not found', 404);
  if (!player) throw new AppError('Player not found', 404);
  if (contest.status === 'completed' || contest.resultDeclared) {
    throw new AppError('Completed contest results are locked', 409);
  }
  if (contest.status === 'cancelled') {
    throw new AppError('Cancelled contest cannot accept results', 400);
  }

  const contestPlayerIds = new Set((contest.contestPlayers || []).map(String));

  if (contestPlayerIds.size === 0) {
    throw new AppError('Contest players are not configured', 400);
  }

  if (!contestPlayerIds.has(String(playerId))) {
    throw new AppError('Player does not belong to this contest', 400);
  }

  const existing = await ContestResult.findOne({
    contest: contestId,
    'playerResults.player': playerId,
  }).session(session);

  if (existing) {
    throw new AppError('Result already entered for this player', 409);
  }

  const points = calculatePlayerPoints(validation);

  try {
    await ContestResult.updateOne(
      { contest: contestId },
      {
        $setOnInsert: {
          contest: contestId,
          declaredBy: adminId,
        },
      },
      {
        session,
        upsert: true,
      }
    );
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }
  }

  const resultDoc = await ContestResult.findOneAndUpdate(
    {
      contest: contestId,
      'playerResults.player': { $ne: playerId },
    },
    {
      $push: {
        playerResults: {
          player: playerId,
          kills: validation.kills,
          placement: validation.placement,
          points,
        },
      },
    },
    {
      returnDocument: 'after',
      session,
    }
  );

  if (!resultDoc) {
    throw new AppError('Result already entered for this player', 409);
  }

  const updatedTeams = await recalculateTeams({ contestId, session });

  await AdminAudit.create(
    [
      {
        admin: adminId,
        action: 'PLAYER_RESULT_SAVED',
        targetType: 'Contest',
        targetId: contestId,
        metadata: {
          player: playerId,
          kills: validation.kills,
          placement: validation.placement,
          points,
        },
        ip,
      },
    ],
    { session }
  );

  return {
    contest,
    result: resultDoc.playerResults.find((item) => String(item.player) === String(playerId)),
    updatedTeams,
  };
};

const savePlayerResult = async (payload) => {
  const result = await withMongoTransaction(
    (session) => savePlayerResultCore({ ...payload, session }),
    {
      fallback: () => savePlayerResultCore(payload),
      name: 'save_player_result',
    }
  );

  await cache.del(`leaderboard:${payload.contestId}`);
  const leaderboard = await getLeaderboard(payload.contestId, null, { force: true });
  emitLeaderboardUpdate(payload.contestId, leaderboard);
  emitResultDeclared(payload.contestId);

  return {
    message: 'Player result saved',
    result: result.result,
    updatedTeams: result.updatedTeams,
    leaderboard,
  };
};

const distributePayouts = async ({ contest, adminId, session = null }) => {
  if (contest.payoutsDistributed) {
    return [];
  }

  const rankedTeams = await Team.find({ contest: contest._id })
    .sort({ points: -1, updatedAt: 1, createdAt: 1 })
    .session(session);
  const winnings = calculatePrizeDistribution({
    prizePool: contest.prizePool,
    winnerCount: rankedTeams.length,
  });
  const winningsMap = new Map(winnings.map((item) => [Number(item.rank), Number(item.amount || 0)]));
  const ranked = calculateRanks(rankedTeams);
  const payouts = [];

  contest.winnings = winnings;

  for (let index = 0; index < ranked.length; index += 1) {
    const { rank } = ranked[index];
    const tied = [];
    let cursor = index;

    while (cursor < ranked.length && ranked[cursor].rank === rank) {
      tied.push(ranked[cursor]);
      cursor += 1;
    }

    const prizeForOccupiedRanks = tied.reduce(
      (sum, _, tieIndex) => sum + Number(winningsMap.get(index + tieIndex + 1) || 0),
      0
    );
    const tieAmounts = splitTieAmount(prizeForOccupiedRanks, tied.length);

    for (const [tieIndex, item] of tied.entries()) {
      const { team } = item;
      const amount = tieAmounts[tieIndex] || 0;
      team.rank = rank;
      team.winnings = amount;
      await team.save({ session });

      if (amount <= 0) {
        continue;
      }

      const payoutKey = `payout:${contest._id}:team:${team._id}`;
      const existing = await Transaction.findOne({ idempotencyKey: payoutKey }).session(session).lean();

      if (existing) {
        continue;
      }

      await creditCoins({
        userId: team.user,
        amount,
        reason: `Contest winnings rank ${rank}: ${contest.title}`,
        contest: contest._id,
        team: team._id,
        idempotencyKey: payoutKey,
        metadata: {
          contestTitle: contest.title,
          rank,
          prizePool: contest.prizePool,
          platformCommissionAmount: contest.platformCommissionAmount,
        },
        session,
      });

      payouts.push({
        user: team.user,
        team: team._id,
        amount,
        rank,
      });
    }

    index = cursor - 1;
  }

  await ContestResult.findOneAndUpdate(
    { contest: contest._id },
    {
      $set: {
        payoutDistributed: true,
        payoutDistributedAt: new Date(),
        payouts,
      },
      $setOnInsert: {
        contest: contest._id,
        declaredBy: adminId,
      },
    },
    { upsert: true, session }
  );

  contest.payoutsDistributed = true;
  contest.payoutsDistributedAt = new Date();
  await contest.save({ session });

  await AdminAudit.create(
    [
      {
        admin: adminId,
        action: 'PAYOUTS_DISTRIBUTED',
        targetType: 'Contest',
        targetId: contest._id,
        metadata: {
          payoutCount: payouts.length,
          totalAmount: payouts.reduce((sum, payout) => sum + Number(payout.amount || 0), 0),
          prizePool: contest.prizePool,
          platformCommissionAmount: contest.platformCommissionAmount,
        },
      },
    ],
    { session }
  );

  return payouts;
};

const completeContestCore = async ({ contestId, adminId, ip = '', session = null }) => {
  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  const contest = await Contest.findById(contestId).session(session);
  if (!contest) throw new AppError('Contest not found', 404);
  if (contest.status === 'completed') throw new AppError('Contest already completed', 409);
  if (contest.status === 'cancelled') throw new AppError('Cancelled contest cannot be completed', 400);
  if ((contest.contestPlayers || []).length === 0) {
    throw new AppError('Contest players are not configured', 400);
  }

  await recalculateTeams({ contestId, session });

  contest.status = 'completed';
  contest.endTime = new Date();
  contest.endsAt = contest.endTime;
  contest.timeLeft = '00:00:00';
  contest.resultDeclared = true;
  contest.resultDeclaredAt = contest.resultDeclaredAt || new Date();
  contest.resultLockedBy = adminId;

  const payouts = await distributePayouts({ contest, adminId, session });

  await AdminAudit.create(
    [
      {
        admin: adminId,
        action: 'CONTEST_COMPLETED',
        targetType: 'Contest',
        targetId: contest._id,
        metadata: {
          payoutCount: payouts.length,
        },
        ip,
      },
    ],
    { session }
  );

  return {
    contest,
    payouts,
  };
};

const completeContestWithResultsCore = async ({ contestId, playerResults = [], adminId, ip = '', session = null }) => {
  if (!Array.isArray(playerResults) || playerResults.length === 0) {
    throw new AppError('Player results are required', 400);
  }

  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  const contest = await Contest.findById(contestId).session(session);
  if (!contest) throw new AppError('Contest not found', 404);
  if (contest.status === 'completed' || contest.resultDeclared) {
    throw new AppError('Contest already completed', 409);
  }
  if (contest.status === 'cancelled') {
    throw new AppError('Cancelled contest cannot be completed', 400);
  }
  if (getEffectiveContestStatus(contest) !== 'live') {
    throw new AppError('Contest is not live yet', 400);
  }

  const contestPlayerIds = (contest.contestPlayers || []).map(String);
  const contestPlayerSet = new Set(contestPlayerIds);

  if (contestPlayerSet.size === 0) {
    throw new AppError('Contest players are not configured', 400);
  }

  const normalizedResults = playerResults.map((result) => ({
    player: String(result.playerId || result.player || ''),
    kills: result.kills,
    placement: result.placement,
  }));
  const resultPlayerSet = new Set(normalizedResults.map((result) => result.player));

  if (
    resultPlayerSet.size !== normalizedResults.length ||
    resultPlayerSet.size !== contestPlayerSet.size ||
    normalizedResults.some((result) => !contestPlayerSet.has(result.player))
  ) {
    throw new AppError('Enter one valid result for every contest player', 400);
  }

  const playerLines = normalizedResults.map((result) => {
    const validation = validateResultInput(result);

    if (!validation.valid) {
      throw new AppError(validation.message, 400);
    }

    return {
      player: result.player,
      kills: validation.kills,
      placement: validation.placement,
      points: calculatePlayerPoints(validation),
    };
  });

  const existing = await ContestResult.findOne({ contest: contestId }).session(session);

  if (existing?.playerResults?.length) {
    throw new AppError('Results already entered for this contest', 409);
  }

  await ContestResult.findOneAndUpdate(
    { contest: contestId },
    {
      $set: {
        contest: contestId,
        declaredBy: adminId,
        playerResults: playerLines,
      },
    },
    { upsert: true, session }
  );

  await recalculateTeams({ contestId, session });

  contest.status = 'completed';
  contest.endTime = new Date();
  contest.endsAt = contest.endTime;
  contest.timeLeft = '00:00:00';
  contest.resultDeclared = true;
  contest.resultDeclaredAt = contest.resultDeclaredAt || new Date();
  contest.resultLockedBy = adminId;

  const payouts = await distributePayouts({ contest, adminId, session });

  await AdminAudit.create(
    [
      {
        admin: adminId,
        action: 'MATCH_RESULTS_COMPLETED',
        targetType: 'Contest',
        targetId: contest._id,
        metadata: {
          playerResults: playerLines.length,
          payoutCount: payouts.length,
          prizePool: contest.prizePool,
          platformCommissionAmount: contest.platformCommissionAmount,
        },
        ip,
      },
    ],
    { session }
  );

  return {
    contest,
    payouts,
  };
};

const completeContest = async (payload) => {
  const result = await withMongoTransaction(
    (session) => completeContestCore({ ...payload, session }),
    {
      fallback: () => completeContestCore(payload),
      name: 'complete_contest',
    }
  );

  await cache.del('contests:list', `leaderboard:${payload.contestId}`);
  await cache.setActiveMatchState(payload.contestId, {
    status: 'completed',
    resultDeclaredAt: new Date().toISOString(),
  });
  const leaderboard = await getLeaderboard(payload.contestId, null, { force: true });

  emitContestUpdate(normalizeContest(result.contest));
  emitLeaderboardUpdate(payload.contestId, leaderboard);
  emitResultDeclared(payload.contestId);

  return {
    message: 'Contest completed',
    contest: normalizeContest(result.contest),
    payouts: result.payouts,
    leaderboard,
  };
};

const processResults = async (payload) => {
  const result = await withMongoTransaction(
    (session) => completeContestWithResultsCore({ ...payload, session }),
    {
      fallback: () => completeContestWithResultsCore(payload),
      name: 'complete_contest_with_results',
    }
  );

  await cache.del('contests:list', `leaderboard:${payload.contestId}`);
  await cache.setActiveMatchState(payload.contestId, {
    status: 'completed',
    resultDeclaredAt: new Date().toISOString(),
  });
  const leaderboard = await getLeaderboard(payload.contestId, null, { force: true });

  emitContestUpdate(normalizeContest(result.contest));
  emitLeaderboardUpdate(payload.contestId, leaderboard);
  emitResultDeclared(payload.contestId);

  return {
    message: 'Contest completed',
    contest: normalizeContest(result.contest),
    payouts: result.payouts,
    leaderboard,
  };
};

module.exports = {
  completeContest,
  processResults,
  savePlayerResult,
};
