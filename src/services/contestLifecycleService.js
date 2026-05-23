const Contest = require('../models/Contest');
const cache = require('./cacheService');
const { emitContestUpdate } = require('./realtimeService');
const { normalizeContest } = require('../utils/helpers');
const logger = require('../utils/logger');

let lifecycleInterval = null;

const promoteDueContestsToLive = async () => {
  const now = new Date();
  const dueContests = await Contest.find({
    status: 'upcoming',
    startTime: { $ne: null, $lte: now },
  }).limit(50);

  if (dueContests.length === 0) {
    return 0;
  }

  let updated = 0;

  for (const contest of dueContests) {
    const result = await Contest.updateOne(
      {
        _id: contest._id,
        status: 'upcoming',
        startTime: { $lte: now },
      },
      {
        $set: {
          status: 'live',
          timeLeft: 'LIVE',
        },
      }
    );

    if (result.modifiedCount === 0) {
      continue;
    }

    updated += 1;
    contest.status = 'live';
    contest.timeLeft = 'LIVE';
    await cache.setActiveMatchState(contest._id, {
      status: 'live',
      updatedAt: now.toISOString(),
    });
    emitContestUpdate(normalizeContest(contest));
  }

  if (updated > 0) {
    await cache.del('contests:list');
    logger.info('contests_auto_live', { updated });
  }

  return updated;
};

const startContestLifecycleScheduler = ({ intervalMs = 30000 } = {}) => {
  if (lifecycleInterval) {
    return lifecycleInterval;
  }

  promoteDueContestsToLive().catch((error) => {
    logger.error('contest_lifecycle_initial_failed', { error });
  });

  lifecycleInterval = setInterval(() => {
    promoteDueContestsToLive().catch((error) => {
      logger.error('contest_lifecycle_tick_failed', { error });
    });
  }, intervalMs);

  return lifecycleInterval;
};

const stopContestLifecycleScheduler = () => {
  if (lifecycleInterval) {
    clearInterval(lifecycleInterval);
    lifecycleInterval = null;
  }
};

module.exports = {
  promoteDueContestsToLive,
  startContestLifecycleScheduler,
  stopContestLifecycleScheduler,
};
