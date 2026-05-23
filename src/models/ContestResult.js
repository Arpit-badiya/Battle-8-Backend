const mongoose = require('mongoose');

const resultLineSchema = new mongoose.Schema(
  {
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: true,
    },
    kills: {
      type: Number,
      default: 0,
      min: 0,
    },
    placement: {
      type: Number,
      default: 0,
      min: 0,
    },
    points: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const payoutSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    rank: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const contestResultSchema = new mongoose.Schema(
  {
    contest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contest',
      required: true,
    },
    declaredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    playerResults: [resultLineSchema],
    payouts: [payoutSchema],
    payoutDistributed: {
      type: Boolean,
      default: false,
      index: true,
    },
    payoutDistributedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

contestResultSchema.index({ contest: 1 }, { unique: true });
contestResultSchema.index({ declaredBy: 1, createdAt: -1 });
contestResultSchema.index({ contest: 1, 'playerResults.player': 1 });

module.exports = mongoose.model('ContestResult', contestResultSchema);
