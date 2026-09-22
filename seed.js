const { PrismaClient } = require('@prisma/client');
const { PrismaPg }     = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// ============================================================
// REGISTERED ACCOUNTS
// Realistic 10-digit account numbers + random 4-digit PINs
// ============================================================
const ACCOUNTS = [
  {
    acc:'4829173650',
    name:'ALEXANDER REYES — PRIVATE CLIENT',
    type:'premium', biz:true,
    target: 530482916.47,
    code:'7492',
    city:'New York, NY, USA',
    flagship:true,
  },
  { acc:'7428591036', name:'ANDERSON HOLDINGS LLC', type:'business', biz:false, target: 483216.92, code:'3164', city:'New York, NY, USA' },
  { acc:'3157264980', name:'JAMES ANDERSON',        type:'premium',  biz:false, target: 374821.55, code:'8507', city:'Boston, MA, USA' },
  { acc:'8364201759', name:'MARIA GONZALEZ',        type:'savings',  biz:false, target: 421093.28, code:'2913', city:'Mexico City, MX' },
  { acc:'5691038274', name:'MICHAEL CHEN',          type:'checking', biz:false, target: 312847.61, code:'6481', city:'San Francisco, CA, USA' },
  { acc:'2748519306', name:'SOPHIE TREMBLAY',       type:'premium',  biz:false, target: 285419.73, code:'5629', city:'Montreal, QC, Canada' },
  { acc:'9184670325', name:'CARLOS RODRIGUEZ',      type:'checking', biz:false, target: 195328.14, code:'7803', city:'Guadalajara, MX' },
  { acc:'6529318470', name:'EMILY WATSON',          type:'savings',  biz:false, target: 240781.96, code:'4172', city:'Chicago, IL, USA' },
  { acc:'3975026814', name:'LIAM OCONNOR',          type:'checking', biz:false, target: 175264.38, code:'9358', city:'Toronto, ON, Canada' },
  { acc:'8251749036', name:'ANA MARTINEZ',          type:'savings',  biz:false, target: 165472.89, code:'1046', city:'Monterrey, MX' },
  { acc:'7319245680', name:"ST. MARY'S ORPHANAGE — PAYROLL", type:'payroll', biz:true, target: 450000.00, code:'6284', city:'New York, NY, USA', payroll:true },
];

const SUBSCRIPTIONS = [
  { name:'Netflix Premium',        min: 22.99, max: 22.99, entity:'Netflix Inc., Los Gatos, CA' },
  { name:'Spotify Family',         min: 16.99, max: 16.99, entity:'Spotify AB, Stockholm, SE' },
  { name:'AWS Cloud Services',     min:120.00, max:480.00, entity:'Amazon Web Services, Seattle, WA' },
  { name:'Adobe Creative Cloud',   min: 54.99, max: 79.99, entity:'Adobe Inc., San Jose, CA' },
  { name:'Microsoft 365 Business', min:  9.99, max: 22.99, entity:'Microsoft Corp., Redmond, WA' },
  { name:'Apple One Premier',      min: 37.95, max: 37.95, entity:'Apple Inc., Cupertino, CA' },
  { name:'Salesforce Enterprise',  min:165.00, max:500.00, entity:'Salesforce Inc., San Francisco, CA' },
  { name:'Slack Business+',        min: 12.50, max: 15.00, entity:'Salesforce Inc., San Francisco, CA' },
  { name:'Zoom Pro',               min: 14.99, max: 19.99, entity:'Zoom Video, San Jose, CA' },
  { name:'GitHub Enterprise',      min: 21.00, max: 21.00, entity:'GitHub Inc., San Francisco, CA' },
];

const BILLERS = [
  'Con Edison — New York','Pacific Gas & Electric — California',
  'American Electric Power — Ohio','AT&T Wireless','Verizon Fios',
  'Comcast Xfinity','T-Mobile USA','Bell Canada — Ontario','Hydro-Quebec',
  'Rogers Communications','Telmex — Ciudad de Mexico',
  'CFE — Comision Federal de Electricidad',
];

const CORP_INCOMING = [
  'Wire received — JPMorgan Chase, New York','SWIFT MT103 — HSBC London',
  'Inbound ACH — Bank of America, Charlotte','Wire received — Deutsche Bank, Frankfurt',
  'Settlement credit — London Clearing House','Wire received — Barclays PLC, London',
  'Inbound transfer — BNP Paribas, Paris','Settlement — Euroclear Brussels',
  'Wire received — Citibank NA, New York','Credit — Toronto-Dominion Bank',
  'Credit — Scotiabank, Toronto','Inbound — BBVA Mexico',
  'Settlement — Banco Santander, Madrid','Wire received — UBS AG, Zurich',
  'Credit — Wells Fargo, San Francisco',
];

