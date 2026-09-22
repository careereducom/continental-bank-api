// __tests__/auth.test.js
// End-to-end: signup -> approve -> activate -> login -> verify-otp.
// Verifies the new-user history seeding runs on activation.

jest.mock('../src/config/mailer', () => ({
  sendEmail:    jest.fn().mockResolvedValue({ id: 'mock' }),
  sendOtpEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
}));

const request  = require('supertest');
const app      = require('../src/server');
const prisma   = require('../src/config/db');

const TEST_EMAIL    = `authtest_${Date.now()}@example.com`;
const TEST_PASSWORD = 'testpass123';
let createdUserId  = null;
let accountNumber  = null;

afterAll(async () => {
  if (createdUserId) {
    const accts   = await prisma.account.findMany({ where: { userId: createdUserId } });
    const acctIds = accts.map(a => a.id);
    await prisma.transaction.deleteMany({
      where: { OR: [{ fromAccountId: { in: acctIds } }, { toAccountId: { in: acctIds } }] },
    });
    await prisma.card.deleteMany({ where: { userId: createdUserId } });
    await prisma.notification.deleteMany({ where: { userId: createdUserId } });
    await prisma.pendingAction.deleteMany({ where: { userId: createdUserId } });
    await prisma.account.deleteMany({ where: { userId: createdUserId } });
    await prisma.user.delete({ where: { id: createdUserId } });
  }
  await prisma.$disconnect();
});

describe('Auth flow end-to-end', () => {

  test('signup creates PENDING user + zero-balance account + frozen card', async () => {
    const res = await request(app).post('/api/signup/start').send({
      fullName: 'Auth Test User',
      email: TEST_EMAIL,
      phone: '+15551234567',
      password: TEST_PASSWORD,
      dateOfBirth: '1990-01-15',
      addressLine1: '123 Test St',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'United States',
      ssnLast4: '1234',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accountNumber).toMatch(/^3\d{9}$/);
    accountNumber = res.body.accountNumber;

    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user).toBeTruthy();
    expect(user.approvalStatus).toBe('PENDING');
    createdUserId = user.id;

    const acct = await prisma.account.findFirst({ where: { userId: user.id } });
    expect(acct).toBeTruthy();
    expect(Number(acct.balance)).toBe(0);

    const card = await prisma.card.findFirst({ where: { userId: user.id } });
    expect(card).toBeTruthy();
    expect(card.status).toBe('FROZEN');
  });

  test('login blocked while approvalStatus = PENDING', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: accountNumber, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_PENDING');
  });

  test('activation seeds history + sets user ACTIVE + unfreezes card', async () => {
    const accessCode = '123456';
    await prisma.user.update({
      where: { id: createdUserId },
      data: {
        approvalStatus:   'APPROVED',
        accessCode,
        accessCodeExpiry: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    const res = await request(app).post('/api/auth/activate')
      .send({ accountNumber, accessCode });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: createdUserId } });
    expect(user.approvalStatus).toBe('ACTIVE');
    expect(user.accessCode).toBeNull();

    const acct = await prisma.account.findFirst({ where: { userId: createdUserId } });
    expect(Number(acct.balance)).toBeGreaterThan(0);

    const txnCount = await prisma.transaction.count({
      where: { OR: [{ fromAccountId: acct.id }, { toAccountId: acct.id }] },
    });
    expect(txnCount).toBeGreaterThan(10);

    const card = await prisma.card.findFirst({ where: { userId: createdUserId } });
    expect(card.status).toBe('ACTIVE');
  });

  test('login returns stageToken + fresh OTP stored', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: accountNumber, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.otpRequired).toBe(true);
    expect(res.body.stageToken).toBeTruthy();

    const user = await prisma.user.findUnique({ where: { id: createdUserId } });
    expect(user.loginOtp).toMatch(/^\d{6}$/);
  });

  test('verify-otp returns JWT + accounts with non-zero balance', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: accountNumber, password: TEST_PASSWORD });

    // Re-read AFTER login because login regenerates the OTP
    const freshUser = await prisma.user.findUnique({ where: { id: createdUserId } });

    const res = await request(app).post('/api/auth/verify-otp')
      .send({ stageToken: login.body.stageToken, code: freshUser.loginOtp });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.accounts.length).toBeGreaterThan(0);
    expect(res.body.accounts[0].balance).toBeGreaterThan(0);
  });
});