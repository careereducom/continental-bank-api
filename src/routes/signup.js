const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const bank = require('../config/bank');
const audit = require('../middleware/audit');
const { sendEmail, sendOtpEmail } = require('../config/mailer');

function generateCardNumber() {
  let num = '4';
  while (num.length < 16) num += Math.floor(Math.random() * 10);
  return num;
}

function generateAccountNumber() {
  let n = '3';
  while (n.length < 10) n += Math.floor(Math.random() * 10);
  return n;
}

// ── Lookup country from IP (free, no key) ────────────────────
async function lookupLocation(ip) {
  // Skip for local/private IPs
  if (!ip || ip.includes('127.0.0.1') || ip.includes('localhost') || ip.startsWith('192.168') || ip.startsWith('10.')) {
    return { country: 'Local Network', city: '—', region: '—', raw: ip || 'unknown' };
  }
  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!r.ok) return { country: 'Unknown', city: '—', region: '—', raw: ip };
    const data = await r.json();
    return {
      country: data.country_name || 'Unknown',
      city: data.city || '—',
      region: data.region || '—',
      raw: ip,
    };
  } catch {
    return { country: 'Unknown', city: '—', region: '—', raw: ip };
  }
}

// ── Email to applicant ──────────────────────────────────────
async function sendApplicationReceived(email, fullName, accountNumber) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #f4f6fa; padding: 30px;">
      <div style="background: #0f2b5b; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px; letter-spacing: 1px;">CONTINENTAL FEDERAL</h1>
        <p style="color: #c9a227; margin: 4px 0 0; font-size: 11px; letter-spacing: 3px;">BANK &amp; TRUST</p>
      </div>
      <div style="background: #fff; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #0f2b5b; font-size: 18px; margin-top: 0;">Application Received</h2>
        <p style="color: #444; font-size: 14px; line-height: 1.6;">
          Dear ${fullName},
        </p>
        <p style="color: #444; font-size: 14px; line-height: 1.6;">
          Thank you for opening an account with Continental Federal Bank &amp; Trust.
          Your application has been received and is currently <strong>under review</strong>.
        </p>
        <div style="background: #f4f6fa; border-left: 3px solid #c9a227; padding: 16px; margin: 20px 0;">
          <p style="font-size: 11px; letter-spacing: 2px; color: #666; margin: 0 0 6px;">YOUR ACCOUNT NUMBER</p>
          <p style="font-size: 22px; font-family: monospace; color: #0f2b5b; margin: 0; font-weight: bold;">${accountNumber}</p>
        </div>
        <p style="color: #444; font-size: 14px; line-height: 1.6;">
          <strong>What happens next?</strong><br>
          1. Our compliance team will review your application (typically within 1 business day).<br>
          2. Once approved, you will receive a <strong>6-digit access code</strong> by email.<br>
          3. Use your account number + access code to activate your account at our activation page.
        </p>
        <p style="color: #666; font-size: 13px; line-height: 1.6;">
          If you did not submit this application, please contact us immediately at 1-800-CFB-BANK.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="color: #999; font-size: 11px; text-align: center; margin: 0;">
          Continental Federal Bank &amp; Trust · Member FDIC · Equal Housing Lender<br>
          This is an automated message. Do not reply.
        </p>
      </div>
    </div>
  `;
  // In production this goes to the applicant. Demo routes to DEMO_EMAIL
  // because Resend's sandbox only allows the account owner's email.

  const recipient = process.env.DEMO_EMAIL || email;

  return sendEmail({
    to: email,
    toName: fullName,
    subject: 'Application Received — Continental Federal Bank',
    html,
  });


}

// ── Email to admin ──────────────────────────────────────────
async function sendAdminNotification(applicant) {
  const adminEmail = process.env.DEMO_EMAIL || process.env.GMAIL_USER;
  if (!adminEmail) return;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #b1122b; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">New Account Application</h1>
      </div>
      <div style="background: #fff; padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="color: #444; font-size: 14px;">A new signup requires your review:</p>
        <table style="width: 100%; font-size: 13px; color: #333; margin: 16px 0;">
          <tr><td style="padding: 4px 0; color: #666;">Name</td><td><strong>${applicant.fullName}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Email</td><td>${applicant.email}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Phone</td><td>${applicant.phone}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Account #</td><td><strong>${applicant.accountNumber}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Date of Birth</td><td>${applicant.dateOfBirth || '—'}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Address</td><td>${applicant.address}, ${applicant.city}, ${applicant.state} ${applicant.postalCode}, ${applicant.country}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Signup IP</td><td>${applicant.signupIp}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Location</td><td><strong>${applicant.city}, ${applicant.region}, ${applicant.country}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">User Agent</td><td style="font-size: 11px; color: #888;">${applicant.userAgent}</td></tr>
        </table>
        <p style="color: #444; font-size: 13px;">
          Log in to the Operations Console to approve or reject this application.
        </p>
        <p style="color: #999; font-size: 11px; margin-top: 20px;">
          Continental Federal Bank &amp; Trust · Internal Notification
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: adminEmail,
    subject: `New Application: ${applicant.fullName}`,
    html,
  });
}

// ── Public signup endpoint ───────────────────────────────────
router.post('/start',
  body('fullName').isLength({ min: 2, max: 80 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('phone').matches(/^[0-9+\-\s()]{7,20}$/),
  body('password').isLength({ min: 8, max: 128 }),
  body('dateOfBirth').isISO8601(),
  body('addressLine1').isLength({ min: 4, max: 120 }).trim().escape(),
  body('city').isLength({ min: 2, max: 60 }).trim().escape(),
  body('state').isLength({ min: 2, max: 60 }).trim().escape(),
  body('postalCode').isLength({ min: 3, max: 12 }).trim().escape(),
  body('country').isIn(['United States', 'Canada', 'Mexico']),
  body('ssnLast4').matches(/^[0-9]{4}$/),
  audit('SIGNUP_ATTEMPT'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Please review the information provided.' });
    }

    const {
      fullName, email, phone, password, dateOfBirth,
      addressLine1, addressLine2, city, state, postalCode, country, ssnLast4,
    } = req.body;

    // Age check
    const dob = new Date(dateOfBirth);
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return res.status(400).json({ error: 'Applicants must be at least 18 years of age.' });
    if (age > 120) return res.status(400).json({ error: 'Invalid date of birth.' });

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) return res.status(400).json({ error: 'An account already exists with this email.' });

    const passwordHash = await bcrypt.hash(password, 12);

    let accountNumber;
    let attempts = 0;
    do {
      accountNumber = generateAccountNumber();
      attempts++;
    } while (await prisma.account.findUnique({ where: { accountNumber } }) && attempts < 10);

    const transferCode = Math.floor(1000 + Math.random() * 9000).toString();

    // Capture signup metadata
    const signupIp = req.headers['x-forwarded-for']?.split(',')[0].trim()
                  || req.socket.remoteAddress
                  || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const location = await lookupLocation(signupIp);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: accountNumber,
          passwordHash,
          fullName: fullName.toUpperCase(),
          email,
          phone,
          addressLine1,
          addressLine2: addressLine2 || null,
          city, state, postalCode, country,
          dateOfBirth: dob,
          ssnLast4,
          kycStatus: 'PENDING',
          approvalStatus: 'PENDING',
          signupIp,
          signupLocation: `${location.city}, ${location.region}, ${location.country}`,
          signupUserAgent: userAgent,
        }
      });

      const account = await tx.account.create({
        data: {
          accountNumber,
          accountName: fullName.toUpperCase(),
          balance: 0,
          accountType: 'checking',
          isBusiness: false,
          transferCode,
          isRegistered: true,
          openedAt: new Date(),
          userId: user.id,
        }
      });

      // Issue virtual card but don't activate yet
      const now = new Date();
      const cardNumber = generateCardNumber();
      await tx.card.create({
        data: {
          cardNumber,
          last4: cardNumber.slice(-4),
          brand: 'VISA',
          type: 'VIRTUAL',
          status: 'FROZEN',
          expiryMonth: now.getMonth() + 1,
          expiryYear: now.getFullYear() + 4,
          cvv: String(Math.floor(100 + Math.random() * 900)),
          holderName: fullName.toUpperCase(),
          accountId: account.id,
          userId: user.id,
        }
      });

      return { user, account };
    });

    // Send emails (non-blocking)
    sendApplicationReceived(email, fullName, accountNumber)
      .then(() => console.log(`[SIGNUP] Welcome email sent to ${email}`))
      .catch(err => console.error('[SIGNUP] User email failed:', err.message));

    sendAdminNotification({
      fullName,
      email,
      phone,
      accountNumber,
      dateOfBirth: dob.toISOString().split('T')[0],
      address: addressLine1,
      city, state, postalCode, country,
      signupIp,
      region: location.region,
      country: location.country,
      userAgent,
    })
      .then(() => console.log(`[SIGNUP] Admin notification sent`))
      .catch(err => console.error('[SIGNUP] Admin email failed:', err.message));

    res.json({
      success: true,
      pending: true,
      accountNumber,
      message: 'Application received. You will receive an access code by email once approved.',
    });
  }
);

module.exports = router;