const express = require("express");

const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const { createTeam } = require("../controllers/teamController");

router.post("/create", authMiddleware, createTeam);

module.exports = router;