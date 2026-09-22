const router = require('express').Router();
const auth = require('../middleware/auth');
const prisma = require('../config/db');
const { resolveBank, isOurBank } = require('../config/usBanks');
const { resolveExternalName } = require('../config/externalNames');

/**
 * Determine settlement network from routing number.
 */
function resolveNetwork(routingNumber) {
  if (!routingNumber) {
    return { network: 'ACH', settlementTime: '1-3 business days', networkCode: 'ACH' };
  }
  const fedNowRoutings = [
    '021000021', '021000089', '026009593', '121000248', '021001088',
    '031000503', '051000017', '091000019', '061000104',
  ];
  if (fedNowRoutings.includes(String(routingNumber))) {
    return { network: 'FedNow Service', settlementTime: 'Instant (seconds)', networkCode: 'FEDNOW' };
  }
  const rtpRoutings = ['124003116', '121042882', '256074974', '042000013', '062000019'];
  if (rtpRoutings.includes(String(routingNumber))) {
    return { network: 'RTP® Network', settlementTime: 'Instant (seconds)', networkCode: 'RTP' };
  }
  return { network: 'ACH', settlementTime: '1-3 business days', networkCode: 'ACH' };
}

function maskAccount(accountNumber) {
  if (!accountNumber) return '';
  const s = String(accountNumber);
  if (s.length <= 4) return '****' + s;
  return '****' + s.slice(-4);
}

// ============================================================
// GET /api/accounts — user's own accounts
// ============================================================
router.get('/', auth, async (req, res) => {
  const accounts = await prisma.account.findMany({ where: { userId: req.userId } });
  res.json(accounts.map(a => ({
    id:            a.id,
    accountNumber: a.accountNumber,
    accountName:   a.accountName,
    accountType:   a.accountType,
    isBusiness:    a.isBusiness,
    balance:       Number(a.balance),
    pendingOut:    Number(a.pendingOut || 0),
    available:     Number(a.balance) - Number(a.pendingOut || 0),
    openedAt:      a.openedAt,
  })));
});

// ============================================================
// Name enquiry — checks CFB ledger → admin directory → simulated
// ============================================================
router.get('/resolve/:accountNumber', auth, async (req, res) => {
  const { accountNumber } = req.params;
  const routingNumber = (req.query.routing || '').trim();

  if (!/^\d{6,17}$/.test(accountNumber)) {
    return res.status(400).json({ resolved: false, error: 'Account number must be 6-17 digits' });
  }

  // Simulate network latency
  await new Promise(r => setTimeout(r, 200 + Math.random() * 400));

  // 1) Internal CFB account
  const internalAccount = await prisma.account.findUnique({
    where: { accountNumber },
    select: { accountName: true, accountNumber: true, isRegistered: true, accountType: true },
  });

  if (internalAccount) {
    return res.json({
      resolved: true,
      verified: true,
      accountName: internalAccount.accountName,
      accountNumber: internalAccount.accountNumber,
      accountNumberMasked: maskAccount(internalAccount.accountNumber),
      bankName: 'Continental Federal Bank & Trust, New York, NY',
      routingNumber: routingNumber || '021407912',
      swift: 'CBFBUS33',
      isInternal: true,
      isOurBank: true,
      accountType: internalAccount.accountType,
      network: { network: 'Internal Transfer', settlementTime: 'Instant', networkCode: 'CFB_INTERNAL' },
      nameMatchConfidence: 'EXACT',
      source: 'CFB_LEDGER',
      retrievedAt: new Date().toISOString(),
    });
  }

  // 2) Admin-maintained external beneficiary directory
  const beneficiary = await prisma.externalBeneficiary.findUnique({
    where: { accountNumber },
  });

  if (beneficiary && beneficiary.isVerified) {
    const network = resolveNetwork(beneficiary.routingNumber);
    return res.json({
      resolved: true,
      verified: true,
      accountName: beneficiary.accountName,
      accountNumber: beneficiary.accountNumber,
      accountNumberMasked: maskAccount(beneficiary.accountNumber),
      bankName: beneficiary.bankName,
      routingNumber: beneficiary.routingNumber,
      swift: null,
      isInternal: false,
      isOurBank: false,
      accountType: beneficiary.accountType,
      network,
      nameMatchConfidence: 'EXACT',
      source: 'VERIFIED_DIRECTORY',
      retrievedAt: new Date().toISOString(),
    });
  }

  // 3) Fallback — simulated inter-bank response
  const bankName = routingNumber ? resolveBank(routingNumber) : 'External Financial Institution';
  const network = resolveNetwork(routingNumber);

  return res.json({
    resolved: true,
    verified: true,
    accountName: resolveExternalName(accountNumber),
    accountNumber,
    accountNumberMasked: maskAccount(accountNumber),
    bankName,
    routingNumber: routingNumber || null,
    swift: null,
    isInternal: false,
    isOurBank: false,
    accountType: 'checking',
    network,
    nameMatchConfidence: 'LIKELY',
    source: 'INTERBANK_SIMULATED',
    retrievedAt: new Date().toISOString(),
  });
});

module.exports = router;