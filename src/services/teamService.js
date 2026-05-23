const Contest = require('../models/Contest');
const Player = require('../models/Player');
const Team = require('../models/Team');
const { AppError } = require('../middlewares/errorMiddleware');
const cache = require('./cacheService');
const { emitLeaderboardUpdate } = require('./realtimeService');
const { getLeaderboard } = require('./leaderboardService');
const { withMongoTransaction } = require('../utils/transactions');
const { getEffectiveContestStatus, isValidObjectId } = require('../utils/helpers');

const MAX_PLAYERS = 8;
const MAX_CREDITS = 75;

const createTeamCore = async ({ userId, contestId, players, session = null }) => {
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

  const isParticipant = (contest.participants || []).some(
    (participant) => String(participant) === String(userId)
  );

  if (!isParticipant) {
    throw new AppError('Join the contest before creating a team', 400);
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

module.exports = {
  MAX_CREDITS,
  MAX_PLAYERS,
  createTeam,
};
