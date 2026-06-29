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
const { syncTournament } = require("../controllers/tournamentSyncController");

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
  "/tournaments/sync",
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
