const express = require('express');

const router = express.Router();

const {
  getContests,
  joinContest,
} = require('../controllers/contestController');

const authMiddleware =
  require('../middlewares/authMiddleware');

router.get(
  '/',
  authMiddleware,
  getContests
);

router.post(
  '/join',
  authMiddleware,
  joinContest
);

module.exports = router;