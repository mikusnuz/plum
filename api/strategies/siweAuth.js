const crypto = require('crypto');
const { ethers } = require('ethers');
const { logger } = require('@librechat/data-schemas');
const { isEnabled } = require('@librechat/api');
const { findUser, createUser, countUsers } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const { SystemRoles } = require('librechat-data-provider');

// In-memory nonce store with TTL (5분)
const nonceStore = new Map();
const NONCE_TTL = 5 * 60 * 1000;

// 만료된 nonce 정리 (10분마다)
setInterval(() => {
  const now = Date.now();
  for (const [nonce, data] of nonceStore) {
    if (now - data.createdAt > NONCE_TTL) {
      nonceStore.delete(nonce);
    }
  }
}, 10 * 60 * 1000);

function generateNonce() {
  const nonce = crypto.randomBytes(16).toString('hex');
  nonceStore.set(nonce, { createdAt: Date.now() });
  return nonce;
}

function verifyNonce(nonce) {
  const data = nonceStore.get(nonce);
  if (!data) return false;
  if (Date.now() - data.createdAt > NONCE_TTL) {
    nonceStore.delete(nonce);
    return false;
  }
  nonceStore.delete(nonce); // One-time use
  return true;
}

// SIWE 메시지에서 nonce와 address 파싱
function parseSiweMessage(message) {
  const lines = message.split('\n');
  const result = {};

  // 첫 줄: "{domain} wants you to sign in with your Ethereum account:"
  // 둘째 줄: address
  if (lines.length >= 2) {
    result.address = lines[1].trim();
  }

  for (const line of lines) {
    if (line.startsWith('Nonce: ')) result.nonce = line.slice(7).trim();
    if (line.startsWith('Chain ID: ')) result.chainId = parseInt(line.slice(10).trim());
    if (line.startsWith('URI: ')) result.uri = line.slice(5).trim();
    if (line.startsWith('Issued At: ')) result.issuedAt = line.slice(11).trim();
  }

  return result;
}

async function verifySiweSignature(message, signature) {
  try {
    const recoveredAddress = ethers.utils.verifyMessage(message, signature);
    const parsed = parseSiweMessage(message);

    if (!parsed.address) {
      throw new Error('Could not parse address from SIWE message');
    }

    if (!parsed.nonce) {
      throw new Error('Could not parse nonce from SIWE message');
    }

    // Case-insensitive address comparison
    if (recoveredAddress.toLowerCase() !== parsed.address.toLowerCase()) {
      throw new Error('Recovered address does not match claimed address');
    }

    // Verify nonce
    if (!verifyNonce(parsed.nonce)) {
      throw new Error('Invalid or expired nonce');
    }

    // Verify issuedAt is not too old (10 minutes max)
    if (parsed.issuedAt) {
      const issuedAt = new Date(parsed.issuedAt).getTime();
      if (Date.now() - issuedAt > 10 * 60 * 1000) {
        throw new Error('Message too old');
      }
    }

    return {
      address: ethers.utils.getAddress(recoveredAddress), // checksummed
      chainId: parsed.chainId,
    };
  } catch (err) {
    logger.error('[SIWE] Verification failed:', err.message);
    throw err;
  }
}

async function findOrCreateSiweUser(address) {
  const checksumAddress = ethers.utils.getAddress(address);

  // 1. Find by ethereumAddress
  let user = await findUser({ ethereumAddress: checksumAddress });
  if (user) {
    return user;
  }

  // 2. Create new user
  const appConfig = await getAppConfig();
  const isFirstUser = (await countUsers()) === 0;

  // Generate a pseudo-email for the user (required by schema)
  const shortAddr = checksumAddress.slice(2, 8).toLowerCase();
  const email = `${shortAddr}@wallet.plumise.com`;

  const newUser = await createUser(
    {
      provider: 'siwe',
      email,
      username: `${checksumAddress.slice(0, 6)}...${checksumAddress.slice(-4)}`,
      name: `${checksumAddress.slice(0, 6)}...${checksumAddress.slice(-4)}`,
      avatar: null,
      role: isFirstUser ? SystemRoles.ADMIN : SystemRoles.USER,
      ethereumAddress: checksumAddress,
      emailVerified: true, // wallet-based login, no email verification needed
    },
    appConfig.balance,
    true, // disableTTL
    true, // returnNewUser
  );

  logger.info(`[SIWE] New user created: ${checksumAddress}`);
  return newUser;
}

module.exports = {
  generateNonce,
  verifySiweSignature,
  findOrCreateSiweUser,
};
