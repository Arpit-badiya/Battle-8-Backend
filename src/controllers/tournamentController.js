const Tournament = require('../models/Tournament');
const Match = require('../models/Match');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');
const syncTournamentService = require('../scraper/services/tournamentSyncService');
const { SIXTEEN_SCORE_ORIGIN } = require('../scraper/providers/16score/urls');

const VALID_STATUSES = ['draft', 'upcoming', 'live', 'completed', 'archived'];
const VALID_SOURCES = ['16score', 'manual'];

const normalizeTournamentPayload = (body = {}) => {
  const source = String(body.source || 'manual').toLowerCase();
  const status = String(body.status || 'draft').toLowerCase();
  const sourceUrl = String(body.sourceUrl || body.matchesUrl || '').trim();

  if (!String(body.name || '').trim()) {
    throw new AppError('Tournament name is required', 400);
  }

  if (!VALID_SOURCES.includes(source)) {
    throw new AppError('Invalid tournament source', 400);
  }

  if (!VALID_STATUSES.includes(status)) {
    throw new AppError('Invalid tournament status', 400);
  }

  if (source === '16score') {
    if (!sourceUrl) {
      throw new AppError('Tournament source URL is required', 400);
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(sourceUrl);
    } catch (error) {
      throw new AppError('Invalid tournament source URL', 400);
    }

    if (parsedUrl.origin !== SIXTEEN_SCORE_ORIGIN) {
      throw new AppError('Tournament source URL must belong to 16Score', 400);
    }
  }

  return {
    name: String(body.name).trim(),
    status,
    source,
    sourceUrl,
    matchesUrl: sourceUrl,
    autoSync: body.autoSync === true,
  };
};

exports.listTournaments = asyncHandler(async (req, res) => {
  const tournaments = await Tournament.find({}).sort({ updatedAt: -1 }).lean();

  res.json({
    tournaments,
  });
});

exports.createTournament = asyncHandler(async (req, res) => {
  const tournament = await Tournament.create(normalizeTournamentPayload(req.body));

  res.status(201).json({
    tournament,
  });
});

exports.updateTournament = asyncHandler(async (req, res) => {
  const tournament = await Tournament.findByIdAndUpdate(
    req.params.id,
    {
      $set: normalizeTournamentPayload(req.body),
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!tournament) {
    throw new AppError('Tournament not found', 404);
  }

  res.json({
    tournament,
  });
});

exports.deleteTournament = asyncHandler(async (req, res) => {
  const tournament = await Tournament.findByIdAndDelete(req.params.id);

  if (!tournament) {
    throw new AppError('Tournament not found', 404);
  }

  await Match.deleteMany({ tournamentId: tournament._id });

  res.json({
    message: 'Tournament deleted',
  });
});

exports.syncTournament = asyncHandler(async (req, res) => {
  const tournament = await Tournament.findById(req.params.id);

  if (!tournament) {
    throw new AppError('Tournament not found', 404);
  }

  const summary = await syncTournamentService(tournament);

  res.json({
    success: true,
    ...summary,
  });
});

exports.syncTournamentFromBody = asyncHandler(async (req, res) => {
  const payload = normalizeTournamentPayload(req.body);
  const tournament = await Tournament.findOneAndUpdate(
    {
      source: payload.source,
      sourceUrl: payload.sourceUrl,
    },
    {
      $set: payload,
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );
  const summary = await syncTournamentService(tournament);

  res.json({
    success: true,
    tournament,
    ...summary,
  });
});
