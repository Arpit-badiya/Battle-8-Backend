const Match = require('../../models/Match');
const logger = require('../../utils/logger');
const fetchHTML = require('../providers/16score/fetch');
const parseMatch = require('../parsers/matchParser');
const { processCompletedMatch } = require('../../services/fantasyEngineService');

const normalizeTeams = (teams = []) => {
  if (!Array.isArray(teams)) return [];

  return teams.map((team) => ({
    placement: Number(team.placement) || null,
    teamName: String(team.teamName || '').trim(),
    finishPoints: Number(team.finishPoints) || 0,
    positionPoints: Number(team.positionPoints) || 0,
    totalPoints: Number(team.totalPoints) || 0,
  }));
};

const normalizeStatus = (value, fallback = 'pending') => {
  const status = String(value || fallback).toLowerCase();

  if (['pending', 'live', 'completed'].includes(status)) {
    return status;
  }

  return fallback;
};

const isCompletedMatch = (parsed) =>
  normalizeStatus(parsed.status) === 'completed' && Array.isArray(parsed.teams) && parsed.teams.length > 0;

async function updatePendingMatch(match) {
  logger.info('Processing Match X', {
    matchId: String(match._id),
    matchNo: match.matchNo,
  });

  const html = await fetchHTML(match.url);

  if (!html) {
    throw new Error('Failed to fetch match HTML');
  }

  const parsed = parseMatch(html);
  const status = normalizeStatus(parsed.status, match.status || 'pending');
  const completed = isCompletedMatch(parsed);
  const update = {
    map: parsed.map || match.map || '',
    status: completed ? 'completed' : status,
    teams: normalizeTeams(parsed.teams),
    processed: completed,
    lastSyncedAt: new Date(),
  };

  const updatedMatch = await Match.findByIdAndUpdate(
    match._id,
    { $set: update },
    { new: true, runValidators: true }
  );

  logger.info(completed ? 'Match Completed' : 'Match Updated', {
    matchId: String(match._id),
    matchNo: match.matchNo,
    status: update.status,
  });

  if (completed && updatedMatch) {
    const engineSummary = await processCompletedMatch(updatedMatch);
    logger.info('Fantasy Engine Finished', {
      matchId: String(updatedMatch._id),
      matchNo: updatedMatch.matchNo,
      ...engineSummary,
    });
  }

  return update;
}

async function monitorPendingMatches() {
  logger.info('Scheduler Started');

  const pendingMatches = await Match.find({
    processed: false,
    status: { $in: ['pending', 'live'] },
  }).sort({ updatedAt: 1 });

  logger.info('Pending Matches Found', {
    count: pendingMatches.length,
  });

  const summary = {
    pending: pendingMatches.length,
    updated: 0,
    completed: 0,
    failed: 0,
  };

  for (const match of pendingMatches) {
    try {
      const update = await updatePendingMatch(match);
      summary.updated += 1;

      if (update.processed) {
        summary.completed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      logger.warn('Match monitor failed', {
        matchId: String(match._id),
        matchNo: match.matchNo,
        error,
      });
    }
  }

  logger.info('Scheduler Finished', summary);

  return {
    ...summary,
    lastSyncTime: new Date(),
  };
}

module.exports = {
  monitorPendingMatches,
  updatePendingMatch,
};
