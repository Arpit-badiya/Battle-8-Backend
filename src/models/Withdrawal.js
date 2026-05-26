const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amountCoins: {
      type: Number,
      required: true,
      min: 1000,
    },
    amountInr: {
      type: Number,
      required: true,
      min: 10,
    },
    upiId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    accountName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'paid'],
      default: 'requested',
      index: true,
    },
    holdTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    refundTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    adminNote: {
      type: String,
      trim: true,
      default: '',
    },
    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
