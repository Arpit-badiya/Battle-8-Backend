const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['draft', 'upcoming', 'live', 'completed', 'archived'],
      default: 'draft',
      index: true,
    },
    source: {
      type: String,
      enum: ['16score', 'manual'],
      required: true,
      default: 'manual',
      index: true,
    },
    sourceUrl: {
      type: String,
      trim: true,
      default: '',
    },
    matchesUrl: {
      type: String,
      trim: true,
      default: '',
    },
    autoSync: {
      type: Boolean,
      default: false,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    lastSyncSummary: {
      discovered: {
        type: Number,
        default: 0,
        min: 0,
      },
      synced: {
        type: Number,
        default: 0,
        min: 0,
      },
      failed: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
  },
  { timestamps: true }
);

tournamentSchema.index({ name: 1, source: 1 });

module.exports = mongoose.model('Tournament', tournamentSchema);
