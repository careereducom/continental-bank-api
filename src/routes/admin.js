const router = require('express').Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/admin');
const prisma = require('../config/db');
const { sendEmail } = require('../config/mailer');

// ============================================================
// PENDING TRANSFERS
// ============================================================
router.get('/pending', auth, adminOnly, async (req, res) => {
  const txns = await prisma.transaction.findMany({
    where: { status: 'PENDING', type: 'TRANSFER' },
    include: { fromAccount: true, toAccount: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(txns);
});

router.get('/deposits/pending', auth, adminOnly, async (req, res) => {
  const deps = await prisma.deposit.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' }
  });
  res.json(deps);
});

router.get('/credentials', auth, adminOnly, async (req, res) => {
  const accounts = await prisma.account.findMany({
    include: { user: { select: { username: true, fullName: true, email: true } } },
    orderBy: { accountNumber: 'asc' }
  });

  res.json(accounts.map(a => ({
    id:            a.id,
    accountNumber: a.accountNumber,
    accountName:   a.accountName,
    balance:       Number(a.balance),
    username:      a.user.username,
    email:         a.user.email,
    transferCode:  a.transferCode,
  })));
});

// ============================================================
// BANK REGISTRY — named external accounts eligible for instant ACH
// ============================================================
router.get('/bank-registry', auth, adminOnly, async (req, res) => {
  const entries = await prisma.bankRegistry.findMany({
    orderBy: { createdAt: 'desc' }
  });
  res.json(entries);
});

router.post('/bank-registry', auth, adminOnly, async (req, res) => {
  try {
    const { accountNumber, routingNumber, accountName, bankName, accountType } = req.body;
    if (!accountNumber || !routingNumber || !accountName || !bankName) {
      return res.status(400).json({ error: 'Account, routing, name and bank are required' });
    }
    if (!/^\d{8,17}$/.test(String(accountNumber))) {
      return res.status(400).json({ error: 'Account number must be 8–17 digits' });
    }
    if (!/^\d{9}$/.test(String(routingNumber))) {
      return res.status(400).json({ error: 'Routing number must be exactly 9 digits' });
    }
    const entry = await prisma.bankRegistry.create({
      data: {
        accountNumber: String(accountNumber),
        routingNumber: String(routingNumber),
        accountName:   String(accountName).toUpperCase(),
        bankName:      String(bankName),
        accountType:   accountType || 'checking',
      }
    });
    res.json({ success: true, entry });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'That account number already exists in the registry' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to add registry entry' });
  }
});

router.put('/bank-registry/:id', auth, adminOnly, async (req, res) => {
  try {
    const { accountNumber, routingNumber, accountName, bankName, accountType } = req.body;
    const existing = await prisma.bankRegistry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Registry entry not found' });
    const entry = await prisma.bankRegistry.update({
      where: { id: req.params.id },
      data: {
        accountNumber: accountNumber || existing.accountNumber,
        routingNumber: routingNumber || existing.routingNumber,
        accountName:   accountName ? String(accountName).toUpperCase() : existing.accountName,
        bankName:      bankName || existing.bankName,
        accountType:   accountType || existing.accountType,
      }
    });
    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update registry entry' });
  }
});

router.delete('/bank-registry/:id', auth, adminOnly, async (req, res) => {
  try {
    await prisma.bankRegistry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove registry entry' });
  }
});

// ============================================================
// APPROVE external transfer
// Release hold from pendingOut AND debit sender.balance
// ============================================================
router.post('/transfers/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const txn = await prisma.transaction.findUnique({ where: { id } });
    if (!txn || txn.status !== 'PENDING') {
      return res.status(400).json({ error: 'Not a pending transaction' });
    }

    const amount = Number(txn.amount);

    await prisma.$transaction(async (tx) => {
      const sender = await tx.account.findUnique({ where: { id: txn.fromAccountId } });
      if (!sender) throw new Error('Sender account not found');

      const newBalance = Number(sender.balance) - amount;
      const newPending = Math.max(0, Number(sender.pendingOut || 0) - amount);

      await tx.account.update({
        where: { id: txn.fromAccountId },
        data: {
          balance:    newBalance,
          pendingOut: newPending,
        }
      });

      if (txn.toAccountId) {
        await tx.account.update({
          where: { id: txn.toAccountId },
          data: { balance: { increment: amount } }
        });
      }

      await tx.transaction.update({
        where: { id },
        data: {
          status: 'SUCCESS',
          note: 'Approved by operations — settlement confirmed',
          balanceAfter: newBalance,
          resolvedAt: new Date(),
          resolvedBy: req.userId
        }
      });
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// REJECT external transfer
// Release hold only — money never actually left the account
// ============================================================
router.post('/transfers/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const txn = await prisma.transaction.findUnique({ where: { id } });
    if (!txn || txn.status !== 'PENDING') {
      return res.status(400).json({ error: 'Not a pending transaction' });
    }

    const amount = Number(txn.amount);

    await prisma.$transaction(async (tx) => {
      const sender = await tx.account.findUnique({ where: { id: txn.fromAccountId } });
      if (!sender) throw new Error('Sender account not found');

      const newPending = Math.max(0, Number(sender.pendingOut || 0) - amount);

      await tx.account.update({
        where: { id: txn.fromAccountId },
        data: { pendingOut: newPending }
      });

      await tx.transaction.update({
        where: { id },
        data: {
          status: 'REJECTED',
          note: 'Rejected by operations — funds returned to sender',
          resolvedAt: new Date(),
          resolvedBy: req.userId
        }
      });
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DEPOSITS
// ============================================================
router.post('/deposits/:id/approve', auth, adminOnly, async (req, res) => {
  const { id } = req.params;
  const dep = await prisma.deposit.findUnique({ where: { id } });
  if (!dep || dep.status !== 'PENDING') {
    return res.status(400).json({ error: 'Not pending' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: dep.accountId },
      data: { balance: { increment: dep.amount } }
    });
    await tx.deposit.update({
      where: { id },
      data: { status: 'APPROVED', resolvedAt: new Date() }
    });
  });

  res.json({ success: true });
});

router.post('/deposits/:id/reject', auth, adminOnly, async (req, res) => {
  await prisma.deposit.update({
    where: { id: req.params.id },
    data: { status: 'REJECTED', resolvedAt: new Date() }
  });
  res.json({ success: true });
});

// ============================================================
// KYC APPLICATIONS
// ============================================================

router.get('/applications', auth, adminOnly, async (req, res) => {
  const apps = await prisma.user.findMany({
    where: { approvalStatus: 'PENDING', isAdmin: false },
    select: {
      id: true, username: true, fullName: true, email: true, phone: true,
      addressLine1: true, addressLine2: true, city: true, state: true,
      postalCode: true, country: true, dateOfBirth: true, ssnLast4: true,
      kycStatus: true, approvalStatus: true, signupIp: true,
      signupLocation: true, signupUserAgent: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(apps);
});

router.get('/applications/approved', auth, adminOnly, async (req, res) => {
  const apps = await prisma.user.findMany({
    where: { approvalStatus: 'APPROVED', isAdmin: false },
    select: {
      id: true, username: true, fullName: true, email: true,
      approvedAt: true, accessCodeExpiry: true, createdAt: true,
    },
    orderBy: { approvedAt: 'desc' },
  });
  res.json(apps);
});

router.get('/applications/rejected', auth, adminOnly, async (req, res) => {
  const apps = await prisma.user.findMany({
    where: { approvalStatus: 'REJECTED', isAdmin: false },
    select: {
      id: true, username: true, fullName: true, email: true,
      rejectedReason: true, approvedAt: true, createdAt: true,
    },
    orderBy: { approvedAt: 'desc' },
    take: 100,
  });
  res.json(apps);
});

router.post('/applications/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Application not found' });
    if (user.approvalStatus !== 'PENDING') {
      return res.status(400).json({ error: 'Application is not pending' });
    }

    const accessCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        approvalStatus: 'APPROVED',
        accessCode,
        accessCodeExpiry: expiry,
        approvedAt: new Date(),
        approvedBy: req.userId,
      }
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #f4f6fa; padding: 30px;">
        <div style="background: #0f2b5b; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 20px; letter-spacing: 1px;">CONTINENTAL FEDERAL</h1>
          <p style="color: #c9a227; margin: 4px 0 0; font-size: 11px; letter-spacing: 3px;">BANK &amp; TRUST</p>
        </div>
        <div style="background: #fff; padding: 30px; border-radius: 0 0 8px 8px;">
          <h2 style="color: #0f2b5b; font-size: 18px; margin-top: 0;">Your Application is Approved</h2>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">Dear ${user.fullName},</p>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">
            Welcome to Continental Federal Bank &amp; Trust. Your application has been approved.
            To activate your account, please use the access code below.
          </p>
          <div style="background: #f4f6fa; border: 1px dashed #c9a227; padding: 20px; text-align: center; margin: 24px 0; border-radius: 8px;">
            <p style="font-size: 11px; letter-spacing: 3px; color: #666; margin: 0 0 8px;">YOUR ACCESS CODE</p>
            <p style="font-size: 36px; letter-spacing: 12px; font-family: monospace; color: #0f2b5b; margin: 0; font-weight: bold;">${accessCode}</p>
          </div>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">
            <strong>To activate your account:</strong><br>
            1. Go to the Continental Federal login page.<br>
            2. Click "Activate Account".<br>
            3. Enter your account number <strong>${user.username}</strong> and the access code above.<br>
            4. Once activated, you can sign in normally.
          </p>
          <p style="color: #b45309; background: #fef3c7; padding: 12px; border-radius: 6px; font-size: 13px; margin-top: 20px;">
            ⚠ <strong>Important:</strong> This access code expires in 24 hours.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #999; font-size: 11px; text-align: center; margin: 0;">
            Continental Federal Bank &amp; Trust · Member FDIC · Equal Housing Lender
          </p>
        </div>
      </div>
    `;

    let emailSent = true;
    try {
      await sendEmail({
        to: user.email,
        toName: user.fullName,
        subject: 'Account Approved — Your Access Code',
        html,
      });
      console.log(`[KYC] Approval email sent to ${user.email}`);
    } catch (err) {
      emailSent = false;
      console.error('[KYC] Approval email failed:', err.message);
    }

    await prisma.auditLog.create({
      data: {
        action: 'KYC_APPROVE',
        userId: req.userId,
        path: `/api/admin/applications/${user.id}/approve`,
        success: true,
        detail: `Approved ${user.username}`,
      }
    });

    res.json({
      success: true,
      accessCode,
      email: user.email,
      emailSent,
      expiresAt: expiry,
      message: emailSent
        ? 'Application approved. Access code emailed to applicant.'
        : 'Application approved, but the access-code email failed to send. Share the code manually.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/applications/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Application not found' });
    if (user.approvalStatus !== 'PENDING') {
      return res.status(400).json({ error: 'Application is not pending' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        approvalStatus: 'REJECTED',
        rejectedReason: reason || 'Application did not meet our requirements.',
        approvedAt: new Date(),
        approvedBy: req.userId,
      }
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #f4f6fa; padding: 30px;">
        <div style="background: #b1122b; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 20px; letter-spacing: 1px;">CONTINENTAL FEDERAL</h1>
        </div>
        <div style="background: #fff; padding: 30px; border-radius: 0 0 8px 8px;">
          <h2 style="color: #b1122b; font-size: 18px; margin-top: 0;">Application Update</h2>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">Dear ${user.fullName},</p>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">
            Thank you for your interest in Continental Federal Bank &amp; Trust.
            After reviewing your application, we regret to inform you that we are unable to open an account at this time.
          </p>
          <div style="background: #fef2f2; border-left: 3px solid #b1122b; padding: 16px; margin: 20px 0;">
            <p style="font-size: 11px; letter-spacing: 2px; color: #666; margin: 0 0 6px;">REASON</p>
            <p style="color: #444; margin: 0; font-size: 14px;">${reason || 'Application did not meet our requirements.'}</p>
          </div>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">
            If you believe this decision was made in error, please contact us at 1-800-CFB-BANK.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #999; font-size: 11px; text-align: center; margin: 0;">
            Continental Federal Bank &amp; Trust · Member FDIC · Equal Housing Lender
          </p>
        </div>
      </div>
    `;

    sendEmail({
      to: user.email,
      toName: user.fullName,
      subject: 'Application Update — Continental Federal Bank',
      html,
    }).then(() => console.log(`[KYC] Rejection email sent to ${user.email}`))
      .catch(err => console.error('[KYC] Rejection email failed:', err.message));

    await prisma.auditLog.create({
      data: {
        action: 'KYC_REJECT',
        userId: req.userId,
        path: `/api/admin/applications/${user.id}/reject`,
        success: true,
        detail: `Rejected ${user.username}: ${reason || 'no reason given'}`,
      }
    });

    res.json({ success: true, message: 'Application rejected. Applicant notified by email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;