const router = require('express').Router();
const auth = require('../middleware/auth');
const prisma = require('../config/db');
const { resolveExternalName } = require('../config/externalNames');
const { resolveBank } = require('../config/usBanks');

router.get('/verify', auth, async (req, res) => {
  const { accountNumber, routingNumber } = req.query;

  if (!accountNumber || !routingNumber) {
    return res.status(400).json({ error: 'Missing account or routing number' });
  }

  try {
    // 1) Internal Continental Federal account first
    const internal = await prisma.account.findUnique({
      where: { accountNumber }
    });
    if (internal) {
      return res.json({
        verified: true,
        accountName: internal.accountName,
        bankName: 'Continental Federal Bank & Trust, New York, NY',
        routingNumber: '021407912',
        accountType: internal.accountType,
        internal: true,
      });
    }

    // 2) Admin-added verified external beneficiary
    const beneficiary = await prisma.externalBeneficiary.findUnique({
      where: { accountNumber }
    });
    if (beneficiary && beneficiary.isVerified) {
      return res.json({
        verified: true,
        accountName: beneficiary.accountName,
        bankName: beneficiary.bankName,
        routingNumber: beneficiary.routingNumber,
        accountType: beneficiary.accountType,
        beneficiary: true,
      });
    }

    // 3) Global bank registry (admin-managed)
    const record = await prisma.bankRegistry.findFirst({
      where: {
        accountNumber,
        routingNumber
      }
    });

    if (record) {
      res.json({
        verified: true,
        accountName: record.accountName,
        bankName: record.bankName,
        accountType: record.accountType
      });
    } else {
      // Simulated inter-bank name enquiry (FedNow-style network):
      // any external account resolves through the settlement network and
      // then awaits admin approval like a standard external transfer.
      await new Promise(resolve => setTimeout(resolve, 800));
      res.json({
        verified: true,
        accountName: resolveExternalName(accountNumber),
        bankName: resolveBank(routingNumber),
        routingNumber: String(routingNumber),
        accountType: 'checking',
        external: true,
        simulated: true
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification service error' });
  }
});

module.exports = router;
