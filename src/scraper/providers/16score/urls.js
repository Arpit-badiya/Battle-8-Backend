const SIXTEEN_SCORE_ORIGIN = 'https://www.16score.com';
const SCRAPER_BASE_URL = process.env.SCRAPER_BASE_URL;

/**
 * Build an absolute 16Score URL from the configured scraper base URL.
 *
 * @param {string} path - URL path for the 16Score page.
 * @returns {string} Absolute provider URL.
 */
function buildUrl(path) {
  if (!SCRAPER_BASE_URL) {
    return '';
  }

  return `${SCRAPER_BASE_URL.replace(/\/$/, '')}${path}`;
}

module.exports = {
  SIXTEEN_SCORE_ORIGIN,
  SCRAPER_BASE_URL,
  matches: {
    live: buildUrl('/en/matches/live'),
    upcoming: buildUrl('/en/matches/upcoming'),
    completed: buildUrl('/en/matches/completed'),
  },
  buildUrl,
};
