const router = require('express').Router();
const PDFDocument = require('pdfkit');
const auth = require('../middleware/auth');
const prisma = require('../config/db');
const bank = require('../config/bank');

router.get('/:accountId', auth, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { from, to, type, minAmount, maxAmount, limit = 5000 } = req.query;

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return res.status(404).json({ error: 'Account not found' });

    if (account.userId !== req.userId) {
      const admin = await prisma.user.findUnique({ where: { id: req.userId } });
      if (!admin?.isAdmin) return res.status(403).json({ error: 'Access denied' });
    }

    const where = { OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }
    if (type && type !== 'ALL') where.type = type;
    if (minAmount || maxAmount) {
      where.amount = {};
      if (minAmount) where.amount.gte = Number(minAmount);
      if (maxAmount) where.amount.lte = Number(maxAmount);
    }

    const txns = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit), 10000)
    });

    const totalIn  = txns.filter(t => t.toAccountId === accountId).reduce((s, t) => s + Number(t.amount), 0);
    const totalOut = txns.filter(t => t.fromAccountId === accountId).reduce((s, t) => s + Number(t.amount), 0);

    res.json({
      account: {
        accountNumber: account.accountNumber,
        accountName:   account.accountName,
        accountType:   account.accountType,
        balance:       Number(account.balance),
        openedAt:      account.openedAt,
        isBusiness:    account.isBusiness
      },
      period: { from: from || account.openedAt, to: to || new Date() },
      summary: {
        count: txns.length,
        totalIn:  Math.round(totalIn * 100) / 100,
        totalOut: Math.round(totalOut * 100) / 100,
        net: Math.round((totalIn - totalOut) * 100) / 100
      },
      transactions: txns.map(t => ({
        reference:    t.reference,
        date:         t.createdAt,
        type:         t.type,
        category:     t.category,
        description:  t.description,
        amount:       Number(t.amount),
        direction:    t.toAccountId === accountId ? 'IN' : 'OUT',
        status:       t.status,
        balanceAfter: Number(t.balanceAfter || 0)
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:accountId/monthly', auth, async (req, res) => {
  const { accountId } = req.params;
  const { from, to } = req.query;

  const txns = await prisma.transaction.findMany({
    where: {
      OR: [{ fromAccountId: accountId }, { toAccountId: accountId }],
      createdAt: {
        gte: from ? new Date(from) : new Date('2010-01-01'),
        lte: to ? new Date(to) : new Date()
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  const buckets = {};
  for (const t of txns) {
    const key = t.createdAt.toISOString().slice(0, 7);
    if (!buckets[key]) buckets[key] = { month: key, in: 0, out: 0, count: 0 };
    if (t.toAccountId === accountId) buckets[key].in  += Number(t.amount);
    else                              buckets[key].out += Number(t.amount);
    buckets[key].count++;
  }

  res.json(Object.values(buckets).sort((a, b) => a.month.localeCompare(b.month)));
});

router.get('/:accountId/pdf', auth, async (req, res) => {
  const { accountId } = req.params;
  const { from, to } = req.query;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== req.userId) {
    const admin = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!admin?.isAdmin) return res.status(403).json({ error: 'Access denied' });
  }

  const txns = await prisma.transaction.findMany({
    where: {
      OR: [{ fromAccountId: accountId }, { toAccountId: accountId }],
      createdAt: {
        gte: from ? new Date(from) : account.openedAt,
        lte: to   ? new Date(to)   : new Date()
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="statement-${account.accountNumber}.pdf"`);
  doc.pipe(res);

  const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const stamp = d => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });

  doc.rect(0, 0, 612, 90).fill('#0f2b5b');
  doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
     .text('CONTINENTAL FEDERAL BANK & TRUST', 50, 30);
  doc.fontSize(9).font('Helvetica')
     .text('Member FDIC  ·  Equal Housing Lender  ·  Est. 1989', 50, 58);
  doc.fontSize(8).text(`NMLS ID ${bank.nmlsId}  ·  SWIFT ${bank.swift}  ·  Routing ${bank.routingNumber}`, 50, 72);

  doc.fillColor('#0f2b5b').fontSize(15).font('Helvetica-Bold')
     .text('Account Statement', 50, 115);
  doc.fontSize(9).font('Helvetica').fillColor('#555')
     .text(`Statement Period: ${stamp(from || account.openedAt)} — ${stamp(to || new Date())}`, 50, 138);

  doc.rect(50, 165, 512, 85).strokeColor('#d0d5dd').lineWidth(1).stroke();
  doc.fillColor('#0f2b5b').fontSize(9).font('Helvetica-Bold')
     .text('ACCOUNT HOLDER', 65, 178);
  doc.fillColor('#111').fontSize(11).font('Helvetica-Bold')
     .text(account.accountName, 65, 193);
  doc.fillColor('#555').fontSize(9).font('Helvetica')
     .text(`Account No: ${account.accountNumber}`, 65, 210)
     .text(`Type: ${account.accountType.toUpperCase()}`, 65, 224);

  doc.fillColor('#0f2b5b').fontSize(9).font('Helvetica-Bold')
     .text('CLOSING BALANCE', 400, 178);
  doc.fillColor('#111').fontSize(16).font('Helvetica-Bold')
     .text(money(account.balance), 400, 193);

  let y = 285;
  doc.rect(50, y, 512, 22).fill('#0f2b5b');
  doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold');
  doc.text('DATE',        60,  y + 7);
  doc.text('DESCRIPTION', 130, y + 7);
  doc.text('REFERENCE',   360, y + 7);
  doc.text('AMOUNT',      455, y + 7, { width: 100, align: 'right' });

  y += 22;
  doc.font('Helvetica').fontSize(8);

  let pageRows = 0;
  for (const t of txns) {
    if (y > 700) {
      doc.addPage();
      y = 50;
      pageRows = 0;
    }

    const isIn = t.toAccountId === accountId;
    if (pageRows % 2 === 1) doc.rect(50, y, 512, 16).fill('#f7f8fa');
    doc.fillColor('#333').font('Helvetica')
       .text(stamp(t.createdAt), 60, y + 4, { width: 65 })
       .text((t.description || t.type).slice(0, 55), 130, y + 4, { width: 225 })
       .text(t.reference.slice(0, 18), 360, y + 4, { width: 95 });
    doc.fillColor(isIn ? '#0a7d3a' : '#c02222').font('Helvetica-Bold')
       .text((isIn ? '+' : '-') + money(t.amount), 455, y + 4, { width: 100, align: 'right' });

    y += 16;
    pageRows++;
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('#777').fontSize(7).font('Helvetica')
       .text(
         'This statement is computer-generated and requires no signature. For questions call 1-800-CFB-BANK or email support@cfbank.com',
         50, 740, { width: 512, align: 'center' }
       )
       .text(`Page ${i + 1} of ${range.count}`, 50, 755, { width: 512, align: 'center' });
  }

  doc.end();
});

module.exports = router;
