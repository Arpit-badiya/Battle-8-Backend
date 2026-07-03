const mongoose = require('mongoose');

const matchTeamSchema = new mongoose.Schema(
  {
    placement: {
      type: Number,
      min: 1,
      default: null,
    },
    teamName: {
      type: String,
      trim: true,
      default: '',
    },
    finishPoints: {
      type: Number,
      default: 0,
    },
    positionPoints: {
      type: Number,
      default: 0,
    },
    totalPoints: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const matchSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
      index: true,
    },
    matchNo: {
      type: Number,
      required: true,
      min: 1,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    map: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      trim: true,
      default: 'pending',
      index: true,
    },
    teams: {
      type: [matchTeamSchema],
      default: [],
    },
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

matchSchema.index({ tournamentId: 1, matchNo: 1 }, { unique: true });

module.exports = mongoose.model('Match', matchSchema);
