const express = require("express");

const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const adminMiddleware = require("../middlewares/adminMiddleware");

const {
  getPlayers,
  getContestPlayers,
  createPlayer,
  updatePlayer,
  deletePlayer,
} = require("../controllers/playerController");

// GET players
router.get("/", getPlayers);

router.get(
  "/contest/:contestId",
  authMiddleware,
  getContestPlayers
);

// CREATE player (admin only)
router.post(
  "/create",
  authMiddleware,
  adminMiddleware,
  createPlayer
);

router.put(
  "/:playerId",
  authMiddleware,
  adminMiddleware,
  updatePlayer
);

router.delete(
  "/:playerId",
  authMiddleware,
  adminMiddleware,
  deletePlayer
);

module.exports = router;
