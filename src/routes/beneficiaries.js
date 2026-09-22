/**
 * External Beneficiary Directory — admin-managed.
 *
 * Banks and businesses maintain a directory of verified external
 * beneficiaries (vendors, contractors, partner institutions). When a
 * user initiates a transfer to one of these accounts, the system shows
 * the pre-verified name and bank — exactly like a real bank's name
 * enquiry response.
 *
 * Only admins can add/edit/remove entries.
 */
const router = require('express').Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/admin');
const prisma = require('../config/db');

// ============================================================
// PUBLIC (any logged-in user) — name enquiry lookup
// Used by transfers.js to resolve beneficiary details
// ============================================================

router.get('/lookup/:accountNumber', auth, async (req, res) => {
  const { accountNumber } = req.params;

  const beneficiary = await prisma.externalBeneficiary.findUnique({
    where: { accountNumber },
  });

  if (!beneficiary) {
    return res.json({ found: false });
  }

  res.json({
    found: true,
    accountName: beneficiary.accountName,
    accountNumber: beneficiary.accountNumber,
    routingNumber: beneficiary.routingNumber,
    bankName: beneficiary.bankName,
    accountType: beneficiary.accountType,
    isVerified: beneficiary.isVerified,
  });
});

// ============================================================
// ADMIN — list all beneficiaries
// ============================================================

router.get('/', auth, adminOnly, async (req, res) => {
  const items = await prisma.externalBeneficiary.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(items);
});

// ============================================================
// ADMIN — add a new beneficiary
// ============================================================

router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const {
      accountNumber,
      routingNumber,
      accountName,
      bankName,
      accountType,
      customerId,
      description,
    } = req.body;

    if (!accountNumber || !routingNumber || !accountName || !bankName) {
      return res.status(400).json({
        error: 'Account number, routing number, name and bank are required.',
      });
    }

    if (!/^\d{6,17}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Account number must be 6-17 digits.' });
    }
    if (!/^\d{9}$/.test(routingNumber)) {
      return res.status(400).json({ error: 'Routing number must be exactly 9 digits.' });
    }

    const existing = await prisma.externalBeneficiary.findUnique({
      where: { accountNumber },
    });
    if (existing) {
      return res.status(400).json({ error: 'A beneficiary with this account number already exists.' });
    }

    const beneficiary = await prisma.externalBeneficiary.create({
      data: {
        accountNumber,
        routingNumber,
        accountName: accountName.toUpperCase(),
        bankName,
        accountType: accountType || 'checking',
        customerId: customerId || null,
        description: description || null,
        isVerified: true,
        addedBy: req.userId,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'BENEFICIARY_ADD',
        userId: req.userId,
        ip: req.ip || null,
        ua: req.headers['user-agent'] || null,
        path: `/api/beneficiaries`,
        success: true,
        detail: `Added ${beneficiary.accountName} (${beneficiary.accountNumber})`,
      }
    });

    res.json({ success: true, beneficiary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ADMIN — update a beneficiary
// ============================================================

router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const existing = await prisma.externalBeneficiary.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const data = {};
    ['accountName', 'bankName', 'accountType', 'customerId', 'description', 'routingNumber']
      .forEach(k => {
        if (req.body[k] !== undefined) {
          data[k] = k === 'accountName' ? req.body[k].toUpperCase() : (req.body[k] || null);
        }
      });
    if (req.body.isVerified !== undefined) data.isVerified = !!req.body.isVerified;

    const updated = await prisma.externalBeneficiary.update({
      where: { id: req.params.id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        action: 'BENEFICIARY_UPDATE',
        userId: req.userId,
        path: `/api/beneficiaries/${req.params.id}`,
        success: true,
        detail: `Updated ${updated.accountName}`,
      }
    });

    res.json({ success: true, beneficiary: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ADMIN — delete a beneficiary
// ============================================================

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const existing = await prisma.externalBeneficiary.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await prisma.externalBeneficiary.delete({ where: { id: req.params.id } });

    await prisma.auditLog.create({
      data: {
        action: 'BENEFICIARY_DELETE',
        userId: req.userId,
        path: `/api/beneficiaries/${req.params.id}`,
        success: true,
        detail: `Removed ${existing.accountName}`,
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;