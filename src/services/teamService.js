const Contest = require('../models/Contest');
const Player = require('../models/Player');
const Team = require('../models/Team');
const { AppError } = require('../middlewares/errorMiddleware');
const cache = require('./cacheService');
const { emitLeaderboardUpdate } = require('./realtimeService');
const { getLeaderboard } = require('./leaderboardService');
const { withMongoTransaction } = require('../utils/transactions');
const { getEffectiveContestStatus, isValidObjectId } = require('../utils/helpers');

const MAX_PLAYERS = 5;
const MAX_CREDITS = 75;

const createTeamCore = async ({ userId, contestId, players, captain, viceCaptain, session = null }) => {
  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  if (!Array.isArray(players)) {
    throw new AppError('Players are required', 400);
  }

  const playerIds = [...new Set(players.map(String))].filter(isValidObjectId);

  if (playerIds.length !== MAX_PLAYERS || playerIds.length !== players.length) {
    throw new AppError(`Select exactly ${MAX_PLAYERS} unique valid players`, 400);
  }

  const contest = await Contest.findById(contestId).session(session).lean();

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  if (getEffectiveContestStatus(contest) !== 'upcoming') {
    throw new AppError('Contest is not open for team creation', 400);
  }

  const contestPlayerIds = new Set((contest.contestPlayers || []).map(String));

  if (contestPlayerIds.size === 0) {
    throw new AppError('Contest players are not configured yet', 400);
  }

  const invalidPlayer = playerIds.some((playerId) => !contestPlayerIds.has(String(playerId)));

  if (invalidPlayer) {
    throw new AppError('Selected players must belong to this contest', 400);
  }

  const existingTeam = await Team.findOne({ user: userId, contest: contestId }).session(session).lean();

  if (existingTeam) {
    throw new AppError('Team already created for this contest', 409);
  }

  const selectedPlayers = await Player.find({
    _id: { $in: playerIds },
  }).session(session).lean();

  if (selectedPlayers.length !== MAX_PLAYERS) {
    throw new AppError('One or more selected players are unavailable', 400);
  }

  const selectedTeamNames = new Set(selectedPlayers.map((player) => String(player.team || '').trim().toLowerCase()));
  if (selectedTeamNames.size !== 1) {
    throw new AppError('Select players from one esports team only', 400);
  }

  const selectedTeamName = selectedPlayers[0]?.team || '';
  const playerIdSet = new Set(playerIds);
  const captainId = captain && playerIdSet.has(String(captain)) ? captain : null;
  const viceCaptainId = viceCaptain && playerIdSet.has(String(viceCaptain)) ? viceCaptain : null;

  if (captainId && viceCaptainId && String(captainId) === String(viceCaptainId)) {
    throw new AppError('Captain and vice-captain must be different players', 400);
  }

  const totalCredits = Number(
    selectedPlayers.reduce((sum, player) => sum + Number(player.credits || 0), 0).toFixed(1)
  );

  if (totalCredits > MAX_CREDITS) {
    throw new AppError(`Team credits cannot exceed ${MAX_CREDITS}`, 400);
  }

  try {
    const [team] = await Team.create(
      [
        {
          user: userId,
          contest: contestId,
          players: playerIds,
          selectedTeamName,
          captain: captainId,
          viceCaptain: viceCaptainId,
          totalCredits,
        },
      ],
      { session }
    );

    return team;
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError('Team already created for this contest', 409);
    }

    throw error;
  }
};

const createTeam = async (payload) => {
  const team = await withMongoTransaction(
    (session) => createTeamCore({ ...payload, session }),
    {
      fallback: () => createTeamCore(payload),
      name: 'team_create',
    }
  );

  await cache.del(`leaderboard:${payload.contestId}`);
  const leaderboard = await getLeaderboard(payload.contestId, null, { force: true });
  emitLeaderboardUpdate(payload.contestId, leaderboard);

  return team;
};

const getMyTeam = async ({ userId, contestId }) => {
  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  const team = await Team.findOne({ user: userId, contest: contestId })
    .populate('players')
    .populate('captain')
    .populate('viceCaptain')
    .lean();

  if (!team) {
    throw new AppError('Team not found for this contest', 404);
  }

  const leaderboard = await getLeaderboard(contestId, userId, { force: true });
  const rankRow = leaderboard.find((row) => String(row.teamId) === String(team._id)) || null;
  const breakdownByPlayer = new Map((team.resultBreakdown || []).map((item) => [String(item.player), item]));
  const hasProcessedResults = breakdownByPlayer.size > 0;

  return {
    ...team,
    rank: rankRow?.rank ?? team.rank,
    points: Number(team.points || 0),
    winnings: Number(team.winnings || 0),
    players: (team.players || []).map((player) => {
      const breakdown = breakdownByPlayer.get(String(player._id)) || {};
      return {
        ...player,
        points: Number(breakdown.points || 0),
        kills: Number(breakdown.kills || 0),
        placement: Number(breakdown.placement || 0),
        active: hasProcessedResults ? breakdown.active !== false && Boolean(breakdownByPlayer.has(String(player._id))) : true,
        isCaptain: String(team.captain?._id || team.captain || '') === String(player._id),
        isViceCaptain: String(team.viceCaptain?._id || team.viceCaptain || '') === String(player._id),
      };
    }),
    leaderboardRank: rankRow,
  };
};

module.exports = {
  MAX_CREDITS,
  MAX_PLAYERS,
  createTeam,
  getMyTeam,
};
