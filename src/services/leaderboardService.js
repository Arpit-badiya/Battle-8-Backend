const Team = require('../models/Team');
const { AppError } = require('../middlewares/errorMiddleware');
const cache = require('./cacheService');
const { isValidObjectId } = require('../utils/helpers');

const getLeaderboard = async (contestId, currentUserId = null, { force = false } = {}) => {
  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }

  const cacheKey = `leaderboard:${contestId}`;

  if (!force) {
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached.map((row) => ({
        ...row,
        mine: currentUserId ? String(row.userId) === String(currentUserId) : false,
      }));
    }
  }

  const teams = await Team.find({ contest: contestId })
    .populate('user', 'name email')
    .sort({ points: -1, updatedAt: 1, createdAt: 1 })
    .lean();

  let previousPoints = null;
  let previousRank = 0;

  const leaderboard = teams.map((team, index) => {
    const rank = previousPoints === team.points ? previousRank : index + 1;
    previousPoints = team.points;
    previousRank = rank;

    return {
      rank,
      teamId: team._id,
      userId: team.user?._id,
      team: team.user?.name || 'Player',
      userName: team.user?.name || 'Player',
      points: Number(team.points || 0),
      winnings: Number(team.winnings || 0),
      totalCredits: team.totalCredits,
      mine: currentUserId ? String(team.user?._id) === String(currentUserId) : false,
    };
  });

  await cache.set(cacheKey, leaderboard.map((row) => ({ ...row, mine: false })), 20);

  return leaderboard;
};

module.exports = {
  getLeaderboard,
};
