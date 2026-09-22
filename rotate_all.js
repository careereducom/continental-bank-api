const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const prisma = new PrismaClient();

const USERNAMES = [
  '4829173650', '7428591036', '3157264980', '8364201759',
  '5691038274', '2748519306', '9184670325', '6529318470',
  '3975026814', '8251749036', '7319245680', 'admin',
];

async function main() {
  const report = [];

  for (const username of USERNAMES) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.log(`Skipping ${username} (not in DB)`);
      continue;
    }

    const newPass = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, 'x');
    const newPin  = String(Math.floor(1000 + Math.random() * 9000));

    const passHash = await bcrypt.hash(newPass, 12);
    const pinHash  = await bcrypt.hash(newPin, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: passHash },
    });

    await prisma.account.updateMany({
      where: { userId: user.id },
      data: { transferCodeHash: pinHash },
    });

    report.push(`${username} | pass: ${newPass} | pin: ${newPin}`);
    console.log(`Rotated ${username}`);
  }

  fs.writeFileSync('NEW_CREDENTIALS.txt', report.join('\n'));

  console.log(`\n${report.length} accounts rotated.`);
  console.log('Saved to NEW_CREDENTIALS.txt');
  console.log('Move them to a password manager, then DELETE the file.');
}

main().catch(console.error).finally(() => prisma.$disconnect());