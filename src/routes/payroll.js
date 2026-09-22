/**
 * Payroll API with per-transaction OTP.
 */
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const prisma = require('../config/db');
const bankConfig = require('../config/bank');
const { createNotification } = require('../utils/notify');
const { sendOtpEmail } = require('../config/mailer');
// Seeded accounts use @cfbank.com — route their OTP to the demo inbox
function getOtpRecipient(user) {
  if (!user.email) return process.env.DEMO_EMAIL || user.email;
  if (user.email.endsWith('@cfbank.com')) return process.env.DEMO_EMAIL || user.email;
  return user.email;
}

const MAX_PIN_ATTEMPTS = 3;
const PIN_LOCK_MINUTES = 30;
const OTP_EXPIRY_MIN   = 10;
const OTP_MAX_ATTEMPTS = 3;

async function getPayrollAccount(req) {
  return await prisma.account.findFirst({
    where: { userId: req.userId, accountType: 'payroll' },
    include: { user: true },
  });
}

async function verifyPayrollPin(account, pin) {
  return account.transferCode === pin;
}

async function checkPinWithLockout(account, pin) {
  const user = account.user;

  if (user.pinLockedUntil && new Date() < user.pinLockedUntil) {
    const mins = Math.ceil((new Date(user.pinLockedUntil) - new Date()) / 60000);
    throw { status: 403, message: `Account locked. Try again in ${mins} minutes.` };
  }

  const ok = await verifyPayrollPin(account, pin);
  if (!ok) {
    const attempts = (user.pinAttempts || 0) + 1;
    const data = { pinAttempts: attempts };
    if (attempts >= MAX_PIN_ATTEMPTS) {
      data.pinLockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000);
      await prisma.user.update({ where: { id: user.id }, data });
      await createNotification(user.id, 'FAILED',
        'Payroll account locked',
        `Too many incorrect PIN attempts. Locked for ${PIN_LOCK_MINUTES} minutes.`);
      throw { status: 403, message: 'Too many attempts. Locked for 30 minutes.' };
    }
    await prisma.user.update({ where: { id: user.id }, data });
    throw { status: 403, message: `Incorrect PIN. ${MAX_PIN_ATTEMPTS - attempts} attempts remaining.` };
  }

  if ((user.pinAttempts || 0) > 0 || user.pinLockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { pinAttempts: 0, pinLockedUntil: null },
    });
  }
  return true;
}