const CORP_OUTGOING = [
  'Wire sent — JPMorgan Chase, New York','SWIFT MT103 — HSBC London',
  'Outbound ACH — Bank of America, Charlotte','Wire sent — Deutsche Bank, Frankfurt',
  'Settlement debit — London Clearing House','Wire sent — Barclays PLC, London',
  'Outbound transfer — BNP Paribas, Paris','Settlement — Euroclear Brussels',
  'Wire sent — Citibank NA, New York','Debit — Toronto-Dominion Bank',
  'Debit — Scotiabank, Toronto','Outbound — BBVA Mexico',
  'Settlement — Banco Santander, Madrid','Wire sent — UBS AG, Zurich',
  'Debit — Wells Fargo, San Francisco',
];

const CORP_PURPOSES = [
  'Q4 dividend distribution','Supplier settlement — Q3',
  'Investment portfolio rebalance','Vendor invoice settlement',
  'Acquisition escrow release','Corporate bond coupon payment',
  'Inter-company treasury transfer','Securities purchase settlement',
  'Payroll funding — corporate','Tax remittance — IRS',
  'Regulatory filing fee — SEC','Legal retainer — corporate counsel',
];

const RETAIL_IN  = ['Inbound transfer — Chase Bank','Inbound transfer — Bank of America','Inbound transfer — Wells Fargo','Inbound transfer — TD Bank','Inbound transfer — Scotiabank','Inbound transfer — BBVA Mexico'];
const RETAIL_OUT = ['Outbound transfer — Chase Bank','Outbound transfer — Bank of America','Outbound transfer — Wells Fargo','Outbound transfer — TD Bank','Outbound transfer — Scotiabank','Outbound transfer — BBVA Mexico'];

const rand    = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick    = arr => arr[Math.floor(Math.random() * arr.length)];
const money   = n => Math.round(n * 100) / 100;
const sleep   = ms => new Promise(r => setTimeout(r, ms));

function ref(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
}

const START_DATE = new Date();
START_DATE.setFullYear(START_DATE.getFullYear() - 15);
START_DATE.setDate(1);

function generateHistory(account, isBusiness) {
  const txns = [];
  const now = new Date();
  let cursor = new Date(START_DATE.getFullYear(), START_DATE.getMonth(), 1);

  while (cursor < now) {
    const year  = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthEnd = new Date(year, month + 1, 0);
    const ok = (d) => d < now && d >= START_DATE;

    if (!isBusiness) {
      let d = new Date(year, month, 25);
      if (ok(d)) txns.push({ type:'SALARY', category:'INCOME', description:'Monthly payroll deposit', amount: randInt(5200, 14500), direction:'IN', date: d });

      d = new Date(year, month, 3);
      if (ok(d)) {
        const sub = pick(SUBSCRIPTIONS);
        txns.push({ type:'SUBSCRIPTION', category:'SAAS', description: sub.name + ' — ' + sub.entity, amount: money(rand(sub.min, sub.max)), direction:'OUT', date: d });
      }

      d = new Date(year, month, 10);
      if (ok(d)) txns.push({ type:'BILL', category:'UTILITY', description: pick(BILLERS), amount: money(rand(48, 340)), direction:'OUT', date: d });

      const retailCount = randInt(1, 3);
      for (let i = 0; i < retailCount; i++) {
        const day = randInt(1, monthEnd.getDate());
        d = new Date(year, month, day);
        if (!ok(d)) continue;
        const isIn = Math.random() < 0.5;
        txns.push({ type:'TRANSFER', category:'RETAIL', description: pick(isIn ? RETAIL_IN : RETAIL_OUT), amount: money(rand(2500, 18500)), direction: isIn ? 'IN' : 'OUT', date: d });
      }
    }

    if (isBusiness) {
      const corpCount = randInt(4, 8);
      for (let i = 0; i < corpCount; i++) {
        const day = randInt(1, monthEnd.getDate());
        const d = new Date(year, month, day);
        if (!ok(d)) continue;
        const isIn = Math.random() < 0.55;
        const big = Math.random() < 0.20;
        const amount = big ? money(rand(500000, 8500000)) : money(rand(25000, 480000));
        txns.push({ type:'CORPORATE', category: big ? 'LARGE_WIRE' : 'MEDIUM_WIRE', description: pick(isIn ? CORP_INCOMING : CORP_OUTGOING) + ' — ' + pick(CORP_PURPOSES), amount, direction: isIn ? 'IN' : 'OUT', date: d });
      }

      const d = new Date(year, month, 5);
      if (ok(d)) {
        const sub = pick(SUBSCRIPTIONS);
        txns.push({ type:'SUBSCRIPTION', category:'BUSINESS_SAAS', description: sub.name + ' — ' + sub.entity, amount: money(rand(sub.min, sub.max)), direction:'OUT', date: d });
      }
    }

    if (month === 11) {
      const d = new Date(year, 11, 31);
      if (ok(d)) {
        const div = isBusiness ? rand(250000, 1800000) : rand(800, 6500);
        txns.push({ type:'DIVIDEND', category:'INVESTMENT', description:'Year-end dividend', amount: money(div), direction:'IN', date: d });
      }
    }

    cursor = new Date(year, month + 1, 1);
  }

  return txns;
}

