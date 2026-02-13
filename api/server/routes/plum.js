const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const {
  getPlansController,
  getMeController,
  getUsageController,
  verifyPaymentController,
} = require('~/server/controllers/PlumController');

const router = express.Router();

router.get('/plans', getPlansController);

router.use(requireJwtAuth);
router.get('/me', getMeController);
router.get('/usage', getUsageController);
router.post('/payments/verify', verifyPaymentController);

module.exports = router;
