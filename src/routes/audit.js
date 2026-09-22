const router = require('express').Router();
const auth = require('../middleware/auth');
const prisma = require('../config/db');

router.get('/me', auth, async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  res.json(logs);
});

module.exports = router;
