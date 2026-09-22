const prisma = require('../config/db');

module.exports = (action) => async (req, res, next) => {
  const original = res.json.bind(res);
  res.json = async (body) => {
    try {
      await prisma.auditLog.create({
        data: {
          action,
          userId: req.userId || null,
          ip: req.ip || null,
          ua: req.headers['user-agent'] || 'unknown',
          path: req.originalUrl,
          success: res.statusCode < 400,
          detail: body?.error || null,
        }
      });
    } catch (e) { /* swallow */ }
    return original(body);
  };
  next();
};
