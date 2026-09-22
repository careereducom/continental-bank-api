const router = require('express').Router();
const auth = require('../middleware/auth');
const prisma = require('../config/db');

const CARRIERS = ['FedEx Priority Overnight', 'UPS Next Day Air', 'USPS Priority Mail'];

router.get('/', auth, async (req, res) => {
  const cards = await prisma.card.findMany({
    where: { userId: req.userId },
    orderBy: { orderedAt: 'desc' }
  });
  res.json(cards.map(c => ({
    ...c,
    cardNumber: c.status === 'ACTIVE' && c.type === 'VIRTUAL' ? c.cardNumber : null,
    cvv: c.status === 'ACTIVE' && c.type === 'VIRTUAL' ? c.cvv : null,
  })));
});

router.post('/order-physical', auth, async (req, res) => {
  const {
    accountId,
    shippingLine1, shippingLine2, shippingCity,
    shippingState, shippingZip, shippingCountry
  } = req.body;

  if (!shippingLine1 || !shippingCity || !shippingState || !shippingZip || !shippingCountry) {
    return res.status(400).json({ error: 'Complete shipping address required.' });
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || account.userId !== req.userId) {
    return res.status(403).json({ error: 'Account not found.' });
  }

  const existing = await prisma.card.findFirst({
    where: { userId: req.userId, type: 'PHYSICAL', status: { in: ['SHIPPED', 'ACTIVE'] } }
  });
  if (existing) return res.status(400).json({ error: 'A physical card is already on file.' });

  const now = new Date();
  const eta = new Date(now.getTime() + 5 * 24 * 3600 * 1000);
  const carrier = CARRIERS[Math.floor(Math.random() * CARRIERS.length)];
  const tracking = carrier.slice(0, 3).toUpperCase() + String(Date.now()).slice(-12);
  const cardNumber = '4' + String(Date.now()).slice(-14) + Math.floor(Math.random() * 10);

  const card = await prisma.card.create({
    data: {
      cardNumber,
      last4: cardNumber.slice(-4),
      brand: 'VISA',
      type: 'PHYSICAL',
      status: 'SHIPPED',
      expiryMonth: now.getMonth() + 1,
      expiryYear: now.getFullYear() + 4,
      cvv: String(Math.floor(100 + Math.random() * 900)),
      holderName: account.accountName,
      accountId: account.id,
      userId: req.userId,
      shippingLine1, shippingLine2: shippingLine2 || null,
      shippingCity, shippingState, shippingZip, shippingCountry,
      trackingNumber: tracking,
      carrier,
      shippedAt: now,
      estimatedDelivery: eta,
    }
  });

  res.json({
    success: true,
    card: { ...card, cardNumber: null, cvv: null },
    message: `Your card is on its way. Expected delivery by ${eta.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`,
  });
});

router.post('/:id/freeze', auth, async (req, res) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!card || card.userId !== req.userId) return res.status(403).json({ error: 'Card not found.' });
  const newStatus = card.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN';
  await prisma.card.update({ where: { id: card.id }, data: { status: newStatus } });
  res.json({ success: true, status: newStatus });
});

module.exports = router;
