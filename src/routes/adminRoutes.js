const express = require("express");
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

const authMiddleware = require("../middlewares/authMiddleware");

const adminMiddleware = require("../middlewares/adminMiddleware");
const {
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
} = require("../controllers/schedulerController");
const {
  createTournament,
  deleteTournament,
  listTournaments,
  syncTournament,
  syncTournamentFromBody,
  updateTournament,
} = require("../controllers/tournamentController");

const {
  getDashboard,
  getAdRewardLogs,
  createContest,
  updateContest,
  cancelContest,
  getLeaderboard,
  getWithdrawalRequests,
  importContestPlayers,
  importContestResults,
  markContestCompleted,
  markContestLive,
  refundContest,
  rehostContest,
  restartResultProcessing,
  setUserPremium,
  updateWithdrawalRequest,
  updateContestPlayers,
} = require("../controllers/adminController");
const resultController = require("../controllers/resultController");

router.get(
  "/dashboard",
  authMiddleware,
  adminMiddleware,
  getDashboard
);

router.get(
  "/ad-rewards",
  authMiddleware,
  adminMiddleware,
  getAdRewardLogs
);

router.get(
  "/withdrawals",
  authMiddleware,
  adminMiddleware,
  getWithdrawalRequests
);

router.get(
  "/scheduler/status",
  authMiddleware,
  adminMiddleware,
  getSchedulerStatus
);

router.post(
  "/scheduler/start",
  authMiddleware,
  adminMiddleware,
  startScheduler
);

router.post(
  "/scheduler/stop",
  authMiddleware,
  adminMiddleware,
  stopScheduler
);

router.post(
  "/withdrawals/:withdrawalId/status",
  authMiddleware,
  adminMiddleware,
  updateWithdrawalRequest
);

router.post(
  "/users/:userId/premium",
  authMiddleware,
  adminMiddleware,
  setUserPremium
);

router.post(
  "/tournaments",
  authMiddleware,
  adminMiddleware,
  createTournament
);

router.get(
  "/tournaments",
  authMiddleware,
  adminMiddleware,
  listTournaments
);

router.put(
  "/tournaments/:id",
  authMiddleware,
  adminMiddleware,
  updateTournament
);

router.delete(
  "/tournaments/:id",
  authMiddleware,
  adminMiddleware,
  deleteTournament
);

router.post(
  "/tournaments/sync",
  authMiddleware,
  adminMiddleware,
  syncTournamentFromBody
);

router.post(
  "/tournaments/:id/sync",
  authMiddleware,
  adminMiddleware,
  syncTournament
);

router.post(
  "/contests/:contestId/live",
  authMiddleware,
  adminMiddleware,
  markContestLive
);

router.post(
  "/contests/:contestId/cancel",
  authMiddleware,
  adminMiddleware,
  cancelContest
);

router.post(
  "/contests/:contestId/rehost",
  authMiddleware,
  adminMiddleware,
  rehostContest
);

router.post(
  "/contests/:contestId/complete",
  authMiddleware,
  adminMiddleware,
  markContestCompleted
);

router.post(
  "/contests/:contestId/restart-results",
  authMiddleware,
  adminMiddleware,
  restartResultProcessing
);

router.post(
  "/contests",
  authMiddleware,
  adminMiddleware,
  createContest
);

router.put(
  "/contests/:contestId",
  authMiddleware,
  adminMiddleware,
  updateContest
);

router.get(
  "/leaderboard/:contestId",
  authMiddleware,
  adminMiddleware,
  getLeaderboard
);

router.get(
  "/contest-results/:contestId",
  authMiddleware,
  adminMiddleware,
  resultController.getAdminContestResult
);

router.post(
  "/contests/:contestId/refund",
  authMiddleware,
  adminMiddleware,
  refundContest
);

router.put(
  "/contests/:contestId/players",
  authMiddleware,
  adminMiddleware,
  updateContestPlayers
);

router.post(
  "/contests/:contestId/import-players",
  authMiddleware,
  adminMiddleware,
  upload.single('file'),
  importContestPlayers
);

router.post(
  "/contests/:contestId/import-results",
  authMiddleware,
  adminMiddleware,
  upload.single('file'),
  importContestResults
);

module.exports = router;
