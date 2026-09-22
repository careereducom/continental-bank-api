// __tests__/transfers.test.js
// Verifies atomic transfers, especially concurrent-replay rejection.

jest.mock('../src/config/mailer', () => ({
  sendEmail:    jest.fn().mockResolvedValue({ id: 'mock' }),
  sendOtpEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
}));

const request = require('supertest');
const app     = require('../src/server');
const prisma  = require('../src/config/db');
const bcrypt  = require('bcryptjs');

let senderId, senderAcctId, senderAcctNumber;
let receiverId, receiverAcctId, receiverAcctNumber;
let jwtToken;
const PIN      = '4321';
const PASSWORD = 'testpass123';

let __userCounter = 0;

async function makeTestUser(prefix, balance, pin) {
  __userCounter++;
  const username = '3' + String(Date.now()).slice(-6) + String(__userCounter).padStart(3, '0');

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const pinHash      = await bcrypt.hash(pin, 12);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      fullName: prefix + ' TEST USER',
      email:    `${prefix.toLowerCase()}_${Date.now()}_${__userCounter}@example.com`,
      approvalStatus: 'ACTIVE',
      kycStatus: 'VERIFIED',
    },
  });

  const acct = await prisma.account.create({
    data: {
      accountNumber: username,
      accountName:   user.fullName,
      balance,
      accountType:   'checking',
      isBusiness:    false,
      transferCode:  pin,
      transferCodeHash: pinHash,
      isRegistered:  true,
      userId:        user.id,
    },
  });

  return { user, acct };
}

async function loginAndGetJwt(username) {
  const login  = await request(app).post('/api/auth/login')
    .send({ username, password: PASSWORD });

  const user   = await prisma.user.findUnique({ where: { username } });
  const verify = await request(app).post('/api/auth/verify-otp')
    .send({ stageToken: login.body.stageToken, code: user.loginOtp });

  return verify.body.token;
}

beforeAll(async () => {
  const s = await makeTestUser('SENDER',   50000, PIN);
  senderId         = s.user.id;
  senderAcctId     = s.acct.id;
  senderAcctNumber = s.acct.accountNumber;

  const r = await makeTestUser('RECEIVER', 1000, '1111');
  receiverId         = r.user.id;
  receiverAcctId     = r.acct.id;
  receiverAcctNumber = r.acct.accountNumber;

  jwtToken = await loginAndGetJwt(senderAcctNumber);
  expect(jwtToken).toBeTruthy();
});

afterAll(async () => {
  const ids     = [senderId, receiverId].filter(Boolean);
  const accts   = await prisma.account.findMany({ where: { userId: { in: ids } } });
  const acctIds = accts.map(a => a.id);

  await prisma.transaction.deleteMany({
    where: { OR: [{ fromAccountId: { in: acctIds } }, { toAccountId: { in: acctIds } }] },
  });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.pendingAction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.card.deleteMany({ where: { userId: { in: ids } } });
  await prisma.account.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('Transfers', () => {

  test('initiate returns pendingId + OTP stored in DB', async () => {
    const res = await request(app)
      .post('/api/transfers/initiate')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        fromAccountId:   senderAcctId,
        toAccountNumber: receiverAcctNumber,
        amount:          100,
        transferCode:    PIN,
      });

    expect(res.status).toBe(200);
    expect(res.body.pendingId).toBeTruthy();

    const pa = await prisma.pendingAction.findUnique({ where: { id: res.body.pendingId } });
    expect(pa).toBeTruthy();
    expect(pa.otp).toMatch(/^\d{6}$/);
  });

  test('CONCURRENCY: same OTP twice in parallel -> one 200, one 409', async () => {
    const init = await request(app)
      .post('/api/transfers/initiate')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        fromAccountId:   senderAcctId,
        toAccountNumber: receiverAcctNumber,
        amount:          250,
        transferCode:    PIN,
      });

    const pendingId = init.body.pendingId;
    const pa        = await prisma.pendingAction.findUnique({ where: { id: pendingId } });
    const otp       = pa.otp;

    const [r1, r2] = await Promise.all([
      request(app).post('/api/transfers/confirm')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ pendingId, otp }),
      request(app).post('/api/transfers/confirm')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ pendingId, otp }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  test('replay after success -> 404 (pending action consumed)', async () => {
    const init = await request(app)
      .post('/api/transfers/initiate')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        fromAccountId:   senderAcctId,
        toAccountNumber: receiverAcctNumber,
        amount:          50,
        transferCode:    PIN,
      });

    const pendingId = init.body.pendingId;
    const pa        = await prisma.pendingAction.findUnique({ where: { id: pendingId } });

    const first = await request(app).post('/api/transfers/confirm')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ pendingId, otp: pa.otp });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/transfers/confirm')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ pendingId, otp: pa.otp });
    expect(second.status).toBe(404);
  });

  test('insufficient balance is rejected', async () => {
    const init = await request(app)
      .post('/api/transfers/initiate')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        fromAccountId:   senderAcctId,
        toAccountNumber: receiverAcctNumber,
        amount:          999999999,
        transferCode:    PIN,
      });

    // Initiate should already reject on available-balance check
    expect([200, 400]).toContain(init.status);

    if (init.status === 200) {
      const pa = await prisma.pendingAction.findUnique({ where: { id: init.body.pendingId } });
      const confirm = await request(app).post('/api/transfers/confirm')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ pendingId: init.body.pendingId, otp: pa.otp });
      expect(confirm.status).toBe(400);
    }
  });
});