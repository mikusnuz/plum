const express = require('express');
const { createSetBalanceConfig, isEnabled } = require('@librechat/api');
const {
  resetPasswordRequestController,
  resetPasswordController,
  registrationController,
  graphTokenController,
  refreshController,
} = require('~/server/controllers/AuthController');
const {
  regenerateBackupCodes,
  disable2FA,
  confirm2FA,
  enable2FA,
  verify2FA,
} = require('~/server/controllers/TwoFactorController');
const { verify2FAWithTempToken } = require('~/server/controllers/auth/TwoFactorAuthController');
const { logoutController } = require('~/server/controllers/auth/LogoutController');
const { loginController } = require('~/server/controllers/auth/LoginController');
const { getAppConfig } = require('~/server/services/Config');
const middleware = require('~/server/middleware');
const { Balance } = require('~/db/models');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  Balance,
});

const router = express.Router();

const ldapAuth = !!process.env.LDAP_URL && !!process.env.LDAP_USER_SEARCH_BASE;
//Local
router.post('/logout', middleware.requireJwtAuth, logoutController);
router.post(
  '/login',
  middleware.logHeaders,
  middleware.loginLimiter,
  middleware.checkBan,
  ldapAuth ? middleware.requireLdapAuth : middleware.requireLocalAuth,
  setBalanceConfig,
  loginController,
);
router.post('/refresh', refreshController);
router.post(
  '/register',
  middleware.registerLimiter,
  middleware.checkBan,
  middleware.checkInviteUser,
  middleware.validateRegistration,
  registrationController,
);
router.post(
  '/requestPasswordReset',
  middleware.resetPasswordLimiter,
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordRequestController,
);
router.post(
  '/resetPassword',
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordController,
);

router.get('/2fa/enable', middleware.requireJwtAuth, enable2FA);
router.post('/2fa/verify', middleware.requireJwtAuth, verify2FA);
router.post('/2fa/verify-temp', middleware.checkBan, verify2FAWithTempToken);
router.post('/2fa/confirm', middleware.requireJwtAuth, confirm2FA);
router.post('/2fa/disable', middleware.requireJwtAuth, disable2FA);
router.post('/2fa/backup/regenerate', middleware.requireJwtAuth, regenerateBackupCodes);

router.get('/graph-token', middleware.requireJwtAuth, graphTokenController);

// SIWE Routes
if (isEnabled(process.env.ALLOW_SIWE_LOGIN)) {
  const { generateNonce, verifySiweSignature, findOrCreateSiweUser } = require('~/strategies/siweAuth');
  const { setAuthTokens } = require('~/server/services/AuthService');

  router.get('/siwe/nonce', (req, res) => {
    const nonce = generateNonce();
    res.json({ nonce });
  });

  router.post(
    '/siwe/verify',
    middleware.loginLimiter,
    middleware.checkBan,
    async (req, res) => {
      try {
        const { message, signature } = req.body;

        if (!message || !signature) {
          return res.status(400).json({ message: 'Message and signature are required' });
        }

        const { address } = await verifySiweSignature(message, signature);
        const user = await findOrCreateSiweUser(address);

        if (user.twoFactorEnabled) {
          const { generate2FATempToken } = require('~/server/services/twoFactorService');
          const tempToken = generate2FATempToken(user._id);
          return res.status(200).json({ twoFAPending: true, tempToken });
        }

        const { password: _p, totpSecret: _t, __v, ...userData } = user.toObject ? user.toObject() : user;
        userData.id = userData._id.toString();

        const token = await setAuthTokens(user._id, res);
        return res.status(200).json({ token, user: userData });
      } catch (err) {
        const { logger } = require('@librechat/data-schemas');
        logger.error('[SIWE] Verify error:', err.message);
        return res.status(401).json({ message: err.message || 'SIWE verification failed' });
      }
    },
  );
}

module.exports = router;
