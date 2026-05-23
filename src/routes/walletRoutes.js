const express = require("express");

const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const {
  getWallet,
} = require("../controllers/walletController");

router.get("/", authMiddleware, getWallet);

module.exports = router;