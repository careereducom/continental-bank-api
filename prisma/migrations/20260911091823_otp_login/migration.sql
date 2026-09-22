-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginOtp" TEXT,
ADD COLUMN     "loginOtpExpiry" TIMESTAMP(3);
