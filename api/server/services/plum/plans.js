const { ethers } = require('ethers');
const { logger } = require('@librechat/data-schemas');
const { normalizeAddress } = require('./entitlements');

const DEFAULT_PLAN_CATALOG = [
  {
    id: 'starter',
    label: 'Starter',
    plmAmount: '10',
    creditsGranted: 2000000,
  },
  {
    id: 'pro',
    label: 'Pro',
    plmAmount: '50',
    creditsGranted: 12000000,
  },
  {
    id: 'max',
    label: 'Max',
    plmAmount: '200',
    creditsGranted: 60000000,
  },
];

function toWei(plmAmount) {
  return ethers.utils.parseUnits(String(plmAmount), 18).toString();
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return null;
  }

  const id = String(plan.id || '').trim();
  const label = String(plan.label || id).trim();
  const plmAmount = String(plan.plmAmount || '').trim();
  const creditsGranted = Number(plan.creditsGranted);

  if (!id || !label || !plmAmount || !Number.isFinite(creditsGranted) || creditsGranted <= 0) {
    return null;
  }

  try {
    return {
      id,
      label,
      plmAmount,
      plmAmountWei: toWei(plmAmount),
      creditsGranted: Math.floor(creditsGranted),
    };
  } catch {
    return null;
  }
}

function getPlanCatalog() {
  const raw = process.env.PLUM_PLAN_CATALOG_JSON;
  if (!raw) {
    return DEFAULT_PLAN_CATALOG.map(normalizePlan).filter(Boolean);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_PLAN_CATALOG.map(normalizePlan).filter(Boolean);
    }

    const plans = parsed.map(normalizePlan).filter(Boolean);
    return plans.length > 0 ? plans : DEFAULT_PLAN_CATALOG.map(normalizePlan).filter(Boolean);
  } catch {
    return DEFAULT_PLAN_CATALOG.map(normalizePlan).filter(Boolean);
  }
}

function getPlanById(planId) {
  if (!planId) {
    return null;
  }
  return getPlanCatalog().find((plan) => plan.id === planId) || null;
}

function getPaymentConfig() {
  const chainRpcUrl = (process.env.PLUM_CHAIN_RPC_URL || '').trim();
  const treasuryAddress = normalizeAddress(process.env.PLUM_PAYMENT_TREASURY || '');
  const chainId = process.env.PLUM_CHAIN_ID ? Number(process.env.PLUM_CHAIN_ID) : undefined;
  const minConfirmations = Number(process.env.PLUM_PAYMENT_MIN_CONFIRMATIONS || 1);

  return {
    chainRpcUrl,
    treasuryAddress,
    chainId: Number.isFinite(chainId) ? chainId : undefined,
    minConfirmations:
      Number.isFinite(minConfirmations) && minConfirmations > 0 ? minConfirmations : 1,
  };
}

/**
 * #6: 서버 부트 시 결제 설정 유효성 검증.
 * 필수 ENV가 하나라도 설정되어 있으면 나머지도 모두 있어야 한다.
 * 결제 ENV가 전혀 없으면 결제 기능 비활성 상태로 간주하고 경고만 출력.
 */
function validatePaymentConfigOnBoot() {
  const rpc = (process.env.PLUM_CHAIN_RPC_URL || '').trim();
  const treasury = (process.env.PLUM_PAYMENT_TREASURY || '').trim();
  const chainId = (process.env.PLUM_CHAIN_ID || '').trim();

  const anySet = rpc || treasury || chainId;
  if (!anySet) {
    logger.warn('[Plum] No payment ENV configured — billing endpoint will return 503.');
    return;
  }

  const errors = [];
  if (!rpc) {
    errors.push('PLUM_CHAIN_RPC_URL is missing');
  }
  if (!treasury) {
    errors.push('PLUM_PAYMENT_TREASURY is missing');
  } else if (!normalizeAddress(treasury)) {
    errors.push('PLUM_PAYMENT_TREASURY is not a valid Ethereum address');
  }
  if (!chainId) {
    errors.push('PLUM_CHAIN_ID is missing');
  } else if (!Number.isFinite(Number(chainId))) {
    errors.push('PLUM_CHAIN_ID is not a valid number');
  }

  if (errors.length > 0) {
    logger.error(`[Plum] Payment config incomplete: ${errors.join('; ')}`);
  } else {
    logger.info(
      `[Plum] Payment config OK — chainId=${chainId}, treasury=${normalizeAddress(treasury)}`,
    );
  }
}

module.exports = {
  getPlanCatalog,
  getPlanById,
  getPaymentConfig,
  validatePaymentConfigOnBoot,
};
