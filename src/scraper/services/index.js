/**
 * Placeholder service entrypoint for future scraper business operations.
 *
 * @returns {void}
 */
function runScraperService() {
}

runScraperService.matchMonitorService = require('./matchMonitorService');
runScraperService.tournamentSyncService = require('./tournamentSyncService');

module.exports = runScraperService;
