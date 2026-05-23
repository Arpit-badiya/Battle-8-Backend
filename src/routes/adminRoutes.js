const express = require("express");

const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const adminMiddleware = require("../middlewares/adminMiddleware");

const {
  getDashboard,
  createContest,
  updateContest,
  getLeaderboard,
  refundContest,
  updateContestPlayers,
} = require("../controllers/adminController");

router.get(
  "/dashboard",
  authMiddleware,
  adminMiddleware,
  getDashboard
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

module.exports = router;