function computeOpening(target, txns) {
  const net = txns.reduce((sum, t) => sum + (t.direction === 'IN' ? t.amount : -t.amount), 0);
  return money(target - net);
}

async function insertBatches(records, batchSize = 50) {
  const total = records.length;
  let inserted = 0;
  let i = 0;

  while (i < total) {
    const slice = records.slice(i, i + batchSize);
    let ok = false;

    for (let tries = 1; tries <= 8; tries++) {
      try {
        await prisma.transaction.createMany({ data: slice });
        ok = true;
        break;
      } catch (e) {
        await sleep(2000 + tries * 500);
      }
    }

    if (ok) {
      inserted += slice.length;
      i += batchSize;
      if (i % 500 === 0 || i >= total) {
        process.stdout.write('    progress: ' + i + '/' + total + '\r');
      }
      await sleep(100);
    } else {
      console.log('\n    skipped batch at ' + i);
      i += batchSize;
    }
  }

  process.stdout.write('\n');
  return inserted;
}

async function main() {
  console.log('Initializing Continental Federal Bank ledger...\n');

  console.log('Clearing existing data...');
  await prisma.notification.deleteMany({});
  await prisma.pendingAction.deleteMany({});
  await prisma.payrollPayment.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.billPayment.deleteMany({});
  await prisma.deposit.deleteMany({});
  await prisma.card.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.payrollPayment.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.pendingAction.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('Cleared.\n');

  const passwordHash = await bcrypt.hash('password123', 12);
  let totalBalance = 0;
  let totalTxns = 0;

  for (const a of ACCOUNTS) {
    const openedAt = new Date(START_DATE);
    openedAt.setDate(openedAt.getDate() + randInt(0, 30));

    const user = await prisma.user.create({
      data: {
        username: a.acc, passwordHash, fullName: a.name,
        email: a.acc.toLowerCase() + '@cfbank.com',
        phone: '+1' + randInt(2000000000, 9999999999),
        kycStatus: 'VERIFIED', createdAt: openedAt
      }
    });

    const account = await prisma.account.create({
      data: {
        accountNumber: a.acc, accountName: a.name,
        balance: 0, accountType: a.type, isBusiness: a.biz,
        transferCode: a.code, isRegistered: true,
        openedAt, userId: user.id, createdAt: openedAt
      }
    });

    const txns = generateHistory(a, a.biz);
    const opening = computeOpening(a.target, txns);

    let running = opening;
    const records = [];

    records.push({
      reference: ref('OP'), amount: Math.abs(opening) || 0.01,
      status: 'SUCCESS', type: 'DEPOSIT', category: 'OPENING',
      description: 'Account opened — ' + a.city,
      balanceAfter: opening, fromAccountId: null, toAccountId: account.id,
      initiatedBy: user.id, createdAt: openedAt
    });

    txns.sort((x, y) => x.date - y.date);

    for (const t of txns) {
      running += t.direction === 'IN' ? t.amount : -t.amount;
      running = money(running);
      const isIn = t.direction === 'IN';
      records.push({
        reference: ref('TX'), amount: money(t.amount),
        status: 'SUCCESS', type: t.type, category: t.category,
        description: t.description, balanceAfter: running,
        fromAccountId: isIn ? null : account.id,
        toAccountId:   isIn ? account.id : null,
        initiatedBy: user.id, createdAt: t.date
      });
    }

    console.log('  ' + a.name.padEnd(34) + ' | inserting ' + records.length + ' txns...');
    const inserted = await insertBatches(records, 50);

    await prisma.account.update({
      where: { id: account.id },
      data: { balance: running }
    });

    totalBalance += running;
    totalTxns += inserted;

    const flag = a.flagship ? ' [FLAGSHIP]' : '';
    const balanceStr = '$' + running.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    console.log('  ✓ ' + a.name.padEnd(32) + ' | ' + String(inserted).padStart(5) + ' txns | ' + balanceStr + flag);
  }

  const adminHash = await bcrypt.hash('admin123', 12);
  await prisma.user.create({
    data: {
      username: 'admin', passwordHash: adminHash,
      fullName: 'System Administrator',
      email: 'admin@cfbank.com', isAdmin: true,
      kycStatus: 'VERIFIED', createdAt: START_DATE
    }
  });

  console.log('\n========================================');
  console.log('  Accounts           : ' + ACCOUNTS.length);
  console.log('  Ledger entries     : ' + totalTxns.toLocaleString());
  console.log('  Total deposits     : $' + totalBalance.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}));
  console.log('  Operating history  : 15 years');
  console.log('  Admin login        : admin / admin123');
  console.log('========================================\n');

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});