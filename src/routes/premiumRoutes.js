const express = require('express');

const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { claimDailyBonus, getPremiumStatus } = require('../controllers/premiumController');

router.get('/', authMiddleware, getPremiumStatus);
router.post('/daily-bonus', authMiddleware, claimDailyBonus);

module.exports = router;
