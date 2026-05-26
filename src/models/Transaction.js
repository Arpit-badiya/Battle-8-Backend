const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
    },

    contest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      default: null,
    },

    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    withdrawal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Withdrawal",
      default: null,
    },

    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    idempotencyKey: {
      type: String,
      default: undefined,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ user: 1, contest: 1, type: 1, reason: 1 });
transactionSchema.index({ contest: 1, type: 1 });
transactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model(
  "Transaction",
  transactionSchema
);
