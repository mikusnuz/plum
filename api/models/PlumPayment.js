const mongoose = require('mongoose');

const plumPaymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    walletAddress: {
      type: String,
      required: true,
      index: true,
    },
    txHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    chainId: {
      type: Number,
      required: false,
    },
    planId: {
      type: String,
      required: true,
      index: true,
    },
    planLabel: {
      type: String,
      required: true,
    },
    paidPlm: {
      type: String,
      required: true,
    },
    paidWei: {
      type: String,
      required: true,
    },
    creditsGranted: {
      type: Number,
      required: true,
    },
    blockNumber: {
      type: Number,
      required: false,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'failed'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.models.PlumPayment || mongoose.model('PlumPayment', plumPaymentSchema);
