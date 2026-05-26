const express = require("express");

const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const { createTeam, getMyTeam } = require("../controllers/teamController");

router.post("/create", authMiddleware, createTeam);

router.get("/contest/:contestId/me", authMiddleware, getMyTeam);

module.exports = router;
