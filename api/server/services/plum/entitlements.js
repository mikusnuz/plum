const { ethers } = require('ethers');

let cachedAllowlistRaw = null;
let cachedAllowlist = new Set();

function normalizeAddress(address) {
  if (typeof address !== 'string' || address.trim().length === 0) {
    return null;
  }

  try {
    return ethers.utils.getAddress(address.trim());
  } catch {
    return null;
  }
}

function parseAddressAllowlist(raw) {
  const addresses = new Set();

  if (!raw) {
    return addresses;
  }

  for (const value of raw.split(',')) {
    const normalized = normalizeAddress(value);
    if (normalized) {
      addresses.add(normalized);
    }
  }

  return addresses;
}

function getAgentFreeWalletSet() {
  const raw = (process.env.PLUM_AGENT_FREE_WALLETS || '').trim();
  if (raw === cachedAllowlistRaw) {
    return cachedAllowlist;
  }

  cachedAllowlistRaw = raw;
  cachedAllowlist = parseAddressAllowlist(raw);
  return cachedAllowlist;
}

function hasAgentFreeWalletConfig() {
  return getAgentFreeWalletSet().size > 0;
}

function isAgentFreeWallet(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return false;
  }

  return getAgentFreeWalletSet().has(normalized);
}

function getUserWalletAddress(user) {
  return normalizeAddress(user?.ethereumAddress);
}

function resolveUserEntitlement(user) {
  const walletAddress = getUserWalletAddress(user);
  const isAgentFree = !!walletAddress && isAgentFreeWallet(walletAddress);

  return {
    walletAddress,
    isAgentFree,
    billingMode: isAgentFree ? 'agent-free' : 'paid',
  };
}

module.exports = {
  normalizeAddress,
  isAgentFreeWallet,
  hasAgentFreeWalletConfig,
  getUserWalletAddress,
  resolveUserEntitlement,
};
