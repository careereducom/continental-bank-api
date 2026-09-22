const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const audit = require('../middleware/audit');
const { sendOtpEmail } = require('../config/mailer');
const { seedNewUserHistory } = require('../config/newUserHistory');
// Seeded accounts use @cfbank.com â€” route their OTP to the demo inbox
// Real signups get OTP sent to their own email address
function getOtpRecipient(user) {
  if (!user.email) return process.env.DEMO_EMAIL || user.email;
  if (user.email.endsWith('@cfbank.com')) return process.env.DEMO_EMAIL || user.email;
  return user.email;
}

// ============================================================
// STAGE 1 â€” Verify password, issue OTP
// ============================================================
router.post('/login',
  body('username').isLength({ min: 4, max: 32 }).trim().escape(),
  body('password').isLength({ min: 6, max: 128 }),
  audit('LOGIN_ATTEMPT'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid credentials' });

    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });

    const dummy = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';
    const valid = await bcrypt.compare(password, user?.passwordHash || dummy);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // â”€â”€ KYC / approval gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (user.approvalStatus === 'PENDING') {
      return res.status(403).json({
        error: 'ACCOUNT_PENDING',
        message: 'Your application is under review. You will receive an access code by email once approved.',
        status: 'PENDING',
      });
    }

    if (user.approvalStatus === 'REJECTED') {
      return res.status(403).json({
        error: 'ACCOUNT_REJECTED',
        message: user.rejectedReason
          ? `Your application was declined: ${user.rejectedReason}`
          : 'Your application was declined. Contact support for details.',
        status: 'REJECTED',
      });
    }

    if (user.approvalStatus !== 'ACTIVE') {
      return res.status(403).json({
        error: 'ACCOUNT_INACTIVE',
        message: 'Your account is not active. Please contact support.',
      });
    }

    // â”€â”€ OTP generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { loginOtp: otp, loginOtpExpiry: expiry }
    });

    const stageToken = jwt.sign(
      { userId: user.id, stage: 'otp' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    const recipient = getOtpRecipient(user);
    const email = recipient;
    const maskedEmail = recipient.replace(/^(.{2}).*@/, '$1***@');

    sendOtpEmail(email, otp, user.fullName)
      .then(() => console.log('[OTP] Sent to ' + email))
      .catch(err => console.error('[OTP] Email failed:', err.message));

    res.json({
      success: true,
      otpRequired: true,
      stageToken,
      destination: maskedEmail,
      message: 'A 6-digit code has been sent to ' + maskedEmail + '.',
    });
  }
);

// ============================================================
// STAGE 2 â€” Verify OTP
// ============================================================
router.post('/verify-otp',
  body('code').isLength({ min: 6, max: 6 }),
  audit('OTP_VERIFY'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter the 6-digit code' });

    const { stageToken, code } = req.body;
    if (!stageToken) return res.status(400).json({ error: 'Session expired. Please sign in again.' });

    let decoded;
    try {
      decoded = jwt.verify(stageToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    if (decoded.stage !== 'otp') return res.status(401).json({ error: 'Invalid session' });

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'Session invalid' });

    if (!user.loginOtp || !user.loginOtpExpiry) {
      return res.status(400).json({ error: 'No active code. Please sign in again.' });
    }

    if (new Date() > user.loginOtpExpiry) {
      return res.status(400).json({ error: 'Code expired. Please sign in again.' });
    }

    if (user.loginOtp !== code) {
      return res.status(401).json({ error: 'Incorrect code. Please try again.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { loginOtp: null, loginOtpExpiry: null }
    });

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    const rawAccounts = await prisma.account.findMany({
      where: { userId: user.id },
    });
    const accounts = rawAccounts.map(a => ({
      id:            a.id,
      accountNumber: a.accountNumber,
      accountName:   a.accountName,
      accountType:   a.accountType,
      isBusiness:    a.isBusiness,
      balance:       Number(a.balance),
      pendingOut:    Number(a.pendingOut || 0),
      available:     Number(a.balance) - Number(a.pendingOut || 0),
    }));

    res.json({
      success: true,
      token,
      user: { id: user.id, fullName: user.fullName, email: user.email, isAdmin: user.isAdmin },
      accounts,
    });
  }
);

// ============================================================
// RESEND OTP
// ============================================================
router.post('/resend-otp', async (req, res) => {
  const { stageToken } = req.body;
  if (!stageToken) return res.status(400).json({ error: 'Session expired' });

  let decoded;
  try {
    decoded = jwt.verify(stageToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user) return res.status(401).json({ error: 'Session invalid' });

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiry = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { loginOtp: otp, loginOtpExpiry: expiry }
  });

  sendOtpEmail(getOtpRecipient(user), otp, user.fullName)
    .then(() => console.log('[OTP-RESEND] Sent to ' + user.email))
    .catch(err => console.error('[OTP-RESEND] Failed:', err.message));

  res.json({ success: true, message: 'A new code has been sent.' });
});

