const Contest = require('../models/Contest');
const Team = require('../models/Team');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');
const cache = require('../services/cacheService');
const { applyReferralCode, getReferralStats } = require('../services/referralService');
const { validateDisplayName } = require('../utils/helpers');

const serializeUser = (user) => ({
  _id: user._id,
  id: user._id,
  email: user.email,
  name: user.name || '',
  coins: user.coins,
  winningCoins: user.winningCoins || 0,
  premium: user.premium || {},
  role: user.role,
  referralCode: user.referralCode || '',
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const getProfileStats = async (userId) => {
  const teams = await Team.find({ user: userId }).select('contest points').lean();

  const contestIds = [...new Set(teams.map((team) => String(team.contest)))];
  const completedContestIds = await Contest.find({
    _id: { $in: contestIds },
    status: 'completed',
  }).distinct('_id');
  const completedSet = new Set(completedContestIds.map(String));
  const maxPoints = await Team.aggregate([
    { $match: { contest: { $in: completedContestIds } } },
    { $group: { _id: '$contest', points: { $max: '$points' } } },
  ]);
  const maxPointsByContest = new Map(maxPoints.map((item) => [String(item._id), Number(item.points || 0)]));
  const wins = teams.filter((team) => {
    const contestId = String(team.contest);
    const points = Number(team.points || 0);
    return completedSet.has(contestId) && points > 0 && points === maxPointsByContest.get(contestId);
  }).length;

  return {
    totalContestsJoined: contestIds.length,
    totalTeamsCreated: teams.length,
    wins,
  };
};

exports.getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('_id email name coins winningCoins premium role createdAt updatedAt');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const [stats, referral] = await Promise.all([
    getProfileStats(req.user.id),
    getReferralStats(req.user.id),
  ]);

  res.json({
    user: serializeUser(user),
    stats,
    referral,
  });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const result = validateDisplayName(req.body.name);

  if (!result.valid) {
    throw new AppError(result.message, 400);
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    {
      $set: {
        name: result.name,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  ).select('_id email name coins winningCoins premium role createdAt updatedAt');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const contestIds = await Team.find({ user: req.user.id }).distinct('contest');
  await Promise.all(contestIds.map((contestId) => cache.del(`leaderboard:${contestId}`)));

  const [stats, referral] = await Promise.all([
    getProfileStats(req.user.id),
    getReferralStats(req.user.id),
  ]);

  res.json({
    message: 'Profile updated',
    user: serializeUser(user),
    stats,
    referral,
  });
});

exports.applyReferral = asyncHandler(async (req, res) => {
  await applyReferralCode({
    userId: req.user.id,
    code: req.body.code,
  });

  const referral = await getReferralStats(req.user.id);

  res.json({
    message: 'Referral applied',
    referral,
  });
});
