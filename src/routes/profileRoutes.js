const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { applyReferral, getProfile, updateProfile } = require('../controllers/profileController');

const router = express.Router();

router.get('/', authMiddleware, getProfile);
router.put('/', authMiddleware, updateProfile);
router.post('/referral/apply', authMiddleware, applyReferral);

module.exports = router;
