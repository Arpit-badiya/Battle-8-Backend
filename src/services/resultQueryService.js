const Contest = require('../models/Contest');
const ContestResult = require('../models/ContestResult');
const Team = require('../models/Team');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middlewares/errorMiddleware');
const { getLeaderboard } = require('./leaderboardService');
const { isValidObjectId, normalizeContest } = require('../utils/helpers');

const normalizeTeam = (team) => {
  if (!team) return null;

  return {
    id: team._id,
    contest: team.contest,
    selectedTeams: team.selectedTeams || [],
    captainTeam: team.captainTeam || '',
    viceCaptainTeam: team.viceCaptainTeam || '',
    fantasyScore: Number(team.points || 0),
    rank: team.rank || null,
    winningAmount: Number(team.winnings || 0),
    resultBreakdown: team.resultBreakdown || [],
    teamResultBreakdown: team.teamResultBreakdown || [],
    updatedAt: team.updatedAt,
  };
};

const normalizePayout = (payout) => ({
  user: payout.user,
  team: payout.team,
  amount: Number(payout.amount || 0),
  rank: payout.rank,
});

const normalizeResult = (result) => {
  if (!result) return null;

  return {
    id: result._id,
    contest: result.contest,
    playerResults: result.playerResults || [],
    teamResults: result.teamResults || [],
    matchName: result.matchName || '',
    tournamentName: result.tournamentName || '',
    matchIdentifier: result.matchIdentifier || '',
    matchDateTime: result.matchDateTime,
    payouts: (result.payouts || []).map(normalizePayout),
    payoutDistributed: Boolean(result.payoutDistributed),
    payoutDistributedAt: result.payoutDistributedAt,
    completedTime: result.payoutDistributedAt || result.updatedAt || result.createdAt,
  };
};

const assertValidContestId = (contestId) => {
  if (!isValidObjectId(contestId)) {
    throw new AppError('Invalid contest ID', 400);
  }
};

const getContestResult = async ({ contestId, userId }) => {
  assertValidContestId(contestId);

  const [contest, result, leaderboard, myTeam, walletCredits] = await Promise.all([
    Contest.findById(contestId).lean(),
    ContestResult.findOne({ contest: contestId }).lean(),
    getLeaderboard(contestId, userId, { force: true }),
    Team.findOne({ contest: contestId, user: userId }).lean(),
    Transaction.find({
      contest: contestId,
      user: userId,
      type: 'credit',
      'metadata.wallet': 'winning',
    }).sort({ createdAt: -1 }).lean(),
  ]);

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  return {
    contest: normalizeContest(contest),
    result: normalizeResult(result),
    leaderboard,
    myTeam: normalizeTeam(myTeam),
    walletCredits: walletCredits.map((transaction) => ({
      id: transaction._id,
      amount: Number(transaction.amount || 0),
      openingBalance: transaction.openingBalance,
      closingBalance: transaction.balanceAfter,
      reason: transaction.reason,
      timestamp: transaction.createdAt,
    })),
  };
};

const getUserContestHistory = async ({ userId }) => {
  const teams = await Team.find({ user: userId })
    .populate('contest')
    .sort({ updatedAt: -1 })
    .lean();
  const contestIds = teams
    .map((team) => team.contest?._id)
    .filter(Boolean);
  const credits = await Transaction.find({
    user: userId,
    contest: { $in: contestIds },
    type: 'credit',
    'metadata.wallet': 'winning',
  }).lean();
  const creditByContest = new Map(
    credits.map((credit) => [String(credit.contest), credit])
  );

  return teams
    .filter((team) => team.contest)
    .map((team) => {
      const contest = team.contest;
      const credit = creditByContest.get(String(contest._id));

      return {
        contest: normalizeContest(contest),
        team: normalizeTeam(team),
        rank: team.rank || null,
        fantasyScore: Number(team.points || 0),
        winningAmount: Number(team.winnings || 0),
        walletCredit: credit
          ? {
              amount: Number(credit.amount || 0),
              openingBalance: credit.openingBalance,
              closingBalance: credit.balanceAfter,
              reason: credit.reason,
              timestamp: credit.createdAt,
            }
          : null,
        completedTime: contest.payoutsDistributedAt || contest.resultDeclaredAt || contest.endTime,
      };
    });
};

const getAdminContestResult = async ({ contestId }) => {
  assertValidContestId(contestId);

  const [contest, result, leaderboard, participants] = await Promise.all([
    Contest.findById(contestId).lean(),
    ContestResult.findOne({ contest: contestId }).lean(),
    getLeaderboard(contestId, null, { force: true }),
    Team.find({ contest: contestId })
      .populate('user', 'name email')
      .sort({ rank: 1, points: -1 })
      .lean(),
  ]);

  if (!contest) {
    throw new AppError('Contest not found', 404);
  }

  return {
    contest: normalizeContest(contest),
    result: normalizeResult(result),
    participants: participants.length,
    leaderboard,
    prizeDistribution: contest.winnings || [],
    completedTime:
      contest.payoutsDistributedAt ||
      contest.resultDeclaredAt ||
      result?.payoutDistributedAt ||
      contest.endTime,
  };
};

module.exports = {
  getAdminContestResult,
  getContestResult,
  getUserContestHistory,
};
