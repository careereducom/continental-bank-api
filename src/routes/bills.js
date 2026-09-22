const router = require('express').Router();
const auth = require('../middleware/auth');
const prisma = require('../config/db');

const BILLERS = [
  { id: 'conedison', name: 'Con Edison — New York', category: 'Utility' },
  { id: 'pge',       name: 'Pacific Gas & Electric — California', category: 'Utility' },
  { id: 'aep',       name: 'American Electric Power — Ohio', category: 'Utility' },
  { id: 'att',       name: 'AT&T Wireless', category: 'Telecom' },
  { id: 'verizon',   name: 'Verizon Fios', category: 'Telecom' },
  { id: 'comcast',   name: 'Comcast Xfinity', category: 'Telecom' },
  { id: 'tmobile',   name: 'T-Mobile USA', category: 'Telecom' },
  { id: 'bell',      name: 'Bell Canada — Ontario', category: 'Telecom' },
  { id: 'hydro',     name: 'Hydro-Quebec', category: 'Utility' },
  { id: 'rogers',    name: 'Rogers Communications', category: 'Telecom' },
  { id: 'telmex',    name: 'Telmex — Ciudad de Mexico', category: 'Telecom' },
  { id: 'cfe',       name: 'CFE — Comision Federal de Electricidad', category: 'Utility' },
  { id: 'netflix',   name: 'Netflix', category: 'Subscription' },
  { id: 'spotify',   name: 'Spotify', category: 'Subscription' },
  { id: 'apple',     name: 'Apple Services', category: 'Subscription' },
];

router.get('/billers', auth, (req, res) => res.json(BILLERS));

router.post('/pay', auth, async (req, res) => {
  try {
    const { accountId, biller, customerId, amount, transferCode } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!customerId) return res.status(400).json({ error: 'Customer ID required' });

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.userId !== req.userId) return res.status(403).json({ error: 'Access denied' });
    if (account.transferCode !== transferCode) {
      return res.status(403).json({ error: 'Incorrect transfer code' });
    }
    if (Number(account.balance) < amount) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({
        where: { id: accountId },
        data: { balance: { decrement: amount } }
      });

      const payment = await tx.billPayment.create({
        data: {
          reference: 'BP' + Date.now() + Math.floor(Math.random() * 90 + 10),
          biller,
          customerId,
          amount,
          accountId,
          userId: req.userId
        }
      });

      await tx.transaction.create({
        data: {
          reference: 'BTX' + Date.now() + Math.floor(Math.random() * 90 + 10),
          amount,
          status: 'SUCCESS',
          type: 'BILL',
          category: 'UTILITY',
          description: `${biller} — ${customerId}`,
          balanceAfter: updated.balance,
          fromAccountId: accountId,
          initiatedBy: req.userId
        }
      });

      return payment;
    });

    res.json({ success: true, payment: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', auth, async (req, res) => {
  const payments = await prisma.billPayment.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  res.json(payments);
});

module.exports = router;
