const router = require('express').Router();
const PDFDocument = require('pdfkit');
const auth = require('../middleware/auth');
const prisma = require('../config/db');
const bank = require('../config/bank');

router.get('/:accountId', auth, async (req, res) => {
  const account = await prisma.account.findUnique({ where: { id: req.params.accountId } });
  if (!account || account.userId !== req.userId) {
    return res.status(403).json({ error: 'Account not found.' });
  }

  res.json({
    bankName:      bank.legalName,
    routingNumber: bank.routingNumber,
    swift:         bank.swift,
    accountNumber: account.accountNumber,
    accountType:   account.accountType.toUpperCase(),
    accountName:   account.accountName,
    bankAddress:   bank.hqAddress,
    supportPhone:  bank.supportPhone,
    instructions: [
      'Provide this slip to your employer or payroll provider.',
      'Payroll credits post within 1-2 business days of submission.',
      'Routing number 021000089 is valid for ACH and wire transfers.',
      'Direct deposits are FDIC-insured up to $250,000.',
    ],
  });
});

router.get('/:accountId/slip.pdf', auth, async (req, res) => {
  const account = await prisma.account.findUnique({ where: { id: req.params.accountId } });
  if (!account || account.userId !== req.userId) {
    return res.status(403).json({ error: 'Account not found.' });
  }

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="direct-deposit-${account.accountNumber}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, 612, 95).fill('#0f2b5b');
  doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
     .text('CONTINENTAL FEDERAL', 50, 28);
  doc.fontSize(11).font('Helvetica').text('BANK & TRUST', 50, 52);
  doc.fontSize(8).text('Member FDIC  ·  Equal Housing Lender  ·  Est. 1989', 50, 72);
  doc.fontSize(8).text(`NMLS ID ${bank.nmlsId}  ·  SWIFT ${bank.swift}`, 400, 72, { width: 160, align: 'right' });

  doc.fillColor('#0f2b5b').fontSize(18).font('Helvetica-Bold')
     .text('Direct Deposit Authorization', 50, 130);
  doc.fillColor('#555').fontSize(9).font('Helvetica')
     .text('Provide this form to your employer or payroll provider', 50, 156);

  const y0 = 190;
  doc.rect(50, y0, 512, 240).strokeColor('#d0d5dd').lineWidth(1).stroke();

  const row = (label, value, y, bold) => {
    doc.fillColor('#6b7280').fontSize(8).font('Helvetica-Bold')
       .text(label.toUpperCase(), 70, y, { width: 130 });
    doc.fillColor('#111').fontSize(bold ? 13 : 11)
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .text(value, 200, y - 2, { width: 340 });
  };

  row('Financial Institution', bank.legalName,             y0 + 25, false);
  row('Routing (ABA) Number',  bank.routingNumber,         y0 + 55, true);
  row('Account Number',        account.accountNumber,      y0 + 85, true);
  row('Account Type',          account.accountType.toUpperCase(), y0 + 115, false);
  row('Account Holder',        account.accountName,        y0 + 145, false);
  row('Bank Address',          bank.hqAddress,             y0 + 175, false);
  row('SWIFT / BIC',           bank.swift,                 y0 + 205, false);

  doc.fillColor('#555').fontSize(8).font('Helvetica')
     .text('Authorized by:', 50, 470)
     .text('________________________________________', 50, 495)
     .text('Account Holder Signature', 50, 512)
     .text('Date: ____________', 400, 512);

  doc.fillColor('#777').fontSize(7).font('Helvetica')
     .text('This document is computer-generated. For questions call 1-800-CFB-BANK or email support@cfbank.com.',
       50, 720, { width: 512, align: 'center' });

  doc.end();
});

module.exports = router;
