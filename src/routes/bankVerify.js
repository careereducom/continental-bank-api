const router = require('express').Router();
const auth = require('../middleware/auth');
const prisma = require('../config/db');

router.get('/verify', auth, async (req, res) => {
  const { accountNumber, routingNumber } = req.query;

  if (!accountNumber || !routingNumber) {
    return res.status(400).json({ error: 'Missing account or routing number' });
  }

  try {
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
      // Simulate a real bank response with a slight delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // In a real demo, we could generate a random name to show it "works" 
      // but for a PhD, it's better to be honest or have a set of test data.
      res.json({ verified: false, message: 'Account not found in the global registry' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification service error' });
  }
});

module.exports = router;
