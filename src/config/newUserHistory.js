// src/config/newUserHistory.js
// Seeds a new (freshly activated) account with a realistic recent history.
const prisma = require('./db');

const rand    = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick    = arr => arr[Math.floor(Math.random() * arr.length)];
const money   = n => Math.round(n * 100) / 100;

let refCounter = 0;
function ref(prefix) {
  refCounter = (refCounter + 1) % 1000000;
  return (
    prefix +
    Date.now().toString(36).toUpperCase() +
    refCounter.toString(36).toUpperCase().padStart(3, '0') +
    Math.random().toString(36).slice(2, 6).toUpperCase()
  );
}

const RETAIL_IN  = ['Inbound transfer — Chase Bank','Inbound transfer — Bank of America','Inbound transfer — Wells Fargo','Inbound transfer — TD Bank'];
const RETAIL_OUT = ['Outbound transfer — Chase Bank','Outbound transfer — Bank of America','Outbound transfer — Wells Fargo','Outbound transfer — TD Bank'];
const BILLERS    = ['Con Edison — New York','AT&T Wireless','Verizon Fios','Comcast Xfinity','T-Mobile USA'];
const SUBS = [
  { name:'Netflix Premium',        amount: 22.99, entity:'Netflix Inc., Los Gatos, CA' },
  { name:'Spotify Family',         amount: 16.99, entity:'Spotify AB, Stockholm, SE' },
  { name:'Adobe Creative Cloud',   amount: 54.99, entity:'Adobe Inc., San Jose, CA' },
  { name:'Apple One Premier',      amount: 37.95, entity:'Apple Inc., Cupertino, CA' },
  { name:'Microsoft 365 Business', amount:  9.99, entity:'Microsoft Corp., Redmond, WA' },
];

async function seedNewUserHistory(user, account, opts = {}) {
  const months          = opts.months          ?? 6;
  const minBalance      = opts.minBalance      ?? 2500;
  const maxBalance      = opts.maxBalance      ?? 45000;
  const startingBalance = opts.startingBalance ?? null;

  const now   = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  start.setDate(1);

  const txns = [];
  let cursor  = new Date(start);

  while (cursor < now) {
    const year     = cursor.getFullYear();
    const month    = cursor.getMonth();
    const monthEnd = new Date(year, month + 1, 0);
    const ok       = d => d < now && d >= start;

    let d = new Date(year, month, 25);
    if (ok(d)) txns.push({ type:'SALARY', category:'INCOME', description:'Monthly payroll deposit',
      amount: randInt(3200, 7800), direction:'IN', date: d });

    d = new Date(year, month, 3);
    if (ok(d)) {
      const s = pick(SUBS);
      txns.push({ type:'SUBSCRIPTION', category:'SAAS',
        description: s.name + ' — ' + s.entity,
        amount: money(s.amount), direction:'OUT', date: d });
    }

    d = new Date(year, month, 10);
    if (ok(d)) txns.push({ type:'BILL', category:'UTILITY', description: pick(BILLERS),
      amount: money(rand(45, 220)), direction:'OUT', date: d });

    const retailCount = randInt(1, 3);
    for (let i = 0; i < retailCount; i++) {
      d = new Date(year, month, randInt(1, monthEnd.getDate()));
      if (!ok(d)) continue;
      const isIn = Math.random() < 0.55;
      txns.push({ type:'TRANSFER', category:'RETAIL',
        description: pick(isIn ? RETAIL_IN : RETAIL_OUT),
        amount: money(rand(120, 2400)), direction: isIn ? 'IN' : 'OUT', date: d });
    }

    cursor = new Date(year, month + 1, 1);
  }

  txns.sort((a, b) => a.date - b.date);

  const target  = startingBalance != null ? startingBalance : money(rand(minBalance, maxBalance));
  const net     = txns.reduce((s, t) => s + (t.direction === 'IN' ? t.amount : -t.amount), 0);
  const opening = money(target - net);

  let running = opening;
  const records = [];

  records.push({
    reference:     ref('OP'),
    amount:        Math.abs(opening) || 0.01,
    status:        'SUCCESS',
    type:          'DEPOSIT',
    category:      'OPENING',
    description:   'Account opened — initial deposit',
    balanceAfter:  opening,
    fromAccountId: null,
    toAccountId:   account.id,
    initiatedBy:   user.id,
    createdAt:     start,
  });

  for (const t of txns) {
    running += t.direction === 'IN' ? t.amount : -t.amount;
    running  = money(running);
    const isIn = t.direction === 'IN';
    records.push({
      reference:     ref('TX'),
      amount:        money(t.amount),
      status:        'SUCCESS',
      type:          t.type,
      category:      t.category,
      description:   t.description,
      balanceAfter:  running,
      fromAccountId: isIn ? null : account.id,
      toAccountId:   isIn ? account.id : null,
      initiatedBy:   user.id,
      createdAt:     t.date,
    });
  }

  await prisma.transaction.createMany({ data: records });
  await prisma.account.update({
    where: { id: account.id },
    data:  { balance: running },
  });

  return { inserted: records.length, finalBalance: running };
}

module.exports = { seedNewUserHistory };
