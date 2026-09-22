const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const password = 'Test1234!';
  const hash = await bcrypt.hash(password, 12);

  // Create the user (upsert = create if not exists, update if exists)
  const user = await prisma.user.upsert({
    where: { username: 'testuser01' },
    update: {
      passwordHash: hash,
      approvalStatus: 'ACTIVE',
      email: 'akayajibola@gmail.com',
      fullName: 'Test User',
    },
    create: {
      username: 'testuser01',
      email: 'akayajibola@gmail.com',
      fullName: 'Test User',
      passwordHash: hash,
      approvalStatus: 'ACTIVE',
      kycStatus: 'VERIFIED',
    },
  });

  // Create a checking account for the user (so post-OTP response has accounts)
  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id },
  });

  if (!existingAccount) {
    await prisma.account.create({
      data: {
        accountNumber: 'CFB00010001',
        accountName: 'Test User - Checking',
        balance: 5000,
        accountType: 'checking',
        transferCode: '1234',
        userId: user.id,
      },
    });
    console.log('✅ Account created: CFB00010001');
  }

  console.log('');
  console.log('=================================');
  console.log('✅ TEST USER READY');
  console.log('=================================');
  console.log('Username: testuser01');
  console.log('Password: Test1234!');
  console.log('Email:    akayajibola@gmail.com');
  console.log('=================================');
}

main()
  .catch(e => console.error('❌ Error:', e.message))
  .finally(() => prisma.$disconnect());