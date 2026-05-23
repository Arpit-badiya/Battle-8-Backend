const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const Otp = require('../models/Otp');
const User = require('../models/User');

const sendOtpMail = require('../config/mailer');

const {
  AppError,
  asyncHandler,
} = require('../middlewares/errorMiddleware');

const logger = require('../utils/logger');

const {
  isValidEmail,
  normalizeEmail,
} = require('../utils/helpers');

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const OTP_COOLDOWN_MS = 60 * 1000;

const signToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new AppError(
      'JWT_SECRET is not configured',
      500
    );
  }

  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn:
        process.env.JWT_EXPIRES_IN || '7d',
    }
  );
};

const serializeUser = (user) => ({
  _id: user._id,
  id: user._id,
  email: user.email,
  name: user.name || '',
  coins: user.coins,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

exports.sendOtp = asyncHandler(
  async (req, res) => {
    try {
      console.log("OTP ROUTE HIT");

      const email = normalizeEmail(
        req.body.email
      );

      console.log("EMAIL:", email);

      if (!isValidEmail(email)) {
        throw new AppError(
          'Valid email is required',
          400
        );
      }

      const recentOtp =
        await Otp.findOne({ email }).sort({
          createdAt: -1,
        });

      console.log(
        "RECENT OTP CHECK DONE"
      );

      if (
        recentOtp &&
        Date.now() -
          new Date(
            recentOtp.lastSentAt ||
              recentOtp.createdAt
          ).getTime() <
          OTP_COOLDOWN_MS
      ) {
        console.log(
          "OTP COOLDOWN BLOCKED"
        );

        logger.warn(
          'otp_cooldown_blocked',
          {
            email,
            ip: req.ip,
          }
        );

        throw new AppError(
          'Please wait before requesting another OTP',
          429
        );
      }

      const otp = crypto
        .randomInt(100000, 1000000)
        .toString();

      console.log("OTP GENERATED");

      const otpHash =
        await bcrypt.hash(otp, 10);

      console.log("OTP HASHED");

      await Otp.deleteMany({ email });

      console.log("OLD OTP DELETED");

      await Otp.create({
        email,
        otp: otpHash,
        expiresAt: new Date(
          Date.now() + OTP_TTL_MS
        ),
        lastSentAt: new Date(),
      });

      console.log("OTP SAVED");

      console.log(
        "BEFORE MAIL SEND"
      );

      await sendOtpMail(email, otp);

      console.log(
        "MAIL SENT SUCCESS"
      );

      if (
        process.env.NODE_ENV !==
        'production'
      ) {
        console.log('OTP:', otp);
      }

      res.json({
        message: 'OTP sent',
      });
    } catch (error) {
      console.log(
        "SEND OTP ERROR:",
        error
      );

      throw error;
    }
  }
);

exports.verifyOtp = asyncHandler(
  async (req, res) => {
    const email = normalizeEmail(
      req.body.email
    );

    const otp = String(
      req.body.otp || ''
    ).trim();

    if (
      !isValidEmail(email) ||
      !/^\d{6}$/.test(otp)
    ) {
      throw new AppError(
        'Valid email and 6 digit OTP are required',
        400
      );
    }

    const otpRecord =
      await Otp.findOne({
        email,
        consumed: false,
      }).sort({
        createdAt: -1,
      });

    if (!otpRecord) {
      throw new AppError(
        'Invalid OTP',
        400
      );
    }

    if (
      otpRecord.expiresAt.getTime() <
      Date.now()
    ) {
      await Otp.deleteOne({
        _id: otpRecord._id,
      });

      throw new AppError(
        'OTP expired',
        400
      );
    }

    if (
      otpRecord.attempts >=
      MAX_OTP_ATTEMPTS
    ) {
      await Otp.deleteOne({
        _id: otpRecord._id,
      });

      throw new AppError(
        'Too many OTP attempts. Request a new code.',
        429
      );
    }

    const matches =
      await bcrypt.compare(
        otp,
        otpRecord.otp
      );

    if (!matches) {
      otpRecord.attempts += 1;

      await otpRecord.save();

      logger.warn(
        'otp_invalid_attempt',
        {
          email,
          attempts:
            otpRecord.attempts,
          ip: req.ip,
        }
      );

      throw new AppError(
        'Invalid OTP',
        400
      );
    }

    let user = await User.findOne({
      email,
    });

    if (!user) {
      user = await User.create({
        email,
        coins: 100,
      });
    }

    otpRecord.consumed = true;

    await otpRecord.save();

    await Otp.deleteMany({
      email,
      _id: {
        $ne: otpRecord._id,
      },
    });

    const token = signToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: serializeUser(user),
    });
  }
);