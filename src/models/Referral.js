const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    inviter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['pending', 'rewarded'],
      default: 'pending',
      index: true,
    },
    contest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contest',
      default: null,
    },
    inviterReward: {
      type: Number,
      default: 20,
      min: 0,
    },
    referredReward: {
      type: Number,
      default: 10,
      min: 0,
    },
    rewardedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

referralSchema.index({ inviter: 1, status: 1, createdAt: -1 });
referralSchema.index({ code: 1 });

module.exports = mongoose.model('Referral', referralSchema);
