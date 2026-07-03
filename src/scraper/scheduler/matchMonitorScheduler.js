const Match = require('../../models/Match');
const logger = require('../../utils/logger');
const { monitorPendingMatches } = require('../services/matchMonitorService');

const DEFAULT_INTERVAL_MS = Number(process.env.MATCH_MONITOR_INTERVAL_MS) || 60000;

let intervalId = null;
let running = false;
let syncing = false;
let lastSyncTime = null;
let lastSummary = null;

async function runOnce() {
  if (syncing) {
    logger.info('Scheduler Finished', {
      skipped: true,
      reason: 'sync_already_running',
    });
    return lastSummary;
  }

  syncing = true;

  try {
    lastSummary = await monitorPendingMatches();
    lastSyncTime = lastSummary.lastSyncTime;
    return lastSummary;
  } finally {
    syncing = false;
  }
}

function start(intervalMs = DEFAULT_INTERVAL_MS) {
  if (running) {
    return {
      running,
      lastSyncTime,
      lastSummary,
    };
  }

  running = true;
  logger.info('Scheduler Started', {
    intervalMs,
  });
  runOnce().catch((error) => {
    logger.error('Scheduler Finished', {
      error,
    });
  });
  intervalId = setInterval(() => {
    runOnce().catch((error) => {
      logger.error('Scheduler Finished', {
        error,
      });
    });
  }, intervalMs);

  return {
    running,
    lastSyncTime,
    lastSummary,
  };
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
  }

  intervalId = null;
  running = false;

  return {
    running,
    lastSyncTime,
    lastSummary,
  };
}

async function getStatus() {
  const [pendingMatches, completedMatches] = await Promise.all([
    Match.countDocuments({
      processed: false,
      status: { $in: ['pending', 'live'] },
    }),
    Match.countDocuments({
      processed: true,
      status: 'completed',
    }),
  ]);

  return {
    running,
    syncing,
    lastSyncTime,
    pendingMatches,
    completedMatches,
    lastSummary,
  };
}

module.exports = {
  getStatus,
  runOnce,
  start,
  stop,
};
