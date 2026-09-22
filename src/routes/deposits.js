const router = require('express').Router();
const auth = require('../middleware/auth');
const prisma = require('../config/db');

router.post('/', auth, async (req, res) => {
  try {
    const { accountId, amount, checkImage } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!checkImage) return res.status(400).json({ error: 'Check image required' });
    if (checkImage.length > 8_000_000) return res.status(400).json({ error: 'Image too large (max ~6MB)' });

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.userId !== req.userId) return res.status(403).json({ error: 'Access denied' });

    const deposit = await prisma.deposit.create({
      data: {
        reference: 'MD' + Date.now() + Math.floor(Math.random() * 90 + 10),
        amount,
        checkImage,
        accountId,
        userId: req.userId,
        status: 'PENDING'
      }
    });

    res.json({
      success: true,
      deposit,
      message: 'Check submitted. Funds will be available after review.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', auth, async (req, res) => {
  const deposits = await prisma.deposit.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  res.json(deposits);
});

module.exports = router;
