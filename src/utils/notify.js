/**
 * Notification helper.
 *
 * Creates in-app notifications for users. Every transfer, settlement,
 * or failed action generates a notification the user sees in the bell icon.
 */
const prisma = require('../config/db');

async function createNotification(userId, type, title, body, opts = {}) {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        reference: opts.reference || null,
        amount:    opts.amount    || null,
        status:    opts.status    || 'UNREAD',
      }
    });
  } catch (err) {
    console.error('[notify] failed:', err.message);
    return null;
  }
}

async function createManyNotifications(items) {
  try {
    return await prisma.notification.createMany({ data: items });
  } catch (err) {
    console.error('[notify] bulk failed:', err.message);
    return null;
  }
}

module.exports = { createNotification, createManyNotifications };