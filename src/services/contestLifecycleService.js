const Contest = require('../models/Contest');
const cache = require('./cacheService');
const { emitContestUpdate } = require('./realtimeService');
const { refundContestEntries } = require('./refundService');
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
    await cache.delContestLists();
    logger.info('contests_auto_live', { updated });
  }

  return updated;
};

const cancelStaleLiveContests = async ({ maxLiveMs = 24 * 60 * 60 * 1000 } = {}) => {
  const cutoff = new Date(Date.now() - maxLiveMs);
  const staleContests = await Contest.find({
    status: 'live',
    resultDeclared: false,
    $or: [
      { startTime: { $lte: cutoff } },
      { startsAt: { $lte: cutoff } },
      { updatedAt: { $lte: cutoff } },
    ],
  }).limit(25);

  let cancelled = 0;

  for (const contest of staleContests) {
    contest.status = 'cancelled';
    contest.cancelledReason = 'Auto-cancelled after 24 hours live';
    contest.endTime = new Date();
    contest.endsAt = contest.endTime;
    contest.timeLeft = 'AUTO-CANCELLED';
    await contest.save();

    const refund = await refundContestEntries({
      contestId: contest._id,
      adminId: null,
    });

    cancelled += 1;
    await cache.setActiveMatchState(contest._id, {
      status: 'cancelled',
      reason: contest.cancelledReason,
      refunded: refund.refunded,
      updatedAt: new Date().toISOString(),
    });
    emitContestUpdate(normalizeContest(refund.contest));
  }

  if (cancelled > 0) {
    await cache.delContestLists();
    logger.warn('contests_auto_cancelled_stale_live', { cancelled });
  }

  return cancelled;
};

const startContestLifecycleScheduler = ({ intervalMs = 30000 } = {}) => {
  if (lifecycleInterval) {
    return lifecycleInterval;
  }

  promoteDueContestsToLive().catch((error) => {
    logger.error('contest_lifecycle_initial_failed', { error });
  });
  cancelStaleLiveContests().catch((error) => {
    logger.error('contest_auto_cancel_initial_failed', { error });
  });

  lifecycleInterval = setInterval(() => {
    promoteDueContestsToLive().catch((error) => {
      logger.error('contest_lifecycle_tick_failed', { error });
    });
    cancelStaleLiveContests().catch((error) => {
      logger.error('contest_auto_cancel_tick_failed', { error });
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
  cancelStaleLiveContests,
  startContestLifecycleScheduler,
  stopContestLifecycleScheduler,
};
