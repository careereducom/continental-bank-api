const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const password = 'Admin1234!';
  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { username: 'admin01' },
    update: {
      passwordHash: hash,
      isAdmin: true,
      approvalStatus: 'ACTIVE',
      email: 'tph0539@gmail.com',
      fullName: 'Admin User',
    },
    create: {
      username: 'admin01',
      email: 'tph0539@gmail.com',
      fullName: 'Admin User',
      passwordHash: hash,
      isAdmin: true,
      approvalStatus: 'ACTIVE',
      kycStatus: 'VERIFIED',
    },
  });

  const existing = await prisma.account.findFirst({ where: { userId: user.id } });
  if (!existing) {
    await prisma.account.create({
      data: {
        accountNumber: 'CFB00099999',
        accountName: 'Admin - Operations',
        balance: 0,
        accountType: 'checking',
        transferCode: '9999',
        userId: user.id,
      }
    });
  }

  console.log('');
  console.log('=================================');
  console.log('✅ ADMIN USER READY');
  console.log('=================================');
  console.log('Username: admin01');
  console.log('Password: Admin1234!');
  console.log('Email:    tph0539@gmail.com');
  console.log('isAdmin:  true');
  console.log('=================================');
}

main().catch(e => console.error(e.message)).finally(() => prisma.$disconnect());