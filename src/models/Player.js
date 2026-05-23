const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
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
        "Assaulter",
        "Support",
        "Sniper",
        "IGL",
      ],
      default: "Assaulter",
    },

    image: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

playerSchema.index({ name: 1, team: 1 }, { unique: true });
playerSchema.index({ role: 1 });

module.exports = mongoose.model(
  "Player",
  playerSchema
);
