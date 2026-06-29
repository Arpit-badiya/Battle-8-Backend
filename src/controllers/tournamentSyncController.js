const { asyncHandler } = require('../middlewares/errorMiddleware');
const syncTournament = require('../scraper/services/tournamentSyncService');

/**
 * Sync tournament source HTML from 16Score without parsing or persistence.
 *
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.syncTournament = asyncHandler(async (req, res) => {
  const result = await syncTournament(req.body.sourceUrl);

  res.json({
    success: true,
    htmlLength: result.htmlLength,
  });
});