// ============================================================
// CHANGE TRANSFER PIN
// ============================================================
const auth = require('../middleware/auth');

router.post('/change-pin', auth, async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;

    if (!currentPin || !newPin) {
      return res.status(400).json({ error: 'Both current and new PIN required' });
    }
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: 'New PIN must be exactly 4 digits' });
    }
    if (currentPin === newPin) {
      return res.status(400).json({ error: 'New PIN must be different from current' });
    }

    const account = await prisma.account.findFirst({ where: { userId: req.userId } });
    if (!account) return res.status(404).json({ error: 'No account found' });

    let ok = false;
    if (account.transferCodeHash) {
      ok = await bcrypt.compare(currentPin, account.transferCodeHash);
    } else {
      ok = account.transferCode === currentPin;
    }
    if (!ok) {
      return res.status(403).json({ error: 'Current PIN is incorrect' });
    }

    const newHash = await bcrypt.hash(newPin, 12);

    await prisma.account.updateMany({
      where: { userId: req.userId },
      data: {
        transferCode:     newPin,
        transferCodeHash: newHash,
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'PIN_CHANGE',
        userId: req.userId,
        ip: req.ip || null,
        ua: req.headers['user-agent'] || null,
        path: '/api/auth/change-pin',
        success: true,
      }
    });

    res.json({ success: true, message: 'Transfer PIN updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ACTIVATE ACCOUNT â€” enter account number + access code
// ============================================================
router.post('/activate',
  body('accountNumber').isLength({ min: 6, max: 17 }).trim().escape(),
  body('accessCode').isLength({ min: 6, max: 6 }).trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid input' });

    const { accountNumber, accessCode } = req.body;

    const user = await prisma.user.findUnique({ where: { username: accountNumber } });
    if (!user) return res.status(404).json({ error: 'Account not found' });

    if (user.approvalStatus === 'ACTIVE') {
      return res.status(400).json({ error: 'Account already active. Please sign in.' });
    }
    if (user.approvalStatus === 'REJECTED') {
      return res.status(403).json({ error: 'This application was declined.' });
    }
    if (user.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ error: 'Application not yet approved.' });
    }

    if (!user.accessCode || user.accessCode !== accessCode) {
      return res.status(403).json({ error: 'Invalid access code.' });
    }
    if (!user.accessCodeExpiry || new Date() > user.accessCodeExpiry) {
      return res.status(403).json({ error: 'Access code expired. Please contact support.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        approvalStatus: 'ACTIVE',
        accessCode: null,
        accessCodeExpiry: null,
        kycStatus: 'VERIFIED',
      }
    });

    // Unfreeze virtual card
    await prisma.card.updateMany({
      where: { userId: user.id },
      data: { status: 'ACTIVE' }
    });

    // Seed starting history so the new account is not empty.
    // Wrapped in try/catch so a seeding failure never blocks login.
    try {
      const account = await prisma.account.findFirst({ where: { userId: user.id } });
      if (account) {
        const existing = await prisma.transaction.count({
          where: { OR: [{ fromAccountId: account.id }, { toAccountId: account.id }] },
        });
        if (existing === 0) {
          const result = await seedNewUserHistory(user, account);
          console.log('[ACTIVATE] Seeded ' + result.inserted + ' txns for ' + account.accountNumber
            + ', balance $' + result.finalBalance.toFixed(2));
        } else {
          console.log('[ACTIVATE] Skipping seed - ' + existing + ' txns already exist for ' + account.accountNumber);
        }
      }
    } catch (e) {
      console.error('[ACTIVATE] History seeding failed:', e.message);
    }

    res.json({
      success: true,
      message: 'Account activated successfully. You can now sign in.',
    });
  }
);

module.exports = router;
