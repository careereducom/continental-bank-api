const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TEST_USERNAMES = ['testuser01', 'admin01', '3378752831'];

async function main() {
  console.log('Deleting test users:', TEST_USERNAMES.join(', '));

  const users = await prisma.user.findMany({
    where: { username: { in: TEST_USERNAMES } },
    select: { id: true, username: true },
  });

  if (users.length === 0) {
    console.log('No matching users found.');
    return;
  }

  const userIds = users.map(u => u.id);
  console.log(`Found ${users.length} user(s).`);

  // Delete in dependency order (children → parent)
  console.log('Deleting dependent records...');

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.pendingAction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });

  // Payroll
  await prisma.payrollPayment.deleteMany({ where: { payrollUserId: { in: userIds } } });
  await prisma.worker.deleteMany({ where: { payrollUserId: { in: userIds } } });

  // Card, bill, deposit
  await prisma.card.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.billPayment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.deposit.deleteMany({ where: { userId: { in: userIds } } });

  // Transactions referencing user OR their accounts
  const accounts = await prisma.account.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const accountIds = accounts.map(a => a.id);

  await prisma.transaction.deleteMany({
    where: {
      OR: [
        { initiatedBy: { in: userIds } },
        { fromAccountId: { in: accountIds } },
        { toAccountId: { in: accountIds } },
      ],
    },
  });

  // Accounts
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });

  // Finally, users
  const result = await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  console.log(`✅ Deleted ${result.count} user(s) and all their data.`);
}

main()
  .catch(e => console.error('❌ Error:', e.message))
  .finally(() => prisma.$disconnect());