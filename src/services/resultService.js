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
const { calculatePlayerPoints, calculateTeamContestPoints, calculateTeamContestPointsDirect, getPlacementPoints, validateResultInput } = require('./pointService');
const { calculatePrizeDistribution } = require('./prizeService');
const { creditWinningCoins } = require('./walletService');
const { withMongoTransaction } = require('../utils/transactions');
const { getEffectiveContestStatus, isValidObjectId, normalizeContest } = require('../utils/helpers');

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
  const [resultDoc, contest] = await Promise.all([
    ContestResult.findOne({ contest: contestId }).session(session).lean(),
    Contest.findById(contestId).session(session).lean(),
  ]);

  const resultMap = new Map(
    (resultDoc?.playerResults || []).map((result) => [String(result.player), result])
  );
  const isTeamContest = contest?.contestType === 'team';
  const teams = await Team.find({ contest: contestId }).session(session);

  // For team contests we need player→teamName mapping
  let playerTeamMap = new Map();
  if (isTeamContest && resultDoc?.playerResults?.length) {
    const playerIds = resultDoc.playerResults.map((r) => r.player);
    const playerDocs = await Player.find({ _id: { $in: playerIds } }).select('_id team').session(session).lean();
    playerTeamMap = new Map(playerDocs.map((p) => [String(p._id), String(p.team || '').trim()]));
  }

  for (const team of teams) {
    if (isTeamContest) {
      // Build enriched result list with team names for scoring
      const enrichedResults = (resultDoc?.playerResults || []).map((result) => ({
        ...result,
        team: playerTeamMap.get(String(result.player)) || '',
      }));

      team.resultBreakdown = [];
      team.points = calculateTeamContestPoints({
        playerResults: enrichedResults,
        selectedTeams: team.selectedTeams || [],
        captainTeam: team.captainTeam || '',
        viceCaptainTeam: team.viceCaptainTeam || '',
      });
    } else {
      const breakdown = team.players.map((playerId) => {
        const result = resultMap.get(String(playerId)) || {
          kills: 0,
          placement: 0,
          points: 0,
          active: false,
        };

        return {
          player: playerId,
          kills: result.kills || 0,
          placement: result.placement || 0,
          points: result.points || 0,
          active: result.active !== false && resultMap.has(String(playerId)),
        };
      });

      team.resultBreakdown = breakdown;
      team.points = breakdown.reduce((sum, item) => sum + (item.active ? Number(item.points || 0) : 0), 0);
    }

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
          active: true,
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
    prizePool: contest.totalCollection,
    winnerCount: rankedTeams.length,
  });
  const winningsMap = new Map(winnings.map((item) => [Number(item.rank), Number(item.amount || 0)]));
  const ranked = calculateRanks(rankedTeams);
  const payouts = [];

  contest.winnings = winnings;
  contest.prizePool = Number(contest.totalCollection || 0);

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

      await creditWinningCoins({
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

  const totalPayout = payouts.reduce((sum, payout) => sum + Number(payout.amount || 0), 0);
  if (totalPayout > Number(contest.totalCollection || 0)) {
    throw new AppError('Payout amount exceeds total collected amount', 500);
  }

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
          totalAmount: totalPayout,
          prizePool: contest.totalCollection,
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

const completeContestWithResultsCore = async ({
  contestId,
  playerResults = [],
  adminId,
  ip = '',
  matchName = '',
  tournamentName = '',
  matchIdentifier = '',
  matchDateTime = null,
  session = null,
}) => {
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

  const inputResults = playerResults.map((result) => ({
    player: String(result.playerId || result.player || ''),
    kills: result.kills,
    placement: result.placement,
  }));
  const resultPlayerSet = new Set(inputResults.map((result) => result.player));

  if (
    resultPlayerSet.size !== inputResults.length ||
    inputResults.some((result) => !contestPlayerSet.has(result.player))
  ) {
    throw new AppError('Enter one valid result for each active contest player', 400);
  }

  const contestPlayerDocs = await Player.find({ _id: { $in: contestPlayerIds } })
    .select('_id team')
    .session(session)
    .lean();
  const playerTeamById = new Map(contestPlayerDocs.map((player) => [String(player._id), String(player.team || '')]));
  const resultByPlayer = new Map(inputResults.map((result) => [result.player, result]));

  inputResults.forEach((result) => {
    const teamName = playerTeamById.get(result.player);
    if (!teamName) return;

    contestPlayerDocs
      .filter((player) => String(player.team || '') === teamName)
      .forEach((player) => {
        const playerId = String(player._id);
        if (!resultByPlayer.has(playerId)) {
          resultByPlayer.set(playerId, {
            player: playerId,
            kills: 0,
            placement: result.placement,
          });
        }
      });
  });

  const normalizedResults = [...resultByPlayer.values()];

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
      active: true,
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
        matchName: matchName || contest.matchName || contest.title,
        tournamentName: tournamentName || contest.tournamentName || '',
        matchIdentifier: matchIdentifier || contest.matchIdentifier || '',
        matchDateTime: matchDateTime || contest.matchDateTime || contest.startTime || contest.startsAt,
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
  contest.matchName = matchName || contest.matchName;
  contest.tournamentName = tournamentName || contest.tournamentName;
  contest.matchIdentifier = matchIdentifier || contest.matchIdentifier;
  contest.matchDateTime = matchDateTime || contest.matchDateTime;

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

  await cache.delContestLists(`leaderboard:${payload.contestId}`);
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

  await cache.delContestLists(`leaderboard:${payload.contestId}`);
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

// ─── Team Contest Direct Results ────────────────────────────────────────────

/**
 * Recalculate all team entries using stored teamResults (direct team-level scoring).
 * Called inside a transaction after teamResults are saved to ContestResult.
 */
const recalculateTeamsFromTeamResults = async ({ contestId, teamResultLines, session = null }) => {
  const teams = await Team.find({ contest: contestId }).session(session);

  // Build a map of teamName → points from the stored team result lines
  const teamPointsMap = new Map(
    teamResultLines.map((r) => [String(r.teamName || '').trim(), Number(r.points || 0)])
  );
  const teamResultsMap = new Map(
    teamResultLines.map((result) => [String(result.teamName || '').trim(), result])
  );

  for (const team of teams) {
    team.resultBreakdown = [];
    team.teamResultBreakdown = (team.selectedTeams || []).map((selectedTeam) => {
      const teamName = String(selectedTeam || '').trim();
      const result = teamResultsMap.get(teamName) || {};
      const points = Number(teamPointsMap.get(teamName) || 0);
      let multiplier = 1;

      if (teamName === String(team.captainTeam || '').trim()) multiplier = 2;
      if (teamName === String(team.viceCaptainTeam || '').trim()) multiplier = 1.5;

      return {
        teamName,
        finishPoints: Number(result.finishPoints ?? result.totalKills ?? 0),
        positionPoints: Number(result.positionPoints ?? 0),
        points,
        multiplier,
        totalPoints: Math.round(points * multiplier * 100) / 100,
      };
    });
    team.points = calculateTeamContestPointsDirect({
      teamResults: teamResultLines,
      selectedTeams: team.selectedTeams || [],
      captainTeam: team.captainTeam || '',
      viceCaptainTeam: team.viceCaptainTeam || '',
    });
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

/**
 * Core transaction body for processing team-contest results via direct team stats.
 * teamResults: [{ teamName, position, totalKills }]
 */
const completeTeamContestWithResultsCore = async ({
  contestId,
  teamResults = [],
  adminId,
  ip = '',
  matchName = '',
  tournamentName = '',
  matchIdentifier = '',
  matchDateTime = null,
  session = null,
}) => {
  if (!Array.isArray(teamResults) || teamResults.length === 0) {
    throw new AppError('Team results are required', 400);
  }

  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  const contest = await Contest.findById(contestId).session(session);
  if (!contest) throw new AppError('Contest not found', 404);
  if (contest.contestType !== 'team') {
    throw new AppError('This endpoint is only for team contests', 400);
  }
  if (contest.status === 'completed' || contest.resultDeclared) {
    throw new AppError('Contest already completed', 409);
  }
  if (contest.status === 'cancelled') {
    throw new AppError('Cancelled contest cannot be completed', 400);
  }
  if (getEffectiveContestStatus(contest) !== 'live') {
    throw new AppError('Contest is not live yet', 400);
  }

  const contestTeamSet = new Set((contest.contestTeams || []).map((t) => String(t).trim()));
  if (contestTeamSet.size === 0) {
    throw new AppError('Contest teams are not configured', 400);
  }

  // Validate each team result entry
  const seenTeams = new Set();
  const teamResultLines = teamResults.map((r) => {
    const teamName = String(r.teamName || '').trim();
    const position = Number(r.position);
    const totalKills = Number(r.totalKills);

    if (!teamName) throw new AppError('Each team result must have a teamName', 400);
    if (!contestTeamSet.has(teamName)) throw new AppError(`Team "${teamName}" is not part of this contest`, 400);
    if (seenTeams.has(teamName)) throw new AppError(`Duplicate result for team "${teamName}"`, 400);
    if (!Number.isInteger(position) || position < 1) throw new AppError(`Position for "${teamName}" must be a positive integer`, 400);
    if (!Number.isInteger(totalKills) || totalKills < 0) throw new AppError(`Total kills for "${teamName}" must be a non-negative integer`, 400);

    seenTeams.add(teamName);

    // Points formula: kills * 4 + placement points (same scale as player scoring)
    const points = totalKills * 4 + (getPlacementPoints(position));

    return { teamName, position, totalKills, points };
  });

  const existing = await ContestResult.findOne({ contest: contestId }).session(session);
  if (existing?.teamResults?.length) {
    throw new AppError('Team results already entered for this contest', 409);
  }

  await ContestResult.findOneAndUpdate(
    { contest: contestId },
    {
      $set: {
        contest: contestId,
        declaredBy: adminId,
        teamResults: teamResultLines,
        matchName: matchName || contest.matchName || contest.title,
        tournamentName: tournamentName || contest.tournamentName || '',
        matchIdentifier: matchIdentifier || contest.matchIdentifier || '',
        matchDateTime: matchDateTime || contest.matchDateTime || contest.startTime || contest.startsAt,
      },
    },
    { upsert: true, session }
  );

  await recalculateTeamsFromTeamResults({ contestId, teamResultLines, session });

  contest.status = 'completed';
  contest.endTime = new Date();
  contest.endsAt = contest.endTime;
  contest.timeLeft = '00:00:00';
  contest.resultDeclared = true;
  contest.resultDeclaredAt = contest.resultDeclaredAt || new Date();
  contest.resultLockedBy = adminId;
  contest.matchName = matchName || contest.matchName;
  contest.tournamentName = tournamentName || contest.tournamentName;
  contest.matchIdentifier = matchIdentifier || contest.matchIdentifier;
  contest.matchDateTime = matchDateTime || contest.matchDateTime;

  const payouts = await distributePayouts({ contest, adminId, session });

  await AdminAudit.create(
    [
      {
        admin: adminId,
        action: 'TEAM_MATCH_RESULTS_COMPLETED',
        targetType: 'Contest',
        targetId: contest._id,
        metadata: {
          teamResults: teamResultLines.length,
          payoutCount: payouts.length,
          prizePool: contest.prizePool,
        },
        ip,
      },
    ],
    { session }
  );

  return { contest, payouts };
};

const completeTeamContestFromMatchCore = async ({
  contestId,
  match,
  teamResults = [],
  session = null,
}) => {
  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  if (!Array.isArray(teamResults) || teamResults.length === 0) {
    throw new AppError('Match team results are required', 400);
  }

  const contest = await Contest.findById(contestId).session(session);
  if (!contest) throw new AppError('Contest not found', 404);
  if (contest.contestType !== 'team') {
    throw new AppError('Automatic match processing supports team contests only', 400);
  }
  if (contest.status === 'completed' || contest.resultDeclared || contest.payoutsDistributed) {
    return { contest, payouts: [], skipped: true };
  }
  if (contest.status === 'cancelled') {
    throw new AppError('Cancelled contest cannot be completed', 400);
  }

  const contestTeamSet = new Set((contest.contestTeams || []).map((teamName) => String(teamName).trim()).filter(Boolean));
  if (contestTeamSet.size === 0) {
    throw new AppError('Contest teams are not configured', 400);
  }

  const seenTeams = new Set();
  const teamResultLines = teamResults
    .map((result) => {
      const teamName = String(result.teamName || '').trim();
      const placement = Number(result.placement);
      const finishPoints = Number(result.finishPoints || 0);
      const positionPoints = Number(result.positionPoints || 0);
      const totalPoints = Number(result.totalPoints ?? finishPoints + positionPoints);

      if (!teamName || !contestTeamSet.has(teamName) || seenTeams.has(teamName)) {
        return null;
      }

      seenTeams.add(teamName);

      return {
        teamName,
        position: Number.isInteger(placement) && placement > 0 ? placement : 1,
        totalKills: finishPoints,
        finishPoints,
        positionPoints,
        totalPoints,
        points: totalPoints,
      };
    })
    .filter(Boolean);

  if (teamResultLines.length === 0) {
    throw new AppError('No match teams belong to this contest', 400);
  }

  const existing = await ContestResult.findOne({ contest: contestId }).session(session);
  if (existing?.payoutDistributed || existing?.teamResults?.length) {
    return { contest, payouts: [], skipped: true };
  }

  await ContestResult.findOneAndUpdate(
    { contest: contestId },
    {
      $set: {
        contest: contestId,
        declaredBy: contest.resultLockedBy || contest.participants[0] || contest._id,
        teamResults: teamResultLines,
        matchName: contest.matchName || `Match ${match.matchNo}`,
        tournamentName: contest.tournamentName || '',
        matchIdentifier: contest.matchIdentifier || `match-${match.matchNo}`,
        matchDateTime: contest.matchDateTime || contest.startTime || contest.startsAt,
      },
    },
    { upsert: true, session }
  );

  await recalculateTeamsFromTeamResults({ contestId, teamResultLines, session });

  contest.status = 'completed';
  contest.endTime = new Date();
  contest.endsAt = contest.endTime;
  contest.timeLeft = '00:00:00';
  contest.resultDeclared = true;
  contest.resultDeclaredAt = contest.resultDeclaredAt || new Date();
  contest.matchName = contest.matchName || `Match ${match.matchNo}`;
  contest.matchIdentifier = contest.matchIdentifier || `match-${match.matchNo}`;
  contest.matchNo = contest.matchNo || match.matchNo;
  contest.tournamentId = contest.tournamentId || match.tournamentId;

  const payouts = await distributePayouts({ contest, adminId: contest.resultLockedBy || contest.participants[0] || contest._id, session });

  return { contest, payouts };
};

const processTeamResults = async (payload) => {
  const result = await withMongoTransaction(
    (session) => completeTeamContestWithResultsCore({ ...payload, session }),
    {
      fallback: () => completeTeamContestWithResultsCore(payload),
      name: 'complete_team_contest_with_results',
    }
  );

  await cache.delContestLists(`leaderboard:${payload.contestId}`);
  await cache.setActiveMatchState(payload.contestId, {
    status: 'completed',
    resultDeclaredAt: new Date().toISOString(),
  });
  const leaderboard = await getLeaderboard(payload.contestId, null, { force: true });

  emitContestUpdate(normalizeContest(result.contest));
  emitLeaderboardUpdate(payload.contestId, leaderboard);
  emitResultDeclared(payload.contestId);

  return {
    message: 'Team contest completed',
    contest: normalizeContest(result.contest),
    payouts: result.payouts,
    leaderboard,
  };
};

const completeTeamContestFromMatch = async (payload) => {
  const result = await withMongoTransaction(
    (session) => completeTeamContestFromMatchCore({ ...payload, session }),
    {
      fallback: () => completeTeamContestFromMatchCore(payload),
      name: 'complete_team_contest_from_match',
    }
  );

  await cache.delContestLists(`leaderboard:${payload.contestId}`);
  await cache.setActiveMatchState(payload.contestId, {
    status: 'completed',
    resultDeclaredAt: new Date().toISOString(),
  });
  const leaderboard = await getLeaderboard(payload.contestId, null, { force: true });

  emitContestUpdate(normalizeContest(result.contest));
  emitLeaderboardUpdate(payload.contestId, leaderboard);
  emitResultDeclared(payload.contestId);

  return {
    message: result.skipped ? 'Contest already completed' : 'Contest completed',
    contest: normalizeContest(result.contest),
    payouts: result.payouts,
    leaderboard,
    skipped: Boolean(result.skipped),
  };
};

module.exports = {
  completeTeamContestFromMatch,
  completeContest,
  processResults,
  processTeamResults,
  restartResultProcessing: async (payload) => {
    const result = await withMongoTransaction(
      async (session) => {
        const contest = await Contest.findById(payload.contestId).session(session);
        if (!contest) throw new AppError('Contest not found', 404);
        if (contest.payoutsDistributed) {
          throw new AppError('Paid contests cannot restart result processing', 409);
        }

        await ContestResult.deleteOne({ contest: payload.contestId }).session(session);
        await Team.updateMany(
          { contest: payload.contestId },
          { $set: { points: 0, rank: null, winnings: 0, resultBreakdown: [], teamResultBreakdown: [] } },
          { session }
        );

        contest.status = 'live';
        contest.resultDeclared = false;
        contest.resultDeclaredAt = null;
        contest.resultLockedBy = null;
        await contest.save({ session });

        await AdminAudit.create(
          [
            {
              admin: payload.adminId,
              action: 'RESULT_PROCESSING_RESTARTED',
              targetType: 'Contest',
              targetId: contest._id,
              metadata: {},
              ip: payload.ip,
            },
          ],
          { session }
        );

        return contest;
      },
      {
        fallback: async () => {
          throw new AppError('Restart result processing requires MongoDB transaction support', 500);
        },
        name: 'restart_result_processing',
      }
    );

    await cache.delContestLists(`leaderboard:${payload.contestId}`);
    const leaderboard = await getLeaderboard(payload.contestId, null, { force: true });
    emitContestUpdate(normalizeContest(result));
    emitLeaderboardUpdate(payload.contestId, leaderboard);

    return {
      message: 'Result processing restarted',
      contest: normalizeContest(result),
      leaderboard,
    };
  },
  savePlayerResult,
};
