const mongoose = require('mongoose');

const adRewardSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    adEventId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    adUnitId: {
      type: String,
      trim: true,
      default: '',
    },
    placement: {
      type: String,
      trim: true,
      default: 'earn_coins',
    },
    status: {
      type: String,
      enum: ['completed', 'rejected'],
      default: 'completed',
      index: true,
    },
    adsWatchedAfter: {
      type: Number,
      required: true,
      min: 1,
    },
    standardRewardAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    milestoneRewardAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    milestone: {
      type: Number,
      default: null,
    },
    totalRewardAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    standardTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    milestoneTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    provider: {
      type: String,
      default: 'admob',
    },
    verification: {
      type: String,
      enum: ['client_completed', 'server_verified'],
      default: 'client_completed',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

adRewardSchema.index({ user: 1, createdAt: -1 });
adRewardSchema.index({ user: 1, adsWatchedAfter: 1 });
adRewardSchema.index({ user: 1, milestone: 1 }, { sparse: true });

module.exports = mongoose.model('AdReward', adRewardSchema);
