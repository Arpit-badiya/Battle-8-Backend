const Contest = require('../models/Contest');
const Tournament = require('../models/Tournament');
const logger = require('../utils/logger');
const resultService = require('./resultService');

const getMatchIdentifierVariants = (matchNo) => {
  const value = String(matchNo || '').trim();

  if (!value) return [];

  return [
    value,
    `match-${value}`,
    `Match ${value}`,
    `MATCH-${value}`,
  ];
};

const buildContestQuery = async (match) => {
  const variants = getMatchIdentifierVariants(match.matchNo);
  const tournament = match.tournamentId
    ? await Tournament.findById(match.tournamentId).select('name').lean()
    : null;
  const or = [
    {
      tournamentId: match.tournamentId,
      matchNo: match.matchNo,
    },
    {
      tournamentId: match.tournamentId,
      matchIdentifier: { $in: variants },
    },
    {
      matchIdentifier: { $in: variants },
    },
  ];

  if (tournament?.name) {
    or.push({
      tournamentName: tournament.name,
      matchIdentifier: { $in: variants },
    });
  }

  return {
    contestType: 'team',
    status: { $in: ['live', 'upcoming'] },
    resultDeclared: false,
    payoutsDistributed: false,
    $or: or,
  };
};

async function processCompletedMatch(match) {
  if (!match?.processed || String(match.status || '').toLowerCase() !== 'completed') {
    return {
      contestsFound: 0,
      processed: 0,
      failed: 0,
    };
  }

  const query = await buildContestQuery(match);
  const contests = await Contest.find(query).select('_id title').lean();
  const summary = {
    contestsFound: contests.length,
    processed: 0,
    failed: 0,
  };

  for (const contest of contests) {
    try {
      await resultService.completeTeamContestFromMatch({
        contestId: contest._id,
        match,
        teamResults: match.teams || [],
      });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      logger.warn('Fantasy engine contest failed', {
        contestId: String(contest._id),
        matchId: String(match._id),
        matchNo: match.matchNo,
        error,
      });
    }
  }

  return summary;
}

module.exports = {
  processCompletedMatch,
};
