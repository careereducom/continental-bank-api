/**
 * Notification API.
 *
 *   GET  /api/notifications         — list user's notifications (latest 50)
 *   GET  /api/notifications/count   — unread count
 *   POST /api/notifications/:id/read — mark as read
 *   POST /api/notifications/read-all — mark all as read
 */
const router = require('express').Router();
const auth   = require('../middleware/auth');
const prisma = require('../config/db');

// List notifications (latest 50)
router.get('/', auth, async (req, res) => {
  try {
    const items = await prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Unread count (for bell badge)
router.get('/count', auth, async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.userId, status: 'UNREAD' },
    });
    res.json({ unread: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark one as read
router.post('/:id/read', auth, async (req, res) => {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif || notif.userId !== req.userId) {
      return res.status(404).json({ error: 'Not found' });
    }
    await prisma.notification.update({
      where: { id: notif.id },
      data:  { status: 'READ' },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark all as read
router.post('/read-all', auth, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.userId, status: 'UNREAD' },
      data:  { status: 'READ' },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;