const Match = require('../../models/Match');
const Tournament = require('../../models/Tournament');
const { AppError } = require('../../middlewares/errorMiddleware');
const discoverMatches = require('../discovery/discoverMatches');
const parseMatch = require('../parsers/matchParser');
const fetchHTML = require('../providers/16score/fetch');
const { SIXTEEN_SCORE_ORIGIN } = require('../providers/16score/urls');

function validate16ScoreUrl(value, fieldName) {
  if (!value || typeof value !== 'string') {
    throw new AppError(`${fieldName} is required`, 400);
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch (error) {
    throw new AppError(`Invalid ${fieldName}`, 400);
  }

  if (parsedUrl.origin !== SIXTEEN_SCORE_ORIGIN) {
    throw new AppError(`${fieldName} must belong to 16Score`, 400);
  }

  return parsedUrl.toString();
}

function getTournamentMatchesUrl(tournament) {
  return tournament.matchesUrl || tournament.sourceUrl;
}

function normalizeTeams(teams = []) {
  if (!Array.isArray(teams)) return [];

  return teams.map((team) => ({
    placement: Number(team.placement) || null,
    teamName: String(team.teamName || '').trim(),
    finishPoints: Number(team.finishPoints) || 0,
    positionPoints: Number(team.positionPoints) || 0,
    totalPoints: Number(team.totalPoints) || 0,
  }));
}

async function syncMatch({ tournamentId, discoveredMatch }) {
  const matchUrl = validate16ScoreUrl(discoveredMatch.url, 'Match URL');
  const html = await fetchHTML(matchUrl);

  if (!html) {
    throw new AppError('Failed to fetch match HTML', 502);
  }

  const parsed = parseMatch(html);
  const matchNo = Number(parsed.matchNo || discoveredMatch.matchNo);

  if (!matchNo) {
    throw new AppError('Parsed match number is missing', 422);
  }

  const teams = normalizeTeams(parsed.teams);
  const now = new Date();

  await Match.findOneAndUpdate(
    {
      tournamentId,
      matchNo,
    },
    {
      $set: {
        tournamentId,
        matchNo,
        url: matchUrl,
        map: parsed.map || '',
        status: parsed.status || discoveredMatch.status || 'pending',
        teams,
        processed: teams.length > 0,
        lastSyncedAt: now,
      },
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function syncTournament(tournament) {
  if (!tournament?._id) {
    throw new AppError('Tournament is required', 400);
  }

  const matchesUrl = validate16ScoreUrl(getTournamentMatchesUrl(tournament), 'Tournament Matches URL');
  const discoveredMatches = await discoverMatches(matchesUrl);
  const summary = {
    discovered: Array.isArray(discoveredMatches) ? discoveredMatches.length : 0,
    synced: 0,
    failed: 0,
  };

  for (const discoveredMatch of discoveredMatches || []) {
    try {
      await syncMatch({
        tournamentId: tournament._id,
        discoveredMatch,
      });
      summary.synced += 1;
    } catch (error) {
      summary.failed += 1;
    }
  }

  await Tournament.findByIdAndUpdate(tournament._id, {
    $set: {
      matchesUrl,
      lastSyncedAt: new Date(),
      lastSyncSummary: summary,
    },
  });

  return summary;
}

module.exports = syncTournament;
