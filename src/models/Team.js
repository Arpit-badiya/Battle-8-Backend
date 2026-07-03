const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    contest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contest',
      required: true,
    },

    players: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        required: true,
      },
    ],

    selectedTeamName: {
      type: String,
      trim: true,
      default: '',
    },

    captain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      default: null,
    },

    viceCaptain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      default: null,
    },

    // Team-contest fields (contestType === 'team')
    selectedTeams: {
      type: [String],
      default: [],
    },

    captainTeam: {
      type: String,
      trim: true,
      default: '',
    },

    viceCaptainTeam: {
      type: String,
      trim: true,
      default: '',
    },

    totalCredits: {
      type: Number,
      required: true,
      min: 0,
    },

    points: {
      type: Number,
      default: 0,
      min: 0,
    },

    rank: {
      type: Number,
      default: null,
    },

    winnings: {
      type: Number,
      default: 0,
      min: 0,
    },

    resultBreakdown: [
      {
        player: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Player',
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
        active: {
          type: Boolean,
          default: true,
        },
      },
    ],

    teamResultBreakdown: [
      {
        teamName: {
          type: String,
          trim: true,
        },
        finishPoints: {
          type: Number,
          default: 0,
          min: 0,
        },
        positionPoints: {
          type: Number,
          default: 0,
          min: 0,
        },
        points: {
          type: Number,
          default: 0,
          min: 0,
        },
        multiplier: {
          type: Number,
          default: 1,
          min: 1,
        },
        totalPoints: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],
  },
  { optimisticConcurrency: true, timestamps: true }
);

teamSchema.index({ user: 1, contest: 1 }, { unique: true });
teamSchema.index({ contest: 1, points: -1, createdAt: 1 });
teamSchema.index({ contest: 1, user: 1, points: -1 });
teamSchema.index({ contest: 1, rank: 1 });

module.exports = mongoose.model('Team', teamSchema);
