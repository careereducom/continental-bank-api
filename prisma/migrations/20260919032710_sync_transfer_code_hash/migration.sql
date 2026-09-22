-- AlterTable: add transferCodeHash to Account (was created via db push, never migrated)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "transferCodeHash" TEXT;

-- AlterTable: drop stale transferCodeHash from User (moved to Account)
ALTER TABLE "User" DROP COLUMN IF EXISTS "transferCodeHash";