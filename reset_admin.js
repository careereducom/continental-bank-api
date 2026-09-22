const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = new PrismaClient();

async function main() {
  const username = 'admin';
  const newPassword = crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, 'x');
  const hash = await bcrypt.hash(newPassword, 12);

  const user = await prisma.user.update({
    where: { username },
    data: { passwordHash: hash },
  });

  const newPin = String(Math.floor(1000 + Math.random() * 9000));
  const pinHash = await bcrypt.hash(newPin, 12);
  await prisma.account.updateMany({
    where: { userId: user.id },
    data: { transferCodeHash: pinHash },
  });

  console.log('');
  console.log('============================================');
  console.log('USERNAME: admin');
  console.log('PASSWORD: ' + newPassword);
  console.log('PIN:      ' + newPin);
  console.log('============================================');
}

main().catch(e => console.error(e.message)).finally(() => prisma.$disconnect());