const { AppError } = require('../../middlewares/errorMiddleware');
const fetchHTML = require('../providers/16score/fetch');
const { SIXTEEN_SCORE_ORIGIN } = require('../providers/16score/urls');

/**
 * Validate and normalize a 16Score tournament source URL.
 *
 * @param {string} sourceUrl - Tournament URL supplied by an admin.
 * @returns {string} Normalized absolute URL.
 */
function validateTournamentUrl(sourceUrl) {
  if (!sourceUrl || typeof sourceUrl !== 'string') {
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

  return parsedUrl.toString();
}

/**
 * Download tournament HTML from a validated 16Score source URL.
 *
 * @param {string} sourceUrl - Tournament URL supplied by an admin.
 * @returns {Promise<{success: boolean, html: string, htmlLength: number}>} Downloaded HTML payload metadata.
 */
async function syncTournament(sourceUrl) {
  const url = validateTournamentUrl(sourceUrl);
  const html = await fetchHTML(url);

  if (!html) {
    throw new AppError('Failed to fetch tournament HTML', 502);
  }

  return {
    success: true,
    html,
    htmlLength: html.length,
  };
}

module.exports = syncTournament;
