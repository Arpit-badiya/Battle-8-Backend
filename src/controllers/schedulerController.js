const { asyncHandler } = require('../middlewares/errorMiddleware');
const matchMonitorScheduler = require('../scraper/scheduler/matchMonitorScheduler');

exports.getSchedulerStatus = asyncHandler(async (req, res) => {
  const status = await matchMonitorScheduler.getStatus();

  res.json(status);
});

exports.startScheduler = asyncHandler(async (req, res) => {
  matchMonitorScheduler.start();
  const status = await matchMonitorScheduler.getStatus();

  res.json(status);
});

exports.stopScheduler = asyncHandler(async (req, res) => {
  matchMonitorScheduler.stop();
  const status = await matchMonitorScheduler.getStatus();

  res.json(status);
});
