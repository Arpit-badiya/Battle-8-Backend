const mongoose = require('mongoose');

const contestSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    players: {
      type: Number,
      required: true,
      min: 1,
    },

    joined: {
      type: Number,
      default: 0,
      min: 0,
    },

    entryFee: {
      type: Number,
      required: true,
      min: 0,
    },

    prizePool: {
      type: Number,
      required: true,
      min: 0,
    },

    platformCommissionPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 50,
    },

    totalCollection: {
      type: Number,
      default: 0,
      min: 0,
    },

    platformCommissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    timeLeft: {
      type: String,
      default: '00:00:00',
    },

    status: {
      type: String,
      enum: ['upcoming', 'live', 'completed', 'cancelled'],
      default: 'upcoming',
      index: true,
    },

    startsAt: {
      type: Date,
      default: null,
    },

    endsAt: {
      type: Date,
      default: null,
    },

    startTime: {
      type: Date,
      default: null,
    },

    endTime: {
      type: Date,
      default: null,
    },

    estimatedEndTime: {
      type: Date,
      default: null,
    },

    contestPlayers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
      },
    ],

    winnings: [
      {
        rank: {
          type: Number,
          required: true,
          min: 1,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    resultDeclared: {
      type: Boolean,
      default: false,
      index: true,
    },

    resultDeclaredAt: {
      type: Date,
      default: null,
    },

    resultLockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    payoutsDistributed: {
      type: Boolean,
      default: false,
      index: true,
    },

    payoutsDistributedAt: {
      type: Date,
      default: null,
    },
  },
  { optimisticConcurrency: true, timestamps: true }
);

contestSchema.index({ status: 1, resultDeclared: 1, createdAt: -1 });
contestSchema.index({ participants: 1, status: 1 });
contestSchema.index({ status: 1, joined: 1, players: 1 });
contestSchema.index({ startTime: 1, status: 1 });
contestSchema.index({ payoutsDistributed: 1, status: 1 });
contestSchema.index({ contestPlayers: 1, status: 1 });

contestSchema.path('winnings').validate(function validateUniqueWinningRanks(winnings) {
  if (!Array.isArray(winnings)) return true;
  const ranks = winnings.map((item) => Number(item.rank));
  return ranks.length === new Set(ranks).size;
}, 'Winning ranks must be unique');

module.exports = mongoose.model('Contest', contestSchema);
