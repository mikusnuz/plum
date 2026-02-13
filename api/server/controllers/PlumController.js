const { ethers } = require('ethers');
const { logger } = require('@librechat/data-schemas');
const { Balance, Transaction } = require('~/db/models');
const { createAutoRefillTransaction } = require('~/models/Transaction');
const PlumPayment = require('~/models/PlumPayment');
const { getPlanCatalog, getPlanById, getPaymentConfig } = require('~/server/services/plum/plans');
const {
  resolveUserEntitlement,
  getUserWalletAddress,
} = require('~/server/services/plum/entitlements');

function parseRangeDate(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

async function getCurrentBalance(userId) {
  const balance = await Balance.findOne({ user: userId }, 'tokenCredits').lean();
  return Number(balance?.tokenCredits || 0);
}

function summarizeUsage(transactions) {
  const summary = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    spentCredits: 0,
    addedCredits: 0,
    waivedCredits: 0,
    netCredits: 0,
  };

  const byModelMap = new Map();

  for (const tx of transactions) {
    const rawAmount = Number(tx.rawAmount || 0);
    const tokenValue = Number(tx.tokenValue || 0);
    const modelKey = tx.model || 'unknown';
    const isAgentFree = typeof tx.context === 'string' && tx.context.includes(':agent-free');

    if (tx.tokenType === 'prompt') {
      summary.promptTokens += Math.abs(rawAmount);
    } else if (tx.tokenType === 'completion') {
      summary.completionTokens += Math.abs(rawAmount);
    }

    if (tokenValue < 0) {
      summary.spentCredits += Math.abs(tokenValue);
      if (isAgentFree) {
        summary.waivedCredits += Math.abs(tokenValue);
      }
    } else if (tokenValue > 0) {
      summary.addedCredits += tokenValue;
    }

    if (!byModelMap.has(modelKey)) {
      byModelMap.set(modelKey, {
        model: modelKey,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        spentCredits: 0,
        waivedCredits: 0,
      });
    }

    const modelStats = byModelMap.get(modelKey);
    if (tx.tokenType === 'prompt') {
      modelStats.promptTokens += Math.abs(rawAmount);
    } else if (tx.tokenType === 'completion') {
      modelStats.completionTokens += Math.abs(rawAmount);
    }

    if (tokenValue < 0) {
      modelStats.spentCredits += Math.abs(tokenValue);
      if (isAgentFree) {
        modelStats.waivedCredits += Math.abs(tokenValue);
      }
    }
  }

  summary.totalTokens = summary.promptTokens + summary.completionTokens;
  summary.netCredits = summary.addedCredits - summary.spentCredits;

  const byModel = Array.from(byModelMap.values())
    .map((item) => ({
      ...item,
      totalTokens: item.promptTokens + item.completionTokens,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return { summary, byModel };
}

async function getPlansController(_req, res) {
  const plans = getPlanCatalog();
  const paymentConfig = getPaymentConfig();
  return res.status(200).json({
    plans,
    payment: {
      chainId: paymentConfig.chainId,
      treasuryAddress: paymentConfig.treasuryAddress,
      minConfirmations: paymentConfig.minConfirmations,
    },
  });
}

async function getMeController(req, res) {
  try {
    const entitlement = resolveUserEntitlement(req.user);
    const balance = await getCurrentBalance(req.user.id);
    const paymentConfig = getPaymentConfig();

    return res.status(200).json({
      walletAddress: entitlement.walletAddress,
      billingMode: entitlement.billingMode,
      isAgentFree: entitlement.isAgentFree,
      balance,
      plans: getPlanCatalog(),
      payment: {
        chainId: paymentConfig.chainId,
        treasuryAddress: paymentConfig.treasuryAddress,
        minConfirmations: paymentConfig.minConfirmations,
      },
    });
  } catch (error) {
    logger.error('[PlumController.getMeController] Error:', error);
    return res.status(500).json({ message: 'Failed to load Plum account state' });
  }
}

async function getUsageController(req, res) {
  try {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const from = parseRangeDate(req.query.from, defaultFrom);
    const to = parseRangeDate(req.query.to, now);

    if (!from || !to) {
      return res.status(400).json({ message: 'Invalid date range. Use ISO date strings.' });
    }

    if (from > to) {
      return res.status(400).json({ message: '`from` must be earlier than `to`.' });
    }

    const transactions = await Transaction.find(
      {
        user: req.user.id,
        createdAt: { $gte: from, $lte: to },
      },
      'tokenType rawAmount tokenValue model context createdAt',
    ).lean();

    const { summary, byModel } = summarizeUsage(transactions);
    const balance = await getCurrentBalance(req.user.id);
    const entitlement = resolveUserEntitlement(req.user);

    return res.status(200).json({
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      billingMode: entitlement.billingMode,
      isAgentFree: entitlement.isAgentFree,
      walletAddress: entitlement.walletAddress,
      summary,
      byModel,
      balance,
      transactionCount: transactions.length,
    });
  } catch (error) {
    logger.error('[PlumController.getUsageController] Error:', error);
    return res.status(500).json({ message: 'Failed to load usage summary' });
  }
}

async function verifyPaymentController(req, res) {
  try {
    const { planId, txHash } = req.body ?? {};

    if (!planId || !txHash) {
      return res.status(400).json({ message: '`planId` and `txHash` are required.' });
    }

    const walletAddress = getUserWalletAddress(req.user);
    if (!walletAddress) {
      return res.status(400).json({ message: 'Wallet account is required for plan payments.' });
    }

    const plan = getPlanById(planId);
    if (!plan) {
      return res.status(404).json({ message: `Unknown plan: ${planId}` });
    }

    const paymentConfig = getPaymentConfig();
    if (!paymentConfig.chainRpcUrl || !paymentConfig.treasuryAddress) {
      return res.status(503).json({
        message: 'Payment verification is not configured. Missing RPC URL or treasury wallet.',
      });
    }

    const normalizedTxHash = String(txHash).trim().toLowerCase();
    const existingPayment = await PlumPayment.findOne({ txHash: normalizedTxHash }).lean();
    if (existingPayment) {
      return res.status(409).json({ message: 'This transaction hash was already claimed.' });
    }

    const provider = new ethers.providers.JsonRpcProvider(paymentConfig.chainRpcUrl);
    const tx = await provider.getTransaction(normalizedTxHash);
    const receipt = await provider.getTransactionReceipt(normalizedTxHash);

    if (!tx || !receipt) {
      return res.status(404).json({ message: 'Transaction not found or not mined yet.' });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({ message: 'Transaction failed on-chain.' });
    }

    const txFrom = tx.from ? ethers.utils.getAddress(tx.from) : null;
    const txTo = tx.to ? ethers.utils.getAddress(tx.to) : null;

    if (!txFrom || txFrom !== walletAddress) {
      return res.status(403).json({
        message: 'Transaction sender does not match the authenticated wallet.',
      });
    }

    if (!txTo || txTo !== paymentConfig.treasuryAddress) {
      return res.status(400).json({
        message: 'Transaction receiver does not match the configured treasury wallet.',
      });
    }

    if (
      Number.isFinite(paymentConfig.chainId) &&
      tx.chainId != null &&
      Number(tx.chainId) !== paymentConfig.chainId
    ) {
      return res.status(400).json({
        message: `Transaction chain mismatch. Expected chainId ${paymentConfig.chainId}.`,
      });
    }

    const minimumWei = ethers.BigNumber.from(plan.plmAmountWei);
    if (tx.value.lt(minimumWei)) {
      return res.status(400).json({
        message: `Insufficient payment value. Required at least ${plan.plmAmount} PLM.`,
      });
    }

    const latestBlock = await provider.getBlockNumber();
    const confirmations = latestBlock - receipt.blockNumber + 1;
    if (confirmations < paymentConfig.minConfirmations) {
      return res.status(400).json({
        message: `Not enough confirmations. Required ${paymentConfig.minConfirmations}, got ${confirmations}.`,
      });
    }

    try {
      await PlumPayment.create({
        user: req.user.id,
        walletAddress,
        txHash: normalizedTxHash,
        chainId: tx.chainId ? Number(tx.chainId) : paymentConfig.chainId,
        planId: plan.id,
        planLabel: plan.label,
        paidPlm: plan.plmAmount,
        paidWei: tx.value.toString(),
        creditsGranted: plan.creditsGranted,
        blockNumber: receipt.blockNumber,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ message: 'This transaction hash was already claimed.' });
      }
      throw error;
    }

    await createAutoRefillTransaction({
      user: req.user.id,
      tokenType: 'credits',
      context: `plum-plan:${plan.id}`,
      rawAmount: plan.creditsGranted,
    });

    const balance = await getCurrentBalance(req.user.id);
    return res.status(200).json({
      message: 'Payment verified and credits added.',
      plan,
      txHash: normalizedTxHash,
      balance,
    });
  } catch (error) {
    logger.error('[PlumController.verifyPaymentController] Error:', error);
    return res.status(500).json({ message: 'Failed to verify payment transaction.' });
  }
}

module.exports = {
  getPlansController,
  getMeController,
  getUsageController,
  verifyPaymentController,
};
