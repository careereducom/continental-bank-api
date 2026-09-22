const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const auth    = require('../middleware/auth');
const prisma  = require('../config/db');
const { Prisma } = require('@prisma/client');
const { resolveBank, isOurBank } = require('../config/usBanks');
const { createNotification }    = require('../utils/notify');
const { sendOtpEmail }          = require('../config/mailer');
const { resolveExternalName }   = require('../config/externalNames');

function makeRef(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() +
         Math.random().toString(36).slice(2, 6).toUpperCase();
}

function getOtpRecipient(user) {
  if (!user.email) return process.env.DEMO_EMAIL || user.email;
  if (user.email.endsWith('@cfbank.com')) return process.env.DEMO_EMAIL || user.email;
  return user.email;
}

const MAX_PIN_ATTEMPTS = 3;
const PIN_LOCK_MINUTES = 30;
const OTP_EXPIRY_MIN   = 10;
const OTP_MAX_ATTEMPTS = 3;

async function verifyPin(account, code) {
  if (account.transferCodeHash) {
    return bcrypt.compare(code, account.transferCodeHash);
  }
  return account.transferCode === code;
}

// ============================================================
// POST /api/transfers/initiate
// Step 1 - verify PIN, store pending action, send OTP
// ============================================================
router.post('/initiate', auth, async (req, res) => {
  try {
    const { fromAccountId, toAccountNumber, toRoutingNumber, amount, transferCode } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!toAccountNumber) return res.status(400).json({ error: 'Recipient account required' });
    if (!transferCode) return res.status(400).json({ error: 'Transfer PIN required' });

    const sender = await prisma.account.findUnique({
      where: { id: fromAccountId },
      include: { user: true },
    });
    if (!sender) return res.status(404).json({ error: 'Sender account not found' });
    if (sender.userId !== req.userId) return res.status(403).json({ error: 'Access denied' });

    const senderUser = sender.user;

    if (senderUser.pinLockedUntil && new Date() < senderUser.pinLockedUntil) {
      const minsLeft = Math.ceil((new Date(senderUser.pinLockedUntil) - new Date()) / 60000);
      return res.status(403).json({
        error: `Account locked due to too many incorrect transfer codes. Try again in ${minsLeft} minutes.`
      });
    }

    const pinOk = await verifyPin(sender, transferCode);
    if (!pinOk) {
      const attempts = (senderUser.pinAttempts || 0) + 1;
      const updates = { pinAttempts: attempts };
      if (attempts >= MAX_PIN_ATTEMPTS) {
        updates.pinLockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000);
      }
      await prisma.user.update({ where: { id: senderUser.id }, data: updates });

      if (attempts >= MAX_PIN_ATTEMPTS) {
        await createNotification(senderUser.id, 'FAILED',
          'Account temporarily locked',
          `Too many incorrect transfer codes. Locked for ${PIN_LOCK_MINUTES} minutes.`);
        return res.status(403).json({
          error: `Too many incorrect attempts. Account locked for ${PIN_LOCK_MINUTES} minutes.`
        });
      }
      const remaining = MAX_PIN_ATTEMPTS - attempts;
      return res.status(403).json({
        error: `Incorrect transfer code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      });
    }

    if ((senderUser.pinAttempts > 0) || senderUser.pinLockedUntil) {
      await prisma.user.update({
        where: { id: senderUser.id },
        data:  { pinAttempts: 0, pinLockedUntil: null }
      });
    }

    const available = Number(sender.balance) - Number(sender.pendingOut || 0);
    if (available < amount) {
      return res.status(400).json({
        error: 'Insufficient available balance. Available: $' +
          available.toLocaleString('en-US', { minimumFractionDigits: 2 })
      });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

    await prisma.pendingAction.deleteMany({
      where: { userId: req.userId, type: 'TRANSFER' }
    });

    const action = await prisma.pendingAction.create({
      data: {
        userId: req.userId,
        type: 'TRANSFER',
        payload: JSON.stringify({
          fromAccountId,
          toAccountNumber,
          toRoutingNumber,
          amount: Number(amount),
        }),
        otp,
        otpExpiry,
      }
    });

    const recipient = getOtpRecipient(senderUser);
    const masked = recipient.replace(/^(.{2}).*@/, '$1***@');

    sendOtpEmail(recipient, otp, senderUser.fullName)
      .then(() => console.log('[TRANSFER-OTP] Sent to ' + recipient))
      .catch(err => console.error('[TRANSFER-OTP] Failed:', err.message));

    res.json({
      success: true,
      otpRequired: true,
      pendingId: action.id,
      destination: masked,
      expiresIn: OTP_EXPIRY_MIN * 60,
      message: 'A 6-digit verification code has been sent to ' + masked + '.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initiate transfer' });
  }
});

// ============================================================
// POST /api/transfers/confirm
// Step 2 - verify OTP, execute transfer atomically
// ============================================================
router.post('/confirm', auth, async (req, res) => {
  try {
    const { pendingId, otp } = req.body;

    if (!pendingId) return res.status(400).json({ error: 'Missing pending transaction' });
    if (!otp) return res.status(400).json({ error: 'Verification code required' });

    const action = await prisma.pendingAction.findUnique({
      where: { id: pendingId },
      include: { user: true },
    });
    if (!action || action.userId !== req.userId || action.type !== 'TRANSFER') {
      return res.status(404).json({ error: 'Transaction not found or expired' });
    }

    if (new Date() > action.otpExpiry) {
      await prisma.pendingAction.delete({ where: { id: action.id } });
      return res.status(400).json({ error: 'Verification code expired. Please try again.' });
    }

    if (action.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.pendingAction.delete({ where: { id: action.id } });
      return res.status(403).json({ error: 'Too many attempts. Transaction cancelled.' });
    }

    if (action.otp !== otp.trim()) {
      await prisma.pendingAction.update({
        where: { id: action.id },
        data: { attempts: action.attempts + 1 }
      });
      const remaining = OTP_MAX_ATTEMPTS - (action.attempts + 1);
      return res.status(401).json({
        error: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      });
    }

    const { fromAccountId, toAccountNumber, toRoutingNumber, amount } =
      JSON.parse(action.payload);

    const sender = await prisma.account.findUnique({
      where: { id: fromAccountId },
      include: { user: true },
    });
    if (!sender) return res.status(404).json({ error: 'Sender account not found' });

    // Resolve recipient: internal -> admin directory -> simulated
    const recipient = await prisma.account.findUnique({
      where: { accountNumber: toAccountNumber },
      include: { user: true },
    });

    const isInternal = !!(recipient && recipient.isRegistered);
    
    // NEW: Also check if the account exists in our Global Bank Registry (Admin added)
    const registryEntry = await prisma.bankRegistry.findUnique({
      where: { accountNumber: toAccountNumber }
    });
    const isRegisteredExternal = !!registryEntry;

    const finalStatus = (isInternal || isRegisteredExternal) ? 'SUCCESS' : 'PENDING';

    let recipientName;
    let recipientBank;
    let recipientRouting;

    if (isInternal && recipient) {
      recipientName = recipient.accountName;
      recipientBank = 'Continental Federal Bank & Trust, New York, NY';
      recipientRouting = '021407912';
    } else if (isRegisteredExternal && registryEntry) {
      recipientName = registryEntry.accountName;
      recipientBank = registryEntry.bankName;
      recipientRouting = registryEntry.routingNumber;
    } else {
      const beneficiary = await prisma.externalBeneficiary.findUnique({
        where: { accountNumber: toAccountNumber },
      });

      if (beneficiary && beneficiary.isVerified) {
        recipientName = beneficiary.accountName;
        recipientBank = beneficiary.bankName;
        recipientRouting = beneficiary.routingNumber;
      } else {
        recipientName = resolveExternalName(toAccountNumber);
        recipientBank = toRoutingNumber ? resolveBank(toRoutingNumber) : 'Beneficiary Bank';
        recipientRouting = toRoutingNumber || '';
      }
    }

    const reference = makeRef('NB');
    const note = (isInternal || isRegisteredExternal)
      ? 'Transfer completed successfully.'
      : 'Inter-bank transfer initiated. Awaiting settlement confirmation.';

    // ATOMIC MONEY MOVE
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        // 1. Consume the pending action atomically - prevents replay
        const consumed = await tx.pendingAction.deleteMany({
          where: { id: action.id, otp: otp.trim() },
        });
        if (consumed.count !== 1) {
          const e = new Error('ALREADY_CONSUMED'); e.code = 'ALREADY_CONSUMED'; throw e;
        }

        // 2. Re-read sender INSIDE the tx and re-check available
        const freshSender = await tx.account.findUnique({ where: { id: fromAccountId } });
        if (!freshSender) {
          const e = new Error('SENDER_MISSING'); e.code = 'SENDER_MISSING'; throw e;
        }
        const freshAvailable = Number(freshSender.balance) - Number(freshSender.pendingOut || 0);
        if (freshAvailable < amount) {
          const e = new Error('INSUFFICIENT');
          e.code = 'INSUFFICIENT';
          e.available = freshAvailable;
          throw e;
        }

        // 3. Reserve on sender
        const updatedSender = await tx.account.update({
          where: { id: freshSender.id },
          data: { pendingOut: { increment: amount } },
        });

        // 4. Credit recipient (internal only)
        if (isInternal && recipient) {
          await tx.account.update({
            where: { id: recipient.id },
            data: { balance: { increment: amount } },
          });
        }

        // 5. Write the ledger entry
        return tx.transaction.create({
          data: {
            reference,
            amount,
            status: finalStatus,
            type: 'TRANSFER',
            category: isInternal ? 'INTERNAL' : 'INTERBANK',
            description: isInternal
              ? 'Transfer to ' + recipientName
              : 'Inter-bank transfer to ' + recipientName + ' at ' + recipientBank,
            balanceAfter: updatedSender.balance,
            note,
            isPending: !isInternal,
            fromAccountId: freshSender.id,
            toAccountId: recipient ? recipient.id : null,
            initiatedBy: req.userId,
          },
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      });
    } catch (e) {
      if (e.code === 'ALREADY_CONSUMED') {
        return res.status(409).json({ error: 'This transfer has already been processed.' });
      }
      if (e.code === 'INSUFFICIENT') {
        return res.status(400).json({ error: 'Insufficient funds. Balance changed since initiation.' });
      }
      if (e.code === 'SENDER_MISSING') {
        return res.status(404).json({ error: 'Sender account not found' });
      }
      if (e.code === 'P2034') {
        return res.status(409).json({ error: 'Transaction conflict. Please retry.' });
      }
      throw e;
    }

    const amountStr = '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 });

    await createNotification(
      sender.userId,
      'TRANSFER_OUT',
      isInternal || isRegisteredExternal ? 'Transfer sent' : 'Transfer initiated',
      (isInternal || isRegisteredExternal)
        ? amountStr + ' to ' + recipientName + ' (' + recipientBank + ') - completed.'
        : amountStr + ' to ' + recipientName + ' at ' + recipientBank + ' - pending settlement.',
      { reference, amount, status: finalStatus }
    );

    if ((isInternal && recipient) || isRegisteredExternal) {
      // If it's external but registry-verified, we treat it as a successful "demo" transfer
      // For internal, we notify the actual user. For registry, we just log it.
      if (isInternal && recipient) {
        await createNotification(
          recipient.userId,
          'TRANSFER_IN',
          'Funds received',
          amountStr + ' from ' + sender.accountName + ' - settled to your account.',
          { reference, amount, status: 'SUCCESS' }
        );
      }
    }

    res.json({
      success: true,
      receipt: {
        reference,
        date: result.createdAt,
        status: finalStatus,
        network: {
          network: isInternal ? 'Internal Transfer' : 'FedNow Service',
          settlementTime: isInternal ? 'Instant' : 'Instant (seconds)',
          networkCode: isInternal ? 'CFB_INTERNAL' : 'FEDNOW',
        },
        from: {
          name: sender.accountName,
          account: sender.accountNumber,
          bank: 'Continental Federal Bank & Trust, New York, NY',
          routing: '021407912',
        },
        to: {
          name: recipientName,
          account: toAccountNumber,
          bank: recipientBank,
          routing: recipientRouting,
        },
        amount: Number(amount),
        balanceAfter: Number(result.balanceAfter),
        note,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm transfer' });
  }
});

// ============================================================
// GET /api/transfers/history
// ============================================================
router.get('/history', auth, async (req, res) => {
  try {
    const userAccounts = await prisma.account.findMany({
      where: { userId: req.userId },
      select: { id: true }
    });
    const accountIds = userAccounts.map(a => a.id);

    const txns = await prisma.transaction.findMany({
      where: {
        OR: [
          { fromAccountId: { in: accountIds } },
          { toAccountId: { in: accountIds } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 500
    });

    res.json(txns);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
