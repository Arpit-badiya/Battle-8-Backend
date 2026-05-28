const express = require("express");

const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const adminMiddleware = require("../middlewares/adminMiddleware");

const {
  getPlayers,
  getContestPlayers,
  createPlayer,
  createTeamPlayers,
  updatePlayer,
  deletePlayer,
  deleteTeam,
} = require("../controllers/playerController");

router.get("/", getPlayers);

router.get(
  "/contest/:contestId",
  authMiddleware,
  getContestPlayers
);

router.post(
  "/create",
  authMiddleware,
  adminMiddleware,
  createPlayer
);

router.post(
  "/team",
  authMiddleware,
  adminMiddleware,
  createTeamPlayers
);

router.delete(
  "/team",
  authMiddleware,
  adminMiddleware,
  deleteTeam
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
