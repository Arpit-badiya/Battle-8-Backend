const axios = require('axios');
const logger = require('../../../utils/logger');

const DEFAULT_TIMEOUT_MS = Number(process.env.SCRAPER_FETCH_TIMEOUT_MS) || 15000;

/**
 * Fetch HTML from a provider URL.
 *
 * @param {string} url - Absolute URL to fetch.
 * @returns {Promise<string|null>} HTML response body, or null when the fetch fails.
 */
async function fetchHTML(url) {
  if (!url) {
    logger.warn('Scraper fetch skipped because URL is missing');
    return null;
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Battle-8-Scraper/1.0 Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      responseType: 'text',
      timeout: DEFAULT_TIMEOUT_MS,
      transformResponse: [(data) => data],
    });

    return response.data;
  } catch (error) {
    logger.warn('Scraper fetch failed', {
      url,
      error,
    });

    return null;
  }
}

module.exports = fetchHTML;
