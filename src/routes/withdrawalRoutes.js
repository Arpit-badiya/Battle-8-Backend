const express = require('express');

const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { getWithdrawalOverview, requestWithdrawal } = require('../controllers/withdrawalController');

router.get('/', authMiddleware, getWithdrawalOverview);
router.post('/', authMiddleware, requestWithdrawal);

module.exports = router;
