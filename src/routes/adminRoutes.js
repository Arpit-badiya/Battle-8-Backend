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
  getDashboard,
  createContest,
  updateContest,
  getLeaderboard,
  importContestPlayers,
  importContestResults,
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
