/**
 * Seed St. Mary's Orphanage worker profiles.
 * 40 workers across 11 different US banks.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const WORKERS = [
  // ── EDUCATION (8) ─────────────────────────────────────────────
  { fullName: 'Grace Anderson',   role: 'Head Teacher',             category: 'STAFF', department: 'Education', monthlySalary: 4200, bank: ['JPMorgan Chase Bank, New York, NY', '021000021'], email: 'grace.anderson@stmarys.org',   phone: '2125551001' },
  { fullName: 'Daniel Smith',     role: 'Assistant Teacher',        category: 'STAFF', department: 'Education', monthlySalary: 3100, bank: ['Wells Fargo Bank, San Francisco, CA', '121000248'], email: 'daniel.smith@stmarys.org',     phone: '2125551002' },
  { fullName: 'Martha Miller',    role: 'Reading Specialist',       category: 'STAFF', department: 'Education', monthlySalary: 3400, bank: ['Bank of America, Charlotte, NC', '026009593'], email: 'martha.miller@stmarys.org',    phone: '2125551003' },
  { fullName: 'Robert Brown',     role: 'Math Tutor',               category: 'STAFF', department: 'Education', monthlySalary: 2900, bank: ['USAA Federal Savings Bank, San Antonio, TX', '314074269'], email: 'robert.brown@stmarys.org',     phone: '2125551004' },
  { fullName: 'Jennifer Davis',   role: 'Art Teacher',              category: 'STAFF', department: 'Education', monthlySalary: 2650, bank: ['Citibank, New York, NY', '021000089'], email: 'jennifer.davis@stmarys.org',   phone: '2125551005' },
  { fullName: 'Christopher Wilson', role: 'Music Teacher',          category: 'STAFF', department: 'Education', monthlySalary: 2800, bank: ['PNC Bank, Pittsburgh, PA', '031000503'], email: 'chris.wilson@stmarys.org',     phone: '2125551006' },
  { fullName: 'Patricia Moore',   role: 'Special Needs Teacher',    category: 'STAFF', department: 'Education', monthlySalary: 3800, bank: ['TD Bank, Cherry Hill, NJ', '021214891'], email: 'patricia.moore@stmarys.org',   phone: '2125551007' },
  { fullName: 'James Taylor',     role: 'Physical Education',       category: 'STAFF', department: 'Education', monthlySalary: 2700, bank: ['Capital One, McLean, VA', '051000017'], email: 'james.taylor@stmarys.org',     phone: '2125551008' },

  // ── KITCHEN (5) ───────────────────────────────────────────────
  { fullName: 'Linda Thompson',   role: 'Head Cook',                category: 'STAFF', department: 'Kitchen',   monthlySalary: 2800, bank: ['JPMorgan Chase Bank, New York, NY', '021000021'], email: 'linda.thompson@stmarys.org',   phone: '2125551009' },
  { fullName: 'Michael Garcia',   role: 'Sous Chef',                category: 'STAFF', department: 'Kitchen',   monthlySalary: 2400, bank: ['Wells Fargo Bank, San Francisco, CA', '121000248'], email: 'michael.garcia@stmarys.org',   phone: '2125551010' },
  { fullName: 'Barbara Martinez', role: 'Nutritionist',             category: 'STAFF', department: 'Kitchen',   monthlySalary: 3200, bank: ['Bank of America, Charlotte, NC', '026009593'], email: 'barbara.martinez@stmarys.org', phone: '2125551011' },
  { fullName: 'David Rodriguez',  role: 'Kitchen Assistant',        category: 'STAFF', department: 'Kitchen',   monthlySalary: 2100, bank: ['USAA Federal Savings Bank, San Antonio, TX', '314074269'], email: 'david.rodriguez@stmarys.org',  phone: '2125551012' },
  { fullName: 'Susan Hernandez',  role: 'Dietary Aide',             category: 'STAFF', department: 'Kitchen',   monthlySalary: 2050, bank: ['Citibank, New York, NY', '021000089'], email: 'susan.hernandez@stmarys.org',  phone: '2125551013' },

  // ── MEDICAL (5) ───────────────────────────────────────────────
  { fullName: 'Samuel Johnson',   role: 'Head Nurse',               category: 'STAFF', department: 'Medical',   monthlySalary: 4200, bank: ['USAA Federal Savings Bank, San Antonio, TX', '314074269'], email: 'samuel.johnson@stmarys.org',   phone: '2125551014' },
  { fullName: 'Karen White',      role: 'Pediatric Nurse',          category: 'STAFF', department: 'Medical',   monthlySalary: 3900, bank: ['JPMorgan Chase Bank, New York, NY', '021000021'], email: 'karen.white@stmarys.org',      phone: '2125551015' },
  { fullName: 'Nancy Lopez',      role: 'Counselor',                category: 'STAFF', department: 'Medical',   monthlySalary: 3600, bank: ['Bank of America, Charlotte, NC', '026009593'], email: 'nancy.lopez@stmarys.org',      phone: '2125551016' },
  { fullName: 'Paul Clark',       role: 'Therapist',                category: 'STAFF', department: 'Medical',   monthlySalary: 3700, bank: ['PNC Bank, Pittsburgh, PA', '031000503'], email: 'paul.clark@stmarys.org',       phone: '2125551017' },
  { fullName: 'Elizabeth Lewis',  role: 'Medical Assistant',        category: 'STAFF', department: 'Medical',   monthlySalary: 2600, bank: ['Wells Fargo Bank, San Francisco, CA', '121000248'], email: 'elizabeth.lewis@stmarys.org',  phone: '2125551018' },

  // ── ADMIN (5) ─────────────────────────────────────────────────
  { fullName: 'Diana Foster',     role: 'Administrator',            category: 'STAFF', department: 'Admin',     monthlySalary: 3400, bank: ['Citibank, New York, NY', '021000089'], email: 'diana.foster@stmarys.org',     phone: '2125551019' },
  { fullName: 'William Walker',   role: 'Accountant',               category: 'STAFF', department: 'Admin',     monthlySalary: 4100, bank: ['JPMorgan Chase Bank, New York, NY', '021000021'], email: 'william.walker@stmarys.org',   phone: '2125551020' },
  { fullName: 'Margaret Hall',    role: 'HR Coordinator',           category: 'STAFF', department: 'Admin',     monthlySalary: 3300, bank: ['Bank of America, Charlotte, NC', '026009593'], email: 'margaret.hall@stmarys.org',    phone: '2125551021' },
  { fullName: 'Charles Allen',    role: 'IT Support',               category: 'STAFF', department: 'Admin',     monthlySalary: 3500, bank: ['TD Bank, Cherry Hill, NJ', '021214891'], email: 'charles.allen@stmarys.org',    phone: '2125551022' },
  { fullName: 'Sandra Young',     role: 'Receptionist',             category: 'STAFF', department: 'Admin',     monthlySalary: 2200, bank: ['Capital One, McLean, VA', '051000017'], email: 'sandra.young@stmarys.org',     phone: '2125551023' },

  // ── FACILITIES (6) ────────────────────────────────────────────
  { fullName: 'Peter Williams',   role: 'Driver',                   category: 'STAFF', department: 'Facilities', monthlySalary: 2400, bank: ['JPMorgan Chase Bank, New York, NY', '021000021'], email: 'peter.williams@stmarys.org',   phone: '2125551024' },
  { fullName: 'Linda Parker',     role: 'Lead Cleaner',             category: 'STAFF', department: 'Facilities', monthlySalary: 2200, bank: ['Wells Fargo Bank, San Francisco, CA', '121000248'], email: 'linda.parker@stmarys.org',     phone: '2125551025' },
  { fullName: 'Thomas Scott',     role: 'Security Guard',           category: 'STAFF', department: 'Facilities', monthlySalary: 2300, bank: ['Bank of America, Charlotte, NC', '026009593'], email: 'thomas.scott@stmarys.org',     phone: '2125551026' },
  { fullName: 'Dorothy King',     role: 'Laundry Attendant',        category: 'STAFF', department: 'Facilities', monthlySalary: 1900, bank: ['Citibank, New York, NY', '021000089'], email: 'dorothy.king@stmarys.org',     phone: '2125551027' },
  { fullName: 'Daniel Wright',    role: 'Groundskeeper',            category: 'STAFF', department: 'Facilities', monthlySalary: 2000, bank: ['USAA Federal Savings Bank, San Antonio, TX', '314074269'], email: 'daniel.wright@stmarys.org',    phone: '2125551028' },
  { fullName: 'Betty Green',      role: 'Housekeeping',             category: 'STAFF', department: 'Facilities', monthlySalary: 1850, bank: ['PNC Bank, Pittsburgh, PA', '031000503'], email: 'betty.green@stmarys.org',      phone: '2125551029' },

  // ── CONTRACTORS (6) ───────────────────────────────────────────
  { fullName: 'Andrew Carter',    role: 'Electrical Contractor',    category: 'CONTRACTOR', department: 'Facilities', monthlySalary: 3200, bank: ['USAA Federal Savings Bank, San Antonio, TX', '314074269'], email: 'andrew.carter@contractor.com', phone: '2125551030' },
  { fullName: 'Joshua Turner',    role: 'Plumbing Contractor',      category: 'CONTRACTOR', department: 'Facilities', monthlySalary: 3000, bank: ['JPMorgan Chase Bank, New York, NY', '021000021'], email: 'joshua.turner@contractor.com', phone: '2125551031' },
  { fullName: 'Kevin Phillips',   role: 'HVAC Contractor',          category: 'CONTRACTOR', department: 'Facilities', monthlySalary: 3400, bank: ['Wells Fargo Bank, San Francisco, CA', '121000248'], email: 'kevin.phillips@contractor.com', phone: '2125551032' },
  { fullName: 'Ryan Campbell',    role: 'Roofing Contractor',       category: 'CONTRACTOR', department: 'Facilities', monthlySalary: 2800, bank: ['Bank of America, Charlotte, NC', '026009593'], email: 'ryan.campbell@contractor.com', phone: '2125551033' },
  { fullName: 'Brian Parker',     role: 'Painter',                  category: 'CONTRACTOR', department: 'Facilities', monthlySalary: 2400, bank: ['Citibank, New York, NY', '021000089'], email: 'brian.parker@contractor.com',   phone: '2125551034' },
  { fullName: 'Justin Evans',     role: 'Landscaper',               category: 'CONTRACTOR', department: 'Facilities', monthlySalary: 2200, bank: ['PNC Bank, Pittsburgh, PA', '031000503'], email: 'justin.evans@contractor.com',   phone: '2125551035' },

  // ── VOLUNTEERS (5) ────────────────────────────────────────────
  { fullName: 'Ashley Edwards',   role: 'Reading Volunteer',        category: 'VOLUNTEER', department: 'Education', monthlySalary: 800, bank: ['JPMorgan Chase Bank, New York, NY', '021000021'], email: 'ashley.edwards@volunteer.org', phone: '2125551036' },
  { fullName: 'Nicole Collins',   role: 'Art Volunteer',            category: 'VOLUNTEER', department: 'Education', monthlySalary: 750, bank: ['Wells Fargo Bank, San Francisco, CA', '121000248'], email: 'nicole.collins@volunteer.org', phone: '2125551037' },
  { fullName: 'Brandon Stewart',  role: 'Sports Coach',             category: 'VOLUNTEER', department: 'Education', monthlySalary: 900, bank: ['Bank of America, Charlotte, NC', '026009593'], email: 'brandon.stewart@volunteer.org', phone: '2125551038' },
  { fullName: 'Samantha Sanchez', role: 'Medical Volunteer',        category: 'VOLUNTEER', department: 'Medical',  monthlySalary: 1000, bank: ['USAA Federal Savings Bank, San Antonio, TX', '314074269'], email: 'samantha.sanchez@volunteer.org', phone: '2125551039' },
  { fullName: 'Rachel Morris',    role: 'Administrative Volunteer', category: 'VOLUNTEER', department: 'Admin',    monthlySalary: 700, bank: ['Citibank, New York, NY', '021000089'], email: 'rachel.morris@volunteer.org',  phone: '2125551040' },
];

const PHOTOS = [
  'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=300&h=300&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=300&h=300&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=300&h=300&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=300&h=300&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&h=300&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&h=300&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=300&h=300&fit=crop&crop=faces',
];

async function seed() {
  console.log('Seeding St. Mary\'s Orphanage worker profiles...\n');

  const payrollUser = await prisma.user.findFirst({
    where: { accounts: { some: { accountType: 'payroll' } } },
  });

  if (!payrollUser) {
    console.error('Payroll user not found. Run seed.js first.');
    process.exit(1);
  }

  console.log(`Payroll user: ${payrollUser.fullName} (${payrollUser.username})\n`);

  await prisma.payrollPayment.deleteMany({ where: { payrollUserId: payrollUser.id } });
  await prisma.worker.deleteMany({ where: { payrollUserId: payrollUser.id } });

  let count = 0;
  for (let i = 0; i < WORKERS.length; i++) {
    const w = WORKERS[i];
    await prisma.worker.create({
      data: {
        payrollUserId: payrollUser.id,
        fullName: w.fullName,
        role: w.role,
        category: w.category,
        department: w.department,
        email: w.email,
        phone: w.phone,
        photoUrl: PHOTOS[i % PHOTOS.length],
        monthlySalary: w.monthlySalary,
        bankName: w.bank[0],
        bankRoutingNumber: w.bank[1],
        bankAccountNumber: String(8000000000 + Math.floor(Math.random() * 1999999999)),
        notes: `${w.role} in ${w.department}`,
        isActive: true,
      },
    });
    count++;
  }

  const monthly = WORKERS.reduce((s, w) => s + w.monthlySalary, 0);
  const banks = new Set(WORKERS.map(w => w.bank[0].split(',')[0]));

  console.log(`  ✓ Created ${count} workers`);
  console.log(`  ✓ Monthly payroll : $${monthly.toLocaleString()}`);
  console.log(`  ✓ Banks used      : ${Array.from(banks).join(', ')}`);
  console.log(`\n  Categories:`);
  console.log(`    STAFF      : ${WORKERS.filter(w => w.category === 'STAFF').length}`);
  console.log(`    CONTRACTOR : ${WORKERS.filter(w => w.category === 'CONTRACTOR').length}`);
  console.log(`    VOLUNTEER  : ${WORKERS.filter(w => w.category === 'VOLUNTEER').length}`);
  console.log(`\n  Departments:`);
  ['Education','Kitchen','Medical','Admin','Facilities'].forEach(d => {
    console.log(`    ${d.padEnd(12)}: ${WORKERS.filter(w => w.department === d).length}`);
  });

  console.log(`\n========================================`);
  console.log(`  SEED COMPLETE`);
  console.log(`========================================\n`);

  await prisma.$disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });