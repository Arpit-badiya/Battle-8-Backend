const express = require('express');

const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { getAdSummary, recordAdReward } = require('../controllers/adRewardController');

router.get('/summary', authMiddleware, getAdSummary);
router.post('/reward', authMiddleware, recordAdReward);

module.exports = router;
