const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { AppError, asyncHandler } = require('../middlewares/errorMiddleware');
const logger = require('../utils/logger');
const { applyReferralCode, ensureReferralCode } = require('../services/referralService');
const { isValidEmail, normalizeDisplayName, normalizeEmail } = require('../utils/helpers');

const initializeFirebaseAdmin = () => {
  if (admin.apps.length) {
    return;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || 'battle-8',
  });
};

const signToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new AppError('JWT_SECRET is not configured', 500);
  }

  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    }
  );
};

const serializeUser = (user) => ({
  _id: user._id,
  id: user._id,
  email: user.email,
  name: user.name || '',
  coins: user.coins,
  winningCoins: user.winningCoins || 0,
  premium: user.premium || {},
  role: user.role,
  referralCode: user.referralCode || '',
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

exports.googleLogin = asyncHandler(async (req, res) => {
  const firebaseIdToken = String(req.body.firebaseIdToken || '').trim();

  if (!firebaseIdToken) {
    throw new AppError('Firebase ID token is required', 400);
  }

  initializeFirebaseAdmin();

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
  } catch (error) {
    logger.warn('firebase_token_verify_failed', {
      error,
      ip: req.ip,
    });

    throw new AppError('Invalid Google sign-in token', 401);
  }

  const email = normalizeEmail(decodedToken.email);
  if (!decodedToken.email_verified || !isValidEmail(email)) {
    throw new AppError('Verified Google email is required', 400);
  }
  const googleName = normalizeDisplayName(decodedToken.name);
  const safeGoogleName = googleName.length >= 3 && googleName.length <= 20 ? googleName : '';

  let user = await User.findOne({ email });
  const isNewUser = !user;

  if (!user) {
    user = await User.create({
      email,
      name: safeGoogleName,
      coins: 100,
    });
  } else if (!user.name && safeGoogleName) {
    user.name = safeGoogleName;
    await user.save();
  }

  await ensureReferralCode(user);

  if (isNewUser && req.body.referralCode) {
    try {
      await applyReferralCode({
        userId: user._id,
        code: req.body.referralCode,
      });
      user = await User.findById(user._id);
    } catch (error) {
      logger.warn('referral_apply_during_signup_failed', {
        email,
        code: req.body.referralCode,
        error,
      });
    }
  }

  const token = signToken(user);

  res.json({
    message: 'Google login successful',
    token,
    user: serializeUser(user),
    isNewUser,
  });
});
