const prisma = require('../config/db');

module.exports = async (req, res, next) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user?.isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
};
