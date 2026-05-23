const express = require("express");

const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const adminMiddleware = require("../middlewares/adminMiddleware");

const {
  processResults,
  savePlayerResult,
} = require("../controllers/resultController");

router.post(
  "/player",
  authMiddleware,
  adminMiddleware,
  savePlayerResult
);

router.post(
  "/process",
  authMiddleware,
  adminMiddleware,
  processResults
);

module.exports = router;
