const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    game: {
      type: String,
      required: true,
      trim: true,
      default: 'BGMI',
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    team: {
      type: String,
      required: true,
      trim: true,
    },

    credits: {
      type: Number,
      required: true,
      min: 0,
    },

    role: {
      type: String,
      enum: [
        "IGL",
        "Assaulter",
        "Supporter",
        "Support",
        "Sniper",
      ],
      default: "Assaulter",
    },

    image: {
      type: String,
      default: "",
    },

    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

playerSchema.index({ game: 1, name: 1, team: 1 }, { unique: true });
playerSchema.index({ game: 1, team: 1, active: 1 });
playerSchema.index({ role: 1 });

module.exports = mongoose.model(
  "Player",
  playerSchema
);