function makeRef(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() +
         Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ============================================================
// WORKERS CRUD (unchanged)
// ============================================================

router.get('/workers', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const workers = await prisma.worker.findMany({
      where: { payrollUserId: req.userId, isActive: true },
      orderBy: [{ department: 'asc' }, { fullName: 'asc' }],
    });

    res.json(workers.map(w => ({
      id: w.id,
      fullName: w.fullName,
      role: w.role,
      category: w.category,
      department: w.department,
      email: w.email,
      phone: w.phone,
      photoUrl: w.photoUrl,
      monthlySalary: Number(w.monthlySalary || 0),
      bankName: w.bankName,
      bankRoutingNumber: w.bankRoutingNumber,
      bankAccountNumber: w.bankAccountNumber,
      notes: w.notes,
      hireDate: w.hireDate,
      isActive: w.isActive,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/workers', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const { fullName, role, category, department, email, phone,
      monthlySalary, bankName, bankRoutingNumber, bankAccountNumber,
      photoUrl, notes } = req.body;

    if (!fullName || !role) {
      return res.status(400).json({ error: 'Full name and role are required' });
    }

    const worker = await prisma.worker.create({
      data: {
        payrollUserId: req.userId,
        fullName, role,
        category: category || 'STAFF',
        department: department || 'General',
        email: email || null,
        phone: phone || null,
        monthlySalary: monthlySalary ? Number(monthlySalary) : null,
        bankName: bankName || null,
        bankRoutingNumber: bankRoutingNumber || null,
        bankAccountNumber: bankAccountNumber || null,
        photoUrl: photoUrl || null,
        notes: notes || null,
        isActive: true,
      },
    });

    res.json({ success: true, worker });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/workers/:id', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const existing = await prisma.worker.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.payrollUserId !== req.userId) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const data = {};
    ['fullName','role','category','department','email','phone',
     'bankName','bankRoutingNumber','bankAccountNumber','photoUrl','notes'].forEach(k => {
      if (req.body[k] !== undefined) data[k] = req.body[k] || null;
    });
    if (req.body.monthlySalary !== undefined) {
      data.monthlySalary = Number(req.body.monthlySalary) || 0;
    }
    if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;

    const updated = await prisma.worker.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, worker: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/workers/:id', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const existing = await prisma.worker.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.payrollUserId !== req.userId) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    await prisma.worker.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SINGLE PAYMENT — Step 1: initiate
// ============================================================

router.post('/pay/initiate', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const { workerId, amount, category, description, pin } = req.body;

    if (!workerId) return res.status(400).json({ error: 'Worker required' });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    await checkPinWithLockout(payroll, pin);

    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker || worker.payrollUserId !== req.userId) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const available = Number(payroll.balance) - Number(payroll.pendingOut || 0);
    if (available < amount) {
      return res.status(400).json({
        error: `Insufficient payroll funds. Available: $${available.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      });
    }

    // Generate OTP + store pending action
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

    await prisma.pendingAction.deleteMany({
      where: { userId: req.userId, type: 'PAYROLL_SINGLE' }
    });

    const action = await prisma.pendingAction.create({
      data: {
        userId: req.userId,
        type: 'PAYROLL_SINGLE',
        payload: JSON.stringify({
          workerId,
          workerName: worker.fullName,
          amount: Number(amount),
          category: category || 'SALARY',
          description: description || null,
        }),
        otp,
        otpExpiry,
      }
    });

    const recipient = getOtpRecipient(payroll.user);
    const masked = recipient.replace(/^(.{2}).*@/, '$1***@');

    sendOtpEmail(recipient, otp, payroll.user.fullName)
      .then(() => console.log(`[PAYROLL-OTP] Sent to ${recipient}`))
      .catch(err => console.error('[PAYROLL-OTP] Failed:', err.message));

    res.json({
      success: true,
      otpRequired: true,
      pendingId: action.id,
      destination: masked,
      expiresIn: OTP_EXPIRY_MIN * 60,
      message: `A 6-digit verification code has been sent to ${masked}.`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Payment initiation failed' });
  }
});

// ============================================================
// SINGLE PAYMENT — Step 2: confirm
// ============================================================

router.post('/pay/confirm', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const { pendingId, otp } = req.body;
    if (!pendingId) return res.status(400).json({ error: 'Missing pending transaction' });
    if (!otp) return res.status(400).json({ error: 'Verification code required' });

    const action = await prisma.pendingAction.findUnique({ where: { id: pendingId } });
    if (!action || action.userId !== req.userId || action.type !== 'PAYROLL_SINGLE') {
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

    const { workerId, amount, category, description } = JSON.parse(action.payload);

    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const available = Number(payroll.balance) - Number(payroll.pendingOut || 0);
    if (available < amount) {
      await prisma.pendingAction.delete({ where: { id: action.id } });
      return res.status(400).json({ error: 'Insufficient funds.' });
    }

    const reference = makeRef('PR');
    const payCategory = category || 'SALARY';
    const desc = description || `${payCategory.toLowerCase()} payment`;

    const result = await prisma.$transaction(async (tx) => {
const updatedPayroll = await tx.account.update({
        where: { id: payroll.id },
        data: {
          balance:    { decrement: amount },
          pendingOut: { increment: amount },
        },
      });

      const txn = await tx.transaction.create({
        data: {
          reference,
          amount,
          status: 'PENDING',
          type: 'PAYROLL',
          category: payCategory,
          description: `${desc} — to ${worker.fullName} at ${worker.bankName || 'External Bank'}`,
          balanceAfter: updatedPayroll.balance,
          note: 'Payroll inter-bank transfer initiated. Awaiting settlement.',
          isPending: true,
          fromAccountId: payroll.id,
          initiatedBy: req.userId,
        }
      });

      const payment = await tx.payrollPayment.create({
        data: {
          reference,
          workerId: worker.id,
          payrollUserId: req.userId,
          amount: Number(amount),
          category: payCategory,
          description: desc,
          status: 'SUCCESS',
          fromAccountId: payroll.id,
          transactionId: txn.id,
          paidBy: payroll.user.username,
        }
      });

      return { txn, payment };
    });

    const amountStr = '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 });

    await createNotification(
      payroll.userId,
      'TRANSFER_OUT',
      'Payroll payment sent',
      `${amountStr} to ${worker.fullName} (${worker.role}) — ${worker.bankName || 'External Bank'}`,
      { reference, amount, status: 'SUCCESS' }
    );

    await prisma.pendingAction.delete({ where: { id: action.id } });

    res.json({
      success: true,
      payment: {
        id: result.payment.id,
        reference,
        worker: {
          name: worker.fullName,
          role: worker.role,
          bankName: worker.bankName,
        },
        amount: Number(amount),
        category: payCategory,
        status: 'SUCCESS',
        paidAt: result.payment.paidAt,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Payment confirmation failed' });
  }
});

// ============================================================
// BATCH PAYMENT — Step 1: initiate
// ============================================================

router.post('/batch/initiate', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const { payments, pin } = req.body;
    if (!Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: 'No payments provided' });
    }
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    await checkPinWithLockout(payroll, pin);

    const workerIds = payments.map(p => p.workerId);
    const workers = await prisma.worker.findMany({
      where: { id: { in: workerIds }, payrollUserId: req.userId, isActive: true },
    });
    const workerMap = new Map(workers.map(w => [w.id, w]));

    const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const available = Number(payroll.balance) - Number(payroll.pendingOut || 0);
    if (available < total) {
      return res.status(400).json({
        error: `Insufficient funds. Need $${total.toFixed(2)}, available $${available.toFixed(2)}`
      });
    }

    // Generate OTP + store pending batch
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

    await prisma.pendingAction.deleteMany({
      where: { userId: req.userId, type: 'PAYROLL_BATCH' }
    });

    // Enrich payments with worker info for the payload
    const enriched = payments
      .filter(p => workerMap.has(p.workerId))
      .map(p => {
        const w = workerMap.get(p.workerId);
        return {
          workerId: p.workerId,
          workerName: w.fullName,
          workerRole: w.role,
          workerBank: w.bankName,
          amount: Number(p.amount),
          category: p.category || 'SALARY',
          description: p.description || `${(p.category || 'SALARY').toLowerCase()} payment`,
        };
      });

    const action = await prisma.pendingAction.create({
      data: {
        userId: req.userId,
        type: 'PAYROLL_BATCH',
        payload: JSON.stringify({ payments: enriched, total }),
        otp,
        otpExpiry,
      }
    });

    const recipient = getOtpRecipient(payroll.user);
    const masked = recipient.replace(/^(.{2}).*@/, '$1***@');

    sendOtpEmail(recipient, otp, payroll.user.fullName)
      .then(() => console.log(`[PAYROLL-BATCH-OTP] Sent to ${recipient}`))
      .catch(err => console.error('[PAYROLL-BATCH-OTP] Failed:', err.message));

    res.json({
      success: true,
      otpRequired: true,
      pendingId: action.id,
      count: enriched.length,
      total,
      destination: masked,
      expiresIn: OTP_EXPIRY_MIN * 60,
      message: `A 6-digit code has been sent to ${masked} to authorise ${enriched.length} payments.`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Batch initiation failed' });
  }
});

// ============================================================
// BATCH PAYMENT — Step 2: confirm
// ============================================================

router.post('/batch/confirm', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const { pendingId, otp } = req.body;
    if (!pendingId) return res.status(400).json({ error: 'Missing pending batch' });
    if (!otp) return res.status(400).json({ error: 'Verification code required' });

    const action = await prisma.pendingAction.findUnique({ where: { id: pendingId } });
    if (!action || action.userId !== req.userId || action.type !== 'PAYROLL_BATCH') {
      return res.status(404).json({ error: 'Batch not found or expired' });
    }
    if (new Date() > action.otpExpiry) {
      await prisma.pendingAction.delete({ where: { id: action.id } });
      return res.status(400).json({ error: 'Verification code expired.' });
    }
    if (action.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.pendingAction.delete({ where: { id: action.id } });
      return res.status(403).json({ error: 'Too many attempts. Batch cancelled.' });
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

    const { payments, total } = JSON.parse(action.payload);

    const available = Number(payroll.balance) - Number(payroll.pendingOut || 0);
    if (available < total) {
      await prisma.pendingAction.delete({ where: { id: action.id } });
      return res.status(400).json({ error: 'Insufficient funds.' });
    }

    const batchRef = makeRef('BT');
    const results = [];

    for (const p of payments) {
      const reference = makeRef('PR');

      await prisma.$transaction(async (tx) => {
const updatedPayroll = await tx.account.update({
        where: { id: payroll.id },
        data: {
          balance:    { decrement: amount },
          pendingOut: { increment: amount },
        },
      });


        const txn = await tx.transaction.create({
          data: {
            reference,
            amount: p.amount,
            status: 'PENDING',
            type: 'PAYROLL',
            category: p.category,
            description: `${p.description} — to ${p.workerName} at ${p.workerBank || 'External Bank'} [BATCH ${batchRef}]`,
            balanceAfter: updatedPayroll.balance,
            note: 'Batch payroll transfer — awaiting settlement.',
            isPending: true,
            fromAccountId: payroll.id,
            initiatedBy: req.userId,
          }
        });

        const payment = await tx.payrollPayment.create({
          data: {
            reference,
            workerId: p.workerId,
            payrollUserId: req.userId,
            amount: p.amount,
            category: p.category,
            description: `${p.description} [Batch ${batchRef}]`,
            status: 'SUCCESS',
            fromAccountId: payroll.id,
            transactionId: txn.id,
            paidBy: payroll.user.username,
          }
        });

        results.push({
          worker: p.workerName,
          amount: p.amount,
          reference: payment.reference,
        });
      });
    }

    await createNotification(
      payroll.userId,
      'TRANSFER_OUT',
      `Batch payroll sent (${results.length} workers)`,
      `Total $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })} — Batch ${batchRef}`,
      { reference: batchRef, amount: total, status: 'SUCCESS' }
    );

    await prisma.pendingAction.delete({ where: { id: action.id } });

    res.json({
      success: true,
      batchRef,
      count: results.length,
      total,
      payments: results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Batch confirmation failed' });
  }
});

// ============================================================
// HISTORY
// ============================================================

router.get('/payments', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const { category, workerId, limit = 200 } = req.query;
    const where = { payrollUserId: req.userId };
    if (category && category !== 'ALL') where.category = category;
    if (workerId) where.workerId = workerId;

    const payments = await prisma.payrollPayment.findMany({
      where,
      include: { worker: true },
      orderBy: { paidAt: 'desc' },
      take: Math.min(Number(limit), 1000),
    });

    res.json(payments.map(p => ({
      id: p.id,
      reference: p.reference,
      worker: {
        id: p.worker.id,
        name: p.worker.fullName,
        role: p.worker.role,
        department: p.worker.department,
        photoUrl: p.worker.photoUrl,
        bankName: p.worker.bankName,
        bankAccountNumber: p.worker.bankAccountNumber,
      },
      amount: Number(p.amount),
      category: p.category,
      description: p.description,
      status: p.status,
      paidAt: p.paidAt,
      paidBy: p.paidBy,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// STATS
// ============================================================

router.get('/stats', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const workers = await prisma.worker.findMany({
      where: { payrollUserId: req.userId, isActive: true },
    });
    const payments = await prisma.payrollPayment.findMany({
      where: { payrollUserId: req.userId },
    });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = payments.filter(p => new Date(p.paidAt) >= monthStart);

    const byCategory = {};
    payments.forEach(p => {
      byCategory[p.category] = (byCategory[p.category] || 0) + Number(p.amount);
    });

    const byDepartment = {};
    workers.forEach(w => {
      byDepartment[w.department] = (byDepartment[w.department] || 0) + Number(w.monthlySalary || 0);
    });

    res.json({
      workerCount: workers.length,
      monthlyPayrollCost: workers.reduce((s, w) => s + Number(w.monthlySalary || 0), 0),
      thisMonth: {
        count: thisMonth.length,
        total: thisMonth.reduce((s, p) => s + Number(p.amount), 0),
      },
      allTime: {
        count: payments.length,
        total: payments.reduce((s, p) => s + Number(p.amount), 0),
      },
      byCategory,
      byDepartment,
      account: {
        balance: Number(payroll.balance),
        pendingOut: Number(payroll.pendingOut || 0),
        available: Number(payroll.balance) - Number(payroll.pendingOut || 0),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PAYSLIP PDF
// ============================================================

router.get('/payments/:id/payslip', auth, async (req, res) => {
  try {
    const payroll = await getPayrollAccount(req);
    if (!payroll) return res.status(403).json({ error: 'Payroll access only' });

    const payment = await prisma.payrollPayment.findUnique({
      where: { id: req.params.id },
      include: { worker: true },
    });
    if (!payment || payment.payrollUserId !== req.userId) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const w = payment.worker;
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="payslip-${payment.reference}.pdf"`);
    doc.pipe(res);

    const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const stamp = d => new Date(d).toLocaleDateString('en-US',
      { year:'numeric', month:'long', day:'2-digit' });

    doc.rect(0, 0, 595, 100).fill('#0f2b5b');
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
       .text("ST. MARY'S ORPHANAGE", 50, 30);
    doc.fontSize(10).font('Helvetica')
       .text('PAYROLL PAYSLIP', 50, 60);
    doc.fontSize(8).text(`Reference: ${payment.reference}`, 50, 78);
    doc.text(`Issued: ${stamp(payment.paidAt)}`, 400, 78, { width: 150, align: 'right' });

    doc.rect(50, 130, 495, 100).strokeColor('#d0d5dd').lineWidth(1).stroke();
    doc.fillColor('#0f2b5b').fontSize(9).font('Helvetica-Bold')
       .text('EMPLOYEE', 65, 145);
    doc.fillColor('#111').fontSize(13).font('Helvetica-Bold')
       .text(w.fullName, 65, 162);
    doc.fillColor('#555').fontSize(9).font('Helvetica')
       .text(w.role, 65, 182)
       .text(w.department, 65, 196)
       .text(w.email || '', 65, 210);

    doc.fillColor('#0f2b5b').fontSize(9).font('Helvetica-Bold')
       .text('PAYMENT', 330, 145);
    doc.fillColor('#111').fontSize(22).font('Helvetica-Bold')
       .text(money(payment.amount), 330, 160);
    doc.fillColor('#555').fontSize(9).font('Helvetica')
       .text(`Category: ${payment.category}`, 330, 195)
       .text(`Paid: ${stamp(payment.paidAt)}`, 330, 210);

    doc.rect(50, 250, 495, 90).strokeColor('#d0d5dd').stroke();
    doc.fillColor('#0f2b5b').fontSize(9).font('Helvetica-Bold')
       .text('PAID TO BANK ACCOUNT', 65, 265);
    doc.fillColor('#111').fontSize(10).font('Helvetica')
       .text(w.bankName || 'External Bank', 65, 285)
       .text(`Account: ****${String(w.bankAccountNumber || '').slice(-4)}`, 65, 305)
       .text(`Routing: ${w.bankRoutingNumber || '—'}`, 330, 285)
       .text(`Account holder: ${w.fullName}`, 330, 305);

    doc.rect(50, 360, 495, 60).fill('#f4f6fa');
    doc.fillColor('#0f2b5b').fontSize(9).font('Helvetica-Bold')
       .text('DESCRIPTION', 65, 375);
    doc.fillColor('#333').fontSize(10).font('Helvetica')
       .text(payment.description || '—', 65, 395, { width: 460 });

    doc.fillColor('#555').fontSize(9).font('Helvetica')
       .text('Approved by:', 50, 460)
       .text('____________________________', 50, 485)
       .text('Payroll Officer', 50, 500)
       .text('St. Mary\'s Orphanage — Payroll Department', 50, 515);

    doc.fillColor('#777').fontSize(8).font('Helvetica')
       .text(
         `Continental Federal Bank & Trust · ${bankConfig.routingNumber} · This payslip is computer-generated.`,
         50, 760, { width: 495, align: 'center' }
       );

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;